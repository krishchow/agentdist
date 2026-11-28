import { join } from "node:path";
import { ALL_EVENTS, MOCK_LLM, writeFile } from "../lib.mjs";

export const copilot = {
  id: "copilot",
  version: ["copilot", "--version"],
  mock: "llm",
  env: () => ({
    COPILOT_OFFLINE: "true",
    COPILOT_PROVIDER_BASE_URL: `${MOCK_LLM}/v1`,
    COPILOT_PROVIDER_TYPE: "openai",
    COPILOT_PROVIDER_API_KEY: "probe",
    COPILOT_AUTO_UPDATE: "false",
    // A model id Copilot knows, so it picks the right tool set.
    COPILOT_MODEL: "gpt-4o",
  }),
  // A project's MCP servers and hooks load only in a trusted folder.
  async consent(cell, ctx) {
    if (cell.scope !== "local") return;
    writeFile(join(cell.home, ".copilot", "config.json"), JSON.stringify({ trustedFolders: [cell.repo] }));
    ctx.note("trusted the project in ~/.copilot/config.json");
  },
  async introspect(_cell, ctx) {
    const skills = await ctx.run(["copilot", "skill", "list"]);
    ctx.scanNames(skills.stdout, ["skill"], "copilot skill list");
    await ctx.run(["copilot", "mcp", "list"]);
  },
  session: (_cell, prompt) => ["copilot", "-p", prompt, "--allow-all-tools", "--no-auto-update"],
  listed: ["skill", "agent", "mcpServer"],
  hookEvents: ALL_EVENTS,
};
