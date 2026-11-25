import { defineHarness, type LocCtx, unsupported } from "../harness/define.js";
import { dialect, noToolGrants } from "../harness/dialect.js";
import { configRootExists, inConfig, xdgConfig } from "../harness/locations.js";
import { markdownAgents } from "../surfaces/agents.js";
import { markdownCommands } from "../surfaces/commands.js";
import { headerEnv, mcpConfig } from "../surfaces/mcp.js";
import { sharedSkills } from "../surfaces/shared.js";
import { jsonOrJsonc, opencodeEntry, opencodeHttpEntry } from "./opencode.js";

const home = xdgConfig("kilo", "KILO_CONFIG_DIR");

/** Kilo Code is an OpenCode fork that still uses the older config dialect, with servers under `mcp`. */
export const kilo = defineHarness({
  id: "kilo",
  label: "Kilo Code",
  configRoot: { user: home, local: ".kilo" },
  detect: configRootExists(home),
  dialect: dialect({ toolRef: (server, tool) => `${server}_${tool}`, ...noToolGrants }),
  kinds: {
    skill: sharedSkills(),
    agent: markdownAgents(
      { user: inConfig("agents"), local: inConfig("agents") },
      { frontmatter: ({ description }) => ({ description, mode: "subagent" }) },
    ),
    command: markdownCommands(
      { user: inConfig("commands"), local: inConfig("commands") },
      { frontmatter: ({ description }) => ({ description }) },
    ),
    mcpServer: mcpConfig({
      file: {
        user: ({ configRoot }: LocCtx) => jsonOrJsonc(configRoot, "kilo"),
        local: ({ env }: LocCtx) => jsonOrJsonc(env.projectRoot, "kilo"),
      },
      format: "jsonc",
      keyPath: ["mcp"],
      stdio: opencodeEntry({ enabled: true }),
      // A project's kilo.json may not reference the environment: Kilo ignores {env:…} there.
      http: (server, ctx) =>
        ctx.scope === "local" && headerEnv(server).length > 0
          ? {
              skip: "Kilo Code ignores environment references in a project's config; install it at user scope",
            }
          : opencodeHttpEntry({ enabled: true })(server, ctx),
    }),
    hook: unsupported("Kilo Code hooks are code plugins, not commands"),
  },
  sources: [
    "https://kilo.ai/docs/automate/mcp/using-in-kilo-code",
    "https://kilo.ai/docs/customize/skills",
    "https://kilo.ai/docs/customize/custom-subagents",
    "https://kilo.ai/docs/customize/workflows",
  ],
});
