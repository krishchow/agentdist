import { defineHarness } from "../harness/define.js";
import { dialect, proseToolRef } from "../harness/dialect.js";
import { configRootExists, dotHome, inConfig } from "../harness/locations.js";
import { HOOK_EVENTS } from "../schema/manifest.js";
import { markdownAgents } from "../surfaces/agents.js";
import { markdownCommands } from "../surfaces/commands.js";
import { claudeStyleHook, hooksConfig } from "../surfaces/hooks.js";
import { httpEntry, mcpConfig, stdioEntry } from "../surfaces/mcp.js";
import { sharedSkills } from "../surfaces/shared.js";

const home = dotHome(".factory");

export const factory = defineHarness({
  id: "factory",
  label: "Factory Droid",
  configRoot: { user: home, local: ".factory" },
  detect: configRootExists(home),
  dialect: dialect({
    toolRef: proseToolRef,
    tools: {
      Read: "Read",
      Write: "Create",
      Edit: "Edit",
      Bash: "Execute",
      Glob: "Glob",
      Grep: "Grep",
      WebFetch: "FetchUrl",
      WebSearch: "WebSearch",
      // Not available to a droid, and always included, respectively: neither is listed.
      Task: null,
      TodoWrite: null,
      NotebookEdit: null,
    },
    // A droid is given whole MCP servers through its own `mcpServers` field, not single tools.
    mcpGrant: () => null,
  }),
  kinds: {
    skill: sharedSkills(),
    // Same markdown subagents as everyone else; Factory calls them droids.
    agent: markdownAgents({ user: inConfig("droids"), local: inConfig("droids") }, { tools: "list" }),
    command: markdownCommands({ user: inConfig("commands"), local: inConfig("commands") }),
    mcpServer: mcpConfig({
      file: { user: inConfig("mcp.json"), local: inConfig("mcp.json") },
      format: "json",
      keyPath: ["mcpServers"],
      stdio: stdioEntry({ type: "stdio" }),
      // An unset variable fails the connection with an error that names it.
      http: httpEntry({ type: "http" }, { envRef: (name) => `\${${name}}` }),
    }),
    // In settings.json rather than hooks.json: an event in hooks.json replaces the same event in
    // settings.json, so writing there would silently switch off hooks the user already has.
    hook: hooksConfig({
      file: { user: inConfig("settings.json"), local: inConfig("settings.json") },
      format: "json",
      events: Object.fromEntries(HOOK_EVENTS.map((event) => [event, event])),
      projectDir: "$FACTORY_PROJECT_DIR",
      keyPath: (hook) => ["hooks", hook.event],
      item: claudeStyleHook,
    }),
  },
  sources: [
    "https://docs.factory.com/harness/mcp.md",
    "https://docs.factory.com/harness/skills.md",
    "https://docs.factory.com/harness/subagents.md",
    "https://docs.factory.com/harness/custom-slash-commands.md",
    "https://docs.factory.com/harness/hooks.md",
  ],
});
