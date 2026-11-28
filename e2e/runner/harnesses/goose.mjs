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
    ctx.scanNames(skills.stdout, ["skill"], "goose skills list");
  },
  session: (_cell, prompt) => ["goose", "run", "--no-session", "-q", "-t", prompt],
  listed: ["skill", "mcpServer"],
  hookEvents: ALL_EVENTS,
};
