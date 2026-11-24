import { join, relative, sep } from "node:path";
import type { Dialect, Env, HarnessDef } from "../harness/define";
import { unsupported } from "../harness/define";
import { inProject } from "../harness/locations";
import type { Package } from "../ir/nodes";
import { hasRefs } from "../ir/refs";
import { planInstall } from "../ops/plan";
import { markdownAgents } from "../surfaces/agents";
import { markdownCommands } from "../surfaces/commands";
import { skillsDir } from "../surfaces/skills";
import type { PackFile } from "./types";

/** Whether any content needs rendering before a harness can read it. */
export function usesRefs(pkg: Package): boolean {
  return pkg.nodes.some((node) => {
    if (node.kind === "mcpServer") return false;
    if (hasRefs(node.doc.body)) return true;
    return (
      node.kind === "skill" &&
      node.files.some((f) => f.text && hasRefs(Buffer.from(f.bytes).toString("utf8")))
    );
  });
}

const dir = (path: string | undefined) =>
  path ? `./${path.replace(/^\.\//, "").replace(/\/$/, "")}/` : undefined;

export interface PluginContent {
  /** Where the plugin manifest should point for each kind, relative to the package root. */
  skills?: string;
  agents?: string;
  commands?: string;
  /** Rendered files, empty when the source directories can be used as they are. */
  files: PackFile[];
  ownedDirs: string[];
}

/**
 * The content directories a plugin manifest points at. Content with no symbolic references is
 * already valid for every harness, so the plugin reads the source in place. Otherwise the content
 * is rendered in the target's dialect into a directory of its own, by the same surfaces a vendored
 * install uses.
 */
export function pluginContent(
  pkg: Package,
  target: { id: string; dialect: Dialect; outDir: string; showPath?: (rel: string) => string },
): PluginContent {
  const { manifest } = pkg;
  if (!usesRefs(pkg)) {
    return {
      skills: dir(manifest.skills),
      agents: dir(manifest.agents),
      commands: dir(manifest.commands),
      files: [],
      ownedDirs: [],
    };
  }
  const env: Env = { home: pkg.root, projectRoot: pkg.root, vars: {}, platform: process.platform };
  const posix = (abs: string) => relative(pkg.root, abs).split(sep).join("/");
  const at = (kind: string) => ({ local: inProject(target.outDir, kind) });
  const harness: HarnessDef = {
    id: target.id,
    label: target.id,
    configRoot: { user: () => pkg.root, local: "." },
    detect: () => false,
    dialect: target.dialect,
    showPath: target.showPath ? (abs) => target.showPath!(posix(abs)) : undefined,
    kinds: {
      skill: skillsDir(at("skills")),
      agent: markdownAgents(at("agents"), { passthrough: true }),
      command: markdownCommands(at("commands"), { passthrough: true }),
      mcpServer: unsupported("declared in the plugin manifest"),
    },
    sources: [],
  };
  // The harness namespaces a plugin's artifacts itself, so names are not prefixed.
  const unprefixed: Package = { ...pkg, manifest: { ...manifest, namespace: "none" } };
  const plan = planInstall(unprefixed, [harness], "local", env);
  const has = (kind: string) => pkg.nodes.some((n) => n.kind === kind);
  return {
    skills: has("skill") ? `./${target.outDir}/skills/` : undefined,
    agents: has("agent") ? `./${target.outDir}/agents/` : undefined,
    commands: has("command") ? `./${target.outDir}/commands/` : undefined,
    files: plan.files.map((f) => ({ path: posix(f.path), content: f.content })),
    ownedDirs: [target.outDir],
  };
}

export const rendered = (outDir: string, ...parts: string[]) => join(outDir, ...parts);
