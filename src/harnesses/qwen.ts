import { defineHarness } from "../harness/define";
import { dialect } from "../harness/dialect";
import { configRootExists, dotHome, inConfig } from "../harness/locations";
import { markdownAgents } from "../surfaces/agents";
import { markdownCommands } from "../surfaces/commands";
import { mcpConfig, stdioEntry } from "../surfaces/mcp";
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
    command: markdownCommands({ user: inConfig("commands"), local: inConfig("commands") }),
    mcpServer: mcpConfig({
      file: { user: inConfig("settings.json"), local: inConfig("settings.json") },
      format: "json",
      keyPath: ["mcpServers"],
      entry: stdioEntry({}, { toolTimeout: { field: "timeout", unit: "ms" } }),
    }),
  },
  sources: [
    "https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/mcp.md",
    "https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/skills.md",
    "https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/sub-agents.md",
    "https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/commands.md",
    "https://github.com/QwenLM/qwen-code/tree/main/docs/developers/tools",
  ],
});
