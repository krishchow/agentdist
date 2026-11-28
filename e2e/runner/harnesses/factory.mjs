import { join } from "node:path";
import { ALL_EVENTS, MOCK_LLM, writeFile } from "../lib.mjs";

const exec = (prompt) => [
  "droid",
  "exec",
  "--model",
  "custom:probe-model",
  "--skip-permissions-unsafe",
  prompt,
];

export const factory = {
  id: "factory",
  version: ["droid", "--version"],
  mock: "llm",
  // The same file agentdist registers hooks in, so the install has to keep this.
  setup(cell) {
    writeFile(
      join(cell.home, ".factory", "settings.json"),
      `${JSON.stringify(
        {
          customModels: [
            {
              model: "probe-model",
              displayName: "Probe",
              baseUrl: MOCK_LLM,
              apiKey: "probe",
              provider: "anthropic",
              maxOutputTokens: 1024,
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
  },
  async introspect(_cell, ctx) {
    await ctx.run(["droid", "mcp", "list"]);
  },
  session: (_cell, prompt) => exec(prompt),
  listed: ["skill", "agent", "mcpServer"],
  // MCP tools are deferred: only `<server>___<tool>` names reach the model.
  markers: { "mcpServer:probe": "stdio_listed", "mcpServer:probe-remote": "http_listed" },
  // A guard process outlives the session for a few seconds.
  leftovers: "droid-mcp-guard",
  hookEvents: ALL_EVENTS,
};
