<!-- Research notes gathered 2026-11-24 by a research agent. Items marked NOT STATED were not found in the documentation. -->

# Hooks and remote HTTP MCP across 15 harnesses (docs fetched 2026-11-24)

**Provenance.** I read the docs for Claude Code, Codex, Cursor, Copilot and Gemini myself. The other ten come from three sub-agents that fetched official pages; I relay their findings and did not re-check them. "NOT STATED" means the fetched official pages do not say. Anything not verbatim from docs is marked.

**Six findings that contradict the brief or change installer design:**
- **Amp has no `amp.hooks` setting**; hooks are TS/JS plugins only.
- **pi now has built-in MCP** (streamable HTTP plus OAuth); the repo moved to `earendil-works/pi`.
- **Goose now has shell-command hooks**, in plugin `hooks/hooks.json` files, not `config.yaml`.
- **OpenCode docs are now V2**: plugin API and MCP shape both changed (`mcp.servers.<name>`; shell tool renamed `bash` to `shell`). Kilo's live schema shows the same `mcp.servers` move.
- **The Windsurf "Cascade Hooks" page is gone**; it redirects to the Devin CLI hooks docs.
- **Double-fire risk**: Cursor, Copilot (repo-level files only) and Devin also read `.claude/settings.json` hooks, so writing both a Claude hook and a native hook runs it twice.

Downloaded copies are under `/private/tmp/claude-501/-Users-krish-projects-gsd-core/8c22bd47-632a-4d60-a457-bc6ecc41a62c/scratchpad/` in `dl5/` (mine), `dl2/`, `dl3/`, `dl4/` (sub-agents), plus the earlier `dl/`.

---

# PART 1 — HOOKS

## 1. Claude Code
Source: https://code.claude.com/docs/en/hooks

- **a.** Yes. Handler types: `command`, `http`, `mcp_tool`, `prompt`, `agent`.
- **b.** Shared settings file, key `hooks.<Event>[]`.
  - User: `~/.claude/settings.json`.
  - Project: `.claude/settings.json`, `.claude/settings.local.json`.
  - Plugin: dedicated `hooks/hooks.json`. Also skill and subagent frontmatter.
  - "Hook entries merge across settings levels rather than replacing each other."
- **c.** Verbatim:
  ```json
  { "hooks": { "PreToolUse": [ { "matcher": "Bash",
      "hooks": [ { "type": "command", "if": "Bash(rm *)",
                   "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/block-rm.sh", "args": [] } ] } ] } }
  ```
  - `type` is required.
  - `command`: shell string, or with `args` an executable spawned without a shell.
  - `matcher` (group level): only letters, digits, `_`, `-`, space, `,`, `|` means an exact name or list; "Contains any other character | JavaScript regular expression, unanchored". For tool events it tests `tool_name`.
  - `timeout`: "Seconds before canceling", default 600 for command hooks.
  - Other fields: `if`, `statusMessage`, `once`, `async`, `asyncRewake`, `shell`, `onFailure`.
  - No name/id field.
- **d.** Events: SessionStart, Setup, InstructionsLoaded, UserPromptSubmit, UserPromptExpansion, MessageDisplay, PreToolUse, PermissionRequest, PostToolUse, PostToolUseFailure, PostToolBatch, PermissionDenied, Notification, SubagentStart, SubagentStop, TaskCreated, TaskCompleted, Stop, StopFailure, TeammateIdle, ConfigChange, CwdChanged, DirectoryAdded, FileChanged, WorktreeCreate, WorktreeRemove, PreCompact, PostCompact, PreModelSwitch, PostModelSwitch, SessionEnd, Elicitation, ElicitationResult.
- **e.** JSON on stdin.
  - Exit 0: success, stdout JSON applied.
  - "Blocking error: your hook exits 2."
  - Any other code: non-blocking error.
  - Stdout JSON: `hookSpecificOutput.permissionDecision`, `updatedInput`, `continue`, `decision`, `additionalContext`.
- **f.** `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`.
- **g.** `Bash`, `Read`, `Write`, `Edit`.

## 2. OpenAI Codex CLI
Source: https://learn.chatgpt.com/docs/hooks (developers.openai.com/codex/hooks redirects here)

- **a.** Yes. "`command` and `mcp_tool` handlers are supported. `prompt` and `agent` handlers are parsed but skipped."
- **b.** Dedicated `hooks.json`, or inline `[hooks]` in `config.toml`.
  - User: `$CODEX_HOME/hooks.json` (`~/.codex/hooks.json`).
  - Project: `.codex/hooks.json`, trusted projects only.
  - System: `/etc/codex/hooks.json`.
  - Plugin: `hooks/hooks.json`.
  - "When a layer declares hooks in both `hooks.json` and `config.toml`, Codex loads both and warns at startup. Prefer one format per layer."
  - Trust gate: "Non-managed hooks must be reviewed and trusted before they run", via `/hooks` and keyed to the hook's hash. An installer-written hook is skipped until the user trusts it.
- **c.** Verbatim JSON (wrapper `{"hooks": {...}}`, optional top-level `description`):
  ```json
  "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command",
     "command": "/usr/bin/python3 \"$(git rev-parse --show-toplevel)/.codex/hooks/pre_tool_use_policy.py\"",
     "statusMessage": "Checking Bash command" } ] } ]
  ```
  Verbatim TOML:
  ```toml
  [[hooks.PreToolUse]]
  matcher = "^Bash$"
  [[hooks.PreToolUse.hooks]]
  type = "command"
  command = '/usr/bin/python3 "$(git rev-parse --show-toplevel)/.codex/hooks/pre_tool_use_policy.py"'
  timeout = 30
  ```
  - Matcher: "a regex string"; `"*"`, `""` or omitted matches all; tested on `tool_name` plus aliases.
  - "`timeout` is in seconds", default 600.
  - Other fields: `statusMessage`, `async`, `commandWindows`, `additionalContextLimit`.
  - No name/id field.
- **d.** Events: PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, UserPromptSubmit, SubagentStart, SubagentStop, Stop, PreModelRequest, PostModelRequest, Interrupt, SessionStart, SessionEnd. Notification: NONE in hooks.
- **e.** "Every command hook receives one JSON object on `stdin`."
  - PreToolUse deny uses the Claude shape `hookSpecificOutput.permissionDecision: "deny"`, or the older `{"decision":"block"}`.
  - "You can also use exit code `2` and write the blocking reason to `stderr`."
  - `updatedInput` rewrite is supported.
  - `continue` / `stopReason` on PreToolUse make the hook run fail.
  - No blanket Claude-compat sentence; only "Codex also sets `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` for compatibility with existing plugin hooks."
- **f.** Project-dir env var: NOT STATED. Docs say "prefer resolving from the git root", hence the `$(git rev-parse --show-toplevel)` idiom. Plugin hooks get `PLUGIN_ROOT`, `PLUGIN_DATA`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`.
- **g.** Shell: `Bash`. Write/edit: `apply_patch`, where the matcher may also use `Edit` or `Write` but the payload still says `tool_name: "apply_patch"`. Read: no dedicated tool documented.

## 3. Cursor
Sources: https://cursor.com/docs/hooks.md , https://cursor.com/docs/reference/third-party-hooks.md

- **a.** Yes; `command` (default) and `prompt`.
- **b.** Dedicated `hooks.json`: `<project>/.cursor/hooks.json` and `~/.cursor/hooks.json`. Shape is `{"version": 1, "hooks": {<event>: [ ... ]}}`.
  - Flat: there is no nested matcher group; each entry carries its own `command` and `matcher`.
  - Working directory: project hooks run from the project root, user hooks from `~/.cursor/`.
  - Also loads Claude Code hooks from `.claude/settings.local.json`, `.claude/settings.json`, `~/.claude/settings.json` (setting on by default).
- **c.** Verbatim:
  ```json
  { "version": 1, "hooks": { "preToolUse": [ { "command": "./validate-shell.sh", "matcher": "Shell" } ] } }
  ```
  - Dedicated shell event, verbatim: `"beforeShellExecution": [{ "command": "./scripts/approve-network.sh", "timeout": 30, "matcher": "curl|wget|nc" }]`. There the matcher tests the command string, not the tool name.
  - `type`: `"command"` or `"prompt"`, default command.
  - `timeout`: "Execution timeout in seconds".
  - `matcher`: regex.
  - Other fields: `loop_limit`, `failClosed`.
  - No name/id field.
- **d.** Events: sessionStart, sessionEnd, preToolUse, postToolUse, postToolUseFailure, subagentStart, subagentStop, beforeShellExecution, afterShellExecution, beforeMCPExecution, afterMCPExecution, beforeReadFile, afterFileEdit, beforeSubmitPrompt, preCompact, stop, afterAgentResponse, afterAgentThought, beforeTabFileRead, afterTabFileEdit, workspaceOpen. The docs' own mapping table says `Notification` and `PermissionRequest` are not supported.
- **e.** JSON on stdin and stdout.
  - "Exit code `2` - Block the action (equivalent to returning `permission: "deny"`)".
  - "Other exit codes - Hook failed, action proceeds (fail-open by default)".
  - Native output: `{permission, user_message, agent_message, updated_input}`.
  - Compat quote: "Cursor supports both Claude Code's nested `hookSpecificOutput` response format and the older flat response format. Hook scripts written for Claude Code will work in Cursor regardless of which format they use."
- **f.** `CURSOR_PROJECT_DIR`; `CLAUDE_PROJECT_DIR` ("Alias for project dir (Claude compatibility)"); `CURSOR_PLUGIN_ROOT` for plugin hooks.
- **g.** `Shell`, `Read`, `Write` (edits also match `Write`; there is no `Edit`), plus `Grep`, `Delete`, `Task`, `MCP:<tool_name>`. The docs' Claude-format example uses matcher `"Shell"`; translation of `Bash` is NOT STATED.

## 4. GitHub Copilot (CLI and VS Code Copilot harness share one format)
Sources: https://docs.github.com/en/copilot/reference/hooks-reference ; https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/hooks.md ("VS Code ... and Copilot CLI share this harness and its hook format")

- **a.** Yes; command, HTTP and prompt hooks.
- **b.** A directory of JSON files, plus an inline option.
  - Repo: `.github/hooks/*.json`.
  - User: `~/.copilot/hooks/*.json` (`$COPILOT_HOME/hooks/`).
  - Inline `hooks` key: `.github/copilot/settings.json`, `.github/copilot/settings.local.json`, `~/.copilot/settings.json`.
  - "Cross-tool `.claude/settings.json` and `.claude/settings.local.json` files in the repository are also read." (repo-level only).
  - Plugins: `hooks.json` or `hooks/hooks.json`.
  - All sources are combined and all run.
- **c.** File shape, verbatim:
  ```json
  { "version": 1, "hooks": { "preToolUse": [ { "type": "command", "bash": "YOUR_BASH_COMMAND",
      "powershell": "YOUR_POWERSHELL_COMMAND", "cwd": "OPTIONAL/WORKING/DIRECTORY",
      "env": { "VAR": "VALUE" }, "timeoutSec": 30 } ] } }
  ```
  The only verbatim matcher example is for postToolUse: `{ "type": "command", "matcher": "bash|edit", "bash": "./scripts/log-tool.sh" }`.
  - So a shell-restricted pre-hook is `{"type":"command","matcher":"bash","command":"..."}`. This is my composition from documented fields, not a docs example.
  - Flat entries, no nested group.
  - `type` defaults to `"command"`.
  - Command fields: `bash` / `powershell` / `command` (cross-platform fallback), or `exec` + `args`.
  - `timeoutSec` in seconds, default 30; `timeout` is an alias.
  - `matcher`: regex "compiled as `^(?:PATTERN)$`", full match on `toolName`.
  - No name/id field.
- **d.** Events: agentStop, errorOccurred, notification, permissionRequest, postToolUse, postToolUseFailure, preCompact, preToolUse, sessionEnd, sessionStart, subagentStart, subagentStop, userPromptSubmitted, userPromptTransformed.
  - PascalCase aliases select a snake_case payload: SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop, SubagentStop, ErrorOccurred, PreCompact.
- **e.** JSON on stdin.
  - Exit 2: "Treated as a warning by default ... For `permissionRequest` and `preToolUse`, exit `2` is treated as a deny".
  - preToolUse fails closed on any non-zero exit; timeouts fail open.
  - Exit 2 on agentStop does not block; use `{"decision":"block","reason":...}`.
  - Output is top-level `permissionDecision` / `permissionDecisionReason` / `modifiedArgs`, not nested under `hookSpecificOutput`.
  - Compat quote: "Hooks configured with the PascalCase event name `PreToolUse`—as used in Claude Code plugins and the Open Plugins format—apply Claude's matcher semantics", and the payload reports Claude tool names.
  - VS Code warns: "Sharing a hook file location does not establish runtime compatibility."
- **f.** Project-dir env var: NOT STATED (the payload has `cwd`; the entry `cwd` is relative to the repo root). Plugins: `PLUGIN_ROOT`, `CLAUDE_PLUGIN_ROOT`, `COPILOT_PLUGIN_DATA`.
- **g.** Native: `bash` (`powershell`), `view`, `create`, `edit`. With PascalCase events the Claude names `Bash`, `Read`, `Write`, `Edit` work.

## 5. Gemini CLI
Sources: https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/index.md , .../hooks/reference.md

- **a.** Yes. "Currently only `"command"` is supported."
- **b.** Shared settings file, key `hooks`: `.gemini/settings.json` (project), `~/.gemini/settings.json` (user). Extensions use a dedicated `hooks/hooks.json`.
- **c.** Verbatim (file-write matcher; for shell use `run_shell_command`):
  ```json
  { "hooks": { "BeforeTool": [ { "matcher": "write_file|replace",
      "hooks": [ { "name": "security-check", "type": "command",
                   "command": "$GEMINI_PROJECT_DIR/.gemini/hooks/security.sh", "timeout": 5000 } ] } ] } }
  ```
  - `timeout`: "Execution timeout in milliseconds (default: 60000)". Milliseconds, unlike everyone else.
  - `name` and `description` are optional.
  - Group fields: `matcher` (regex for tool events, exact string for lifecycle events) and `sequential`.
- **d.** Events: SessionStart, SessionEnd, BeforeAgent, AfterAgent, BeforeModel, AfterModel, BeforeToolSelection, BeforeTool, AfterTool, PreCompress, Notification.
- **e.** JSON on stdin and stdout.
  - Exit 2: "System Block ... `stderr` is used as the rejection reason".
  - Other codes: warning, proceeds.
  - Stdout must be JSON only; block with `{"decision":"deny"}`.
  - Claude compatibility: NOT STATED beyond the env alias.
- **f.** `GEMINI_PROJECT_DIR`, `GEMINI_CWD`, `GEMINI_SESSION_ID`, `GEMINI_PLANS_DIR`; "`CLAUDE_PROJECT_DIR`: (Alias) Provided for compatibility." Extensions use `${extensionPath}` (documented for the manifest, not for hook commands).
- **g.** `run_shell_command`, `read_file`, `write_file`, `replace`.

## 6. OpenCode (sub-agent)
Sources: https://raw.githubusercontent.com/anomalyco/opencode/dev/services/site/src/docs/content/{plugins,build/plugins/server,build/plugins/migrate-v1,tools}.mdx ; schema https://opencode.ai/config.json

- **a.** Only via code plugins. The schema has no hook key and no `experimental.hook`.
- **b.** Plugin files in `.opencode/plugins/` and `~/.config/opencode/plugins/`, or the `plugins` array in `opencode.json(c)` (V1 key `plugin` is deprecated). "V1 plugin implementations do not run in V2."
- **c.** No JSON registration; you filter in code.
  - V1: `"tool.execute.before": async (input, output) => { if (input.tool === "read" ...) throw new Error(...) }`.
  - V2: `Plugin.define({ id, async setup(ctx) { await ctx.tool.hook("execute.before", (event) => {...}) } })`.
- **d.** V1 events: `tool.execute.before`, `tool.execute.after`, `chat.message`, `session.created`, `session.idle`, `session.compacted`, `experimental.session.compacting`, `permission.asked`, `shell.env` and others. V2: `ctx.tool.hook("execute.before"|"execute.after")`, `ctx.session.hook("prompt"|"compaction"|...)`, `ctx.shell.hook("create.before")`, `ctx.permission.hook("evaluate")`.
- **e.** In-process: throw to block, mutate args to modify. No stdin or exit codes.
- **f.** None; V1 context gives `directory` and `worktree`.
- **g.** V2: `shell`, `read`, `write`, `edit` (`patch` for GPT models). V1: `bash`, `read`, `write`, `edit`, `apply_patch`.

## 7. Factory Droid (sub-agent)
Source: https://docs.factory.com/harness/hooks.md

- **a.** Yes. "Currently only `"command"` is supported."
- **b.** Dedicated `~/.factory/hooks.json` and `.factory/hooks.json`, "Keyed directly by event name" with no wrapper. Or under `hooks` in `settings.json` / `settings.local.json`.
  - Hazard: "an event defined in `hooks.json` replaces the same event in that directory's `settings.json`."
- **c.** Verbatim:
  ```json
  { "PreToolUse": [ { "matcher": "Execute", "commandRegex": "^git ",
      "hooks": [ { "type": "command", "command": "/usr/local/bin/audit-git-command.sh", "timeout": 30 } ] } ] }
  ```
  - Matcher follows the Claude rule: exact list, else unanchored JS regex on `tool_name`.
  - `timeout` in seconds, default 60.
  - Other fields: `onFailure`, `commandRegex`.
  - No name/id field.
- **d.** Exactly the nine canonical events under the same names.
- **e.** JSON on stdin. "Exit code `2` always blocks where the event can block." Stdout supports `hookSpecificOutput.permissionDecision`, `updatedInput`, `continue`, `decision`.
  - No blanket compat sentence.
  - Warning from the docs: "A script copied from Claude Code that checks `tool_name == "Bash"` takes the wrong branch; check for `Execute` as well."
- **f.** `FACTORY_PROJECT_DIR`, `DROID_PROJECT_DIR`, `CLAUDE_PROJECT_DIR`. These are the working directory: "it does not locate the repository root". Plugins: `DROID_PLUGIN_ROOT`, `CLAUDE_PLUGIN_ROOT` and the `_DATA` pair.
- **g.** `Execute`, `Read`, `Create`, `Edit` (+ `ApplyPatch`). Exact-name aliases `Bash`→`Execute` and `Write`→`Create` are accepted, but "A regular expression is tested against the Droid name only".

## 8. Devin CLI / Windsurf (sub-agent)
Sources: https://docs.devin.ai/cli/extensibility/hooks/overview.md , .../hooks/lifecycle-hooks.md

- **a.** Yes (`command`, `prompt`). Devin Desktop uses the same system.
- **b.** Project dedicated file: `.devin/hooks.v1.json`, "the hooks object is the **entire file** (no wrapper key needed)". Or the `hooks` key in `.devin/config.json`.
  - User: only the `hooks` key in `~/.config/devin/config.json`.
  - Also reads `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json` by default; "collected from all sources and all run".
- **c.** Verbatim:
  ```json
  { "PreToolUse": [ { "matcher": "exec",
      "hooks": [ { "type": "command", "command": "./scripts/validate.sh", "timeout": 10 } ] } ] }
  ```
  - Matcher: unanchored regex on `tool_name`.
  - Timeout in seconds; default NOT STATED.
  - No name/id field.
- **d.** Events: PreToolUse, PostToolUse, PermissionRequest, UserPromptSubmit, Stop, PostCompaction, SessionStart, SessionEnd.
- **e.** JSON on stdin; exit 0 success, "2 | Block — action is denied", other codes logged. Stdout: top-level `decision: "approve"|"block"`, `hookSpecificOutput.updatedInput`, `additionalContext`. Whether `permissionDecision` is honoured: NOT STATED.
- **f.** `DEVIN_PROJECT_DIR`. `CLAUDE_PROJECT_DIR`: NOT STATED.
- **g.** `exec`, `read`, `write`, `edit` (`apply_patch`). Translation of an imported `Bash` matcher: NOT STATED.
- **Legacy Windsurf Cascade hooks** (`~/.codeium/windsurf/hooks.json`): the page redirects away; not verifiable.

## 9. Qwen Code (sub-agent)
Source: https://raw.githubusercontent.com/QwenLM/qwen-code/main/docs/users/features/hooks.md

- **a.** Yes (`command`, `http`, `function`, `prompt`).
- **b.** Shared settings file, key `hooks`: `.qwen/settings.json`, `~/.qwen/settings.json`. Project hooks need a one-time approval, stored in `~/.qwen/hookApprovals.json` and bound to the exact config; non-interactive runs leave unapproved project hooks unloaded.
- **c.** Verbatim:
  ```json
  { "hooks": { "PreToolUse": [ { "matcher": "^run_shell_command$", "sequential": false,
      "hooks": [ { "type": "command", "command": "/path/to/security-check.sh", "name": "security-check",
                   "description": "Run security checks before tool execution", "timeout": 30 } ] } ] } }
  ```
  - `timeout` in seconds, default 60. Trap: "a value of `1000` or more is still read as milliseconds".
  - `name` is needed to toggle a hook individually.
  - Matcher: unanchored regex on the tool id.
- **d.** Events: PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, UserPromptSubmit, UserPromptExpansion, SessionStart, SessionEnd, SessionDelete, MessageDisplay, Stop, StopFailure, SubagentStart, SubagentStop, PreCompact, PostCompact, Notification, PermissionRequest, PermissionDenied, TodoCreated, TodoCompleted, InstructionsLoaded, FileChanged. All nine canonical names match.
- **e.** JSON on stdin. Exit 2: "Blocking error. Ignores `stdout`, passes `stderr` as error feedback to the model." Stdout supports `hookSpecificOutput.permissionDecision` and `updatedInput`. Blanket compat statement: NOT STATED.
- **f.** "`QWEN_PROJECT_DIR`, `CLAUDE_PROJECT_DIR` and `GEMINI_PROJECT_DIR` are set to the project directory".
- **g.** `run_shell_command`, `read_file`, `write_file`, `edit`. Aliases: "a matcher copied from a Claude Code config such as `"Bash"` or `"Write|Edit"` works unchanged" (exact comparison only).

## 10. Kilo Code (sub-agent)
Sources: https://kilo.ai/docs/llms.txt ; schema https://app.kilo.ai/config.json

- **a.** Only via code plugins; no hook key in the schema.
- **b.** `~/.config/kilo/plugin/`, `.kilo/plugin/`, or the `plugin` array in `kilo.json`.
- **c.** Code only: `"tool.execute.before": async (input, output) => { if (input.tool === "bash") ... }`; the default export must include `server`.
- **d.** OpenCode-V1-style: `tool.execute.before`, `tool.execute.after`, `chat.message`, `event` (`session.created`, `session.idle`, ...), `experimental.session.compacting`, `permission.ask`, `shell.env`.
- **e.** In-process; throw to block.
- **f.** None (`directory`, `worktree` in the plugin context).
- **g.** `bash`, `read`, `write`, `edit`.

## 11. Cline (sub-agent)
Sources: https://docs.cline.bot/customization/clineignore.md , https://docs.cline.bot/cli/cli-reference.md ; repo READMEs `cline/cline/sdk/examples/hooks/README.md` and `.clinerules/hooks/README.md`. The hooks docs page itself is now a stub.

- **a.** Yes, but as executable script files with no JSON registration and no matcher. Code plugins also exist (SDK/CLI only).
- **b.** One file per event in a directory.
  - CLI: `.cline/hooks/`, `~/.cline/hooks/`, or `--hooks-dir` / `CLINE_HOOKS_DIR`.
  - VS Code extension: `.clinerules/hooks/` and `~/Documents/Cline/Hooks/`, "named exactly after their event with no file extension, and need a shebang and the executable bit". Windows: "Not currently supported". Must be enabled in settings.
- **c.** For example `.cline/hooks/PreToolUse.sh` (chmod +x); the script filters on the tool name itself. Timeout is 30 s in the extension and up to 120 s in the CLI. The CLI disables hooks in `--yolo` mode.
- **d.** File names: TaskStart, TaskResume, UserPromptSubmit, PreToolUse, PostToolUse, TaskComplete, TaskError, TaskCancel, SessionShutdown, PreCompact ("not wired for file hooks today").
- **e.** JSON on stdin and stdout, a different contract from Claude Code.
  - Block with `{"cancel": true, "errorMessage": ...}`; the CLI also has `overrideInput`.
  - Exit-code semantics: NOT STATED.
  - The payload differs between CLI (`.tool_call.name`) and extension (`.preToolUse.toolName`).
- **f.** NOT STATED (`workspaceRoots[0]` in the payload).
- **g.** CLI: `run_commands`, `read_files`, `editor` or `apply_patch` (no separate write tool). Extension legacy names: `execute_command`, `read_file`, `write_to_file`, `replace_in_file`.

## 12. Amp (sub-agent)
Sources: https://ampcode.com/docs/markdown/customize/plugins , https://ampcode.com/cli-settings.schema.json

- **a.** Only via code plugins.
- **b.** `.amp/plugins/` (project); `~/.config/amp/plugins/` (user).
- **c.** `amp.on('tool.call', async (event, ctx) => { ...; return { action: 'allow' } })`; you filter in code.
- **d.** Events: `session.start`, `tool.call`, `tool.result`, `agent.start`, `agent.end`, `changes.prompt`. "There is no `session.end` event."
- **e.** In-process return values (`allow`, `reject-and-continue`, `modify`, `synthesize`, `error`).
- **f.** None (`amp.system.workspaceRoot`).
- **g.** `Bash` or `shell_command`; `Read`; `create_file`; `edit_file` / `apply_patch`. No full list in the docs.

## 13. pi (sub-agent)
Source: https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/extensions.md

- **a.** Only via TS extensions.
- **b.** `~/.pi/agent/extensions/`; `.pi/extensions/` (after project trust).
- **c.** `pi.on("tool_call", async (event, ctx) => { if (isToolCallEventType("bash", event) ...) return { block: true, reason } })`.
- **d.** Relevant events: `session_start`, `session_shutdown`, `input`, `before_agent_start`, `tool_call`, `tool_result`, `agent_end`, `agent_settled`, `session_before_compact`, plus many more.
- **e.** In-process.
- **f.** None (`ctx.cwd`).
- **g.** `bash`, `read`, `write`, `edit`.

## 14. Goose (sub-agent)
Source: https://raw.githubusercontent.com/block/goose/main/documentation/docs/guides/context-engineering/hooks.md

- **a.** Yes. "goose follows the Open Plugins hooks specification".
- **b.** Dedicated file per plugin directory: `~/.agents/plugins/<name>/hooks/hooks.json` and `<project>/.agents/plugins/<name>/hooks/hooks.json`. The plugin manifest is optional. Not in `config.yaml`.
- **c.** Verbatim:
  ```json
  { "hooks": { "PreToolUse": [ { "matcher": "^shell$",
      "hooks": [ { "type": "command", "command": "${PLUGIN_ROOT}/scripts/block-sudo.sh", "on_failure": "block" } ] } ] } }
  ```
  - Matcher is a regex; `"*"` is invalid and silently skips the rule.
  - `timeout` in seconds, default 30.
  - `type` is optional.
  - No name/id field.
- **d.** Events: SessionStart, SessionEnd, Stop, UserPromptSubmit, PreToolUse, PreToolUseResult, PostToolUse, PostToolUseFailure, BeforeReadFile, AfterFileEdit, BeforeShellExecution, AfterShellExecution. "`SubagentStart` and `SubagentStop` are not currently emitted". Unknown events are ignored.
- **e.** JSON on stdin; the event key is `event`, not `hook_event_name`.
  - "Exit code `2` — goose blocks and takes the reason from stderr."
  - `{"decision":"block","reason":...}` also blocks.
  - Only PreToolUse and Stop can block.
  - Input rewriting: not documented.
- **f.** `PLUGIN_ROOT`. Project dir: no env var (`working_dir` in the payload).
- **g.** `shell`, `write`, `edit`. Read: NOT STATED (use the `BeforeReadFile` event).

## 15. Zed (sub-agent)
Source: https://github.com/zed-industries/zed/tree/main/docs/src/ai

- **a.** No. Zed has no agent lifecycle hooks; the nearest control is `agent.tool_permissions` regex rules.
- **b–f.** Not applicable.
- **g.** For permissions: `terminal`, `read_file`, `write_file`, `edit_file`.

---

# PART 2 — REMOTE HTTP MCP

## 1. Claude Code
Source: https://code.claude.com/docs/en/mcp

- **a.** In `.mcp.json` (project) or `~/.claude.json` (user/local), verbatim:
  ```json
  { "mcpServers": { "api-server": { "type": "http",
      "url": "${API_BASE_URL:-https://api.example.com}/mcp",
      "headers": { "Authorization": "Bearer ${API_KEY}" } } } }
  ```
  - `type` is required: `"http"`, with `streamable-http` accepted as an alias. "A JSON entry that has a `url` but no `type` is a configuration error."
  - Also `headersHelper` (a command).
- **b.** `${VAR}` and `${VAR:-default}` in `command`, `args`, `env`, `url`, `headers`.
- **c.** "the config still loads: Claude Code reports a missing-variable warning ... and uses the unexpanded `${VAR}` text as-is."
  - Trap: credential-named variables (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK`, `NPM_TOKEN`, `HTTPS_PROXY`, ...) "read as empty" in remote `url` / `headers`, even when set.
- **d.** Yes, on 401/403. Trigger with `/mcp` or `claude mcp login <name>`. Fields: `oauth.clientId`, `oauth.callbackPort`, `oauth.scopes` (space-separated string), `authServerMetadataUrl`. With a configured `Authorization` header there is no OAuth fallback.
- **e.** Yes (http, sse, ws).

## 2. Codex
Sources: https://learn.chatgpt.com/docs/extend/mcp (URL taken from the earlier notes file; the quotes are from the downloaded copy `dl/cx-mcp.md`), and the Codex config reference (copy `dl/cx-config-reference.md`)

- **a.** In `~/.codex/config.toml` (or a trusted project's `.codex/config.toml`), verbatim:
  ```toml
  [mcp_servers.figma]
  url = "https://mcp.figma.com/mcp"
  bearer_token_env_var = "FIGMA_OAUTH_TOKEN"
  http_headers = { "X-Figma-Region" = "us-east-1" }
  ```
  - No type discriminator; `url` implies streamable HTTP.
  - Static header: `http_headers = { "Authorization" = "Bearer ..." }` ("Map of header names to static values").
  - Plugin `.mcp.json` uses `"type": "http"`, `url`, `oauth.clientId`.
- **b.** Header values are literal-only. Dedicated fields instead:
  - `bearer_token_env_var`: "Environment variable name for a bearer token to send in `Authorization`".
  - `env_http_headers`: "Map of header names to environment variable names".
  - `http_headers_helper`: a command.
- **c.** NOT STATED. Only: "If no credential source resolves, Codex can connect to the server without authentication."
- **d.** Yes, but explicit: "Run `codex mcp login <server-name>` separately to start an MCP OAuth login" (`--no-browser`, `--scopes`). Fields: `mcp_servers.<id>.scopes`, `[mcp_servers.<id>.oauth]` with `client_id`, `client_secret`, `callback_port`; `oauth_resource`; global `mcp_oauth_callback_port` and `mcp_oauth_callback_url`.
- **e.** Yes (streamable HTTP).

## 3. Cursor
Sources: https://cursor.com/docs/mcp.md , https://cursor.com/docs/cli/mcp.md

- **a.** In `.cursor/mcp.json` or `~/.cursor/mcp.json`, verbatim:
  ```json
  { "mcpServers": { "remote-server": { "url": "https://api.example.com/mcp",
      "headers": { "Authorization": "Bearer ${env:MY_SERVICE_TOKEN}" } } } }
  ```
  No type discriminator is documented; `url` covers both HTTP and SSE.
- **b.** `${env:NAME}`. "Cursor resolves variables in these fields: `command`, `args`, `env`, `url`, and `headers`." Also `${userHome}` and `${workspaceFolder}`.
- **c.** NOT STATED.
- **d.** Yes (PKCE, dynamic client registration). Trigger from the UI or `agent mcp login <identifier>`. Fields: `auth: { "CLIENT_ID", "CLIENT_SECRET", "scopes": [...] }`.
- **e.** Yes.

## 4. Copilot CLI / VS Code Copilot harness
Sources: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference ; https://github.com/microsoft/vscode-docs/blob/main/docs/agents/reference/mcp-configuration.md ; .../agent-customization/migrate-customizations.md

- **a.** In `~/.copilot/mcp-config.json` (user), or `.mcp.json` / `.github/mcp.json` (workspace, folder must be trusted), verbatim:
  ```json
  { "mcpServers": { "service": { "type": "http", "url": "https://api.example.com/mcp",
      "headers": { "Authorization": "Bearer ${SERVICE_API_KEY}" }, "tools": ["*"] } } }
  ```
  - `type` is required: `"http"` or `"sse"`, with `"streamable-http"` as an alias.
  - `tools` is listed as required.
- **b.** "Use `${NAME}` to reference a value, or `${NAME:-default}` ... HTTP servers can use them in header values." Use the braced form; the VS Code MCP client "treats bare `$NAME` as literal text".
- **c.** NOT STATED.
- **d.** Yes. Trigger with `/mcp auth <server-name>`, or **Authenticate** in VS Code. Flat fields: `oauthClientId`, `oauthScopes`, `oauthPublicClient`, `oauthGrantType`.
- **e.** Yes.
- **VS Code Local-harness editor format** is different: `.vscode/mcp.json`, top-level `servers`, `"type": "http"`, `${input:...}`, nested `oauth.clientId`.

## 5. Gemini CLI
Sources: https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md , .../docs/reference/configuration.md

- **a.** Under `mcpServers` in `.gemini/settings.json` or `~/.gemini/settings.json`, verbatim:
  ```json
  { "mcpServers": { "httpServerWithAuth": { "httpUrl": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer your-api-token" }, "timeout": 5000 } } }
  ```
  No type field; the key name selects the transport: `httpUrl` is streamable HTTP, `url` is SSE.
- **b.** `$VAR_NAME`, `${VAR_NAME}`, `${VAR_NAME:-DEFAULT_VALUE}`, under the general rule "String values within your `settings.json` ... can reference environment variables". The MCP page documents expansion only for the `env` block; a header-specific statement is NOT STATED.
- **c.** For the `env` block: "If a variable is not defined in the current environment, it resolves to an empty string." For headers: NOT STATED.
- **d.** Yes, automatic on 401 with discovery and dynamic registration. Trigger with `/mcp auth <serverName>`. Fields under `oauth`: `enabled`, `clientId`, `clientSecret`, `authorizationUrl`, `tokenUrl`, `scopes` (array), `redirectUri`.
- **e.** Yes.

## 6. OpenCode (sub-agent)
Sources: .../content/mcp-servers.mdx, config.mdx

- **a.** In `opencode.json(c)` (project root, `.opencode/`, `~/.config/opencode/`). V2 verbatim:
  ```jsonc
  { "mcp": { "servers": { "context7": { "type": "remote", "url": "https://mcp.context7.com/mcp",
      "oauth": false, "headers": { "CONTEXT7_API_KEY": "{env:CONTEXT7_API_KEY}" } } } } }
  ```
  - The V1 shape `mcp.<name>` with `enabled` is deprecated in the schema but still read.
  - `type` must be `"remote"`.
- **b.** `{env:NAME}`. "Shell expressions such as `$NAME` are not expanded in JSON strings."
- **c.** "If the environment variable is not set, it will be replaced with an empty string."
- **d.** Yes; "OAuth is enabled for remote servers unless `oauth` is `false`." Trigger with `opencode mcp auth <name>` or `/mcps`. V2 fields: `client_id`, `client_secret`, `scope`, `callback_port`, `redirect_uri` (V1 used camelCase).
- **e.** Yes.

## 7. Factory Droid (sub-agent)
Source: https://docs.factory.com/harness/mcp.md

- **a.** In `~/.factory/mcp.json` or `.factory/mcp.json`:
  ```json
  { "mcpServers": { "context7": { "type": "http", "url": "https://mcp.context7.com/mcp",
      "headers": { "CONTEXT7_API_KEY": "${CONTEXT7_API_KEY}" }, "disabled": false } } }
  ```
  `type` is `"http"` and defaults to stdio if omitted.
- **b.** "Only the `${NAME}` form is supported; there is no default-value syntax." It applies to `env`, `headers`, `oauth.clientId` and `oauth.clientSecret`, but not to `command`, `args` or `url`.
- **c.** "If a referenced variable is unset, the connection to that server fails with an error naming the missing variable."
- **d.** Yes, zero-config. Trigger with `droid mcp auth` or `/mcp`. `oauth` fields: `scopes[]`, `clientId`, `clientSecret`, `authorizationServerIssuer`, `callbackPort`, `resource`; or `oauth: false`.
- **e.** Yes.

## 8. Devin CLI / Windsurf (sub-agent)
Sources: https://docs.devin.ai/cli/extensibility/mcp/configuration.md , https://docs.devin.ai/windsurf/plugins/cascade/mcp.md

- **a.** In `.devin/mcp_config.json`, `.devin/mcp_config.local.json`, `~/.config/devin/mcp_config.json`:
  ```json
  { "mcpServers": { "notion": { "url": "https://mcp.notion.com/mcp", "transport": "http" } } }
  ```
  - The discriminator field is `transport` (`"http"` | `"sse"`), optional; `url` alone implies HTTP.
  - `headers` is an object.
  - Cascade also accepts `serverUrl`.
  - Legacy editor file: `~/.codeium/windsurf/mcp_config.json`.
- **b.** `${env:VAR}` (and `${file:/path}`). Explicit for headers only on the Cascade page ("interpolation of environment variables in these fields: `command`, `args`, `env`, `serverUrl`, `url`, and `headers`"); the Devin CLI page states it only for OAuth fields.
- **c.** NOT STATED.
- **d.** Yes. Trigger with `devin mcp login <server-name>`, or the automatic prompt on first use. Fields: `oauthClientId`, `oauthClientSecret`, `oauthResource`, `oauthScopes[]`.
- **e.** Yes.

## 9. Qwen Code (sub-agent)
Source: .../docs/users/features/mcp.md, .../configuration/settings.md

- **a.** Same shape as Gemini: `mcpServers.<n>.httpUrl` + `headers` in `.qwen/settings.json` or `~/.qwen/settings.json`. No type field. Project servers need `qwen mcp approve <name>`.
- **b.** `$VAR_NAME` or `${VAR_NAME}` under the general settings rule; a header-specific statement is NOT STATED.
- **c.** NOT STATED.
- **d.** Yes. Trigger from the `/mcp` dialog. `oauth` fields: `enabled`, `clientId`, `clientSecret`, `scopes[]`, `redirectUri`.
- **e.** Yes.

## 10. Kilo Code (sub-agent)
Sources: kilo.ai/docs (`/automate/mcp/using-in-cli`), schema app.kilo.ai/config.json

- **a.** In `~/.config/kilo/kilo.json`, `./kilo.json`, `./.kilo/kilo.json`:
  ```json
  { "mcp": { "my-remote-server": { "type": "remote", "url": "https://my-mcp-server.com/mcp",
      "enabled": true, "headers": { "Authorization": "Bearer MY_API_KEY" } } } }
  ```
  The schema marks this shape deprecated in favour of `mcp.servers.<name>`; the docs only describe the old shape.
- **b.** `{env:VARIABLE_NAME}`, but "A project-level `kilo.json` ... **cannot** use `{env:VAR}` — the reference is ignored and a warning is logged." It works only in global config.
- **c.** NOT STATED for trusted config.
- **d.** Yes, automatic. Trigger with `kilo mcp auth [name]`. `oauth` fields (schema): `clientId`, `clientSecret`, `scope`, `callbackPort`; or `false`.
- **e.** Yes.

## 11. Cline (sub-agent)
Source: https://docs.cline.bot/mcp/mcp-overview.md

- **a.** In `~/.cline/data/settings/cline_mcp_settings.json` (CLI; `CLINE_MCP_SETTINGS_PATH` overrides). Global only; a project file is NOT STATED.
  ```json
  { "mcpServers": { "remote-server": { "type": "streamableHttp", "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer your-token" }, "disabled": false, "autoApprove": [] } } }
  ```
  "Omitting it defaults to the legacy `sse` transport".
- **b.** NOT STATED; treat as literal-only.
- **c.** NOT STATED.
- **d.** Yes, explicit: the `cline mcp` wizard has "Authorize OAuth". Config fields: NOT STATED.
- **e.** Yes.

## 12. Amp (sub-agent)
Source: https://ampcode.com/docs/markdown/customize/mcp

- **a.** In `~/.config/amp/settings.json` or `.amp/settings.json` (workspace entries need `amp mcp approve`):
  ```json
  "amp.mcpServers": { "sourcegraph": { "url": "${SRC_ENDPOINT}/.api/mcp/v1",
      "headers": { "Authorization": "token ${SRC_ACCESS_TOKEN}" } } }
  ```
  No discriminator.
- **b.** `${VAR_NAME}`.
- **c.** NOT STATED.
- **d.** Yes, automatic at TUI start. Manual: `amp mcp oauth login <server> --server-url ... --client-id ... --scopes ...`. No config fields.
- **e.** Yes.

## 13. pi (sub-agent)
Source: .../packages/coding-agent/docs/mcp.md

- **a.** In `~/.pi/agent/mcp.json` or `.pi/mcp.json` (after project trust):
  ```json
  { "mcpServers": { "docs": { "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" } } } }
  ```
  `type` is optional; "When present, `type` must be `stdio`, `http`, or `streamable-http`." "`sse` is rejected."
- **b.** `${VAR}`; or `!command` as the whole value. CLI: `--bearer-token-env-var`.
- **c.** NOT STATED.
- **d.** Yes; "OAuth applies to HTTP servers without an `Authorization` header." Trigger with `/mcp login <name>` or `pi mcp login <name>`. `oauth` fields: `clientId`, `clientSecret`, `callbackPort`, `scope`, `clientRegistration`.
- **e.** Yes (streamable HTTP only).

## 14. Goose (sub-agent)
Source: .../documentation/docs/guides/config-files.md

- **a.** In `~/.config/goose/config.yaml` under `extensions:`. A project file is NOT STATED.
  ```yaml
    remote-tools:
      type: streamable_http
      name: remote-tools
      enabled: true
      uri: "https://example.com/mcp"
      headers: {}
      env_keys: []
      envs: {}
      timeout: 300
  ```
  The URL field is `uri`. "SSE is not supported".
- **b.** NOT STATED in the docs. Source tests show `headers: {Authorization: "Bearer $MY_SECRET"}` with `env_keys: ["MY_SECRET"]` (source, not docs).
- **c.** NOT STATED for headers.
- **d.** Yes (CIMD / dynamic registration). Fields: `client_id`, `client_secret_key`, `scopes`. User trigger: NOT STATED.
- **e.** Yes (streamable HTTP only).

## 15. Zed (sub-agent)
Source: https://github.com/zed-industries/zed/blob/main/docs/src/ai/mcp.md

- **a.** Under `context_servers` in `~/.config/zed/settings.json` or `.zed/settings.json` (trust-gated):
  ```json
  { "context_servers": { "remote-mcp-server": { "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer <token>" } } } }
  ```
  No discriminator.
- **b.** NOT STATED; treat as literal.
- **c.** Not applicable.
- **d.** Yes, automatic: "When a remote MCP server has no configured `"Authorization"` header, Zed will prompt you to authenticate". UI only; no config fields.
- **e.** Yes.

---

# SUMMARY TABLE (i) — canonical event to harness event

Only harnesses with declarative command hooks. `≈` marks my or a sub-agent's nearest-match reading, not a docs mapping.

| Canonical | Claude | Codex | Cursor | Copilot (camel / Pascal) | Gemini | Factory | Devin | Qwen | Goose | Cline (file name) |
|---|---|---|---|---|---|---|---|---|---|---|
| SessionStart | SessionStart | SessionStart | sessionStart | sessionStart / SessionStart | SessionStart | SessionStart | SessionStart | SessionStart | SessionStart | ≈TaskStart, TaskResume |
| SessionEnd | SessionEnd | SessionEnd | sessionEnd | sessionEnd / SessionEnd | SessionEnd | SessionEnd | SessionEnd | SessionEnd | SessionEnd | ≈SessionShutdown (CLI) |
| UserPromptSubmit | UserPromptSubmit | UserPromptSubmit | beforeSubmitPrompt | userPromptSubmitted / UserPromptSubmit | ≈BeforeAgent | UserPromptSubmit | UserPromptSubmit | UserPromptSubmit | UserPromptSubmit (observe only) | UserPromptSubmit |
| PreToolUse | PreToolUse | PreToolUse | preToolUse (+ beforeShellExecution, beforeReadFile, beforeMCPExecution) | preToolUse / PreToolUse | BeforeTool | PreToolUse | PreToolUse | PreToolUse | PreToolUse | PreToolUse |
| PostToolUse | PostToolUse | PostToolUse | postToolUse (+ afterShellExecution, afterFileEdit) | postToolUse / PostToolUse | AfterTool | PostToolUse | PostToolUse | PostToolUse | PostToolUse | PostToolUse |
| Stop | Stop | Stop | stop | agentStop / Stop | ≈AfterAgent | Stop | Stop | Stop | Stop | ≈TaskComplete |
| SubagentStop | SubagentStop | SubagentStop | subagentStop | subagentStop / SubagentStop | NONE | SubagentStop | NONE | SubagentStop | NONE | NONE |
| PreCompact | PreCompact | PreCompact | preCompact | preCompact / PreCompact | PreCompress | PreCompact | NONE (PostCompaction only) | PreCompact | NONE | NONE (not wired) |
| Notification | Notification | NONE | NONE | notification (CLI only) | Notification | Notification | NONE | Notification | NONE | NONE |

Code-plugin harnesses (no declarative hooks), using `≈` nearest equivalents:

| Canonical | OpenCode V1 / V2 | Kilo | Amp | pi |
|---|---|---|---|---|
| SessionStart | `session.created` / NONE | `session.created` | `session.start` | `session_start` |
| SessionEnd | NONE | NONE | NONE | `session_shutdown` |
| UserPromptSubmit | `chat.message` / `session.hook("prompt")` | `chat.message` | `agent.start` | `input` |
| PreToolUse | `tool.execute.before` / `tool.hook("execute.before")` | `tool.execute.before` | `tool.call` | `tool_call` |
| PostToolUse | `tool.execute.after` / `tool.hook("execute.after")` | `tool.execute.after` | `tool.result` | `tool_result` |
| Stop | `session.idle` / NONE | `session.idle` | `agent.end` | `agent_end` / `agent_settled` |
| SubagentStop | NONE | NONE | NONE | NONE |
| PreCompact | `experimental.session.compacting` / `session.hook("compaction")` | `experimental.session.compacting` | NONE | `session_before_compact` |
| Notification | NONE | NONE | NONE | NONE |

Zed: NONE for every event.

Hook mechanics at a glance:

| Harness | Location | Entry shape | Timeout unit | Shell tool name | Project-dir env var |
|---|---|---|---|---|---|
| Claude | `settings.json` → `hooks` | nested group (`matcher` + `hooks[]`) | s | `Bash` | `CLAUDE_PROJECT_DIR` |
| Codex | `hooks.json` or `[hooks]` in config.toml | nested group | s | `Bash` | NOT STATED |
| Cursor | `.cursor/hooks.json` (`version: 1`) | flat entry | s | `Shell` | `CURSOR_PROJECT_DIR`, `CLAUDE_PROJECT_DIR` |
| Copilot | `.github/hooks/*.json`, `~/.copilot/hooks/*.json` (`version: 1`) | flat entry | s (`timeoutSec`) | `bash` (`Bash` with Pascal events) | NOT STATED |
| Gemini | `settings.json` → `hooks` | nested group | **ms** | `run_shell_command` | `GEMINI_PROJECT_DIR`, `CLAUDE_PROJECT_DIR` |
| Factory | `.factory/hooks.json` (no wrapper) or `settings.json` → `hooks` | nested group | s | `Execute` (alias `Bash`) | `FACTORY_PROJECT_DIR`, `CLAUDE_PROJECT_DIR` (cwd) |
| Devin | `.devin/hooks.v1.json` (no wrapper) or `config.json` → `hooks` | nested group | s | `exec` | `DEVIN_PROJECT_DIR` |
| Qwen | `settings.json` → `hooks` | nested group | s (≥1000 read as ms) | `run_shell_command` (alias `Bash`) | `QWEN_PROJECT_DIR`, `CLAUDE_PROJECT_DIR` |
| Goose | `.agents/plugins/<n>/hooks/hooks.json` | nested group | s | `shell` | none (`PLUGIN_ROOT` only) |
| Cline | script file per event in `.cline/hooks/` | none | n/a | `run_commands` | NOT STATED |

# SUMMARY TABLE (ii) — HTTP MCP entry, env reference, OAuth

| Harness | File (project / user) | Root key | URL field | Discriminator | Header env syntax | Unset variable | OAuth and trigger |
|---|---|---|---|---|---|---|---|
| Claude Code | `.mcp.json` / `~/.claude.json` | `mcpServers` | `url` | `"type": "http"` (required) | `${VAR}`, `${VAR:-def}` | literal `${VAR}` kept, plus warning | yes; `/mcp`, `claude mcp login` |
| Codex | `.codex/config.toml` / `~/.codex/config.toml` | `[mcp_servers.<id>]` | `url` | none | literal only; use `bearer_token_env_var`, `env_http_headers` | NOT STATED | yes; `codex mcp login` |
| Cursor | `.cursor/mcp.json` / `~/.cursor/mcp.json` | `mcpServers` | `url` | none | `${env:VAR}` | NOT STATED | yes; UI, `agent mcp login` |
| Copilot | `.mcp.json`, `.github/mcp.json` / `~/.copilot/mcp-config.json` | `mcpServers` | `url` | `"type": "http"` (required; + `tools`) | `${VAR}`, `${VAR:-def}` | NOT STATED | yes; `/mcp auth` |
| Gemini | `.gemini/settings.json` / `~/.gemini/settings.json` | `mcpServers` | `httpUrl` | none (key name) | `$VAR`, `${VAR}`, `${VAR:-def}` (general rule) | empty string (stated for `env`) | yes; `/mcp auth` |
| OpenCode | `opencode.json` / `~/.config/opencode/opencode.json` | `mcp.servers` (V2), `mcp` (V1) | `url` | `"type": "remote"` | `{env:VAR}` | empty string | yes; `opencode mcp auth` |
| Factory | `.factory/mcp.json` / `~/.factory/mcp.json` | `mcpServers` | `url` | `"type": "http"` | `${VAR}` only | connection fails, names the variable | yes; `droid mcp auth` |
| Devin | `.devin/mcp_config.json` / `~/.config/devin/mcp_config.json` | `mcpServers` | `url` (`serverUrl`) | `"transport": "http"` (optional) | `${env:VAR}` | NOT STATED | yes; `devin mcp login` |
| Qwen | `.qwen/settings.json` / `~/.qwen/settings.json` | `mcpServers` | `httpUrl` | none (key name) | `$VAR`, `${VAR}` (general rule) | NOT STATED | yes; `/mcp` dialog |
| Kilo | `kilo.json` / `~/.config/kilo/kilo.json` | `mcp` (schema: `mcp.servers`) | `url` | `"type": "remote"` | `{env:VAR}`, global config only | NOT STATED | yes; `kilo mcp auth` |
| Cline | none / `~/.cline/data/settings/cline_mcp_settings.json` | `mcpServers` | `url` | `"type": "streamableHttp"` | NOT STATED (literal) | NOT STATED | yes; `cline mcp` wizard |
| Amp | `.amp/settings.json` / `~/.config/amp/settings.json` | `amp.mcpServers` | `url` | none | `${VAR}` | NOT STATED | yes; automatic, `amp mcp oauth login` |
| pi | `.pi/mcp.json` / `~/.pi/agent/mcp.json` | `mcpServers` | `url` | optional `"type": "http"` | `${VAR}`, `!command` | NOT STATED | yes; `pi mcp login` |
| Goose | NOT STATED / `~/.config/goose/config.yaml` | `extensions` | `uri` | `type: streamable_http` | NOT STATED in docs | NOT STATED | yes; trigger NOT STATED |
| Zed | `.zed/settings.json` / `~/.config/zed/settings.json` | `context_servers` | `url` | none | NOT STATED (literal) | n/a | yes; UI prompt |

All 15 can run remote MCP; none is stdio-only.
