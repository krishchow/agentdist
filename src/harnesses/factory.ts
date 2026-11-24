import { defineHarness } from "../harness/define";
import { dialect, proseToolRef } from "../harness/dialect";
import { configRootExists, dotHome, inConfig } from "../harness/locations";
import { markdownAgents } from "../surfaces/agents";
import { markdownCommands } from "../surfaces/commands";
import { mcpConfig, stdioEntry } from "../surfaces/mcp";
import { AGENTS_SKILLS } from "../surfaces/shared";
import { skillsDir } from "../surfaces/skills";

const home = dotHome(".factory");

export const factory = defineHarness({
  id: "factory",
  label: "Factory Droid",
  configRoot: { user: home, local: ".factory" },
  detect: configRootExists(home),
  dialect: dialect({
    toolRef: proseToolRef,
    tools: {
      Read: "Read",
      Write: "Create",
      Edit: "Edit",
      Bash: "Execute",
      Glob: "Glob",
      Grep: "Grep",
      WebFetch: "FetchUrl",
      WebSearch: "WebSearch",
      Task: null,
      TodoWrite: "TodoWrite",
      NotebookEdit: null,
    },
    // A droid is given whole MCP servers through its own `mcpServers` field, not single tools.
    mcpGrant: () => null,
  }),
  kinds: {
    skill: skillsDir(AGENTS_SKILLS),
    // Same markdown subagents as everyone else; Factory calls them droids.
    agent: markdownAgents({ user: inConfig("droids"), local: inConfig("droids") }, { tools: "list" }),
    command: markdownCommands({ user: inConfig("commands"), local: inConfig("commands") }),
    mcpServer: mcpConfig({
      file: { user: inConfig("mcp.json"), local: inConfig("mcp.json") },
      format: "json",
      keyPath: ["mcpServers"],
      entry: stdioEntry({ type: "stdio" }),
    }),
  },
  sources: [
    "https://docs.factory.com/harness/mcp.md",
    "https://docs.factory.com/harness/skills.md",
    "https://docs.factory.com/harness/subagents.md",
    "https://docs.factory.com/harness/custom-slash-commands.md",
  ],
});
