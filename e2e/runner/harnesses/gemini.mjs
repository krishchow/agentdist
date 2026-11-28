import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_EVENTS, MOCK_LLM, writeFile } from "../lib.mjs";

const run = (prompt) => ["gemini", "-y", "-m", "gemini-2.5-pro", "-p", prompt];

export const gemini = {
  id: "gemini",
  version: ["gemini", "--version"],
  mock: "llm",
  consentFlags: [
    {
      text: "GEMINI_CLI_TRUST_WORKSPACE=true trusts the folder; untrusted, Gemini disables every MCP server",
      kinds: ["mcpServer"],
    },
    {
      text: "GEMINI_CLI_TRUST_WORKSPACE=true also loads the project's skills, subagents and hooks",
      scope: "local",
      kinds: ["skill", "agent", "hook"],
    },
  ],
  env: () => ({
    GEMINI_API_KEY: "probe",
    GOOGLE_GEMINI_BASE_URL: MOCK_LLM,
    // In an untrusted folder Gemini disables every MCP server, user ones included.
    GEMINI_CLI_TRUST_WORKSPACE: "true",
  }),
  // Without an explicit auth type, a base URL makes Gemini pick "gateway" auth, which it rejects.
  setup(cell) {
    writeFile(
      join(cell.home, ".gemini", "settings.json"),
      `${JSON.stringify(
        { security: { auth: { selectedType: "gemini-api-key" } }, general: { disableAutoUpdate: true } },
        null,
        2,
      )}\n`,
    );
  },
  // A project's subagents load only once the user acknowledges each one, by content hash.
  async consent(cell, ctx) {
    if (cell.scope !== "local" || !ctx.placed.includes("agent:scout")) return;
    const file = join(cell.repo, ".gemini", "agents", "probe-scout.md");
    const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
    writeFile(
      join(cell.home, ".gemini", "acknowledgments", "agents.json"),
      JSON.stringify({ [cell.repo]: { "probe-scout": hash } }),
    );
    ctx.note("acknowledged the project subagent probe-scout", ["agent"]);
  },
  async introspect(_cell, ctx) {
    const skills = await ctx.run(["gemini", "skills", "list"]);
    ctx.scanNames(skills.stdout + skills.stderr, ["skill"], "gemini skills list");
    await ctx.run(["gemini", "mcp", "list"]);
  },
  session: (_cell, prompt) => run(prompt),
  listed: ["skill", "agent", "mcpServer"],
  hookEvents: ALL_EVENTS,
};
