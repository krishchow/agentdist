import { defineHarness, type LocCtx } from "../harness/define";
import { dialect, noToolGrants } from "../harness/dialect";
import { configRootExists, inConfig, xdgConfig } from "../harness/locations";
import { markdownAgents } from "../surfaces/agents";
import { markdownCommands } from "../surfaces/commands";
import { mcpConfig } from "../surfaces/mcp";
import { AGENTS_SKILLS } from "../surfaces/shared";
import { skillsDir } from "../surfaces/skills";
import { jsonOrJsonc, opencodeEntry } from "./opencode";

const home = xdgConfig("kilo", "KILO_CONFIG_DIR");

/** Kilo Code is an OpenCode fork that still uses the older config dialect, with servers under `mcp`. */
export const kilo = defineHarness({
  id: "kilo",
  label: "Kilo Code",
  configRoot: { user: home, local: ".kilo" },
  detect: configRootExists(home),
  dialect: dialect({ toolRef: (server, tool) => `${server}_${tool}`, ...noToolGrants }),
  kinds: {
    skill: skillsDir(AGENTS_SKILLS),
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
      entry: opencodeEntry({ enabled: true }),
    }),
  },
  sources: [
    "https://kilo.ai/docs/automate/mcp/using-in-kilo-code",
    "https://kilo.ai/docs/customize/skills",
    "https://kilo.ai/docs/customize/custom-subagents",
    "https://kilo.ai/docs/customize/workflows",
  ],
});
