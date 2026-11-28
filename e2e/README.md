# End-to-end tests

The unit tests check that agentdist writes the right files. These check that the harnesses read
them: a Docker image with every supported harness installed, a probe package with one of
everything, and a runner that installs the package into each harness at each scope and asks the
harness, not the filesystem, what it loaded.

```bash
pnpm e2e                                   # every harness, both scopes
pnpm e2e --harness claude,codex --scope local
E2E_REBUILD=1 pnpm e2e                     # rebuild the image from scratch
```

It needs Docker (OrbStack works). The first build downloads every harness and takes a while; after
that, a run uses the repository as mounted, so changes to agentdist, the probe package or the
runner need no rebuild. Results land in `e2e/results/`: `report.md`, `results.json`, and a
transcript per harness and scope with every command the runner ran and what it printed.

The container has no network (`--network none`), so nothing can reach a real model or account. No
API keys are needed or used.

## How a harness proves it loaded something

No real model is involved. Each harness is pointed at a **mock model server** that records every
request and answers with a script. What a harness sends to its model is the most direct evidence of
what it loaded: the skills, subagents and MCP tools it knows about are all in the system prompt or
the tools list. Every artifact in the probe package carries a unique canary string, so a check is a
substring search:

| Artifact           | Evidence                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| skill              | `PROBE_SKILL_BEACON_DESC` (its description) in a model request; its name in the harness's own skill listing                                                                                                                                                                                                                               |
| subagent           | `PROBE_AGENT_SCOUT_DESC` in a model request; its name in the harness's agent listing                                                                                                                                                                                                                                                      |
| command            | `/probe-signal PROBEARG` sent as a prompt reaches the model as `PROBE_COMMAND_SIGNAL_BODY with PROBEARG.` (body expanded, argument substituted)                                                                                                                                                                                           |
| MCP server (stdio) | the server's own log shows a session started it and listed its tools, with the manifest's `env` and the `envPassthrough` variable set; its tool's description (or, for a harness that sends only names, the name `stdio_listed`, which no probe file mentions) reaches the model                                                          |
| MCP server (HTTP)  | the server's log shows a session reached `/mcp` with `Authorization: Bearer <the value of PROBE_HTTP_TOKEN>`, which proves `{{env:…}}` was resolved, and the literal `X-Client` header; its tool reaches the model                                                                                                                        |
| hook               | the hook script appends the event and its stdin to a log. The mock answers the first turn with a call to the harness's shell tool, so `PreToolUse` and `PostToolUse` have something to fire on. The payload must be JSON naming the event in the harness's spelling, and a tool hook must have fired for the shell tool its matcher names |

Two checks belong to the cell rather than one artifact:

- **round trip**: install, install again, uninstall, all before the harness first runs. The second
  install must report nothing but `unchanged` and change no file; the uninstall must leave the
  home and repository byte for byte as the setup left them, the user's own config included.
- **tool names**: the installed skill says `Call {{tool:probe.stdio_canary}}` in the harness's
  dialect. The name it renders must be one the harness offered the model (or, written in prose,
  the end of one).

Evidence counts only from the phase it belongs to. An MCP server a listing command started does
not stand in for a session that never loaded it, and a hook or MCP server that recorded a
working directory or home outside the cell is ignored.

The probe servers are in `servers/`:

- `mock-llm.mjs` speaks Anthropic Messages, OpenAI Chat Completions, OpenAI Responses and Gemini,
  streaming and not.
- `mock-rpc.mjs` stands in for Cursor's and Devin's backends, which are protobuf RPC rather than
  model APIs. It answers just enough for a session to send its context and records the readable
  strings in every request. It never produces a model turn, so those sessions time out by design,
  and only session-start hooks can be checked.
- `mcp-probe.mjs` is a stdio or Streamable HTTP MCP server that logs every call.

## Reading the report

Each artifact in each cell (one harness at one scope) gets one verdict:

|               |                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------- |
| ✅ pass       | a check saw it and none contradicted it                                                     |
| ❌ fail       | a check that should have seen it did not                                                    |
| ❔ unverified | nothing in this cell could tell, e.g. a tool hook in a harness whose mock cannot call tools |
| `·` skipped   | agentdist says the harness cannot take it, so there is nothing to check                     |
| ⚠️ xfail      | a known failure, recorded in the harness's adapter, failing exactly the way it records      |
| ❗ xpass      | a known entry that is stale: the artifact passed, or could no longer be checked             |

What must load is whatever `agentdist install --json` did not skip, so the expected results come
from the engine itself; there is no second list to keep in sync. A run exits 1 on any ❌ or ❗, or a
cell that broke (🛑, such as a session that never reached the mock), and 2 when the runner itself
broke. The report is rewritten after every cell, so a broken run keeps what it finished.

**Consent.** Several harnesses load a project's config only after the user approves it once
(trusting a folder, approving a project MCP server, acknowledging a subagent). The runner gives
that approval the way the harness documents it and lists each step in the report, whether it is a
file the runner writes or a flag it passes on every run, so a step agentdist does not tell the user
about is visible.

## The harnesses

| Harness        | Model under test                                | Model-free checks                                       | Can check tool hooks |
| -------------- | ----------------------------------------------- | ------------------------------------------------------- | -------------------- |
| Claude Code    | `ANTHROPIC_BASE_URL`                            | stream-json `init` event                                | yes                  |
| Codex          | custom `model_providers` entry (Responses API)  | `codex debug prompt-input`, `mcp list`                  | yes                  |
| Gemini CLI     | `GOOGLE_GEMINI_BASE_URL`                        | `skills list`, `mcp list`                               | yes                  |
| Qwen Code      | `OPENAI_BASE_URL`                               | `mcp list`                                              | yes                  |
| OpenCode, Kilo | an `@ai-sdk/openai-compatible` provider         | `debug skill`, `agent list`, `debug config`, `mcp list` | no hooks             |
| GitHub Copilot | `COPILOT_PROVIDER_BASE_URL` (BYOK)              | `skill list`, `mcp list`                                | yes                  |
| Factory Droid  | `customModels` in settings.json                 | `mcp list`                                              | yes                  |
| pi             | a provider in `models.json`                     | RPC `get_commands`, `mcp list`                          | no hooks             |
| Goose          | `OPENAI_HOST`                                   | `skills list`                                           | yes                  |
| Cline          | `cline auth` with an OpenAI-compatible base URL | `config --json`                                         | no hooks             |
| Cursor         | its backend, through `mock-rpc`                 | `mcp list`                                              | session start only   |
| Devin          | its backend, through `mock-rpc`                 | `skills list`, `doctor`, `mcp list`                     | session start only   |
| Amp            | none: inference runs on Amp's servers           | `skill list`, `tools list`                              | no hooks             |
| Zed            | its OpenAI provider, driven under Xvfb          | none                                                    | no hooks             |

Each adapter in `runner/harnesses/` says how, with the reason for every flag and file it uses.
Adding a harness to agentdist means adding an adapter here: point the harness at a mock, give the
consent a user would, and name the harness's own commands that list what it loaded.

## Not checked yet

An adversarial review of this harness listed what agentdist promises that no cell checks yet.
Several of these were reproduced by hand in the image and are real bugs today:

| Gap                                                                                                    | What it would take                                                                                        | Found by hand                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installing several harnesses at once (the planner merges and shares files)                             | a `--with claude` axis that installs `claude,<id>`, plus a check that no hook fires twice per session     | Copilot also reads `.claude/settings.json`, so with Claude installed every Copilot hook fires twice; OpenCode, Goose and Amp then load the Claude-dialect copy of a skill |
| Relocated homes (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`, ...)                            | an adapter `relocate(cell)` and a third scope                                                             | with `GEMINI_CLI_HOME` set, skills go to `~/.agents/skills`, which Gemini then does not read                                                                              |
| Starting a harness in a subdirectory of the project                                                    | run the local sessions from `repo/sub` too                                                                | Goose finds no project hooks or skills, and Claude and Factory fire no project hooks; whether agentdist or the harness should change is open                              |
| A skill's body, `{{skill:…}}` invocation and `{{skill_dir}}` script                                    | a session that invokes the skill and has the mock run the script the body names; `skill.jsonl` records it |                                                                                                                                                                           |
| Calling an MCP tool, and a tool hook not matching other tools                                          | the mock calls each probe tool after the shell; `tools/call` in the server log                            |                                                                                                                                                                           |
| A hook exiting 2 blocks the tool                                                                       | a block mode in `record.mjs` and a trace file the shell call writes                                       |                                                                                                                                                                           |
| A subagent's body and tool grants                                                                      | the mock delegates to `probe-scout`; check the delegated request's system prompt and tools                |                                                                                                                                                                           |
| Artifacts agentdist skips that a harness might take after all (Zed project MCP, Kilo project `{env:}`) | write the entry by hand and report whether it loads, as information                                       |                                                                                                                                                                           |
