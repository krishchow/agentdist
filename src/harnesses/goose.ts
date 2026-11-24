import { defineHarness, unsupported } from "../harness/define";
import { dialect, proseToolRef } from "../harness/dialect";
import { configRootExists, inConfig, xdgConfig } from "../harness/locations";
import { compactEntry, mcpConfig } from "../surfaces/mcp";
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
    command: unsupported("Goose slash commands point at recipes, which a package cannot express yet"),
    // An MCP server is an "extension", configured for the user only.
    mcpServer: mcpConfig({
      file: { user: inConfig("config.yaml") },
      format: "yaml",
      keyPath: ["extensions"],
      entry: (server) =>
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
    }),
  },
  sources: [
    "https://goose-docs.ai/docs/guides/config-files.md",
    "https://goose-docs.ai/docs/guides/context-engineering/using-skills.md",
  ],
});
