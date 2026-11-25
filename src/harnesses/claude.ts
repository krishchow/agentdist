import { join } from "node:path";
import { defineHarness } from "../harness/define.js";
import { canonicalDialect } from "../harness/dialect.js";
import { configRootExists, dotHome, inConfig, inProject } from "../harness/locations.js";
import { HOOK_EVENTS } from "../schema/manifest.js";
import { markdownAgents } from "../surfaces/agents.js";
import { markdownCommands } from "../surfaces/commands.js";
import { claudeStyleHook, hooksConfig } from "../surfaces/hooks.js";
import { httpEntry, mcpConfig, stdioEntry } from "../surfaces/mcp.js";
import { skillsDir } from "../surfaces/skills.js";

const home = dotHome(".claude", "CLAUDE_CONFIG_DIR");

export const claude = defineHarness({
  id: "claude",
  label: "Claude Code",
  configRoot: { user: home, local: ".claude" },
  detect: configRootExists(home),
  dialect: canonicalDialect,
  kinds: {
    skill: skillsDir({ user: inConfig("skills"), local: inConfig("skills") }),
    agent: markdownAgents({ user: inConfig("agents"), local: inConfig("agents") }, { passthrough: true }),
    command: markdownCommands(
      { user: inConfig("commands"), local: inConfig("commands") },
      { passthrough: true },
    ),
    mcpServer: mcpConfig({
      file: {
        // User-scope servers live in ~/.claude.json, which sits beside ~/.claude rather than in it
        // unless CLAUDE_CONFIG_DIR moves both into one directory.
        user: ({ env, configRoot }) =>
          env.vars.CLAUDE_CONFIG_DIR ? join(configRoot, ".claude.json") : join(env.home, ".claude.json"),
        local: inProject(".mcp.json"),
      },
      format: "json",
      keyPath: ["mcpServers"],
      stdio: stdioEntry({ type: "stdio" }, { toolTimeout: { field: "timeout", unit: "ms" } }),
      // An unset variable is left as written and reported by `claude mcp list`.
      http: httpEntry({ type: "http" }, { envRef: (name) => `\${${name}}` }),
    }),
    hook: hooksConfig({
      file: { user: inConfig("settings.json"), local: inConfig("settings.json") },
      format: "json",
      // The canonical events are Claude Code's own.
      events: Object.fromEntries(HOOK_EVENTS.map((event) => [event, event])),
      projectDir: "$CLAUDE_PROJECT_DIR",
      keyPath: (hook) => ["hooks", hook.event],
      item: claudeStyleHook,
    }),
  },
  sources: [
    "https://code.claude.com/docs/en/skills",
    "https://code.claude.com/docs/en/sub-agents",
    "https://code.claude.com/docs/en/mcp",
    "https://code.claude.com/docs/en/hooks",
    "https://code.claude.com/docs/en/claude-directory",
  ],
});
