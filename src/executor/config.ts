import { applyEdits, modify, type ParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser";
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

function jsonFormatting(text: string) {
  const indent = /^([ \t]+)\S/m.exec(text)?.[1];
  return {
    insertSpaces: indent ? !indent.includes("\t") : true,
    tabSize: indent && !indent.includes("\t") ? indent.length : 2,
    eol: text.includes("\r\n") ? "\r\n" : "\n",
  };
}

const json: ConfigEditor = {
  get: (text, keyPath) => walk(parseJson(text), keyPath),
  set(text, keyPath, value) {
    parseJson(text);
    const base = text.trim() === "" ? "{}\n" : text;
    return applyEdits(base, modify(base, keyPath, value, { formattingOptions: jsonFormatting(base) }));
  },
  remove(text, keyPath) {
    if (walk(parseJson(text), keyPath) === undefined) return text;
    return applyEdits(text, modify(text, keyPath, undefined, { formattingOptions: jsonFormatting(text) }));
  },
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
    if (doc.contents === null) doc.contents = doc.createNode({});
    doc.setIn(keyPath, doc.createNode(value));
    return doc.toString();
  },
  remove(text, keyPath) {
    const doc = parseYamlText(text);
    if (!doc.hasIn(keyPath)) return text;
    doc.deleteIn(keyPath);
    return doc.toString();
  },
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
