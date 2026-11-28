#!/usr/bin/env node
// Records that a skill's bundled script ran, from wherever the skill was installed.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.PROBE_DIR ?? "/tmp/probe";
mkdirSync(dir, { recursive: true });
appendFileSync(
  join(dir, "skill.jsonl"),
  `${JSON.stringify({ at: new Date().toISOString(), script: import.meta.url })}\n`,
);
console.log("PROBE_SKILL_SCRIPT_RAN");
