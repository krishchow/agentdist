export const amp = {
  id: "amp",
  version: ["amp", "--version"],
  // Amp's model loop runs on its servers, behind an account; no session can run offline.
  mock: undefined,
  // A dummy key keeps every command from starting a browser login; the URL goes nowhere.
  env: () => ({ AMP_API_KEY: "probe", AMP_URL: "http://127.0.0.1:9", AMP_SKIP_UPDATE_CHECK: "1" }),
  // A project's MCP servers are untrusted until the user approves each one.
  async consent(cell, ctx) {
    if (cell.scope !== "local") return;
    for (const server of ["probe", "probe-remote"]) await ctx.run(["amp", "mcp", "approve", server]);
    ctx.note("approved the project MCP servers with amp mcp approve");
  },
  async introspect(_cell, ctx) {
    const skills = await ctx.run(["amp", "skill", "list", "--json"]);
    let listing = { skills: [], errors: [] };
    try {
      listing = JSON.parse(skills.stdout);
    } catch {}
    // A skill Amp could not load is reported among the errors, by path.
    const broken = (listing.errors ?? []).find((e) => JSON.stringify(e).includes("probe-beacon"));
    if (broken && ctx.placed.includes("skill:beacon")) {
      ctx.evidence.add("skill:beacon", false, "amp skill list", `amp could not load it: ${broken.error}`);
    }
    ctx.scanNameList(
      (listing.skills ?? []).map((s) => s.name),
      ["skill"],
      "amp skill list",
    );
    // Starts every MCP server and lists its tools, which the server logs record.
    await ctx.run(["amp", "tools", "list", "--json"], { timeoutMs: 60_000 });
  },
  listed: [],
  hookEvents: [],
};
