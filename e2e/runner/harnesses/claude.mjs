import { ALL_EVENTS, MOCK_LLM } from "../lib.mjs";

const flags = [
  "--output-format",
  "stream-json",
  "--verbose",
  "--include-hook-events",
  "--dangerously-skip-permissions",
];

export const claude = {
  id: "claude",
  version: ["claude", "--version"],
  mock: "llm",
  env: () => ({
    ANTHROPIC_BASE_URL: MOCK_LLM,
    ANTHROPIC_API_KEY: "probe",
    // Otherwise MCP tools are deferred and only their names reach the model.
    ENABLE_TOOL_SEARCH: "false",
    // --dangerously-skip-permissions refuses to run as root outside a sandbox.
    IS_SANDBOX: "1",
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  }),
  session: (_cell, prompt) => ["claude", "-p", prompt, ...flags],
  listed: ["skill", "agent", "command", "mcpServer"],
  hookEvents: ALL_EVENTS,
  /** The first stream-json event lists everything the session loaded, before any model call. */
  readSession(cell, result, ctx) {
    const init = result.stdout
      .split("\n")
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .find((e) => e?.type === "system" && e.subtype === "init");
    if (!init) return;
    // Skills are slash commands too, so a command is one that is not also a skill.
    const skills = init.skills ?? [];
    ctx.scanNameList(skills, ["skill"], "stream-json init (skills)");
    ctx.scanNameList(init.agents ?? [], ["agent"], "stream-json init (agents)");
    ctx.scanNameList(
      (init.slash_commands ?? []).filter((c) => !skills.includes(c)),
      ["command"],
      "stream-json init (commands)",
    );
    const source = cell.scope === "user" ? "user" : "project";
    for (const [node, server] of [
      ["mcpServer:probe", "probe"],
      ["mcpServer:probe-remote", "probe-remote"],
    ]) {
      if (!ctx.placed.includes(node)) continue;
      const entry = (init.mcp_servers ?? []).find((s) => s.name === server);
      const ok = entry?.status === "connected" && entry.source === source;
      ctx.evidence.add(
        node,
        ok,
        "stream-json init",
        `status ${entry?.status ?? "absent"}, from ${entry?.source ?? "nowhere"} (expected ${source})`,
      );
    }
  },
};
