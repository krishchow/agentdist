import { defineHarness, unsupported } from "../harness/define";
import { dialect, noToolGrants, proseToolRef } from "../harness/dialect";
import { configRootExists, dotHome, inConfig } from "../harness/locations";
import type { McpServerNode } from "../ir/nodes";
import { tomlAgents } from "../surfaces/agents";
import { compactEntry, mcpConfig } from "../surfaces/mcp";
import { sharedSkills } from "../surfaces/shared";

const home = dotHome(".codex", "CODEX_HOME");

/**
 * Codex's own field names. It does not hand a server the user's whole environment: `env_vars` is
 * the list of variables it forwards.
 */
export function codexMcpEntry(server: McpServerNode) {
  return compactEntry({
    command: server.command,
    args: server.args,
    env: server.env,
    env_vars: server.envPassthrough.length ? server.envPassthrough : undefined,
    startup_timeout_sec: server.startupTimeoutSec,
    tool_timeout_sec: server.toolTimeoutSec,
  });
}

export const codex = defineHarness({
  id: "codex",
  label: "Codex",
  configRoot: { user: home, local: ".codex" },
  detect: configRootExists(home),
  // A subagent file has no tool list; capabilities are narrowed through `features` instead.
  dialect: dialect({ toolRef: proseToolRef, skillRef: (name) => `$${name}`, ...noToolGrants }),
  kinds: {
    skill: sharedSkills(),
    agent: tomlAgents(
      { user: inConfig("agents"), local: inConfig("agents") },
      { fields: ({ name, description, prompt }) => ({ name, description, developer_instructions: prompt }) },
    ),
    command: unsupported("custom prompts are deprecated in Codex and user-only; ship it as a skill"),
    mcpServer: mcpConfig({
      // The project file is read only once the user has trusted the project.
      file: { user: inConfig("config.toml"), local: inConfig("config.toml") },
      format: "toml",
      keyPath: ["mcp_servers"],
      entry: codexMcpEntry,
    }),
  },
  sources: [
    "https://learn.chatgpt.com/docs/extend/mcp",
    "https://learn.chatgpt.com/docs/build-skills",
    "https://learn.chatgpt.com/docs/agent-configuration/subagents",
    "https://learn.chatgpt.com/docs/custom-prompts",
  ],
});
