import { MOCK_LLM } from "../lib.mjs";

export const cline = {
  id: "cline",
  version: ["cline", "--version"],
  mock: "llm",
  async setup(_cell, ctx) {
    await ctx.run([
      "cline",
      "auth",
      "-p",
      "openai",
      "-k",
      "probe",
      "-b",
      `${MOCK_LLM}/v1`,
      "-m",
      "probe-model",
    ]);
  },
  async introspect(_cell, ctx) {
    const config = await ctx.run(["cline", "config", "--json"]);
    let parsed = {};
    try {
      parsed = JSON.parse(config.stdout);
    } catch {}
    const names = (list) => (list ?? []).map((i) => i.name ?? i.id).filter(Boolean);
    ctx.scanNameList(names(parsed.skills), ["skill"], "cline config --json (skills)");
    ctx.scanNameList(names(parsed.workflows), ["command"], "cline config --json (workflows)");
  },
  // A one-word prompt is rejected as an unknown command. In act mode a text answer ends the run.
  session: (_cell, prompt) => ["cline", "--json", "--act", prompt],
  // Skills are named, without descriptions, in the `skills` tool.
  markers: { "skill:beacon": "probe-beacon" },
  listed: ["skill", "mcpServer"],
  toolCall: false,
  hookEvents: [],
  // The hub daemon runs in a session of its own and outlives every command.
  leftovers: "cline-hub-daemon",
};
