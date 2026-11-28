import { defineHarness } from "../harness/define";
import { dialect, noToolGrants, proseToolRef } from "../harness/dialect";
import { configRootExists, inConfig, xdgConfig } from "../harness/locations";
import { markdownAgents } from "../surfaces/agents";
import { commandsAsSkills } from "../surfaces/commands";
import { anchored, CLAUDE_HOOKS, claudeStyleHook, hooksConfig } from "../surfaces/hooks";
import { httpEntry, mcpConfig, stdioEntry } from "../surfaces/mcp";
import { CLAUDE_SKILLS, sharedSkills } from "../surfaces/shared";
import { skillsDir } from "../surfaces/skills";

const home = xdgConfig("devin");

/** Devin CLI and Devin Local in Devin Desktop, which is what Windsurf became. */
export const devin = defineHarness({
  id: "devin",
  label: "Devin (Windsurf)",
  configRoot: { user: home, local: ".devin" },
  detect: configRootExists(home),
  dialect: dialect({ toolRef: proseToolRef, ...noToolGrants }),
  kinds: {
    // .claude/skills is imported for projects only.
    skill: sharedSkills({ alsoReads: [{ local: CLAUDE_SKILLS.local }] }),
    agent: markdownAgents(
      { user: inConfig("agents"), local: inConfig("agents") },
      { folderFile: "AGENT.md" },
    ),
    // Workflows have no documented user-level directory under the Devin config home.
    // The CLI's slash commands are skills; it does not read .devin/workflows, and `devin migrate
    // workflows` turns workflows into skills. In Devin's own directories, not the shared one.
    command: commandsAsSkills(skillsDir({ user: inConfig("skills"), local: inConfig("skills") })),
    mcpServer: mcpConfig({
      file: { user: inConfig("mcp_config.json"), local: inConfig("mcp_config.json") },
      format: "json",
      keyPath: ["mcpServers"],
      stdio: stdioEntry(),
      http: httpEntry({ transport: "http" }, { envRef: (name) => `\${env:${name}}` }),
    }),
    hook: hooksConfig({
      // A project has a hooks file of its own; a user's hooks are a key in the main config file.
      file: { user: inConfig("config.json"), local: inConfig("hooks.v1.json") },
      format: "json",
      events: {
        SessionStart: "SessionStart",
        SessionEnd: "SessionEnd",
        UserPromptSubmit: "UserPromptSubmit",
        PreToolUse: "PreToolUse",
        PostToolUse: "PostToolUse",
        Stop: "Stop",
      },
      projectDir: "$DEVIN_PROJECT_DIR",
      tools: { Bash: "exec", Read: "read", Write: "write", Edit: "edit" },
      // Devin also runs Claude Code's hooks, so one installed there is not registered again.
      alsoReads: [CLAUDE_HOOKS],
      keyPath: (hook, ctx) => (ctx.scope === "user" ? ["hooks", hook.event] : [hook.event]),
      // The matcher is an unanchored regular expression, so it is pinned to whole tool names.
      item: (hook) => claudeStyleHook({ ...hook, tools: hook.tools ? [anchored(hook.tools)] : undefined }),
    }),
  },
  notes: [
    {
      scope: "local",
      text: "Devin runs in a project only once you have trusted it in an interactive session",
    },
  ],
  sources: [
    "https://docs.devin.ai/cli/extensibility/mcp/configuration.md",
    "https://docs.devin.ai/cli/extensibility/skills/overview.md",
    "https://docs.devin.ai/cli/subagents.md",
    "https://docs.devin.ai/desktop/cascade.md",
    "https://docs.devin.ai/cli/extensibility/hooks/overview.md",
  ],
});
