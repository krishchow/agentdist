import { basename, join } from "node:path";
import { MOCK_LLM, writeFile } from "../lib.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const zed = {
  id: "zed",
  version: ["zed", "--version"],
  mock: "llm",
  env: () => ({
    OPENAI_API_KEY: "probe",
    ZED_ALLOW_ROOT: "true",
    ZED_ALLOW_EMULATED_GPU: "1",
    DISPLAY: process.env.DISPLAY ?? ":99",
  }),
  needsDisplay: true,
  setup(cell) {
    writeFile(
      join(cell.home, ".config", "zed", "settings.json"),
      `// The probe model, written by the e2e runner before agentdist installs.\n${JSON.stringify(
        {
          session: { trust_all_worktrees: true },
          language_models: {
            openai: {
              api_url: `${MOCK_LLM}/v1`,
              available_models: [{ name: "probe-model", display_name: "Probe", max_tokens: 8000 }],
            },
          },
          agent: { default_model: { provider: "openai", model: "probe-model" } },
        },
        null,
        2,
      )}\n`,
    );
  },
  /**
   * Zed is an editor with no headless agent: open it on the repository under Xvfb, put the prompt
   * in the agent panel through its URL scheme, and press Return.
   */
  async drive(cell, ctx, prompt) {
    const editor = ctx.spawn(["zed", "--foreground", cell.repo]);
    // Every cell's repository has its own name, so its window cannot be another cell's.
    const title = basename(cell.repo);
    const findWindow = async () =>
      (await ctx.run(["xdotool", "search", "--name", title], { timeoutMs: 10_000 })).stdout
        .trim()
        .split("\n")[0];
    try {
      let window = "";
      for (let i = 0; i < 60 && !window; i++) {
        window = await findWindow();
        if (!window) await sleep(500);
      }
      // The window appears before the workspace is ready to take a prompt.
      await sleep(5_000);
      await ctx.run(["zed", `zed://agent?prompt=${encodeURIComponent(prompt)}`], { timeoutMs: 15_000 });
      await sleep(3_000);
      // Focus, not activate: Xvfb has no window manager to activate a window with.
      if (window) {
        await ctx.run(["xdotool", "windowfocus", "--sync", window], { timeoutMs: 15_000 });
        await ctx.run(["xdotool", "key", "--window", window, "Return"], { timeoutMs: 15_000 });
      }
      await ctx.waitForModel(30_000);
    } finally {
      editor.kill();
    }
  },
  listed: ["skill", "mcpServer"],
  toolCall: false,
  hookEvents: [],
  leftovers: "zed-editor",
};
