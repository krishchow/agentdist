import { defineHarness, unsupported } from "../harness/define";
import { dialect } from "../harness/dialect";
import { configRootExists, inConfig, xdgConfig } from "../harness/locations";
import { mcpConfig, stdioEntry } from "../surfaces/mcp";
import { AGENTS_SKILLS } from "../surfaces/shared";
import { skillsDir } from "../surfaces/skills";

const home = xdgConfig("zed");

export const zed = defineHarness({
  id: "zed",
  label: "Zed",
  configRoot: { user: home, local: ".zed" },
  detect: configRootExists(home),
  dialect: dialect({ toolRef: (server, tool) => `mcp:${server}:${tool}` }),
  kinds: {
    skill: skillsDir(AGENTS_SKILLS),
    agent: unsupported("Zed has no subagent definition files"),
    command: unsupported("Zed has no command files; a skill is its slash command"),
    mcpServer: mcpConfig({
      // Zed does not document whether project settings may declare context servers, so only the
      // user's settings are written.
      file: { user: inConfig("settings.json") },
      format: "jsonc",
      keyPath: ["context_servers"],
      entry: stdioEntry(),
    }),
  },
  sources: [
    "https://github.com/zed-industries/zed/blob/main/docs/src/ai/mcp.md",
    "https://github.com/zed-industries/zed/blob/main/docs/src/ai/skills.md",
  ],
});
