/**
 * Ops are the whole vocabulary a harness adapter has. An adapter never touches the filesystem: it
 * describes what should exist, and the executor is the only code that writes, records ownership,
 * backs up and rolls back.
 */

import type { NodeKind } from "../ir/nodes";

export type ConfigFormat = "json" | "jsonc" | "toml" | "yaml";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A whole file the package owns. */
export interface FileOp {
  type: "file";
  /** Absolute path. */
  path: string;
  content: string | Uint8Array;
  executable?: boolean;
  /**
   * Other paths the harness would read this same artifact from. If another harness in the plan
   * already writes one of them, this op is dropped and that file is claimed instead, so the
   * harness does not end up listing the artifact twice.
   */
  satisfiedBy?: string[];
}

/** One key the package owns inside a config file that belongs to the user. */
export interface ConfigOp {
  type: "config";
  /** Absolute path. */
  path: string;
  format: ConfigFormat;
  keyPath: string[];
  value: JsonValue;
}

/**
 * One element the package owns inside an array in a config file that belongs to the user, such as
 * a hook registration. It is identified by its value: the same element is never added twice, and
 * only an element still equal to what was written is ever removed.
 */
export interface ConfigItemOp {
  type: "config-item";
  /** Absolute path. */
  path: string;
  format: ConfigFormat;
  /** Where the array is. */
  keyPath: string[];
  value: JsonValue;
  /**
   * Other config files the harness would also act on this registration from. If another harness
   * in the plan registers the same node in one of them, this op is dropped, so that a hook does
   * not run twice in a harness that reads its neighbour's settings as well as its own.
   */
  coveredBy?: string[];
  /** Keys the file needs beside the element, such as a format version. Written only if the element is. */
  preamble?: Array<{ keyPath: string[]; value: JsonValue }>;
}

export type Op = FileOp | ConfigOp | ConfigItemOp;

export interface Claim {
  harness: string;
  /** `kind:name` of the node the op came from. */
  node: string;
}

export interface PlannedFile extends FileOp {
  claims: Claim[];
}
export interface PlannedConfig extends ConfigOp {
  claims: Claim[];
}

export interface PlannedItem extends ConfigItemOp {
  claims: Claim[];
}

export interface Diagnostic {
  /** `info`: something skipped; `warn`: something changed or lost; `next`: what the user does now. */
  level: "info" | "warn" | "next";
  harness: string;
  node?: string;
  message: string;
  /** For `next`: the kinds of artifact it is about, or every kind when absent. */
  kinds?: NodeKind[];
}

export interface Plan {
  files: PlannedFile[];
  configs: PlannedConfig[];
  items: PlannedItem[];
  diagnostics: Diagnostic[];
}

export function configKey(op: Pick<ConfigOp, "path" | "keyPath">): string {
  return `${op.path}\u0000${op.keyPath.join("\u0000")}`;
}
