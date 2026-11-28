#!/usr/bin/env node
// Records that a harness ran a hook: the event it was registered for, and what arrived on stdin.
// Prints nothing and exits 0, so it never changes what the harness does next.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.PROBE_DIR ?? "/tmp/probe";
const event = process.argv[2] ?? "(none)";

function write(stdin) {
  let input = stdin;
  try {
    input = JSON.parse(stdin);
  } catch {}
  mkdirSync(dir, { recursive: true });
  appendFileSync(
    join(dir, "hooks.jsonl"),
    `${JSON.stringify({ at: new Date().toISOString(), event, cwd: process.cwd(), input })}\n`,
  );
  process.exit(0);
}

// Some harnesses keep stdin open; do not wait on it for long.
const chunks = [];
const timer = setTimeout(() => write(Buffer.concat(chunks).toString("utf8")), 2000);
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  clearTimeout(timer);
  write(Buffer.concat(chunks).toString("utf8"));
});
process.stdin.on("error", () => write(""));
