import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/harness/define";
import { HARNESSES } from "../src/harnesses/index";
import { NODE_KINDS } from "../src/ir/nodes";
import { displayPath, planInstall } from "../src/ops/plan";
import { SCOPES, type Scope } from "../src/schema/manifest";
import { demo } from "./helpers";

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

  it("leaves a command out of the shared skills when a harness there has it as its own", () => {
    const shipped = (ids: string[], scope: Scope, vars: Record<string, string> = {}) => {
      const plan = planInstall(
        demo(),
        HARNESSES.filter((h) => ids.includes(h.id)),
        scope,
        { ...env, vars },
      );
      return {
        files: plan.files
          .filter((f) => /demo-ship\.|demo-ship\//.test(f.path))
          .map(
            (f) =>
              `${displayPath(f.path, scope, env)} [${f.claims
                .map((c) => c.harness)
                .sort()
                .join(",")}]`,
          )
          .sort(),
        warnings: plan.diagnostics
          .filter((d) => d.level === "warn" && d.node === "command:ship" && !d.message.includes("$ARGUMENTS"))
          .map((d) => `${d.harness}: ${d.message}`),
      };
    };
    // Cursor reads .agents/skills and has commands, so it would list Codex's skill beside its own.
    expect(shipped(["codex", "cursor"], "local")).toEqual({
      files: [".cursor/commands/demo-ship.md [cursor]"],
      warnings: [
        "codex: command ship is not installed for Codex: as a skill in .agents/skills it would show up a second time in Cursor, which reads that directory and installs the command as its own",
      ],
    });
    expect(shipped(["amp", "gemini", "opencode"], "user").warnings).toEqual([
      "amp: command ship is not installed for Amp: as a skill in ~/.agents/skills it would show up a second time in Gemini CLI and OpenCode, which read that directory and install the command as its own",
    ]);
    // Cline reads .agents/skills only in a project.
    expect(shipped(["codex", "cline"], "local").files).toEqual([".cline/workflows/demo-ship.md [cline]"]);
    expect(shipped(["codex", "cline"], "user").files).toEqual([
      "~/.agents/skills/demo-ship/SKILL.md [codex]",
      "~/.cline/workflows/demo-ship.md [cline]",
    ]);
    // Gemini's user skills move with GEMINI_CLI_HOME, away from Codex's.
    expect(shipped(["codex", "gemini"], "user", { GEMINI_CLI_HOME: "/elsewhere" }).files).toContain(
      "~/.agents/skills/demo-ship/SKILL.md [codex]",
    );
    // Harnesses whose commands are skills too, or that do not read the directory, change nothing.
    for (const [ids, writers] of [
      [["codex", "amp", "zed", "goose"], "amp,codex,goose,zed"],
      [["codex", "claude"], "codex"],
      [["codex", "copilot", "devin"], "codex"],
    ] as const) {
      const { files, warnings } = shipped([...ids], "local");
      expect(files, ids.join(",")).toContain(`.agents/skills/demo-ship/SKILL.md [${writers}]`);
      expect(warnings, ids.join(",")).toEqual([]);
    }
  });

  it("gives Goose its subagents in the directory it prefers, in its own dialect", () => {
    for (const [scope, path] of [
      ["user", "/home/u/.goose/agents/demo-reviewer.md"],
      ["local", "/home/u/repo/.goose/agents/demo-reviewer.md"],
    ] as const) {
      const plan = planInstall(
        demo(),
        HARNESSES.filter((h) => h.id === "goose"),
        scope,
        env,
      );
      const agent = plan.files.find((f) => f.claims.some((c) => c.node === "agent:reviewer"));
      expect(agent?.path).toBe(path);
      // A model alias would reach Goose's provider as a model id, and a tool list is ignored.
      expect(agent?.content).toMatch(
        /^---\nname: demo-reviewer\ndescription: Reviews a change before it ships\.\n---\n/,
      );
    }
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
    // Nothing is shared with Claude Code's entries, so neither is said to win over the other.
    expect(
      plan.diagnostics.filter((d) => d.level === "warn" && d.message.includes("is shared with")),
    ).toEqual([]);
  });
});
