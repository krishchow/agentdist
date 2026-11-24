# agentdist

An install engine for agent packages. Write your skills, subagents, commands, hooks and MCP servers once,
declare them in one manifest, and install them into any AI coding harness, either for one
repository or for the user.

```
$ npx notarize-mcp install

  Which harnesses should it be installed into?
  ◼ Claude Code   (found on this machine)
  ◼ Codex         (found on this machine)
  ◻ Cursor
  …
  Where should it be installed?
  ● User      every project · ~/.claude, ~/.codex
  ○ Project   this repository only

Installed notarize 1.5.0 for claude, codex at user scope:
  + ~/.claude/skills/notarize-setup/  (2 files)
  + ~/.agents/skills/notarize-setup/  (2 files)
  + ~/.claude.json → mcpServers.notarize
  + ~/.codex/config.toml → mcp_servers.notarize
```

The package in that example, [notarize](https://github.com/krishchow/notarize), contains no
installer code. It has an [`agentdist.json`](https://github.com/krishchow/notarize/pull/29), a
`skills/` directory, and a few lines that hand its `install` subcommand to this engine.

```bash
npm install --save-dev agentdist
```

## What a package looks like

```
my-package/
  agentdist.json
  skills/<name>/SKILL.md
  agents/<name>.md       (optional)
  commands/<name>.md     (optional)
  hooks/…                (optional)
```

```json
{
  "engine": "v1",
  "name": "notarize",
  "skills": "./skills",
  "mcpServers": {
    "notarize": {
      "command": "npx",
      "args": ["-y", "notarize-mcp@{{version}}"],
      "envPassthrough": ["ASC_KEY_ID", "ASC_ISSUER_ID"]
    }
  },
  "onboardingSkill": "setup"
}
```

Content is written once, in the Claude Code format. Where it must name something a harness spells
its own way, it uses a reference: `{{tool:notarize.doctor}}`, `{{skill:setup}}`, `{{skill_dir}}`.
The full contract, which is the seam between a package and the engine, is in
[docs/package-contract.md](docs/package-contract.md). The manifest is a Zod type
([`src/schema/manifest.ts`](src/schema/manifest.ts)) published as JSON Schema.

## Using it from a package

```ts
import { fileURLToPath } from "node:url";
import { runCli } from "agentdist";

// The directory that holds agentdist.json, here one level above this file.
const packageRoot = fileURLToPath(new URL("..", import.meta.url));

if (["install", "uninstall", "status", "harnesses"].includes(process.argv[2])) {
  process.exit(await runCli({ packageRoot, argv: process.argv.slice(2), bin: "npx my-package" }));
}
```

Ship `agentdist.json` and the content directories in the published package, since the installer
reads them from wherever the package was installed. The engine can be a regular dependency, or
bundled into your own binary as notarize does.

Or run a package from a directory with the standalone binary:

```bash
agentdist install --package ./my-package --harness claude,codex --user
agentdist validate ./my-package          # check it against the contract
agentdist pack ./my-package [--check]    # regenerate its native plugin manifests
```

## Three ways a package reaches a harness

| | Where | Updates | How |
|---|---|---|---|
| Vendored, repository | the repository (`.claude/skills`, `.mcp.json`, …) | re-run the installer | `install --local` |
| Vendored, user | your home (`~/.claude/skills`, `~/.claude.json`, …) | re-run the installer | `install --user` |
| Native plugin | the harness's plugin system | the harness updates it | `agentdist pack`, committed to the package's repository |

All three come from the same manifest. `pack` generates a Claude Code plugin, a Codex plugin, a
portable [Agent Plugin](https://agent-plugins.org/specification) and a DeepSeek Harness bundle.

## Harnesses

Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, OpenCode, Factory Droid, Devin (Windsurf),
Cline, Kilo Code, Qwen Code, Amp, pi, Goose and Zed. [docs/harnesses.md](docs/harnesses.md) lists
where each one gets each kind of artifact at each scope.

A harness is one file that says where things go, built from shared pieces: twelve of the fifteen
use the same handler for the shared `.agents/skills` directory, and Factory's "droids" are the
ordinary markdown subagent handler pointed at a different directory. Adding one is described in
[docs/adding-a-harness.md](docs/adding-a-harness.md).

## What it promises

- It only deletes what it wrote. Everything is recorded in a ledger; a name or prefix is never
  taken as proof of ownership.
- It will not overwrite a file or config entry it did not write, unless you pass `--force`, and
  then it backs it up first.
- It changes one key in your config files and leaves every other byte alone, comments included.
- An install is all or nothing: conflicts are found before the first write, and a failure restores
  every file it touched.
- When a harness cannot take something, it says which and why.

## How it works

```
agentdist.json ──▶ nodes ──harness──▶ ops ──planner──▶ plan ──executor──▶ disk
```

A harness never touches the filesystem. It answers what each node should become, as file and
config ops, and one executor applies them. That is why dry runs, uninstall, rollback and ownership
exist once rather than per harness, and why a harness is tested against a golden file of the ops it
produces. See [docs/architecture.md](docs/architecture.md).

## Status

Version 0.1. Paths and config shapes were checked against each harness's documentation in November
2026 (notes in [docs/research](docs/research)). They have been exercised end to end against
sandboxed home directories, and Codex and OpenCode were confirmed to load what the engine writes;
the other harnesses have not been tested against their real applications. Reports of a path or
shape that is wrong are very welcome.

Not built yet: installing a package by npm name from the standalone binary,
[hooks in the Codex plugin output](https://github.com/krishchow/agentdist/issues/1), and
[Windows support](https://github.com/krishchow/agentdist/issues/2).

## Lineage

The idea comes from [GSD Core](https://github.com/open-gsd/gsd-core), whose
`npx @opengsd/gsd-core` installer asks which runtimes to install into and whether to install
globally or locally, then writes the right files for each. Two things it does well are kept here:
describing each harness as data rather than as branches in the installer, and making the
repository-or-user choice part of every install.

agentdist is a complete rewrite and shares no code with it. GSD's installer exists to install GSD;
this is an engine with no application in it, so that any package of skills, subagents, commands,
hooks and MCP servers can be installed the same way. It also adds what a general engine needs and
one application's installer does not: a declared package contract, MCP servers and hooks as
first-class kinds, an ownership ledger, and generation of native plugin formats.

[notarize](https://github.com/krishchow/notarize), an MCP server and skills for Apple code signing
and notarization, is the first package built on it and the best worked example: see its
`agentdist.json` and the few lines in `src/index.ts` that call `runCli`.

## Related

[agent-install](https://github.com/millionco/agent-install) solves a neighbouring problem with a
different shape: an imperative API for installing skills and MCP entries, with wider harness
coverage for those two. agentdist is declarative (one manifest), covers subagents, commands and
hooks as well, and tracks what it wrote so that uninstall and updates never touch anything else.

## Development

```bash
pnpm install
pnpm run check     # lint, typecheck, build, test
pnpm vitest run -u test/harnesses.test.ts   # regenerate golden files after changing a harness
```
