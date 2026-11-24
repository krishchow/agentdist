import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { defineHarness, type LocCtx, type PlanCtx } from "../harness/define";
import { dialect, noToolGrants, proseSkillRef } from "../harness/dialect";
import { configRootExists, inConfig, xdgConfig } from "../harness/locations";
import type { McpServerNode } from "../ir/nodes";
import { markdownAgents } from "../surfaces/agents";
import { markdownCommands } from "../surfaces/commands";
import { compactEntry, mcpConfig } from "../surfaces/mcp";
import { AGENTS_SKILLS, CLAUDE_SKILLS } from "../surfaces/shared";
import { skillsDir } from "../surfaces/skills";

/** `<dir>/<base>.jsonc` if the user keeps one, otherwise `<dir>/<base>.json`. */
export function jsonOrJsonc(dir: string, base: string): string {
  const jsonc = join(dir, `${base}.jsonc`);
  return existsSync(jsonc) ? jsonc : join(dir, `${base}.json`);
}

/** The OpenCode family starts a server from one array, and adds `environment` to its own. */
export function opencodeEntry(extra: Record<string, boolean> = {}) {
  return (server: McpServerNode) =>
    compactEntry({
      type: "local",
      command: [server.command, ...server.args],
      environment: server.env,
      ...extra,
    });
}

/**
 * OpenCode's config has two dialects: servers directly under `mcp`, and, since V2, under
 * `mcp.servers`. The file on disk decides; a file with no servers yet gets the current one.
 */
function mcpKeyPath(file: string, _ctx: PlanCtx): string[] {
  try {
    const mcp = parse(readFileSync(file, "utf8"))?.mcp;
    const flat = Object.entries(mcp ?? {}).some(
      ([key, value]) => key !== "servers" && typeof (value as { type?: unknown })?.type === "string",
    );
    if (flat && !mcp.servers) return ["mcp"];
  } catch {
    // No file yet, or one the executor will refuse to edit.
  }
  return ["mcp", "servers"];
}

const home = xdgConfig("opencode", "OPENCODE_CONFIG_DIR");

export const opencode = defineHarness({
  id: "opencode",
  label: "OpenCode",
  configRoot: { user: home, local: ".opencode" },
  detect: configRootExists(home),
  // Subagents take permission rules rather than a tool list, and skills are loaded by the model.
  dialect: dialect({
    toolRef: (server, tool) => `${server}_${tool}`,
    skillRef: proseSkillRef,
    ...noToolGrants,
  }),
  kinds: {
    skill: skillsDir(AGENTS_SKILLS, { alsoReads: [CLAUDE_SKILLS] }),
    agent: markdownAgents(
      { user: inConfig("agents"), local: inConfig("agents") },
      // An agent file defaults to a primary agent; a package ships subagents.
      { frontmatter: ({ description }) => ({ description, mode: "subagent" }) },
    ),
    command: markdownCommands(
      { user: inConfig("commands"), local: inConfig("commands") },
      { frontmatter: ({ description }) => ({ description }) },
    ),
    mcpServer: mcpConfig({
      file: {
        user: ({ configRoot }: LocCtx) => jsonOrJsonc(configRoot, "opencode"),
        local: ({ env }: LocCtx) => jsonOrJsonc(env.projectRoot, "opencode"),
      },
      format: "jsonc",
      keyPath: mcpKeyPath,
      entry: opencodeEntry(),
    }),
  },
  sources: [
    "https://opencode.ai/docs/mcp-servers/",
    "https://opencode.ai/docs/config/",
    "https://opencode.ai/docs/skills/",
    "https://opencode.ai/docs/agents/",
    "https://opencode.ai/docs/commands/",
  ],
});
