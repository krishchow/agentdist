import { join } from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import type { Handler, PlanCtx, ScopedLoc } from "../harness/define";
import { renderDoc } from "../ir/markdown";
import type { AgentNode } from "../ir/nodes";
import { frontmatter, pipe, resolveRefs } from "../transforms/doc";
import { mapToolGrants } from "../transforms/tools";

export interface MarkdownAgentsOptions {
  /** File extension including the dot. Copilot uses `.agent.md`. */
  ext?: string;
  /** A harness that wants `<dir>/<name>/<file>` instead of `<dir>/<name>.md` names the file here. */
  folderFile?: string;
  /** How the tool list is written: Claude Code takes `A, B`, most others a YAML list. */
  tools?: "csv" | "list";
  /**
   * Keep frontmatter the engine does not understand, and `model`. Only right for harnesses that
   * read the canonical dialect, since a model alias or a `color` means nothing elsewhere.
   */
  passthrough?: boolean;
  /** Final say over the frontmatter, for a harness with its own required fields. */
  frontmatter?: (fields: Record<string, unknown>, node: AgentNode, ctx: PlanCtx) => Record<string, unknown>;
}

function grants(node: AgentNode, ctx: PlanCtx): string[] | undefined {
  if (!node.tools) return undefined;
  const mapped = mapToolGrants(node.tools, ctx, `agent ${node.name}`);
  if (mapped.length > 0 || node.tools.length === 0) return mapped;
  // An empty list would mean "no tools", so the field is left out and the user is told that the
  // restriction did not survive.
  ctx.warn(
    `agent ${node.name}: its tool restrictions could not be expressed for ${ctx.harness.label}; it gets the harness's default tools`,
  );
  return undefined;
}

/**
 * Subagents as markdown files with YAML frontmatter: `<dir>/<name>.md`. The directory is the part
 * that differs most between harnesses (`agents`, `droids`, ...), so it is the parameter.
 */
export function markdownAgents(dir: ScopedLoc, options: MarkdownAgentsOptions = {}): Handler<"agent"> {
  return {
    plan(node, ctx) {
      const base = dir[ctx.scope];
      if (!base) return { skip: `no ${ctx.scope}-scope subagent directory` };
      const name = ctx.installed(node.name);
      const tools = grants(node, ctx);
      const convert = pipe(
        frontmatter((current) => {
          const fields: Record<string, unknown> = {
            ...(options.passthrough ? current : {}),
            name,
            description: node.description,
            tools: tools === undefined ? undefined : options.tools === "list" ? tools : tools.join(", "),
            model: options.passthrough ? node.model : undefined,
          };
          return options.frontmatter ? options.frontmatter(fields, node, ctx) : fields;
        }),
        resolveRefs(ctx),
      );
      return [
        {
          type: "file",
          path: options.folderFile
            ? join(base(ctx), name, options.folderFile)
            : join(base(ctx), `${name}${options.ext ?? ".md"}`),
          content: renderDoc(convert(node.doc)),
        },
      ];
    },
  };
}

export interface TomlAgentsOptions {
  /** Build the TOML document. Receives the rendered prompt body. */
  fields: (agent: {
    name: string;
    description: string;
    prompt: string;
    tools?: string[];
  }) => Record<string, unknown>;
}

/** Subagents as one TOML file each: `<dir>/<name>.toml`. */
export function tomlAgents(dir: ScopedLoc, options: TomlAgentsOptions): Handler<"agent"> {
  return {
    plan(node, ctx) {
      const base = dir[ctx.scope];
      if (!base) return { skip: `no ${ctx.scope}-scope subagent directory` };
      const name = ctx.installed(node.name);
      const fields = options.fields({
        name,
        description: node.description,
        prompt: ctx.render(node.doc.body).trim(),
        tools: grants(node, ctx),
      });
      return [{ type: "file", path: join(base(ctx), `${name}.toml`), content: `${stringifyToml(fields)}\n` }];
    },
  };
}
