import { join } from "node:path";
import { ALL_EVENTS, MOCK_LLM, writeFile } from "../lib.mjs";

export const codex = {
  id: "codex",
  version: ["codex", "--version"],
  mock: "llm",
  // Written before the install, so the install has to keep it: top-level keys before any table.
  setup(cell) {
    writeFile(
      join(cell.home, ".codex", "config.toml"),
      [
        "# The probe model provider, written by the e2e runner before agentdist installs.",
        'model = "probe-model"',
        'model_provider = "probe"',
        "",
        "[model_providers.probe]",
        'name = "probe"',
        `base_url = "${MOCK_LLM}/v1"`,
        'wire_api = "responses"',
        "",
      ].join("\n"),
    );
  },
  // A project's .codex config (agents, MCP, hooks) loads only in a trusted project.
  async consent(cell, ctx) {
    if (cell.scope !== "local") return;
    const file = join(cell.home, ".codex", "config.toml");
    ctx.append(file, `\n[projects."${cell.repo}"]\ntrust_level = "trusted"\n`);
    ctx.note("trusted the project in ~/.codex/config.toml");
  },
  async introspect(_cell, ctx) {
    const prompt = await ctx.run(["codex", "debug", "prompt-input", "hi"]);
    // Subagents live in the spawn_agent tool, which this command does not print.
    ctx.scanModelText(prompt.stdout, ["skill"], "codex debug prompt-input");
    await ctx.run(["codex", "mcp", "list", "--json"]);
  },
  consentFlags: ["--dangerously-bypass-hook-trust stands in for reviewing each hook in /hooks"],
  session: (_cell, prompt) => [
    "codex",
    "exec",
    "--skip-git-repo-check",
    // There is no config key for hook trust: a user reviews each hook in the TUI.
    "--dangerously-bypass-hook-trust",
    "--dangerously-bypass-approvals-and-sandbox",
    "--json",
    prompt,
  ],
  listed: ["skill", "agent", "mcpServer"],
  hookEvents: ALL_EVENTS,
};
