import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { install, missingEnv, status, uninstall } from "../src/api";
import { defineHarness, unsupported } from "../src/harness/define";
import { dialect } from "../src/harness/dialect";
import { dotHome, inConfig, inHome, inProject } from "../src/harness/locations";
import { claude } from "../src/harnesses/claude";
import { codex } from "../src/harnesses/codex";
import { cursor } from "../src/harnesses/cursor";
import { gemini } from "../src/harnesses/gemini";
import { zed } from "../src/harnesses/zed";
import type { Package } from "../src/ir/nodes";
import { markdownAgents } from "../src/surfaces/agents";
import { httpEntry, mcpConfig, stdioEntry } from "../src/surfaces/mcp";
import { skillsDir } from "../src/surfaces/skills";
import { demo, read, sandbox } from "./helpers";

const types = (result: { actions: Array<{ type: string }> }) =>
  [...new Set(result.actions.map((a) => a.type))].sort();

describe("install into Claude Code", () => {
  it("writes skills, agents, commands and the MCP entry at user scope", () => {
    const env = sandbox();
    const result = install({ pkg: demo(), harnesses: [claude], scope: "user", env });
    expect(result.applied).toBe(true);
    expect(result.conflicts).toEqual([]);

    const skill = read(env.home, ".claude/skills/demo-setup/SKILL.md");
    expect(skill).toContain("name: demo-setup");
    expect(skill).toContain("Call mcp__demo__doctor first");
    expect(skill).toContain("node ~/.claude/skills/demo-setup/scripts/run.mjs check");
    expect(skill).toContain("continue with /demo-ship-it or hand off to `demo-reviewer`");
    expect(skill).toContain("This is demo 1.2.3. Leave ${{ github.token }} and {{ handlebars }} alone.");

    const script = join(env.home, ".claude/skills/demo-setup/scripts/run.mjs");
    expect(read(script)).toContain("{{skill_dir}} stays literal in a script");
    expect(statSync(script).mode & 0o111).not.toBe(0);
    expect(read(env.home, ".claude/skills/demo-ship-it/references/notes.md")).toContain("mcp__demo__status");

    const agent = read(env.home, ".claude/agents/demo-reviewer.md");
    expect(agent).toContain("tools: Read, Grep, Bash, mcp__demo__doctor");
    expect(agent).toContain("model: sonnet");
    expect(agent).toContain("color: blue");

    expect(read(env.home, ".claude/commands/demo-ship.md")).toContain("Ship $ARGUMENTS using /demo-ship-it.");

    expect(JSON.parse(read(env.home, ".claude.json"))).toEqual({
      mcpServers: {
        demo: {
          type: "stdio",
          command: "npx",
          args: ["-y", "demo-mcp@1.2.3"],
          env: { DEMO_MODE: "1" },
          timeout: 300000,
        },
        "demo-remote": {
          type: "http",
          url: "https://mcp.example.com/mcp",
          // A reference for Claude Code to resolve; the installer never sees the token.
          headers: { Authorization: "Bearer ${DEMO_API_TOKEN}", "X-Client": "demo" },
        },
      },
    });

    expect(JSON.parse(read(env.home, ".claude/settings.json"))).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash|Edit",
            hooks: [
              { type: "command", command: 'node "$HOME/.agentdist/demo/hooks"/guard.mjs', timeout: 10 },
            ],
          },
        ],
        SessionStart: [{ hooks: [{ type: "command", command: "echo demo ready" }] }],
      },
    });
    expect(statSync(join(env.home, ".agentdist/demo/hooks/guard.mjs")).mode & 0o111).not.toBe(0);
    expect(status("demo", env).user?.harnesses).toEqual(["claude"]);
  });

  it("uses repo-relative paths and .mcp.json at local scope", () => {
    const env = sandbox();
    install({ pkg: demo(), harnesses: [claude], scope: "local", env });
    expect(read(env.projectRoot, ".claude/skills/demo-setup/SKILL.md")).toContain(
      "node .claude/skills/demo-setup/scripts/run.mjs check",
    );
    expect(JSON.parse(read(env.projectRoot, ".mcp.json")).mcpServers.demo.command).toBe("npx");
    expect(existsSync(join(env.projectRoot, ".agentdist/demo.json"))).toBe(true);
    expect(existsSync(join(env.home, ".claude"))).toBe(false);
  });

  it("honours CLAUDE_CONFIG_DIR", () => {
    const env = sandbox();
    env.vars.CLAUDE_CONFIG_DIR = join(env.home, "elsewhere");
    install({ pkg: demo(), harnesses: [claude], scope: "user", env });
    expect(existsSync(join(env.home, "elsewhere/skills/demo-setup/SKILL.md"))).toBe(true);
    expect(existsSync(join(env.home, "elsewhere/.claude.json"))).toBe(true);
  });

  it("installs a file with no references byte for byte, apart from its name", () => {
    const env = sandbox();
    const pkg = demo();
    pkg.manifest.namespace = "none";
    install({ pkg, harnesses: [claude], scope: "user", env });
    expect(read(env.home, ".claude/skills/ship-it/SKILL.md")).toBe(read(pkg.root, "skills/ship-it/SKILL.md"));
  });

  it("is idempotent", () => {
    const env = sandbox();
    install({ pkg: demo(), harnesses: [claude], scope: "user", env });
    expect(types(install({ pkg: demo(), harnesses: [claude], scope: "user", env }))).toEqual(["unchanged"]);
  });

  it("leaves the user's own config entries and comments alone", () => {
    const env = sandbox();
    const before = `{\n  "numStartups": 3,\n  "mcpServers": {\n    "mine": { "command": "x" }\n  }\n}\n`;
    writeFileSync(join(env.home, ".claude.json"), before);
    install({ pkg: demo(), harnesses: [claude], scope: "user", env });
    expect(read(env.home, ".claude.json")).toContain('"mine": { "command": "x" }');
    uninstall({ pkgName: "demo", scope: "user", env });
    expect(read(env.home, ".claude.json")).toBe(before);
  });

  it("writes nothing in a dry run", () => {
    const env = sandbox();
    const result = install({ pkg: demo(), harnesses: [claude], scope: "user", env, dryRun: true });
    expect(types(result)).toEqual(["create"]);
    expect(existsSync(join(env.home, ".claude"))).toBe(false);
    expect(existsSync(join(env.home, ".agentdist"))).toBe(false);
  });
});

describe("ownership", () => {
  it("refuses to overwrite a file or entry it did not install, unless forced", () => {
    const env = sandbox();
    const mine = join(env.home, ".claude/skills/demo-setup/SKILL.md");
    mkdirSync(dirname(mine), { recursive: true });
    writeFileSync(mine, "mine");
    writeFileSync(
      join(env.home, ".claude.json"),
      JSON.stringify({ mcpServers: { demo: { command: "other" } } }),
    );

    const refused = install({ pkg: demo(), harnesses: [claude], scope: "user", env });
    expect(refused.applied).toBe(false);
    expect(refused.conflicts.map((c) => c.target)).toEqual([
      "~/.claude/skills/demo-setup/SKILL.md",
      "~/.claude.json → mcpServers.demo",
    ]);
    expect(read(mine)).toBe("mine");
    expect(existsSync(join(env.home, ".claude/agents"))).toBe(false);

    const forced = install({ pkg: demo(), harnesses: [claude], scope: "user", env, force: true });
    expect(forced.applied).toBe(true);
    expect(read(mine)).toContain("name: demo-setup");
    expect(read(forced.backupDir!, ".claude/skills/demo-setup/SKILL.md")).toBe("mine");
    expect(JSON.parse(read(forced.backupDir!, ".claude.json")).mcpServers.demo.command).toBe("other");
  });

  it("adopts an identical entry that is already there", () => {
    const env = sandbox();
    const entry = {
      type: "stdio",
      command: "npx",
      args: ["-y", "demo-mcp@1.2.3"],
      env: { DEMO_MODE: "1" },
      timeout: 300000,
    };
    writeFileSync(join(env.home, ".claude.json"), JSON.stringify({ mcpServers: { demo: entry } }));
    const result = install({ pkg: demo(), harnesses: [claude], scope: "user", env });
    expect(result.actions.find((a) => a.target.includes("mcpServers.demo"))?.type).toBe("adopt");
  });

  it("backs up a file the user edited before updating it", () => {
    const env = sandbox();
    install({ pkg: demo(), harnesses: [claude], scope: "user", env });
    const skill = join(env.home, ".claude/skills/demo-ship-it/SKILL.md");
    writeFileSync(skill, "my edits");
    const result = install({ pkg: demo(), harnesses: [claude], scope: "user", env });
    expect(read(skill)).toContain("# Ship it");
    expect(read(result.backupDir!, ".claude/skills/demo-ship-it/SKILL.md")).toBe("my edits");
  });

  it("removes what a new version no longer ships, and nothing else", () => {
    const env = sandbox();
    install({ pkg: demo(), harnesses: [claude], scope: "user", env });
    const neighbour = join(env.home, ".claude/skills/demo-mine/SKILL.md");
    mkdirSync(dirname(neighbour), { recursive: true });
    writeFileSync(neighbour, "the prefix alone is not ownership");

    const next: Package = demo();
    next.nodes = next.nodes.filter(
      (n) => n.name !== "ship-it" && n.kind !== "mcpServer" && n.kind !== "command",
    );
    const result = install({ pkg: next, harnesses: [claude], scope: "user", env });
    expect(result.applied).toBe(true);
    expect(existsSync(join(env.home, ".claude/skills/demo-ship-it"))).toBe(false);
    expect(existsSync(join(env.home, ".claude/commands"))).toBe(false);
    // The engine created .claude.json, and nothing is left in it, so it goes too.
    expect(existsSync(join(env.home, ".claude.json"))).toBe(false);
    expect(read(neighbour)).toBe("the prefix alone is not ownership");
  });

  it("keeps a config entry the user edited when uninstalling", () => {
    const env = sandbox();
    install({ pkg: demo(), harnesses: [claude], scope: "user", env });
    const file = join(env.home, ".claude.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    config.mcpServers.demo.args = ["-y", "demo-mcp@latest"];
    writeFileSync(file, JSON.stringify(config, null, 2));
    const result = uninstall({ pkgName: "demo", scope: "user", env });
    expect(result.actions.find((a) => a.type === "keep")?.target).toBe("~/.claude.json → mcpServers.demo");
    expect(JSON.parse(read(file)).mcpServers.demo.args).toEqual(["-y", "demo-mcp@latest"]);
    expect(existsSync(join(env.home, ".claude/skills"))).toBe(false);
    expect(status("demo", env)).toEqual({});
  });

  it("rolls every write back when one fails", () => {
    const env = sandbox();
    install({ pkg: demo(), harnesses: [claude], scope: "user", env });
    const skill = join(env.home, ".claude/skills/demo-ship-it/SKILL.md");
    const before = read(skill);
    const next = demo();
    const ship = next.nodes.find((n) => n.kind === "skill" && n.name === "ship-it");
    if (ship?.kind === "skill") ship.doc.body = "changed";
    // An inline TOML-style trap is not available in JSON, so break the config file's directory instead.
    const server = next.nodes.find((n) => n.kind === "mcpServer");
    if (server?.kind === "mcpServer" && server.transport === "stdio") server.command = "changed";
    const broken = defineHarness({
      ...claude,
      kinds: {
        ...claude.kinds,
        mcpServer: mcpConfig({
          file: { user: inHome(".claude", "skills", "demo-setup", "SKILL.md", "impossible.json") },
          format: "json",
          keyPath: ["mcpServers"],
          stdio: stdioEntry(),
          http: httpEntry(),
        }),
      },
    });
    expect(() =>
      install({ pkg: next, harnesses: [broken], scope: "user", env, registry: [broken] }),
    ).toThrow();
    expect(read(skill)).toBe(before);
  });
});

describe("hooks", () => {
  const settings = (env: { home: string }) => join(env.home, ".claude/settings.json");

  it("adds one element to the user's hook lists and takes only that one back out", () => {
    const env = sandbox();
    const before = `{
  // my settings
  "model": "opus",
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "mine.sh" }] }
    ]
  }
}
`;
    mkdirSync(join(env.home, ".claude"));
    writeFileSync(settings(env), before);
    install({ pkg: demo(), harnesses: [claude], scope: "user", env });
    const after = read(settings(env));
    expect(after).toContain("// my settings");
    expect(after).toContain('{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "mine.sh" }] }');
    expect(after).toContain("guard.mjs");
    expect(after).toContain("echo demo ready");

    // Installing again does not register the hook twice.
    install({ pkg: demo(), harnesses: [claude], scope: "user", env });
    expect(read(settings(env)).match(/guard\.mjs/g)).toHaveLength(1);

    uninstall({ pkgName: "demo", scope: "user", env });
    expect(read(settings(env))).toBe(before);
    expect(existsSync(join(env.home, ".agentdist"))).toBe(false);
  });

  it("replaces its own registration when the hook changes, and leaves one the user edited", () => {
    const env = sandbox();
    install({ pkg: demo(), harnesses: [claude], scope: "user", env });
    const next = demo();
    const guard = next.nodes.find((n) => n.kind === "hook" && n.name === "guard");
    if (guard?.kind === "hook") guard.timeoutSec = 30;
    install({ pkg: next, harnesses: [claude], scope: "user", env });
    const hooks = JSON.parse(read(settings(env))).hooks;
    expect(hooks.PreToolUse).toHaveLength(1);
    expect(hooks.PreToolUse[0].hooks[0].timeout).toBe(30);

    // The user changes the registration: it no longer matches what was written, so it is theirs.
    hooks.PreToolUse[0].matcher = "Bash";
    writeFileSync(settings(env), JSON.stringify({ hooks }, null, 2));
    uninstall({ pkgName: "demo", scope: "user", env });
    expect(JSON.parse(read(settings(env))).hooks).toEqual({ PreToolUse: [hooks.PreToolUse[0]] });
  });

  it("does not register a hook twice for a harness that also runs Claude Code's", () => {
    const env = sandbox();
    install({ pkg: demo(), harnesses: [claude, cursor], scope: "local", env });
    expect(read(env.projectRoot, ".claude/settings.json")).toContain("guard.mjs");
    expect(existsSync(join(env.projectRoot, ".cursor/hooks.json"))).toBe(false);

    // On its own, Cursor gets its own registration, in its own shape and tool names.
    const alone = sandbox();
    install({ pkg: demo(), harnesses: [cursor], scope: "local", env: alone });
    expect(JSON.parse(read(alone.projectRoot, ".cursor/hooks.json"))).toEqual({
      version: 1,
      hooks: {
        preToolUse: [
          {
            command: 'node "$CURSOR_PROJECT_DIR/.agentdist/demo/hooks"/guard.mjs',
            matcher: "Shell|Write",
            timeout: 10,
          },
        ],
        sessionStart: [{ command: "echo demo ready" }],
      },
    });
    uninstall({ pkgName: "demo", scope: "local", env: alone });
    expect(existsSync(join(alone.projectRoot, ".cursor"))).toBe(false);
  });

  it("leaves a key that was already there when it arrived", () => {
    const env = sandbox();
    mkdirSync(join(env.projectRoot, ".cursor"));
    const mine = { version: 1, hooks: { stop: [{ command: "mine.sh" }] } };
    writeFileSync(join(env.projectRoot, ".cursor/hooks.json"), JSON.stringify(mine, null, 2));
    install({ pkg: demo(), harnesses: [cursor], scope: "local", env });
    uninstall({ pkgName: "demo", scope: "local", env });
    expect(JSON.parse(read(env.projectRoot, ".cursor/hooks.json"))).toEqual(mine);
  });
});

describe("remote MCP servers", () => {
  it("are written in each harness's own shape, never with a credential", () => {
    const env = sandbox();
    env.vars.DEMO_API_TOKEN = "s3cret";
    install({ pkg: demo(), harnesses: [codex, cursor, gemini], scope: "user", env });
    const toml = read(env.home, ".codex/config.toml");
    expect(toml).toContain('bearer_token_env_var = "DEMO_API_TOKEN"');
    expect(
      JSON.parse(read(env.home, ".cursor/mcp.json")).mcpServers["demo-remote"].headers.Authorization,
    ).toBe("Bearer ${env:DEMO_API_TOKEN}");
    expect(JSON.parse(read(env.home, ".gemini/settings.json")).mcpServers["demo-remote"].httpUrl).toBe(
      "https://mcp.example.com/mcp",
    );
    for (const file of [
      ".codex/config.toml",
      ".cursor/mcp.json",
      ".gemini/settings.json",
      ".agentdist/demo.json",
    ]) {
      expect(read(env.home, file)).not.toContain("s3cret");
    }
  });

  it("are skipped, with the reason, where a header cannot read the environment", () => {
    const env = sandbox();
    const result = install({ pkg: demo(), harnesses: [zed], scope: "user", env });
    expect(result.diagnostics.find((d) => d.node === "mcpServer:demo-remote")?.message).toMatch(
      /Zed cannot read DEMO_API_TOKEN from the environment/,
    );
    expect(Object.keys(JSON.parse(read(env.home, ".config/zed/settings.json")).context_servers)).toEqual([
      "demo",
    ]);
  });

  it("says which variables are not set where the installer runs", () => {
    const env = sandbox();
    expect(missingEnv(demo(), env).map((m) => [m.name, m.reason])).toEqual([
      ["DEMO_API_TOKEN", "sent to the demo-remote server"],
    ]);
    env.vars.DEMO_API_TOKEN = "x";
    expect(missingEnv(demo(), env)).toEqual([]);
  });
});

describe("harnesses that share a directory", () => {
  const shared = (id: string, agents: string) => {
    const home = dotHome(`.${id}`);
    return defineHarness({
      id,
      label: id,
      configRoot: { user: home, local: `.${id}` },
      detect: () => false,
      dialect: dialect(),
      kinds: {
        skill: skillsDir({ user: inHome(".agents", "skills"), local: inProject(".agents", "skills") }),
        agent: markdownAgents({ user: inConfig(agents), local: inConfig(agents) }),
        command: unsupported("no command surface"),
        mcpServer: mcpConfig({
          file: { user: inConfig("mcp.json") },
          format: "json",
          keyPath: ["mcpServers"],
          stdio: stdioEntry(),
          http: "no remote servers",
        }),
        hook: unsupported("no hooks"),
      },
      sources: [],
    });
  };
  const alpha = shared("alpha", "agents");
  const beta = shared("beta", "droids");
  const registry = [alpha, beta];

  it("writes the shared skills once and keeps them until the last harness leaves", () => {
    const env = sandbox();
    const result = install({ pkg: demo(), harnesses: [alpha, beta], scope: "user", env, registry });
    const skill = join(env.home, ".agents/skills/demo-setup/SKILL.md");
    expect(result.actions.filter((a) => a.target === "~/.agents/skills/demo-setup/SKILL.md")).toHaveLength(1);
    expect(status("demo", env).user?.files[".agents/skills/demo-setup/SKILL.md"]?.harnesses).toEqual([
      "alpha",
      "beta",
    ]);
    expect(existsSync(join(env.home, ".alpha/agents/demo-reviewer.md"))).toBe(true);
    expect(existsSync(join(env.home, ".beta/droids/demo-reviewer.md"))).toBe(true);

    uninstall({ pkgName: "demo", scope: "user", env, harnessIds: ["alpha"] });
    expect(existsSync(skill)).toBe(true);
    expect(existsSync(join(env.home, ".alpha"))).toBe(false);
    expect(existsSync(join(env.home, ".beta/droids/demo-reviewer.md"))).toBe(true);
    expect(status("demo", env).user?.harnesses).toEqual(["beta"]);

    uninstall({ pkgName: "demo", scope: "user", env, harnessIds: ["beta"] });
    expect(existsSync(join(env.home, ".agents"))).toBe(false);
    expect(status("demo", env)).toEqual({});
  });

  it("re-plans harnesses from an earlier install so they are not dropped", () => {
    const env = sandbox();
    install({ pkg: demo(), harnesses: [alpha], scope: "user", env, registry });
    const result = install({ pkg: demo(), harnesses: [beta], scope: "user", env, registry });
    expect(result.harnessIds).toEqual(["beta", "alpha"]);
    expect(existsSync(join(env.home, ".alpha/agents/demo-reviewer.md"))).toBe(true);
  });

  it("reports what a harness cannot take, and why", () => {
    const env = sandbox();
    const result = install({ pkg: demo(), harnesses: [alpha], scope: "local", env, registry });
    const messages = result.diagnostics.map((d) => `${d.node}: ${d.message}`);
    expect(messages).toContain("command:ship: skipped: no command surface");
    expect(messages).toContain("mcpServer:demo: skipped: no local-scope MCP configuration");
    // Non-canonical harnesses drop Claude-only frontmatter and model aliases.
    const agent = read(env.projectRoot, ".alpha/agents/demo-reviewer.md");
    expect(agent).not.toContain("model:");
    expect(agent).not.toContain("color:");
  });
});
