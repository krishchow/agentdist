import type { Handler, PlanCtx, ScopedLoc } from "../harness/define";
import type { McpServerNode } from "../ir/nodes";
import type { ConfigFormat, JsonValue } from "../ops/types";

export type McpEntry = (server: McpServerNode, ctx: PlanCtx) => JsonValue;

export interface McpConfigOptions {
  /** The config file per scope. It belongs to the user: the engine only ever owns one key in it. */
  file: ScopedLoc;
  format: ConfigFormat;
  /** Where server entries live, e.g. `["mcpServers"]` or `["mcp_servers"]`. */
  keyPath: string[];
  entry: McpEntry;
}

/**
 * Register an MCP server as one key in a config file. Format, key path and entry shape cover
 * every harness seen so far; the editing itself is the executor's job.
 */
export function mcpConfig(options: McpConfigOptions): Handler<"mcpServer"> {
  return {
    plan(node, ctx) {
      const file = options.file[ctx.scope];
      if (!file) return { skip: `no ${ctx.scope}-scope MCP configuration` };
      return [
        {
          type: "config",
          path: file(ctx),
          format: options.format,
          keyPath: [...options.keyPath, node.name],
          value: options.entry(node, ctx),
        },
      ];
    },
  };
}

function compact(record: Record<string, JsonValue | undefined>): JsonValue {
  return Object.fromEntries(
    Object.entries(record).filter(([, v]) => {
      if (v === undefined) return false;
      if (Array.isArray(v)) return true;
      return !(v !== null && typeof v === "object" && Object.keys(v).length === 0);
    }),
  ) as JsonValue;
}

/**
 * The entry shape most harnesses share: `{ command, args, env }`. Variables in `envPassthrough`
 * are not written, because these harnesses start the server with the user's environment.
 */
export function stdioEntry(extra: Record<string, JsonValue> = {}): McpEntry {
  return (server) => compact({ ...extra, command: server.command, args: server.args, env: server.env });
}

export { compact as compactEntry };
