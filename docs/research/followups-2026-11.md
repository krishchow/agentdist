<!-- Gathered 2026-11-27 by a research agent from vendor documentation only (no harness was run), then checked against the e2e harness where noted. -->

# Follow-ups from the end-to-end harness (November 2026)

The e2e harness (`e2e/`) raised questions that a documentation pass then tried to answer. Every
item below says whether it is documentation only or was observed in the e2e image.

| Question | Finding | Evidence |
|---|---|---|
| Qwen command arguments | Markdown commands take `{{args}}` at user and project scope; without a placeholder the arguments are appended after two line breaks, and a project command wins over a user one of the same name. | Docs ([commands](https://qwenlm.github.io/qwen-code-docs/en/users/features/commands/)); `{{args}}` observed working in Qwen 0.28.4 |
| Cursor user-level subagents | `~/.cursor/agents/` is read by the editor and self-hosted workers only; the CLI reads project `.cursor/agents/`. | Docs ([subagents](https://cursor.com/docs/subagents)); observed in CLI 2026.11.22 |
| Cursor running Claude Code hooks | Documented, from `.claude/settings.local.json`, `.claude/settings.json` and `~/.claude/settings.json`, only while "Include Third-Party Plugins, Skills, and Other Configs" is on. The CLI changelog (2026-10-17) mentions Claude `PostToolUse` matchers working. | Docs ([third-party hooks](https://cursor.com/docs/reference/third-party-hooks)) |
| Cursor MCP environment | `${env:NAME}` is documented in `command`, `args`, `env`, `url` and `headers`. | Docs ([MCP](https://cursor.com/docs/mcp)). Observed: the CLI starts stdio servers with little more than PATH, and an unset `${env:NAME}` reaches the server as literal text; the undocumented `${NAME:-}` gives an empty value, so agentdist writes that |
| Devin slash commands | The CLI's reusable slash commands are skills: `.devin/skills/<name>/SKILL.md` and `~/.config/devin/skills/<name>/SKILL.md`. `devin migrate workflows` converts workflow files into skills and removes the originals. Whether Devin Desktop still reads `.devin/workflows` is not stated. | Docs ([creating skills](https://docs.devin.ai/cli/extensibility/skills/creating-skills), [commands](https://docs.devin.ai/cli/reference/commands)); observed: CLI 3000.14 answers `/name` for a workflow with "Unknown command" |
| Devin reading other harnesses | Devin documents running `~/.claude/settings.json` hooks (project and global), and importing Claude, Copilot and Codex skills. Imported Copilot global skills honour `COPILOT_HOME`; imported Codex global skills are always read from `~/.codex/skills/`, whatever `CODEX_HOME` says. | Docs ([hooks](https://docs.devin.ai/cli/extensibility/hooks/overview), [read config from](https://docs.devin.ai/cli/reference/configuration/read-config-from)) |
| Cursor and Devin consent | Cursor: `agent mcp enable <name>` approves a project server, `--approve-mcps` skips the prompt. Devin: `--print` fails in an untrusted directory unless `--respect-workspace-trust false`. | Docs ([Cursor CLI MCP](https://cursor.com/docs/cli/mcp), [Devin commands](https://docs.devin.ai/cli/reference/commands)); both observed in the e2e image |
| Cline workflow arguments | No documented placeholder. Observed in Cline 3.0.75: `$ARGUMENTS` reaches the model literally and the arguments are appended after the body. | Observed only |

Not answered by documentation, and measured with the e2e image instead: which other harnesses'
files each harness loads and what it does with a duplicate, which artifacts follow a relocated
config home, and the full matrix of one-time approvals.
