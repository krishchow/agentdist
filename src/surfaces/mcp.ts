import type { Handler, PlanCtx, ScopedLoc } from "../harness/define";
import type { McpServerNode } from "../ir/nodes";
import type { ConfigFormat, JsonValue } from "../ops/types";

export type McpEntry = (server: McpServerNode, ctx: PlanCtx) => JsonValue;

export interface McpConfigOptions {
  /** The config file per scope. It belongs to the user: the engine only ever owns one key in it. */
  file: ScopedLoc;
  format: ConfigFormat;
  /**
   * Where server entries live, e.g. `["mcpServers"]` or `["mcp_servers"]`. A function when the
   * harness has more than one config dialect and the file on disk says which is in use.
   */
  keyPath: string[] | ((file: string, ctx: PlanCtx) => string[]);
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
      const path = file(ctx);
      const keyPath = typeof options.keyPath === "function" ? options.keyPath(path, ctx) : options.keyPath;
      return [
        {
          type: "config",
          path,
          format: options.format,
          keyPath: [...keyPath, node.name],
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

export interface StdioEntryOptions {
  /**
   * For a harness that does not start servers with the user's whole environment: how its config
   * refers to a host variable, e.g. `(name) => "${" + name + "}"`. Each `envPassthrough` name is
   * then written into `env` as such a reference. Harnesses that inherit the environment omit this,
   * and nothing is written for those variables.
   */
  envRef?: (name: string) => string;
  /** Field name and unit for the per-call tool timeout, where the harness has one. */
  toolTimeout?: { field: string; unit: "s" | "ms" };
}

/** `env`, with a reference for each passed-through variable when the harness needs one. */
export function entryEnv(server: McpServerNode, envRef?: (name: string) => string): Record<string, string> {
  const refs = envRef ? Object.fromEntries(server.envPassthrough.map((name) => [name, envRef(name)])) : {};
  return { ...refs, ...server.env };
}

/** The entry shape most harnesses share: `{ command, args, env }`, with `extra` fields first. */
export function stdioEntry(extra: Record<string, JsonValue> = {}, options: StdioEntryOptions = {}): McpEntry {
  return (server) => {
    const timeout = options.toolTimeout;
    return compact({
      ...extra,
      command: server.command,
      args: server.args,
      env: entryEnv(server, options.envRef),
      ...(timeout && server.toolTimeoutSec
        ? { [timeout.field]: server.toolTimeoutSec * (timeout.unit === "ms" ? 1000 : 1) }
        : {}),
    });
  };
}

export { compact as compactEntry };
