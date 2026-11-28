import { defineHarness, type LocCtx, unsupported } from "../harness/define";
import { dialect, proseSkillRef, proseToolRef } from "../harness/dialect";
import { configRootExists, xdgConfig } from "../harness/locations";
import { commandsAsSkills } from "../surfaces/commands";
import { httpEntry, mcpConfig, stdioEntry } from "../surfaces/mcp";
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
    // Amp has no command files; a skill is its slash command.
    command: commandsAsSkills(sharedSkills({ alsoReads: [CLAUDE_SKILLS] })),
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
  notes: [
    {
      kinds: ["mcpServer"],
      scope: "local",
      text: "Amp starts a project's MCP servers only once you approve each one (`amp mcp approve <name>`)",
    },
  ],
  sources: [
    "https://ampcode.com/docs/markdown/customize/mcp",
    "https://ampcode.com/docs/markdown/cli/settings",
    "https://ampcode.com/docs/markdown/customize/skills",
  ],
});
