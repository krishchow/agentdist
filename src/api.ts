import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { version as ENGINE_VERSION } from "../package.json";
import { type ApplyResult, applyInstall, applyUninstall } from "./executor/apply";
import { type Ledger, readLedger } from "./executor/ledger";
import type { Env, HarnessDef } from "./harness/define";
import { HARNESSES } from "./harnesses/index";
import { NODE_KINDS, type NodeKind, type Package } from "./ir/nodes";
import { planInstall } from "./ops/plan";
import type { Plan } from "./ops/types";
import { SCOPES, type Scope } from "./schema/manifest";
import { headerEnv } from "./surfaces/mcp";

export { ENGINE_VERSION };

/** The nearest ancestor holding a `.git`, which is where harnesses look for project config. */
export function findProjectRoot(cwd: string): string {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return resolve(cwd);
  }
}

export function realEnv(overrides: Partial<Env> = {}): Env {
  return {
    home: homedir(),
    projectRoot: findProjectRoot(process.cwd()),
    vars: process.env,
    platform: process.platform,
    ...overrides,
  };
}

/** The harnesses a package may be installed into: the engine's, narrowed by the manifest. */
export function allowedHarnesses(pkg: Package, harnesses: HarnessDef[] = HARNESSES): HarnessDef[] {
  const allow = pkg.manifest.harnesses;
  return allow ? harnesses.filter((h) => allow.includes(h.id)) : harnesses;
}

export interface Support {
  harness: HarnessDef;
  /** For each kind the package contains: `undefined` if the harness takes it, else why not. */
  kinds: Partial<Record<NodeKind, string | undefined>>;
}

/** What each harness can do with this package, for showing before the user chooses. */
export function describeSupport(pkg: Package, harnesses: HarnessDef[]): Support[] {
  const present = NODE_KINDS.filter((kind) => pkg.nodes.some((n) => n.kind === kind));
  return harnesses.map((harness) => ({
    harness,
    kinds: Object.fromEntries(present.map((kind) => [kind, harness.kinds[kind].unsupported])),
  }));
}

export interface InstallRequest {
  pkg: Package;
  harnesses: HarnessDef[];
  scope: Scope;
  env: Env;
  dryRun?: boolean;
  force?: boolean;
  /** Every harness the engine knows, to re-plan the ones a previous install already covers. */
  registry?: HarnessDef[];
}

export interface InstallOutcome extends ApplyResult {
  plan: Plan;
  /** The harnesses the package is installed for afterwards: the requested ones plus earlier ones. */
  harnessIds: string[];
}

/**
 * Install or update a package. Harnesses it was already installed for at this scope are re-planned
 * with the requested ones, so everything the package owns moves to the new version together.
 */
export function install(request: InstallRequest): InstallOutcome {
  const { pkg, scope, env } = request;
  if (!pkg.manifest.scopes.includes(scope)) {
    throw new Error(`${pkg.name} does not support ${scope}-scope installs`);
  }
  const registry = request.registry ?? HARNESSES;
  const previous = readLedger(pkg.name, scope, env);
  const harnesses = [...request.harnesses];
  for (const id of previous?.harnesses ?? []) {
    if (harnesses.some((h) => h.id === id)) continue;
    const known = registry.find((h) => h.id === id);
    if (!known) {
      throw new Error(
        `${pkg.name} is installed for "${id}", which this version of the engine does not know. Uninstall it for that harness first.`,
      );
    }
    harnesses.push(known);
  }
  const plan = planInstall(pkg, harnesses, scope, env);
  const harnessIds = harnesses.map((h) => h.id);
  const result = applyInstall({
    pkg,
    scope,
    env,
    plan,
    harnessIds,
    engineVersion: ENGINE_VERSION,
    dryRun: request.dryRun,
    force: request.force,
  });
  return { ...result, plan, harnessIds };
}

export interface UninstallRequest {
  pkgName: string;
  scope: Scope;
  env: Env;
  harnessIds?: string[];
  dryRun?: boolean;
}

export function uninstall(request: UninstallRequest): ApplyResult {
  return applyUninstall(request);
}

/** Where a package is installed, per scope. */
export function status(pkgName: string, env: Env): Partial<Record<Scope, Ledger>> {
  const found: Partial<Record<Scope, Ledger>> = {};
  for (const scope of SCOPES) {
    const ledger = readLedger(pkgName, scope, env);
    if (ledger) found[scope] = ledger;
  }
  return found;
}

export interface MissingEnv {
  name: string;
  description?: string;
  /** Why the package needs it: declared required, or used in a remote server's header. */
  reason: string;
}

/**
 * Variables the package needs that are not set where the installer is running. This is a hint and
 * no more: a harness started from a desktop launcher does not see what a shell exports, and one
 * started from another shell may see something else.
 */
export function missingEnv(pkg: Package, env: Env): MissingEnv[] {
  const needed = new Map<string, string>();
  for (const [name, declared] of Object.entries(pkg.manifest.environment)) {
    if (declared.required) needed.set(name, "required");
  }
  for (const node of pkg.nodes) {
    if (node.kind !== "mcpServer" || node.transport !== "http") continue;
    for (const name of headerEnv(node)) needed.set(name, `sent to the ${node.name} server`);
  }
  return [...needed]
    .filter(([name]) => !env.vars[name])
    .map(([name, reason]) => ({ name, reason, description: pkg.manifest.environment[name]?.description }));
}
