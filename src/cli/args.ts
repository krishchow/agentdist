import type { Scope } from "../schema/manifest";

export interface Args {
  command?: string;
  positional: string[];
  harnesses: string[];
  all: boolean;
  scope?: Scope;
  dryRun: boolean;
  force: boolean;
  yes: boolean;
  json: boolean;
  check: boolean;
  help: boolean;
  version: boolean;
  projectRoot?: string;
  packageRoot?: string;
  /** `pack` only: generate as if the package were at this version. */
  asVersion?: string;
}

export class UsageError extends Error {}

const SCOPE_FLAGS: Record<string, Scope> = {
  "--user": "user",
  "--global": "user",
  "-g": "user",
  "--local": "local",
  "--project": "local",
  "-l": "local",
};

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    positional: [],
    harnesses: [],
    all: false,
    dryRun: false,
    force: false,
    yes: false,
    json: false,
    check: false,
    help: false,
    version: false,
  };
  const setScope = (scope: string) => {
    if (scope !== "user" && scope !== "local")
      throw new UsageError(`--scope must be "user" or "local", not "${scope}"`);
    if (args.scope && args.scope !== scope) throw new UsageError("choose one scope: user or local");
    args.scope = scope;
  };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!;
    const [flag, inline] =
      raw.startsWith("--") && raw.includes("=")
        ? [raw.slice(0, raw.indexOf("=")), raw.slice(raw.indexOf("=") + 1)]
        : [raw, undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined || v.startsWith("-")) throw new UsageError(`${flag} needs a value`);
      return v;
    };
    if (flag in SCOPE_FLAGS) setScope(SCOPE_FLAGS[flag]!);
    else if (flag === "--scope") setScope(value());
    else if (flag === "--harness" || flag === "--harnesses" || flag === "-H") {
      args.harnesses.push(
        ...value()
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (flag === "--all") args.all = true;
    else if (flag === "--dry-run" || flag === "-n") args.dryRun = true;
    else if (flag === "--force" || flag === "-f") args.force = true;
    else if (flag === "--yes" || flag === "-y") args.yes = true;
    else if (flag === "--json") args.json = true;
    else if (flag === "--check") args.check = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else if (flag === "--version" || flag === "-v") args.version = true;
    else if (flag === "--project-root") args.projectRoot = value();
    else if (flag === "--package") args.packageRoot = value();
    else if (flag === "--as-version") args.asVersion = value();
    else if (flag.startsWith("-")) throw new UsageError(`unknown option ${flag}`);
    else if (args.command === undefined) args.command = flag;
    else args.positional.push(flag);
  }
  return args;
}
