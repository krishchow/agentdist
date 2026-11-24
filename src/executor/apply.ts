import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Env } from "../harness/define";
import { displayPath } from "../ops/plan";
import type { ConfigFormat, Diagnostic, Plan } from "../ops/types";
import type { Scope } from "../schema/manifest";
import { arrayAt, ConfigError, canonicalJson, editorFor } from "./config";
import {
  fromLedgerPath,
  hashBytes,
  type Ledger,
  ledgerPath,
  readLedger,
  STATE_DIR,
  scopeRoot,
  toLedgerPath,
} from "./ledger";

export type ActionType = "create" | "update" | "unchanged" | "adopt" | "remove" | "keep" | "backup";

export interface Action {
  type: ActionType;
  /** What was acted on, as a path the user can read. Config keys are `file → key.path`. */
  target: string;
  detail?: string;
  /** The `kind:name` of the package node a file belongs to, so output can group a skill's files. */
  node?: string;
}

/** Something the engine will not overwrite without being told to. */
export interface Conflict {
  target: string;
  reason: string;
}

export interface ApplyResult {
  applied: boolean;
  dryRun: boolean;
  actions: Action[];
  conflicts: Conflict[];
  diagnostics: Diagnostic[];
  ledgerFile: string;
  backupDir?: string;
}

/**
 * Every write of one run. It remembers what each path held before it was first touched, so a
 * failure part way through puts all of them back.
 */
class Transaction {
  private readonly before = new Map<string, Buffer | null>();
  backupDir?: string;

  constructor(
    private readonly dryRun: boolean,
    private readonly backupRoot: string,
    private readonly root: string,
  ) {}

  private remember(path: string): void {
    if (!this.before.has(path)) this.before.set(path, existsSync(path) ? readFileSync(path) : null);
  }

  write(path: string, content: string | Uint8Array, executable?: boolean): void {
    if (this.dryRun) return;
    // A config file may be a symlink into a dotfiles repository: write through it, not over it.
    const target = existsSync(path) ? realpathSync(path) : path;
    this.remember(target);
    const mode = existsSync(target) ? statSync(target).mode & 0o777 : executable ? 0o755 : 0o644;
    mkdirSync(dirname(target), { recursive: true });
    const temp = `${target}.agentpkg-${process.pid}.tmp`;
    writeFileSync(temp, content, { mode });
    renameSync(temp, target);
    if (executable) chmodSync(target, mode | 0o111);
  }

  remove(path: string, pruneUpTo: string): void {
    if (this.dryRun) return;
    this.remember(path);
    rmSync(path, { force: true });
    for (let dir = dirname(path); dir.startsWith(pruneUpTo) && dir !== pruneUpTo; dir = dirname(dir)) {
      if (!existsSync(dir) || readdirSync(dir).length > 0) break;
      rmdirSync(dir);
    }
  }

  /** Keep a copy of a file the user changed, before it is replaced or deleted. */
  backup(path: string): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.backupDir ??= join(this.backupRoot, stamp);
    const dest = join(this.backupDir, toLedgerPath(path, this.root).replace(/^\/+/, "").replaceAll(":", ""));
    if (!this.dryRun && !existsSync(dest)) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(path));
    }
    return dest;
  }

  rollback(): void {
    for (const [path, content] of this.before) {
      try {
        if (content === null) rmSync(path, { force: true });
        else {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, content);
        }
      } catch {
        // Best effort: the original failure is the one worth reporting.
      }
    }
  }
}

interface ConfigEdit {
  format: ConfigFormat;
  apply(text: string): string;
}

/** Remove the element whose value hashes to `hash`, if it is still there. */
function removeItemByHash(format: ConfigFormat, keyPath: string[], hash: string): (text: string) => string {
  return (text) => {
    const editor = editorFor(format);
    const index = arrayAt(editor, text, keyPath).findIndex((v) => hashBytes(canonicalJson(v)) === hash);
    return index < 0 ? text : editor.removeAt(text, keyPath, index);
  };
}

const sameItem = (
  a: { path: string; keyPath: string[]; hash: string },
  b: { path: string; keyPath: string[]; hash: string },
) => a.path === b.path && a.hash === b.hash && a.keyPath.join("\u0000") === b.keyPath.join("\u0000");

function readText(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export interface InstallOptions {
  pkg: { name: string; version: string };
  scope: Scope;
  env: Env;
  /** The complete desired state: every harness the package should be installed for afterwards. */
  plan: Plan;
  harnessIds: string[];
  engineVersion: string;
  dryRun?: boolean;
  /** Replace files and config keys that exist but are not the engine's, after backing them up. */
  force?: boolean;
}

/**
 * Make the scope match the plan. Whatever the previous install of this package owned and the plan
 * no longer wants is removed; nothing else is ever deleted.
 */
export function applyInstall(options: InstallOptions): ApplyResult {
  const { pkg, scope, env, plan } = options;
  const dryRun = options.dryRun ?? false;
  const root = scopeRoot(scope, env);
  const show = (abs: string) => displayPath(abs, scope, env);
  const previous = readLedger(pkg.name, scope, env);
  const ledgerFile = ledgerPath(pkg.name, scope, env);
  const txn = new Transaction(dryRun, join(root, STATE_DIR, "backup", pkg.name), root);

  const actions: Action[] = [];
  const conflicts: Conflict[] = [];
  const result = (applied: boolean): ApplyResult => ({
    applied,
    dryRun,
    actions,
    conflicts,
    diagnostics: plan.diagnostics,
    ledgerFile,
    backupDir: txn.backupDir,
  });

  // ── Decide everything before writing anything ──────────────────────────────
  const fileWrites: Array<{
    path: string;
    content: string | Uint8Array;
    executable?: boolean;
    backup: boolean;
  }> = [];
  const nextFiles: Ledger["files"] = {};
  for (const file of plan.files) {
    const key = toLedgerPath(file.path, root);
    const hash = hashBytes(file.content);
    const node = file.claims[0]?.node;
    nextFiles[key] = { hash, harnesses: [...new Set(file.claims.map((c) => c.harness))], node };
    const owned = previous?.files[key];

    if (!existsSync(file.path) && !isSymlink(file.path)) {
      actions.push({ type: "create", target: show(file.path), node });
      fileWrites.push({ ...file, backup: false });
      continue;
    }
    if (isSymlink(file.path) || !statSync(file.path).isFile()) {
      conflicts.push({ target: show(file.path), reason: "exists and is not a regular file" });
      continue;
    }
    const onDisk = hashBytes(readFileSync(file.path));
    if (onDisk === hash) {
      actions.push({ type: owned ? "unchanged" : "adopt", target: show(file.path), node });
    } else if (owned) {
      const edited = onDisk !== owned.hash;
      actions.push({
        type: "update",
        target: show(file.path),
        detail: edited ? "your edits were backed up" : undefined,
        node,
      });
      fileWrites.push({ ...file, backup: edited });
    } else if (options.force) {
      actions.push({
        type: "update",
        target: show(file.path),
        detail: "replaced a file that was not installed by this package; backed up",
      });
      fileWrites.push({ ...file, backup: true });
    } else {
      conflicts.push({
        target: show(file.path),
        reason: "already exists and was not installed by this package",
      });
    }
  }

  const staleFiles: Array<{ path: string; backup: boolean }> = [];
  for (const [key, entry] of Object.entries(previous?.files ?? {})) {
    if (key in nextFiles) continue;
    const path = fromLedgerPath(key, root);
    if (!existsSync(path)) continue;
    const edited = hashBytes(readFileSync(path)) !== entry.hash;
    actions.push({
      type: "remove",
      target: show(path),
      detail: edited ? "your edits were backed up" : undefined,
      node: entry.node,
    });
    staleFiles.push({ path, backup: edited });
  }

  const edits = new Map<string, ConfigEdit[]>();
  const queue = (path: string, edit: ConfigEdit) => edits.set(path, [...(edits.get(path) ?? []), edit]);
  const backupConfigs = new Set<string>();
  const mayDelete = new Set<string>();
  const nextConfigs: Ledger["configs"] = [];
  const sameKey = (a: { path: string; keyPath: string[] }, path: string, keyPath: string[]) =>
    a.path === path && a.keyPath.join("\u0000") === keyPath.join("\u0000");

  for (const config of plan.configs) {
    const stored = toLedgerPath(config.path, root);
    const target = `${show(config.path)} → ${config.keyPath.join(".")}`;
    const wanted = canonicalJson(config.value);
    const owned = previous?.configs.find((c) => sameKey(c, stored, config.keyPath));
    const createdFile =
      owned?.createdFile ??
      (previous?.configs.some((c) => c.path === stored && c.createdFile) || !existsSync(config.path));
    nextConfigs.push({
      path: stored,
      format: config.format,
      keyPath: config.keyPath,
      hash: hashBytes(wanted),
      harnesses: [...new Set(config.claims.map((c) => c.harness))],
      ...(createdFile ? { createdFile: true } : {}),
    });
    const record = nextConfigs.at(-1)!;
    if (owned?.adopted) record.adopted = true;
    let current: unknown;
    try {
      current = editorFor(config.format).get(readText(config.path), config.keyPath);
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      conflicts.push({ target: show(config.path), reason: `${e.message}; fix the file and run again` });
      continue;
    }
    if (current === undefined) {
      actions.push({ type: "create", target });
      queue(config.path, {
        format: config.format,
        apply: (text) => editorFor(config.format).set(text, config.keyPath, config.value),
      });
    } else if (canonicalJson(current) === wanted) {
      if (!owned) record.adopted = true;
      actions.push({ type: owned ? "unchanged" : "adopt", target });
    } else if (owned) {
      const edited = hashBytes(canonicalJson(current)) !== owned.hash;
      if (edited) backupConfigs.add(config.path);
      actions.push({ type: "update", target, detail: edited ? "your edits were backed up" : undefined });
      queue(config.path, {
        format: config.format,
        apply: (text) => editorFor(config.format).set(text, config.keyPath, config.value),
      });
    } else if (options.force) {
      backupConfigs.add(config.path);
      actions.push({
        type: "update",
        target,
        detail: "replaced an entry that was not installed by this package; backed up",
      });
      queue(config.path, {
        format: config.format,
        apply: (text) => editorFor(config.format).set(text, config.keyPath, config.value),
      });
    } else {
      conflicts.push({
        target,
        reason: "an entry with this name already exists and was not installed by this package",
      });
    }
  }

  for (const entry of previous?.configs ?? []) {
    if (nextConfigs.some((c) => sameKey(c, entry.path, entry.keyPath))) continue;
    if (entry.adopted) continue;
    const path = fromLedgerPath(entry.path, root);
    const target = `${show(path)} → ${entry.keyPath.join(".")}`;
    let current: unknown;
    try {
      current = editorFor(entry.format).get(readText(path), entry.keyPath);
    } catch {
      actions.push({
        type: "keep",
        target,
        detail: "the file could not be parsed, so the entry was left in place",
      });
      continue;
    }
    if (current === undefined) continue;
    if (hashBytes(canonicalJson(current)) !== entry.hash) {
      actions.push({ type: "keep", target, detail: "you edited this entry, so it was left in place" });
      continue;
    }
    actions.push({ type: "remove", target });
    queue(path, {
      format: entry.format,
      apply: (text) => editorFor(entry.format).remove(text, entry.keyPath),
    });
    if (entry.createdFile) mayDelete.add(path);
  }

  const nextItems: Ledger["items"] = [];
  for (const item of plan.items) {
    const stored = toLedgerPath(item.path, root);
    const target = `${show(item.path)} → ${item.keyPath.join(".")}[]`;
    const hash = hashBytes(canonicalJson(item.value));
    const record = { path: stored, keyPath: item.keyPath, hash };
    const owned = previous?.items.find((entry) => sameItem(entry, record));
    const createdFile =
      owned?.createdFile ??
      (previous?.items.some((entry) => entry.path === stored && entry.createdFile) || !existsSync(item.path));
    nextItems.push({
      ...record,
      format: item.format,
      harnesses: [...new Set(item.claims.map((c) => c.harness))],
      ...(createdFile ? { createdFile: true } : {}),
    });
    let present: boolean;
    try {
      const current = arrayAt(editorFor(item.format), readText(item.path), item.keyPath);
      present = current.some((value) => hashBytes(canonicalJson(value)) === hash);
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      conflicts.push({ target: show(item.path), reason: `${e.message}; fix the file and run again` });
      continue;
    }
    if (present) actions.push({ type: owned ? "unchanged" : "adopt", target });
    else {
      actions.push({ type: "create", target });
      queue(item.path, {
        format: item.format,
        apply: (text) => editorFor(item.format).append(text, item.keyPath, item.value),
      });
    }
  }
  for (const entry of previous?.items ?? []) {
    if (nextItems.some((next) => sameItem(next, entry))) continue;
    const path = fromLedgerPath(entry.path, root);
    let present = false;
    try {
      const current = arrayAt(editorFor(entry.format), readText(path), entry.keyPath);
      present = current.some((value) => hashBytes(canonicalJson(value)) === entry.hash);
    } catch {
      // Unparseable, or no longer a list: nothing of ours can be identified in it.
    }
    // An element the user edited no longer matches, and is theirs now.
    if (!present) continue;
    actions.push({ type: "remove", target: `${show(path)} → ${entry.keyPath.join(".")}[]` });
    queue(path, { format: entry.format, apply: removeItemByHash(entry.format, entry.keyPath, entry.hash) });
    if (entry.createdFile) mayDelete.add(path);
  }

  if (conflicts.length > 0) return result(false);

  // ── Apply ──────────────────────────────────────────────────────────────────
  try {
    for (const write of fileWrites) {
      if (write.backup)
        actions.push({ type: "backup", target: show(write.path), detail: show(txn.backup(write.path)) });
      txn.write(write.path, write.content, write.executable);
    }
    for (const stale of staleFiles) {
      if (stale.backup)
        actions.push({ type: "backup", target: show(stale.path), detail: show(txn.backup(stale.path)) });
      txn.remove(stale.path, root);
    }
    for (const [path, list] of edits) {
      if (backupConfigs.has(path))
        actions.push({ type: "backup", target: show(path), detail: show(txn.backup(path)) });
      let text = readText(path);
      for (const edit of list) text = edit.apply(text);
      if (mayDelete.has(path) && editorFor(list[0]!.format).isHollow(text)) txn.remove(path, root);
      else txn.write(path, text);
    }

    const ledger: Ledger = {
      ledgerVersion: 1,
      package: pkg.name,
      version: pkg.version,
      scope,
      engine: options.engineVersion,
      installedAt: new Date().toISOString(),
      harnesses: options.harnessIds,
      files: nextFiles,
      configs: nextConfigs,
      items: nextItems,
    };
    if (plan.files.length + plan.configs.length + plan.items.length === 0) txn.remove(ledgerFile, root);
    else txn.write(ledgerFile, `${JSON.stringify(ledger, null, 2)}\n`);
  } catch (error) {
    txn.rollback();
    throw error;
  }
  return result(true);
}

export interface UninstallOptions {
  pkgName: string;
  scope: Scope;
  env: Env;
  /** Harnesses to remove the package from. Omit to remove it from all of them. */
  harnessIds?: string[];
  dryRun?: boolean;
}

/**
 * Remove a package using only its ledger, so it works without the package's source. An entry
 * another harness still claims is kept.
 */
export function applyUninstall(options: UninstallOptions): ApplyResult {
  const { pkgName, scope, env } = options;
  const dryRun = options.dryRun ?? false;
  const root = scopeRoot(scope, env);
  const show = (abs: string) => displayPath(abs, scope, env);
  const ledgerFile = ledgerPath(pkgName, scope, env);
  const ledger = readLedger(pkgName, scope, env);
  const txn = new Transaction(dryRun, join(root, STATE_DIR, "backup", pkgName), root);
  const actions: Action[] = [];
  const result = (applied: boolean): ApplyResult => ({
    applied,
    dryRun,
    actions,
    conflicts: [],
    diagnostics: [],
    ledgerFile,
    backupDir: txn.backupDir,
  });
  if (!ledger) return result(false);

  const removing = new Set(options.harnessIds ?? ledger.harnesses);
  const remaining = (harnesses: string[]) => harnesses.filter((h) => !removing.has(h));

  try {
    const files: Ledger["files"] = {};
    for (const [key, entry] of Object.entries(ledger.files)) {
      const left = remaining(entry.harnesses);
      if (left.length > 0) {
        files[key] = { ...entry, harnesses: left };
        continue;
      }
      const path = fromLedgerPath(key, root);
      if (!existsSync(path)) continue;
      const edited = hashBytes(readFileSync(path)) !== entry.hash;
      if (edited) actions.push({ type: "backup", target: show(path), detail: show(txn.backup(path)) });
      actions.push({ type: "remove", target: show(path), node: entry.node });
      txn.remove(path, root);
    }

    const configs: Ledger["configs"] = [];
    const texts = new Map<string, string>();
    const mayDelete = new Map<string, ConfigFormat>();
    for (const entry of ledger.configs) {
      const left = remaining(entry.harnesses);
      if (left.length > 0) {
        configs.push({ ...entry, harnesses: left });
        continue;
      }
      if (entry.adopted) continue;
      const path = fromLedgerPath(entry.path, root);
      const target = `${show(path)} → ${entry.keyPath.join(".")}`;
      const editor = editorFor(entry.format);
      const text = texts.get(path) ?? readText(path);
      let current: unknown;
      try {
        current = editor.get(text, entry.keyPath);
      } catch {
        actions.push({
          type: "keep",
          target,
          detail: "the file could not be parsed, so the entry was left in place",
        });
        continue;
      }
      if (current === undefined) continue;
      if (hashBytes(canonicalJson(current)) !== entry.hash) {
        actions.push({ type: "keep", target, detail: "you edited this entry, so it was left in place" });
        continue;
      }
      actions.push({ type: "remove", target });
      texts.set(path, editor.remove(text, entry.keyPath));
      if (entry.createdFile) mayDelete.set(path, entry.format);
    }
    const items: Ledger["items"] = [];
    for (const entry of ledger.items) {
      const left = remaining(entry.harnesses);
      if (left.length > 0) {
        items.push({ ...entry, harnesses: left });
        continue;
      }
      const path = fromLedgerPath(entry.path, root);
      const text = texts.get(path) ?? readText(path);
      let next: string;
      try {
        next = removeItemByHash(entry.format, entry.keyPath, entry.hash)(text);
      } catch {
        continue;
      }
      // Unchanged text means the element is gone or was edited, and is the user's now.
      if (next === text) continue;
      actions.push({ type: "remove", target: `${show(path)} → ${entry.keyPath.join(".")}[]` });
      texts.set(path, next);
      if (entry.createdFile) mayDelete.set(path, entry.format);
    }
    for (const [path, text] of texts) {
      const format = mayDelete.get(path);
      if (format && editorFor(format).isHollow(text)) txn.remove(path, root);
      else txn.write(path, text);
    }

    const harnesses = remaining(ledger.harnesses);
    if (harnesses.length === 0 || Object.keys(files).length + configs.length + items.length === 0) {
      txn.remove(ledgerFile, root);
    } else {
      txn.write(ledgerFile, `${JSON.stringify({ ...ledger, harnesses, files, configs, items }, null, 2)}\n`);
    }
  } catch (error) {
    txn.rollback();
    throw error;
  }
  return result(true);
}
