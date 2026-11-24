import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { Package } from "../ir/nodes";
import type { PackTarget } from "./types";

export interface PackChange {
  path: string;
  change: "create" | "update" | "remove" | "unchanged";
}

export interface PackResult {
  changes: PackChange[];
  /** Whether everything on disk already matched. */
  clean: boolean;
  notes: string[];
}

function filesUnder(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path, base) : [relative(base, path).split(sep).join("/")];
  });
}

/**
 * Generate every pack target the manifest asks for. With `check`, nothing is written and the
 * result says whether the committed files are current, which is what CI runs.
 */
export function runPack(pkg: Package, targets: PackTarget[], options: { check?: boolean } = {}): PackResult {
  const wanted = Object.keys(pkg.manifest.pack);
  const unknown = wanted.filter((id) => !targets.some((t) => t.id === id));
  if (unknown.length > 0) {
    throw new Error(
      `unknown pack target ${unknown.map((u) => `"${u}"`).join(", ")}; known: ${targets.map((t) => t.id).join(", ")}`,
    );
  }
  const outputs = new Map<string, string | Uint8Array>();
  const owned: string[] = [];
  const notes: string[] = [];
  for (const target of targets.filter((t) => wanted.includes(t.id))) {
    const output = target.pack(pkg, pkg.manifest.pack[target.id] ?? {});
    for (const file of output.files) {
      const existing = outputs.get(file.path);
      if (existing !== undefined && !Buffer.from(existing).equals(Buffer.from(file.content))) {
        throw new Error(`two pack targets write different content to ${file.path}`);
      }
      outputs.set(file.path, file.content);
    }
    owned.push(...(output.ownedDirs ?? []));
    notes.push(...(output.notes ?? []).map((note) => `${target.id}: ${note}`));
  }

  const changes: PackChange[] = [];
  for (const [path, content] of outputs) {
    const abs = join(pkg.root, path);
    const change = !existsSync(abs)
      ? "create"
      : Buffer.from(content).equals(readFileSync(abs))
        ? "unchanged"
        : "update";
    changes.push({ path, change });
    if (change !== "unchanged" && !options.check) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
  }
  for (const dir of owned) {
    for (const rel of filesUnder(join(pkg.root, dir))) {
      const path = `${dir}/${rel}`;
      if (outputs.has(path)) continue;
      changes.push({ path, change: "remove" });
      if (!options.check) rmSync(join(pkg.root, path));
    }
  }
  return { changes, clean: changes.every((c) => c.change === "unchanged"), notes };
}
