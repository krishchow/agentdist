import { join } from "node:path";
import { defineHarness, type Env } from "../harness/define";
import { dialect, proseSkillRef } from "../harness/dialect";
import { configRootExists, inConfig } from "../harness/locations";
import { markdownAgents } from "../surfaces/agents";
import { tomlCommands } from "../surfaces/commands";
import { mcpConfig, stdioEntry } from "../surfaces/mcp";
import { sharedSkills } from "../surfaces/shared";

// GEMINI_CLI_HOME replaces the home directory itself, not the .gemini directory inside it.
const home = (env: Env) => join(env.vars.GEMINI_CLI_HOME || env.home, ".gemini");

export const gemini = defineHarness({
  id: "gemini",
  label: "Gemini CLI",
  configRoot: { user: home, local: ".gemini" },
  detect: configRootExists(home),
  dialect: dialect({
    toolRef: (server, tool) => `mcp_${server}_${tool}`,
    // Skills are activated by the model, not typed as a command.
    skillRef: proseSkillRef,
    tools: {
      Read: "read_file",
      Write: "write_file",
      Edit: "replace",
      Bash: "run_shell_command",
      Glob: "glob",
      Grep: "grep_search",
      WebFetch: "web_fetch",
      WebSearch: "google_web_search",
      Task: null,
      TodoWrite: "write_todos",
      NotebookEdit: null,
    },
    mcpGrant: (server, tool) => `mcp_${server}_${tool}`,
  }),
  kinds: {
    // Within a scope Gemini prefers .agents/skills over .gemini/skills, so the shared one is used.
    skill: sharedSkills(),
    agent: markdownAgents({ user: inConfig("agents"), local: inConfig("agents") }, { tools: "list" }),
    command: tomlCommands(
      { user: inConfig("commands"), local: inConfig("commands") },
      { argumentsPlaceholder: "{{args}}" },
    ),
    mcpServer: mcpConfig({
      file: { user: inConfig("settings.json"), local: inConfig("settings.json") },
      format: "json",
      keyPath: ["mcpServers"],
      // Gemini strips variables that look like secrets (*KEY*, *TOKEN*, ...) from what a server
      // inherits unless they are named here. An unset one resolves to an empty string.
      entry: stdioEntry(
        {},
        { envRef: (name) => `\${${name}}`, toolTimeout: { field: "timeout", unit: "ms" } },
      ),
    }),
  },
  sources: [
    "https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md",
    "https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/skills.md",
    "https://github.com/google-gemini/gemini-cli/blob/main/docs/core/subagents.md",
    "https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/custom-commands.md",
  ],
});
