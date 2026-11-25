import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env } from "../src/harness/define.js";
import { loadPackage } from "../src/ir/load.js";

export const FIXTURE = join(__dirname, "fixtures", "demo");
export const demo = () => loadPackage(FIXTURE);

/** A throwaway home and repository, so no test can reach the real ones. */
export function sandbox(vars: Record<string, string> = {}): Env {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "agentdist-")));
  const home = join(root, "home");
  const projectRoot = join(root, "repo");
  mkdirSync(home, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  return { home, projectRoot, vars, platform: "darwin" };
}

export const read = (...parts: string[]) => readFileSync(join(...parts), "utf8");
