import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { z } from "zod";
import type { Env } from "../harness/define.js";
import { Scope } from "../schema/manifest.js";

/**
 * The ledger is the engine's record of what it wrote for one package at one scope. It is the only
 * basis for deleting anything: a file or config key that is not in the ledger is the user's.
 *
 * Entries are keyed by destination and list every harness that needs them, so a directory several
 * harnesses read is written once and survives until the last of them is uninstalled.
 */
export const Ledger = z.object({
  ledgerVersion: z.literal(1),
  package: z.string(),
  version: z.string(),
  scope: Scope,
  engine: z.string(),
  installedAt: z.string(),
  harnesses: z.array(z.string()),
  files: z.record(
    z.string(),
    z.object({
      hash: z.string(),
      harnesses: z.array(z.string()),
      /** The `kind:name` of the package node the file belongs to. */
      node: z.string().optional(),
    }),
  ),
  configs: z.array(
    z.object({
      path: z.string(),
      format: z.enum(["json", "jsonc", "toml", "yaml"]),
      keyPath: z.array(z.string()),
      hash: z.string(),
      harnesses: z.array(z.string()),
      /** The engine created the file, so it may delete it again once nothing is left in it. */
      createdFile: z.boolean().optional(),
      /**
       * The entry was already there, identical, before the package was installed. It is not
       * removed on uninstall: something else put it there and may still need it.
       */
      adopted: z.boolean().optional(),
    }),
  ),
  /** Elements owned inside arrays in the user's config files, identified by the hash of their value. */
  items: z
    .array(
      z.object({
        path: z.string(),
        format: z.enum(["json", "jsonc", "toml", "yaml"]),
        keyPath: z.array(z.string()),
        hash: z.string(),
        harnesses: z.array(z.string()),
        createdFile: z.boolean().optional(),
      }),
    )
    .default([]),
});
export type Ledger = z.infer<typeof Ledger>;

export const STATE_DIR = ".agentdist";

/** The directory a scope's paths are recorded relative to: the repository, or the user's home. */
export function scopeRoot(scope: Scope, env: Env): string {
  return scope === "user" ? env.home : env.projectRoot;
}

export function ledgerPath(pkgName: string, scope: Scope, env: Env): string {
  return join(scopeRoot(scope, env), STATE_DIR, `${pkgName}.json`);
}

export function readLedger(pkgName: string, scope: Scope, env: Env): Ledger | undefined {
  const path = ledgerPath(pkgName, scope, env);
  if (!existsSync(path)) return undefined;
  const parsed = Ledger.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new Error(`${path} is not a ledger this version of the engine can read`);
  return parsed.data;
}

/** Paths under the scope root are stored relative, so a committed local ledger works on any machine. */
export function toLedgerPath(abs: string, root: string): string {
  const rel = relative(root, abs);
  return rel.startsWith("..") || isAbsolute(rel) ? abs : rel.split(sep).join("/");
}

export function fromLedgerPath(stored: string, root: string): string {
  return isAbsolute(stored) ? stored : join(root, ...stored.split("/"));
}

export function hashBytes(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}
