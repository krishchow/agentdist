import { defineHarness, unsupported } from "../harness/define";
import { dialect, proseToolRef } from "../harness/dialect";
import { configRootExists, inConfig, inHome, inProject, xdgConfig } from "../harness/locations";
import { commandsAsSkills } from "../surfaces/commands";
import { anchored, claudeStyleHook, hooksDir } from "../surfaces/hooks";
import { compactEntry, headerEnv, mcpConfig } from "../surfaces/mcp";
import { CLAUDE_SKILLS, sharedSkills } from "../surfaces/shared";

const home = xdgConfig("goose");

export const goose = defineHarness({
  id: "goose",
  label: "Goose",
  configRoot: { user: home, local: ".goose" },
  detect: configRootExists(home),
  dialect: dialect({ toolRef: proseToolRef, skillRef: (name) => `/skills ${name}` }),
  kinds: {
    skill: sharedSkills({ alsoReads: [CLAUDE_SKILLS] }),
    agent: unsupported("Goose runs subagents from recipes, not agent definition files"),
    // Goose's own slash commands point at recipes; a skill is invoked with `/skills <name>`.
    command: commandsAsSkills(sharedSkills({ alsoReads: [CLAUDE_SKILLS] })),
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
  sources: [
    "https://goose-docs.ai/docs/guides/config-files.md",
    "https://goose-docs.ai/docs/guides/context-engineering/using-skills.md",
    "https://goose-docs.ai/docs/guides/context-engineering/hooks.md",
  ],
});
