import { join } from "node:path";
import { STATE_DIR, scopeRoot } from "../executor/ledger";
import type { Handler, PlanCtx, ScopedLoc } from "../harness/define";
import type { HookNode } from "../ir/nodes";
import { renderHooksDir } from "../ir/templates";
import type { ConfigFormat, FileOp, JsonValue, Op } from "../ops/types";
import type { HookEvent } from "../schema/manifest";

/** A hook as a harness needs it: its own event name, its own tool names, a runnable command. */
export interface NativeHook {
  name: string;
  event: string;
  /** The harness's names for the tools the hook applies to, or `undefined` for every tool. */
  tools?: string[];
  command: string;
  timeoutSec?: number;
}

/**
 * The package's hook files, installed once per scope under the engine's own directory and shared
 * by every harness, so a hook script exists in one place however many harnesses call it.
 */
function hookFiles(ctx: PlanCtx): { dir: string; ops: FileOp[] } {
  const dir = join(scopeRoot(ctx.scope, ctx.env), STATE_DIR, ctx.pkg.name, "hooks");
  const ops: FileOp[] = ctx.pkg.hookFiles.map((file) => ({
    type: "file",
    path: join(dir, ...file.rel.split("/")),
    content: file.bytes,
    executable: file.executable,
  }));
  return { dir, ops };
}

/**
 * How a hook command spells the directory its files are in. A user install is under the home
 * directory. A repository install is under the project, which a hook's working directory is not
 * guaranteed to be, so the harness's own variable for it is used when it has one.
 */
function hooksDirExpression(ctx: PlanCtx, projectDir: string | undefined): string {
  const rel = `${STATE_DIR}/${ctx.pkg.name}/hooks`;
  if (ctx.scope === "user") return `"$HOME/${rel}"`;
  return projectDir ? `"${projectDir}/${rel}"` : rel;
}

export interface HookEventsOptions {
  /** Canonical event to this harness's event name. An event left out is one the harness lacks. */
  events: Partial<Record<HookEvent, string>>;
  /**
   * A shell expression for the project directory inside a hook command, usually a variable the
   * harness sets: `$CLAUDE_PROJECT_DIR`. Without one, a repository install uses a relative path.
   */
  projectDir?: string;
  /**
   * The harness's names for tools in a hook matcher, when they are not the ones its subagent
   * tool lists use. A tool mapped to `null` cannot be matched.
   */
  tools?: Record<string, string | null>;
}

function toNative(node: HookNode, ctx: PlanCtx, options: HookEventsOptions): NativeHook | string {
  const event = options.events[node.event];
  if (!event) return `${ctx.harness.label} has no ${node.event} hook`;
  let tools: string[] | undefined;
  if (node.matcher) {
    tools = [];
    for (const tool of node.matcher) {
      const native = (options.tools ?? ctx.harness.dialect.tools)[tool];
      if (native === undefined) tools.push(tool);
      else if (native !== null && !tools.includes(native)) tools.push(native);
    }
    // A hook meant for some tools must not quietly become a hook on all of them.
    if (tools.length === 0)
      return `${ctx.harness.label} has none of the tools this hook matches (${node.matcher.join(", ")})`;
  }
  return {
    name: `${ctx.pkg.name}-${node.name}`,
    event,
    tools,
    command: renderHooksDir(node.command, hooksDirExpression(ctx, options.projectDir)),
    timeoutSec: node.timeoutSec,
  };
}

export interface HooksConfigOptions extends HookEventsOptions {
  /** The config file hooks are registered in, per scope. */
  file: ScopedLoc;
  format: ConfigFormat;
  /** Where the list of registrations for an event is. */
  keyPath: (hook: NativeHook, ctx: PlanCtx) => string[];
  /** One registration, as an element of that list. */
  item: (hook: NativeHook) => JsonValue;
  /** Keys the file needs beside the registrations, such as a format version. */
  preamble?: Array<{ keyPath: string[]; value: JsonValue }>;
  /** Other harnesses' hook files this harness also runs hooks from, per scope. */
  alsoReads?: ScopedLoc[];
}

/**
 * Hooks registered as elements of a list in a config file, which is how Claude Code does it and
 * most harnesses since. The engine owns the element it adds and nothing else in the list.
 */
export function hooksConfig(options: HooksConfigOptions): Handler<"hook"> {
  return {
    plan(node, ctx) {
      const file = options.file[ctx.scope];
      if (!file) return { skip: `no ${ctx.scope}-scope hook configuration` };
      const hook = toNative(node, ctx, options);
      if (typeof hook === "string") return { skip: hook };
      const path = file(ctx);
      const ops: Op[] = hookFiles(ctx).ops;
      ops.push({
        type: "config-item",
        path,
        format: options.format,
        keyPath: options.keyPath(hook, ctx),
        value: options.item(hook),
        preamble: options.preamble,
        coveredBy: (options.alsoReads ?? []).flatMap((loc) => {
          const other = loc[ctx.scope];
          return other ? [other(ctx)] : [];
        }),
      });
      return ops;
    },
  };
}

export interface HookFilesOptions extends HookEventsOptions {
  /** The directory hook definition files go in, per scope. */
  dir: ScopedLoc;
  /** The file for one hook: its name and its JSON content. */
  file: (hook: NativeHook) => { name: string; content: JsonValue };
}

/** Hooks as one definition file each in a directory the harness scans. */
export function hooksDir(options: HookFilesOptions): Handler<"hook"> {
  return {
    plan(node, ctx) {
      const dir = options.dir[ctx.scope];
      if (!dir) return { skip: `no ${ctx.scope}-scope hook directory` };
      const hook = toNative(node, ctx, options);
      if (typeof hook === "string") return { skip: hook };
      const { name, content } = options.file(hook);
      return [
        ...hookFiles(ctx).ops,
        { type: "file", path: join(dir(ctx), name), content: `${JSON.stringify(content, null, 2)}\n` },
      ];
    },
  };
}

/** The registration shape Claude Code defined, which several harnesses adopted unchanged. */
export function claudeStyleHook(hook: NativeHook): JsonValue {
  const entry: Record<string, JsonValue> = { type: "command", command: hook.command };
  if (hook.timeoutSec) entry.timeout = hook.timeoutSec;
  return { ...(hook.tools ? { matcher: hook.tools.join("|") } : {}), hooks: [entry] };
}

/** Claude Code's settings files, which several harnesses also run hooks from. */
export const CLAUDE_HOOKS: ScopedLoc = {
  user: ({ env }) => join(env.home, ".claude", "settings.json"),
  local: ({ env }) => join(env.projectRoot, ".claude", "settings.json"),
};

/** A matcher that must equal a whole tool name, for harnesses that test theirs as an unanchored regex. */
export const anchored = (tools: string[]): string => `^(${tools.join("|")})$`;
