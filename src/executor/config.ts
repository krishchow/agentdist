import {
  applyEdits,
  findNodeAtLocation,
  type Node as JsonNode,
  modify,
  type ParseError,
  parse as parseJsonc,
  parseTree,
  printParseErrorCode,
} from "jsonc-parser";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { parseDocument } from "yaml";
import type { ConfigFormat, JsonValue } from "../ops/types";

/**
 * Surgical edits of config files the user owns. Each editor changes one key and leaves every
 * other byte, comment and formatting choice alone, and refuses to touch a file it cannot parse.
 */
export interface ConfigEditor {
  get(text: string, keyPath: string[]): JsonValue | undefined;
  set(text: string, keyPath: string[], value: JsonValue): string;
  remove(text: string, keyPath: string[]): string;
  /** Whether nothing but empty containers is left, so a file the engine created can be deleted again. */
  isHollow(text: string): boolean;
}

function hollow(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).every(hollow);
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function walk(root: unknown, keyPath: string[]): JsonValue | undefined {
  let current = root;
  for (const key of keyPath) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current as JsonValue | undefined;
}

// ── JSON and JSONC ───────────────────────────────────────────────────────────

function parseJson(text: string): unknown {
  if (text.trim() === "") return {};
  const errors: ParseError[] = [];
  const value = parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const first = errors[0]!;
    throw new ConfigError(`not valid JSON (${printParseErrorCode(first.error)} at offset ${first.offset})`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError("top level is not a JSON object");
  }
  return value;
}

interface JsonStyle {
  unit: string;
  eol: string;
}

function jsonStyle(text: string): JsonStyle {
  return { unit: /^([ \t]+)\S/m.exec(text)?.[1] ?? "  ", eol: text.includes("\r\n") ? "\r\n" : "\n" };
}

function lineIndent(text: string, offset: number): string {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart, offset))?.[0] ?? "";
}

function pretty(value: JsonValue, indent: string, style: JsonStyle): string {
  return JSON.stringify(value, null, style.unit).split("\n").join(style.eol + indent);
}

/**
 * Insert one property into an object node, touching nothing else. jsonc-parser's own formatter is
 * not used for this because it reformats the line before the insertion point.
 */
function insertProperty(text: string, object: JsonNode, key: string, value: JsonValue, style: JsonStyle): string {
  const close = object.offset + object.length - 1;
  const last = object.children?.at(-1);
  const parentIndent = lineIndent(text, object.offset);
  const indent = last ? lineIndent(text, last.offset) || parentIndent + style.unit : parentIndent + style.unit;
  const property = `${JSON.stringify(key)}: ${pretty(value, indent, style)}`;
  if (!last) {
    return `${text.slice(0, object.offset + 1)}${style.eol}${indent}${property}${style.eol}${parentIndent}${text.slice(close)}`;
  }
  const lastEnd = last.offset + last.length;
  // A trailing comma after the last property is legal JSONC; do not add a second one.
  const hasComma = stripComments(text.slice(lastEnd, close)).includes(",");
  return `${text.slice(0, lastEnd)}${hasComma ? "" : ","}${style.eol}${indent}${property}${text.slice(lastEnd)}`;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function setJson(text: string, keyPath: string[], value: JsonValue): string {
  const base = text.trim() === "" ? "{}\n" : text;
  const style = jsonStyle(base);
  const tree = parseTree(base, [], { allowTrailingComma: true });
  if (!tree) throw new ConfigError("not valid JSON");

  // Deepest object on the path that already exists; everything below it is created in one insert.
  let depth = keyPath.length - 1;
  let parent = findNodeAtLocation(tree, keyPath.slice(0, depth));
  while (!parent && depth > 0) {
    depth--;
    parent = findNodeAtLocation(tree, keyPath.slice(0, depth));
  }
  if (!parent || parent.type !== "object") {
    throw new ConfigError(`${keyPath.slice(0, depth).join(".") || "top level"} is not an object`);
  }
  const key = keyPath[depth]!;
  const payload = keyPath.slice(depth + 1).reduceRight<JsonValue>((inner, k) => ({ [k]: inner }), value);

  const existing = findNodeAtLocation(tree, keyPath.slice(0, depth + 1));
  if (existing) {
    const indent = lineIndent(base, existing.parent?.offset ?? existing.offset);
    return base.slice(0, existing.offset) + pretty(payload, indent, style) + base.slice(existing.offset + existing.length);
  }
  return insertProperty(base, parent, key, payload, style);
}

const json: ConfigEditor = {
  get: (text, keyPath) => walk(parseJson(text), keyPath),
  set(text, keyPath, value) {
    parseJson(text);
    const next = setJson(text, keyPath, value);
    // The edit is textual, so prove it before it is written.
    if (canonicalJson(walk(parseJson(next), keyPath)) !== canonicalJson(value)) {
      throw new ConfigError(`could not safely write ${keyPath.join(".")}`);
    }
    return next;
  },
  remove(text, keyPath) {
    if (walk(parseJson(text), keyPath) === undefined) return text;
    return applyEdits(text, modify(text, keyPath, undefined, {}));
  },
  isHollow: (text) => hollow(parseJson(text)),
};

// ── TOML ─────────────────────────────────────────────────────────────────────

function parseTomlText(text: string): Record<string, unknown> {
  try {
    return parseToml(text) as Record<string, unknown>;
  } catch (e) {
    throw new ConfigError(`not valid TOML (${(e as Error).message.split("\n")[0]})`);
  }
}

/** Split a table header's dotted key, `a."b.c".d`, into its parts. */
function headerKeys(inner: string): string[] {
  const keys: string[] = [];
  const pattern = /\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([A-Za-z0-9_-]+))\s*(\.|$)/y;
  let index = 0;
  while (index < inner.length) {
    pattern.lastIndex = index;
    const match = pattern.exec(inner);
    if (!match) return [];
    keys.push(match[1] ?? match[2] ?? match[3] ?? "");
    index = pattern.lastIndex;
  }
  return keys;
}

/** Drop every `[keyPath]` and `[keyPath.*]` table from the text, leaving all other lines as they are. */
function withoutTomlTables(text: string, keyPath: string[]): string {
  const lines = text.split(/(?<=\n)/);
  const kept: string[] = [];
  let dropping = false;
  for (const line of lines) {
    const header = /^\s*\[\[?([^[\]]+)\]\]?\s*(?:#.*)?\r?\n?$/.exec(line);
    if (header) {
      const keys = headerKeys(header[1] ?? "");
      dropping = keys.length >= keyPath.length && keyPath.every((k, i) => keys[i] === k);
    }
    if (!dropping) kept.push(line);
  }
  return kept.join("");
}

function nested(keyPath: string[], value: JsonValue): Record<string, unknown> {
  return keyPath.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value) as Record<string, unknown>;
}

const toml: ConfigEditor = {
  get: (text, keyPath) => walk(parseTomlText(text), keyPath),
  set(text, keyPath, value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new ConfigError("only tables can be set in a TOML file");
    }
    const cleared = toml.remove(text, keyPath);
    const body = cleared.trimEnd();
    const next = `${body}${body ? "\n\n" : ""}${stringifyToml(nested(keyPath, value)).trim()}\n`;
    // The edit is textual, so prove it: the file must parse and hold exactly the value asked for.
    if (JSON.stringify(walk(parseTomlText(next), keyPath)) !== JSON.stringify(value)) {
      throw new ConfigError(`could not safely write [${keyPath.join(".")}]`);
    }
    return next;
  },
  remove(text, keyPath) {
    if (walk(parseTomlText(text), keyPath) === undefined) return text;
    const next = withoutTomlTables(text, keyPath);
    if (walk(parseTomlText(next), keyPath) !== undefined) {
      throw new ConfigError(
        `${keyPath.join(".")} is defined inline rather than as a [table]; edit it by hand or move it to its own table`,
      );
    }
    return next.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
  },
  isHollow: (text) => hollow(parseTomlText(text)),
};

// ── YAML ─────────────────────────────────────────────────────────────────────

function parseYamlText(text: string) {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new ConfigError(`not valid YAML (${doc.errors[0]!.message.split("\n")[0]})`);
  return doc;
}

const yaml: ConfigEditor = {
  get(text, keyPath) {
    return walk(parseYamlText(text).toJS() ?? {}, keyPath);
  },
  set(text, keyPath, value) {
    const doc = parseYamlText(text);
    if (doc.contents === null) doc.contents = doc.createNode({}) as unknown as typeof doc.contents;
    doc.setIn(keyPath, doc.createNode(value));
    return doc.toString();
  },
  remove(text, keyPath) {
    const doc = parseYamlText(text);
    if (!doc.hasIn(keyPath)) return text;
    doc.deleteIn(keyPath);
    return doc.toString();
  },
  isHollow: (text) => hollow(parseYamlText(text).toJS() ?? {}),
};

const editors: Record<ConfigFormat, ConfigEditor> = { json, jsonc: json, toml, yaml };

export function editorFor(format: ConfigFormat): ConfigEditor {
  return editors[format];
}

/** Key order must not make two equal values look different. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}
