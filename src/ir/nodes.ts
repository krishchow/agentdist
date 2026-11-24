import type { AgentPkg, Hook, HttpServer, StdioServer } from "../schema/manifest";
import type { Doc } from "./markdown";

/**
 * The intermediate representation: what a package is, with nothing about any harness in it.
 * Every harness answers for every node kind, so adding a kind here is a compile error in each
 * harness until it says what it does with it.
 */

export interface SkillFile {
  /** Path inside the folder it was read from, with forward slashes. */
  rel: string;
  bytes: Uint8Array;
  /** Text files have their symbolic references resolved; other files are copied untouched. */
  text: boolean;
  executable: boolean;
}

export interface SkillNode {
  kind: "skill";
  name: string;
  description: string;
  doc: Doc;
  /** Everything in the skill folder except `SKILL.md`. */
  files: SkillFile[];
}

export interface AgentNode {
  kind: "agent";
  name: string;
  description: string;
  /** Canonical tool names (`Read`, `Bash`, ...) and `mcp:<server>.<tool>` grants. Absent means all. */
  tools?: string[];
  model?: string;
  doc: Doc;
}

export interface CommandNode {
  kind: "command";
  name: string;
  description?: string;
  argumentHint?: string;
  doc: Doc;
}

export interface StdioServerNode extends StdioServer {
  kind: "mcpServer";
  name: string;
}
export interface HttpServerNode extends HttpServer {
  kind: "mcpServer";
  name: string;
}
export type McpServerNode = StdioServerNode | HttpServerNode;

export interface HookNode extends Hook {
  kind: "hook";
  name: string;
}

export type Node = SkillNode | AgentNode | CommandNode | McpServerNode | HookNode;
export type NodeKind = Node["kind"];
export type NodeOf<K extends NodeKind> = Extract<Node, { kind: K }>;

export const NODE_KINDS = [
  "skill",
  "agent",
  "command",
  "mcpServer",
  "hook",
] as const satisfies readonly NodeKind[];

export interface Package {
  /** Absolute path of the directory holding `agentpkg.json`. */
  root: string;
  name: string;
  version: string;
  manifest: AgentPkg;
  nodes: Node[];
  /** The contents of `hooksDir`: what the hook commands run. */
  hookFiles: SkillFile[];
}

export function nodeId(node: Node): string {
  return `${node.kind}:${node.name}`;
}

/**
 * The name an artifact is installed under when it is vendored into a directory it shares with the
 * user's own and other packages' artifacts.
 */
export function installedName(pkg: Pick<Package, "name" | "manifest">, name: string): string {
  if (pkg.manifest.namespace === "none") return name;
  if (name === pkg.name || name.startsWith(`${pkg.name}-`)) return name;
  return `${pkg.name}-${name}`;
}
