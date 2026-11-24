import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { z } from "zod";
import { AgentFrontmatter, CommandFrontmatter, SkillFrontmatter } from "../schema/content";
import { AgentPkg, MANIFEST_FILE } from "../schema/manifest";
import { parseDoc } from "./markdown";
import type { AgentNode, CommandNode, McpServerNode, Node, Package, SkillFile, SkillNode } from "./nodes";
import { findRefs } from "./refs";

/** Every problem found in a package, reported together instead of one per run. */
export class PackageError extends Error {
  constructor(
    readonly root: string,
    readonly problems: string[],
  ) {
    super(`${root} is not a valid agent package:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "PackageError";
  }
}

const TEXT_EXTENSIONS = new Set([".md", ".mdx", ".markdown", ".txt"]);
const SKILL_FILE = "SKILL.md";

function issues(error: z.ZodError, where: string): string[] {
  return error.issues.map((i) => `${where}${i.path.length ? ` → ${i.path.join(".")}` : ""}: ${i.message}`);
}

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      // Symlinks are not followed: a package must not be able to install bytes from outside itself.
      if (entry.isSymbolicLink()) return [];
      if (entry.isDirectory()) return walk(path, base);
      return entry.isFile() ? [relative(base, path).split(sep).join("/")] : [];
    });
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort();
}

export function loadPackage(root: string): Package {
  const dir = resolve(root);
  const manifestPath = join(dir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) throw new PackageError(dir, [`${MANIFEST_FILE} not found`]);

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    throw new PackageError(dir, [`${MANIFEST_FILE} is not valid JSON: ${(e as Error).message}`]);
  }
  const parsed = AgentPkg.safeParse(raw);
  if (!parsed.success) throw new PackageError(dir, issues(parsed.error, MANIFEST_FILE));
  const manifest = parsed.data;

  const problems: string[] = [];
  const nodes: Node[] = [];

  const contentDir = (key: "skills" | "agents" | "commands"): string | undefined => {
    const rel = manifest[key];
    if (rel === undefined) return undefined;
    const path = resolve(dir, rel);
    if (path !== dir && !path.startsWith(dir + sep)) {
      problems.push(`${key}: "${rel}" is outside the package`);
      return undefined;
    }
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      problems.push(`${key}: "${rel}" is not a directory`);
      return undefined;
    }
    return path;
  };

  const skillsDir = contentDir("skills");
  if (skillsDir) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!entry.isDirectory()) continue;
      const where = `${manifest.skills}/${entry.name}/${SKILL_FILE}`;
      const skillDir = join(skillsDir, entry.name);
      if (!existsSync(join(skillDir, SKILL_FILE))) {
        problems.push(`${where}: missing`);
        continue;
      }
      try {
        const doc = parseDoc(readFileSync(join(skillDir, SKILL_FILE), "utf8"));
        const fm = SkillFrontmatter.safeParse(doc.frontmatter);
        if (!fm.success) {
          problems.push(...issues(fm.error, where));
          continue;
        }
        if (fm.data.name !== entry.name) {
          problems.push(`${where}: name "${fm.data.name}" must match its folder "${entry.name}"`);
        }
        const files: SkillFile[] = walk(skillDir)
          .filter((rel) => rel !== SKILL_FILE)
          .map((rel) => {
            const abs = join(skillDir, rel);
            const ext = rel.slice(rel.lastIndexOf("."));
            return {
              rel,
              bytes: readFileSync(abs),
              text: TEXT_EXTENSIONS.has(ext.toLowerCase()),
              executable: (statSync(abs).mode & 0o111) !== 0,
            };
          });
        nodes.push({
          kind: "skill",
          name: entry.name,
          description: fm.data.description,
          doc,
          files,
        } satisfies SkillNode);
      } catch (e) {
        problems.push(`${where}: ${(e as Error).message}`);
      }
    }
  }

  const agentsDir = contentDir("agents");
  if (agentsDir) {
    for (const file of markdownFiles(agentsDir)) {
      const where = `${manifest.agents}/${file}`;
      try {
        const doc = parseDoc(readFileSync(join(agentsDir, file), "utf8"));
        const fm = AgentFrontmatter.safeParse(doc.frontmatter);
        if (!fm.success) {
          problems.push(...issues(fm.error, where));
          continue;
        }
        const name = file.slice(0, -3);
        if (fm.data.name !== name)
          problems.push(`${where}: name "${fm.data.name}" must match its file name "${name}"`);
        nodes.push({
          kind: "agent",
          name,
          description: fm.data.description,
          tools: fm.data.tools,
          model: fm.data.model,
          doc,
        } satisfies AgentNode);
      } catch (e) {
        problems.push(`${where}: ${(e as Error).message}`);
      }
    }
  }

  const commandsDir = contentDir("commands");
  if (commandsDir) {
    for (const file of markdownFiles(commandsDir)) {
      const where = `${manifest.commands}/${file}`;
      try {
        const doc = parseDoc(readFileSync(join(commandsDir, file), "utf8"));
        const fm = CommandFrontmatter.safeParse(doc.frontmatter);
        if (!fm.success) {
          problems.push(...issues(fm.error, where));
          continue;
        }
        nodes.push({
          kind: "command",
          name: file.slice(0, -3),
          description: fm.data.description,
          argumentHint: fm.data["argument-hint"],
          doc,
        } satisfies CommandNode);
      } catch (e) {
        problems.push(`${where}: ${(e as Error).message}`);
      }
    }
  }

  const version = manifest.version ?? packageJsonVersion(dir);
  if (!version)
    problems.push(`${MANIFEST_FILE}: no "version", and no package.json beside it to take one from`);

  for (const [name, server] of Object.entries(manifest.mcpServers)) {
    const fill = (s: string) =>
      s.replaceAll("{{version}}", version ?? "").replaceAll("{{name}}", manifest.name);
    nodes.push({
      kind: "mcpServer",
      name,
      ...server,
      command: fill(server.command),
      args: server.args.map(fill),
    } satisfies McpServerNode);
  }

  problems.push(...checkRefs(nodes));
  if (
    manifest.onboardingSkill &&
    !nodes.some((n) => n.kind === "skill" && n.name === manifest.onboardingSkill)
  ) {
    problems.push(`${MANIFEST_FILE} → onboardingSkill: no skill named "${manifest.onboardingSkill}"`);
  }
  if (nodes.length === 0) problems.push("the package declares nothing to install");

  if (problems.length > 0) throw new PackageError(dir, problems);
  return { root: dir, name: manifest.name, version: version!, manifest, nodes };
}

function packageJsonVersion(dir: string): string | undefined {
  try {
    const version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

/** A reference must point at something the package itself declares. */
function checkRefs(nodes: Node[]): string[] {
  const has = (kind: Node["kind"], name: string) => nodes.some((n) => n.kind === kind && n.name === name);
  const problems: string[] = [];
  const check = (where: string, text: string, inSkill: boolean) => {
    for (const ref of findRefs(text)) {
      if (typeof ref === "string") problems.push(`${where}: ${ref}`);
      else if (ref.type === "tool" && !has("mcpServer", ref.server)) {
        problems.push(
          `${where}: {{tool:${ref.server}.${ref.tool}}} names an MCP server the package does not declare`,
        );
      } else if (
        (ref.type === "skill" || ref.type === "agent" || ref.type === "command") &&
        !has(ref.type, ref.name)
      ) {
        problems.push(`${where}: {{${ref.type}:${ref.name}}} names a ${ref.type} the package does not have`);
      } else if (ref.type === "skill_dir" && !inSkill) {
        problems.push(`${where}: {{skill_dir}} only means something inside a skill`);
      }
    }
  };
  for (const node of nodes) {
    if (node.kind === "mcpServer") continue;
    check(`${node.kind} ${node.name}`, node.doc.body, node.kind === "skill");
    if (node.kind === "skill") {
      for (const file of node.files) {
        if (file.text)
          check(`skill ${node.name}/${file.rel}`, Buffer.from(file.bytes).toString("utf8"), true);
      }
    }
  }
  return problems;
}
