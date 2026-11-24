import { defineHarness } from "../harness/define";
import { dialect, noToolGrants, proseToolRef } from "../harness/dialect";
import { configRootExists, inConfig, xdgConfig } from "../harness/locations";
import { markdownAgents } from "../surfaces/agents";
import { markdownCommands } from "../surfaces/commands";
import { mcpConfig, stdioEntry } from "../surfaces/mcp";
import { AGENTS_SKILLS, CLAUDE_SKILLS } from "../surfaces/shared";
import { skillsDir } from "../surfaces/skills";

const home = xdgConfig("devin");

/** Devin CLI and Devin Local in Devin Desktop, which is what Windsurf became. */
export const devin = defineHarness({
  id: "devin",
  label: "Devin (Windsurf)",
  configRoot: { user: home, local: ".devin" },
  detect: configRootExists(home),
  dialect: dialect({ toolRef: proseToolRef, ...noToolGrants }),
  kinds: {
    // .claude/skills is imported for projects only.
    skill: skillsDir(AGENTS_SKILLS, { alsoReads: [{ local: CLAUDE_SKILLS.local }] }),
    agent: markdownAgents(
      { user: inConfig("agents"), local: inConfig("agents") },
      { folderFile: "AGENT.md" },
    ),
    // Workflows have no documented user-level directory under the Devin config home.
    command: markdownCommands({ local: inConfig("workflows") }),
    mcpServer: mcpConfig({
      file: { user: inConfig("mcp_config.json"), local: inConfig("mcp_config.json") },
      format: "json",
      keyPath: ["mcpServers"],
      entry: stdioEntry(),
    }),
  },
  sources: [
    "https://docs.devin.ai/cli/extensibility/mcp/configuration.md",
    "https://docs.devin.ai/cli/extensibility/skills/overview.md",
    "https://docs.devin.ai/cli/subagents.md",
    "https://docs.devin.ai/desktop/cascade.md",
  ],
});
