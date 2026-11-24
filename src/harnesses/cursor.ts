import { defineHarness } from "../harness/define";
import { dialect, noToolGrants, proseToolRef } from "../harness/dialect";
import { configRootExists, dotHome, inConfig } from "../harness/locations";
import { markdownAgents } from "../surfaces/agents";
import { markdownCommands } from "../surfaces/commands";
import { mcpConfig, stdioEntry } from "../surfaces/mcp";
import { AGENTS_SKILLS, CLAUDE_SKILLS } from "../surfaces/shared";
import { skillsDir } from "../surfaces/skills";

const home = dotHome(".cursor");

export const cursor = defineHarness({
  id: "cursor",
  label: "Cursor",
  configRoot: { user: home, local: ".cursor" },
  detect: configRootExists(home),
  // Subagent frontmatter has no tool list, and the docs do not give MCP tools a fixed identifier.
  dialect: dialect({ toolRef: proseToolRef, ...noToolGrants }),
  kinds: {
    skill: skillsDir(AGENTS_SKILLS, { alsoReads: [CLAUDE_SKILLS] }),
    // User-level subagents load in the editor but not in the Cursor CLI.
    agent: markdownAgents({ user: inConfig("agents"), local: inConfig("agents") }),
    command: markdownCommands({ user: inConfig("commands"), local: inConfig("commands") }),
    mcpServer: mcpConfig({
      file: { user: inConfig("mcp.json"), local: inConfig("mcp.json") },
      format: "json",
      keyPath: ["mcpServers"],
      entry: stdioEntry({ type: "stdio" }),
    }),
  },
  sources: [
    "https://cursor.com/docs/mcp",
    "https://cursor.com/docs/skills",
    "https://cursor.com/docs/subagents",
    "https://cursor.com/docs/customize-cursor",
  ],
});
