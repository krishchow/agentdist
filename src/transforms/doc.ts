import type { PlanCtx } from "../harness/define.js";
import type { Doc } from "../ir/markdown.js";

/**
 * Content conversion is a chain of small passes over a parsed markdown file. A surface composes
 * the passes it needs; none of them knows which harness it is running for beyond the dialect.
 */
export type Transform = (doc: Doc) => Doc;

export function pipe(...transforms: Transform[]): Transform {
  return (doc) => transforms.reduce((d, t) => t(d), doc);
}

/** Replace the frontmatter wholesale. */
export function frontmatter(next: (current: Record<string, unknown>) => Record<string, unknown>): Transform {
  return (doc) => ({ ...doc, frontmatter: withoutUndefined(next(doc.frontmatter)) });
}

/** Set fields, leaving the rest and their order alone. An unchanged value is not a change. */
export function setFields(fields: Record<string, unknown>): Transform {
  return frontmatter((current) => ({ ...current, ...fields }));
}

/** Resolve symbolic references in the body. */
export function resolveRefs(ctx: PlanCtx, skillDir?: string): Transform {
  return (doc) => ({ ...doc, body: ctx.render(doc.body, skillDir) });
}

export function mapBody(fn: (body: string) => string): Transform {
  return (doc) => ({ ...doc, body: fn(doc.body) });
}

function withoutUndefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined));
}
