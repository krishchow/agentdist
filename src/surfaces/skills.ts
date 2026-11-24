import { join } from "node:path";
import type { Handler, PlanCtx, ScopedLoc } from "../harness/define";
import { renderDoc } from "../ir/markdown";
import type { SkillNode } from "../ir/nodes";
import type { Op } from "../ops/types";
import { pipe, resolveRefs, setFields, type Transform } from "../transforms/doc";

export interface SkillsDirOptions {
  /**
   * Other skills directories the harness also reads. When another harness being installed already
   * puts the skill in one of them, this harness uses that copy instead of writing a second one.
   */
  alsoReads?: ScopedLoc[];
  /** Extra passes over `SKILL.md`, after the standard ones. */
  transform?: (node: SkillNode, ctx: PlanCtx) => Transform;
}

/**
 * Agent Skills folders: `<dir>/<name>/SKILL.md` plus supporting files. Every harness that reads
 * skills reads this layout, so the only thing that varies is the directory.
 */
export function skillsDir(dir: ScopedLoc, options: SkillsDirOptions = {}): Handler<"skill"> {
  return {
    plan(node, ctx) {
      const base = dir[ctx.scope];
      if (!base) return { skip: `no ${ctx.scope}-scope skills directory` };
      const name = ctx.installed(node.name);
      const skillDir = join(base(ctx), name);
      const others = (options.alsoReads ?? []).flatMap((loc) => {
        const other = loc[ctx.scope];
        return other ? [join(other(ctx), name)] : [];
      });
      const elsewhere = (...rel: string[]) =>
        others.length ? { satisfiedBy: others.map((dir) => join(dir, ...rel)) } : {};

      const convert = pipe(
        setFields({ name }),
        resolveRefs(ctx, skillDir),
        options.transform?.(node, ctx) ?? ((d) => d),
      );
      const ops: Op[] = [
        {
          type: "file",
          path: join(skillDir, "SKILL.md"),
          content: renderDoc(convert(node.doc)),
          ...elsewhere("SKILL.md"),
        },
      ];
      for (const file of node.files) {
        ops.push({
          type: "file",
          path: join(skillDir, ...file.rel.split("/")),
          content: file.text ? ctx.render(Buffer.from(file.bytes).toString("utf8"), skillDir) : file.bytes,
          executable: file.executable,
          ...elsewhere(...file.rel.split("/")),
        });
      }
      return ops;
    },
  };
}
