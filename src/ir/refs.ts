/**
 * Symbolic references. Package content never spells a harness's syntax for calling a tool or
 * invoking a skill; it writes a reference, and each harness's dialect renders it:
 *
 *   {{tool:notarize.doctor}}   an MCP tool of a server this package declares
 *   {{skill:setup}}            another skill of this package
 *   {{agent:reviewer}}         a subagent of this package
 *   {{command:ship}}           a slash command of this package
 *   {{skill_dir}}              the directory this skill is installed in
 *   {{pkg.name}} {{pkg.version}}
 *
 * Anything else in double braces is left alone, so content can still carry `${{ github.token }}`
 * or a Handlebars sample.
 */

export type Ref =
  | { type: "tool"; server: string; tool: string }
  | { type: "skill" | "agent" | "command"; name: string }
  | { type: "skill_dir" | "pkg.name" | "pkg.version" };

const REF =
  /\{\{\s*(?:(tool|skill|agent|command):([A-Za-z0-9_.-]+)|(skill_dir|pkg\.name|pkg\.version))\s*\}\}/g;

function toRef(kind: string | undefined, target: string | undefined, bare: string | undefined): Ref | string {
  if (bare) return { type: bare as "skill_dir" | "pkg.name" | "pkg.version" };
  if (kind === "tool") {
    const dot = (target ?? "").indexOf(".");
    if (dot <= 0 || dot === (target ?? "").length - 1)
      return `{{tool:${target}}} must be {{tool:<server>.<tool>}}`;
    return { type: "tool", server: target!.slice(0, dot), tool: target!.slice(dot + 1) };
  }
  return { type: kind as "skill" | "agent" | "command", name: target! };
}

/** Every reference in `text`, with malformed ones reported as strings. */
export function findRefs(text: string): Array<Ref | string> {
  return [...text.matchAll(REF)].map((m) => toRef(m[1], m[2], m[3]));
}

export function hasRefs(text: string): boolean {
  REF.lastIndex = 0;
  return REF.test(text);
}

export function replaceRefs(text: string, render: (ref: Ref) => string): string {
  return text.replace(REF, (whole, kind, target, bare) => {
    const ref = toRef(kind, target, bare);
    return typeof ref === "string" ? whole : render(ref);
  });
}
