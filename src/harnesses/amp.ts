import { defineHarness, type LocCtx, unsupported } from "../harness/define.js";
import { dialect, proseSkillRef, proseToolRef } from "../harness/dialect.js";
import { configRootExists, xdgConfig } from "../harness/locations.js";
import { httpEntry, mcpConfig, stdioEntry } from "../surfaces/mcp.js";
import { CLAUDE_SKILLS, sharedSkills } from "../surfaces/shared.js";
import { jsonOrJsonc } from "./opencode.js";

const home = xdgConfig("amp");

export const amp = defineHarness({
  id: "amp",
  label: "Amp",
  configRoot: { user: home, local: ".amp" },
  detect: configRootExists(home),
  dialect: dialect({ toolRef: proseToolRef, skillRef: proseSkillRef }),
  kinds: {
    skill: sharedSkills({ alsoReads: [CLAUDE_SKILLS] }),
    agent: unsupported("Amp has no user-defined subagents"),
    command: unsupported("Amp has no command files; ship it as a skill"),
    mcpServer: mcpConfig({
      file: {
        user: ({ configRoot }: LocCtx) => jsonOrJsonc(configRoot, "settings"),
        local: ({ configRoot }: LocCtx) => jsonOrJsonc(configRoot, "settings"),
      },
      format: "jsonc",
      // One flat key with a dot in its name, not a nested object.
      keyPath: ["amp.mcpServers"],
      stdio: stdioEntry(),
      http: httpEntry({}, { envRef: (name) => `\${${name}}` }),
    }),
    hook: unsupported("Amp hooks are code plugins, not commands"),
  },
  sources: [
    "https://ampcode.com/docs/markdown/customize/mcp",
    "https://ampcode.com/docs/markdown/cli/settings",
    "https://ampcode.com/docs/markdown/customize/skills",
  ],
});
