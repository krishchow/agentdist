import { describe, expect, it } from "vitest";
import { ConfigError, canonicalJson, editorFor } from "../src/executor/config.js";

const entry = { command: "npx", args: ["-y", "demo"], env: { A: "1" } };

describe("json editor", () => {
  const json = editorFor("jsonc");

  it("creates the file and its parents", () => {
    const text = json.set("", ["mcpServers", "demo"], entry);
    expect(JSON.parse(text)).toEqual({ mcpServers: { demo: entry } });
  });

  it("changes one key and keeps comments, order and indentation", () => {
    const before = `{\n\t// mine\n\t"theme": "dark",\n\t"mcpServers": {\n\t\t"other": { "command": "x" }\n\t}\n}\n`;
    const after = json.set(before, ["mcpServers", "demo"], entry);
    expect(after).toContain("// mine");
    expect(after).toContain('\t"theme": "dark"');
    expect(after).toContain('\t\t"other": { "command": "x" }');
    expect(json.get(after, ["mcpServers", "demo"])).toEqual(entry);
    expect(json.remove(after, ["mcpServers", "demo"])).toBe(before);
  });

  it("adds and removes one element of a list without disturbing the others", () => {
    const before = `{\n  "hooks": {\n    "Stop": [\n      { "command": "a" }, // first\n      { "command": "b" }\n    ]\n  }\n}\n`;
    const added = json.append(before, ["hooks", "Stop"], { command: "ours" });
    expect(json.get(added, ["hooks", "Stop"])).toEqual([
      { command: "a" },
      { command: "b" },
      { command: "ours" },
    ]);
    expect(added).toContain('{ "command": "a" }, // first');
    expect(json.removeAt(added, ["hooks", "Stop"], 2)).toBe(before);
    expect(json.get(json.removeAt(added, ["hooks", "Stop"], 0), ["hooks", "Stop"])).toEqual([
      { command: "b" },
      { command: "ours" },
    ]);
    // A list the engine created goes away with its last element.
    const created = json.append("{}\n", ["hooks", "Stop"], { command: "ours" });
    expect(JSON.parse(json.removeAt(created, ["hooks", "Stop"], 0))).toEqual({ hooks: {} });
    expect(() => json.append('{ "hooks": { "Stop": {} } }', ["hooks", "Stop"], 1)).toThrow(/not a list/);
  });

  it("refuses a file it cannot parse", () => {
    expect(() => json.set('{ "a": ', ["x"], 1)).toThrow(ConfigError);
    expect(() => json.get("[1]", ["x"])).toThrow(/not a JSON object/);
  });
});

describe("toml editor", () => {
  const toml = editorFor("toml");
  const before = `# my settings\nmodel = "gpt"\n\n[mcp_servers.other]\ncommand = "x" # keep\n\n[profiles.fast]\nmodel = "mini"\n`;

  it("appends a table and keeps everything else byte for byte", () => {
    const after = toml.set(before, ["mcp_servers", "demo"], entry);
    expect(after.startsWith(before)).toBe(true);
    expect(toml.get(after, ["mcp_servers", "demo"])).toEqual(entry);
    expect(toml.get(after, ["mcp_servers", "other"])).toEqual({ command: "x" });
  });

  it("replaces a table and its subtables without duplicating them", () => {
    const once = toml.set(before, ["mcp_servers", "demo"], entry);
    const twice = toml.set(once, ["mcp_servers", "demo"], { command: "node", env: { B: "2" } });
    expect(toml.get(twice, ["mcp_servers", "demo"])).toEqual({ command: "node", env: { B: "2" } });
    expect(twice.match(/\[mcp_servers\.demo\]/g)).toHaveLength(1);
    expect(toml.remove(twice, ["mcp_servers", "demo"])).toBe(before);
  });

  it("accepts a table whose scalars come after its subtables", () => {
    const value = { command: "npx", env: { A: "1" }, env_vars: ["TOKEN"], tool_timeout_sec: 300 };
    expect(toml.get(toml.set("", ["mcp_servers", "demo"], value), ["mcp_servers", "demo"])).toEqual(value);
  });

  it("does not mistake a sibling with the same prefix for the table", () => {
    const text = toml.set(`[mcp_servers.demo-two]\ncommand = "y"\n`, ["mcp_servers", "demo"], entry);
    expect(toml.get(toml.remove(text, ["mcp_servers", "demo"]), ["mcp_servers", "demo-two"])).toEqual({
      command: "y",
    });
  });

  it("will not guess at an inline definition", () => {
    expect(() =>
      toml.remove(`mcp_servers = { demo = { command = "x" } }\n`, ["mcp_servers", "demo"]),
    ).toThrow(/defined inline/);
  });
});

describe("yaml editor", () => {
  const yaml = editorFor("yaml");
  it("sets and removes a key, keeping comments", () => {
    const before = `# mine\nextensions:\n  other:\n    cmd: x\n`;
    const after = yaml.set(before, ["extensions", "demo"], entry);
    expect(after).toContain("# mine");
    expect(yaml.get(after, ["extensions", "demo"])).toEqual(entry);
    expect(yaml.remove(after, ["extensions", "demo"])).toBe(before);
    expect(yaml.get(yaml.set("", ["a", "b"], 1), ["a", "b"])).toBe(1);
  });
});

it("canonicalJson ignores key order", () => {
  expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe(canonicalJson({ a: { c: 2, d: 1 }, b: 1 }));
});
