import { join } from "node:path";
import { defineHarness } from "../harness/define";
import { canonicalDialect } from "../harness/dialect";
import { configRootExists, dotHome, inConfig, inProject } from "../harness/locations";
import { markdownAgents } from "../surfaces/agents";
import { markdownCommands } from "../surfaces/commands";
import { mcpConfig, stdioEntry } from "../surfaces/mcp";
import { skillsDir } from "../surfaces/skills";

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
    command: markdownCommands({ user: inConfig("commands"), local: inConfig("commands") }, { passthrough: true }),
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
      entry: stdioEntry({ type: "stdio" }),
    }),
  },
  sources: [
    "https://code.claude.com/docs/en/skills",
    "https://code.claude.com/docs/en/sub-agents",
    "https://code.claude.com/docs/en/mcp",
  ],
});
