import { defineHarness, type LocCtx, unsupported } from "../harness/define";
import { dialect, proseSkillRef, proseToolRef } from "../harness/dialect";
import { configRootExists, xdgConfig } from "../harness/locations";
import { mcpConfig, stdioEntry } from "../surfaces/mcp";
import { CLAUDE_SKILLS, sharedSkills } from "../surfaces/shared";
import { jsonOrJsonc } from "./opencode";

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
      entry: stdioEntry(),
    }),
  },
  sources: [
    "https://ampcode.com/docs/markdown/customize/mcp",
    "https://ampcode.com/docs/markdown/cli/settings",
    "https://ampcode.com/docs/markdown/customize/skills",
  ],
});
