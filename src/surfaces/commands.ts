import { join } from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import type { Handler, PlanCtx, ScopedLoc } from "../harness/define";
import { renderDoc } from "../ir/markdown";
import type { CommandNode, SkillNode } from "../ir/nodes";
import { frontmatter, mapBody, pipe, resolveRefs } from "../transforms/doc";

/** The canonical placeholder for everything the user typed after the command. */
export const ARGUMENTS = "$ARGUMENTS";

/**
 * What `$ARGUMENTS` becomes in a harness with no placeholder, which shows the model what the user
 * typed after the command's own text.
 */
export const APPENDED_ARGUMENTS = "the arguments given after the command";

/** `$ARGUMENTS` in `body` as `placeholder`, or as prose with a warning when there is none. */
function withArguments(body: string, node: CommandNode, ctx: PlanCtx, placeholder?: string): string {
  if (!body.includes(ARGUMENTS)) return body;
  if (placeholder) return body.replaceAll(ARGUMENTS, placeholder);
  ctx.warn(
    `command ${node.name}: ${ctx.harness.label} has no argument placeholder and gives the model the arguments after the command's text, so ${ARGUMENTS} is written as "${APPENDED_ARGUMENTS}"`,
  );
  return body.replaceAll(ARGUMENTS, APPENDED_ARGUMENTS);
}

export interface MarkdownCommandsOptions {
  ext?: string;
  /** Keep frontmatter the engine does not understand. Only for harnesses reading the canonical dialect. */
  passthrough?: boolean;
  /**
   * What this harness writes where the canonical dialect writes `$ARGUMENTS`. `null` when it has
   * no placeholder and appends the arguments to the command's text.
   */
  argumentsPlaceholder?: string | null;
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
        mapBody((body) =>
          placeholder === null
            ? withArguments(body, node, ctx)
            : placeholder
              ? body.replaceAll(ARGUMENTS, placeholder)
              : body,
        ),
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

export interface CommandsAsSkillsOptions {
  /** How a skill invoked with arguments refers to them, where the harness has a placeholder. */
  argumentsPlaceholder?: string;
}

/**
 * A command as an Agent Skill, for a harness whose slash commands are its skills. The skill is
 * planned by the harness's own skills handler, so it goes where that harness's skills go, and has
 * the command's name, description and body. It is for the user to invoke, so it asks not to be
 * invoked by the model on its own.
 */
export function commandsAsSkills(
  skills: Handler<"skill">,
  options: CommandsAsSkillsOptions = {},
): Handler<"command"> {
  return {
    plan(node, ctx) {
      if (ctx.pkg.nodes.some((other) => other.kind === "skill" && other.name === node.name)) {
        return { skip: `it would be a skill, and the package already has a skill named ${node.name}` };
      }
      const description = node.description ?? `The ${node.name} command.`;
      const skill: SkillNode = {
        kind: "skill",
        name: node.name,
        description,
        doc: {
          frontmatter: {
            name: node.name,
            description,
            ...(node.argumentHint ? { "argument-hint": node.argumentHint } : {}),
            "disable-model-invocation": true,
          },
          body: withArguments(node.doc.body, node, ctx, options.argumentsPlaceholder),
        },
        files: [],
      };
      return skills.plan(skill, ctx);
    },
  };
}
