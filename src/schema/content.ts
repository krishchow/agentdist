import { z } from "zod";

/**
 * Frontmatter of the canonical content files. The canonical dialect is the Claude Code one, since
 * it is the format most packages are already written in. Unknown keys are kept and passed through
 * to harnesses whose dialect does not drop them.
 */

const toolList = z.union([z.string(), z.array(z.string())]).transform((v) =>
  (Array.isArray(v) ? v : v.split(","))
    .map((s) => s.trim())
    .filter(Boolean),
);

export const SkillFrontmatter = z.looseObject({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  license: z.string().optional(),
  "allowed-tools": toolList.optional(),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatter>;

export const AgentFrontmatter = z.looseObject({
  name: z.string().min(1),
  description: z.string().min(1),
  tools: toolList.optional(),
  model: z.string().optional(),
});
export type AgentFrontmatter = z.infer<typeof AgentFrontmatter>;

export const CommandFrontmatter = z.looseObject({
  description: z.string().optional(),
  "argument-hint": z.string().optional(),
  "allowed-tools": toolList.optional(),
  model: z.string().optional(),
});
export type CommandFrontmatter = z.infer<typeof CommandFrontmatter>;
