import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPackage, PackageError } from "../src/ir/load";
import { installedName } from "../src/ir/nodes";
import { demo, FIXTURE } from "./helpers";

const copy = () => {
  const dir = mkdtempSync(join(tmpdir(), "agentpkg-pkg-"));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
};
const problems = (dir: string): string[] => {
  try {
    loadPackage(dir);
    return [];
  } catch (e) {
    if (e instanceof PackageError) return e.problems;
    throw e;
  }
};

describe("loadPackage", () => {
  it("reads every node kind into the IR", () => {
    const pkg = demo();
    expect(pkg.nodes.map((n) => `${n.kind}:${n.name}`)).toEqual([
      "skill:setup",
      "skill:ship-it",
      "agent:reviewer",
      "command:ship",
      "mcpServer:demo",
    ]);
    const skill = pkg.nodes.find((n) => n.kind === "skill" && n.name === "setup");
    expect(skill?.kind === "skill" && skill.files.map((f) => [f.rel, f.text, f.executable])).toEqual([
      ["scripts/run.mjs", false, true],
    ]);
    const agent = pkg.nodes.find((n) => n.kind === "agent");
    expect(agent?.kind === "agent" && agent.tools).toEqual(["Read", "Grep", "Bash", "mcp:demo.doctor"]);
  });

  it("fills {{version}} into MCP server arguments", () => {
    const server = demo().nodes.find((n) => n.kind === "mcpServer");
    expect(server?.kind === "mcpServer" && server.args).toEqual(["-y", "demo-mcp@1.2.3"]);
  });

  it("namespaces installed names once", () => {
    const pkg = demo();
    expect(installedName(pkg, "setup")).toBe("demo-setup");
    expect(installedName(pkg, "demo-setup")).toBe("demo-setup");
    expect(installedName(pkg, "demo")).toBe("demo");
  });

  it("reports every problem at once", () => {
    const dir = copy();
    writeFileSync(join(dir, "skills", "ship-it", "SKILL.md"), "---\nname: other\n---\nUse {{tool:nope.x}} and {{skill:gone}}.\n");
    writeFileSync(join(dir, "commands", "ship.md"), "Run {{skill_dir}}/x\n");
    const found = problems(dir);
    expect(found.join("\n")).toMatch(/skills\/ship-it\/SKILL.md → description/);
    expect(found.join("\n")).toMatch(/\{\{skill_dir\}\} only means something inside a skill/);
    rmSync(dir, { recursive: true });
  });

  it("rejects references to things the package does not declare", () => {
    const dir = copy();
    writeFileSync(
      join(dir, "skills", "ship-it", "SKILL.md"),
      "---\nname: ship-it\ndescription: x\n---\nUse {{tool:nope.x}}, {{tool:broken}} and {{skill:gone}}.\n",
    );
    const found = problems(dir).join("\n");
    expect(found).toMatch(/names an MCP server the package does not declare/);
    expect(found).toMatch(/must be \{\{tool:<server>.<tool>\}\}/);
    expect(found).toMatch(/names a skill the package does not have/);
    rmSync(dir, { recursive: true });
  });

  it("rejects unknown manifest keys and a bad name", () => {
    const dir = copy();
    writeFileSync(join(dir, "agentpkg.json"), JSON.stringify({ engine: "v1", name: "Bad Name", hooks: [] }));
    const found = problems(dir).join("\n");
    expect(found).toMatch(/agentpkg.json → name/);
    expect(found).toMatch(/hooks/);
    rmSync(dir, { recursive: true });
  });
});
