/**
 * Ops are the whole vocabulary a harness adapter has. An adapter never touches the filesystem: it
 * describes what should exist, and the executor is the only code that writes, records ownership,
 * backs up and rolls back.
 */

export type ConfigFormat = "json" | "jsonc" | "toml" | "yaml";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A whole file the package owns. */
export interface FileOp {
  type: "file";
  /** Absolute path. */
  path: string;
  content: string | Uint8Array;
  executable?: boolean;
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

export type Op = FileOp | ConfigOp;

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

export interface Diagnostic {
  level: "info" | "warn";
  harness: string;
  node?: string;
  message: string;
}

export interface Plan {
  files: PlannedFile[];
  configs: PlannedConfig[];
  diagnostics: Diagnostic[];
}

export function configKey(op: Pick<ConfigOp, "path" | "keyPath">): string {
  return `${op.path}\u0000${op.keyPath.join("\u0000")}`;
}
