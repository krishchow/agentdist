import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPackage } from "../src/ir/load.js";
import { PACK_TARGETS } from "../src/pack/index.js";
import { runPack } from "../src/pack/run.js";
import { FIXTURE } from "./helpers.js";

function fixture(pack: Record<string, unknown>, strip = false) {
  const dir = mkdtempSync(join(tmpdir(), "agentdist-pack-"));
  cpSync(FIXTURE, dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, "agentdist.json"), "utf8"));
  manifest.pack = pack;
  if (strip) {
    // A package with no symbolic references, like most existing ones.
    delete manifest.agents;
    delete manifest.commands;
    writeFileSync(
      join(dir, "skills/setup/SKILL.md"),
      "---\nname: setup\ndescription: Set up.\n---\nPlain.\n",
    );
    writeFileSync(join(dir, "skills/ship-it/references/notes.md"), "Plain.\n");
  }
  writeFileSync(join(dir, "agentdist.json"), JSON.stringify(manifest));
  return dir;
}
const readJson = (dir: string, path: string) => JSON.parse(readFileSync(join(dir, path), "utf8"));

describe("pack", () => {
  it("points a plugin at the source directories when the content needs no rendering", () => {
    const dir = fixture({ "claude-plugin": {}, "codex-plugin": { capabilities: ["Read"] } }, true);
    const result = runPack(loadPackage(dir), PACK_TARGETS);
    expect(result.changes.map((c) => c.path).sort()).toEqual([
      ".agents/plugins/marketplace.json",
      ".claude-plugin/hooks.json",
      ".claude-plugin/marketplace.json",
      ".claude-plugin/plugin.json",
      ".codex-plugin/plugin.json",
      "codex.mcp.json",
    ]);
    expect(readJson(dir, ".claude-plugin/plugin.json")).toEqual({
      name: "demo",
      version: "1.2.3",
      description: "A fixture package.",
      author: { name: "tester" },
      license: "MIT",
      keywords: ["demo"],
      hooks: "./.claude-plugin/hooks.json",
      mcpServers: {
        demo: { command: "npx", args: ["-y", "demo-mcp@1.2.3"], env: { DEMO_MODE: "1" } },
        "demo-remote": {
          type: "http",
          url: "https://mcp.example.com/mcp",
          headers: { Authorization: "Bearer ${DEMO_API_TOKEN}", "X-Client": "demo" },
        },
      },
    });
    // Hook commands point into the plugin's own install directory.
    expect(readJson(dir, ".claude-plugin/hooks.json").hooks.PreToolUse).toEqual([
      {
        matcher: "Bash|Edit",
        hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks"/guard.mjs', timeout: 10 }],
      },
    ]);
    // What a format cannot carry is said, not dropped.
    expect(result.notes).toContain(
      'codex-plugin: hook "guard" is left out: this target does not write plugin hooks yet',
    );
    expect(result.notes.join("\n")).toMatch(/codex-plugin: remote server "demo-remote" is left out/);
    const codex = readJson(dir, ".codex-plugin/plugin.json");
    expect(codex.skills).toBe("./skills/");
    expect(codex.mcpServers).toBe("./codex.mcp.json");
    expect(codex.extensions["com.openai"].onboardingSkill).toBe("./skills/setup/SKILL.md");
    expect(codex.interface).toMatchObject({
      displayName: "Demo",
      developerName: "tester",
      capabilities: ["Read"],
    });
    expect(readJson(dir, "codex.mcp.json").mcpServers.demo).toEqual({
      command: "npx",
      args: ["-y", "demo-mcp@1.2.3"],
      env: { DEMO_MODE: "1" },
      env_vars: ["DEMO_TOKEN"],
      startup_timeout_sec: 60,
      tool_timeout_sec: 300,
    });
    rmSync(dir, { recursive: true });
  });

  it("renders content in the plugin's dialect when it uses references", () => {
    const dir = fixture({ "claude-plugin": {} });
    runPack(loadPackage(dir), PACK_TARGETS);
    const plugin = readJson(dir, ".claude-plugin/plugin.json");
    expect(plugin.skills).toBe("./plugins/claude/skills/");
    expect(plugin.agents).toBe("./plugins/claude/agents/");
    const skill = readFileSync(join(dir, "plugins/claude/skills/setup/SKILL.md"), "utf8");
    expect(skill).toContain("name: setup");
    expect(skill).toContain("Call mcp__plugin_demo_demo__doctor first");
    expect(skill).toContain("node ${CLAUDE_PLUGIN_ROOT}/plugins/claude/skills/setup/scripts/run.mjs check");
    expect(skill).toContain("continue with /demo:ship-it");
    expect(existsSync(join(dir, "plugins/claude/skills/setup/scripts/run.mjs"))).toBe(true);
    rmSync(dir, { recursive: true });
  });

  it("--check reports drift and writes nothing; stale rendered files are removed", () => {
    const dir = fixture({ "claude-plugin": { marketplace: false } });
    expect(runPack(loadPackage(dir), PACK_TARGETS, { check: true }).clean).toBe(false);
    expect(existsSync(join(dir, ".claude-plugin"))).toBe(false);

    runPack(loadPackage(dir), PACK_TARGETS);
    expect(existsSync(join(dir, ".claude-plugin/marketplace.json"))).toBe(false);
    expect(runPack(loadPackage(dir), PACK_TARGETS, { check: true }).clean).toBe(true);

    writeFileSync(join(dir, "plugins/claude/skills/setup/old.md"), "left over");
    const drift = runPack(loadPackage(dir), PACK_TARGETS, { check: true });
    expect(drift.changes.filter((c) => c.change !== "unchanged")).toEqual([
      { path: "plugins/claude/skills/setup/old.md", change: "remove" },
    ]);
    runPack(loadPackage(dir), PACK_TARGETS);
    expect(existsSync(join(dir, "plugins/claude/skills/setup/old.md"))).toBe(false);
    rmSync(dir, { recursive: true });
  });

  it("writes a portable Agent Plugin, and refuses a package that does not fit the format", () => {
    const dir = fixture({ "agent-plugin": { codex: { capabilities: ["Read"] } } }, true);
    runPack(loadPackage(dir), PACK_TARGETS);
    const plugin = readJson(dir, "plugin.json");
    expect(plugin.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
    expect(plugin.extensions["com.openai"].onboardingSkill).toBe("./skills/setup/SKILL.md");
    expect(plugin.extensions["com.openai"].interface.capabilities).toEqual(["Read"]);
    // Only the closed set of top-level fields the format allows.
    const allowed = [
      "$schema",
      "name",
      "version",
      "description",
      "author",
      "homepage",
      "repository",
      "license",
      "keywords",
      "extensions",
    ];
    expect(Object.keys(plugin).every((key) => allowed.includes(key))).toBe(true);
    expect(readJson(dir, "mcp.json")).toEqual({
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        demo: { type: "stdio", command: "npx", args: ["-y", "demo-mcp@1.2.3"], env: { DEMO_MODE: "1" } },
      },
    });
    rmSync(dir, { recursive: true });

    const withRefs = fixture({ "agent-plugin": {} });
    expect(() => runPack(loadPackage(withRefs), PACK_TARGETS)).toThrow(/symbolic references/);
  });

  it("rejects an unknown target and bad options", () => {
    const unknown = fixture({ nope: {} });
    expect(() => runPack(loadPackage(unknown), PACK_TARGETS)).toThrow(/unknown pack target "nope"/);
    const bad = fixture({ "claude-plugin": { marketplce: true } });
    expect(() => runPack(loadPackage(bad), PACK_TARGETS)).toThrow();
  });
});
