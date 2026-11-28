import { defineHarness } from "../harness/define";
import { dialect, noToolGrants, proseToolRef } from "../harness/dialect";
import { configRootExists, dotHome, inConfig } from "../harness/locations";
import { markdownAgents } from "../surfaces/agents";
import { markdownCommands } from "../surfaces/commands";
import { hooksConfig } from "../surfaces/hooks";
import { httpEntry, mcpConfig, stdioEntry } from "../surfaces/mcp";
import { CLAUDE_SKILLS, sharedSkills } from "../surfaces/shared";

const home = dotHome(".cursor");

export const cursor = defineHarness({
  id: "cursor",
  label: "Cursor",
  configRoot: { user: home, local: ".cursor" },
  detect: configRootExists(home),
  // Subagent frontmatter has no tool list, and the docs do not give MCP tools a fixed identifier.
  dialect: dialect({ toolRef: proseToolRef, ...noToolGrants }),
  kinds: {
    skill: sharedSkills({ alsoReads: [CLAUDE_SKILLS] }),
    // User-level subagents load in the editor but not in the Cursor CLI.
    agent: markdownAgents({ user: inConfig("agents"), local: inConfig("agents") }),
    command: markdownCommands({ user: inConfig("commands"), local: inConfig("commands") }),
    mcpServer: mcpConfig({
      file: { user: inConfig("mcp.json"), local: inConfig("mcp.json") },
      format: "json",
      keyPath: ["mcpServers"],
      // A server gets little more than PATH from the CLI, so each variable it needs is referenced.
      // Not the documented `${env:NAME}`: when NAME is unset the server gets that text literally.
      // `${NAME:-}` gives it an empty value instead (checked in the e2e image, CLI 2026.11.22).
      stdio: stdioEntry({ type: "stdio" }, { envRef: (name) => `\${${name}:-}` }),
      http: httpEntry({}, { envRef: (name) => `\${env:${name}}` }),
    }),
    hook: hooksConfig({
      file: { user: inConfig("hooks.json"), local: inConfig("hooks.json") },
      format: "json",
      preamble: [{ keyPath: ["version"], value: 1 }],
      events: {
        SessionStart: "sessionStart",
        SessionEnd: "sessionEnd",
        UserPromptSubmit: "beforeSubmitPrompt",
        PreToolUse: "preToolUse",
        PostToolUse: "postToolUse",
        Stop: "stop",
        SubagentStop: "subagentStop",
        PreCompact: "preCompact",
      },
      // Claude Code's variable, which Cursor also sets, so a command is byte for byte the one
      // installed for Claude Code: Cursor runs Claude Code's hooks too, and drops one that is
      // identical to its own. It skips Claude Code's file when no group in it has a matcher, so
      // Cursor always gets its own copy.
      projectDir: "$CLAUDE_PROJECT_DIR",
      // An edit is a Write here; there is no separate Edit tool.
      tools: { Bash: "Shell", Read: "Read", Write: "Write", Edit: "Write", Grep: "Grep", Task: "Task" },
      keyPath: (hook) => ["hooks", hook.event],
      // Entries are flat: no group around the command.
      item: (hook) => ({
        command: hook.command,
        ...(hook.tools ? { matcher: hook.tools.join("|") } : {}),
        ...(hook.timeoutSec ? { timeout: hook.timeoutSec } : {}),
      }),
    }),
  },
  notes: [
    { scope: "local", text: "Cursor's CLI runs in a project only once you trust it" },
    {
      kinds: ["mcpServer"],
      scope: "local",
      text: "Cursor asks you to approve the project's MCP servers (or run `cursor-agent mcp enable <name>`)",
    },
    {
      kinds: ["agent"],
      scope: "user",
      text: "Cursor's CLI does not load user-level subagents; the editor does. Install at project scope for both",
    },
  ],
  sources: [
    "https://cursor.com/docs/mcp",
    "https://cursor.com/docs/skills",
    "https://cursor.com/docs/subagents",
    "https://cursor.com/docs/customize-cursor",
  ],
});
