import { defineHarness } from "../harness/define";
import { dialect, noToolGrants, proseSkillRef, proseToolRef } from "../harness/dialect";
import { configRootExists, inConfig, inHome, inProject, xdgConfig } from "../harness/locations";
import { markdownAgents } from "../surfaces/agents";
import { commandsAsSkills } from "../surfaces/commands";
import { anchored, claudeStyleHook, hooksDir } from "../surfaces/hooks";
import { compactEntry, headerEnv, mcpConfig } from "../surfaces/mcp";
import { sharedSkills } from "../surfaces/shared";

const home = xdgConfig("goose");

export const goose = defineHarness({
  id: "goose",
  label: "Goose",
  configRoot: { user: home, local: ".goose" },
  detect: configRootExists(home),
  // `/skills` only lists skills; the model loads one with its load_skill tool, so a skill is named.
  // A subagent's `tools` is accepted and ignored: it gets the same tools whatever the list says.
  dialect: dialect({ toolRef: proseToolRef, skillRef: proseSkillRef, ...noToolGrants }),
  kinds: {
    skill: sharedSkills(),
    // Subagents the model can delegate to. Goose reads seven directories, and when two have an
    // agent of the same name, .goose/agents wins at either scope, ~/.goose/agents even over its
    // config directory's agents (checked in the e2e image, 1.61.0). It reads `name`, `description`
    // and the body, and `model`, which it sends to the provider as written, so that is left out.
    agent: markdownAgents({ user: inHome(".goose", "agents"), local: inProject(".goose", "agents") }),
    // Goose's own slash commands point at recipes; a skill is invoked with `/skills <name>`.
    command: commandsAsSkills(sharedSkills()),
    // An MCP server is an "extension", configured for the user only.
    mcpServer: mcpConfig({
      file: { user: inConfig("config.yaml") },
      format: "yaml",
      keyPath: ["extensions"],
      stdio: (server) =>
        compactEntry({
          type: "stdio",
          name: server.name,
          enabled: true,
          cmd: server.command,
          args: server.args,
          envs: server.env,
          // Names of variables Goose reads from its own secret store or environment.
          env_keys: server.envPassthrough.length ? server.envPassthrough : undefined,
          timeout: server.toolTimeoutSec,
        }),
      // The docs do not say how a header refers to the environment, so a server that needs a
      // variable is skipped.
      http: (server, ctx) =>
        headerEnv(server).length > 0
          ? {
              skip: `${ctx.harness.label} does not document how a header reads the environment; add it by hand`,
            }
          : compactEntry({
              type: "streamable_http",
              name: server.name,
              enabled: true,
              uri: server.url,
              headers: server.headers,
              timeout: server.toolTimeoutSec,
            }),
    }),
    // A hook lives in a plugin directory; each one gets a directory of its own, which needs no manifest.
    hook: hooksDir({
      dir: { user: inHome(".agents", "plugins"), local: inProject(".agents", "plugins") },
      events: {
        SessionStart: "SessionStart",
        SessionEnd: "SessionEnd",
        UserPromptSubmit: "UserPromptSubmit",
        PreToolUse: "PreToolUse",
        PostToolUse: "PostToolUse",
        Stop: "Stop",
      },
      tools: { Bash: "shell", Write: "write", Edit: "edit" },
      file: (hook) => ({
        name: `${hook.name}/hooks/hooks.json`,
        content: {
          hooks: {
            [hook.event]: [
              claudeStyleHook({ ...hook, tools: hook.tools ? [anchored(hook.tools)] : undefined }),
            ],
          },
        },
      }),
    }),
  },
  notes: [
    {
      kinds: ["agent"],
      scope: "user",
      text: "Goose prefers a project's subagents to yours, Claude Code's .claude/agents included, so in a project with this package installed for Claude Code it runs that copy",
    },
  ],
  sources: [
    "https://goose-docs.ai/docs/guides/config-files.md",
    "https://goose-docs.ai/docs/guides/context-engineering/using-skills.md",
    "https://goose-docs.ai/docs/guides/context-engineering/hooks.md",
  ],
});
