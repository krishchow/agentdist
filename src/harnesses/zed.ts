import { defineHarness, unsupported } from "../harness/define.js";
import { dialect } from "../harness/dialect.js";
import { configRootExists, inConfig, xdgConfig } from "../harness/locations.js";
import { httpEntry, mcpConfig, stdioEntry } from "../surfaces/mcp.js";
import { sharedSkills } from "../surfaces/shared.js";

const home = xdgConfig("zed");

export const zed = defineHarness({
  id: "zed",
  label: "Zed",
  configRoot: { user: home, local: ".zed" },
  detect: configRootExists(home),
  dialect: dialect({ toolRef: (server, tool) => `mcp:${server}:${tool}` }),
  kinds: {
    skill: sharedSkills(),
    agent: unsupported("Zed has no subagent definition files"),
    command: unsupported("Zed has no command files; a skill is its slash command"),
    mcpServer: mcpConfig({
      // Zed does not document whether project settings may declare context servers, so only the
      // user's settings are written.
      file: { user: inConfig("settings.json") },
      format: "jsonc",
      keyPath: ["context_servers"],
      stdio: stdioEntry(),
      // Header values are literal here, so a server that needs a variable is skipped.
      http: httpEntry(),
    }),
    hook: unsupported("Zed has no lifecycle hooks"),
  },
  sources: [
    "https://github.com/zed-industries/zed/blob/main/docs/src/ai/mcp.md",
    "https://github.com/zed-industries/zed/blob/main/docs/src/ai/skills.md",
  ],
});
