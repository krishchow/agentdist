import type { ScopedLoc } from "../harness/define";
import { inHome, inProject } from "../harness/locations";

/**
 * The cross-harness Agent Skills directory. Harnesses that read it share one copy of each skill:
 * the planner sees the same destination from each of them and writes it once.
 */
export const AGENTS_SKILLS: ScopedLoc = {
  user: inHome(".agents", "skills"),
  local: inProject(".agents", "skills"),
};

/**
 * Claude Code's skills directory, which several other harnesses also read for compatibility. It is
 * never a harness's first choice other than Claude Code's own, only an `alsoReads` entry.
 */
export const CLAUDE_SKILLS: ScopedLoc = {
  user: inHome(".claude", "skills"),
  local: inProject(".claude", "skills"),
};
