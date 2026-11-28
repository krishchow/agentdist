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
    // A command is a skill.
    ctx.scanNames(skills.stdout, ["skill", "command"], "goose skills list");
  },
  session: (_cell, prompt) => ["goose", "run", "--no-session", "-q", "-t", prompt],
  // A command is a skill. `/skills` only lists them; the model loads one with load_skill, which
  // the mock does not call, so the skill being offered to the model is the evidence.
  command: null,
  listed: ["skill", "command", "mcpServer"],
  hookEvents: ALL_EVENTS,
};
