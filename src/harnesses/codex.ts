import { defineHarness, type Skip, unsupported } from "../harness/define";
import { dialect, noToolGrants } from "../harness/dialect";
import { configRootExists, dotHome, inConfig } from "../harness/locations";
import type { HttpServerNode, McpServerNode, StdioServerNode } from "../ir/nodes";
import { envRefs } from "../ir/templates";
import type { JsonValue } from "../ops/types";
import { tomlAgents } from "../surfaces/agents";
import { claudeStyleHook, hooksConfig } from "../surfaces/hooks";
import { compactEntry, mcpConfig } from "../surfaces/mcp";
import { sharedSkills } from "../surfaces/shared";

const home = dotHome(".codex", "CODEX_HOME");

/**
 * Codex's own field names. It does not hand a server the user's whole environment: `env_vars` is
 * the list of variables it forwards.
 */
export function codexMcpEntry(server: McpServerNode): JsonValue | Skip {
  if (server.transport === "http") return codexHttpEntry(server);
  return compactEntry({
    command: server.command,
    args: server.args,
    env: server.env,
    env_vars: server.envPassthrough.length ? server.envPassthrough : undefined,
    startup_timeout_sec: server.startupTimeoutSec,
    tool_timeout_sec: server.toolTimeoutSec,
  });
}

/**
 * Codex header values are literal, so a header that needs a variable is expressed through the
 * fields Codex has for exactly that: a bearer token variable, or a header-to-variable map.
 */
function codexHttpEntry(server: HttpServerNode): JsonValue | Skip {
  const literal: Record<string, string> = {};
  const fromEnv: Record<string, string> = {};
  let bearer: string | undefined;
  for (const [name, value] of Object.entries(server.headers)) {
    const whole = /^\{\{\s*env:([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/.exec(value);
    const token = /^Bearer \{\{\s*env:([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/.exec(value);
    if (token && name.toLowerCase() === "authorization") bearer = token[1];
    else if (whole) fromEnv[name] = whole[1] as string;
    else if (envRefs(value).length === 0) literal[name] = value;
    else {
      return {
        skip: `Codex can take a header's whole value from a variable, or a bearer token, but not "${value}"`,
      };
    }
  }
  return compactEntry({
    url: server.url,
    bearer_token_env_var: bearer,
    http_headers: literal,
    env_http_headers: fromEnv,
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
  dialect: dialect({ skillRef: (name) => `$${name}`, ...noToolGrants }),
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
      stdio: codexMcpEntry as (server: StdioServerNode) => JsonValue,
      http: codexHttpEntry,
    }),
    hook: hooksConfig({
      file: { user: inConfig("hooks.json"), local: inConfig("hooks.json") },
      format: "json",
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
      // Codex sets no project variable and recommends resolving from the git root.
      projectDir: "$(git rev-parse --show-toplevel)",
      // Edits are one apply_patch tool, which a matcher may also call Edit or Write.
      tools: { Bash: "Bash", Edit: "Edit", Write: "Write", Read: null, Glob: null, Grep: null },
      advice: "Codex runs a new hook only after you review and trust it with /hooks",
      keyPath: (hook) => ["hooks", hook.event],
      item: claudeStyleHook,
    }),
  },
  sources: [
    "https://learn.chatgpt.com/docs/extend/mcp",
    "https://learn.chatgpt.com/docs/build-skills",
    "https://learn.chatgpt.com/docs/agent-configuration/subagents",
    "https://learn.chatgpt.com/docs/custom-prompts",
    "https://learn.chatgpt.com/docs/hooks",
  ],
});
