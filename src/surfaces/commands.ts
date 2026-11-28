import { join } from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import { type Handler, hasOwnCommands, type PlanCtx, type ScopedLoc } from "../harness/define";
import { renderDoc } from "../ir/markdown";
import type { CommandNode, SkillNode } from "../ir/nodes";
import { configRootOf } from "../ops/plan";
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
  /**
   * Let the model invoke the skill too. Only for a harness where a skill the model cannot see
   * cannot be run at all, because the user has no way to invoke one by name.
   */
  modelInvocable?: boolean;
}

/**
 * The harnesses in this install that have commands of their own and read the shared skills
 * directory `skills` puts this harness's skills in, so would list a command there a second time.
 */
function nativeReaders(
  skills: Handler<"skill">,
  ctx: PlanCtx,
): { dir: string; labels: string[] } | undefined {
  const shared = skills.shared?.[ctx.scope];
  if (!shared) return undefined;
  const dir = shared(ctx);
  const labels = ctx.harnesses
    .filter((other) => other.id !== ctx.harness.id && hasOwnCommands(other))
    .filter((other) => {
      const theirs = other.kinds.skill.shared?.[ctx.scope];
      return theirs?.({ env: ctx.env, configRoot: configRootOf(other, ctx.scope, ctx.env) }) === dir;
    })
    .map((other) => other.label);
  return labels.length > 0 ? { dir: ctx.displayPath(dir), labels } : undefined;
}

/**
 * A command as an Agent Skill, for a harness whose slash commands are its skills. The skill is
 * planned by the harness's own skills handler, so it goes where that harness's skills go, and has
 * the command's name, description and body. It is for the user to invoke, so it asks not to be
 * invoked by the model on its own, unless `modelInvocable` says that would leave no way to run it.
 *
 * Where that is the shared skills directory, a harness installed alongside that reads it and has
 * commands of its own would show the command twice, its own and the skill, and some offer the
 * skill to the model whatever its frontmatter says. Then the skill is left out, and this harness
 * goes without the command.
 */
export function commandsAsSkills(
  skills: Handler<"skill">,
  options: CommandsAsSkillsOptions = {},
): Handler<"command"> {
  return {
    asSkill: true,
    plan(node, ctx) {
      if (ctx.pkg.nodes.some((other) => other.kind === "skill" && other.name === node.name)) {
        return { skip: `it would be a skill, and the package already has a skill named ${node.name}` };
      }
      const readers = nativeReaders(skills, ctx);
      if (readers) {
        const { dir, labels } = readers;
        const them = labels.join(" and ");
        const [reads, installs] = labels.length > 1 ? ["read", "install"] : ["reads", "installs"];
        ctx.warn(
          `command ${node.name} is not installed for ${ctx.harness.label}: as a skill in ${dir} it would show up a second time in ${them}, which ${reads} that directory and ${installs} the command as its own`,
        );
        return { skip: `${them} ${reads} ${dir} too and ${installs} the command as its own` };
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
            ...(options.modelInvocable ? {} : { "disable-model-invocation": true }),
          },
          body: withArguments(node.doc.body, node, ctx, options.argumentsPlaceholder),
        },
        files: [],
      };
      return skills.plan(skill, ctx);
    },
  };
}
