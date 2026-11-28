import { join } from "node:path";
import { defineHarness, type Env, unsupported } from "../harness/define";
import { dialect } from "../harness/dialect";
import { configRootExists, inConfig, inProject } from "../harness/locations";
import { markdownCommands } from "../surfaces/commands";
import { httpEntry, mcpConfig, stdioEntry } from "../surfaces/mcp";
import { sharedSkills } from "../surfaces/shared";

const home = (env: Env) => env.vars.PI_CODING_AGENT_DIR || join(env.home, ".pi", "agent");

export const pi = defineHarness({
  id: "pi",
  label: "pi",
  // The user directory is ~/.pi/agent, but a project's is plain .pi.
  configRoot: { user: home, local: ".pi" },
  detect: configRootExists(home),
  dialect: dialect({ skillRef: (name) => `/skill:${name}` }),
  kinds: {
    skill: sharedSkills(),
    agent: unsupported("pi has no subagent definitions"),
    // Prompt templates.
    command: markdownCommands(
      { user: inConfig("prompts"), local: inConfig("prompts") },
      { frontmatter: ({ description }) => ({ description }) },
    ),
    mcpServer: mcpConfig({
      // The project file is read only once the user has trusted the project.
      file: { user: inConfig("mcp.json"), local: inProject(".pi", "mcp.json") },
      format: "json",
      keyPath: ["mcpServers"],
      stdio: stdioEntry({}, { toolTimeout: { field: "timeout", unit: "s" } }),
      http: httpEntry(
        { type: "http" },
        { envRef: (name) => `\${${name}}`, toolTimeout: { field: "timeout", unit: "s" } },
      ),
    }),
    hook: unsupported("pi hooks are TypeScript extensions, not commands"),
  },
  notes: [
    {
      scope: "local",
      text: "pi loads a project's skills, prompts and MCP servers only once you trust the project",
    },
  ],
  sources: [
    "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md",
    "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md",
    "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/prompt-templates.md",
  ],
});
