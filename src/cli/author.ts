import { resolve } from "node:path";
import { loadPackage, PackageError } from "../ir/load";
import { NODE_KINDS } from "../ir/nodes";
import { PACK_TARGETS } from "../pack/index";
import { runPack } from "../pack/run";
import type { PackTarget } from "../pack/types";
import { type Args, UsageError } from "./args";

/**
 * Commands for whoever maintains a package, as opposed to whoever installs it: `validate` checks
 * the package against the contract, and `pack` regenerates its native plugin manifests.
 */
export function runAuthorCommand(
  args: Args,
  io: { out: (text: string) => void; err: (text: string) => void },
  targets: PackTarget[] = PACK_TARGETS,
): number {
  const root = resolve(args.packageRoot ?? args.positional[0] ?? ".");
  try {
    const pkg = loadPackage(root);
    if (args.command === "validate") {
      const counts = NODE_KINDS.map(
        (kind) => `${pkg.nodes.filter((n) => n.kind === kind).length} ${kind}`,
      ).join(", ");
      io.out(`${pkg.name} ${pkg.version} is a valid agent package (${counts}).\n`);
      return 0;
    }
    if (args.asVersion) {
      const from = pkg.version;
      pkg.version = args.asVersion;
      for (const node of pkg.nodes) {
        if (node.kind !== "mcpServer" || node.transport !== "stdio") continue;
        const raw = pkg.manifest.mcpServers[node.name];
        if (raw?.transport !== "stdio") continue;
        const fill = (s: string) => s.replaceAll("{{version}}", pkg.version).replaceAll("{{name}}", pkg.name);
        node.command = fill(raw.command);
        node.args = raw.args.map(fill);
      }
      if (from !== pkg.version) io.err(`packing as ${pkg.version} (the package is at ${from})\n`);
    }
    if (Object.keys(pkg.manifest.pack).length === 0) {
      throw new UsageError(
        `${pkg.name} declares no pack targets. Add a "pack" object to agentpkg.json; known targets: ${targets.map((t) => t.id).join(", ")}`,
      );
    }
    const result = runPack(pkg, targets, { check: args.check });
    for (const note of result.notes) io.err(`  note: ${note}\n`);
    for (const change of result.changes) {
      if (change.change !== "unchanged") io.out(`  ${change.change.padEnd(6)} ${change.path}\n`);
    }
    if (args.check) {
      if (result.clean) io.out("Generated plugin files are up to date.\n");
      else io.err("Generated plugin files are out of date. Run `agentpkg pack` and commit the result.\n");
      return result.clean ? 0 : 1;
    }
    io.out(
      result.clean
        ? "Nothing to do: generated plugin files are up to date.\n"
        : "Generated plugin files written.\n",
    );
    return 0;
  } catch (e) {
    if (e instanceof PackageError || e instanceof UsageError) {
      io.err(`${e.message}\n`);
      return 2;
    }
    io.err(`${(e as Error).message}\n`);
    return 1;
  }
}
