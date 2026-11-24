<!-- Research notes gathered 2026-11-24 by a research agent. Cells marked UNVERIFIED were not confirmed. -->

## Scope and method

I read source from HEAD tarballs (2026-11-24) of rulesync v43.13.0, anywhere-agents, ai-memory and doubleagent, plus the doubleagent and Letta doc pages. Nothing was executed; the rulesync path table comes from static extraction of every `getSettablePaths` plus `src/constants/*-paths.ts`.

Not verified:
- **Gemini CLI in rulesync:** there is no `geminicli` target at v43.13.0 (grep of `src/` and `docs/` is empty). The Gemini lineage is covered by `antigravity-cli` / `antigravity-ide`. Gemini CLI rows below come from ai-memory.
- **anywhere-agents design doc:** `pack-architecture.md` is cited throughout its code but is not in the repo.
- **Letta:** the page is 1.7 MB and I read only the first 100k characters.
- **Antigravity global agents dir:** the constant is a multi-line `join` my extractor did not resolve.
- **OpenCode MCP key:** docs and code disagree (see table).

Local copies:
- Sources: `/private/tmp/claude-501/-Users-krish-projects-gsd-core/8c22bd47-632a-4d60-a457-bc6ecc41a62c/scratchpad/tar/{rulesync,anywhere-agents,ai-memory,doubleagent}`
- Raw extracted path dumps for all ~60 targets: `/private/tmp/claude-501/-Users-krish-projects-gsd-core/8c22bd47-632a-4d60-a457-bc6ecc41a62c/scratchpad/paths-{mcp,skills,subagents,commands}.txt`

---

## 1. rulesync (dyoshikawa/rulesync) — MIT, 1.6k stars, v43.13.0

**(a) What it does.** A TypeScript CLI. Canonical sources live in `.rulesync/` (`rules/`, `commands/`, `subagents/`, `skills/*/SKILL.md`, `mcp.jsonc`, `hooks.jsonc`, `permissions.jsonc`, `checks/`). `generate` writes native files for about 60 targets; `import` reverses it. `--global` writes the same content under `$HOME`.

**(b) Architecture.**
- **Feature × tool matrix of classes, no per-harness adapter object.** One file per pair: `src/features/{feature}/{tool}-{feature}.ts`. Each class has static `getSettablePaths({global})`, `fromRulesyncX()` (canonical to native), `toRulesyncX()` (import), `forDeletion()` and `isDeletable()`.
- **Registry.** `src/types/processor-registry.ts` binds each of 9 features to a processor, a target enum and a factory map. Each factory entry carries capability metadata, e.g. for MCP `{supportsProject, supportsGlobal, supportsEnabledTools, supportsDisabledTools}` (`src/features/mcp/mcp-processor.ts`).
- **Derived target list.** "A tool exists iff at least one feature supports it": `ALL_TOOL_TARGETS` is the union of per-feature tuples in `src/types/tool-target-tuples.ts`. The README support table and `.gitignore` entries are generated from the registry.
- **Base types.** `AiFile` (`src/types/ai-file.ts`) is `outputRoot + relativeDirPath + relativeFilePath + content + global`, with a path-traversal check in `getFilePath()`. `AiDir` covers skills. Global scope is the same relative path with `outputRoot = home`, unless `getSettablePaths` branches on `global`.
- **Deduplication of shared conventions.**
  - Path constants per tool in `src/constants/<tool>-paths.ts`; cross-tool `.agents/*` in `agentsmd-paths.ts`.
  - Family layouts: `OpencodeLayout` in `src/constants/opencode-paths.ts` is reused by `opencode`, `opencodev1` and `mimocode` by overriding a layout struct. Pi/omp and `antigravity-shared-*` work the same way.
  - `src/features/shared/shared-config-gateway.ts`: one read-modify-write gateway for multi-feature config files. It holds format codecs (yaml/json/jsonc/json5/toml), two named merge policies (`replace-owned-keys`, `deep-merge`), and a `SHARED_CONFIG_OWNERSHIP` table of file → feature → owned top-level keys. A CI test keeps the table in step with the registry, and writes outside declared ownership are rejected.
  - `src/constants/shared-config-paths.ts` (`SHARED_USER_MANAGED_CONFIG_PATHS`): files rulesync merges into rather than owns. They are never gitignored and never created just to hold an empty payload.
  - `src/lib/orphan-sweep.ts`: a run-scoped claim registry so targets sharing a directory (`.agents/skills`) do not delete each other's output; sweeps are deferred until all writes finish.
- **Adding a tool** (CONTRIBUTING.md §"How to Add Support"): create the feature file and test, add the target to the tuple, register it in the processor factory, define scopes in `getSettablePaths`, add an e2e test, regenerate gitignore and tables.
- **Canonical format.** Shared frontmatter (`name`, `description`, `targets`) plus per-tool namespaced blocks (`claudecode:`, `codexcli:` ...). MCP is the same: shared `mcpServers` plus `{tool}.mcpServers` overrides, where a tool entry replaces the shared one wholesale and `null` removes it.
- **No cross-harness tool-name mapping for subagents.** Tool lists live in the per-tool block. Name translation exists only for hooks matchers (`Read` → `read` for OpenCode/Kilo) and permissions.
- **Simulated features.** Tools lacking native commands/subagents/skills get `.agents/{commands,agents,skills}` plus rule-file instructions (`simulated-subagent.ts`).

**(c) Data worth lifting.**
- The path table in the final section.
- **Canonical MCP server schema** (`src/types/mcp.ts`): `type|transport` ∈ local/stdio/sse/http/ws/streamable-http; `command` string or array; `args`, `url`, `httpUrl`, `env`, `headers`, `cwd`, `disabled`, `timeout` (ms), `networkTimeout`, `enabledTools`, `disabledTools`. Tool-only fields are namespaced (`codexcliTools`, `crushOauth*`, `poolAllow`, `kiroAutoApprove` ...) and stripped by `RulesyncMcp.getMcpServers()` before reaching other tools.
- **Collision rule** when a canonical field and a native field share a name (doc comment on `enabledTools` in `src/types/mcp.ts`): merge if the native key is an additive synonym (Kiro); canonical wins with a warning if rulesync owns the value (Copilot CLI `tools`); refuse if the native key means something else (Codex `tools`).
- **Per-tool MCP translations** (each in `src/features/mcp/<tool>-mcp.ts`):

| Tool | Translation |
|---|---|
| Codex | `enabledTools`→`enabled_tools`, `envVars`→`env_vars`, `timeout`→`tool_timeout_sec`, `networkTimeout`→`startup_timeout_sec`, headers→`http_headers`, `oauth.clientId`→`client_id` |
| OpenCode / Kilo | `type: local\|remote`, `command` as array, `env`→`environment`, `disabled`→`enabled` (inverted) |
| Antigravity | `url`→`serverUrl`, no `type`, `timeout` ms→`timeoutSeconds` |
| Zed | no `type`, `disabled`→`enabled: false`, array command flattened |
| Copilot CLI | `type` required, `enabledTools`→`tools` |
| Pool | headers as a `"Name: value"` list |
| Pi | timeout ms→s |
| Warp | `cwd`→`working_directory` |
| GitLab Duo | `timeout`→`timeoutMs` |

- **Env-var reference syntax** (`mcp-env-var-format.ts`): canonical `${VAR}`; Cursor `${env:VAR}`; OpenCode/Kilo `{env:VAR}`.
- **Codex subagent**: `.codex/agents/<name>.toml` with `name`, `description`, `developer_instructions` (the body), `model_reasoning_effort`, `sandbox_mode` (`codexcli-subagent.ts`).
- **Hook event matrix and frontmatter capability lists**: `docs/reference/file-formats.md` (1 MB), §"Hook event × tool matrix" at line 410 and skills at line 1069.
- **Mutation-plan shape** (`src/lib/generate-plan.ts`, `generate --json`): `{action: write|delete, feature, path, kind: file|directory|key}`, versioned. This is close to the "ops" in your design.

**(d) Pitfalls.**
- **No ownership manifest.** Deletion is "sweep the tool directory; anything not generated this run is an orphan". Docs admit `generate --delete` "removes every `*.md` file left in those workflow directories, including hand-written ones". Changing a resolved root (`HERMES_HOME`) "strands whatever it generated under the previous one".
- **Whole-key replacement of shared config.** `claudecode-mcp.ts` writes `{...json, mcpServers: rulesyncMcp.getMcpServers()}`, so servers the user added to `~/.claude.json` with `claude mcp add` are dropped. OpenClaw is the stated exception: merge by name, never retract. Open issues #2401 (Copilot `mcp.json` `inputs`/`sandbox` clobbered) and #2414 (Hermes keys clobbered).
- **Comments lost.** JSONC/JSON5 files are rewritten as plain JSON in several adapters; JSON5-only files are refused.
- **Symlink write-through.** Open issue #3945: generate writes through an `AGENTS.md -> .claude/CLAUDE.md` link.
- **Several targets share one file**, which forces ordered multi-block resolution: project `.mcp.json` is shared by claudecode, codebuddy, commandcode and qoder; `.agents/skills` by about 12 targets; `.kiro/settings/mcp.json` by three.
- **Command/skill collisions** where commands are emitted as skills (Antigravity, Devin, Warp, Kimi): a same-named skill silently wins.
- **Relocation env vars barely honoured.** Only Hermes, Kimi, Muse, Pool and partly Codex skills; no `CLAUDE_CONFIG_DIR` handling in MCP or agents.
- **Upstream churn is the dominant maintenance cost.** The docs are full of version-pinned notes: OpenCode v1/v2 split, Kiro CLI/IDE split, Windsurf→Devin, Roo→Zoo, Continue end of life.
- **Size.** About 60 classes per feature, with 1,100+ line single-tool adapters (`codexcli-mcp.ts`, `opencode-mcp.ts`).

---

## 2. anywhere-agents (yzhao062) — Apache-2.0, 263 stars

**(a) What it does.** A Python/shell bootstrap that composes "packs" (rules, skills, hooks, permissions) from git sources into a repo and into `~/.claude`. It is Claude-Code-first; Codex is served by a generated `agents/codex.md` and by symlinks. The CLI offers `pack add|remove|list --drift|verify` and `uninstall --all`.

**(b) Multi-harness model: weak.**
- The manifest (`bootstrap/packs.yaml`, v2) has `passive:` (rule text into `AGENTS.md` marker blocks) and `active:` entries with `kind: skill|hook|permission|command`, `hosts: [claude-code, codex]`, and literal `files: [{from, to: .claude/skills/x/}]` destinations. Paths are not abstracted per harness.
- Codex skills are a derived view: `scripts/packs/codex_links.py` symlinks `.agents/skills/<name>` → `../../.claude/skills/<name>`, POSIX only.
- Per-agent rule text comes from one `AGENTS.md` with `<!-- agent:claude -->` blocks (`scripts/generate_agent_configs.py`).
- A new harness means new generator code; there is no adapter interface.

**(c) Worth lifting: the executor and lifecycle layer** (`scripts/packs/`). This is the best prior art for your executor.
- **`state.py`: three records.**
  - `pack-lock.json`: source URL, requested ref, resolved commit, sha256 of every input.
  - Project `pack-state.json`: keyed by output path, with pack attribution and sha256.
  - User-level `~/.claude/pack-state.json`: keyed by `(kind, absolute_target_path)` with an `owners:` list, so several repos can co-own one user-scope output (refcounted).
- **`transaction.py`: "recoverable staged transaction".** It journals every op (write / delete / restamp) with pre-state and new-content hashes plus PID, then commits with per-file `os.replace`. It explicitly rejects atomic directory swap as non-portable.
- **`reconciliation.py`**: on the next run, classifies a crashed journal as LIVE / ROLLBACK_OK / ROLLFORWARD_OK / PARTIAL / DRIFT / MALFORMED.
- **`locks.py`**: a per-user lock and a per-repo lock; the holder PID is recorded.
- **`uninstall.py`**: outcomes clean / no-op / lock-timeout / drift / malformed-state / partial-cleanup. It "never overwrites or deletes a file whose on-disk content drifted from its recorded hash."
- **`handlers/permission.py`**: the ownership key for a merged JSON entry is `(kind, target_path, merge_key)`. Same content joins owners; different content fails closed with `UserLevelOutputConflict`.
- **`dispatch.py`**: handlers only stage into a `DispatchContext` (transaction plus state payloads); the composer commits. This is the same pure-adapter / single-executor split you propose.
- **`update_policy: locked|auto|prompt`**; `auto` is rejected for active (code-bearing) entries.

**(d) Pitfalls.**
- #61 (open): the composer leaves orphaned files when a skill file is removed upstream. Directory-level ownership needs per-file records.
- #70 (open): the settings merge is union-only, so an upstream permission revocation never reaches consumers. It was patched with a hardcoded `WITHDRAWN` list in `merge_settings.py`.
- #32: an interrupted in-place write truncated `~/.claude/settings.json` and lost user keys. The fix was rename-publish, a lock and capped backups.
- #36: two JSON serializers (PowerShell and Python) reformatted the same file back and forth.
- `residue.py` exists only because the tool wrote pinned rows into user config that later went stale.
- No Windows symlink support for Codex.
- Hard-coded `.claude/...` destinations in manifests make packs non-portable.

---

## 3. doubleagent (seanthegeek) — Apache-2.0, 4 stars

**(a) What it does.** A Go forensic tool for incident responders, not an installer. `collect` / `detect` / `timeline` / `fleet` gather and parse on-disk agent state for about 55 agents.

**(b) Architecture.** Fully data-driven: one embedded table file, `internal/catalog/catalog.txt`, with sections `CATALOG` (`agent|glob`), `PROJECT_CATALOG`, `EXCLUDES`, `SECRET_GLOBS`, `DOCKER_VOLUMES`, `RELOCATION_VARS` (`agent|VAR|home-relative path it replaces`) and `STARTUP_FILES`. Adding an agent means adding table lines, fixtures and a `research/<agent>.md` citing the upstream source file and line. A test (`TestEveryCatalogLineLeavesItsEvidence`) fails any line without a fixture.

**(c) Worth lifting.**
- **The `RELOCATION_VARS` table**, the env vars that move a harness's home:

| Agent | Variable → replaces |
|---|---|
| Claude Code | `CLAUDE_CONFIG_DIR` → `.claude` |
| Codex | `CODEX_HOME` → `.codex` |
| Copilot CLI | `COPILOT_HOME` → `.copilot` |
| Cursor | `CURSOR_CONFIG_DIR` → `.cursor` |
| Gemini CLI | `GEMINI_CLI_HOME` → `.` (home itself) |
| OpenCode | `OPENCODE_CONFIG_DIR` → `.config/opencode` |
| Factory | `FACTORY_HOME_OVERRIDE` → `.` |
| Qwen | `QWEN_HOME` → `.qwen` |
| Kiro | `KIRO_HOME` → `.` |
| Crush | `CRUSH_GLOBAL_CONFIG` → `.config/crush`; `CRUSH_SKILLS_DIR` |
| Goose | `GOOSE_PATH_ROOT` → `.config/goose` |
| Pi | `PI_CODING_AGENT_DIR` → `.pi/agent` |
| Hermes | `HERMES_HOME` → `.hermes` |
| Cline | `CLINE_DIR`, `CLINE_MCP_SETTINGS_PATH` |

- **The `SECRET_GLOBS` idea**: settings files that can hold MCP `env` or `headers` values count as credential files. Your executor's backups and state should treat them that way.
- **The evidence discipline**: every path line is backed by an upstream source citation and a fixture.

**(d) Pitfalls.** Not applicable to installing. It has no skills / agents / commands / MCP path model; it covers transcripts and settings only.

---

## 4. ai-memory (akitaonrails) — MIT, 16.3k stars

**(a) What it does.** A Rust memory server plus CLI. Its `setup` / `install-mcp` / `install-hooks` / `install-skills` / `uninstall` commands wire one product (an MCP endpoint, lifecycle hooks, a few skills) into 40+ harnesses. It is a single-package installer, not a general one.

**(b) Architecture.** One `McpClient` enum and large `match` statements; no adapter trait.
- `crates/ai-memory-cli/src/commands/install_mcp.rs` (6.9k lines): `mcp_config_path_with(client, env)` resolves the user-scope file and takes an injectable env reader for the relocation vars. `json_mcp_location(client)` classifies the key location into 6 variants. `build_mcp_entry` matches per client for the entry shape. Codex and Grok TOML go through `toml_edit`; Zed JSONC through a CST edit.
- `install_hooks.rs` (21k lines) does the same for hooks; `hooks/<agent>/` holds vendored scripts.
- `apply_shared.rs`: every write goes through `apply_atomic`: resolve the symlink chain without replacing the link, run the mutator, no-op if unchanged, timestamped `.bak-<ts>` backup, tempfile + fsync + rename + parent-dir fsync.
- The default mode prints the snippet; `--apply` writes.

**(c) Data worth lifting** (user scope; `--config-file` for project).

MCP key location per client:

| Key | Clients |
|---|---|
| root `mcpServers` | Claude Code, Claude Desktop, Cursor, Gemini CLI, Qwen, Qoder, OMP, Antigravity CLI, Devin, Kimi, Kiro CLI, Command Code, IBM Bob, Copilot CLI, Droid, Cline, FreeBuff |
| root `mcp` | OpenCode v1 |
| `mcp.servers` | OpenCode v2, OpenClaw, Zero, ZCode |
| root `servers` | VS Code Copilot ("writing the wrong key produces a silent no-op") |
| `context_servers` | Zed |
| TOML tables | Codex, Grok |

Remote (HTTP) entry shapes:

| Client | Entry |
|---|---|
| Claude Code | `{type:"http", url, headers}` |
| Cursor, Zed | `{url, headers}` |
| Gemini CLI, Qwen | `{httpUrl, timeout, headers}` (`url` means legacy SSE) |
| Antigravity | `{serverUrl, ...}` |
| Devin | `{url, transport:"http"}` |
| Command Code | `{transport:"http", enabled:true, url}` |
| OMP | `{type:"http", url, enabled:true}` |
| IBM Bob | `{type:"streamable-http", url, protocolNegotiation:"legacy"}` |
| Copilot CLI | `{type:"http", url, headers, tools:["*"]}` |
| VS Code | `{type:"http", url, headers}` |
| Claude Desktop | stdio shim `npx -y mcp-remote <url>` (no HTTP in its JSON) |
| Kiro | HTTPS required except loopback |

User-scope MCP file paths:

| Client | Path |
|---|---|
| Gemini CLI | `$GEMINI_CLI_HOME/.gemini/settings.json` |
| Claude Code | `~/.claude.json` (honours `CLAUDE_CONFIG_DIR`) |
| Codex | `$CODEX_HOME/config.toml` |
| Copilot CLI | `$COPILOT_HOME/mcp-config.json` |
| Droid | `~/.factory/mcp.json` |
| Cursor | `~/.cursor/mcp.json` |
| OpenCode | `~/.config/opencode/opencode.json` |
| Claude Desktop | per-OS, including the Windows MSIX path |

Skills roots (`install_skills.rs` tests): `.claude/skills`, `.agents/skills`, `.github/skills` / `~/.copilot/skills`, `.devin/skills` / `~/.config/devin/skills`, `.grok/skills`, `.hermes/skills`, `~/.gemini/config/skills` plus `~/.gemini/antigravity-cli/skills`.

**(d) Pitfalls.**
- **Ownership by inference, no manifest.** `uninstall` "detects ai-memory's wiring" by entry name plus URL plus "generated shape" (`opencode_mcp_entry_is_owned`, `inferred_owned_opencode_entry`). That is workable for one known package and unworkable for arbitrary packages.
- **Double install.** The same product arrives via marketplace plugin and via settings-file wiring; `agent_plugins.rs` and `doctor` exist to detect it. Your engine needs a rule for plugin-format versus loose-file installs of one package.
- **Dialect detection.** OpenCode v1 versus v2 must be detected (`opencode_dialect.rs`) and existing entries migrated between `mcp` and `mcp.servers`.
- **Strict-JSON refusal.** `mutate_json` refuses to rewrite files with comments; users must pass `--config-file`.
- **Adapter size.** The 21k-line `install_hooks.rs` shows what a match-per-client design without declarative tables grows into.

---

## 5. Letta agents API — tangential

It is a REST resource for server-hosted stateful agents (`/v1/agents`: list, create ...). Fields include `blocks` (memory), `tools`, `tool_rules`, `model_settings`; MCP shows up only as tools of type `external_mcp`. It has no file-based harness config and no install targets, so there is nothing to reuse for the installer.

One loosely relevant idea: tools attached by reference with separate `tool_rules`, a clean IR split between capability and policy. Letta Code, the CLI, is a rulesync target (`.letta/agents`, `.commands/`, `~/.letta/skills`). Licence not checked (docs page).

---

## Consolidated path table (rulesync v43.13.0)

- Definitions: `src/constants/<tool>-paths.ts` and `getSettablePaths` in `src/features/{mcp,skills,subagents,commands}/<tool>-*.ts`.
- **P** is relative to the project root, **G** to `$HOME`. "same" means the identical relative path under `$HOME`. A dash means unsupported in that scope, per the generated table in `docs/reference/supported-tools.md`.

| Tool (target) | MCP file, key, entry shape | Skills dir | Subagents dir | Commands dir |
|---|---|---|---|---|
| Claude Code (`claudecode`) | P `.mcp.json`; G `.claude.json`; `mcpServers`; canonical (`type` stdio/http/sse/ws, `command`, `args`, `env`, `url`, `headers`) | P/G `.claude/skills/<n>/SKILL.md` | P/G `.claude/agents/*.md` (nested allowed) | P/G `.claude/commands/*.md` |
| Codex CLI (`codexcli`) | P/G `.codex/config.toml`; `[mcp_servers.<n>]`; `command`, `args`, `env`, `env_vars`, `url`, `http_headers`, `enabled_tools`, `disabled_tools`, `tool_timeout_sec`, `startup_timeout_sec`, `[...tools.<t>]` | P/G `.agents/skills` (plus `agents/openai.yaml` sidecar) | P/G `.codex/agents/<n>.toml` | G only `.codex/prompts/*.md` |
| Cursor (`cursor`) | P/G `.cursor/mcp.json`; `mcpServers`; env refs `${env:VAR}` | P/G `.cursor/skills` | P/G `.cursor/agents` | P/G `.cursor/commands` |
| OpenCode (`opencode` v2, `opencodev1`) | P `opencode.json[c]` at root; G `.config/opencode/opencode.json[c]`. v1: flat `mcp.<n>`; v2: `mcp.servers.<n>`. Entry `{type: local\|remote, command: [..], environment, enabled, url, headers}`; env refs `{env:VAR}` | P `.opencode/skills`; G `.config/opencode/skills` (reads `skill/` too) | P `.opencode/agents`; G `.config/opencode/agents` | P `.opencode/commands`; G `.config/opencode/commands` |
| Antigravity CLI/IDE (Gemini lineage) | P `.agents/mcp_config.json`; G `.gemini/config/mcp_config.json`; `mcpServers`; `serverUrl`, no `type`, `timeoutSeconds` | P `.agents/skills`; G `.gemini/config/skills` (IDE) or `.gemini/antigravity-cli/skills` (CLI) | P `.agents/agents`; G unverified | emitted as skills (workflows retired) |
| Gemini CLI | not a rulesync target; ai-memory: G `~/.gemini/settings.json`, `mcpServers`, `httpUrl` | n/a | n/a | n/a |
| Copilot / VS Code (`copilot`) | P `.vscode/mcp.json`; G —; key `servers` (`inputs` and `sandbox` are siblings) | P `.github/skills`; G `.copilot/skills` | P `.github/agents`; G `.copilot/agents` | P `.github/prompts`; G — |
| Copilot CLI (`copilotcli`) | P `.github/mcp.json`; G `.copilot/mcp-config.json`; `mcpServers`; `type` required (stdio/local/http/sse), `tools: ["*"]` | as Copilot | as Copilot | — |
| Factory Droid (`factorydroid`) | P/G `.factory/mcp.json`; `mcpServers`; canonical | P/G `.factory/skills` | P/G `.factory/droids` | P/G `.factory/commands` |
| Qwen Code | P/G `.qwen/settings.json`; `mcpServers` | `.qwen/skills` | `.qwen/agents` | `.qwen/commands` |
| Kilo | P `kilo.json[c]` at root; G `.config/kilo/kilo.json`; `mcp`; OpenCode shape | `.kilo/skills` | P `.kilo/agents`; G `.config/kilo/agents` | P `.kilo/commands`; G `.config/kilo/commands` |
| Cline | G only `.cline/data/settings/cline_mcp_settings.json`; `mcpServers` | `.cline/skills` | `.cline/agents` | P `.clinerules/workflows`; G `Documents/Cline/Workflows` |
| Roo / Zoo | P `.roo/mcp.json`; G —; `mcpServers` | `.roo/skills` | project-root file (dir `.`), P only | `.roo/commands` |
| Kiro (cli/ide) | P/G `.kiro/settings/mcp.json`; `mcpServers`; `autoApprove`, `disabledTools` | `.kiro/skills` | `.kiro/agents` (`.json` for CLI, `.md` for IDE) | `.kiro/prompts` |
| Amp | P `.amp/settings.json[c]`; G `.config/amp/settings.json`; key `amp.mcpServers` | P `.agents/skills`; G `.config/agents/skills` | — | — |
| Goose | P `.agents/plugins/rulesync/.mcp.json`; G `.config/goose/config.yaml` key `extensions` | P `.goose/skills`; G `.config/goose/skills` | P `.goose/agents`; G `.config/goose/agents` | recipes: P `.goose/recipes`; G `.config/goose/recipes` |
| Crush | P `crush.json` or `.crush.json`; G `.config/crush/crush.json`; key `mcp` | P `.crush/skills`; G `.config/crush/skills` | — | — |
| Zed | P `.zed/settings.json`; G `.config/zed/settings.json`; `context_servers`; no `type`, `enabled` | `.agents/skills` | — | — |
| Devin Desktop (ex-Windsurf) | P `.devin/mcp_config.json`; G `.config/devin/mcp_config.json`; `mcpServers` | P `.devin/skills`; G `.config/devin/skills` | P `.devin/agents`; G `.config/devin/agents` | emitted as skills |
| Junie | `.junie/mcp/mcp.json`; `mcpServers` | `.junie/skills` | `.junie/agents` | `.junie/commands` |
| AugmentCode | `.augment/settings.json`; `mcpServers` | `.augment/skills` | `.augment/agents` | `.augment/commands` |
| Pi / oh-my-pi | P `.pi/mcp.json`, G `.pi/agent/mcp.json`; omp: P `.omp/mcp.json`, G `.omp/agent/mcp.json`; `mcpServers`, `type`, `enabled` | P `.pi/skills` (omp `.omp/skills`); G `.pi/agent/skills` (omp `.omp/agent/skills`) | omp only: `.omp/agents`, G `.omp/agent/agents` | under the same roots |
| Warp | P/G `.warp/.mcp.json`; `mcpServers`; `working_directory` | `.warp/skills` | — | as skills |
| Continue (end of life) | `.continue/mcpServers/mcp.json` | `.continue/skills` | — | `.continue/prompts` |
| Qoder / CodeBuddy / Command Code | P `.mcp.json` (shared with Claude); G `.qoder/settings.json` / `.codebuddy/.mcp.json` / `.commandcode/mcp.json` | `.<tool>/skills` | `.<tool>/agents` | `.<tool>/commands` |
| AGENTS.md fallback (`agentsmd`, simulated) | — | P `.agents/skills` | P `.agents/agents` | P `.agents/commands` |

OpenCode key caveat: the docs say the flat v1 `mcp` map is the default, while the layout comment in `opencode-paths.ts` says the `opencode` target writes the v2 `mcp.servers` envelope. Check `opencode-mcp.ts` before relying on either.

---

## Design recommendations (each tied to evidence)

1. **Keep the ownership manifest; it is the differentiator.** rulesync has none: it deletes hand-written files in swept directories and strands output when a root moves. ai-memory must infer ownership by entry shape. Copy anywhere-agents `state.py`: a per-output record with content hash, a project state file, and a user-scope state file with a refcounted `owners:` list so two projects can co-own one global output.
2. **Give ops a third kind: a key (or named entry) inside a shared config file.** rulesync arrived at `kind: file|directory|key` (`generate-plan.ts` v2) plus `SHARED_CONFIG_OWNERSHIP`. Own at the entry level (`mcpServers.<name>`), not the whole key, because rulesync's whole-`mcpServers` replacement drops user-added servers (#2401, #2414). Use anywhere-agents' `(kind, target_path, merge_key)` uniqueness key, failing closed on same key with different content.
3. **Make harness adapters declarative tables first, code second.** rulesync's `OpencodeLayout` and ai-memory's 6-variant `JsonMcpLocation` show that most harnesses differ only in {path per scope, key path, field renames, env-ref syntax, format}. ai-memory's 21k-line `install_hooks.rs` and rulesync's 60 classes per feature are the cost of not doing this. Reserve code hooks for the real outliers: Codex TOML, Goose extensions, Zed, DSH.
4. **Carry per-(harness, node type, scope) capability flags in the adapter and surface "unsupported" as an explicit skip op.** rulesync's factory `meta` drives its generated support table and its skip-with-warning behaviour. Model rulesync's "simulated" fallback (`.agents/*` plus instruction text) and "command emitted as skill" as named degradations, and detect command/skill name collisions at plan time.
5. **Resolve scope roots through an injectable env reader that honours relocation vars.** Lift doubleagent's `RELOCATION_VARS` table and ai-memory's `mcp_config_path_with(client, env)`. Record the resolved absolute root in the manifest so uninstall still works after the variable changes.
6. **Use a journaled, hash-checked executor with drift refusal.** Copy anywhere-agents' transaction → journal → reconcile design and uninstall outcome enum, and ai-memory's `apply_atomic` (no-op if unchanged, backup, tempfile + fsync + rename, resolve symlinks without replacing the link). Never overwrite or delete an owned output whose hash drifted. Handle rulesync #3945 (symlink write-through) and anywhere-agents #32 (truncation) explicitly.
7. **Format-preserving edits only; refuse rather than reformat.** Use CST/`toml_edit`-style edits as ai-memory and rulesync's `jsonc-object-edit.ts` do, with one serializer per format (anywhere-agents #36), and refuse unparseable or JSON5-only files. Support removal as well as merge so that revocations propagate (anywhere-agents #70) and removed files inside a skill directory are cleaned (#61); this needs per-file records, not per-directory ones.
8. **Version harness dialects and treat shared roots as first-class in the IR.** OpenCode v1/v2, Kiro CLI/IDE, Windsurf→Devin and Roo→Zoo all forced target splits in rulesync, and ai-memory needs runtime dialect detection. `.agents/skills` and project `.mcp.json` are written for many harnesses at once, so the planner must dedupe ops across adapters before execution (rulesync's `OrphanSweepPlan` claims) and refcount them in the manifest. Keep canonical nodes as shared core plus namespaced per-harness blocks, with rulesync's three-way collision rule (merge / canonical wins / refuse).
