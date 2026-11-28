import { join } from "node:path";
import { MOCK_LLM, writeFile } from "../lib.mjs";

const flags = ["--no-session", "--offline", "--provider", "probe", "--model", "probe-model"];

export const pi = {
  id: "pi",
  version: ["pi", "--version"],
  mock: "llm",
  setup(cell) {
    writeFile(
      join(cell.home, ".pi", "agent", "models.json"),
      JSON.stringify({
        providers: {
          probe: {
            baseUrl: `${MOCK_LLM}/v1`,
            api: "openai-completions",
            apiKey: "probe",
            models: [{ id: "probe-model" }],
          },
        },
      }),
    );
  },
  // Every project resource, skills included, loads only in a trusted project.
  async consent(cell, ctx) {
    if (cell.scope !== "local") return;
    writeFile(join(cell.home, ".pi", "agent", "trust.json"), JSON.stringify({ [cell.repo]: true }));
    ctx.note("trusted the project in ~/.pi/agent/trust.json");
  },
  async introspect(_cell, ctx) {
    const commands = await ctx.run(["pi", "--mode", "rpc", ...flags], {
      input: '{"type":"get_commands"}\n',
      timeoutMs: 15_000,
    });
    // Skills are listed as `skill:<name>`, prompt templates by name.
    const names = commands.stdout
      .split("\n")
      .flatMap((line) => {
        try {
          return JSON.parse(line).data?.commands ?? [];
        } catch {
          return [];
        }
      })
      .map((c) => c.name.replace(/^skill:/, ""));
    ctx.scanNameList(names, ["skill", "command"], "pi rpc get_commands");
    await ctx.run(["pi", "mcp", "list", "--json"]);
  },
  session: (_cell, prompt) => ["pi", "-p", ...flags, prompt],
  // MCP servers are exposed through one code tool; only their names reach the model, and a
  // server's tools are listed only when the model uses that tool.
  listed: ["skill"],
  mcpHandshake: "initialize",
  toolCall: false,
  hookEvents: [],
};
