import { join } from "node:path";
import { MOCK_RPC, writeFile } from "../lib.mjs";

export const cursor = {
  id: "cursor",
  version: ["cursor-agent", "--version"],
  // Cursor's model loop runs on its own backend; the mock takes its place and records the
  // context the client sends, but never answers with a model turn.
  mock: "rpc",
  setup(cell) {
    // The agent stream uses HTTP/2 unless told otherwise, which a plain node server cannot speak.
    writeFile(
      join(cell.home, ".cursor", "cli-config.json"),
      JSON.stringify({ network: { useHttp1ForAgent: true } }),
    );
  },
  async introspect(_cell, ctx) {
    // Spawns each server it lists; project servers need the approval the session flag gives.
    await ctx.run(["cursor-agent", "mcp", "list"]);
  },
  session: (_cell, prompt) => [
    "cursor-agent",
    "-p",
    prompt,
    "--trust",
    "--approve-mcps",
    "--force",
    "-e",
    MOCK_RPC,
    "--api-key",
    "probe",
  ],
  // The session never ends on its own: it waits for a model turn that never comes.
  sessionTimeoutMs: 30_000,
  reachedModel: (r) => r.path.includes("BidiAppend"),
  listed: ["skill", "agent", "mcpServer"],
  // MCP tools are sent by name, without their descriptions.
  markers: { "mcpServer:probe": "stdio_listed", "mcpServer:probe-remote": "http_listed" },
  consentFlags: [
    { text: "--trust trusts the workspace", scope: "local" },
    { text: "--approve-mcps approves the project's MCP servers", scope: "local", kinds: ["mcpServer"] },
  ],
  // No model turn, so no tool call and no end of turn: only the session hooks can fire.
  hookEvents: ["SessionStart"],
  known: {
    "user/agent:scout": {
      because:
        "Cursor loads user-level subagents in the editor only, not in the CLI (cursor.com/docs/subagents)",
      detail: 'no request mentioned "PROBE_AGENT_SCOUT_DESC"',
    },
  },
  leftovers: "cursor-agent",
};
