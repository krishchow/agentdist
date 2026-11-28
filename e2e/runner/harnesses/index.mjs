/**
 * How the runner drives each harness. An adapter never decides whether an artifact passed; it says
 * how to point the harness at the probe servers, what a user would approve once, and which of the
 * harness's own commands show what it loaded. The runner reads the evidence.
 *
 *   id             the agentdist harness id
 *   version        argv that prints the harness's version
 *   mock           "llm" (mock-llm.mjs, a model API), "rpc" (mock-rpc.mjs, a vendor backend), or
 *                  nothing when no session can run offline
 *   env(cell)      extra environment for everything run in the cell
 *   setup(cell)    before the install: the user's own config, such as the model provider
 *   consent(cell)  after the install: what a user approves once (trust a folder, approve a server)
 *   introspect(cell, ctx)  model-free checks; ctx.run(argv) runs in the cell, ctx.evidence collects
 *   session(cell, prompt)  argv for one headless session
 *   drive(cell, ctx, prompt)  instead of session, for a harness with no headless mode
 *   reachedModel(record)   whether a recorded request is a model turn (default: every request)
 *   listed         kinds whose canary the session's model request should carry
 *   markers        node → the string that stands for it in the request, when the canary is not sent
 *   toolCall       let the mock call the shell tool, which tool hooks need (default true)
 *   mcpHandshake   the server call that proves an MCP server loaded (default "tools/list")
 *   hookEvents     canonical events a session can make fire
 *   command(cell, name, arg)  argv to invoke a slash command (default: a session with "/name arg")
 *   consentFlags   consent given by a flag or variable on every run: { text, kinds?, scope? }.
 *                  Each one, like each ctx.note(text, kinds) a consent step makes, must be covered
 *                  by a next step agentdist printed for those kinds, or the cell's notes check fails
 *   known          `${scope}/${node}` → { because, detail }: a failure that is understood and
 *                  tracked. It is an xfail only while every failing check matches `detail`
 *   leftovers      a `pkill -f` pattern for what the harness leaves running after a cell
 */
import { amp } from "./amp.mjs";
import { claude } from "./claude.mjs";
import { cline } from "./cline.mjs";
import { codex } from "./codex.mjs";
import { copilot } from "./copilot.mjs";
import { cursor } from "./cursor.mjs";
import { devin } from "./devin.mjs";
import { factory } from "./factory.mjs";
import { gemini } from "./gemini.mjs";
import { goose } from "./goose.mjs";
import { kilo } from "./kilo.mjs";
import { opencode } from "./opencode.mjs";
import { pi } from "./pi.mjs";
import { qwen } from "./qwen.mjs";
import { zed } from "./zed.mjs";

export const ADAPTERS = [
  claude,
  codex,
  cursor,
  copilot,
  gemini,
  opencode,
  factory,
  devin,
  cline,
  kilo,
  qwen,
  amp,
  pi,
  goose,
  zed,
];
