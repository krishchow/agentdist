import { isAbsolute, join, relative, sep } from "node:path";
import type { Dialect, Env, HarnessDef, PlanCtx, Skip } from "../harness/define";
import { installedName, type Node, nodeId, type Package } from "../ir/nodes";
import { type Ref, replaceRefs } from "../ir/refs";
import type { Scope } from "../schema/manifest";
import {
  type Claim,
  configKey,
  type Diagnostic,
  type FileOp,
  type Op,
  type Plan,
  type PlannedConfig,
  type PlannedFile,
} from "./types";

export function configRootOf(harness: HarnessDef, scope: Scope, env: Env): string {
  return scope === "user" ? harness.configRoot.user(env) : join(env.projectRoot, harness.configRoot.local);
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** A path as content should spell it: `~/…` under home, repo-relative in a project. */
export function displayPath(abs: string, scope: Scope, env: Env): string {
  const posix = (p: string) => p.split(sep).join("/");
  if (scope === "local" && isInside(env.projectRoot, abs))
    return posix(relative(env.projectRoot, abs)) || ".";
  if (isInside(env.home, abs)) return `~/${posix(relative(env.home, abs))}`;
  return posix(abs);
}

export function makeCtx(
  pkg: Package,
  harness: HarnessDef,
  scope: Scope,
  env: Env,
  warn: (message: string) => void,
  dialect: Dialect = harness.dialect,
): PlanCtx {
  const installed = (name: string) => installedName(pkg, name);
  const show = (abs: string) => harness.showPath?.(abs, env) ?? displayPath(abs, scope, env);
  const renderRef = (ref: Ref, skillDir?: string): string => {
    switch (ref.type) {
      case "tool":
        return dialect.toolRef(ref.server, ref.tool);
      case "skill":
        return dialect.skillRef(installed(ref.name));
      case "agent":
        return dialect.agentRef(installed(ref.name));
      case "command":
        return dialect.commandRef(installed(ref.name));
      case "skill_dir":
        return skillDir ? show(skillDir) : "{{skill_dir}}";
      case "pkg.name":
        return pkg.name;
      case "pkg.version":
        return pkg.version;
    }
  };
  return {
    env,
    configRoot: configRootOf(harness, scope, env),
    pkg,
    scope,
    harness,
    installed,
    renderRef,
    render: (text, skillDir) => replaceRefs(text, (ref) => renderRef(ref, skillDir)),
    displayPath: show,
    withDialect: (other) => makeCtx(pkg, harness, scope, env, warn, other),
    warn,
  };
}

function sameContent(a: string | Uint8Array, b: string | Uint8Array): boolean {
  return Buffer.from(a).equals(Buffer.from(b));
}

/**
 * Ask every selected harness what each node becomes, then merge. Two harnesses that read the same
 * directory produce the same op, which is planned once and claimed by both; that is how
 * `.agents/skills` is written a single time however many harnesses share it.
 */
export function planInstall(pkg: Package, harnesses: HarnessDef[], scope: Scope, env: Env): Plan {
  const files = new Map<string, PlannedFile>();
  const configs = new Map<string, PlannedConfig>();
  const diagnostics: Diagnostic[] = [];
  const show = (abs: string) => displayPath(abs, scope, env);
  const label = (id: string | undefined) => harnesses.find((h) => h.id === id)?.label ?? id;

  const proposed: Array<{ op: Op; claim: Claim; harness: HarnessDef }> = [];
  for (const harness of harnesses) {
    let current: Node | undefined;
    const note = (level: Diagnostic["level"], message: string) =>
      diagnostics.push({ level, harness: harness.id, node: current ? nodeId(current) : undefined, message });
    const ctx = makeCtx(pkg, harness, scope, env, (message) => note("warn", message));

    for (const node of pkg.nodes) {
      current = node;
      const handler = harness.kinds[node.kind] as { plan(n: Node, c: PlanCtx): Op[] | Skip };
      const result = handler.plan(node, ctx);
      if (!Array.isArray(result)) {
        note("info", `skipped: ${result.skip}`);
        continue;
      }
      const claim: Claim = { harness: harness.id, node: nodeId(node) };
      for (const op of result) proposed.push({ op, claim, harness });
    }
  }

  const claimFile = (path: string, op: FileOp, claim: Claim, harness: HarnessDef, borrowed = false) => {
    const existing = files.get(path);
    if (!existing) {
      const { satisfiedBy: _, ...file } = op;
      files.set(path, { ...file, path, claims: [claim] });
      return;
    }
    // A harness borrowing the copy in another harness's own directory reads that rendering anyway.
    if (!borrowed && !sameContent(existing.content, op.content)) {
      const first = label(existing.claims[0]?.harness);
      diagnostics.push({
        level: "warn",
        harness: harness.id,
        node: claim.node,
        message: `${show(path)} is shared with ${first} but renders differently for ${harness.label}; the ${first} rendering is installed`,
      });
    }
    existing.claims.push(claim);
  };

  // Files a harness writes unconditionally come first, so that a harness able to read the same
  // artifact from somewhere else can see what will already be there.
  for (const { op, claim, harness } of proposed) {
    if (op.type === "file" && !op.satisfiedBy?.length) claimFile(op.path, op, claim, harness);
  }
  for (const { op, claim, harness } of proposed) {
    if (op.type !== "file" || !op.satisfiedBy?.length) continue;
    const elsewhere = files.has(op.path) ? undefined : op.satisfiedBy.find((path) => files.has(path));
    claimFile(elsewhere ?? op.path, op, claim, harness, elsewhere !== undefined);
  }

  for (const { op, claim, harness } of proposed) {
    if (op.type !== "config") continue;
    const key = configKey(op);
    const existing = configs.get(key);
    if (!existing) {
      configs.set(key, { ...op, claims: [claim] });
      continue;
    }
    if (JSON.stringify(existing.value) !== JSON.stringify(op.value)) {
      const first = label(existing.claims[0]?.harness);
      diagnostics.push({
        level: "warn",
        harness: harness.id,
        node: claim.node,
        message: `${show(op.path)} → ${op.keyPath.join(".")} is shared with ${first} but differs for ${harness.label}; the ${first} entry is installed`,
      });
    }
    existing.claims.push(claim);
  }

  return { files: [...files.values()], configs: [...configs.values()], diagnostics };
}
