import type { Dialect } from "./define";

/** The canonical built-in tool names. Content and tool grants are written with these. */
export const CANONICAL_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
  "TodoWrite",
  "NotebookEdit",
] as const;

const identityTools: Record<string, string | null> = Object.fromEntries(CANONICAL_TOOLS.map((t) => [t, t]));

/**
 * The canonical dialect, which is Claude Code's. A harness starts from it and overrides only what
 * it spells differently.
 */
export const canonicalDialect: Dialect = {
  toolRef: (server, tool) => `mcp__${server}__${tool}`,
  skillRef: (name) => `/${name}`,
  agentRef: (name) => `\`${name}\``,
  commandRef: (name) => `/${name}`,
  tools: identityTools,
  mcpGrant: (server, tool) => (tool === "*" ? `mcp__${server}` : `mcp__${server}__${tool}`),
};

export function dialect(
  overrides: Partial<Dialect> & { tools?: Record<string, string | null> } = {},
): Dialect {
  return { ...canonicalDialect, ...overrides, tools: { ...identityTools, ...overrides.tools } };
}

/**
 * For harnesses that give the model no fixed MCP tool identifier to write, or whose identifier is
 * not documented: name the tool and its server in prose, which every model resolves.
 */
export const proseToolRef = (server: string, tool: string): string => `\`${tool}\` (${server} MCP tool)`;

/** For harnesses where a skill is not invoked by a typed command. */
export const proseSkillRef = (name: string): string => `the \`${name}\` skill`;

/** For harnesses whose subagents take no tool list, or whose tool names are not documented. */
export const noToolGrants: Pick<Dialect, "tools" | "mcpGrant" | "quietGrants"> = {
  tools: Object.fromEntries(CANONICAL_TOOLS.map((t) => [t, null])),
  mcpGrant: () => null,
  quietGrants: true,
};

/**
 * The dialect for content in a directory several harnesses read. No single harness's identifiers
 * can be right for all of them, so references are written the way every model understands.
 */
export const portableDialect: Dialect = dialect({ toolRef: proseToolRef, skillRef: proseSkillRef });
