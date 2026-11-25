import type { HarnessDef } from "../harness/define.js";
import { amp } from "./amp.js";
import { claude } from "./claude.js";
import { cline } from "./cline.js";
import { codex } from "./codex.js";
import { copilot } from "./copilot.js";
import { cursor } from "./cursor.js";
import { devin } from "./devin.js";
import { factory } from "./factory.js";
import { gemini } from "./gemini.js";
import { goose } from "./goose.js";
import { kilo } from "./kilo.js";
import { opencode } from "./opencode.js";
import { pi } from "./pi.js";
import { qwen } from "./qwen.js";
import { zed } from "./zed.js";

/** Every harness the engine can install into, in the order prompts list them. */
export const HARNESSES: HarnessDef[] = [
  claude,
  codex,
  cursor,
  copilot,
  gemini,
  opencode,
  factory,
  devin,
  cline,
  kilo,
  qwen,
  amp,
  pi,
  goose,
  zed,
];

export function findHarness(id: string, harnesses: HarnessDef[] = HARNESSES): HarnessDef | undefined {
  return harnesses.find((h) => h.id === id);
}
