#!/usr/bin/env node
/**
 * A stand-in for the two vendor backends that are not model APIs: Cursor's (aiserver.v1 /
 * agent.v1, Connect over protobuf) and Devin's (exa.*, the Codeium Connect API). Neither has a
 * base-URL override for a model, but both let the whole backend be redirected, so this answers
 * just enough for a session to start and send its context, and records what arrives.
 *
 * It never produces a model turn; the harness gives up after a while. That is enough: everything a
 * harness loaded (skills, subagents, MCP tools, an expanded command) is in what it sends first.
 *
 * It needs no protobuf schemas to read requests. Protobuf strings are raw UTF-8, so the recorded
 * `text` of a request (gunzipped, Connect envelopes unwrapped, hex runs decoded) holds every
 * string the harness sent, canaries included. Only the replies are hand-encoded.
 *
 * Usage: node mock-rpc.mjs [port]   (default 4030, or $MOCK_RPC_PORT)
 * Log:   $PROBE_DIR/llm.jsonl, the same log as mock-llm.mjs: { at, method, path, headers, body: { text } }
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const PORT = Number(process.argv[2] ?? process.env.MOCK_RPC_PORT ?? 4030);
const DIR = process.env.PROBE_DIR ?? "/tmp/probe";
const LOG = join(DIR, "llm.jsonl");
mkdirSync(DIR, { recursive: true });

// ---------------------------------------------------------------------------------------------
// Protobuf and Connect, as little as needed

const varint = (n) => {
  const out = [];
  while (n > 127) {
    out.push((n & 127) | 128);
    n >>>= 7;
  }
  out.push(n);
  return Buffer.from(out);
};
/** A length-delimited field. */
const field = (num, value) => {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([varint((num << 3) | 2), varint(bytes.length), bytes]);
};
const envelope = (flags, bytes) => {
  const head = Buffer.alloc(5);
  head[0] = flags;
  head.writeUInt32BE(bytes.length, 1);
  return Buffer.concat([head, bytes]);
};
const END_OF_STREAM = envelope(2, Buffer.from("{}"));

function tryGunzip(bytes) {
  try {
    return gunzipSync(bytes);
  } catch {
    return bytes;
  }
}

/** Split a Connect streaming body into its messages, gunzipping the compressed ones. */
function unwrapEnvelopes(bytes) {
  const out = [];
  let i = 0;
  while (i + 5 <= bytes.length) {
    const flags = bytes[i];
    const length = bytes.readUInt32BE(i + 1);
    if (i + 5 + length > bytes.length) return [bytes];
    const message = bytes.subarray(i + 5, i + 5 + length);
    out.push(flags & 1 ? tryGunzip(message) : message);
    i += 5 + length;
  }
  return out.length ? out : [bytes];
}

/**
 * Every readable string in a request. Cursor sends its agent messages as hex inside a protobuf
 * field, so long hex runs are decoded and read again.
 */
function readable(bytes, depth = 0) {
  const text = bytes.toString("latin1");
  const runs = text.match(/[\x20-\x7e\t\n\r]{4,}/g) ?? [];
  const decoded =
    depth < 2
      ? (text.match(/(?:[0-9a-f]{2}){16,}/g) ?? []).map((hex) => readable(Buffer.from(hex, "hex"), depth + 1))
      : [];
  return [...runs, ...decoded].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Replies

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const FAKE_JWT = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
  sub: "auth0|probe",
  exp: 4102444800,
  iat: 1700000000,
  iss: "https://authentication.cursor.sh",
  aud: "https://cursor.com",
  scope: "openid profile email offline_access",
})}.sig`;

// Cursor: a model must exist (ModelDetails: 1 model_id, 3 display_model_id, 4 display_name, 5 short name).
const MODEL = "probe-model";
const modelDetails = Buffer.concat([
  field(1, MODEL),
  field(3, MODEL),
  field(4, "Probe Model"),
  field(5, "Probe"),
]);
// Keyed by method name alone: the services they live in have moved between versions.
const UNARY = {
  GetUsableModels: field(1, modelDetails),
  GetDefaultModelForCli: field(1, modelDetails),
  // Devin: team settings with allow_mcp_servers (field 1) on, or MCP servers are "disabled by your organization".
  GetCliTeamSettings: Buffer.from("0801", "hex"),
};

function reply(req, res) {
  const path = (req.url ?? "/").split("?")[0];
  const type = req.headers["content-type"] ?? "";
  if (path.startsWith("/auth/exchange_user_api_key")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ accessToken: FAKE_JWT, refreshToken: FAKE_JWT, authId: "auth0|probe" }));
  }
  if (path === "/agent.v1.AgentService/RunSSE") {
    // Ask the client for its request context, which is where it sends everything it loaded:
    // AgentServerMessage{ 2: ExecServerMessage{ 1: id=1, 15: exec_id="e1", 10: request_context_args={} } }
    const exec = Buffer.concat([Buffer.from([0x08, 0x01]), field(15, "e1"), field(10, Buffer.alloc(0))]);
    res.writeHead(200, { "content-type": "application/connect+proto" });
    res.write(envelope(0, field(2, exec)));
    const timer = setTimeout(() => res.end(END_OF_STREAM), 8000);
    res.on("close", () => clearTimeout(timer));
    return;
  }
  if (type.startsWith("application/connect+proto")) {
    res.writeHead(200, { "content-type": "application/connect+proto" });
    return res.end(END_OF_STREAM);
  }
  if (type.includes("json")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end("{}");
  }
  res.writeHead(200, { "content-type": "application/proto" });
  res.end(UNARY[path.split("/").pop()] ?? Buffer.alloc(0));
}

createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const path = req.url ?? "/";
    let bytes = Buffer.concat(chunks);
    const encoding = req.headers["content-encoding"] ?? req.headers["connect-content-encoding"];
    if (encoding === "gzip") bytes = tryGunzip(bytes);
    // Telemetry is large and says nothing about what was loaded.
    const skip = /traces|Analytics|RecordAnalytics/.test(path);
    if (!skip) {
      const text = unwrapEnvelopes(bytes)
        .map((m) => readable(m))
        .join("\n");
      const headers = {
        "content-type": req.headers["content-type"],
        "user-agent": req.headers["user-agent"],
      };
      appendFileSync(
        LOG,
        `${JSON.stringify({ at: new Date().toISOString(), method: req.method, path, headers, body: { text } })}\n`,
      );
    }
    try {
      reply(req, res);
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
}).listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`mock-rpc listening on http://127.0.0.1:${PORT}, logging to ${LOG}\n`);
});
