import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** A markdown file split into YAML frontmatter and body. */
export interface Doc {
  frontmatter: Record<string, unknown>;
  body: string;
  /**
   * The frontmatter exactly as the author wrote it, kept so a file no transform touched is
   * installed byte for byte instead of being reflowed by a YAML round trip.
   */
  source?: { text: string; frontmatter: Record<string, unknown> };
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function parseDoc(text: string): Doc {
  const match = FENCE.exec(text);
  if (!match) return { frontmatter: {}, body: text };
  const parsed = parseYaml(match[1] ?? "");
  if (parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed))) {
    throw new Error("frontmatter must be a YAML mapping");
  }
  const frontmatter = (parsed ?? {}) as Record<string, unknown>;
  return {
    frontmatter,
    body: text.slice(match[0].length),
    source: { text: match[0], frontmatter: structuredClone(frontmatter) },
  };
}

export function renderDoc(doc: Doc): string {
  if (doc.source && sameValue(doc.source.frontmatter, doc.frontmatter)) return doc.source.text + doc.body;
  if (Object.keys(doc.frontmatter).length === 0) return doc.body;
  return `---\n${stringifyYaml(doc.frontmatter, { lineWidth: 0 })}---\n${doc.body}`;
}

function sameValue(a: unknown, b: unknown): boolean {
  // Key order is part of the comparison on purpose: a reorder is a change worth re-rendering.
  return JSON.stringify(a) === JSON.stringify(b);
}
