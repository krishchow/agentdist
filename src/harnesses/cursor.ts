import { defineHarness } from "../harness/define.js";
import { dialect, noToolGrants, proseToolRef } from "../harness/dialect.js";
import { configRootExists, dotHome, inConfig } from "../harness/locations.js";
import { markdownAgents } from "../surfaces/agents.js";
import { markdownCommands } from "../surfaces/commands.js";
import { CLAUDE_HOOKS, hooksConfig } from "../surfaces/hooks.js";
import { httpEntry, mcpConfig, stdioEntry } from "../surfaces/mcp.js";
import { CLAUDE_SKILLS, sharedSkills } from "../surfaces/shared.js";

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
      stdio: stdioEntry({ type: "stdio" }),
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
      projectDir: "$CURSOR_PROJECT_DIR",
      // An edit is a Write here; there is no separate Edit tool.
      tools: { Bash: "Shell", Read: "Read", Write: "Write", Edit: "Write", Grep: "Grep", Task: "Task" },
      // Cursor also runs Claude Code's hooks, so one installed there is not registered again.
      alsoReads: [CLAUDE_HOOKS],
      keyPath: (hook) => ["hooks", hook.event],
      // Entries are flat: no group around the command.
      item: (hook) => ({
        command: hook.command,
        ...(hook.tools ? { matcher: hook.tools.join("|") } : {}),
        ...(hook.timeoutSec ? { timeout: hook.timeoutSec } : {}),
      }),
    }),
  },
  sources: [
    "https://cursor.com/docs/mcp",
    "https://cursor.com/docs/skills",
    "https://cursor.com/docs/subagents",
    "https://cursor.com/docs/customize-cursor",
  ],
});
