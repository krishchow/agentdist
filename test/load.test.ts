import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPackage, PackageError } from "../src/ir/load.js";
import { installedName } from "../src/ir/nodes.js";
import { demo, FIXTURE } from "./helpers.js";

const copy = () => {
  const dir = mkdtempSync(join(tmpdir(), "agentdist-pkg-"));
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
      "mcpServer:demo-remote",
      "hook:guard",
      "hook:greet",
    ]);
    expect(pkg.hookFiles.map((f) => [f.rel, f.executable])).toEqual([["guard.mjs", true]]);
    const skill = pkg.nodes.find((n) => n.kind === "skill" && n.name === "setup");
    expect(skill?.kind === "skill" && skill.files.map((f) => [f.rel, f.text, f.executable])).toEqual([
      ["scripts/run.mjs", false, true],
    ]);
    const agent = pkg.nodes.find((n) => n.kind === "agent");
    expect(agent?.kind === "agent" && agent.tools).toEqual(["Read", "Grep", "Bash", "mcp:demo.doctor"]);
  });

  it("fills {{version}} into MCP server arguments", () => {
    const server = demo().nodes.find((n) => n.kind === "mcpServer");
    expect(server?.kind === "mcpServer" && server.transport === "stdio" && server.args).toEqual([
      "-y",
      "demo-mcp@1.2.3",
    ]);
  });

  it("namespaces installed names once", () => {
    const pkg = demo();
    expect(installedName(pkg, "setup")).toBe("demo-setup");
    expect(installedName(pkg, "demo-setup")).toBe("demo-setup");
    expect(installedName(pkg, "demo")).toBe("demo");
  });

  it("reports every problem at once", () => {
    const dir = copy();
    writeFileSync(
      join(dir, "skills", "ship-it", "SKILL.md"),
      "---\nname: other\n---\nUse {{tool:nope.x}} and {{skill:gone}}.\n",
    );
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

  it("checks hooks and remote servers", () => {
    const dir = copy();
    const manifest = JSON.parse(readFileSync(join(dir, "agentdist.json"), "utf8"));
    delete manifest.hooksDir;
    manifest.hooks.greet.matcher = ["Bash"];
    writeFileSync(join(dir, "agentdist.json"), JSON.stringify(manifest));
    const found = problems(dir).join("\n");
    expect(found).toMatch(/hooks.guard: the command uses \{\{hooks_dir\}\} but the package has no hooksDir/);
    expect(found).toMatch(/hooks.greet: only PreToolUse and PostToolUse take a matcher/);

    manifest.mcpServers.bad = { transport: "http", url: "not a url" };
    manifest.mcpServers.typo = { command: "x", arg: [] };
    writeFileSync(join(dir, "agentdist.json"), JSON.stringify(manifest));
    const shape = problems(dir).join("\n");
    expect(shape).toMatch(/mcpServers.bad.url/);
    expect(shape).toMatch(/mcpServers.typo: Unrecognized key: "arg"/);
    rmSync(dir, { recursive: true });
  });

  it("rejects unknown manifest keys and a bad name", () => {
    const dir = copy();
    writeFileSync(join(dir, "agentdist.json"), JSON.stringify({ engine: "v1", name: "Bad Name", hooks: [] }));
    const found = problems(dir).join("\n");
    expect(found).toMatch(/agentdist.json → name/);
    expect(found).toMatch(/hooks/);
    rmSync(dir, { recursive: true });
  });
});
