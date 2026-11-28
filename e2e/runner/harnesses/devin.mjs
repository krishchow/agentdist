import { join } from "node:path";
import { MOCK_RPC, writeFile } from "../lib.mjs";

export const devin = {
  id: "devin",
  version: ["devin", "--version"],
  // Devin talks to the Codeium backend, not a model API; the mock takes its place.
  mock: "rpc",
  env: () => ({ DEVIN_PERMISSION_MODE: "dangerous" }),
  // Fake credentials that point the whole backend at the mock. No account is involved.
  setup(cell) {
    writeFile(
      join(cell.home, ".local", "share", "devin", "credentials.toml"),
      `windsurf_api_key = "probe"\napi_server_url = "${MOCK_RPC}"\n`,
    );
  },
  async introspect(_cell, ctx) {
    const skills = await ctx.run(["devin", "skills", "list"]);
    ctx.scanNames(skills.stdout, ["skill"], "devin skills list");
    const doctor = await ctx.run(["devin", "doctor"]);
    ctx.scanNames(doctor.stdout, ["agent"], "devin doctor");
    await ctx.run(["devin", "mcp", "list"]);
  },
  // A workspace never opened interactively is untrusted, and -p refuses to run in it.
  session: (_cell, prompt) => ["devin", "--respect-workspace-trust", "false", "-p", prompt],
  sessionTimeoutMs: 60_000,
  reachedModel: (r) => r.path.includes("GetChatMessage"),
  // MCP servers are reached through generic meta-tools; only server names reach the model, and a
  // server's tools are listed only when the model asks, which a mock with no model turn never does.
  listed: ["skill", "agent"],
  mcpHandshake: "initialize",
  toolCall: false,
  hookEvents: ["SessionStart", "UserPromptSubmit"],
  consentFlags: ["--respect-workspace-trust false runs in a workspace never trusted interactively"],
  known: {
    "local/command:signal": {
      because:
        'The Devin CLI does not read .devin/workflows ("Unknown command"); possibly Devin Desktop only',
      detail: "its body never reached the model",
    },
  },
};
