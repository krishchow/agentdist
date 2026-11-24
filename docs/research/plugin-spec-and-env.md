<!-- Research notes gathered 2026-11-24 by a research agent. Items marked NOT STATED were not found in the documentation. -->

All answers are quoted from the official docs fetched today (2026-11-24). Three things will change what you generate:

- **The spec has no commands, agents or marketplace.** Agent Plugins 1.0.0 covers only `skills/` and `mcp.json`; `plugin.json` is a closed schema with no component path fields.
- **A root `plugin.json` is not additive.** In Copilot CLI, VS Code and Codex it switches the plugin to Agent Plugins semantics, so legacy `agents/`, `commands/`, hooks and `.mcp.json` stop loading there.
- **`${PLUGIN_ROOT}` is not expanded by Cursor.** Codex, Copilot CLI and Qwen expand it; Cursor expands only `${CURSOR_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_ROOT}`.

## A. Agent Plugins spec

Sources: https://agent-plugins.org/specification (full text via https://agent-plugins.org/llms.txt), https://agent-plugins.org/schemas/1.0.0/plugin.schema.json, https://agent-plugins.org/schemas/1.0.0/mcp.schema.json. Version 1.0.0, "Status: Published".

### A1. Root `plugin.json`

The schema is closed: "the only permitted top-level fields are `$schema`, `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, and `extensions`." (§5.2)

| Field | Required | Type / constraint |
|---|---|---|
| `$schema` | Yes | const `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` |
| `name` | Yes | string, 1–64 chars, pattern `^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$` |
| `version` | No | string (SemVer recommended, not enforced) |
| `description` | No | string |
| `author` | No | object, only `name`, `email`, `url` (all optional strings); `additionalProperties: false` |
| `homepage`, `repository`, `license` | No | string |
| `keywords` | No | string[] |
| `extensions` | No | object keyed by reverse-domain namespace; each value must be an object |

Failure rules (§5.2):
- Unknown top-level field: "Clients MUST report and ignore each unknown field and MUST continue loading".
- Non-object `extensions`: reported and ignored.
- Any other schema violation is fatal: "the client MUST reject the plugin".

Component discovery (§6.1, §7):
- "`plugin.json` cannot override these locations or contain inline component configuration."
- Skills: fixed `skills/`, "Each immediate child directory containing a path named exactly `SKILL.md`"; no recursion.
- MCP: fixed root `mcp.json`.
- "Agent Plugins v1 defines exactly two component types: **skills** and **MCP servers**."
- Design note: "commands, hooks, agents, rules, and LSP servers — remain too client-specific … and are outside the v1 format".

Extensions mechanism (§8):
- Manifest data goes under `extensions["<reverse.domain>"]`; client files go under a top-level directory named exactly that namespace (e.g. `com.example.client/hooks/hooks.json`).
- "A client MUST ignore manifest entries for namespaces it does not implement without validating the contents of their values."

Per-client namespaces and directories for commands/agents:
- **Copilot CLI and VS Code** use `com.github.copilot/`: `agents/`, `commands/`, `rules/`, `hooks/hooks.json`, `lsp.json`. "These locations apply only to Agent Plugins 1.0 plugins." (https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
- **Codex** uses `extensions.com.openai` in the manifest. A top-level `com.openai/` directory is NOT STATED.
- **Cursor**: commands/agents/rules/hooks exist only in the `.cursor-plugin/plugin.json` format (defaults `rules/`, `agents/`, `commands/`, `hooks/hooks.json`, `skills/`, `mcp.json`). A `com.cursor` namespace is NOT STATED. (https://cursor.com/docs/reference/plugins.md)
- **Qwen**: "Commands, agents, and hooks | No; these directories are ignored"; "`extensions.*` client namespaces | No". (https://raw.githubusercontent.com/QwenLM/qwen-code/main/docs/users/extension/agent-plugins.md)

Codex `extensions.com.openai` fields (https://developers.openai.com/plugins/build/plugins.md and https://developers.openai.com/plugins/deploy/submission.md):
- `apps`: string path to `.app.json` ("only for registered MCP server mappings").
- `hooks`: "a single path, an array of paths, an inline hooks object, or an array of inline hooks objects"; the default when absent is `hooks/hooks.json`.
- `onboardingSkill`: optional string, "Relative path to a packaged skill's SKILL.md … It must refer to an included skill."
- `id`: optional.
- `interface`: optional for Agent Plugins, required in the `.codex-plugin` format. Its fields:
  - `displayName` (≤30), `shortDescription` (≤30), `longDescription` (≤4000), `developerName` (≤80), `category`
  - `capabilities` (string[])
  - `websiteURL`, `supportURL`, `privacyPolicyURL`, `termsOfServiceURL`
  - `defaultPrompt` (string or string[], max 3, ≤128 chars each)
  - `brandColor`, `brandColorDark` (#RRGGBB)
  - `composerIcon`, `composerIconDark`, `logo`, `logoDark` (`./`-relative paths)
- `review`: `test_cases.positive[]`, `test_cases.negative[]`, `demo_recording_url`, `commerce`, `commerce_description`.
- `publication`: `countries`, `release_notes`, `translations`.
- All paths are "relative to the plugin root and start them with `./`".
- A `skills` or `mcpServers` declaration there "can't replace, disable, or add to those components".

Complete example (the Codex doc's example, valid against the schema):
```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "my-plugin",
  "version": "0.1.0",
  "description": "Reusable skills and MCP servers",
  "author": { "name": "Your team", "email": "team@example.com", "url": "https://example.com" },
  "homepage": "https://example.com/plugins/my-plugin",
  "repository": "https://github.com/example/my-plugin",
  "license": "MIT",
  "keywords": ["research", "crm"],
  "extensions": {
    "com.openai": {
      "hooks": "./hooks/hooks.json",
      "onboardingSkill": "./skills/setup/SKILL.md",
      "interface": {
        "displayName": "My Plugin",
        "shortDescription": "Reusable skills and MCP servers",
        "longDescription": "Distribute skills and MCP servers together.",
        "developerName": "Your team",
        "category": "Productivity",
        "capabilities": ["Read", "Write"],
        "websiteURL": "https://example.com",
        "privacyPolicyURL": "https://example.com/privacy",
        "termsOfServiceURL": "https://example.com/terms",
        "defaultPrompt": ["Use My Plugin to summarize new CRM notes."],
        "brandColor": "#10A37F",
        "composerIcon": "./assets/icon.png",
        "logo": "./assets/logo.png"
      }
    }
  }
}
```

### A2. Root `mcp.json`

- **Wrapper**: required, not a bare map. "`mcp.json` MUST be a JSON object containing the required `$schema` and `mcpServers` fields, with no other top-level fields." (§7.2.1)
- **Version field**: `$schema` = `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`. It "MUST match the version declared by `plugin.json`"; a mismatch disables MCP only. There is no separate version field.
- **`type` is required** on every entry; variants are closed (`additionalProperties: false`): "An unknown field, an unknown `type` value, or a field belonging to another variant makes that server entry invalid."

stdio entry:

| Field | Required | Notes |
|---|---|---|
| `type` | Yes | const `"stdio"` |
| `command` | Yes | "a single executable token… either a bare executable name or a plugin-relative path beginning with `./`"; "Clients MUST NOT perform placeholder expansion in `command`" |
| `args` | No | string[] |
| `env` | No | object of strings; keys `PLUGIN_ROOT` / `PLUGIN_DATA` are forbidden (entry becomes invalid) |
| `cwd` | No | pattern `^(?:\./|\$\{PLUGIN_ROOT\}(?:/|$)|\$\{PLUGIN_DATA\}(?:/|$))`; default "the plugin root" |

Remote entries: `type` `"streamable-http"` or `"sse"`, `url` (required), `headers` (optional, literal; "MUST NOT perform placeholder or environment-variable expansion in `url`, header names, or header values").

Environment and placeholders (§9):
- Only `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` exist, expanded in "every string element of `args`, every string value in `env`, and the `cwd` string".
- "Unrecognized placeholder-like text MUST remain literal. Clients MUST NOT perform any other placeholder or environment-variable expansion." So there is no host-env reference syntax (`${VAR}`) in the portable format.
- "Plugins MUST NOT embed credentials or other secrets in `env`."
- Base environment: "The client chooses the base subprocess environment and MAY inherit, omit, or sanitize ambient variables"; plugins "MUST NOT depend on a base-environment variable".
- Clients set `PLUGIN_ROOT` and `PLUGIN_DATA` in the subprocess env.

What each harness expands:

| Harness | Expands | Source |
|---|---|---|
| Codex | "`${PLUGIN_ROOT}` is a built-in placeholder" in `mcp.json` args/cwd; hook commands get env `PLUGIN_ROOT`, `PLUGIN_DATA`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` | https://developers.openai.com/plugins/deploy/desktop-only, plugins.md |
| Copilot CLI | "expands `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` (plus the `CLAUDE_PLUGIN_DATA` and `COPILOT_PLUGIN_DATA` aliases) in the server's `args`, `env` values, and `cwd`" | cli-plugin-reference |
| Cursor | "expands `${CURSOR_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_ROOT}` … in `command`, `args`, `env` values, and `cwd`. It does not expand the standard's `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` variables" | cursor plugins.md |
| Qwen | "expands `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` once in `args`, environment values, and `cwd`" | qwen agent-plugins.md |
| VS Code | Agent Plugins 1.0 token `${PLUGIN_ROOT}`; "preserves these placeholders for the plugin runtime to expand" | https://github.com/microsoft/vscode-docs/blob/main/docs/agents/reference/agent-plugin-reference.md |
| Factory Droid | `${DROID_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_ROOT}` (braced and bare) in MCP `command`, `args`, `url`; `env`/`headers` resolved at connect. `${PLUGIN_ROOT}` is NOT STATED | https://docs.factory.ai/harness/plugins.md |

My inference, not a doc statement: Cursor's own example uses `"cwd": "${CURSOR_PLUGIN_ROOT}"`, which fails the spec's `cwd` regex and would make that entry invalid in a strict client. The only form with no placeholder is `"command": "./bin/server"` with `cwd` omitted. The spec defaults `cwd` to the plugin root; Cursor's default `cwd` is NOT STATED.

Spec example:
```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "local-validator": {
      "type": "stdio",
      "command": "./bin/validator",
      "args": ["--data", "${PLUGIN_DATA}/validator"],
      "env": { "CONFIG": "${PLUGIN_ROOT}/config.json" },
      "cwd": "${PLUGIN_ROOT}"
    }
  }
}
```

### A3. Marketplace

**In the spec: none.** It "does not prescribe: installation sources, registries, or marketplaces". Qwen agrees: "Agent Plugins v1 is a package format, not a marketplace integration."

**Codex** (https://developers.openai.com/plugins/build/plugins.md):
- Locations: `$REPO_ROOT/.agents/plugins/marketplace.json`, `~/.agents/plugins/marketplace.json`, and "a legacy-compatible marketplace at `$REPO_ROOT/.claude-plugin/marketplace.json`".
- Top level: `name`, `interface.displayName`, `plugins[]`.
- Each entry: `name`, `source`, `policy`, `category`. "Always include `policy.installation`, `policy.authentication`, and `category` on each plugin entry."
- `source` forms:
  - `{"source":"local","path":"./plugins/x"}`, or a plain string path. The path is "relative to the marketplace root, start it with `./`", not relative to `.agents/plugins/`.
  - `{"source":"url", …}` for a plugin at the repo root (the doc names it but shows no example or field list).
  - `{"source":"git-subdir","url":…,"path":"./…","ref":…}`; "Git-backed entries may use `ref` or `sha`".
  - `{"source":"npm","package":…,"version"?,"registry"?}`.
- `policy.installation`: `AVAILABLE` | `INSTALLED_BY_DEFAULT` | `NOT_AVAILABLE`.
- `policy.authentication`: the example uses `ON_INSTALL`, and it decides "whether auth happens on install or first use". The first-use enum literal is NOT STATED.
- Enable key in `.codex/config.toml`: `[plugins."my-plugin@local-repo"] enabled = true`.

```json
{
  "name": "local-example-plugins",
  "interface": { "displayName": "Local Example Plugins" },
  "plugins": [
    {
      "name": "my-plugin",
      "source": { "source": "local", "path": "./plugins/my-plugin" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Productivity"
    }
  ]
}
```

Other harnesses' marketplace files, for reference:
- Copilot: `marketplace.json`, `.plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.claude-plugin/marketplace.json` ("checked in this order"); fields `name`, `owner{name,email?}`, `plugins[]`, `metadata?`.
- Cursor: `.cursor-plugin/marketplace.json`.
- Factory: `.factory-plugin/marketplace.json`, "falls back to `.claude-plugin/marketplace.json`".

### A4. Precedence when root `plugin.json`, `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` coexist

| Harness | Rule | Consequence |
|---|---|---|
| Copilot CLI | "A root `plugin.json` that targets Agent Plugins takes precedence over `.plugin/plugin.json` and `.claude-plugin/plugin.json`". Without the exact `$schema` it is treated as legacy, order `.plugin/plugin.json`, `plugin.json`, `.github/plugin/plugin.json`, `.claude-plugin/plugin.json`. An unsupported Agent Plugins version is rejected. | With the root manifest, only `skills/`, `mcp.json` and `com.github.copilot/*` load. Legacy `agents/`, `commands`, `hooks.json`, `.mcp.json` are "Legacy plugins" locations only. |
| VS Code | "A root `plugin.json` that declares the canonical Agent Plugins `$schema` uses Agent Plugins semantics." | Same as Copilot CLI. |
| Codex | "When `extensions.com.openai` is an object, it replaces the entire `.codex-plugin/plugin.json` overlay…; the two aren't merged. If the inline object is absent, the compatibility overlay supplies those settings. Root identity and portable components remain canonical in either case." | Overlay `skills`/`mcpServers` "apply only to packages without a recognized portable root manifest". Ordering against `.claude-plugin/plugin.json` when all three exist is NOT STATED ("OpenAI also accepts legacy and Claude-compatible manifests"). |
| Cursor | "Cursor loads plugins in two formats, identified by their manifest location": root `plugin.json` or `.cursor-plugin/plugin.json`. | Precedence when both exist is NOT STATED. Reading `.claude-plugin/plugin.json` is NOT STATED. |
| Qwen | Natively loads a root `plugin.json` that targets the canonical v1 schema; separately converts Claude plugins. | Which wins when both exist is NOT STATED. |
| Factory Droid | "A `.factory-plugin/` directory identifies the native layout; `.claude-plugin/`, `agents/`, or `.mcp.json` identifies a Claude Code layout for translation." | Root `plugin.json` detection is NOT STATED. "If `mcp.json` declares an Agent Plugins `$schema` and the plugin also ships `.mcp.json`, Droid loads the plugin's MCP servers from `.mcp.json`." |
| Claude Code | "Save the manifest at `.claude-plugin/plugin.json`"; "The manifest is optional." (https://code.claude.com/docs/en/plugins-reference) | Root `plugin.json` is not mentioned on the pages checked; treat as NOT STATED. |

Verdict: shipping all three is documented as safe for identity (no doc describes a conflict error). It is not behaviour-neutral: Copilot CLI, VS Code and Codex switch to portable-only component loading once the root manifest carries the Agent Plugins `$schema`. For Copilot you would need `com.github.copilot/agents/` and `com.github.copilot/commands/` to keep agents and commands.

Copilot also recognises a `…/schemas/1.1.0/plugin.schema.json`. I did not check whether agent-plugins.org publishes it; its spec and schemas pages reference only 1.0.0.

### A5. Codex MCP tool naming and install-directory variable

- **Tool naming**: the hooks docs give the canonical name as `mcp__server__tool` (examples `mcp__filesystem__read_file`, `mcp__fs__read`) at https://developers.openai.com/codex/hooks. Any plugin-name prefix for plugin-bundled servers is NOT STATED. The policy key is `[plugins."my-plugin".mcp_servers.docs]`, with `enabled_tools = ["search"]` using bare tool names.
- **Skill identity**: `plugin-name:skill-name`, combined ≤64 chars (submission error `skill_identity_too_long`).
- **Install directory in skill text**: NOT STATED. `PLUGIN_ROOT` / `PLUGIN_DATA` are documented only as env vars for hook commands and as `${PLUGIN_ROOT}` in `mcp.json`. The install path is `~/.codex/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/$VERSION/` (`$VERSION` = `local` for local plugins). The only guidance for skills is "Call bundled executables with package-relative paths".

## B. Copilot CLI MCP config

Sources: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers, https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference (MCP section), https://github.com/microsoft/vscode-docs/blob/main/docs/agents/reference/mcp-configuration.md

1. **`tools`**: the CLI reference field table marks it required: "`tools` | Yes | Tools to enable: `[\"*\"]` for all, or a list of specific tool names." The how-to's project `.mcp.json` examples nevertheless omit it. The default when omitted from the file is NOT STATED; only the form and flag defaults are documented ("The default is `*`"; `--tools`: "`*` for all tools (default)… or `\"\"` for none"). Emit `"tools": ["*"]`.
2. **`type`**: both values are accepted and it is optional for local servers: "`type` | No | `\"local\"` or `\"stdio\"`. Default: `\"local\"`." Transport table: "`local` / `stdio`". For remote servers `type` is required (`"http"` or `"sse"`; `"streamable-http"` is an alias). The VS Code portable table uses `stdio`. Local required fields are `command` and `args`.
3. **Env**:
   - Inheritance: "The `PATH` variable and a small set of platform-specific environment variables are automatically inherited from your environment. Other required environment variables must be configured here." The exact list is NOT STATED.
   - Reference syntax: "`env` | No | Environment variables. Supports `$VAR`, `${VAR}`, and `${VAR:-default}` expansion." VS Code adds: "Use the braced `${NAME}` form for compatibility across the Copilot runtime and the VS Code MCP client, which treats bare `$NAME` as literal text." and "Stdio servers can use references in `command`, `args`, and `env` values. HTTP servers can use them in header values." Bare name is NOT STATED.
   - Unset variable with no default: NOT STATED.

File shape: `~/.copilot/mcp-config.json` uses `mcpServers`; project `.mcp.json` / `.github/mcp.json` accept `mcpServers` or the bare top-level map. `.vscode/mcp.json` (`servers` key) is not read.

## C. Gemini CLI and Qwen Code

**Gemini** (https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md):
- Sanitisation: "By default, the CLI redacts sensitive environment variables from the base environment (inherited from the host process)… Core project keys: `GEMINI_API_KEY`, `GOOGLE_API_KEY`, etc. Variables matching sensitive patterns: `*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `*KEY*`, `*AUTH*`, `*CREDENTIAL*`. Certificates and private key patterns."
- Override: "Explicitly defined variables (including those from extensions) are trusted and are **not** subjected to the automatic redaction process."
- Syntax: "`$VARIABLE_NAME` or `${VARIABLE_NAME}` (supported on all platforms)"; "`%VARIABLE_NAME%` (supported only when running on Windows)".
- Unset: "If a variable is not defined in the current environment, it resolves to an empty string."

**Qwen** (https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/mcp.md):
- Sanitisation: NOT STATED (no redaction section in that page).
- Syntax: "`env` | object | Environment variables for the server process. Values can reference environment variables using `$VAR_NAME` or `${VAR_NAME}` syntax".
- Unset: NOT STATED for MCP `env`.

## D. Claude Code

- **stdio env inheritance**: NOT STATED as an explicit sentence in https://code.claude.com/docs/en/mcp. It is implied by https://code.claude.com/docs/en/env-vars: `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` — "Set to `1` to strip credentials from the environments of the subprocesses Claude Code starts, such as Bash commands, hooks, and stdio MCP servers", so by default they are not stripped. Claude Code additionally sets `CLAUDE_PROJECT_DIR`, `CLAUDECODE=1` and `CLAUDE_CODE_SESSION_ID` in stdio server environments.
- **Unset `${VAR}` with no default**: "the config still loads: Claude Code reports a missing-variable warning for that server in `claude mcp list` output and uses the unexpanded `${VAR}` text as-is." Syntax is `${VAR}` and `${VAR:-default}`. An empty-string variable counts as set. In remote `url`/`headers`, certain credential variables "read as empty".
- **`CLAUDE_CONFIG_DIR` and `~/.claude.json`**: yes. "If you set `CLAUDE_CONFIG_DIR`, every `~/.claude` path on this page lives under that directory instead. The same applies to `.claude.json`, which otherwise sits at `~/.claude.json`." (https://code.claude.com/docs/en/claude-directory). env-vars says: "Override the configuration directory (default: `~/.claude`). All settings, session history, and plugins are stored under this path… Ignored in project and local settings".

## E. Tool-name table

| Claude Code | Gemini CLI | Qwen Code | Factory Droid | Copilot alias |
|---|---|---|---|---|
| Read | `read_file` | `read_file` | `Read` | `read` (also accepts `Read`, `NotebookRead`) |
| Write | `write_file` | `write_file` | `Create` | `edit` (accepts `Write`) |
| Edit | `replace` | `edit` | `Edit` (plus `ApplyPatch`) | `edit` (accepts `Edit`, `MultiEdit`, `NotebookEdit`) |
| Bash | `run_shell_command` | `run_shell_command` | `Execute` | `execute` (accepts `shell`, `Bash`, `powershell`) |
| Glob | `glob` | `glob` | `Glob` | `search` (accepts `Glob`) |
| Grep | `grep_search` (legacy alias `search_file_content`) | `grep_search` | `Grep` | `search` (accepts `Grep`) |
| WebFetch | `web_fetch` | `web_fetch` | `FetchUrl` | `web` (accepts `WebFetch`) |
| WebSearch | `google_web_search` | `web_search` (only registers when the provider supports it) | `WebSearch` | `web` (accepts `WebSearch`) |
| Task | NOT STATED ("subagents **cannot** call other subagents") | `agent` | `Task` — "not available to" subagents | `agent` (accepts `custom-agent`, `Task`) |
| TodoWrite | `write_todos` | `todo_write` | `TodoWrite` — "always included… You do not list them" | `todo` (accepts `TodoWrite`) |

Also available: `list_directory` in Gemini and Qwen, `read_many_files` in Gemini, `LS` in Factory.

Harness notes:
- **Gemini** (https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/tools.md and docs/core/subagents.md): `tools` is an array; wildcards `*`, `mcp_*`, `mcp_<server>_*`; "If omitted, it inherits all tools from the parent session."
- **Qwen** (docs/developers/tools/*.md and docs/users/features/sub-agents.md): supports `tools` and `disallowedTools`; MCP patterns look like `mcp__github`; omitted means inherit.
- **Factory** (https://docs.factory.ai/harness/subagents.md): "Tool IDs are case-sensitive"; "Unknown IDs cause a validation error". `tools` accepts a category string (`read-only`, `edit` = `Create`,`Edit`,`ApplyPatch`; `execute` = `Execute`; `web` = `WebSearch`,`FetchUrl`; `mcp`) or an array. "`tools: all` is rejected". `ExitSpecMode` and `GenerateDroid` are forbidden. Agents live in `droids/<name>.md`. There is no single complete ID table; `Read`, `LS`, `Grep`, `Glob` are taken from the doc's examples.
- **Copilot** (https://docs.github.com/en/copilot/reference/custom-agents-configuration): "All aliases are case insensitive", so Claude names pass through unchanged. Agent `tools` default is `["*"]`. The CLI's built-in tool names are listed as `bash, view, apply_patch, glob, rg, task, ...`.

## Files

Downloaded copies are in `/private/tmp/claude-501/-Users-krish-projects-gsd-core/8c22bd47-632a-4d60-a457-bc6ecc41a62c/scratchpad/dl/`. The most useful:
- `/private/tmp/claude-501/-Users-krish-projects-gsd-core/8c22bd47-632a-4d60-a457-bc6ecc41a62c/scratchpad/dl/agent-plugins-llms.txt`
- `/private/tmp/claude-501/-Users-krish-projects-gsd-core/8c22bd47-632a-4d60-a457-bc6ecc41a62c/scratchpad/dl/plugin.schema.json`
- `/private/tmp/claude-501/-Users-krish-projects-gsd-core/8c22bd47-632a-4d60-a457-bc6ecc41a62c/scratchpad/dl/mcp.schema.json`
- `/private/tmp/claude-501/-Users-krish-projects-gsd-core/8c22bd47-632a-4d60-a457-bc6ecc41a62c/scratchpad/dl/codex-plugins.md`
- `/private/tmp/claude-501/-Users-krish-projects-gsd-core/8c22bd47-632a-4d60-a457-bc6ecc41a62c/scratchpad/dl/codex-submission.md`
- `/private/tmp/claude-501/-Users-krish-projects-gsd-core/8c22bd47-632a-4d60-a457-bc6ecc41a62c/scratchpad/dl/copilot-plugin-ref.md`
- `/private/tmp/claude-501/-Users-krish-projects-gsd-core/8c22bd47-632a-4d60-a457-bc6ecc41a62c/scratchpad/dl/gh-cli-command-reference.md`
- `/private/tmp/claude-501/-Users-krish-projects-gsd-core/8c22bd47-632a-4d60-a457-bc6ecc41a62c/scratchpad/dl/cursor-plugins.md`
