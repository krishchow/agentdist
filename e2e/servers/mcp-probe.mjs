#!/usr/bin/env node
/**
 * A minimal MCP server that records every call it gets, so a test can tell whether a harness
 * started it (stdio) or connected to it (HTTP), and with what.
 *
 *   node mcp-probe.mjs                 stdio, newline-delimited JSON-RPC
 *   node mcp-probe.mjs --http [port]   Streamable HTTP on 127.0.0.1:<port>/mcp (default 4020)
 *
 * It offers two tools, whose descriptions carry a canary the mock model server looks for in the
 * tools a harness sends:
 *   stdio: `stdio_canary`, `stdio_listed`   "PROBE_MCP_STDIO_TOOL"
 *   http:  `http_canary`, `http_listed`     "PROBE_MCP_HTTP_TOOL"
 * The probe's content refers to `*_canary`, so a test can check the harness spells the reference
 * the way it names the tool. Nothing refers to `*_listed`: for a harness that sends the model only
 * tool names, that name in a request can only have come from this server's tools/list.
 *
 * Log: $PROBE_DIR/mcp.jsonl, one line per message: { at, transport, method, ... }. A stdio start
 * records the variables the harness passed (PROBE_* and DEMO_*) and the HOME it ran with; an HTTP
 * request records its path and headers, which is how a test checks environment references were
 * resolved. HTTP answers only /mcp, the URL in the probe's manifest.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { createInterface } from "node:readline";

const DIR = process.env.PROBE_DIR ?? "/tmp/probe";
const LOG = join(DIR, "mcp.jsonl");
mkdirSync(DIR, { recursive: true });

const http = process.argv[2] === "--http";
const transport = http ? "http" : "stdio";
const prefix = http ? "http" : "stdio";
const canary = http ? "PROBE_MCP_HTTP_TOOL" : "PROBE_MCP_STDIO_TOOL";
const schema = { type: "object", properties: {}, additionalProperties: false };
const tools = [
  { name: `${prefix}_canary`, description: `Answers pong. ${canary}`, inputSchema: schema },
  { name: `${prefix}_listed`, description: `Answers pong too. ${canary}`, inputSchema: schema },
];

const record = (entry) =>
  appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), transport, ...entry })}\n`);

const probeEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([k]) => /^(PROBE|DEMO)_/.test(k) && k !== "PROBE_DIR"),
  );

/** The answer to one JSON-RPC message, or undefined for a notification. */
function handle(msg) {
  if (msg.id === undefined || msg.id === null) return undefined;
  const ok = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  switch (msg.method) {
    case "initialize":
      return ok({
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: `probe-${transport}`, version: "1.0.0" },
      });
    case "tools/list":
      return ok({ tools });
    case "tools/call":
      return ok({ content: [{ type: "text", text: `pong PROBE_MCP_${transport.toUpperCase()}_CALLED` }] });
    case "ping":
      return ok({});
    case "resources/list":
      return ok({ resources: [] });
    case "resources/templates/list":
      return ok({ resourceTemplates: [] });
    case "prompts/list":
      return ok({ prompts: [] });
    default:
      return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `no method ${msg.method}` } };
  }
}

if (!http) {
  record({ method: "(start)", env: probeEnv(), home: process.env.HOME, argv: process.argv.slice(2) });
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    for (const m of Array.isArray(msg) ? msg : [msg]) {
      record({ method: m.method ?? "(response)" });
      const reply = handle(m);
      if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`);
    }
  });
} else {
  const port = Number(process.argv[3] ?? process.env.MCP_HTTP_PORT ?? 4020);
  createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const headers = { authorization: req.headers.authorization, "x-client": req.headers["x-client"] };
      const path = (req.url ?? "/").split("?")[0];
      if (path !== "/mcp") {
        record({ method: `(${req.method})`, path, headers });
        res.writeHead(404);
        return res.end();
      }
      if (req.method !== "POST") {
        record({ method: `(${req.method})`, path, headers });
        // No server-initiated stream; a client that asks for one should carry on without it.
        res.writeHead(req.method === "DELETE" ? 200 : 405, { allow: "POST, DELETE" });
        return res.end();
      }
      let msg;
      try {
        msg = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        res.writeHead(400);
        return res.end();
      }
      const messages = Array.isArray(msg) ? msg : [msg];
      for (const m of messages) record({ method: m.method ?? "(response)", path, headers });
      const replies = messages.map(handle).filter(Boolean);
      const session = { "mcp-session-id": req.headers["mcp-session-id"] ?? "probe-session" };
      if (!replies.length) {
        res.writeHead(202, session);
        return res.end();
      }
      res.writeHead(200, { "content-type": "application/json", ...session });
      res.end(JSON.stringify(Array.isArray(msg) ? replies : replies[0]));
    });
  }).listen(port, "127.0.0.1", () => {
    process.stdout.write(`mcp-probe listening on http://127.0.0.1:${port}/mcp, logging to ${LOG}\n`);
  });
}
