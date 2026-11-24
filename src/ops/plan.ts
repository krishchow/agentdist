import { isAbsolute, join, relative, sep } from "node:path";
import type { Env, HarnessDef, PlanCtx } from "../harness/define";
import { installedName, type Node, nodeId, type Package } from "../ir/nodes";
import { type Ref, replaceRefs } from "../ir/refs";
import type { Scope } from "../schema/manifest";
import { type Claim, configKey, type Diagnostic, type Plan, type PlannedConfig, type PlannedFile } from "./types";

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
  if (scope === "local" && isInside(env.projectRoot, abs)) return posix(relative(env.projectRoot, abs)) || ".";
  if (isInside(env.home, abs)) return `~/${posix(relative(env.home, abs))}`;
  return posix(abs);
}

export function makeCtx(
  pkg: Package,
  harness: HarnessDef,
  scope: Scope,
  env: Env,
  warn: (message: string) => void,
): PlanCtx {
  const installed = (name: string) => installedName(pkg, name);
  const show = (abs: string) => displayPath(abs, scope, env);
  const renderRef = (ref: Ref, skillDir?: string): string => {
    switch (ref.type) {
      case "tool":
        return harness.dialect.toolRef(ref.server, ref.tool);
      case "skill":
        return harness.dialect.skillRef(installed(ref.name));
      case "agent":
        return harness.dialect.agentRef(installed(ref.name));
      case "command":
        return harness.dialect.commandRef(installed(ref.name));
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

  for (const harness of harnesses) {
    let current: Node | undefined;
    const note = (level: Diagnostic["level"], message: string) =>
      diagnostics.push({ level, harness: harness.id, node: current ? nodeId(current) : undefined, message });
    const ctx = makeCtx(pkg, harness, scope, env, (message) => note("warn", message));

    for (const node of pkg.nodes) {
      current = node;
      const handler = harness.kinds[node.kind] as { plan(n: Node, c: PlanCtx): ReturnType<HarnessDef["kinds"]["skill"]["plan"]> };
      const result = handler.plan(node, ctx);
      if (!Array.isArray(result)) {
        note("info", `skipped: ${result.skip}`);
        continue;
      }
      const claim: Claim = { harness: harness.id, node: nodeId(node) };
      for (const op of result) {
        if (op.type === "file") {
          const existing = files.get(op.path);
          if (!existing) files.set(op.path, { ...op, claims: [claim] });
          else {
            if (!sameContent(existing.content, op.content)) {
              const first = existing.claims[0]?.harness;
              note(
                "warn",
                `${displayPath(op.path, scope, env)} is shared with ${first} but renders differently for ${harness.label}; the ${first} rendering is installed`,
              );
            }
            existing.claims.push(claim);
          }
        } else {
          const key = configKey(op);
          const existing = configs.get(key);
          if (!existing) configs.set(key, { ...op, claims: [claim] });
          else {
            if (JSON.stringify(existing.value) !== JSON.stringify(op.value)) {
              const first = existing.claims[0]?.harness;
              note(
                "warn",
                `${displayPath(op.path, scope, env)} → ${op.keyPath.join(".")} is shared with ${first} but differs for ${harness.label}; the ${first} entry is installed`,
              );
            }
            existing.claims.push(claim);
          }
        }
      }
    }
  }

  return { files: [...files.values()], configs: [...configs.values()], diagnostics };
}
