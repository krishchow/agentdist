#!/usr/bin/env node
/**
 * A model server that records every request and answers with a script, so a harness can run a
 * whole session without a real model. What a harness sends is the evidence of what it loaded: the
 * skills, subagents and MCP tools it knows about all end up in the system prompt or the tools list.
 *
 * Speaks four wire formats, streaming and not:
 *   POST /v1/messages                          Anthropic Messages
 *   POST /v1/chat/completions                  OpenAI Chat Completions
 *   POST /v1/responses                         OpenAI Responses
 *   POST /v1beta/models/<m>:generateContent    Gemini (and :streamGenerateContent)
 * Any path prefix before those is accepted, since harnesses disagree about whether the base URL
 * includes `/v1`.
 *
 * The script: the first turn that offers a shell tool gets one call to it (`echo probe-tool-call`),
 * so tool hooks have something to fire on; every other turn gets a short text answer. A runner can
 * turn the tool call off for a session by writing `text` to $PROBE_DIR/mock-mode (`tool` turns it
 * back on). A harness that only stops when the model calls its finishing tool (Cline's
 * `submit_and_exit`) gets that call instead of a text answer.
 *
 * Usage: node mock-llm.mjs [port]   (default 4010, or $MOCK_LLM_PORT)
 * Log:   $PROBE_DIR/llm.jsonl, one line per request: { at, method, path, headers, body }
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const PORT = Number(process.argv[2] ?? process.env.MOCK_LLM_PORT ?? 4010);
const DIR = process.env.PROBE_DIR ?? "/tmp/probe";
const LOG = join(DIR, "llm.jsonl");
mkdirSync(DIR, { recursive: true });

const ANSWER = "PROBE_MODEL_ANSWER";
const SHELL_COMMAND = "echo probe-tool-call";
const SHELL_TOOLS = new Set([
  "Bash",
  "bash",
  "shell",
  "Shell",
  "exec_command",
  "run_shell_command",
  "execute_command",
  "run_terminal_cmd",
  "developer__shell",
  "local_shell",
  "Execute",
  "terminal",
]);

let counter = 0;
const id = (prefix) => `${prefix}_probe_${++counter}`;

// ---------------------------------------------------------------------------------------------
// Deciding what to say

/** The arguments for a shell tool, guessed from its input schema. */
function shellArgs(schema) {
  const props = schema?.properties ?? {};
  if (props.command?.type === "array") return { command: ["bash", "-lc", SHELL_COMMAND] };
  if (props.command)
    return { command: SHELL_COMMAND, ...(props.description ? { description: "probe" } : {}) };
  if (props.cmd) return { cmd: SHELL_COMMAND };
  if (props.script) return { script: SHELL_COMMAND };
  return { command: SHELL_COMMAND };
}

/** Tools a harness waits for before it ends a headless run, and what to call them with. */
const FINISH_TOOLS = {
  submit_and_exit: { summary: "PROBE_MODEL_ANSWER, nothing else to do.", verified: true },
};

function mode() {
  try {
    return readFileSync(join(DIR, "mock-mode"), "utf8").trim();
  } catch {
    return "tool";
  }
}

/**
 * Pick the reply for a request, given the tools it offers ({name, schema}) and whether the
 * conversation already holds a tool result. At most one shell call per conversation.
 */
function decide(tools, sawToolResult) {
  const finish = tools.find((t) => t.name in FINISH_TOOLS);
  const shell = tools.find((t) => SHELL_TOOLS.has(t.name));
  if (shell && !sawToolResult && mode() === "tool") {
    return { tool: { id: id("call"), name: shell.name, args: shellArgs(shell.schema) } };
  }
  if (finish) return { tool: { id: id("call"), name: finish.name, args: FINISH_TOOLS[finish.name] } };
  return { text: ANSWER };
}

// ---------------------------------------------------------------------------------------------
// Wire formats

function sse(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  return {
    event(name, data) {
      res.write(`${name ? `event: ${name}\n` : ""}data: ${JSON.stringify(data)}\n\n`);
    },
    raw(line) {
      res.write(line);
    },
    end() {
      res.end();
    },
  };
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const USAGE_ANTHROPIC = {
  input_tokens: 10,
  output_tokens: 5,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

function anthropic(_req, res, body) {
  const tools = (body.tools ?? []).map((t) => ({ name: t.name, schema: t.input_schema }));
  const sawToolResult = (body.messages ?? []).some(
    (m) => Array.isArray(m.content) && m.content.some((c) => c.type === "tool_result"),
  );
  const reply = decide(tools, sawToolResult);
  const msgId = id("msg");
  const model = body.model ?? "probe-model";
  const block = reply.tool
    ? { type: "tool_use", id: reply.tool.id, name: reply.tool.name, input: reply.tool.args }
    : { type: "text", text: reply.text };
  const stop = reply.tool ? "tool_use" : "end_turn";

  if (!body.stream) {
    return json(res, 200, {
      id: msgId,
      type: "message",
      role: "assistant",
      model,
      content: [block],
      stop_reason: stop,
      stop_sequence: null,
      usage: USAGE_ANTHROPIC,
    });
  }
  const s = sse(res);
  s.event("message_start", {
    type: "message_start",
    message: {
      id: msgId,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { ...USAGE_ANTHROPIC, output_tokens: 1 },
    },
  });
  if (reply.tool) {
    s.event("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: reply.tool.id, name: reply.tool.name, input: {} },
    });
    s.event("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(reply.tool.args) },
    });
  } else {
    s.event("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
    s.event("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: reply.text },
    });
  }
  s.event("content_block_stop", { type: "content_block_stop", index: 0 });
  s.event("message_delta", {
    type: "message_delta",
    delta: { stop_reason: stop, stop_sequence: null },
    usage: { output_tokens: 5 },
  });
  s.event("message_stop", { type: "message_stop" });
  s.end();
}

function chatCompletions(_req, res, body) {
  const tools = (body.tools ?? []).map((t) => ({
    name: t.function?.name ?? t.name,
    schema: t.function?.parameters ?? t.parameters,
  }));
  const sawToolResult = (body.messages ?? []).some((m) => m.role === "tool");
  const reply = decide(tools, sawToolResult);
  const chatId = id("chatcmpl");
  const model = body.model ?? "probe-model";
  const created = Math.floor(Date.now() / 1000);
  const toolCall = reply.tool && {
    index: 0,
    id: reply.tool.id,
    type: "function",
    function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.args) },
  };
  const finish = reply.tool ? "tool_calls" : "stop";
  const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };

  if (!body.stream) {
    return json(res, 200, {
      id: chatId,
      object: "chat.completion",
      created,
      model,
      choices: [
        {
          index: 0,
          message: reply.tool
            ? { role: "assistant", content: null, tool_calls: [toolCall] }
            : { role: "assistant", content: reply.text },
          finish_reason: finish,
        },
      ],
      usage,
    });
  }
  const s = sse(res);
  const chunk = (delta, finish_reason = null, extra = {}) =>
    s.event(null, {
      id: chatId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta, finish_reason }],
      ...extra,
    });
  chunk({ role: "assistant", content: "" });
  if (reply.tool) chunk({ tool_calls: [toolCall] });
  else chunk({ content: reply.text });
  chunk({}, finish, { usage });
  s.raw("data: [DONE]\n\n");
  s.end();
}

function responses(_req, res, body) {
  const tools = (body.tools ?? []).map((t) => ({ name: t.name ?? t.function?.name, schema: t.parameters }));
  const input = Array.isArray(body.input) ? body.input : [];
  const sawToolResult = input.some(
    (i) => i.type === "function_call_output" || i.type === "custom_tool_call_output",
  );
  const reply = decide(tools, sawToolResult);
  const respId = id("resp");
  const model = body.model ?? "probe-model";
  const item = reply.tool
    ? {
        type: "function_call",
        id: id("fc"),
        call_id: reply.tool.id,
        name: reply.tool.name,
        arguments: JSON.stringify(reply.tool.args),
        status: "completed",
      }
    : {
        type: "message",
        id: id("msg"),
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: reply.text, annotations: [] }],
      };
  const usage = {
    input_tokens: 10,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 5,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 15,
  };
  const response = (status, output) => ({
    id: respId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status,
    model,
    output,
    usage: status === "completed" ? usage : null,
  });

  if (!body.stream) return json(res, 200, response("completed", [item]));
  const s = sse(res);
  let seq = 0;
  const ev = (type, data) => s.event(type, { type, sequence_number: seq++, ...data });
  ev("response.created", { response: response("in_progress", []) });
  ev("response.in_progress", { response: response("in_progress", []) });
  if (reply.tool) {
    ev("response.output_item.added", {
      output_index: 0,
      item: { ...item, arguments: "", status: "in_progress" },
    });
    ev("response.function_call_arguments.delta", {
      output_index: 0,
      item_id: item.id,
      delta: item.arguments,
    });
    ev("response.function_call_arguments.done", {
      output_index: 0,
      item_id: item.id,
      arguments: item.arguments,
    });
  } else {
    ev("response.output_item.added", {
      output_index: 0,
      item: { ...item, content: [], status: "in_progress" },
    });
    ev("response.content_part.added", {
      output_index: 0,
      item_id: item.id,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    });
    ev("response.output_text.delta", {
      output_index: 0,
      item_id: item.id,
      content_index: 0,
      delta: reply.text,
    });
    ev("response.output_text.done", {
      output_index: 0,
      item_id: item.id,
      content_index: 0,
      text: reply.text,
    });
    ev("response.content_part.done", {
      output_index: 0,
      item_id: item.id,
      content_index: 0,
      part: item.content[0],
    });
  }
  ev("response.output_item.done", { output_index: 0, item });
  ev("response.completed", { response: response("completed", [item]) });
  s.end();
}

function gemini(_req, res, body, streaming) {
  const tools = (body.tools ?? []).flatMap((t) =>
    (t.functionDeclarations ?? t.function_declarations ?? []).map((f) => ({
      name: f.name,
      schema: f.parameters ?? f.parametersJsonSchema,
    })),
  );
  const sawToolResult = (body.contents ?? []).some((c) =>
    (c.parts ?? []).some((p) => p.functionResponse || p.function_response),
  );
  const reply = decide(tools, sawToolResult);
  const part = reply.tool
    ? { functionCall: { name: reply.tool.name, args: reply.tool.args } }
    : { text: reply.text };
  const payload = {
    candidates: [{ content: { role: "model", parts: [part] }, finishReason: "STOP", index: 0 }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    modelVersion: "probe-model",
  };
  if (!streaming) return json(res, 200, payload);
  const s = sse(res);
  s.event(null, payload);
  s.end();
}

// ---------------------------------------------------------------------------------------------
// Routing

const MODELS = ["probe-model", "claude-sonnet-4-5", "gpt-5", "gemini-2.5-pro"];

function route(req, res, body) {
  const path = (req.url ?? "/").split("?")[0];
  const query = new URL(req.url ?? "/", "http://x").searchParams;

  if (req.method === "GET" && /\/models\/?$/.test(path)) {
    return json(res, 200, {
      object: "list",
      data: MODELS.map((m) => ({
        id: m,
        object: "model",
        created: 0,
        owned_by: "probe",
        type: "model",
        display_name: m,
      })),
      models: MODELS.map((m) => ({ name: `models/${m}`, supportedGenerationMethods: ["generateContent"] })),
      has_more: false,
    });
  }
  if (req.method !== "POST") return json(res, 200, {});
  if (path.endsWith("/messages/count_tokens")) return json(res, 200, { input_tokens: 10 });
  if (path.endsWith("/messages")) return anthropic(req, res, body);
  if (path.endsWith("/chat/completions")) return chatCompletions(req, res, body);
  if (path.endsWith("/responses")) return responses(req, res, body);
  if (path.endsWith(":streamGenerateContent")) return gemini(req, res, body, true);
  if (path.endsWith(":generateContent")) return gemini(req, res, body, query.get("alt") === "sse");
  if (path.endsWith(":countTokens")) return json(res, 200, { totalTokens: 10 });
  return json(res, 404, { error: { message: `mock-llm: no route for ${path}` } });
}

const REDACT = /authorization|api-key|x-goog-api-key/i;

createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const text = Buffer.concat(chunks).toString("utf8");
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { unparsed: text };
    }
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, REDACT.test(k) ? "<redacted>" : v]),
    );
    appendFileSync(
      LOG,
      `${JSON.stringify({ at: new Date().toISOString(), method: req.method, path: req.url, headers, body })}\n`,
    );
    try {
      route(req, res, body);
    } catch (error) {
      json(res, 500, { error: { message: String(error?.stack ?? error) } });
    }
  });
}).listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`mock-llm listening on http://127.0.0.1:${PORT}, logging to ${LOG}\n`);
});
