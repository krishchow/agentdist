import { join } from "node:path";
import { defineHarness, type LocCtx, unsupported } from "../harness/define";
import { dialect, proseToolRef } from "../harness/dialect";
import { configRootExists, dotHome, inConfig, inProject } from "../harness/locations";
import { markdownCommands } from "../surfaces/commands";
import { mcpConfig, stdioEntry } from "../surfaces/mcp";
import { CLAUDE_SKILLS } from "../surfaces/shared";
import { skillsDir } from "../surfaces/skills";

const home = dotHome(".cline", "CLINE_DIR");

export const cline = defineHarness({
  id: "cline",
  label: "Cline",
  configRoot: { user: home, local: ".cline" },
  detect: configRootExists(home),
  dialect: dialect({ toolRef: proseToolRef }),
  kinds: {
    // A project's .agents/skills is read; the docs do not confirm ~/.agents/skills, so a user
    // install uses Cline's own directory.
    skill: skillsDir(
      { user: inConfig("skills"), local: inProject(".agents", "skills") },
      { alsoReads: [{ local: CLAUDE_SKILLS.local }] },
    ),
    agent: unsupported("Cline does not document a subagent file format"),
    // Workflows.
    command: markdownCommands(
      { user: inConfig("workflows"), local: inConfig("workflows") },
      { frontmatter: () => ({}) },
    ),
    // Cline has no project-level MCP file.
    mcpServer: mcpConfig({
      file: {
        user: ({ env, configRoot }: LocCtx) =>
          env.vars.CLINE_MCP_SETTINGS_PATH || join(configRoot, "data", "settings", "cline_mcp_settings.json"),
      },
      format: "json",
      keyPath: ["mcpServers"],
      entry: stdioEntry(),
    }),
  },
  sources: [
    "https://docs.cline.bot/mcp/mcp-overview.md",
    "https://docs.cline.bot/customization/skills.md",
    "https://docs.cline.bot/getting-started/config.md",
  ],
});
