import { join } from "node:path";
import { ALL_EVENTS, MOCK_LLM, writeFile } from "../lib.mjs";

const settings = (folderTrust) => ({
  // Otherwise subagents and MCP tools are deferred and their descriptions are not sent.
  tools: { toolSearch: { enabled: false } },
  ...(folderTrust ? { security: { folderTrust: { enabled: true } } } : {}),
});

export const qwen = {
  id: "qwen",
  version: ["qwen", "--version"],
  mock: "llm",
  env: () => ({
    OPENAI_API_KEY: "probe",
    OPENAI_BASE_URL: `${MOCK_LLM}/v1`,
    OPENAI_MODEL: "probe-model",
    QWEN_CODE_SUPPRESS_YOLO_WARNING: "1",
  }),
  setup(cell) {
    writeFile(join(cell.home, ".qwen", "settings.json"), `${JSON.stringify(settings(false), null, 2)}\n`);
  },
  // Project hooks run only in a folder the user trusted, which needs folder trust turned on. It
  // stays off at user scope: an untrusted folder also loses yolo mode and every MCP server.
  async consent(cell, ctx) {
    if (cell.scope !== "local") return;
    writeFile(join(cell.home, ".qwen", "settings.json"), `${JSON.stringify(settings(true), null, 2)}\n`);
    writeFile(
      join(cell.home, ".qwen", "trustedFolders.json"),
      JSON.stringify({ [cell.repo]: "TRUST_FOLDER" }),
    );
    ctx.note("turned on folder trust and trusted the project in ~/.qwen/trustedFolders.json", ["hook"]);
  },
  async introspect(_cell, ctx) {
    await ctx.run(["qwen", "mcp", "list"]);
  },
  session: (_cell, prompt) => ["qwen", "--auth-type", "openai", "-y", prompt],
  listed: ["skill", "agent", "command", "mcpServer"],
  // SessionEnd fires from the interactive UI, /clear and ACP shutdown, never in a headless run.
  hookEvents: ALL_EVENTS.filter((e) => e !== "SessionEnd"),
};
