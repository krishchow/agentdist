import type { NodeKind, NodeOf, Package } from "../ir/nodes";
import type { Ref } from "../ir/refs";
import type { Op } from "../ops/types";
import type { Scope } from "../schema/manifest";

/** Everything about the machine a plan depends on, injected so planning is a pure function. */
export interface Env {
  home: string;
  /** Root of the repository a `local` install targets. */
  projectRoot: string;
  vars: Record<string, string | undefined>;
  platform: NodeJS.Platform;
}

export interface LocCtx {
  env: Env;
  /** The harness's own config directory at the scope being planned. */
  configRoot: string;
}

/** A location, resolved against the environment at plan time. */
export type Loc = (ctx: LocCtx) => string;

/** A location per scope. A missing scope means the harness has no such surface there. */
export type ScopedLoc = Partial<Record<Scope, Loc>>;

/**
 * How a harness spells the things package content refers to symbolically. Rendering references is
 * the only content rewriting the engine does, so a dialect is small.
 */
export interface Dialect {
  /** An MCP tool, as the model must name it: `mcp__server__tool` in Claude Code. */
  toolRef(server: string, tool: string): string;
  skillRef(name: string): string;
  agentRef(name: string): string;
  commandRef(name: string): string;
  /**
   * Canonical built-in tool name to this harness's name, used for tool grants in frontmatter.
   * `null` means the harness has no equivalent and the grant is dropped with a warning.
   */
  tools: Record<string, string | null>;
  /** An MCP grant in a tool list. `tool` is `*` for the whole server. */
  mcpGrant(server: string, tool: string): string | null;
  /**
   * The harness has no per-subagent tool list at all, so dropped grants are reported once per
   * subagent instead of once per grant.
   */
  quietGrants?: boolean;
}

export interface PlanCtx extends LocCtx {
  pkg: Package;
  scope: Scope;
  harness: HarnessDef;
  /** The name an artifact is installed under, after namespacing. */
  installed(name: string): string;
  /** Resolve symbolic references in `text`. `skillDir` is the absolute directory of the skill it belongs to. */
  render(text: string, skillDir?: string): string;
  renderRef(ref: Ref, skillDir?: string): string;
  /** A path as content should spell it: `~/…` under home, repo-relative in a project. */
  displayPath(abs: string): string;
  warn(message: string): void;
}

export interface Skip {
  skip: string;
}

export interface Handler<K extends NodeKind> {
  /** Why the harness cannot take this kind at all. Shown to the user, never silently dropped. */
  unsupported?: string;
  plan(node: NodeOf<K>, ctx: PlanCtx): Op[] | Skip;
}

export function unsupported<K extends NodeKind>(reason: string): Handler<K> {
  return { unsupported: reason, plan: () => ({ skip: reason }) };
}

/**
 * A harness is a config home, a dialect, and one handler per node kind. The handlers come from the
 * shared surfaces in `src/surfaces`, so a harness file is mostly a statement of where things go.
 */
export interface HarnessDef {
  id: string;
  label: string;
  /** The harness's config directory at each scope. `local` is relative to the project root. */
  configRoot: { user: (env: Env) => string; local: string };
  /** Whether the harness looks installed on this machine, used only to preselect it in prompts. */
  detect(env: Env): boolean;
  dialect: Dialect;
  kinds: { [K in NodeKind]: Handler<K> };
  /**
   * How content should spell an absolute path, when the default (`~/…` or repo-relative) is wrong
   * because the harness relocates the files, as a plugin cache does.
   */
  showPath?: (abs: string, env: Env) => string;
  /** The documentation each path and shape in this file was checked against. */
  sources: string[];
}

export function defineHarness(def: HarnessDef): HarnessDef {
  return def;
}
