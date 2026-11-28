import { describe, expect, it } from "vitest";
// The end-to-end runner is plain JavaScript run inside the e2e image; its evidence logic is tested here.
import {
  checkToolRef,
  Evidence,
  HTTP_TOKEN,
  ownRecords,
  PASSTHROUGH,
  scanCommand,
  scanHooks,
  scanMcp,
  scanModelRequests,
  scanNameList,
  scanNames,
  toolNames,
  verdict,
} from "../e2e/runner/lib.mjs";

const request = (text: string) => ({ body: { messages: [{ role: "system", content: text }] } });
const status = (ev: Evidence, node: string, known?: { because: string; detail: string }) =>
  verdict(node, { placed: true, evidence: ev, known }).status;

describe("e2e evidence", () => {
  it("finds a canary in any request, or the marker a harness sends instead", () => {
    const ev = new Evidence();
    scanModelRequests(ev, [request("title"), request("skills: PROBE_SKILL_BEACON_DESC")], ["skill:beacon"]);
    scanModelRequests(ev, [request("tools: probe___stdio_listed")], ["mcpServer:probe"], {
      markers: { "mcpServer:probe": "stdio_listed" },
    });
    scanModelRequests(ev, [request("nothing here")], ["agent:scout"]);
    expect(status(ev, "skill:beacon")).toBe("pass");
    expect(status(ev, "mcpServer:probe")).toBe("pass");
    expect(status(ev, "agent:scout")).toBe("fail");
  });

  it("is unverified with no evidence and skipped when not placed", () => {
    const ev = new Evidence();
    expect(status(ev, "hook:stop")).toBe("unverified");
    expect(verdict("hook:stop", { placed: false, evidence: ev }).status).toBe("skipped");
  });

  it("fails when any check contradicts another", () => {
    const ev = new Evidence();
    ev.add("skill:beacon", true, "listing", "listed");
    ev.add("skill:beacon", false, "model request", "absent");
    expect(status(ev, "skill:beacon")).toBe("fail");
  });

  it("calls a failure known only when it fails the known way, and a known entry that passes stale", () => {
    const known = { because: "editor only", detail: "never reached the model" };
    const expected = new Evidence();
    expected.add("command:signal", false, "invoked command", "its body never reached the model");
    expect(status(expected, "command:signal", known)).toBe("xfail");

    const other = new Evidence();
    other.add("command:signal", false, "invoked command", "the argument was not substituted");
    expect(status(other, "command:signal", known)).toBe("fail");

    const fixed = new Evidence();
    fixed.add("command:signal", true, "invoked command", "expanded");
    expect(status(fixed, "command:signal", known)).toBe("xpass");
    expect(status(new Evidence(), "command:signal", known)).toBe("xpass");
  });

  it("requires the stdio server's tools to be listed and its env to arrive on every start", () => {
    const good = {
      transport: "stdio",
      method: "(start)",
      env: { PROBE_STATIC: "from-manifest", PROBE_PASSTHROUGH: PASSTHROUGH },
    };
    const ev = new Evidence();
    scanMcp(ev, [good, { transport: "stdio", method: "tools/list" }], ["mcpServer:probe"]);
    expect(status(ev, "mcpServer:probe")).toBe("pass");

    const lost = new Evidence();
    scanMcp(
      lost,
      [
        good,
        { ...good, env: { PROBE_STATIC: "from-manifest" } },
        { transport: "stdio", method: "tools/list" },
      ],
      ["mcpServer:probe"],
    );
    const v = verdict("mcpServer:probe", { placed: true, evidence: lost });
    expect(v.status).toBe("fail");
    expect(v.evidence.find((e: { ok: boolean }) => !e.ok)!.detail).toContain("envPassthrough");

    const never = new Evidence();
    scanMcp(never, [], ["mcpServer:probe"]);
    expect(never.for("mcpServer:probe")[0]!.detail).toBe("never started");

    // A listing command is judged only on what it gave the server, not on how far it got.
    const listing = new Evidence();
    scanMcp(listing, [good, { transport: "stdio", method: "initialize" }], ["mcpServer:probe"], {
      handshake: null,
    });
    expect(status(listing, "mcpServer:probe")).toBe("pass");

    const handshake = new Evidence();
    scanMcp(handshake, [good, { transport: "stdio", method: "initialize" }], ["mcpServer:probe"], {
      handshake: "initialize",
    });
    expect(status(handshake, "mcpServer:probe")).toBe("pass");
  });

  it("requires every HTTP request at the manifest's URL with the resolved token and literal header", () => {
    const req = (authorization?: string, path = "/mcp", client = "probe") => ({
      transport: "http",
      method: "tools/list",
      path,
      headers: { authorization, "x-client": client },
    });
    const ok = new Evidence();
    scanMcp(
      ok,
      [req(`Bearer ${HTTP_TOKEN}`), { transport: "http", method: "(GET)", path: "/mcp", headers: {} }],
      ["mcpServer:probe-remote"],
    );
    expect(status(ok, "mcpServer:probe-remote")).toBe("pass");

    for (const wrong of [undefined, "Bearer ${PROBE_HTTP_TOKEN}", "Bearer {env:PROBE_HTTP_TOKEN}"]) {
      const ev = new Evidence();
      scanMcp(ev, [req(`Bearer ${HTTP_TOKEN}`), req(wrong)], ["mcpServer:probe-remote"]);
      expect(status(ev, "mcpServer:probe-remote")).toBe("fail");
    }
    const elsewhere = new Evidence();
    scanMcp(
      elsewhere,
      [
        {
          transport: "http",
          method: "(POST)",
          path: "/",
          headers: { authorization: `Bearer ${HTTP_TOKEN}`, "x-client": "probe" },
        },
      ],
      ["mcpServer:probe-remote"],
    );
    expect(status(elsewhere, "mcpServer:probe-remote")).toBe("fail");
    const noLiteral = new Evidence();
    scanMcp(noLiteral, [req(`Bearer ${HTTP_TOKEN}`, "/mcp", "")], ["mcpServer:probe-remote"]);
    expect(status(noLiteral, "mcpServer:probe-remote")).toBe("fail");
  });

  it("counts a hook only for the events a session could reach, unless it fired anyway", () => {
    const ev = new Evidence();
    scanHooks(
      ev,
      [{ event: "SessionStart", input: {} }],
      ["hook:session-start", "hook:pre-bash", "hook:stop"],
      {
        events: ["SessionStart", "PreToolUse"],
      },
    );
    expect(status(ev, "hook:session-start")).toBe("pass");
    expect(status(ev, "hook:pre-bash")).toBe("fail");
    expect(status(ev, "hook:stop")).toBe("unverified");
  });

  it("checks a hook fired for its own event, with JSON, and for the tool its matcher names", () => {
    const fired = (input: unknown) => {
      const ev = new Evidence();
      scanHooks(ev, [{ event: "PreToolUse", input }], ["hook:pre-bash"]);
      return status(ev, "hook:pre-bash");
    };
    expect(fired({ hook_event_name: "PreToolUse", tool_name: "Bash" })).toBe("pass");
    expect(fired({ hook_event_name: "BeforeTool", tool_name: "run_shell_command" })).toBe("pass");
    expect(fired({ hook_event_name: "PostToolUse", tool_name: "Bash" })).toBe("fail");
    expect(fired({ hook_event_name: "PreToolUse", tool_name: "Read" })).toBe("fail");
    expect(fired("")).toBe("fail");
  });

  it("drops records a process outside the cell wrote", () => {
    const cell = { dir: "/tmp/e2e-cells/claude-user", home: "/tmp/e2e-cells/claude-user/home" };
    const logs = {
      llm: [],
      skill: [],
      hooks: [{ cwd: "/tmp/e2e-cells/claude-user/repo" }, { cwd: "/tmp/e2e-cells/cline-local/repo" }, {}],
      mcp: [{ home: cell.home }, { home: "/tmp/e2e-cells/cline-local/home" }, { method: "tools/list" }],
    };
    const own = ownRecords(logs, cell);
    expect(own.hooks).toHaveLength(2);
    expect(own.mcp).toHaveLength(2);
  });

  it("tells a command whose argument was not substituted from one that never arrived", () => {
    const expanded = new Evidence();
    scanCommand(expanded, [request("PROBE_COMMAND_SIGNAL_BODY with PROBEARG. Then use /probe-beacon.")]);
    expect(expanded.for("command:signal")[0]!.ok).toBe(true);

    const literal = new Evidence();
    scanCommand(literal, [request("PROBE_COMMAND_SIGNAL_BODY with $ARGUMENTS.\n\n/probe-signal PROBEARG")]);
    expect(literal.for("command:signal")[0]).toMatchObject({
      ok: false,
      detail: expect.stringContaining("not substituted"),
    });

    // A harness with no placeholder: the body points at the arguments, which follow it.
    const appended = new Evidence();
    scanCommand(appended, [
      request(
        "PROBE_COMMAND_SIGNAL_BODY with the arguments given after the command. Then use /probe-beacon.\n\nPROBEARG",
      ),
    ]);
    expect(appended.for("command:signal")[0]!.ok).toBe(true);

    const missing = new Evidence();
    scanCommand(missing, [request("hello")]);
    expect(missing.for("command:signal")[0]!.detail).toContain("never reached");
  });

  it("matches installed names as whole names, never inside a path or an error", () => {
    const ev = new Evidence();
    scanNames(ev, "probe-beacon-old\nother", ["skill:beacon"], ["skill"], "list");
    scanNames(ev, "  probe-scout (subagent)", ["agent:scout"], ["agent"], "list");
    scanNames(
      ev,
      "  /probe-signal [user] (~/.devin/workflows/probe-signal) - desc",
      ["command:signal"],
      ["command"],
      "list",
    );
    expect(ev.for("skill:beacon")[0]!.ok).toBe(false);
    expect(ev.for("agent:scout")[0]!.ok).toBe(true);
    expect(ev.for("command:signal")[0]!.ok).toBe(true);

    const paths = new Evidence();
    scanNames(
      paths,
      "Location: /home/.agents/skills/probe-beacon/SKILL.md",
      ["skill:beacon"],
      ["skill"],
      "list",
    );
    scanNames(paths, "failed to load agent probe-scout: bad YAML", ["agent:scout"], ["agent"], "list");
    expect(paths.for("skill:beacon")[0]!.ok).toBe(false);
    expect(paths.for("agent:scout")[0]!.ok).toBe(false);

    const list = new Evidence();
    scanNameList(list, ["other-name"], ["skill:beacon"], ["skill"], "amp");
    expect(list.for("skill:beacon")[0]!.ok).toBe(false);
  });

  it("checks a rendered tool reference against the tool names the model was offered", () => {
    const offered = toolNames([
      {
        body: { tools: [{ name: "mcp__probe__stdio_canary" }, { function: { name: "probe-stdio_canary" } }] },
      },
      { body: { tools: [{ type: "namespace", name: "mcp__probe", tools: [{ name: "stdio_canary" }] }] } },
      { body: { tools: [{ functionDeclarations: [{ name: "mcp_probe_stdio_canary" }] }] } },
    ]);
    expect([...offered]).toEqual(
      expect.arrayContaining(["mcp__probe__stdio_canary", "probe-stdio_canary", "mcp_probe_stdio_canary"]),
    );
    const skill = (ref: string) => `# Beacon\n\nCall ${ref}, then run \`node x\`.`;
    expect(checkToolRef(skill("mcp__probe__stdio_canary"), offered).ok).toBe(true);
    expect(checkToolRef(skill("probe/stdio_canary"), offered).ok).toBe(false);
    expect(checkToolRef(skill("`stdio_canary` (probe MCP tool)"), offered).ok).toBe(true);
    expect(checkToolRef("no reference", offered).ok).toBe(false);
  });
});
