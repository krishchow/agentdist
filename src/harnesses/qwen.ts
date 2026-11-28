import { defineHarness } from "../harness/define";
import { CANONICAL_TOOLS, dialect } from "../harness/dialect";
import { configRootExists, dotHome, inConfig } from "../harness/locations";
import { HOOK_EVENTS } from "../schema/manifest";
import { markdownAgents } from "../surfaces/agents";
import { markdownCommands } from "../surfaces/commands";
import { hooksConfig } from "../surfaces/hooks";
import { httpEntry, mcpConfig, stdioEntry } from "../surfaces/mcp";
import { sharedSkills } from "../surfaces/shared";

const home = dotHome(".qwen", "QWEN_HOME");

export const qwen = defineHarness({
  id: "qwen",
  label: "Qwen Code",
  configRoot: { user: home, local: ".qwen" },
  detect: configRootExists(home),
  // MCP tools are named as in Claude Code; the built-in tools are Gemini CLI's, mostly.
  dialect: dialect({
    tools: {
      Read: "read_file",
      Write: "write_file",
      Edit: "edit",
      Bash: "run_shell_command",
      Glob: "glob",
      Grep: "grep_search",
      WebFetch: "web_fetch",
      WebSearch: "web_search",
      Task: "agent",
      TodoWrite: "todo_write",
      NotebookEdit: null,
    },
  }),
  kinds: {
    skill: sharedSkills(),
    agent: markdownAgents({ user: inConfig("agents"), local: inConfig("agents") }),
    // Markdown commands take Gemini's placeholder; a `$ARGUMENTS` in one reaches the model as written,
    // with the arguments appended after it.
    command: markdownCommands(
      { user: inConfig("commands"), local: inConfig("commands") },
      { argumentsPlaceholder: "{{args}}" },
    ),
    mcpServer: mcpConfig({
      file: { user: inConfig("settings.json"), local: inConfig("settings.json") },
      format: "json",
      keyPath: ["mcpServers"],
      stdio: stdioEntry({}, { toolTimeout: { field: "timeout", unit: "ms" } }),
      http: httpEntry(
        {},
        { url: "httpUrl", envRef: (name) => `\${${name}}`, toolTimeout: { field: "timeout", unit: "ms" } },
      ),
    }),
    hook: hooksConfig({
      file: { user: inConfig("settings.json"), local: inConfig("settings.json") },
      format: "json",
      events: Object.fromEntries(HOOK_EVENTS.map((event) => [event, event])),
      projectDir: "$QWEN_PROJECT_DIR",
      // A matcher made only of Claude Code's tool names is accepted as it is.
      tools: Object.fromEntries(CANONICAL_TOOLS.map((tool) => [tool, tool])),
      keyPath: (hook) => ["hooks", hook.event],
      item: (hook) => ({
        ...(hook.tools ? { matcher: hook.tools.join("|") } : {}),
        hooks: [
          {
            type: "command",
            command: hook.command,
            name: hook.name,
            ...(hook.timeoutSec ? { timeout: hook.timeoutSec } : {}),
          },
        ],
      }),
    }),
  },
  notes: [
    {
      kinds: ["hook"],
      scope: "local",
      text: "Qwen Code runs a project's hooks only with folder trust on and the folder trusted",
    },
  ],
  sources: [
    "https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/mcp.md",
    "https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/skills.md",
    "https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/sub-agents.md",
    "https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/commands.md",
    "https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/hooks.md",
    "https://github.com/QwenLM/qwen-code/tree/main/docs/developers/tools",
  ],
});
