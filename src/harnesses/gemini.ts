import { join } from "node:path";
import { defineHarness, type Env } from "../harness/define";
import { dialect, proseSkillRef } from "../harness/dialect";
import { configRootExists, inConfig } from "../harness/locations";
import { markdownAgents } from "../surfaces/agents";
import { tomlCommands } from "../surfaces/commands";
import { hooksConfig } from "../surfaces/hooks";
import { httpEntry, mcpConfig, stdioEntry } from "../surfaces/mcp";
import { sharedSkills } from "../surfaces/shared";

// GEMINI_CLI_HOME replaces the home directory itself, not the .gemini directory inside it.
const home = (env: Env) => join(env.vars.GEMINI_CLI_HOME || env.home, ".gemini");

export const gemini = defineHarness({
  id: "gemini",
  label: "Gemini CLI",
  configRoot: { user: home, local: ".gemini" },
  detect: configRootExists(home),
  dialect: dialect({
    toolRef: (server, tool) => `mcp_${server}_${tool}`,
    // Skills are activated by the model, not typed as a command.
    skillRef: proseSkillRef,
    tools: {
      Read: "read_file",
      Write: "write_file",
      Edit: "replace",
      Bash: "run_shell_command",
      Glob: "glob",
      Grep: "grep_search",
      WebFetch: "web_fetch",
      WebSearch: "google_web_search",
      Task: null,
      TodoWrite: "write_todos",
      NotebookEdit: null,
    },
    mcpGrant: (server, tool) => `mcp_${server}_${tool}`,
  }),
  kinds: {
    // Within a scope Gemini prefers .agents/skills over .gemini/skills, so the shared one is used.
    skill: sharedSkills(),
    agent: markdownAgents({ user: inConfig("agents"), local: inConfig("agents") }, { tools: "list" }),
    command: tomlCommands(
      { user: inConfig("commands"), local: inConfig("commands") },
      { argumentsPlaceholder: "{{args}}" },
    ),
    mcpServer: mcpConfig({
      file: { user: inConfig("settings.json"), local: inConfig("settings.json") },
      format: "json",
      keyPath: ["mcpServers"],
      // Gemini strips variables that look like secrets (*KEY*, *TOKEN*, ...) from what a server
      // inherits unless they are named here. An unset one resolves to an empty string.
      stdio: stdioEntry(
        {},
        { envRef: (name) => `\${${name}}`, toolTimeout: { field: "timeout", unit: "ms" } },
      ),
      // The transport is chosen by the key: httpUrl is streamable HTTP, url is SSE.
      http: httpEntry(
        {},
        { url: "httpUrl", envRef: (name) => `\${${name}}`, toolTimeout: { field: "timeout", unit: "ms" } },
      ),
    }),
    hook: hooksConfig({
      file: { user: inConfig("settings.json"), local: inConfig("settings.json") },
      format: "json",
      events: {
        SessionStart: "SessionStart",
        SessionEnd: "SessionEnd",
        UserPromptSubmit: "BeforeAgent",
        PreToolUse: "BeforeTool",
        PostToolUse: "AfterTool",
        Stop: "AfterAgent",
        PreCompact: "PreCompress",
        Notification: "Notification",
      },
      projectDir: "$GEMINI_PROJECT_DIR",
      keyPath: (hook) => ["hooks", hook.event],
      // Gemini names each hook and, alone among harnesses, counts its timeout in milliseconds.
      item: (hook) => ({
        ...(hook.tools ? { matcher: hook.tools.join("|") } : {}),
        hooks: [
          {
            name: hook.name,
            type: "command",
            command: hook.command,
            ...(hook.timeoutSec ? { timeout: hook.timeoutSec * 1000 } : {}),
          },
        ],
      }),
    }),
  },
  notes: [
    {
      kinds: ["mcpServer"],
      text: "Gemini CLI starts MCP servers, yours included, only in a folder you have trusted",
    },
    {
      kinds: ["skill", "agent", "hook"],
      scope: "local",
      text: "Gemini CLI loads the project's skills, subagents and hooks only once you trust the folder",
    },
    {
      kinds: ["agent"],
      scope: "local",
      text: "Gemini CLI also asks you to acknowledge each project subagent, and again whenever it changes",
    },
  ],
  sources: [
    "https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md",
    "https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/skills.md",
    "https://github.com/google-gemini/gemini-cli/blob/main/docs/core/subagents.md",
    "https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/custom-commands.md",
    "https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md",
  ],
});
