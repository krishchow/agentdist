import * as prompts from "@clack/prompts";
import {
  allowedHarnesses,
  describeSupport,
  ENGINE_VERSION,
  findProjectRoot,
  install,
  missingEnv,
  realEnv,
  status,
  uninstall,
} from "../api";
import type { Action, ApplyResult } from "../executor/apply";
import type { Env, HarnessDef } from "../harness/define";
import { HARNESSES } from "../harnesses/index";
import { loadPackage, PackageError } from "../ir/load";
import { installedName, type NodeKind, type Package } from "../ir/nodes";
import { configRootOf, displayPath } from "../ops/plan";
import { SCOPES, type Scope } from "../schema/manifest";
import { type Args, parseArgs, UsageError } from "./args";

export interface CliOptions {
  /** Directory holding the package's `agentpkg.json`. */
  packageRoot: string;
  argv: string[];
  /** How the user invokes this CLI, for help and follow-up hints: `npx notarize-mcp`. */
  bin?: string;
  env?: Env;
  /** Replace the engine's harness registry, to add a harness or narrow the list. */
  harnesses?: HarnessDef[];
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  /** Whether to prompt for missing choices. Defaults to "both ends are a terminal". */
  interactive?: boolean;
}

const KIND_LABEL: Record<NodeKind, string> = {
  skill: "skills",
  agent: "subagents",
  command: "commands",
  mcpServer: "MCP servers",
  hook: "hooks",
};

const SCOPE_LABEL: Record<Scope, string> = { user: "User", local: "Project" };

class Cancelled extends Error {}

function unwrap<T>(value: T): Exclude<T, symbol> {
  if (prompts.isCancel(value)) throw new Cancelled();
  return value as Exclude<T, symbol>;
}

function helpText(bin: string, pkg?: Package): string {
  return [
    pkg
      ? `Install ${pkg.name} ${pkg.version} into your AI coding harnesses.`
      : "Install an agent package into your AI coding harnesses.",
    "",
    "Usage:",
    `  ${bin} install [options]     install or update; asks what it was not told`,
    `  ${bin} uninstall [options]   remove what a previous install wrote`,
    `  ${bin} status                show where the package is installed`,
    `  ${bin} harnesses             list the harnesses it can install into`,
    "",
    "Options:",
    "  --harness <ids>      comma-separated harness ids (see `harnesses`); repeatable",
    "  --all                every supported harness",
    "  --user, -g           install for you, in every project (also --global)",
    "  --local, -l          install into this repository only (also --project)",
    "  --project-root <dir> the repository for --local (default: nearest .git above the current directory)",
    "  --dry-run, -n        show what would change and write nothing",
    "  --force, -f          replace files and config entries that exist but were not installed by this package",
    "  --yes, -y            do not ask for confirmation; with no --harness, use the harnesses found on this machine",
    "  --json               print the result as JSON",
    "",
  ].join("\n");
}

function supportHint(pkg: Package, harness: HarnessDef): string {
  const [support] = describeSupport(pkg, [harness]);
  const missing = Object.entries(support?.kinds ?? {})
    .filter(([, reason]) => reason !== undefined)
    .map(([kind]) => KIND_LABEL[kind as NodeKind]);
  return missing.length > 0 ? `no ${missing.join(", ")}` : "";
}

function resolveHarnesses(ids: string[], candidates: HarnessDef[], pkg: Package): HarnessDef[] {
  return [...new Set(ids)].map((id) => {
    const harness = candidates.find((h) => h.id === id);
    if (!harness) {
      throw new UsageError(
        `${pkg.name} cannot be installed into "${id}". Choose from: ${candidates.map((h) => h.id).join(", ")}`,
      );
    }
    return harness;
  });
}

function printResult(result: ApplyResult, write: (text: string) => void, verb: string): void {
  const symbol: Record<string, string> = {
    create: "+",
    update: "~",
    remove: "-",
    adopt: "=",
    keep: "!",
    backup: "↳",
  };
  const unchanged = result.actions.filter((a) => a.type === "unchanged").length;
  for (const line of summarise(result.actions.filter((a) => a.type !== "unchanged"))) {
    const detail = line.detail ? `  (${line.detail})` : "";
    write(
      `  ${symbol[line.type] ?? " "} ${line.type === "backup" ? `backed up to ${line.detail}` : line.target + detail}\n`,
    );
  }
  if (unchanged > 0) write(`  ${unchanged} already up to date\n`);
  if (result.actions.length === 0) write(`  nothing to ${verb}\n`);

  const skipped = result.diagnostics.filter((d) => d.level === "info");
  const warnings = result.diagnostics.filter((d) => d.level === "warn");
  for (const d of skipped) write(`  · ${d.harness}: ${d.node ?? ""} ${d.message}\n`);
  for (const d of warnings) write(`  ! ${d.harness}: ${d.message}\n`);
}

/**
 * One line per artifact rather than per file: the files of a skill that all had the same thing
 * happen to them in the same directory are shown as that directory and a count.
 */
function summarise(actions: Action[]): Action[] {
  const lines: Action[] = [];
  const groups = new Map<string, { first: Action; paths: string[]; index: number }>();
  for (const action of actions) {
    if (!action.node || action.detail || action.type === "backup") {
      lines.push(action);
      continue;
    }
    // A node's files sit under one directory per harness; its name is the last shared segment.
    const parts = action.target.split("/");
    const key = `${action.type}\u0000${action.node}\u0000${parts.slice(0, 3).join("/")}`;
    const group = groups.get(key);
    if (group) group.paths.push(action.target);
    else {
      groups.set(key, { first: action, paths: [action.target], index: lines.length });
      lines.push(action);
    }
  }
  for (const { first, paths, index } of groups.values()) {
    if (paths.length < 2) continue;
    const split = paths.map((path) => path.split("/"));
    let shared = 0;
    while (split.every((parts) => parts.length > shared + 1 && parts[shared] === split[0]?.[shared]))
      shared++;
    lines[index] = { ...first, target: `${split[0]?.slice(0, shared).join("/")}/  (${paths.length} files)` };
  }
  return lines;
}

function printConflicts(result: ApplyResult, write: (text: string) => void): void {
  write("These already exist and were not installed by this package:\n");
  for (const conflict of result.conflicts) write(`  ✗ ${conflict.target}: ${conflict.reason}\n`);
}

export async function runCli(options: CliOptions): Promise<number> {
  const out = options.stdout ?? ((text: string) => void process.stdout.write(text));
  const err = options.stderr ?? ((text: string) => void process.stderr.write(text));
  const bin = options.bin ?? "agentpkg";

  let args: Args;
  let pkg: Package;
  try {
    args = parseArgs(options.argv);
    if (args.version) {
      out(`agentpkg engine ${ENGINE_VERSION}\n`);
      return 0;
    }
    pkg = loadPackage(args.packageRoot ?? options.packageRoot);
  } catch (e) {
    if (e instanceof UsageError || e instanceof PackageError) {
      err(`${e.message}\n`);
      return 2;
    }
    throw e;
  }

  const env =
    options.env ?? realEnv(args.projectRoot ? { projectRoot: findProjectRoot(args.projectRoot) } : {});
  const registry = options.harnesses ?? HARNESSES;
  const candidates = allowedHarnesses(pkg, registry);
  const interactive =
    (options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY)) && !args.json && !args.yes;

  try {
    switch (args.help ? "help" : (args.command ?? "help")) {
      case "help":
        out(helpText(bin, pkg));
        return 0;

      case "harnesses":
      case "list": {
        if (args.json) {
          out(
            `${JSON.stringify(
              describeSupport(pkg, candidates).map((s) => ({
                id: s.harness.id,
                label: s.harness.label,
                detected: s.harness.detect(env),
                unsupported: s.kinds,
              })),
              null,
              2,
            )}\n`,
          );
          return 0;
        }
        for (const harness of candidates) {
          const hint = supportHint(pkg, harness);
          const found = harness.detect(env) ? "found" : "";
          out(
            `  ${harness.id.padEnd(12)} ${harness.label.padEnd(22)} ${[found, hint].filter(Boolean).join("; ")}\n`,
          );
        }
        return 0;
      }

      case "status": {
        const found = status(pkg.name, env);
        if (args.json) {
          out(`${JSON.stringify(found, null, 2)}\n`);
          return 0;
        }
        if (Object.keys(found).length === 0) out(`${pkg.name} is not installed.\n`);
        for (const scope of SCOPES) {
          const ledger = found[scope];
          if (!ledger) continue;
          const where = scope === "user" ? "~" : displayPath(env.projectRoot, "user", env);
          out(
            `${SCOPE_LABEL[scope]} (${where}): ${ledger.package} ${ledger.version} for ${ledger.harnesses.join(", ")}; ${Object.keys(ledger.files).length} files, ${ledger.configs.length + ledger.items.length} config entries\n`,
          );
        }
        const declared = Object.entries(pkg.manifest.environment);
        const missing = new Set(missingEnv(pkg, env).map((m) => m.name));
        if (declared.length > 0 || missing.size > 0) {
          out("Environment, as this shell sees it (a harness may see something else):\n");
          const names = new Set([...declared.map(([name]) => name), ...missing]);
          for (const name of names) {
            const info = pkg.manifest.environment[name];
            const state = env.vars[name]
              ? "set"
              : missing.has(name)
                ? "NOT SET, needed"
                : "not set, optional";
            out(`  ${name.padEnd(28)} ${state}${info?.description ? `  ${info.description}` : ""}\n`);
          }
        }
        return 0;
      }

      case "install":
      case "add":
      case "update":
        return await runInstall({ args, pkg, env, registry, candidates, interactive, out, err, bin });

      case "uninstall":
      case "remove":
        return await runUninstall({ args, pkg, env, interactive, out, err });

      default:
        err(`unknown command "${args.command}"\n\n${helpText(bin, pkg)}`);
        return 2;
    }
  } catch (e) {
    if (e instanceof Cancelled) {
      prompts.cancel("Cancelled. Nothing was changed.");
      return 130;
    }
    if (e instanceof UsageError) {
      err(`${e.message}\n`);
      return 2;
    }
    err(`${(e as Error).message}\n`);
    return 1;
  }
}

interface CommandCtx {
  args: Args;
  pkg: Package;
  env: Env;
  interactive: boolean;
  out: (text: string) => void;
  err: (text: string) => void;
}

async function chooseScope(ctx: CommandCtx, harnesses: HarnessDef[], allowed: Scope[]): Promise<Scope> {
  const { args, pkg, env } = ctx;
  if (args.scope) {
    if (!allowed.includes(args.scope))
      throw new UsageError(`${pkg.name} does not support ${args.scope}-scope installs`);
    return args.scope;
  }
  if (allowed.length === 1) return allowed[0]!;
  if (!ctx.interactive)
    throw new UsageError("say where to install: --user (every project) or --local (this repository)");
  const where = (scope: Scope) =>
    [...new Set(harnesses.map((h) => displayPath(configRootOf(h, scope, env), scope, env)))].join(", ");
  return unwrap(
    await prompts.select<Scope>({
      message: "Where should it be installed?",
      options: [
        { value: "user", label: "User", hint: `every project · ${where("user")}` },
        {
          value: "local",
          label: "Project",
          hint: `this repository only · ${displayPath(env.projectRoot, "user", env)}/{${where("local")}}`,
        },
      ],
    }),
  );
}

async function runInstall(
  ctx: CommandCtx & { registry: HarnessDef[]; candidates: HarnessDef[]; bin: string },
): Promise<number> {
  const { args, pkg, env, candidates, interactive, out, err } = ctx;
  if (interactive) prompts.intro(`${pkg.manifest.listing?.displayName ?? pkg.name} ${pkg.version}`);

  let harnesses: HarnessDef[];
  if (args.all) harnesses = candidates;
  else if (args.harnesses.length > 0) harnesses = resolveHarnesses(args.harnesses, candidates, pkg);
  else if (interactive) {
    const installed = new Set(Object.values(status(pkg.name, env)).flatMap((l) => l.harnesses));
    const initial = candidates.filter((h) => installed.has(h.id) || h.detect(env)).map((h) => h.id);
    const chosen = unwrap(
      await prompts.multiselect<string>({
        message: "Which harnesses should it be installed into?",
        options: candidates.map((h) => ({
          value: h.id,
          label: h.label,
          hint: [h.detect(env) ? "found on this machine" : "", supportHint(pkg, h)]
            .filter(Boolean)
            .join("; "),
        })),
        initialValues: initial,
        required: true,
      }),
    );
    harnesses = resolveHarnesses(chosen, candidates, pkg);
  } else if (args.yes) {
    harnesses = candidates.filter((h) => h.detect(env));
    if (harnesses.length === 0)
      throw new UsageError("no supported harness was found on this machine; name one with --harness");
  } else {
    throw new UsageError(
      `say which harnesses to install into: --harness ${candidates.map((h) => h.id).join(",")} (or --all)`,
    );
  }

  const scope = await chooseScope(ctx, harnesses, pkg.manifest.scopes);
  const request = { pkg, harnesses, scope, env, registry: ctx.registry };

  let force = args.force;
  const preview = install({ ...request, dryRun: true, force });
  if (preview.conflicts.length > 0) {
    if (!interactive) {
      if (args.json) out(`${JSON.stringify(preview, replacer, 2)}\n`);
      else {
        printConflicts(preview, err);
        err("Nothing was changed. Run again with --force to replace them (they are backed up first).\n");
      }
      return 1;
    }
    printConflicts(preview, out);
    force = unwrap(
      await prompts.confirm({ message: "Replace them? Each one is backed up first.", initialValue: false }),
    );
    if (!force) throw new Cancelled();
  }

  if (args.dryRun) {
    const dry = force === args.force ? preview : install({ ...request, dryRun: true, force });
    if (args.json) out(`${JSON.stringify(dry, replacer, 2)}\n`);
    else {
      out(`Would install ${pkg.name} ${pkg.version} for ${dry.harnessIds.join(", ")} at ${scope} scope:\n`);
      printResult(dry, out, "install");
    }
    return 0;
  }

  if (interactive) {
    const changes = preview.actions.filter((a) => a.type !== "unchanged").length;
    const ok = unwrap(
      await prompts.confirm({
        message: `Install for ${harnesses.map((h) => h.label).join(", ")} at ${SCOPE_LABEL[scope].toLowerCase()} scope? (${changes} changes)`,
      }),
    );
    if (!ok) throw new Cancelled();
  }

  const result = install({ ...request, force });
  if (args.json) {
    out(`${JSON.stringify(result, replacer, 2)}\n`);
    return result.applied ? 0 : 1;
  }
  out(`Installed ${pkg.name} ${pkg.version} for ${result.harnessIds.join(", ")} at ${scope} scope:\n`);
  printResult(result, out, "install");

  for (const missing of missingEnv(pkg, env)) {
    out(
      `  ! ${missing.name} is not set in this shell (${missing.reason})${missing.description ? `: ${missing.description}` : ""}\n`,
    );
  }

  const onboarding = pkg.manifest.onboardingSkill;
  const next = onboarding
    ? `Restart your harness, then run ${harnesses[0]!.dialect.skillRef(installedName(pkg, onboarding))} to finish setting up.`
    : "Restart your harness to pick it up.";
  if (interactive) prompts.outro(next);
  else out(`${next}\n`);
  return 0;
}

async function runUninstall(ctx: CommandCtx): Promise<number> {
  const { args, pkg, env, interactive, out } = ctx;
  const found = status(pkg.name, env);
  const installedScopes = SCOPES.filter((s) => found[s]);
  if (installedScopes.length === 0) {
    out(`${pkg.name} is not installed.\n`);
    return 0;
  }
  let scope: Scope;
  if (args.scope) scope = args.scope;
  else if (installedScopes.length === 1) scope = installedScopes[0]!;
  else if (!interactive)
    throw new UsageError("it is installed at both scopes; say which to remove: --user or --local");
  else {
    scope = unwrap(
      await prompts.select<Scope>({
        message: "Which install should be removed?",
        options: installedScopes.map((s) => ({
          value: s,
          label: SCOPE_LABEL[s],
          hint: found[s]!.harnesses.join(", "),
        })),
      }),
    );
  }
  const ledger = found[scope];
  if (!ledger) {
    out(`${pkg.name} is not installed at ${scope} scope.\n`);
    return 0;
  }
  const harnessIds = args.all || args.harnesses.length === 0 ? undefined : args.harnesses;
  for (const id of harnessIds ?? []) {
    if (!ledger.harnesses.includes(id))
      throw new UsageError(`${pkg.name} is not installed for "${id}" at ${scope} scope`);
  }
  const request = { pkgName: pkg.name, scope, env, harnessIds };
  const label = (harnessIds ?? ledger.harnesses).join(", ");

  if (args.dryRun) {
    const dry = uninstall({ ...request, dryRun: true });
    if (args.json) out(`${JSON.stringify(dry, replacer, 2)}\n`);
    else {
      out(`Would remove ${pkg.name} for ${label} at ${scope} scope:\n`);
      printResult(dry, out, "remove");
    }
    return 0;
  }
  if (interactive) {
    const ok = unwrap(
      await prompts.confirm({
        message: `Remove ${pkg.name} for ${label} at ${SCOPE_LABEL[scope].toLowerCase()} scope?`,
      }),
    );
    if (!ok) throw new Cancelled();
  }
  const result = uninstall(request);
  if (args.json) out(`${JSON.stringify(result, replacer, 2)}\n`);
  else {
    out(`Removed ${pkg.name} for ${label} at ${scope} scope:\n`);
    printResult(result, out, "remove");
  }
  return 0;
}

/** File contents do not belong in JSON output. */
function replacer(key: string, value: unknown): unknown {
  return key === "plan" ? undefined : value;
}
