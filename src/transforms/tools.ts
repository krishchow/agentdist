import type { PlanCtx } from "../harness/define";

/**
 * Tool grants are written in the canonical dialect: Claude Code's built-in names (`Read`, `Bash`)
 * and, for MCP, either `mcp:<server>.<tool>` / `mcp:<server>` or Claude Code's own
 * `mcp__<server>__<tool>` spelling. Each harness maps them to its own names.
 */

interface McpGrant {
  server: string;
  tool: string;
}

function parseMcpGrant(grant: string, ctx: PlanCtx): McpGrant | undefined {
  if (grant.startsWith("mcp:")) {
    const [server, tool = "*"] = grant.slice(4).split(".", 2);
    return server ? { server, tool: tool || "*" } : undefined;
  }
  if (grant.startsWith("mcp__")) {
    // Server names may themselves contain underscores, so match against the declared servers.
    const servers = ctx.pkg.nodes.filter((n) => n.kind === "mcpServer").map((n) => n.name);
    for (const server of servers.sort((a, b) => b.length - a.length)) {
      if (grant === `mcp__${server}`) return { server, tool: "*" };
      if (grant.startsWith(`mcp__${server}__`))
        return { server, tool: grant.slice(`mcp__${server}__`.length) };
    }
  }
  return undefined;
}

/** Translate canonical grants, warning about and dropping the ones the harness cannot express. */
export function mapToolGrants(grants: string[], ctx: PlanCtx, what: string): string[] {
  const { dialect } = ctx.harness;
  const out: string[] = [];
  for (const grant of grants) {
    const mcp = parseMcpGrant(grant, ctx);
    // A parenthesised argument restriction, `Bash(git:*)`, belongs to the built-in before it.
    const builtin = grant.replace(/\(.*\)$/, "");
    let mapped: string | null | undefined;
    if (mcp) mapped = dialect.mcpGrant(mcp.server, mcp.tool);
    else if (builtin in dialect.tools) {
      const native = dialect.tools[builtin];
      mapped = native === null || native === undefined ? null : native === builtin ? grant : native;
    } else mapped = undefined;

    if (mapped === undefined) {
      ctx.warn(`${what}: tool grant "${grant}" is not a known tool; passed through unchanged`);
      out.push(grant);
    } else if (mapped === null) {
      ctx.warn(`${what}: ${ctx.harness.label} has no equivalent of "${grant}"; the grant was dropped`);
    } else if (!out.includes(mapped)) {
      out.push(mapped);
    }
  }
  return out;
}
