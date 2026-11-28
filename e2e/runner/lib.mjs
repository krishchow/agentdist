/**
 * The parts of the end-to-end runner that do not know about any one harness: a sandbox per cell,
 * running commands with a deadline, reading what the probe servers recorded during a cell, and
 * turning that evidence into a verdict per artifact.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PROBE_DIR = process.env.PROBE_DIR ?? "/tmp/probe";
export const PROBE_PACKAGE = process.env.PROBE_PACKAGE ?? "/src/e2e/probe";
/** The engine under test: the repository's own build, mounted at /src. */
export const AGENTDIST = process.env.AGENTDIST_BIN ?? "/src/dist/cli.js";
export const MOCK_LLM = `http://127.0.0.1:${process.env.MOCK_LLM_PORT ?? 4010}`;
export const MOCK_RPC = `http://127.0.0.1:${process.env.MOCK_RPC_PORT ?? 4030}`;
/** What the HTTP MCP server must receive, which proves the harness resolved {{env:PROBE_HTTP_TOKEN}}. */
export const HTTP_TOKEN = "probe-http-token-7f3a";
export const PASSTHROUGH = "probe-passthrough-91c2";

/**
 * The canary each artifact carries, and where a harness is expected to show it. Each MCP server
 * offers a second tool, `*_listed`, that no probe file mentions: a harness that sends the model
 * tool names but not descriptions is checked against that name, which only the server's own
 * tools/list answer can have put in a request.
 */
export const CANARIES = {
  "skill:beacon": { listed: "PROBE_SKILL_BEACON_DESC", body: "PROBE_SKILL_BEACON_BODY" },
  "agent:scout": { listed: "PROBE_AGENT_SCOUT_DESC", body: "PROBE_AGENT_SCOUT_BODY" },
  "command:signal": { listed: "PROBE_COMMAND_SIGNAL_DESC", body: "PROBE_COMMAND_SIGNAL_BODY" },
  "mcpServer:probe": { listed: "PROBE_MCP_STDIO_TOOL", name: "stdio_listed" },
  "mcpServer:probe-remote": { listed: "PROBE_MCP_HTTP_TOOL", name: "http_listed" },
};

/** Hook node → the canonical event its command records. */
export const HOOK_EVENTS = {
  "hook:session-start": "SessionStart",
  "hook:prompt": "UserPromptSubmit",
  "hook:pre-bash": "PreToolUse",
  "hook:post-bash": "PostToolUse",
  "hook:stop": "Stop",
  "hook:session-end": "SessionEnd",
};

/** Every event the probe registers a hook for. */
export const ALL_EVENTS = Object.values(HOOK_EVENTS);

export const ALL_NODES = [...Object.keys(CANARIES), ...Object.keys(HOOK_EVENTS)];

/**
 * What each harness calls the event in the payload it sends a hook, observed in every harness
 * that names it. A hook that fired with any other name was registered under the wrong event.
 */
const NATIVE_EVENTS = {
  SessionStart: ["SessionStart", "sessionStart"],
  UserPromptSubmit: ["UserPromptSubmit", "BeforeAgent", "beforeSubmitPrompt"],
  PreToolUse: ["PreToolUse", "BeforeTool", "preToolUse"],
  PostToolUse: ["PostToolUse", "AfterTool", "postToolUse"],
  Stop: ["Stop", "AfterAgent", "stop"],
  SessionEnd: ["SessionEnd", "sessionEnd"],
};

/** The shell tool, as each harness names it in a hook payload. The probe's tool hooks match it only. */
const SHELL_TOOL_NAMES = ["Bash", "bash", "shell", "Shell", "Execute", "run_shell_command", "exec_command"];

// ---------------------------------------------------------------------------------------------
// Sandboxes

/**
 * A fresh home and repository for one harness at one scope. Nothing carries over between cells:
 * every harness starts with no config of its own except what its adapter's setup writes. The
 * repository is named after the cell, so nothing that identifies a window or project by its
 * directory name can confuse two cells.
 */
export function makeCell(root, harness, scope) {
  const dir = join(root, `${harness}-${scope}`);
  rmSync(dir, { recursive: true, force: true });
  const home = join(dir, "home");
  const repo = join(dir, `${harness}-${scope}-repo`);
  mkdirSync(home, { recursive: true });
  mkdirSync(repo, { recursive: true });
  spawnSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "README.md"), "# probe repository\n");
  const env = {
    ...baseEnv(),
    // HOME alone, as on a typical machine: some harnesses look elsewhere when XDG_* is set.
    HOME: home,
    USERPROFILE: home,
    PROBE_DIR,
    PROBE_HTTP_TOKEN: HTTP_TOKEN,
    PROBE_PASSTHROUGH: PASSTHROUGH,
    // Harnesses that check for a CI environment use it to stop asking questions.
    CI: "1",
    NO_COLOR: "1",
    TERM: "dumb",
  };
  return { harness, scope, dir, home, repo, env };
}

/** The container's environment without anything that could reach a real model or account. */
function baseEnv() {
  const keep = ["PATH", "LANG", "LC_ALL", "TZ", "NODE_PATH", "SHELL", "USER", "LOGNAME", "TMPDIR"];
  return Object.fromEntries(keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
}

export function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

// ---------------------------------------------------------------------------------------------
// Commands

/**
 * Run a command with a deadline and collect its output. Never throws; a harness that hangs or
 * crashes is evidence, not an error in the runner.
 *
 * It settles when the command exits, not when its output closes: a daemon the harness started in
 * a session of its own can hold the pipes open forever, out of reach of the group kill.
 */
export function run(cmd, args, { cwd, env, timeoutMs = 60_000, input } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], detached: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const killGroup = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    };
    const settle = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killGroup();
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ code, stdout, stderr, timedOut, ms: Date.now() - started });
    };
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    // A command that closes stdin before reading it is not an error in the runner.
    child.stdin.on("error", () => {});
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
      // Whatever still holds the pipes is not waited for.
      setTimeout(() => settle(null), 1000);
    }, timeoutMs);
    child.on("error", (error) => {
      stderr += error.message;
      settle(127);
    });
    // Give the pipes a moment to drain what was written before the exit.
    child.on("exit", (code) => setTimeout(() => settle(code), 200));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

// ---------------------------------------------------------------------------------------------
// What the probe servers recorded

const LOGS = ["llm", "mcp", "hooks", "skill"];

/**
 * Where each log ends now, so a phase reads only what was written while it ran. A mark is the end
 * of the last complete line: a record being written at that moment belongs to the phase after.
 */
export function logMarks() {
  return Object.fromEntries(
    LOGS.map((name) => {
      const file = join(PROBE_DIR, `${name}.jsonl`);
      if (!existsSync(file)) return [name, 0];
      const bytes = readFileSync(file);
      return [name, bytes.lastIndexOf(0x0a) + 1];
    }),
  );
}

/** The records each log gained between two marks (to the end of the log without `to`). */
export function logsBetween(from, to) {
  return Object.fromEntries(
    LOGS.map((name) => {
      const file = join(PROBE_DIR, `${name}.jsonl`);
      if (!existsSync(file)) return [name, []];
      const text = readFileSync(file)
        .subarray(from[name] ?? 0, to?.[name])
        .toString("utf8");
      const records = [];
      for (const line of text.split("\n")) {
        if (!line) continue;
        try {
          records.push(JSON.parse(line));
        } catch {
          records.push({ unparsed: line.slice(0, 200) });
        }
      }
      return [name, records];
    }),
  );
}

export const logsSince = (marks) => logsBetween(marks);

/**
 * Drop records that some other cell's leftover process wrote: a hook or an MCP server that says
 * where it ran, and ran outside this cell.
 */
export function ownRecords(logs, cell) {
  const inside = (path) => path === undefined || path.startsWith(cell.dir);
  return {
    ...logs,
    hooks: logs.hooks.filter((h) => inside(h.cwd)),
    mcp: logs.mcp.filter((r) => r.home === undefined || r.home === cell.home),
  };
}

// ---------------------------------------------------------------------------------------------
// Evidence → verdicts

/**
 * One observation about one artifact: `loaded` with what showed it, `missing` when a check that
 * should have seen it did not, or nothing when no check in this cell could tell.
 */
export class Evidence {
  constructor() {
    this.by = new Map();
  }
  /** Record that `node` was seen (ok) or looked for and not seen (not ok) by `source`. */
  add(node, ok, source, detail = "") {
    if (!this.by.has(node)) this.by.set(node, []);
    this.by.get(node).push({ ok, source, detail });
  }
  for(node) {
    return this.by.get(node) ?? [];
  }
}

/**
 * Read the model requests of a session for each artifact's canary. A canary in any request is
 * proof the harness loaded the artifact; its absence from every request is only proof when the
 * session actually reached the model, which the caller checks.
 */
export function scanModelRequests(evidence, llm, nodes, { markers = {}, source = "model request" } = {}) {
  const bodies = llm.map((r) => JSON.stringify(r.body));
  for (const node of nodes) {
    const canary = CANARIES[node];
    if (!canary) continue;
    // A harness that sends only some of an artifact says which string stands for it.
    const wanted = markers[node] ? [markers[node]].flat() : [canary.listed];
    const hit = wanted.find((m) => bodies.some((b) => b.includes(m)));
    evidence.add(
      node,
      Boolean(hit),
      source,
      hit ? `"${hit}" was in a request` : `no request mentioned ${wanted.map((m) => `"${m}"`).join(" or ")}`,
    );
  }
}

/**
 * What the MCP servers recorded: was the stdio one started with its environment, was the HTTP one
 * reached at its URL with its headers. `handshake` is the call that proves a harness loaded a
 * server: `tools/list` by default, `initialize` for a harness that lists a server's tools only
 * when the model asks, or null to check only what the server was given (its env and headers).
 *
 * @param {Evidence} evidence
 * @param {any[]} mcp
 * @param {string[]} nodes
 * @param {{ handshake?: string | null, source?: string }} [options]
 */
export function scanMcp(evidence, mcp, nodes, { handshake = "tools/list", source = "" } = {}) {
  const what = handshake === "tools/list" ? "listed its tools" : "completed the handshake";
  const from = (name) => (source ? `${name} (${source})` : name);
  if (nodes.includes("mcpServer:probe")) {
    const stdio = mcp.filter((r) => r.transport === "stdio");
    const done = stdio.some((r) => r.method === handshake);
    if (handshake !== null)
      evidence.add(
        "mcpServer:probe",
        done,
        from("stdio server log"),
        done
          ? `the harness started it and ${what}`
          : stdio.length
            ? `started but never ${what}`
            : "never started",
      );
    // Every start is checked: a harness that loses the env on one path (a listing command, a
    // session) has a bug on that path.
    const starts = stdio.filter((r) => r.method === "(start)");
    if (starts.length) {
      const bad = starts.find((r) => r.env?.PROBE_STATIC !== "from-manifest");
      evidence.add(
        "mcpServer:probe",
        !bad,
        from("stdio server env"),
        bad
          ? `\`env\` from the manifest missing: ${JSON.stringify(bad.env)}`
          : "`env` from the manifest reached it",
      );
      const blocked = starts.find((r) => r.env?.PROBE_PASSTHROUGH !== PASSTHROUGH);
      evidence.add(
        "mcpServer:probe",
        !blocked,
        from("stdio server env"),
        blocked
          ? "`envPassthrough` variable PROBE_PASSTHROUGH did not reach it"
          : "`envPassthrough` reached it",
      );
    }
  }
  if (nodes.includes("mcpServer:probe-remote")) {
    // JSON-RPC, and POSTs to a wrong path; a client may probe the endpoint (GET, OPTIONS) before it
    // authenticates, which says nothing.
    const http = mcp.filter(
      (r) => r.transport === "http" && (!r.method.startsWith("(") || r.method === "(POST)"),
    );
    const done = http.some((r) => r.method === handshake && r.path === "/mcp");
    if (handshake !== null)
      evidence.add(
        "mcpServer:probe-remote",
        done,
        from("http server log"),
        done
          ? `the harness connected and ${what}`
          : http.length
            ? `connected but never ${what} at /mcp`
            : "never connected",
      );
    if (http.length) {
      const elsewhere = http.find((r) => r.path !== "/mcp");
      evidence.add(
        "mcpServer:probe-remote",
        !elsewhere,
        from("http server URL"),
        elsewhere
          ? `a request went to ${elsewhere.path}, not /mcp`
          : "every request went to the manifest's URL",
      );
      // Every request must carry the headers: one without them means a path that drops them.
      const noToken = http.find((r) => r.headers?.authorization !== `Bearer ${HTTP_TOKEN}`);
      const got = noToken?.headers?.authorization;
      evidence.add(
        "mcpServer:probe-remote",
        !noToken,
        from("http Authorization header"),
        noToken
          ? `a request carried ${got === undefined ? "no header" : JSON.stringify(got)}`
          : "{{env:PROBE_HTTP_TOKEN}} was resolved",
      );
      const noLiteral = http.find((r) => r.headers?.["x-client"] !== "probe");
      evidence.add(
        "mcpServer:probe-remote",
        !noLiteral,
        from("http literal header"),
        noLiteral
          ? `a request carried X-Client ${JSON.stringify(noLiteral.headers?.["x-client"])}`
          : "X-Client arrived",
      );
    }
  }
}

/**
 * Which hook events fired, for the hooks a harness was given, and whether each fired for the
 * right thing: the payload must be JSON naming this event in the harness's spelling, and a tool
 * hook must have fired for the shell tool its matcher names, not some other tool.
 */
export function scanHooks(evidence, hooks, nodes, { events = Object.values(HOOK_EVENTS) } = {}) {
  for (const node of nodes) {
    const event = HOOK_EVENTS[node];
    if (!event || !events.includes(event)) continue;
    const fired = hooks.filter((h) => h.event === event);
    evidence.add(
      node,
      fired.length > 0,
      "hook log",
      fired.length ? `${event} fired` : `${event} never fired`,
    );
    for (const h of fired) {
      const input = h.input;
      if (typeof input !== "object" || input === null) {
        evidence.add(node, false, "hook payload", `${event} got no JSON on stdin`);
        break;
      }
      const native = input.hook_event_name ?? input.event ?? input.hookName;
      if (native !== undefined && !NATIVE_EVENTS[event].includes(native)) {
        evidence.add(node, false, "hook payload", `registered for ${event} but fired for ${native}`);
        break;
      }
      const tool = input.tool_name ?? input.tool?.name ?? input.toolName;
      if (
        (event === "PreToolUse" || event === "PostToolUse") &&
        tool !== undefined &&
        !SHELL_TOOL_NAMES.includes(tool)
      ) {
        evidence.add(node, false, "hook matcher", `matched Bash but fired for ${tool}`);
        break;
      }
    }
  }
}

/**
 * The verdict for one artifact in one cell.
 *   skipped     agentdist said the harness cannot take it, so there is nothing to check
 *   pass        a check saw it, and no check contradicted it
 *   fail        a check that should have seen it did not
 *   unverified  no check in this cell could tell
 *   xfail       it failed exactly as a known entry says: every failing check matches `known.detail`
 *   xpass       a known failure that passed, or no longer could be checked: the entry is stale
 *
 * @param {string} node
 * @param {{ placed: boolean, evidence: Evidence, known?: { because: string, detail: string } }} what
 */
export function verdict(node, { placed, evidence, known }) {
  if (!placed) return { status: "skipped" };
  const seen = evidence.for(node);
  const bad = seen.filter((e) => !e.ok);
  const status = !seen.length ? "unverified" : bad.length ? "fail" : "pass";
  if (!known) return { status, evidence: seen };
  if (status === "fail" && bad.every((e) => new RegExp(known.detail).test(`${e.source}: ${e.detail}`))) {
    return { status: "xfail", evidence: seen, known: known.because };
  }
  // A known failure that failed some other way is a plain failure.
  if (status === "fail") return { status, evidence: seen, known: known.because };
  return { status: "xpass", evidence: seen, known: known.because };
}

/** The name each artifact is installed under, which introspection commands print. */
export const INSTALLED_NAMES = {
  "skill:beacon": "probe-beacon",
  "agent:scout": "probe-scout",
  "command:signal": "probe-signal",
};

/** What an invoked command must turn into: its body, with the argument in place of $ARGUMENTS. */
export const COMMAND_ARG = "PROBEARG";
export const COMMAND_EXPANDED = `PROBE_COMMAND_SIGNAL_BODY with ${COMMAND_ARG}.`;

/**
 * Look for each artifact's installed name in a listing command's text output. Paths are taken out
 * first, and so are lines that report a problem, so a listing that names the artifact only because
 * it failed to load it does not count. Prefer `scanNameList` where the output can be parsed.
 */
export function scanNames(evidence, output, placed, kinds, source) {
  const names = output
    .split("\n")
    .filter((line) => !/error|fail|invalid|warn|skipp/i.test(line))
    // A path has something before its first slash; a name like Devin's `/probe-beacon` does not.
    .map((line) => line.replace(/\S+[/\\]\S*/g, " "))
    .join("\n");
  for (const node of placed) {
    const kind = node.split(":")[0];
    const name = INSTALLED_NAMES[node];
    if (!name || !kinds.includes(kind)) continue;
    const hit = new RegExp(`(^|[^\\w-])${name}([^\\w-]|$)`, "m").test(names);
    evidence.add(node, hit, source, hit ? `listed as ${name}` : `${name} not listed`);
  }
}

/** Look for each artifact's installed name among the names a listing command returned. */
export function scanNameList(evidence, names, placed, kinds, source) {
  for (const node of placed) {
    const kind = node.split(":")[0];
    const name = INSTALLED_NAMES[node];
    if (!name || !kinds.includes(kind)) continue;
    const hit = names.includes(name);
    evidence.add(node, hit, source, hit ? `listed as ${name}` : `${name} not among ${JSON.stringify(names)}`);
  }
}

/** After `/probe-signal PROBEARG`: did the command's body reach the model, with the argument in it? */
export function scanCommand(evidence, llm, source = "invoked command") {
  const bodies = llm.map((r) => JSON.stringify(r.body));
  const expanded = bodies.some((b) => b.includes(COMMAND_EXPANDED));
  const body = bodies.some((b) => b.includes("PROBE_COMMAND_SIGNAL_BODY"));
  if (expanded)
    evidence.add("command:signal", true, source, "its body reached the model with the argument substituted");
  else if (body)
    evidence.add(
      "command:signal",
      false,
      source,
      "its body reached the model but the argument was not substituted",
    );
  else evidence.add("command:signal", false, source, "its body never reached the model");
}

// ---------------------------------------------------------------------------------------------
// Tool names: does installed content name MCP tools the way the harness names them to the model?

/** Every tool name a model request offers, from all four wire formats. */
export function toolNames(llm) {
  const names = new Set();
  for (const r of llm) {
    for (const t of r.body?.tools ?? []) {
      if (t.function?.name) names.add(t.function.name);
      if (t.name) names.add(t.name);
      // Responses API namespaces (Codex): the model calls `<namespace>__<tool>`.
      for (const inner of t.tools ?? []) if (inner.name) names.add(`${t.name}__${inner.name}`);
      for (const f of t.functionDeclarations ?? t.function_declarations ?? []) names.add(f.name);
    }
  }
  return names;
}

/**
 * The installed skill's `Call <reference>` line names the probe's stdio tool in the harness's
 * dialect. A reference spelled as an identifier must be a tool the model was offered; one
 * written in prose (`stdio_canary` (probe MCP tool)) only has to end a tool's name.
 */
export function checkToolRef(skillText, offered) {
  const line = skillText.match(/Call (.+?), then run/)?.[1];
  if (!line) return { ok: false, detail: "the installed skill has no rendered tool reference" };
  const prose = line.match(/^`([^`]+)` \(.+MCP tool\)$/);
  if (prose) {
    const hit = [...offered].find((n) => n.endsWith(prose[1]));
    return hit
      ? { ok: true, detail: `prose reference ${line} matches ${hit}` }
      : { ok: false, detail: `prose reference ${line} matches no offered tool` };
  }
  const ref = line.replace(/^`|`$/g, "");
  return offered.has(ref)
    ? { ok: true, detail: `${ref} is a tool the model was offered` }
    : {
        ok: false,
        detail: `the skill says ${ref}, but the model was offered ${[...offered].filter((n) => /canary|listed/.test(n)).join(", ")}`,
      };
}
