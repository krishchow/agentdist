# The package contract

This is the seam between a package and the engine: the shape a package must have, and what the
engine promises in return. The manifest half of it is the Zod type `AgentPkg` in
[`src/schema/manifest.ts`](../src/schema/manifest.ts), published as JSON Schema at
`agentpkg/schema.json`.

A package is **content in one canonical dialect plus one manifest**. It contains no installer code,
and it never mentions a harness.

```
my-package/
  agentpkg.json                  the only file the engine reads for intent
  skills/<name>/SKILL.md         plus any supporting files beside it
  agents/<name>.md               optional
  commands/<name>.md             optional
```

## The four rules

1. **Content is written once, in the canonical dialect.** That is the Claude Code format: Agent
   Skills folders, markdown subagents and commands with YAML frontmatter, tool grants spelled with
   Claude Code's built-in tool names.
2. **Anything a harness spells its own way is a symbolic reference, never a literal.** See
   [References](#references).
3. **Everything that touches a user's config is declared, not performed.** MCP servers are entries
   in the manifest. The engine owns every write, the record of what it wrote, and the undo.
4. **Scope is invisible to the package.** A package cannot ask where it was installed. The one
   thing it may need, the directory a skill landed in, is the reference `{{skill_dir}}`.

If a package ever needs `if (harness === …)`, the seam has leaked and the engine is what should
change.

## `agentpkg.json`

```jsonc
{
  "$schema": "https://unpkg.com/agentpkg/schema/agentpkg.schema.json",
  "engine": "v1",                 // contract version; a floating major
  "name": "notarize",             // identity and ownership namespace
  "version": "1.5.0",             // optional: defaults to the package.json beside it
  "description": "…",

  "skills": "./skills",           // each optional; a package needs at least one thing to install
  "agents": "./agents",
  "commands": "./commands",
  "mcpServers": {
    "notarize": {
      "command": "npx",
      "args": ["-y", "notarize-mcp@{{version}}"],
      "env": { "MODE": "1" },                 // literal values the package sets
      "envPassthrough": ["ASC_KEY_ID"],       // names the server reads from the user's environment
      "startupTimeoutSec": 60,
      "toolTimeoutSec": 300
    }
  },

  "namespace": "prefix",          // "prefix" (default) or "none"
  "onboardingSkill": "setup",
  "scopes": ["local", "user"],    // restrict where it may be installed; default both
  "harnesses": ["claude", "codex"], // restrict which harnesses; default all the engine knows

  "listing": { "displayName": "…", "category": "…", "author": { "name": "…" } },
  "pack": { "claude-plugin": {}, "codex-plugin": { "capabilities": ["Read", "Write"] } }
}
```

Unknown keys are an error, so a typo is caught instead of ignored. `{{version}}` and `{{name}}` are
filled into an MCP server's `command` and `args`.

| Field | Read by | Notes |
|---|---|---|
| `engine`, `name`, `version` | everything | `name` is lowercase letters, digits and hyphens |
| `skills`, `agents`, `commands` | install, pack | directories inside the package |
| `mcpServers` | install, pack | stdio servers; `env` values are literal, `envPassthrough` is names only |
| `namespace` | install | how vendored names avoid collisions (below) |
| `onboardingSkill` | install hint, pack | must name a skill the package has |
| `scopes`, `harnesses` | install | restrictions only; they never change what is written |
| `listing` | pack | marketplace metadata; a vendored install ignores it |
| `pack` | pack | which native plugin formats to generate, with per-target options |

## Content

| Kind | File | Required frontmatter | Notes |
|---|---|---|---|
| Skill | `skills/<name>/SKILL.md` | `name` (equal to the folder), `description` | every other file in the folder ships with it |
| Subagent | `agents/<name>.md` | `name` (equal to the file), `description` | optional `tools`, `model` |
| Command | `commands/<name>.md` | none | optional `description`, `argument-hint`; `$ARGUMENTS` in the body |

Tool grants (`tools`, `allowed-tools`) use Claude Code's built-in names, and `mcp:<server>.<tool>`
or `mcp:<server>` for the package's own MCP servers. Each harness maps them to its own names; a
grant a harness cannot express is dropped with a warning.

Symlinks inside a package are not followed, so a package cannot install bytes from outside itself.

## References

| Reference | Becomes |
|---|---|
| `{{tool:<server>.<tool>}}` | the harness's name for that MCP tool, e.g. `mcp__notarize__doctor` |
| `{{skill:<name>}}` | how that skill is invoked, e.g. `/notarize-setup` or `$notarize-setup` |
| `{{agent:<name>}}`, `{{command:<name>}}` | the installed name, in the harness's syntax |
| `{{skill_dir}}` | where this skill is installed: `~/.claude/skills/notarize-setup`, or repo-relative |
| `{{pkg.name}}`, `{{pkg.version}}` | the package's own |

References are resolved in markdown and text files. Scripts and other files are copied byte for
byte. Anything else in double braces (`${{ github.token }}`, a Handlebars sample) is left alone. A
reference to something the package does not declare fails validation; nothing is installed.

A package with no references at all is valid, and is the common case for one that already works as
a native plugin. References become necessary only when content must name a tool or path exactly.

## Namespacing

Vendored artifacts land in directories shared with the user's own skills and other packages, so by
default the engine installs skill `setup` of package `notarize` as `notarize-setup`, and rewrites
the `name` in its frontmatter to match. A name that already starts with the package name is left
alone. `"namespace": "none"` turns this off.

Native plugins are namespaced by the harness itself, so `pack` never prefixes.

## What the engine promises

- **It only deletes what it wrote.** Every file and config key is recorded in a ledger
  (`.agentpkg/<name>.json` in the repository, or in your home directory). A name or a prefix is
  never treated as proof of ownership.
- **It will not overwrite what it did not write.** An existing file or config entry that is not in
  the ledger is a conflict, reported before anything changes. `--force` replaces it after backing
  it up.
- **Your edits are backed up.** A file you changed since the last install is copied to
  `.agentpkg/backup/` before it is updated or removed. A config entry you changed is left in place
  on uninstall.
- **Config files stay yours.** The engine changes one key and leaves every other byte, comment and
  formatting choice alone. A file it cannot parse is never touched.
- **An install is all or nothing.** Conflicts are found before the first write, and a failure part
  way through restores every file it touched.
- **Unsupported is reported, not silent.** If a harness cannot take a kind of artifact, the install
  says which and why.
