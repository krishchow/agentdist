import type { Handler, PlanCtx, ScopedLoc, Skip } from "../harness/define.js";
import type { HttpServerNode, StdioServerNode } from "../ir/nodes.js";
import { envRefs, renderEnvRefs } from "../ir/templates.js";
import type { ConfigFormat, JsonValue } from "../ops/types.js";

export type StdioEntry = (server: StdioServerNode, ctx: PlanCtx) => JsonValue;
export type HttpEntry = (server: HttpServerNode, ctx: PlanCtx) => JsonValue | Skip;

export interface McpConfigOptions {
  /** The config file per scope. It belongs to the user: the engine only ever owns one key in it. */
  file: ScopedLoc;
  format: ConfigFormat;
  /**
   * Where server entries live, e.g. `["mcpServers"]` or `["mcp_servers"]`. A function when the
   * harness has more than one config dialect and the file on disk says which is in use.
   */
  keyPath: string[] | ((file: string, ctx: PlanCtx) => string[]);
  /** The shape of a server the harness starts as a subprocess. */
  stdio: StdioEntry;
  /** The shape of a server reached over HTTP, or why the harness cannot be given one. */
  http: HttpEntry | string;
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
      let value: JsonValue | Skip;
      if (node.transport === "stdio") value = options.stdio(node, ctx);
      else if (typeof options.http === "string") return { skip: options.http };
      else value = options.http(node, ctx);
      if (isSkip(value)) return value;
      const path = file(ctx);
      const keyPath = typeof options.keyPath === "function" ? options.keyPath(path, ctx) : options.keyPath;
      return [{ type: "config", path, format: options.format, keyPath: [...keyPath, node.name], value }];
    },
  };
}

function isSkip(value: JsonValue | Skip): value is Skip {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value) && typeof value.skip === "string"
  );
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
export function entryEnv(server: StdioServerNode, envRef?: (name: string) => string): Record<string, string> {
  const refs = envRef ? Object.fromEntries(server.envPassthrough.map((name) => [name, envRef(name)])) : {};
  return { ...refs, ...server.env };
}

/** The entry shape most harnesses share: `{ command, args, env }`, with `extra` fields first. */
export function stdioEntry(
  extra: Record<string, JsonValue> = {},
  options: StdioEntryOptions = {},
): StdioEntry {
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

export interface HttpEntryOptions {
  /** Field name for the endpoint. Most harnesses call it `url`. */
  url?: string;
  headers?: string;
  /**
   * How this harness's config refers to a host environment variable inside a header value. Leave
   * it out for a harness whose header values are literal: a server that needs a variable is then
   * skipped with an explanation, because the alternative is writing the secret into the file.
   */
  envRef?: (name: string) => string;
  toolTimeout?: { field: string; unit: "s" | "ms" };
}

/** Header values with `{{env:NAME}}` rendered in the harness's own reference syntax. */
export function entryHeaders(
  server: HttpServerNode,
  envRef: (name: string) => string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(server.headers).map(([name, value]) => [name, renderEnvRefs(value, envRef)]),
  );
}

/** The variables a server's headers need from the user's environment. */
export function headerEnv(server: HttpServerNode): string[] {
  return [...new Set(Object.values(server.headers).flatMap(envRefs))];
}

/** The entry shape most harnesses share for a remote server: `{ url, headers }`, with `extra` first. */
export function httpEntry(extra: Record<string, JsonValue> = {}, options: HttpEntryOptions = {}): HttpEntry {
  return (server, ctx) => {
    const needs = headerEnv(server);
    if (needs.length > 0 && !options.envRef) {
      return {
        skip: `${ctx.harness.label} cannot read ${needs.join(", ")} from the environment for a remote server's headers; add the header to its config by hand`,
      };
    }
    const timeout = options.toolTimeout;
    return compact({
      ...extra,
      [options.url ?? "url"]: server.url,
      [options.headers ?? "headers"]: entryHeaders(server, options.envRef ?? ((name) => name)),
      ...(timeout && server.toolTimeoutSec
        ? { [timeout.field]: server.toolTimeoutSec * (timeout.unit === "ms" ? 1000 : 1) }
        : {}),
    });
  };
}

export { compact as compactEntry };
