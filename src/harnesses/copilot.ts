import { defineHarness } from "../harness/define";
import { CANONICAL_TOOLS, dialect } from "../harness/dialect";
import { configRootExists, dotHome, inConfig } from "../harness/locations";
import { markdownAgents } from "../surfaces/agents";
import { commandsAsSkills } from "../surfaces/commands";
import { hooksDir } from "../surfaces/hooks";
import { httpEntry, mcpConfig, stdioEntry } from "../surfaces/mcp";
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
    // The model is offered an MCP tool as `<server>-<tool>`; `<server>/<tool>` is only how a custom
    // agent's `tools` list and permissions name it, which is mcpGrant below.
    toolRef: (server, tool) => `${server}-${tool}`,
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
    // No command directory of its own; a skill is its slash command.
    command: commandsAsSkills(skillsDir({ user: inConfig("skills"), local: inConfig("skills") })),
    mcpServer: mcpConfig({
      // Not the root .mcp.json, although Copilot reads it: Claude Code owns that file's entries, and
      // the two need different ones. VS Code's Copilot harness reads only the root file and the
      // user file, so a project install reaches the CLI and a user install reaches both.
      file: { user: inConfig("mcp-config.json"), local: inConfig("mcp.json") },
      format: "json",
      keyPath: ["mcpServers"],
      // A server inherits little more than PATH, so each variable it needs is referenced, with an
      // empty default so an unset one does not stop the server from starting.
      stdio: stdioEntry({ type: "stdio", tools: ["*"] }, { envRef: (name) => `\${${name}:-}` }),
      http: httpEntry({ type: "http", tools: ["*"] }, { envRef: (name) => `\${${name}}` }),
    }),
    // One definition file per hook. The PascalCase event names select Claude Code's matcher
    // semantics and tool names, which is the contract a package's hook scripts are written against.
    hook: hooksDir({
      dir: { user: inConfig("hooks"), local: inConfig("hooks") },
      events: {
        SessionStart: "SessionStart",
        SessionEnd: "SessionEnd",
        UserPromptSubmit: "UserPromptSubmit",
        PreToolUse: "PreToolUse",
        PostToolUse: "PostToolUse",
        Stop: "Stop",
        SubagentStop: "SubagentStop",
        PreCompact: "PreCompact",
      },
      tools: Object.fromEntries(CANONICAL_TOOLS.map((tool) => [tool, tool])),
      file: (hook) => ({
        name: `${hook.name}.json`,
        content: {
          version: 1,
          hooks: {
            [hook.event]: [
              {
                type: "command",
                ...(hook.tools ? { matcher: hook.tools.join("|") } : {}),
                command: hook.command,
                ...(hook.timeoutSec ? { timeoutSec: hook.timeoutSec } : {}),
              },
            ],
          },
        },
      }),
    }),
  },
  notes: [
    {
      kinds: ["mcpServer", "hook"],
      scope: "local",
      text: "GitHub Copilot loads the project's MCP servers and hooks only once you trust the folder",
    },
  ],
  sources: [
    "https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers",
    "https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills",
    "https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference",
    "https://docs.github.com/en/copilot/reference/custom-agents-configuration",
    "https://docs.github.com/en/copilot/reference/hooks-reference",
    "https://github.com/microsoft/vscode-docs/blob/main/docs/agents/reference/mcp-configuration.md",
    "https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/agent-skills.md",
  ],
});
