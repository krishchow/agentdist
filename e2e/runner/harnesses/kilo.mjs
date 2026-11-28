import { jsonNames, openaiCompatible } from "./opencode.mjs";

export const kilo = {
  id: "kilo",
  version: ["kilo", "--version"],
  mock: "llm",
  env: () => ({ KILO_CONFIG_CONTENT: openaiCompatible() }),
  async introspect(_cell, ctx) {
    const skills = await ctx.run(["kilo", "debug", "skill"]);
    ctx.scanNameList(jsonNames(skills.stdout), ["skill"], "kilo debug skill");
    const agents = await ctx.run(["kilo", "agent", "list"]);
    ctx.scanNames(agents.stdout, ["agent"], "kilo agent list");
    const config = await ctx.run(["kilo", "debug", "config"]);
    ctx.scanNameList(jsonNames(config.stdout, "command"), ["command"], "kilo debug config");
    await ctx.run(["kilo", "mcp", "list"]);
  },
  session: (_cell, prompt) => ["kilo", "run", "-m", "probe/probe-model", prompt],
  command: (_cell, name, arg) => ["kilo", "run", "-m", "probe/probe-model", "--command", name, arg],
  listed: ["skill", "agent", "mcpServer"],
  toolCall: false,
  hookEvents: [],
};
