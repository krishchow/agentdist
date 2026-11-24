<!-- Research notes gathered 2026-11-24 by a research agent. Cells marked UNVERIFIED were not confirmed. -->

# Cross-harness install fact table (verified against official docs, fetched 2026-11-24)

Method: raw markdown of each vendor's docs pulled with curl and grepped directly (no summariser model). Cells marked UNVERIFIED were not found in the docs I read; the guess is stated. Raw copies are in `/private/tmp/claude-501/-Users-krish-projects-gsd-core/8c22bd47-632a-4d60-a457-bc6ecc41a62c/scratchpad/dl/`.

Four findings that will likely change your design:
- **OpenCode docs are now "V2"**: MCP servers live under `mcp.servers`, not directly under `mcp`, and the disable flag is `disabled` (not `enabled`). Kilo (an OpenCode fork) still documents the old shape.
- **Windsurf docs redirect to docs.devin.ai**: the product is now "Devin Local / Devin Desktop", sharing a harness with Devin CLI, using `.devin/` and `~/.config/devin/`.
- **VS Code agent mode now runs a "Copilot harness"** that reads the same files as Copilot CLI; `.vscode/mcp.json` (`servers` key) is documented as the deprecated "Local harness" format.
- **Roo Code extension was shut down on May 15** (per its docs home page). Docs are still up; treat as legacy.

A vendor-neutral **Agent Plugins** spec (root `plugin.json` + root `mcp.json` + `skills/`, agent-plugins.org) is now documented by Codex, Cursor, Copilot CLI, Qwen and Factory, and Devin's manifest lookup falls back to a root `plugin.json`. Goose separately documents "Open Plugins" (`plugin.json`, `.plugin/plugin.json`).

---

## 1. Claude Code
1. **MCP**
   - Project: `.mcp.json` at project root, JSON, key `mcpServers`. Needs per-user approval on first use.
   - User: `~/.claude.json`, top-level `mcpServers`.
   - Local scope (private, per-project, the CLI default): `~/.claude.json` under `projects["<abs path>"].mcpServers`.
   - Stdio entry: `{"type":"stdio","command":"…","args":[…],"env":{…},"timeout":<ms>}`. `timeout` is per tool call; values under 1000 are ignored.
   - Expansion: `${VAR}` and `${VAR:-default}`.
   - Env inheritance: UNVERIFIED (docs only say `env`/`--env` adds variables and that `CLAUDE_PROJECT_DIR` is set; my guess is the full parent env is inherited).
   - Source: https://code.claude.com/docs/en/mcp
2. **Skills**
   - Precedence: enterprise (managed dir `.claude/skills/`) > personal `~/.claude/skills/<n>/SKILL.md` > project `.claude/skills/<n>/SKILL.md`. Project dirs are walked from cwd up to the repo root; nested ones load lazily.
   - Plugin skills are namespaced and never collide.
   - Does **not** read `.agents/skills` or `~/.agents/skills` (zero mentions in the skills and sub-agents pages).
   - Frontmatter: nothing required. `name` defaults to the directory name; `description` is "recommended".
   - Optional extras include `allowed-tools`, `disallowed-tools`, `disable-model-invocation`, `user-invocable`, `context: fork`, `agent`, `model`, `effort`, `paths`, `hooks`, `argument-hint`, `arguments`, `shell`, `metadata`, `license`, `compatibility`.
   - Reserved folder name: `synced`.
   - Source: https://code.claude.com/docs/en/skills
3. **Subagents**
   - Project `.claude/agents/` (priority 3), user `~/.claude/agents/` (priority 4); managed and the `--agents` flag rank higher. Scanned recursively.
   - Markdown + YAML frontmatter. Required: `name`, `description`.
   - `tools` is a comma-separated string or YAML list (`Read, Grep, Bash`); MCP tools use their full `mcp__…` name.
   - Other fields: `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `effort`, `isolation`, `color`.
   - Plugin agents ignore `hooks`, `mcpServers`, `permissionMode`.
   - Source: https://code.claude.com/docs/en/sub-agents
4. **Commands**
   - Merged into skills. Legacy `.claude/commands/*.md` still works, with the same frontmatter minus `name` and `paths`; a skill wins a name clash.
   - User path `~/.claude/commands/` is UNVERIFIED (not on the page I read; a guess from older behaviour).
   - Source: https://code.claude.com/docs/en/skills
5. **Naming**
   - MCP tool: `mcp__<server>__<tool>`. From a plugin: `mcp__plugin_<plugin>_<server>__<tool>`. Characters outside `[A-Za-z0-9_-]` become `_`; names over 128 chars are dropped.
   - Skill: `/name`. Plugin skill: `/plugin-name:skill-name`.
   - Source: https://code.claude.com/docs/en/mcp and https://code.claude.com/docs/en/skills
6. **Plugins**
   - Manifest `.claude-plugin/plugin.json` (only `name` required; the manifest itself is optional).
   - Components at the plugin root: `skills/`, `commands/`, `agents/`, `hooks/`, `.mcp.json` (or inline `mcpServers`).
   - Marketplace: `.claude-plugin/marketplace.json` (`name`, `owner`, `plugins[]`).
   - Install scopes: user, project (written to the repo's `.claude/settings.json` `enabledPlugins`, shared with collaborators), local. CLI: `claude plugin install <name>@<marketplace> --scope project`.
   - Source: https://code.claude.com/docs/en/plugins-reference , https://code.claude.com/docs/en/plugin-marketplaces , https://code.claude.com/docs/en/discover-plugins
7. **Home env var**: `CLAUDE_CONFIG_DIR` (default `~/.claude`). Whether it also moves `~/.claude.json` is not stated — test before relying on it. Source: https://code.claude.com/docs/en/env-vars

## 2. OpenAI Codex CLI
(developers.openai.com/codex/* now redirects to learn.chatgpt.com/docs/*)
1. **MCP**
   - User: `~/.codex/config.toml`. Project: `.codex/config.toml` (trusted projects only). TOML, tables `[mcp_servers.<name>]`.
   - Stdio fields: `command` (required), `args`, `env` (table), `env_vars` ("allow and forward": names or `{name, source="local"|"remote"}`), `cwd`.
   - Common fields: `startup_timeout_sec` (default 10), `tool_timeout_sec` (default 60), `enabled`, `required`, `enabled_tools`, `disabled_tools`.
   - Env: `env_vars` is an explicit allow/forward list, which implies the parent env is not fully inherited. The exact default pass-through set is not documented on that page.
   - Source: https://learn.chatgpt.com/docs/extend/mcp
2. **Skills**
   - Repo: `.agents/skills` in every directory from cwd up to the repo root. User: `$HOME/.agents/skills`. Admin: `/etc/codex/skills`. Plus bundled system skills.
   - Reads the shared convention natively. `.codex/skills` is not mentioned anymore.
   - Same-name skills are not merged; both appear.
   - Required: `name`, `description`. Optional sidecar `agents/openai.yaml` (UI metadata, `allow_implicit_invocation`, tool dependencies).
   - Source: https://learn.chatgpt.com/docs/build-skills
3. **Subagents**
   - Project `.codex/agents/*.toml`, user `~/.codex/agents/*.toml`. Standalone TOML files.
   - Required: `name`, `description`, `developer_instructions`. Optional: `model`, `model_reasoning_effort`, and similar.
   - No tool list. Capabilities are reduced via `features.*=false` and `[[skills.config]]`.
   - `mcp_servers` in an agent file does not override the parent; configure MCP in the parent session.
   - Source: https://learn.chatgpt.com/docs/agent-configuration/subagents
4. **Commands**: custom prompts are deprecated. User-only `~/.codex/prompts/*.md` (frontmatter `description`, `argument-hint`), invoked as `/prompts:<name>`. No project scope. Source: https://learn.chatgpt.com/docs/custom-prompts
5. **Naming**
   - Skill: `$skill-name` (or the `/skills` picker).
   - MCP tool name: UNVERIFIED (not in the docs read; guess `mcp__<server>__<tool>`).
   - Source: https://learn.chatgpt.com/docs/build-skills
6. **Plugins**
   - Portable: root `plugin.json` (Agent Plugins) with Codex data under `extensions.com.openai`. Legacy `.codex-plugin/plugin.json` still supported, with `.mcp.json` (`mcpServers`), `.app.json`, `skills/`.
   - Marketplace: `$REPO_ROOT/.agents/plugins/marketplace.json` (repo) or `~/.agents/plugins/marketplace.json` (personal); personal plugins stored under `~/.codex/plugins/`.
   - Per-project enablement in `.codex/config.toml`: `[plugins."<plugin>@<marketplace>"] enabled = …`. Plugin MCP overrides sit under `plugins.<plugin>.mcp_servers.<server>`.
   - Source: https://developers.openai.com/plugins/build/plugins.md , https://learn.chatgpt.com/docs/plugins
7. **Home env var**: `CODEX_HOME` (default `~/.codex`). Source: https://learn.chatgpt.com/docs/config-file/config-advanced

## 3. Cursor
1. **MCP**
   - Project `.cursor/mcp.json`, user `~/.cursor/mcp.json` (editor and CLI). JSON, key `mcpServers`.
   - Stdio fields: `type: "stdio"` (the table marks it required, though the examples omit it), `command`, `args`, `env`, `envFile`.
   - Interpolation: `${env:NAME}`, `${userHome}`, `${workspaceFolder}`, `${workspaceFolderBasename}`, `${pathSeparator}`.
   - Env inheritance: UNVERIFIED (guess: inherits).
   - Source: https://cursor.com/docs/mcp
2. **Skills**
   - Project: `.agents/skills/`, `.cursor/skills/`. User: `~/.agents/skills/`, `~/.cursor/skills/`.
   - Compat: `.claude/skills/`, `.codex/skills/`, `~/.claude/skills/`, `~/.codex/skills/`.
   - Nested project dirs are discovered and path-scoped. Precedence between these dirs is not documented.
   - Required: `name` (must match the folder), `description`. Optional: `paths`, `disable-model-invocation`, `icon`, `color`, `metadata`.
   - Source: https://cursor.com/docs/skills
3. **Subagents**
   - Project `.cursor/agents/` (also `.claude/agents/`, `.grok/agents/`). User `~/.cursor/agents/` (also `~/.claude/agents/`).
   - User-level subagents load in the editor only, **not the CLI**.
   - Project wins on a name clash; `.cursor` beats `.claude`/`.grok`.
   - Markdown + frontmatter, all optional: `name`, `description`, `model`, `readonly`, `is_background`. No tools list.
   - Source: https://cursor.com/docs/subagents
4. **Commands**
   - User `~/.cursor/commands/` (markdown; editor and CLI). Project `.cursor/commands/` is UNVERIFIED (not shown on the pages read; standard prior path).
   - Plugin commands accept `.md`, `.mdc`, `.markdown`, `.txt`. Being steered to skills via `/migrate-to-skills`.
   - Source: https://cursor.com/docs/customize-cursor , https://cursor.com/docs/reference/plugins
5. **Naming**: skill `/skill-name`. MCP tool naming UNVERIFIED (not documented). Source: https://cursor.com/docs/skills
6. **Plugins**
   - Agent Plugin: root `plugin.json` + `mcp.json` + `skills/`.
   - Cursor Plugin: `.cursor-plugin/plugin.json` (adds rules, agents, commands, hooks, variables); marketplace `.cursor-plugin/marketplace.json`.
   - Local dev dir: `~/.cursor/plugins/local/<plugin>`.
   - Install UI offers "project or user scope". Cursor uses `${CURSOR_PLUGIN_ROOT}` and does not expand the standard's `${PLUGIN_ROOT}`.
   - Source: https://cursor.com/docs/plugins , https://cursor.com/docs/reference/plugins
7. **Home env var**: `CURSOR_CONFIG_DIR` (CLI config; also `XDG_CONFIG_HOME` on Linux/BSD). Documented only for `cli-config.json`; whether it moves `~/.cursor/mcp.json` or skills is UNVERIFIED. Source: https://cursor.com/docs/cli/reference/configuration

## 4. OpenCode (current "V2" docs)
1. **MCP**
   - Project: `opencode.json(c)` at the root or `.opencode/opencode.json(c)`. User: `~/.config/opencode/opencode.json(c)`. JSON/JSONC.
   - Key path: **`mcp.servers.<name>`**.
   - Stdio entry: `{"type":"local","command":["npx","-y","pkg"],"cwd":…,"environment":{…},"disabled":false,"timeout":{…},"codemode":true}`. `command` is an array of executable plus args; there is no `args` field.
   - Env: `environment` is "added to OpenCode's inherited process environment" — parent env is inherited.
   - Substitution `{env:NAME}`; `$NAME` is not expanded.
   - Source: https://opencode.ai/docs/mcp-servers/ , https://opencode.ai/docs/config/
2. **Skills**
   - Load order, later wins: (2) `.claude/skills` global then ancestors; (3) `.agents/skills` global then ancestors; (4) `~/.config/opencode/skills`; (5) project `.opencode/skills`. Item 1 of the list was not captured.
   - Reads both `.agents/skills` and `~/.agents/skills`.
   - All frontmatter is optional at runtime. The skill ID is path-derived; `name` is a display label only. Skills without `description` are not advertised.
   - Extras: `disable-model-invocation`, `metadata.opencode/autoinvoke`.
   - Source: https://opencode.ai/docs/skills/
3. **Subagents**
   - `.opencode/agents/<name>.md` and `~/.config/opencode/agents/<name>.md` (subfolders namespace as `team/reviewer`), or the `agents` config key.
   - Markdown + frontmatter: `description`, `mode` (`primary` | `subagent` | `all`; defaults to `primary`, so set `subagent` explicitly), `model` (`provider/model#variant`), `permissions` (rule list, replaces a tools list).
   - Source: https://opencode.ai/docs/agents/
4. **Commands**: `.opencode/commands/*.md`, `~/.config/opencode/commands/*.md`. Optional frontmatter `description`, `agent`, `model`, `subagent`; the body is the template. Source: https://opencode.ai/docs/commands/
5. **Naming**
   - MCP tool: `<server>_<tool>` (non `[A-Za-z0-9_-]` becomes `_`). MCP prompts become `<server>:<prompt>` commands.
   - Skills are loaded by the model via the `skill` tool with `{"id":…}`. A user-facing `/skill` invocation is UNVERIFIED.
   - Source: https://opencode.ai/docs/mcp-servers/
6. **Plugins**: JS/TS code plugins, not a skills+MCP bundle manifest. Loaded from the `plugins` array in config (npm or path) or auto-discovered in `.opencode/plugins/` and `~/.config/opencode/plugins/`. Both scopes. Source: https://opencode.ai/docs/plugins/
7. **Home env var**: UNVERIFIED in the current docs (pages read mention only `OPENCODE_DB`, `OPENCODE_MODEL`). Guess: `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`, `XDG_CONFIG_HOME` — Kilo's fork documents the `KILO_` equivalents.

## 5. Gemini CLI
1. **MCP**
   - Project `.gemini/settings.json`, user `~/.gemini/settings.json`. JSON, key `mcpServers`.
   - Stdio fields: `command`, `args`, `env`, `cwd`, `timeout` (ms, default 600000), `trust`, `includeTools`, `excludeTools`. No `type`; transport is inferred from `command` / `url` (SSE) / `httpUrl`.
   - Env: inherited from the host but **sanitised** — `*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `*KEY*`, `*AUTH*`, `*CREDENTIAL*`, `GEMINI_API_KEY` and similar are redacted unless explicitly listed in `env`.
   - Source: https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md
2. **Skills**
   - User: `~/.gemini/skills/` or the `~/.agents/skills/` alias. Workspace: `.gemini/skills/` or the `.agents/skills/` alias. Workspace beats user; built-in and extension tiers rank lower.
   - Within a tier, `.agents/skills` beats `.gemini/skills`.
   - Required: `name`, `description`.
   - Source: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/skills.md
3. **Subagents**
   - `.gemini/agents/*.md` (project), `~/.gemini/agents/*.md` (user). Markdown + frontmatter.
   - Required: `name`, `description`. Optional: `kind` (`local` | `remote`), `tools` (array; wildcards `*`, `mcp_*`, `mcp_<server>_*`), `mcpServers`, `model`, `temperature`, `max_turns`, `timeout_mins`.
   - Source: https://github.com/google-gemini/gemini-cli/blob/main/docs/core/subagents.md
4. **Commands**: **TOML**. `~/.gemini/commands/*.toml`, `<project>/.gemini/commands/*.toml`. Subdirectories namespace (`git/commit.toml` becomes `/git:commit`). Source: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/custom-commands.md
5. **Naming**: MCP tool `mcp_{serverName}_{toolName}` (single underscores; avoid `_` in server names). Skills are activated by the model via `activate_skill`; `/skills` manages them. Source: mcp-server.md and skills.md above.
6. **Extensions**
   - Manifest `gemini-extension.json` at the extension root (includes `mcpServers`), plus `commands/`, `skills/`, `agents/`.
   - Installed as a user-level copy (location `~/.gemini/extensions/` is UNVERIFIED on the page read). Enable/disable takes `--scope user|workspace`.
   - Source: https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md
7. **Home env var**: `GEMINI_CLI_HOME`; system settings via `GEMINI_CLI_SYSTEM_SETTINGS_PATH`. Source: https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md

## 6a. GitHub Copilot CLI
1. **MCP**
   - User: `~/.copilot/mcp-config.json`, key `mcpServers`.
   - Project: `.mcp.json` (any directory from cwd up to the repo root) and `.github/mcp.json`. Either an `mcpServers` wrapper or bare top-level server keys.
   - `.vscode/mcp.json` is **not** read.
   - Stdio entry: `{"type":"local","command":"npx","args":[…],"env":{},"tools":["*"]}`. The VS Code docs show `"type":"stdio"` for the same files, so both appear accepted.
   - Env: only `PATH` and "a small set of platform-specific" variables are inherited; everything else must be declared in `env`.
   - Source: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers
2. **Skills**
   - First loaded wins: project `.github/skills/` > `.agents/skills/` > `.claude/skills/` > inherited parent dirs > `~/.copilot/skills/` > `~/.agents/skills/` > plugin skills > `COPILOT_SKILLS_DIRS`.
   - Required: `name`, `description`. Optional: `license`, `allowed-tools`.
   - Source: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills , https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
3. **Subagents ("custom agents")**
   - `~/.copilot/agents/` (user; wins over project), `.github/agents/`, then `.claude/agents/`. Files are `*.agent.md` or `*.md`.
   - Required: `description`. Optional: `name`, `tools` (comma string or YAML array; aliases `execute`/`read`/`edit`/`search`/`agent`/`web`/`todo`; MCP as `<server>/<tool>` or `<server>/*`), `model`, `mcp-servers`, `target`, `disable-model-invocation`, `user-invocable`.
   - Source: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli , https://docs.github.com/en/copilot/reference/custom-agents-configuration
4. **Commands**: reads `.claude/commands/*.md` (simplified, no `name` needed); skills override commands. No native Copilot command directory. Source: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
5. **Naming**: MCP tools as `<server>/<tool>` in agent `tools`. Skill invoked as `/skill-name` inside the prompt; plugin skills are prefixed `/<plugin>:<skill>`. Source: the pages above plus the VS Code agent-skills page.
6. **Plugins**
   - Manifest: root `plugin.json` (Agent Plugins v1.0/1.1) takes precedence over `.plugin/plugin.json` and `.claude-plugin/plugin.json`.
   - MCP: `mcp.json` (Agent Plugins) or `.mcp.json` / `.github/mcp.json` / `mcpServers` field (legacy).
   - Marketplace manifest lookup order: `marketplace.json`, `.plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.claude-plugin/marketplace.json`.
   - Installed per-user only, at `~/.copilot/installed-plugins/<marketplace>/<plugin>`. Per-repo enablement via `enabledPlugins` in `.github/copilot/settings.json`.
   - Source: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
7. **Home env var**: `COPILOT_HOME` (replaces all of `~/.copilot`; `--config-dir` is legacy). Source: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference

## 6b. GitHub Copilot in VS Code (agent mode)
1. **MCP**
   - Copilot harness (current): user `$COPILOT_HOME/mcp-config.json` or `~/.copilot/mcp-config.json`; workspace-root `.mcp.json`. Both use `mcpServers`, entry `{"type":"stdio","command":…,"args":…,"env":…,"cwd":…}`.
   - No `envFile` and no `${input:…}` in this format.
   - Legacy "Local harness": `.vscode/mcp.json` or profile `mcp.json`, key **`servers`**, fields `type` (required), `command`, `args`, `cwd`, `env`, `envFile`, `dev`, `sandboxEnabled`. Docs say not to use it for new configurations.
   - Source: https://github.com/microsoft/vscode-docs/blob/main/docs/agents/reference/mcp-configuration.md
2. **Skills**
   - Copilot harness: `.github/skills/`, `~/.copilot/skills/`. Local harness additionally reads `.claude/skills/`, `.agents/skills/`, `~/.claude/skills/`, `~/.agents/skills/`.
   - This differs from the CLI page, which lists `.agents/skills` for Copilot itself — test in VS Code before relying on `.agents/skills` there.
   - Required: `name` (must match the directory, or the skill is not loaded), `description`. Optional: `argument-hint`, `user-invocable`, `disable-model-invocation`, `context: fork`.
   - Source: https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/agent-skills.md
3. **Custom agents**
   - Workspace `.github/agents/*.agent.md`; `.claude/agents/*.md` in Claude format. User location is "per harness" (path not captured — UNVERIFIED; guess `~/.copilot/agents/`).
   - Fields: `description` (required by the Copilot schema), `name`, `tools`, `agents`, `model`, `skills`, `mcp-servers`, `handoffs` (Local only), `hooks`, `target`, `user-invocable`, `disable-model-invocation`.
   - Source: https://github.com/microsoft/vscode-docs/blob/main/docs/agents/reference/custom-agent-file-reference.md
4. **Prompt files**: `.github/prompts/*.prompt.md` (workspace) or the user profile. Local harness only; not runnable by the Copilot harness. Source: https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/prompt-files.md
5. **Naming**: skills are `/skill-name`; plugin skills `/my-plugin:test-runner`. MCP tool naming in the Copilot harness is the same `<server>/<tool>` form (inferred from the shared schema; UNVERIFIED on the VS Code page).
6. **Plugins**: same format as the CLI, and VS Code auto-discovers CLI installs in `~/.copilot/installed-plugins/`. The UI offers User or Workspace install; workspace enablement is written to `.github/copilot/settings.json`. Source: https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/agent-plugins.md
7. **Home env var**: `COPILOT_HOME` (Copilot harness). No env var for the VS Code profile directory.

## 7. Factory Droid
(docs.factory.ai now points to docs.factory.com)
1. **MCP**
   - User `~/.factory/mcp.json`, project `.factory/mcp.json` (also ancestor "folder" level). JSON, key `mcpServers`.
   - Stdio entry: `{"type":"stdio","command":"npx","args":[…],"env":{…},"disabled":false,"enabledTools":[…],"disabledTools":[…]}` (`type` is optional for stdio in the examples).
   - `${NAME}` is expanded from the shell env. Project servers cannot be removed via the CLI.
   - Env inheritance: UNVERIFIED.
   - Source: https://docs.factory.com/harness/mcp.md
2. **Skills**
   - Project `<repo>/.factory/skills/` (and nested folder-specific), personal `~/.factory/skills/`.
   - Compat: `<repo>/.agents/skills/**`, `<repo>/.agent/skills/**`, `~/.agents/skills/**`, `~/.agent/skills/**`.
   - Precedence: folder/project > project-plugin > personal > user-plugin > built-in; org plugins rank above everything.
   - Required: `name`, `description`. Optional: `allowed-tools` (metadata only), `enabled`, `user-invocable`, `disable-model-invocation`, `license`, `compatibility`, `metadata`, `version`.
   - Source: https://docs.factory.com/harness/skills.md
3. **Subagents ("droids")**
   - `<repo>/.factory/droids/*.md`, `~/.factory/droids/*.md`. Markdown + frontmatter.
   - Required: `name` (`^[a-z0-9-_]+$`). Optional: `description`, `model` (`inherit`), `reasoningEffort`, `tools` (omit for all; or a category string `read-only` | `edit` | `execute` | `web` | `mcp`; or an array of case-sensitive IDs like `["Read","Grep"]`; `all` is rejected), `mcpServers` (array of server names).
   - Source: https://docs.factory.com/harness/subagents.md
4. **Commands**: `<repo>/.factory/commands/`, `~/.factory/commands/`. `.md` (optional frontmatter) or executable files starting with a `#!` shebang. Workspace overrides personal. Source: https://docs.factory.com/harness/custom-slash-commands.md
5. **Naming**: skill `/skill-name`. MCP tool naming UNVERIFIED (docs only say to check `/mcp` for exact names).
6. **Plugins**
   - Manifest `.factory-plugin/plugin.json`; root `mcp.json`, `skills/`, `commands/`, `droids/`, `hooks/`.
   - Claude Code plugins are accepted (`.claude-plugin/` is renamed to `.factory-plugin/`, `.mcp.json` to `mcp.json`).
   - `droid plugin install <plugin@marketplace> --scope user|project`.
   - Source: https://docs.factory.com/harness/plugins.md
7. **Home env var**: none found in the pages read (UNVERIFIED; no `FACTORY_HOME` documented).

## 8. Windsurf (now "Devin Local" in Devin Desktop; same harness as Devin CLI)
1. **MCP**
   - Project `.devin/mcp_config.json` (plus gitignored `.devin/mcp_config.local.json`). User `~/.config/devin/mcp_config.json`. JSON, key `mcpServers`.
   - Before v3000.3 the servers lived in `config.json`.
   - Stdio fields: `command`, `args`, `env`, `disabled`, `disabledTools`. Remote: `url` + `transport: "http"`.
   - Secrets: `${env:VAR}`, `${file:/path}`.
   - Env inheritance: UNVERIFIED. Legacy Cascade path `~/.codeium/windsurf/mcp_config.json`: UNVERIFIED (not in current docs).
   - Source: https://docs.devin.ai/cli/extensibility/mcp/configuration.md , https://docs.devin.ai/desktop/devin-local/customizations.md
2. **Skills**
   - Project: `.agents/skills/`, `.devin/skills/`, `.windsurf/skills/`, `.kiro/skills/`.
   - Global: `~/.agents/skills/`, `~/.config/devin/skills/`, `~/.codeium/<channel>/skills/`, `~/.kiro/skills/`.
   - Also imports `.claude/skills/`, `.github/skills/`, `.codex/skills/`.
   - Frontmatter: `name`, `description`. Optional: `allowed-tools`, `triggers: [user, model]`, `permissions`, `subagent: true`.
   - Source: https://docs.devin.ai/cli/extensibility/skills/overview.md
3. **Subagents**
   - `.devin/agents/<name>/AGENT.md` and `~/.config/devin/agents/<name>/AGENT.md` (a single-file layout also exists).
   - Frontmatter all optional: `name`, `description`, `model`, `allowed-tools` (alias `tools`), `max-nesting`.
   - Source: https://docs.devin.ai/cli/subagents.md
4. **Commands (Cascade workflows)**: `.devin/workflows/*.md` (legacy `.windsurf/workflows/`), global `~/.codeium/windsurf/global_workflows/*.md`. Invoked `/[workflow-name]`; 12000-char limit. Source: https://docs.devin.ai/desktop/cascade.md
5. **Naming**: skill `/skill-name`; plugin skill `/<plugin>:<skill>`. MCP tool naming UNVERIFIED.
6. **Plugins**: manifest lookup `.devin-plugin/plugin.json` > `.claude-plugin/plugin.json` > root `plugin.json`. Claude plugins' root `.mcp.json` is honoured. Installed at **user level only** (org/enterprise can mandate). Source: https://docs.devin.ai/cli/extensibility/plugins/overview.md
7. **Home env var**: none documented (UNVERIFIED). Windows path is `%APPDATA%\devin\config.json`.

## 9. Cline
1. **MCP**
   - User only: `~/.cline/data/settings/cline_mcp_settings.json` (CLI; IDE extensions open their own copy via the UI). Key `mcpServers`.
   - Stdio entry: `{"command":…,"args":[…],"env":{…},"disabled":false,"autoApprove":[]}`. `type` applies to remote only (`streamableHttp` | `sse`; omitting it defaults to legacy `sse`).
   - **No project-scope MCP file documented.**
   - Env inheritance: UNVERIFIED.
   - Source: https://docs.cline.bot/mcp/mcp-overview.md
2. **Skills**
   - Project: `.cline/skills/` (recommended), `.clinerules/skills/`, `.claude/skills/`; the config page adds `.agents/skills/`.
   - Global: `~/.cline/skills/`. `~/.agents/skills` is UNVERIFIED (the sentence listing global compat dirs was cut off in my capture).
   - **Global wins over project** on a name clash.
   - Required: `name`, `description`.
   - Source: https://docs.cline.bot/customization/skills.md , https://docs.cline.bot/getting-started/config.md
3. **Subagents**: `.cline/agents/` and `~/.cline/agents/` directories exist in the config layout, but the file format is not documented on the pages read (UNVERIFIED). The subagents page only covers the built-in `spawn_agent` tool (CLI and Desktop only). Source: https://docs.cline.bot/features/subagents.md
4. **Commands (workflows)**: `.cline/workflows/` (legacy `.clinerules/workflows/`), `~/.cline/workflows/`, `~/Documents/Cline/Workflows/`. Markdown. Source: https://docs.cline.bot/getting-started/config.md
5. **Naming**: skill `/skill-name`. MCP tool naming UNVERIFIED (Cline historically addresses server and tool separately).
6. **Plugins**: JS/TS code plugins (tools, hooks, slash commands), not a skills+MCP manifest. `cline plugin install <git | npm: | path | url>`; global `~/.cline/plugins/` or per-project with `--cwd <path>` into `<path>/.cline/plugins`. Source: https://docs.cline.bot/customization/plugins.md
7. **Home env var**: `CLINE_DIR` (replaces `~/.cline/`), `CLINE_DATA_DIR`, `CLINE_MCP_SETTINGS_PATH`. Source: https://docs.cline.bot/getting-started/config.md

## 10. Kilo Code (new CLI/extension, OpenCode fork)
1. **MCP**
   - Global `~/.config/kilo/kilo.json` (also `kilo.jsonc`, `opencode.json(c)`, `config.json`). Project `./kilo.json` or `./.kilo/kilo.json` (also `kilo.jsonc`, `opencode.json(c)`). JSON/JSONC.
   - Key: top-level **`mcp.<name>`** (old OpenCode shape, not `mcp.servers`).
   - Stdio entry: `{"type":"local","command":["npx","-y","pkg"],"environment":{…},"enabled":true,"timeout":10000}`.
   - `{env:VAR}` and `{file:…}` resolve only in trusted (global / `KILO_CONFIG`) config, not project config.
   - Source: https://kilo.ai/docs/automate/mcp/using-in-kilo-code
2. **Skills**
   - Project `.kilo/skills/` (legacy `.kilocode/skills/`), global `~/.kilo/skills/`.
   - `~/.agents/skills/` and `.agents/skills/` are loaded by default. `.claude/skills` loads when Claude compatibility is on.
   - Extra `skills.paths` / `skills.urls` in config. Disable external dirs with `KILO_DISABLE_EXTERNAL_SKILLS=true`.
   - Project beats global.
   - Source: https://kilo.ai/docs/customize/skills
3. **Subagents**: `.kilo/agents/*.md` (also `.kilo/agent/`), global `~/.config/kilo/agents/`. Markdown + frontmatter: `description`, `mode: subagent`, `model`, `permission` (object per tool), `hidden`. Or the `agent` key in config. Source: https://kilo.ai/docs/customize/custom-subagents
4. **Commands**: `.kilo/commands/*.md`, `~/.config/kilo/commands/*.md` (legacy `.kilocode/workflows/` is migrated). Optional frontmatter (`description`, `agent`, `model`, …). Source: https://kilo.ai/docs/customize/workflows
5. **Naming**: MCP tool `{server}_{tool}`. Skill `/name` (or `/name:skill` when it collides with a command). Subagents via `@`. Source: Kilo docs (llms.txt aggregate) and the skills page.
6. **Plugins**: code plugins in the `plugin` array of config (npm, git or path); the Marketplace panel installs at Project or Global scope. Marketplace metadata is `PLUGIN.yaml` in Kilo-Org/kilo-marketplace. The marketplace also distributes MCP configs and skills separately. Source: https://kilo.ai/docs/customize/marketplace
7. **Home env var**: `KILO_CONFIG` (file), `KILO_CONFIG_DIR`, `KILO_CONFIG_CONTENT`. Source: Kilo docs config-precedence table (https://kilo.ai/docs/llms.txt).

## 11. Qwen Code
1. **MCP**
   - User `~/.qwen/settings.json`, project `.qwen/settings.json`, key `mcpServers`. Also reads a project-root `.mcp.json` (needs restart).
   - Stdio fields: `command`, `args`, `cwd`, `env` (`$VAR` / `${VAR}`), `timeout` (per tool call), plus Gemini-style `trust`, `includeTools`, `excludeTools`. Remote: `httpUrl` (HTTP) / `url` (SSE).
   - Env inheritance: UNVERIFIED (Gemini fork; guess inherited with sanitisation).
   - Source: https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/mcp.md
2. **Skills**
   - Personal `~/.qwen/skills/` and `~/.agents/skills/`. Project `.qwen/skills/` and `.agents/skills/`.
   - `.qwen` wins over `.agents` on a name clash (the opposite of Gemini). Extra dirs via `skills.directories`.
   - Frontmatter: `name`, `description`. Optional: `priority`, `paths`, `user-invocable`, `disable-model-invocation`.
   - Source: https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/skills.md
3. **Subagents**: `.qwen/agents/` (project, highest), `~/.qwen/agents/` (user). Markdown + frontmatter: `name`, `description`, `tools` (optional allowlist), `disallowedTools`, `model`; also accepts Claude Code fields `permissionMode`, `maxTurns`, `color`, `mcpServers`, `hooks`. Source: https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/sub-agents.md
4. **Commands**: `~/.qwen/commands/`, `<project>/.qwen/commands/`. **Markdown** with optional frontmatter (TOML deprecated, auto-migrated). Subdirs namespace as `/git:commit`. Source: https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/commands.md
5. **Naming**: MCP tools `mcp__<server>__<tool>` (patterns `mcp__github`, `mcp__*` appear in the sub-agents page). Skill `/<skill-name>`.
6. **Extensions**: manifest `qwen-extension.json`. Also installs Gemini extensions, Claude Code marketplace plugins (auto-converted) and Agent Plugins v1 (`plugin.json` + `mcp.json` + `SKILL.md`, no conversion). Install scope is user level or project level. Source: https://github.com/QwenLM/qwen-code/blob/main/docs/users/extension/introduction.md , …/extension/agent-plugins.md
7. **Home env var**: `QWEN_HOME` (default `~/.qwen`); `QWEN_RUNTIME_DIR` for runtime output. Source: https://github.com/QwenLM/qwen-code/blob/main/docs/users/configuration/settings.md

## 12. Amp
1. **MCP**
   - Settings JSON/JSONC. User `~/.config/amp/settings.json(c)`; project: nearest `.amp/settings.json(c)` searching upward.
   - Key is the flat, dotted **`"amp.mcpServers"`**. Entry: `{"command":…,"args":[…],"env":{…}}` or `{"url":…,"headers":…}`. Optional `includeTools` globs. No `type`.
   - Docs recommend bundling MCP inside skills instead.
   - Env inheritance: UNVERIFIED.
   - Source: https://ampcode.com/docs/markdown/customize/mcp , https://ampcode.com/docs/markdown/cli/settings
2. **Skills**
   - First match by `name` wins: `~/.config/agents/skills/` > `~/.agents/skills/` > `~/.config/amp/skills/` > `.agents/skills/` (project and parents) > `.claude/skills/` > `~/.claude/skills/` > `~/.claude/plugins/cache/`.
   - Global beats project.
   - Frontmatter: `name`, `description`, plus optional `mcpServers`. A sibling `mcp.json` (bare server map, no `mcpServers` wrapper) is also read; `${AMP_SKILL_DIR}` is available.
   - Source: https://ampcode.com/docs/markdown/customize/skills
3. **Subagents**: no user-defined subagent files; only the built-in Task-style subagents. Source: https://ampcode.com/docs/markdown/models-and-subagents
4. **Commands**: none documented in the pages read (UNVERIFIED; older `.agents/commands/` is not mentioned).
5. **Naming**: MCP tool naming UNVERIFIED (guess `mcp__<server>__<tool>`). Skills are listed via the command palette (`skills: list`) and model-loaded; explicit user syntax not documented.
6. **Plugins**: TypeScript code plugins (`@ampcode/plugin` API). Project `.amp/plugins/`; personal `~/.config/amp/plugins/` (or `$XDG_CONFIG_HOME/amp/plugins/`). Not a skills+MCP manifest; skills bundle MCP themselves. Source: https://ampcode.com/docs/markdown/customize/plugins
7. **Home env var**: `XDG_CONFIG_HOME` (documented for plugins). `AMP_SETTINGS_FILE` is UNVERIFIED (not on the pages read).

## 13. pi (repo moved from badlogic/pi-mono to earendil-works/pi)
1. **MCP** (now native)
   - User `~/.pi/agent/mcp.json`, project `.pi/mcp.json` (needs project trust). Key `mcpServers`.
   - Stdio fields: `command`, `args`, `env`, `cwd`. Common: `timeout` (seconds, default 60), `enabled`, `exposure`, `toolExposure`, `description`.
   - `type` is optional (`stdio` | `http` | `streamable-http`); `sse` is rejected.
   - `${VAR}` and `!command` are allowed in `env` and `headers`.
   - A project entry without `command`/`url`/`type` only overrides `enabled`/`exposure` of the same-named user server.
   - Env inheritance: UNVERIFIED.
   - Source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md
2. **Skills**: `<agent-dir>/skills/` (`~/.pi/agent/skills/`), `.pi/skills/`, plus `~/.agents/skills/` and `.agents/skills/` (ancestors up to the repo root). Recursive discovery. Frontmatter `name`, `description`; optional `disable-model-invocation`. Source: …/docs/skills.md , …/docs/configuration.md
3. **Subagents**: none documented (no subagent docs in the repo).
4. **Commands (prompt templates)**: `~/.pi/agent/prompts/*.md`, `.pi/prompts/*.md` (direct children only). Optional `description` frontmatter. Invoked as `/name`. Source: …/docs/prompt-templates.md
5. **Naming**: MCP tool `mcp__<server>__<tool>`. Skill `/skill:name`. Source: mcp.md and skills.md above.
6. **Packages**: "Pi packages" are a plain npm or git package with `extensions/`, `skills/`, `prompts/`, `themes/` dirs or a `pi` key in `package.json`. `pi install npm:… | git:… | ./path` writes to `~/.pi/agent/settings.json`; `-l` / `--local` writes to `.pi/settings.json`. Both scopes. MCP servers are not bundled by packages per the docs read. Source: …/docs/packages.md
7. **Home env var**: `PI_CODING_AGENT_DIR` (default `~/.pi/agent`); also `PI_PACKAGE_DIR`. Source: …/docs/environment-variables.md

## 14. Goose (repo now aaif-goose/goose; docs at goose-docs.ai)
1. **MCP ("extensions")**
   - User only: `~/.config/goose/config.yaml` (Windows `%APPDATA%\Block\goose\config\config.yaml`). **YAML**, key `extensions.<name>`.
   - Stdio entry: `type: stdio`, `name`, `enabled`, `cmd`, `args`, `envs` (map), `env_keys` (list), `timeout` (seconds), `bundled`.
   - **No project-scope MCP file documented.** Recipes can carry their own `extensions`.
   - Env inheritance: UNVERIFIED.
   - Source: https://goose-docs.ai/docs/guides/config-files.md
2. **Skills**: primary dirs are the shared ones — `~/.agents/skills/` (global), `.agents/skills/` (project), `~/.agents/plugins/<plugin>/`. Back-compat: `.goose/skills/`, `.claude/skills/`, `~/.claude/skills/`. Required `name`, `description`. Source: https://goose-docs.ai/docs/guides/context-engineering/using-skills.md
3. **Subagents**: no agent-definition directory. Subagents are ad hoc or driven by **recipes** (YAML) found via `GOOSE_RECIPE_PATH`; `sub_recipes` for composition. Source: https://goose-docs.ai/docs/guides/context-engineering/subagents.md
4. **Commands**: `slash_commands:` list in `config.yaml` mapping `command` to `recipe_path`. User scope only. Source: https://goose-docs.ai/docs/guides/context-engineering/slash-commands.md
5. **Naming**: skills are loaded with `/skills <name> …`; plugin skills are named `<plugin>:<skill>`. MCP tool naming UNVERIFIED (guess `<extension>__<tool>`).
6. **Plugins**: "Open Plugins" format — `plugin.json` at root, `.plugin/plugin.json`, or `.goose-plugin/plugin.json`, with `skills/` and `hooks/hooks.json`. Gemini `gemini-extension.json` is also accepted (skills only). User `~/.agents/plugins/<name>/`, project `<project>/.agents/plugins/<name>/`. `goose plugin install <git url>`. Docs list skills and hooks as supported components, not MCP. Source: https://goose-docs.ai/docs/guides/context-engineering/plugins.md
7. **Home env var**: `GOOSE_PATH_ROOT` (all data, config and state). Source: https://goose-docs.ai/docs/guides/environment-variables.md

## 15. Roo Code (extension shut down May 15; docs retained)
1. **MCP**
   - Global `mcp_settings.json` (opened via the UI; lives in VS Code globalStorage — exact path UNVERIFIED). Project `.roo/mcp.json`. Key `mcpServers`.
   - Stdio fields: `command`, `args`, `cwd`, `env`, `alwaysAllow`, `disabled`, `timeout` (seconds, 1-3600, default 60), `disabledTools`. `${env:VAR}` in args.
   - Project wins.
   - Source: https://github.com/RooCodeInc/Roo-Code-Docs/blob/main/docs/features/mcp/using-mcp-in-roo.mdx
2. **Skills**: `~/.roo/skills/` > `~/.agents/skills/`; project `.roo/skills/` > `.agents/skills/`; project overrides global. Mode-specific `skills-<mode>/`. Required `name`, `description`. Source: …/docs/features/skills.mdx
3. **Subagents**: none. Custom **modes** instead — project `.roomodes` (YAML), global `custom_modes.yaml`. Fields `slug`, `name`, `roleDefinition`, `groups` (tool groups such as `read`, `edit`). Source: …/docs/features/custom-modes.mdx
4. **Commands**: `.roo/commands/*.md`, `~/.roo/commands/*.md`. Frontmatter `description`, `argument-hint`. Source: …/docs/features/slash-commands.mdx
5. **Naming**: MCP tool naming UNVERIFIED (server and tool addressed separately via `use_mcp_tool`). Skill invocation is model-driven.
6. **Marketplace**: MCPs and Modes only, installable at project or global scope. No bundle manifest. Source: …/docs/features/marketplace.mdx
7. **Home env var**: none documented.

## 16. Zed agent
1. **MCP**
   - `settings.json`, key **`context_servers`**. User `~/.config/zed/settings.json` (Linux honours `$XDG_CONFIG_HOME`; Windows `%APPDATA%\Zed\settings.json`). Project `.zed/settings.json`.
   - Whether `context_servers` is honoured in project settings is UNVERIFIED (docs say not all settings are).
   - Entry: `{"command":…,"args":[…],"env":{}}` or `{"url":…,"headers":…}`. No `type`.
   - Env inheritance: UNVERIFIED.
   - Source: https://github.com/zed-industries/zed/blob/main/docs/src/ai/mcp.md , …/docs/src/configuring-zed.md
2. **Skills**: only `~/.agents/skills/` (global) and `<worktree>/.agents/skills/` (project). Direct children only; no nesting. Required `name` (max 64 chars, should match the folder), `description`. Optional `disable-model-invocation`. Source: …/docs/src/ai/skills.md
3. **Subagents**: built-in `spawn_agent` tool only; no definition files. Agent **profiles** in settings control tool availability. Source: …/docs/src/ai/tools.md , …/docs/src/ai/agent-profiles.md
4. **Commands**: none file-based (skills serve as slash commands; extension slash commands are code).
5. **Naming**: MCP tool key `mcp:<server>:<tool_name>` (permissions format). Skill `/skill-name` or @-mention. Source: mcp.md and skills.md above.
6. **Extensions**: Zed extensions (`extension.toml` with `[context_servers.<id>]`) can ship MCP servers but not skills. Skills are shared via `zed://skill?data=…` links. Extensions are user-level. Source: …/docs/src/extensions/mcp-extensions.md
7. **Home env var**: `XDG_CONFIG_HOME` (Linux) only.

---

## Convergence summary

**`.agents/skills` (project) and `~/.agents/skills` (user)**

| Status | Harnesses |
|---|---|
| Reads both | Codex (canonical, only path), Cursor, OpenCode, Gemini CLI, Copilot CLI, Factory, Devin/Windsurf, Kilo, Qwen, Amp, pi, Goose (primary), Roo, Zed (only path) |
| Project only confirmed | Cline (`.agents/skills`; global unconfirmed) |
| Does not read | Claude Code (`.claude/skills` only) |
| Unclear | VS Code Copilot harness page lists only `.github/skills` and `~/.copilot/skills` |

- Writing to `.agents/skills` + `.claude/skills` (project) and `~/.agents/skills` + `~/.claude/skills` (user) covers essentially everything. `.claude/skills` is also read as a compat path by Cursor, OpenCode, Copilot CLI, Cline, Kilo, Amp, Goose and Devin.
- Precedence hazards: Cline and Amp let **global beat project**. Gemini prefers `.agents` over its own directory; Qwen and Roo do the opposite.
- `name` must equal the folder name in Cursor and VS Code. OpenCode ignores `name` and uses the path as the ID.

**`mcpServers`-keyed JSON with `command`/`args`/`env`**
- Same shape: Claude Code (`.mcp.json`, `~/.claude.json`), Cursor, Gemini, Qwen, Copilot CLI and VS Code Copilot harness, Factory, Devin/Windsurf, Cline, Roo, pi.
- A root `.mcp.json` is read by Claude Code, Copilot CLI/VS Code and Qwen.
- `type` discriminator varies: `stdio` (Claude, Cursor, Factory, VS Code), `local` (Copilot CLI), absent or inferred (Gemini, Qwen, Devin, Cline, Roo, pi).
- Timeout units vary: ms (Claude, Gemini, Qwen, Kilo), seconds (pi, Roo, Goose, Codex `*_sec`).
- Disable flag varies: `disabled` (Factory, Devin, Cline, Roo, OpenCode), `enabled` (Codex, Kilo, pi, Goose).

**MCP outliers**
- Codex: TOML `[mcp_servers.x]`, with an `env_vars` forward list.
- OpenCode: `mcp.servers.x`, `type: local`, array `command`, `environment`.
- Kilo: `mcp.x`, otherwise the same OpenCode shape.
- Goose: YAML `extensions.x` with `cmd` / `envs` / `env_keys`.
- Zed: `context_servers`.
- Amp: flat `"amp.mcpServers"` key, or a per-skill `mcp.json` with no wrapper.
- VS Code legacy: `servers`.
- No project-scope MCP file: Cline, Goose. Zed project scope is unverified.

**Env inheritance, where documented**
- OpenCode: inherits the parent env.
- Gemini: inherits, with secret-pattern redaction.
- Copilot CLI: only `PATH` and a few platform variables.
- Codex: explicit `env_vars` forward list.
- Everyone else: undocumented. Always write needed variables into `env`.

**MCP tool naming**
- `mcp__server__tool`: Claude Code, pi, Qwen.
- `mcp_server_tool`: Gemini.
- `server_tool`: OpenCode, Kilo.
- `server/tool`: Copilot.
- `mcp:server:tool`: Zed.
- Skill text that hard-codes tool names needs per-harness rewriting.

**Skill invocation**
- `/name` in most harnesses.
- `$name` in Codex; `/skill:name` in pi; `/skills name` in Goose.
- Plugin-namespaced `/plugin:skill` in Claude, Copilot, Devin; `plugin:skill` in Goose.

**Subagent formats**
- Markdown + frontmatter in `<dot>/agents/`: Claude, Cursor, OpenCode, Gemini, Copilot (`.agent.md`), Kilo, Qwen, Devin (`AGENT.md` in a folder), Factory (`droids/`).
- TOML: Codex.
- No file format: Amp, pi, Zed, Goose (recipes), Roo (modes); Cline is undocumented.
- `.claude/agents` is read as compat by Cursor, Copilot CLI and VS Code.

**Commands**
- Markdown almost everywhere. Gemini is TOML. Factory also allows shebang executables. Goose maps commands to recipes in config.
- Codex prompts are user-only and deprecated.
- Claude, Cursor, Codex, Factory and Kilo are all steering commands toward skills.

**Plugin bundles**
- `.claude-plugin/plugin.json` is the de facto interchange format: natively Claude; accepted by Copilot CLI, Factory, Devin and Qwen.
- Root `plugin.json` + `mcp.json` (Agent Plugins): Codex, Cursor, Copilot, Qwen, Devin.
- Per-project install supported: Claude, Factory, Cursor, Qwen, Goose (`.agents/plugins`), Codex (repo marketplace plus per-project enable).
- User-only install: Copilot CLI, Devin; Gemini (with workspace enable/disable).
- OpenCode, Kilo, Cline, Amp and pi plugins are code packages, not skills+MCP manifests.
