import type { HarnessDef } from "../harness/define";
import { amp } from "./amp";
import { claude } from "./claude";
import { cline } from "./cline";
import { codex } from "./codex";
import { copilot } from "./copilot";
import { cursor } from "./cursor";
import { devin } from "./devin";
import { factory } from "./factory";
import { gemini } from "./gemini";
import { goose } from "./goose";
import { kilo } from "./kilo";
import { opencode } from "./opencode";
import { pi } from "./pi";
import { qwen } from "./qwen";
import { zed } from "./zed";

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
