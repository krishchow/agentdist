import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/harness/define.js";
import { HARNESSES } from "../src/harnesses/index.js";
import { NODE_KINDS } from "../src/ir/nodes.js";
import { displayPath, planInstall } from "../src/ops/plan.js";
import { SCOPES, type Scope } from "../src/schema/manifest.js";
import { demo } from "./helpers.js";

// A fixed, fictional machine, so the golden files do not depend on where the tests run.
const env: Env = { home: "/home/u", projectRoot: "/home/u/repo", vars: {}, platform: "linux" };

/** Everything a harness would do with the fixture package, as text a reviewer can read. */
function render(harnessId: string, scope: Scope): string {
  const harness = HARNESSES.find((h) => h.id === harnessId)!;
  const plan = planInstall(demo(), [harness], scope, env);
  const show = (path: string) => displayPath(path, scope, env);
  const out: string[] = [];
  for (const d of plan.diagnostics) out.push(`[${d.level}] ${d.node ?? ""} ${d.message}`);
  for (const config of plan.configs) {
    out.push("", `=== ${show(config.path)} (${config.format}) → ${config.keyPath.join(" . ")}`);
    out.push(JSON.stringify(config.value, null, 2));
  }
  for (const item of plan.items) {
    out.push("", `=== ${show(item.path)} (${item.format}) → ${item.keyPath.join(" . ")} [] (one element)`);
    out.push(JSON.stringify(item.value, null, 2));
  }
  for (const file of [...plan.files].sort((a, b) => a.path.localeCompare(b.path))) {
    out.push("", `=== ${show(file.path)}${file.executable ? " (executable)" : ""}`);
    out.push(
      typeof file.content === "string"
        ? file.content.trimEnd()
        : `<${file.content.length} bytes, copied as is>`,
    );
  }
  return `${out.join("\n").trim()}\n`;
}

describe("every harness", () => {
  it("has a unique id and cites its sources", () => {
    expect(new Set(HARNESSES.map((h) => h.id)).size).toBe(HARNESSES.length);
    for (const harness of HARNESSES) {
      expect(harness.sources.length, `${harness.id} cites no documentation`).toBeGreaterThan(0);
      expect(Object.keys(harness.kinds).sort()).toEqual([...NODE_KINDS].sort());
    }
  });

  for (const harness of HARNESSES) {
    for (const scope of SCOPES) {
      it(`${harness.id} at ${scope} scope matches its golden file`, async () => {
        const plan = planInstall(demo(), [harness], scope, env);
        // Nothing may land outside the scope's root.
        const root = scope === "user" ? env.home : env.projectRoot;
        for (const op of [...plan.files, ...plan.configs, ...plan.items]) {
          expect(op.path.startsWith(`${root}/`), `${op.path} is outside ${root}`).toBe(true);
        }
        // Every node is either installed or explained.
        const pkg = demo();
        for (const node of pkg.nodes) {
          const id = `${node.kind}:${node.name}`;
          const done = [...plan.files, ...plan.configs, ...plan.items].some((op) =>
            op.claims.some((c) => c.node === id),
          );
          const explained = plan.diagnostics.some((d) => d.node === id && d.message.startsWith("skipped"));
          expect(done || explained, `${harness.id} silently dropped ${id}`).toBe(true);
        }
        await expect(render(harness.id, scope)).toMatchFileSnapshot(
          join(__dirname, "golden", `${harness.id}.${scope}.txt`),
        );
      });
    }
  }
});

describe("harnesses installed together", () => {
  const files = (ids: string[], scope: Scope) => {
    const plan = planInstall(
      demo(),
      HARNESSES.filter((h) => ids.includes(h.id)),
      scope,
      env,
    );
    return plan.files
      .filter((f) => f.path.endsWith("demo-setup/SKILL.md"))
      .map(
        (f) =>
          `${displayPath(f.path, scope, env)} [${[...new Set(f.claims.map((c) => c.harness))].join(",")}]`,
      );
  };

  it("writes a shared skills directory once", () => {
    expect(files(["codex", "gemini", "zed"], "user")).toEqual([
      "~/.agents/skills/demo-setup/SKILL.md [codex,gemini,zed]",
    ]);
  });

  it("lets a harness that also reads Claude Code's directory use that copy", () => {
    // Cursor reads both, so a second copy would list every skill twice.
    expect(files(["claude", "cursor"], "user")).toEqual([
      "~/.claude/skills/demo-setup/SKILL.md [claude,cursor]",
    ]);
    expect(files(["cursor", "claude"], "local")).toEqual([
      ".claude/skills/demo-setup/SKILL.md [claude,cursor]",
    ]);
    // Alone, it uses the shared directory.
    expect(files(["cursor"], "user")).toEqual(["~/.agents/skills/demo-setup/SKILL.md [cursor]"]);
    // Codex needs the shared directory regardless, so both exist and Cursor claims the shared one.
    expect(files(["claude", "cursor", "codex"], "user")).toEqual([
      "~/.claude/skills/demo-setup/SKILL.md [claude]",
      "~/.agents/skills/demo-setup/SKILL.md [codex,cursor]",
    ]);
  });

  it("keeps Copilot's MCP entry out of the .mcp.json Claude Code owns", () => {
    const plan = planInstall(
      demo(),
      HARNESSES.filter((h) => ["claude", "copilot"].includes(h.id)),
      "local",
      env,
    );
    expect([...new Set(plan.configs.map((c) => displayPath(c.path, "local", env)))].sort()).toEqual([
      ".github/mcp.json",
      ".mcp.json",
    ]);
    expect(plan.diagnostics.filter((d) => d.level === "warn")).toEqual([]);
  });
});
