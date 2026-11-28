import { ALL_EVENTS, MOCK_LLM } from "../lib.mjs";

export const goose = {
  id: "goose",
  version: ["goose", "--version"],
  mock: "llm",
  env: () => ({
    GOOSE_PROVIDER: "openai",
    GOOSE_MODEL: "probe-model",
    OPENAI_HOST: MOCK_LLM,
    GOOSE_MODE: "auto",
    GOOSE_DISABLE_KEYRING: "1",
  }),
  async introspect(_cell, ctx) {
    const skills = await ctx.run(["goose", "skills", "list"]);
    // A command is a skill, invoked as `/skills <name>`.
    ctx.scanNames(skills.stdout, ["skill", "command"], "goose skills list");
  },
  session: (_cell, prompt) => ["goose", "run", "--no-session", "-q", "-t", prompt],
  command: (cell, name, arg) => goose.session(cell, `/skills ${name} ${arg}`),
  listed: ["skill", "mcpServer"],
  hookEvents: ALL_EVENTS,
};
