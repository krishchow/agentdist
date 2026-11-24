import { defineHarness, unsupported } from "../harness/define";
import { dialect } from "../harness/dialect";
import { configRootExists, dotHome, inConfig } from "../harness/locations";
import { markdownAgents } from "../surfaces/agents";
import { mcpConfig, stdioEntry } from "../surfaces/mcp";
import { skillsDir } from "../surfaces/skills";

const home = dotHome(".copilot", "COPILOT_HOME");

/**
 * GitHub Copilot: the CLI, and the Copilot harness that VS Code's agent mode now runs, which read
 * the same files. VS Code's older `.vscode/mcp.json` format is deprecated and not written.
 */
export const copilot = defineHarness({
  id: "copilot",
  label: "GitHub Copilot",
  configRoot: { user: home, local: ".github" },
  detect: configRootExists(home),
  dialect: dialect({
    toolRef: (server, tool) => `${server}/${tool}`,
    tools: {
      Read: "read",
      Write: "edit",
      Edit: "edit",
      Bash: "execute",
      Glob: "search",
      Grep: "search",
      WebFetch: "web",
      WebSearch: "web",
      Task: "agent",
      TodoWrite: "todo",
      NotebookEdit: "edit",
    },
    mcpGrant: (server, tool) => `${server}/${tool}`,
  }),
  kinds: {
    // The CLI also reads .agents/skills, but VS Code documents only these two directories, so the
    // skill goes where both will find it.
    skill: skillsDir({ user: inConfig("skills"), local: inConfig("skills") }),
    agent: markdownAgents(
      { user: inConfig("agents"), local: inConfig("agents") },
      { ext: ".agent.md", tools: "list" },
    ),
    command: unsupported("no command directory of its own; ship it as a skill"),
    mcpServer: mcpConfig({
      // Not the root .mcp.json, although Copilot reads it: Claude Code owns that file's entries, and
      // the two need different ones. VS Code's Copilot harness reads only the root file and the
      // user file, so a project install reaches the CLI and a user install reaches both.
      file: { user: inConfig("mcp-config.json"), local: inConfig("mcp.json") },
      format: "json",
      keyPath: ["mcpServers"],
      // A server inherits little more than PATH, so each variable it needs is referenced, with an
      // empty default so an unset one does not stop the server from starting.
      entry: stdioEntry({ type: "stdio", tools: ["*"] }, { envRef: (name) => `\${${name}:-}` }),
    }),
  },
  sources: [
    "https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers",
    "https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills",
    "https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference",
    "https://docs.github.com/en/copilot/reference/custom-agents-configuration",
    "https://github.com/microsoft/vscode-docs/blob/main/docs/agents/reference/mcp-configuration.md",
    "https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/agent-skills.md",
  ],
});
