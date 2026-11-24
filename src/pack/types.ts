import type { Package } from "../ir/nodes";

export interface PackFile {
  /** Path relative to the package root, with forward slashes. */
  path: string;
  content: string | Uint8Array;
}

export interface PackOutput {
  files: PackFile[];
  /** Directories the target owns outright: anything in them it did not just produce is stale. */
  ownedDirs?: string[];
}

/**
 * A pack target turns the package into one harness's native plugin format, written into the
 * package's own repository for that harness's marketplace to read. It is the same content a
 * vendored install writes, delivered by the harness instead of by the engine.
 */
export interface PackTarget {
  id: string;
  label: string;
  pack(pkg: Package, options: Record<string, unknown>): PackOutput;
}

export const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
