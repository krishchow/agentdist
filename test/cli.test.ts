import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs, UsageError } from "../src/cli/args";
import { runCli } from "../src/cli/run";
import type { Env } from "../src/harness/define";
import { claude } from "../src/harnesses/claude";
import { FIXTURE, read, sandbox } from "./helpers";

async function cli(env: Env, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = await runCli({
    packageRoot: FIXTURE,
    argv,
    bin: "npx demo",
    env,
    harnesses: [claude],
    interactive: false,
    stdout: (t) => {
      out += t;
    },
    stderr: (t) => {
      err += t;
    },
  });
  return { code, out, err };
}

describe("parseArgs", () => {
  it("reads scopes, harness lists and flags", () => {
    const args = parseArgs(["install", "--harness", "claude,codex", "--harness=cursor", "-g", "-n"]);
    expect(args).toMatchObject({
      command: "install",
      harnesses: ["claude", "codex", "cursor"],
      scope: "user",
      dryRun: true,
    });
    expect(parseArgs(["install", "--project"]).scope).toBe("local");
  });
  it("rejects contradictions and unknown options", () => {
    expect(() => parseArgs(["install", "-g", "-l"])).toThrow(UsageError);
    expect(() => parseArgs(["install", "--scope", "everywhere"])).toThrow(UsageError);
    expect(() => parseArgs(["install", "--wat"])).toThrow(/unknown option/);
    expect(() => parseArgs(["install", "--harness"])).toThrow(/needs a value/);
  });
});

describe("cli", () => {
  it("says what it needs instead of guessing when it cannot ask", async () => {
    const env = sandbox();
    expect((await cli(env, "install")).err).toMatch(/say which harnesses to install into: --harness claude/);
    expect((await cli(env, "install", "--harness", "claude")).err).toMatch(
      /--user \(every project\) or --local/,
    );
    expect((await cli(env, "install", "--harness", "nope", "-g")).err).toMatch(
      /cannot be installed into "nope"/,
    );
    expect(existsSync(join(env.home, ".claude"))).toBe(false);
  });

  it("installs, reports, and uninstalls", async () => {
    const env = sandbox();
    const installed = await cli(env, "install", "--harness", "claude", "--user");
    expect(installed.code).toBe(0);
    expect(installed.out).toContain("Installed demo 1.2.3 for claude at user scope");
    expect(installed.out).toContain("+ ~/.claude.json → mcpServers.demo");
    expect(installed.out).toContain("run /demo-setup to finish setting up");

    expect((await cli(env, "status")).out).toMatch(
      /User \(~\): demo 1.2.3 for claude; 6 files, 1 config entries/,
    );
    expect((await cli(env, "install", "--harness", "claude", "--user")).out).toContain(
      "7 already up to date",
    );

    const removed = await cli(env, "uninstall");
    expect(removed.out).toContain("- ~/.claude/skills/demo-setup/SKILL.md");
    expect(existsSync(join(env.home, ".claude"))).toBe(false);
    expect((await cli(env, "status")).out).toContain("demo is not installed.");
  });

  it("previews with --dry-run and stops on conflicts without --force", async () => {
    const env = sandbox();
    const dry = await cli(env, "install", "--all", "--local", "--dry-run");
    expect(dry.out).toContain("Would install demo 1.2.3 for claude at local scope");
    expect(existsSync(join(env.projectRoot, ".claude"))).toBe(false);

    await cli(env, "install", "--all", "--local");
    await cli(env, "uninstall", "--local");
    // Leave a foreign file where the package wants to write.
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(env.projectRoot, ".claude/commands"), { recursive: true });
    writeFileSync(join(env.projectRoot, ".claude/commands/demo-ship.md"), "mine");
    const blocked = await cli(env, "install", "--all", "--local");
    expect(blocked.code).toBe(1);
    expect(blocked.err).toContain("✗ .claude/commands/demo-ship.md");
    expect((await cli(env, "install", "--all", "--local", "--force")).code).toBe(0);
    expect(read(env.projectRoot, ".claude/commands/demo-ship.md")).toContain("Ship $ARGUMENTS");
  });

  it("with --yes installs into the harnesses it finds", async () => {
    const env = sandbox();
    expect((await cli(env, "install", "--yes", "--user")).err).toMatch(/no supported harness was found/);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(env.home, ".claude"));
    expect((await cli(env, "install", "--yes", "--user")).code).toBe(0);
  });

  it("prints JSON without file contents", async () => {
    const env = sandbox();
    const { out } = await cli(env, "install", "--harness", "claude", "--user", "--json");
    const result = JSON.parse(out);
    expect(result.applied).toBe(true);
    expect(result.plan).toBeUndefined();
    expect(result.harnessIds).toEqual(["claude"]);
  });
});
