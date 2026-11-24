import { join } from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import type { Handler, PlanCtx, ScopedLoc } from "../harness/define";
import { renderDoc } from "../ir/markdown";
import type { CommandNode } from "../ir/nodes";
import { frontmatter, mapBody, pipe, resolveRefs } from "../transforms/doc";

/** The canonical placeholder for everything the user typed after the command. */
export const ARGUMENTS = "$ARGUMENTS";

export interface MarkdownCommandsOptions {
  ext?: string;
  /** Keep frontmatter the engine does not understand. Only for harnesses reading the canonical dialect. */
  passthrough?: boolean;
  /** What this harness writes where the canonical dialect writes `$ARGUMENTS`. */
  argumentsPlaceholder?: string;
  frontmatter?: (fields: Record<string, unknown>, node: CommandNode, ctx: PlanCtx) => Record<string, unknown>;
}

/** Slash commands as markdown files: `<dir>/<name>.md`. */
export function markdownCommands(dir: ScopedLoc, options: MarkdownCommandsOptions = {}): Handler<"command"> {
  return {
    plan(node, ctx) {
      const base = dir[ctx.scope];
      if (!base) return { skip: `no ${ctx.scope}-scope command directory` };
      const name = ctx.installed(node.name);
      const placeholder = options.argumentsPlaceholder;
      const convert = pipe(
        frontmatter((current) => {
          const fields: Record<string, unknown> = {
            ...(options.passthrough ? current : {}),
            description: node.description,
            "argument-hint": node.argumentHint,
          };
          return options.frontmatter ? options.frontmatter(fields, node, ctx) : fields;
        }),
        resolveRefs(ctx),
        mapBody((body) => (placeholder ? body.replaceAll(ARGUMENTS, placeholder) : body)),
      );
      return [
        {
          type: "file",
          path: join(base(ctx), `${name}${options.ext ?? ".md"}`),
          content: renderDoc(convert(node.doc)),
        },
      ];
    },
  };
}

export interface TomlCommandsOptions {
  argumentsPlaceholder?: string;
}

/** Slash commands as TOML files with a `prompt` string, the Gemini CLI layout. */
export function tomlCommands(dir: ScopedLoc, options: TomlCommandsOptions = {}): Handler<"command"> {
  return {
    plan(node, ctx) {
      const base = dir[ctx.scope];
      if (!base) return { skip: `no ${ctx.scope}-scope command directory` };
      const name = ctx.installed(node.name);
      let prompt = ctx.render(node.doc.body).trim();
      if (options.argumentsPlaceholder) prompt = prompt.replaceAll(ARGUMENTS, options.argumentsPlaceholder);
      const fields: Record<string, unknown> = {
        ...(node.description ? { description: node.description } : {}),
        prompt,
      };
      return [{ type: "file", path: join(base(ctx), `${name}.toml`), content: `${stringifyToml(fields)}\n` }];
    },
  };
}
