import { isAbsolute, join } from "node:path";
import type { Handler, ScopedLoc } from "../harness/define";
import { inHome, inProject } from "../harness/locations";
import { type SkillsDirOptions, skillsDir } from "./skills";

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

export interface SharedSkillsOptions extends Omit<SkillsDirOptions, "portable"> {
  /**
   * A variable that replaces the home directory for this harness, `.agents/skills` included, so
   * its user skills are under `$VAR/.agents/skills` when it is set (Gemini's GEMINI_CLI_HOME).
   */
  homeVar?: string;
}

/** Skills in the shared `.agents/skills` directory, for every harness that reads it. */
export function sharedSkills(options: SharedSkillsOptions = {}): Handler<"skill"> {
  const { homeVar, ...rest } = options;
  const dir: ScopedLoc = homeVar
    ? {
        ...AGENTS_SKILLS,
        user: (ctx) => {
          const home = ctx.env.vars[homeVar];
          return home && isAbsolute(home) ? join(home, ".agents", "skills") : AGENTS_SKILLS.user!(ctx);
        },
      }
    : AGENTS_SKILLS;
  return skillsDir(dir, { ...rest, portable: true });
}
