import { MOCK_LLM } from "../lib.mjs";

/** OpenCode and Kilo (its fork) take a provider the same way, through an extra config merged last. */
export function openaiCompatible() {
  return JSON.stringify({
    provider: {
      probe: {
        npm: "@ai-sdk/openai-compatible",
        name: "Probe",
        options: { baseURL: `${MOCK_LLM}/v1`, apiKey: "probe" },
        models: { "probe-model": { name: "Probe Model", tool_call: true } },
      },
    },
    model: "probe/probe-model",
  });
}

/** The `name` of every entry in a JSON array a debug command printed. */
export function jsonNames(output, key) {
  try {
    const parsed = JSON.parse(output);
    return (key ? Object.keys(parsed[key] ?? {}) : parsed.map((s) => s.name)).filter(Boolean);
  } catch {
    return [];
  }
}

export const opencode = {
  id: "opencode",
  version: ["opencode", "--version"],
  mock: "llm",
  // Kept out of the config files under test, so the install edits only what a user would have.
  env: () => ({ OPENCODE_CONFIG_CONTENT: openaiCompatible() }),
  async introspect(_cell, ctx) {
    const skills = await ctx.run(["opencode", "debug", "skill"]);
    ctx.scanNameList(jsonNames(skills.stdout), ["skill"], "opencode debug skill");
    const agents = await ctx.run(["opencode", "agent", "list"]);
    ctx.scanNames(agents.stdout, ["agent"], "opencode agent list");
    const config = await ctx.run(["opencode", "debug", "config"]);
    ctx.scanNameList(jsonNames(config.stdout, "command"), ["command"], "opencode debug config");
    await ctx.run(["opencode", "mcp", "list"]);
  },
  session: (_cell, prompt) => ["opencode", "run", "-m", "probe/probe-model", prompt],
  command: (_cell, name, arg) => ["opencode", "run", "-m", "probe/probe-model", "--command", name, arg],
  listed: ["skill", "agent", "mcpServer"],
  toolCall: false,
  hookEvents: [],
};
