#!/usr/bin/env node
/**
 * The end-to-end runner: install the probe package into real harnesses and check, with each
 * harness's own behaviour as the evidence, that every artifact agentdist placed was picked up.
 *
 *   node run.mjs [--harness claude,codex] [--scope user,local] [--out <dir>] [--keep]
 *
 * For each harness and scope it makes a fresh home and repository (a cell), then:
 *   1. setup       the user's own config, such as a model provider pointed at the mock
 *   2. round trip  install, install again, uninstall: the second install changes nothing, and the
 *                  uninstall leaves the cell byte for byte as setup left it
 *   3. install     `agentdist install --json`; what it did not skip is what must load
 *   4. consent     what a user approves once: trusting a folder, approving a server
 *   5. introspect  the harness's own model-free commands (`mcp list`, `skills list`, ...)
 *   6. session     one headless session against the mock model, which records every request
 *   7. command     a second session that invokes `/probe-signal PROBEARG`
 * and reads the evidence: canaries in model requests, the MCP servers' and hooks' logs, and
 * names in introspection output. Every placed artifact ends up pass, fail, unverified (nothing in
 * this cell could tell), xfail (failed exactly as the adapter records as known) or xpass (a known
 * entry that is stale). Two checks belong to the cell rather than an artifact: the round trip, and
 * whether the installed skill names the MCP tool the way the harness names it to the model.
 *
 * Exit codes: 0 all good, 1 a check failed, 2 the runner itself broke. The report is rewritten
 * after every cell, so a run that breaks keeps what it finished.
 *
 * Runs inside the e2e image; see e2e/README.md.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ADAPTERS } from "./harnesses/index.mjs";
import {
  AGENTDIST,
  ALL_NODES,
  CANARIES,
  COMMAND_ARG,
  checkToolRef,
  Evidence,
  logMarks,
  logsBetween,
  makeCell,
  ownRecords,
  PROBE_DIR,
  PROBE_PACKAGE,
  run,
  scanCommand,
  scanHooks,
  scanMcp,
  scanModelRequests,
  scanNameList,
  scanNames,
  toolNames,
  verdict,
} from "./lib.mjs";

const SERVERS = fileURLToPath(new URL("../servers/", import.meta.url));
const PROMPT = "Say hello to the probe, then stop.";
const SCOPES = ["user", "local"];

// ---------------------------------------------------------------------------------------------
// Arguments

function parse(argv) {
  const opts = { harnesses: [], scopes: [], out: "/results", keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const list = () =>
      argv[++i]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    if (a === "--harness" || a === "-H") opts.harnesses.push(...list());
    else if (a === "--scope") opts.scopes.push(...list());
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--keep") opts.keep = true;
    else throw new Error(`unknown argument ${a}`);
  }
  const unknown = opts.harnesses.filter((h) => !ADAPTERS.some((a) => a.id === h));
  if (unknown.length) throw new Error(`unknown harness ${unknown.join(", ")}`);
  return {
    ...opts,
    adapters: opts.harnesses.length ? ADAPTERS.filter((a) => opts.harnesses.includes(a.id)) : ADAPTERS,
    scopes: opts.scopes.length ? opts.scopes : SCOPES,
  };
}

// ---------------------------------------------------------------------------------------------
// The probe servers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServers(needsDisplay) {
  rmSync(PROBE_DIR, { recursive: true, force: true });
  mkdirSync(PROBE_DIR, { recursive: true });
  const env = { ...process.env, PROBE_DIR };
  const children = [];
  const start = (cmd, args, opts) => {
    const child = spawn(cmd, args, opts);
    child.on("error", (error) => {
      throw new Error(`could not start ${cmd}: ${error.message}`);
    });
    children.push(child);
  };
  start("node", [join(SERVERS, "mock-llm.mjs")], { env, stdio: "ignore" });
  start("node", [join(SERVERS, "mcp-probe.mjs"), "--http"], { env, stdio: "ignore" });
  start("node", [join(SERVERS, "mock-rpc.mjs")], { env, stdio: "ignore" });
  if (needsDisplay) start("Xvfb", [":99", "-screen", "0", "1280x800x24"], { stdio: "ignore" });
  const ready = [
    ...[4010, 4020, 4030].map((port) => [
      `probe server on port ${port}`,
      () =>
        fetch(`http://127.0.0.1:${port}/`).then(
          () => true,
          () => false,
        ),
    ]),
    ...(needsDisplay ? [["Xvfb", async () => existsSync("/tmp/.X11-unix/X99")]] : []),
  ];
  for (const [what, check] of ready) {
    for (let i = 0; !(await check()); i++) {
      if (i > 50) throw new Error(`${what} did not start`);
      await sleep(100);
    }
  }
  return () => {
    for (const c of children) c.kill("SIGKILL");
  };
}

// ---------------------------------------------------------------------------------------------
// Snapshots, for the round trip

/** Every file under the cell's home and repository (not .git), with a hash of its content. */
function snapshot(cell, ignore = []) {
  const files = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.name === ".git" || ignore.includes(path)) continue;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile())
        files[relative(cell.dir, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  walk(cell.home);
  walk(cell.repo);
  return files;
}

function diff(before, after) {
  const changed = [];
  for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!(path in after)) changed.push(`${path} removed`);
    else if (!(path in before)) changed.push(`${path} left behind`);
    else if (before[path] !== after[path]) changed.push(`${path} changed`);
  }
  return changed.sort();
}

// ---------------------------------------------------------------------------------------------
// One cell

async function runCell(adapter, scope, opts) {
  // On the container's own disk unless kept: some harnesses put sockets in their home.
  const cell = makeCell(opts.keep ? join(opts.out, "cells") : "/tmp/e2e-cells", adapter.id, scope);
  cell.env = { ...cell.env, ...(adapter.env?.(cell) ?? {}) };
  const transcript = join(opts.out, `${adapter.id}-${scope}.log`);
  writeFileSync(transcript, `# ${adapter.id} at ${scope} scope\n# home ${cell.home}\n# repo ${cell.repo}\n`);
  const evidence = new Evidence();
  const result = {
    harness: adapter.id,
    scope,
    // Every approval the runner gave: { text, kinds }, kinds absent meaning the whole install.
    consent: (adapter.consentFlags ?? []).filter((c) => !c.scope || c.scope === scope),
    notes: [],
    warnings: [],
    errors: [],
    placed: [],
    skipped: {},
    checks: {},
  };

  const log = (text) => appendFileSync(transcript, text);
  const exec = async (argv, { timeoutMs = 60_000, input, label } = {}) => {
    const r = await run(argv[0], argv.slice(1), { cwd: cell.repo, env: cell.env, timeoutMs, input });
    const clip = (s) => (s.length > 20_000 ? `${s.slice(0, 20_000)}\n… (${s.length} chars)` : s);
    log(
      `\n$ ${label ?? argv.join(" ")}\n# exit ${r.code}${r.timedOut ? " (timed out)" : ""} in ${r.ms} ms\n` +
        `${clip(r.stdout)}${r.stderr ? `\n# stderr\n${clip(r.stderr)}` : ""}\n`,
    );
    return r;
  };
  const agentdist = async (command, label) => {
    const r = await exec(
      [
        "node",
        AGENTDIST,
        command,
        "--package",
        PROBE_PACKAGE,
        "--harness",
        adapter.id,
        `--${scope}`,
        "--yes",
        "--json",
        "--project-root",
        cell.repo,
      ],
      { label: `agentdist ${command} --harness ${adapter.id} --${scope}${label ? ` (${label})` : ""}` },
    );
    try {
      const report = JSON.parse(r.stdout);
      if (!report.applied) throw new Error(`not applied: ${JSON.stringify(report.conflicts)}`);
      return report;
    } catch (error) {
      throw new Error(
        `agentdist ${command} failed (exit ${r.code}): ${error.message} ${r.stderr.slice(0, 500)}`,
      );
    }
  };
  const kindsOf = (kinds) => result.placed.filter((n) => kinds.includes(n.split(":")[0]));
  const ctx = {
    evidence,
    get placed() {
      return result.placed;
    },
    run: exec,
    note: (text, kinds) => result.consent.push({ text, kinds }),
    append: (file, text) => appendFileSync(file, text),
    scanNames: (output, kinds, source) => scanNames(evidence, output, result.placed, kinds, source),
    scanNameList: (names, kinds, source) => scanNameList(evidence, names, result.placed, kinds, source),
    scanModelText: (text, kinds, source) =>
      scanModelRequests(evidence, [{ body: text }], kindsOf(kinds), { markers: adapter.markers, source }),
    spawn: (argv) => {
      const child = spawn(argv[0], argv.slice(1), {
        cwd: cell.repo,
        env: cell.env,
        stdio: "ignore",
        detached: true,
      });
      child.on("error", (error) => result.errors.push(`could not start ${argv[0]}: ${error.message}`));
      return {
        kill: () => {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {}
        },
      };
    },
    waitForModel: async (ms) => {
      const start = logMarks().llm;
      for (let waited = 0; waited < ms; waited += 500) {
        if (logMarks().llm > start) return true;
        await sleep(500);
      }
      return false;
    },
  };

  try {
    // 1. The user's own config.
    await adapter.setup?.(cell, ctx);

    // 2. The round trip, before the harness has run and filled its home with state of its own.
    const before = snapshot(cell);
    const first = await agentdist("install", "first");
    const ledger = first.ledgerFile ? [first.ledgerFile] : [];
    const installed = snapshot(cell, ledger);
    const again = await agentdist("install", "again");
    const changedActions = again.actions.filter((a) => a.type !== "unchanged");
    const changedFiles = diff(installed, snapshot(cell, ledger));
    await agentdist("uninstall");
    const leftover = diff(before, snapshot(cell));
    const problems = [
      ...changedActions.map((a) => `a second install did ${a.type} ${a.target}`),
      ...changedFiles.map((f) => `a second install: ${f}`),
      ...leftover.map((f) => `after uninstall: ${f}`),
    ];
    result.checks.roundTrip = problems.length
      ? { status: "fail", detail: problems.join("; ") }
      : { status: "pass", detail: "a second install changed nothing; uninstall restored every file" };

    // 3. Install. What agentdist did not skip is what the harness must load.
    const report = await agentdist("install");
    for (const d of report.diagnostics ?? []) {
      if (d.harness !== adapter.id) continue;
      if (d.message.startsWith("skipped")) result.skipped[d.node] = d.message.replace(/^skipped: /, "");
      else result.warnings.push(d.message);
    }
    result.placed = ALL_NODES.filter((n) => !(n in result.skipped));
    result.nextSteps = (report.diagnostics ?? []).filter(
      (d) => d.harness === adapter.id && d.level === "next",
    );
    const skillFile = report.actions.find(
      (a) => a.node === "skill:beacon" && a.target.endsWith("SKILL.md"),
    )?.target;

    // 4. What a user approves once.
    await adapter.consent?.(cell, ctx);

    // Every approval the runner had to give must be one agentdist told the user about: a note for
    // the same kinds, or, for an approval of the whole project, a note about the whole install.
    const kindsPlaced = new Set(result.placed.map((n) => n.split(":")[0]));
    const needed = result.consent.filter((c) => !c.kinds || c.kinds.some((k) => kindsPlaced.has(k)));
    const said = (c) =>
      result.nextSteps.some((n) =>
        c.kinds ? !n.kinds || n.kinds.some((k) => c.kinds.includes(k)) : !n.kinds,
      );
    const unsaid = needed.filter((c) => !said(c));
    result.checks.notes = !needed.length
      ? { status: "skipped", detail: "no approval was needed" }
      : unsaid.length
        ? { status: "fail", detail: `no next step tells the user: ${unsaid.map((c) => c.text).join("; ")}` }
        : { status: "pass", detail: "every approval the runner gave is a next step agentdist printed" };

    // 5. Model-free introspection.
    const introMarks = logMarks();
    await adapter.introspect?.(cell, ctx);
    const sessionMarks = logMarks();
    const intro = ownRecords(logsBetween(introMarks, sessionMarks), cell);

    // 6. A session against the mock.
    const canRunSession = adapter.drive || (adapter.mock && adapter.session);
    const reachedModel = adapter.reachedModel ?? (() => true);
    let turns = [];
    if (canRunSession) {
      writeFileSync(join(PROBE_DIR, "mock-mode"), adapter.toolCall === false ? "text" : "tool");
      if (adapter.drive) await adapter.drive(cell, ctx, PROMPT);
      else {
        const r = await exec(adapter.session(cell, PROMPT), {
          timeoutMs: adapter.sessionTimeoutMs ?? 120_000,
        });
        adapter.readSession?.(cell, r, ctx);
      }
      turns = logsBetween(sessionMarks).llm.filter(reachedModel);
      result.modelRequests = turns.length;
      if (turns.length) {
        const listed = kindsOf(adapter.listed ?? []).filter((n) => CANARIES[n]);
        scanModelRequests(evidence, turns, listed, { markers: adapter.markers });
      } else {
        result.errors.push(
          "the session never reached the mock model, so nothing it would have sent could be checked",
        );
      }

      // 7. Invoke the command, where one was placed and the harness can take a prompt.
      if (result.placed.includes("command:signal") && !adapter.drive && adapter.command !== null) {
        writeFileSync(join(PROBE_DIR, "mock-mode"), "text");
        const commandMarks = logMarks();
        const argv = adapter.command
          ? adapter.command(cell, "probe-signal", COMMAND_ARG)
          : adapter.session(cell, `/probe-signal ${COMMAND_ARG}`);
        await exec(argv, { timeoutMs: adapter.sessionTimeoutMs ?? 120_000 });
        const after = logsBetween(commandMarks).llm.filter(reachedModel);
        if (after.length) scanCommand(evidence, after);
        else result.errors.push("the command session never reached the mock model");
      }
    }

    // What the servers and hooks recorded. A harness that can run a session is judged on what
    // its sessions did; what a listing command did is checked only for what it got (the env), so
    // a listing that starts a server cannot stand in for a session that never loaded it.
    const session = ownRecords(logsBetween(sessionMarks), cell);
    const handshake = adapter.mcpHandshake;
    if (canRunSession) {
      scanMcp(evidence, session.mcp, result.placed, { handshake });
      const listedServers = result.placed.filter((n) =>
        intro.mcp.some((r) => r.transport === (n === "mcpServer:probe" ? "stdio" : "http")),
      );
      scanMcp(evidence, intro.mcp, listedServers, { handshake: null, source: "listing command" });
      // A hook that fired is evidence even for an event the adapter did not expect to reach.
      const events = [...new Set([...(adapter.hookEvents ?? []), ...session.hooks.map((h) => h.event)])];
      scanHooks(evidence, session.hooks, result.placed, { events });
    } else {
      scanMcp(evidence, intro.mcp, result.placed, { handshake, source: "listing command" });
    }
    writeFileSync(
      join(opts.out, `${adapter.id}-${scope}.evidence.json`),
      `${JSON.stringify({ introspection: intro, session }, null, 1)}\n`,
    );

    // Does the installed skill name the MCP tool the way the harness offers it to the model?
    const offered = toolNames(turns);
    const named = [...offered].some((n) => /stdio_(canary|listed)/.test(n));
    if (!skillFile || !result.placed.includes("mcpServer:probe")) {
      result.checks.toolRef = { status: "skipped", detail: "no skill or no stdio server placed" };
    } else if (!named) {
      result.checks.toolRef = { status: "unverified", detail: "no request offered the MCP tools by name" };
    } else {
      const path = skillFile.startsWith("~/")
        ? join(cell.home, skillFile.slice(2))
        : join(cell.repo, skillFile);
      const check = checkToolRef(readFileSync(path, "utf8"), offered);
      result.checks.toolRef = { status: check.ok ? "pass" : "fail", detail: check.detail };
    }
  } catch (error) {
    result.errors.push(String(error?.message ?? error));
  } finally {
    await teardown(adapter, cell, exec);
    // A daemon a harness left behind may still be writing into the cell; never let that end the run.
    if (!opts.keep) {
      try {
        rmSync(cell.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      } catch (error) {
        result.notes.push(`could not remove the cell: ${error.message}`);
      }
    }
  }

  result.verdicts = {};
  for (const node of ALL_NODES) {
    const known = adapter.known?.[`${scope}/${node}`];
    const v = verdict(node, { placed: result.placed.includes(node), evidence, known });
    if (v.status === "skipped") v.reason = result.skipped[node];
    result.verdicts[node] = v;
  }
  return result;
}

/** Kill what the harness left running, and wait until it is gone. */
async function teardown(adapter, cell, exec) {
  const pattern = adapter.leftovers;
  if (!pattern) return;
  await exec(["pkill", "-KILL", "-f", pattern], {
    label: `teardown: pkill -KILL -f ${pattern}`,
    timeoutMs: 10_000,
  });
  for (let i = 0; i < 50; i++) {
    const r = await run("pgrep", ["-f", pattern], { timeoutMs: 5_000 });
    if (r.code !== 0) return;
    await sleep(100);
  }
  appendFileSync(join(cell.dir, "..", "teardown.log"), `${adapter.id}: ${pattern} still running\n`);
}

// ---------------------------------------------------------------------------------------------
// Reporting

const MARK = { pass: "✅", fail: "❌", unverified: "❔", skipped: "·", xfail: "⚠️", xpass: "❗" };
const SHORT = {
  "skill:beacon": "skill",
  "agent:scout": "agent",
  "command:signal": "command",
  "mcpServer:probe": "mcp stdio",
  "mcpServer:probe-remote": "mcp http",
  "hook:session-start": "SessionStart",
  "hook:prompt": "UserPromptSubmit",
  "hook:pre-bash": "PreToolUse",
  "hook:post-bash": "PostToolUse",
  "hook:stop": "Stop",
  "hook:session-end": "SessionEnd",
};
const CHECKS = { toolRef: "tool names", roundTrip: "round trip", notes: "next steps" };

const failed = (r) =>
  r.errors.length > 0 ||
  Object.values(r.verdicts).some((v) => v.status === "fail" || v.status === "xpass") ||
  Object.values(r.checks).some((c) => c.status === "fail");

function markdown(results, versions) {
  const lines = [
    "# agentdist end-to-end results",
    "",
    "✅ loaded · ❌ not loaded · ⚠️ known failure · ❗ known entry is stale · ❔ nothing could tell · `·` not applicable · 🛑 the cell broke",
    "",
    `| harness | scope | ${[...ALL_NODES.map((n) => SHORT[n]), ...Object.values(CHECKS)].join(" | ")} |`,
    `|---|---|${[...ALL_NODES, ...Object.keys(CHECKS)].map(() => "---").join("|")}|`,
  ];
  for (const r of results) {
    const cells = [
      ...ALL_NODES.map((n) => MARK[r.verdicts[n].status]),
      ...Object.keys(CHECKS).map((k) => MARK[r.checks[k]?.status ?? "unverified"]),
    ];
    lines.push(`| ${r.harness}${r.errors.length ? " 🛑" : ""} | ${r.scope} | ${cells.join(" | ")} |`);
  }
  lines.push("", "## Versions", "");
  for (const [id, v] of Object.entries(versions)) lines.push(`- ${id}: ${v}`);
  lines.push("", "## Details", "");
  for (const r of results) {
    const bad = ALL_NODES.filter((n) =>
      ["fail", "xfail", "xpass", "unverified"].includes(r.verdicts[n].status),
    );
    const badChecks = Object.entries(r.checks).filter(([, c]) => c.status === "fail");
    if (!bad.length && !badChecks.length && !r.errors.length && !r.consent.length && !r.notes.length)
      continue;
    lines.push(`### ${r.harness} at ${r.scope} scope`, "");
    for (const e of r.errors) lines.push(`- 🛑 ${e}`);
    for (const c of r.consent) lines.push(`- consent: ${c.text}`);
    for (const n of r.nextSteps ?? []) lines.push(`- agentdist said next: ${n.message}`);
    for (const n of r.notes) lines.push(`- note: ${n}`);
    for (const w of r.warnings) lines.push(`- agentdist warned: ${w}`);
    for (const [k, c] of badChecks) lines.push(`- ❌ ${CHECKS[k]}: ${c.detail}`);
    for (const n of bad) {
      const v = r.verdicts[n];
      const why = (v.evidence ?? [])
        .filter((e) => !e.ok || v.status === "xpass")
        .map((e) => `${e.source}: ${e.detail}`)
        .join("; ");
      lines.push(`- ${MARK[v.status]} ${n}${why ? `: ${why}` : ""}${v.known ? ` (known: ${v.known})` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function writeReport(opts, results, versions) {
  const report = markdown(results, versions);
  writeFileSync(join(opts.out, "report.md"), `${report}\n`);
  writeFileSync(join(opts.out, "results.json"), `${JSON.stringify({ versions, results }, null, 2)}\n`);
  return report;
}

/** Give the results to whoever owns the output directory, so a Linux host can delete them. */
async function handBack(out) {
  try {
    const { uid, gid } = statSync(out);
    if (uid !== 0) await run("chown", ["-R", `${uid}:${gid}`, out], { timeoutMs: 60_000 });
  } catch {}
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const opts = parse(process.argv.slice(2));
  mkdirSync(opts.out, { recursive: true });
  const stop = await startServers(opts.adapters.some((a) => a.needsDisplay));
  const versions = {};
  for (const a of opts.adapters) {
    const r = await run(a.version[0], a.version.slice(1), {
      timeoutMs: 30_000,
      env: { ...process.env, ...(a.env?.({}) ?? {}) },
    });
    versions[a.id] =
      r.code === 0
        ? r.stdout.trim().split("\n")[0]
        : `not available (${(r.stderr || r.stdout).trim().split("\n")[0]})`;
  }

  const results = [];
  try {
    for (const adapter of opts.adapters) {
      for (const scope of opts.scopes) {
        process.stdout.write(`${adapter.id} ${scope} … `);
        const r = await runCell(adapter, scope, opts);
        results.push(r);
        writeReport(opts, results, versions);
        const counts = {};
        for (const v of Object.values(r.verdicts)) counts[v.status] = (counts[v.status] ?? 0) + 1;
        process.stdout.write(
          `${Object.entries(counts)
            .map(([k, n]) => `${n} ${k}`)
            .join(", ")}${r.errors.length ? ` (${r.errors.length} errors)` : ""}\n`,
        );
      }
    }
  } finally {
    stop();
    await handBack(opts.out);
  }
  process.stdout.write(`\n${writeReport(opts, results, versions)}\n`);
  return results.some(failed) ? 1 : 0;
}

process.on("uncaughtException", (error) => {
  process.stderr.write(`the runner broke: ${error?.stack ?? error}\n`);
  process.exit(2);
});

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`the runner broke: ${error?.stack ?? error}\n`);
    process.exit(2);
  },
);
