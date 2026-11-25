import { join } from "node:path";
import { byScope, defineHarness, type LocCtx, unsupported } from "../harness/define.js";
import { dialect, proseToolRef } from "../harness/dialect.js";
import { configRootExists, dotHome, inConfig } from "../harness/locations.js";
import { markdownCommands } from "../surfaces/commands.js";
import { httpEntry, mcpConfig, stdioEntry } from "../surfaces/mcp.js";
import { CLAUDE_SKILLS, sharedSkills } from "../surfaces/shared.js";
import { skillsDir } from "../surfaces/skills.js";

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
    skill: byScope({
      user: skillsDir({ user: inConfig("skills") }),
      local: sharedSkills({ alsoReads: [{ local: CLAUDE_SKILLS.local }] }),
    }),
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
      stdio: stdioEntry(),
      // Header values are literal here, so a server that needs a variable is skipped.
      http: httpEntry({ type: "streamableHttp" }),
    }),
    hook: unsupported("Cline hooks are one script per event with their own input and output contract"),
  },
  sources: [
    "https://docs.cline.bot/mcp/mcp-overview.md",
    "https://docs.cline.bot/customization/skills.md",
    "https://docs.cline.bot/getting-started/config.md",
  ],
});
