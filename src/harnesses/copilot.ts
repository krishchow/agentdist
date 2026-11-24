import { defineHarness, unsupported } from "../harness/define";
import { dialect } from "../harness/dialect";
import { configRootExists, dotHome, inConfig, inProject } from "../harness/locations";
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
      // A root .mcp.json is the one project file both the CLI and VS Code read. Claude Code reads
      // it too, with the same entry, so the two share it.
      file: { user: inConfig("mcp-config.json"), local: inProject(".mcp.json") },
      format: "json",
      keyPath: ["mcpServers"],
      entry: stdioEntry({ type: "stdio" }),
    }),
  },
  sources: [
    "https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers",
    "https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills",
    "https://docs.github.com/en/copilot/reference/custom-agents-configuration",
    "https://github.com/microsoft/vscode-docs/blob/main/docs/agents/reference/mcp-configuration.md",
    "https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/agent-skills.md",
  ],
});
