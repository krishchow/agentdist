# Architecture

```
agentdist.json ──Zod──▶ nodes ──harness──▶ ops ──planner──▶ plan ──executor──▶ disk
 + content            (IR)    (pure)            (merge)            (+ ledger, backup, rollback)
```

Each arrow is one module boundary, and data crosses it in one direction only.

| Stage | Code | Knows about | Does not know about |
|---|---|---|---|
| Schema | `src/schema` | the manifest and frontmatter contract | everything else |
| IR | `src/ir` | packages: skills, subagents, commands, MCP servers, references | harnesses, scopes, the filesystem beyond reading the package |
| Transforms | `src/transforms` | one markdown file and a dialect | where the file is going |
| Surfaces | `src/surfaces` | one kind of artifact and one way of storing it | which harness is asking |
| Harnesses | `src/harnesses` | one harness: its directories, config files and dialect | other harnesses, and how anything is written |
| Planner | `src/ops/plan.ts` | merging what several harnesses asked for | what any op means |
| Executor | `src/executor` | files, config formats, ownership | packages and harnesses |
| Pack | `src/pack` | native plugin formats | installing |
| CLI | `src/cli` | prompts, flags, output | everything else, through `src/api.ts` |

## Nodes

`src/ir/nodes.ts` defines five node kinds: `skill`, `agent`, `command`, `mcpServer`, `hook`. A node holds
what the package author wrote, parsed and validated, with nothing harness-shaped in it. Loading
(`src/ir/load.ts`) reports every problem in a package at once.

## Ops

A harness never touches the filesystem. It answers one question per node: what should exist? The
answer is a list of three kinds of op (`src/ops/types.ts`):

- **`file`**: a whole file the package owns.
- **`config`**: one key the package owns inside a config file that belongs to the user, as a
  format (`json`, `jsonc`, `toml`, `yaml`), a key path and a value.
- **`config-item`**: one element the package owns inside a list in such a file, which is how hooks
  are registered. It is identified by its value, so it is never added twice, and only an element
  still equal to what was written is ever removed.

That is the entire vocabulary. Because adapters only describe, dry runs, uninstall, rollback,
conflict detection and the ownership ledger are written once, in the executor, and a harness is
tested by comparing the ops it produces with a golden file.

## Harnesses

A harness (`src/harness/define.ts`) is a config directory per scope, a dialect, and **one handler
per node kind**:

```ts
kinds: { [K in NodeKind]: Handler<K> }
```

The record is exhaustive, which is the point of the design. A new harness cannot be added without
saying what it does with each kind, even if the answer is `unsupported("why")`. A new node kind is
a compile error in every harness until each one answers. Nothing is ever dropped silently: an
unsupported kind, or a scope the harness has no surface for, becomes a diagnostic the user sees.

Handlers are not written per harness. They come from **surfaces**:

| Surface | Parameters | Used for |
|---|---|---|
| `skillsDir(dir)` | directory per scope, other directories the harness also reads | Agent Skills folders |
| `sharedSkills()` | the same, fixed to `.agents/skills` | the cross-harness skills directory |
| `markdownAgents(dir, opts)` | directory, extension, tool-list style, folder layout | subagents as markdown |
| `tomlAgents(dir, opts)` | directory, field builder | subagents as TOML (Codex) |
| `markdownCommands(dir, opts)` / `tomlCommands` | directory, arguments placeholder | slash commands |
| `mcpConfig({file, format, keyPath, stdio, http})` | file per scope, format, key path, entry shapes | MCP registration |
| `hooksConfig({file, keyPath, item, events})` | file per scope, event names, registration shape | hooks in a config file's lists |
| `hooksDir({dir, file, events})` | directory per scope, event names, file shape | hooks as one definition file each |

So Factory's subagents are `markdownAgents` pointed at `droids/` instead of `agents/`, and twelve
harnesses share the single `sharedSkills()` handler. See [adding a harness](adding-a-harness.md).

A **dialect** is how a harness spells what content refers to symbolically: an MCP tool's name, a
skill invocation, the built-in tool names in a subagent's allowlist. Rendering references is the
only rewriting of content the engine does.

## The planner

`planInstall` asks every selected harness about every node, then merges:

- Two harnesses that produce the same file are planned once and both **claim** it. This is how
  `.agents/skills` is written a single time however many harnesses read it.
- A shared directory is rendered in the **portable dialect** (tools and skills named in prose), so
  every harness that reads it produces identical bytes.
- A file op may list other paths the harness would also read the artifact from. If another harness
  in the plan already writes one of them, the op is dropped and that file is claimed instead.
  Cursor reads both `.agents/skills` and `.claude/skills`; installed alongside Claude Code it uses
  Claude Code's copy rather than listing every skill twice.
- A hook registration works the same way: Cursor and Devin also run Claude Code's hooks, so with
  Claude Code in the plan they claim its registration instead of adding one that would fire twice.
- If two harnesses want different content at one path, the first wins and the user is told.

## The executor

`applyInstall` makes a scope match a plan, in two phases.

1. **Decide.** Every file and config key is classified before anything is written: create,
   update, unchanged, adopt (already there and identical), or conflict (there, different, and not
   in the ledger). Whatever the previous install owned and the plan no longer wants is marked for
   removal. Any conflict stops the run here.
2. **Apply.** Writes go through a transaction that remembers what each path held, so a failure
   restores all of them. Files are written to a temporary name and renamed. A config file that is
   a symlink is written through, not replaced.

The **ledger** (`.agentdist/<package>.json` under the repository or the home directory) records each
file's hash and each config value's hash, with the harnesses that claim it. It is the only basis
for deletion. Uninstall works from the ledger alone, so it needs no package source, and it removes
an entry only when its last claiming harness goes.

Config edits (`src/executor/config.ts`) are textual and surgical: one key changes and every other
byte stays. Each edit is re-parsed and checked against the intended value before it is written, and
a file that does not parse is never touched.

## Delivery: vendored and plugin

The same nodes reach a harness two ways.

| | Vendored (`install`) | Plugin (`pack`) |
|---|---|---|
| Who delivers | the engine copies into harness directories | the harness, from its marketplace |
| Scope | repository or user | whatever the harness's plugin system offers, usually user |
| Updates | re-run the installer | the harness updates it |
| Names | prefixed with the package name | namespaced by the harness |
| Runs | on the user's machine | in the package's CI, output committed |

`pack` reuses the same surfaces. Content with no symbolic references is already valid everywhere,
so a plugin manifest points at the source directories. Content with references is rendered in the
plugin's dialect into a directory the target owns.

## Extending

`runCli` takes a `harnesses` array, so a package or a wrapper can add a harness the engine does not
ship, or narrow the list. Everything a harness file uses is exported from the package root.
