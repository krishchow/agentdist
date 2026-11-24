import { defineHarness } from "../harness/define";
import { dialect, noToolGrants } from "../harness/dialect";
import { configRootExists, dotHome, inConfig } from "../harness/locations";
import { markdownAgents } from "../surfaces/agents";
import { markdownCommands } from "../surfaces/commands";
import { mcpConfig, stdioEntry } from "../surfaces/mcp";
import { AGENTS_SKILLS } from "../surfaces/shared";
import { skillsDir } from "../surfaces/skills";

const home = dotHome(".qwen", "QWEN_HOME");

export const qwen = defineHarness({
  id: "qwen",
  label: "Qwen Code",
  configRoot: { user: home, local: ".qwen" },
  detect: configRootExists(home),
  // MCP tools are named as in Claude Code. The built-in tool names a subagent's allowlist expects
  // are not documented against the canonical ones, so the allowlist is not carried over.
  dialect: dialect({ ...noToolGrants }),
  kinds: {
    skill: skillsDir(AGENTS_SKILLS),
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
  ],
});
