import { parseArgs, UsageError } from "./args.js";
import { runAuthorCommand } from "./author.js";
import { runCli } from "./run.js";

const AUTHOR_HELP = [
  "",
  "For package authors:",
  "  agentdist validate [dir]              check a package against the contract",
  "  agentdist pack [dir] [--check]        regenerate native plugin manifests (--check: fail if stale)",
  "      --as-version <v>                 generate as if the package were at version <v>",
  "",
  "Every command takes --package <dir> (default: the current directory).",
  "",
].join("\n");

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  let command: string | undefined;
  try {
    const args = parseArgs(argv);
    command = args.command;
    if (command === "pack" || command === "validate") {
      return runAuthorCommand(args, {
        out: (t) => process.stdout.write(t),
        err: (t) => process.stderr.write(t),
      });
    }
    const code = await runCli({ packageRoot: args.packageRoot ?? ".", argv, bin: "agentdist" });
    if (!args.version && (args.help || command === undefined || command === "help")) {
      process.stdout.write(AUTHOR_HELP);
    }
    return code;
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exit(1);
  },
);
