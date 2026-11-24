# Adding a harness

A harness is one file in `src/harnesses/` and two golden files. Nothing else in the engine changes.

## 1. Collect the facts, with sources

From the harness's own documentation, for both scopes (repository and user):

- the config directory, and any environment variable that relocates it;
- which skills directories it reads, in what order, and whether `.agents/skills` is one of them;
- where subagent definitions go and what their frontmatter is;
- where commands go;
- the MCP config file, its format, the key servers live under, and the shape of a stdio entry;
- how the model names an MCP tool, and how a user invokes a skill.

Record the URLs in `sources`. If the documentation does not say, do not guess a path: mark that
kind or scope unsupported with the reason. An install that reports "skipped" is recoverable; one
that writes to a made-up path is not.

## 2. Write the file

```ts
const home = dotHome(".factory");

export const factory = defineHarness({
  id: "factory",
  label: "Factory Droid",
  configRoot: { user: home, local: ".factory" },
  detect: configRootExists(home),
  dialect: dialect({ toolRef: proseToolRef }),
  kinds: {
    skill: sharedSkills(),
    agent: markdownAgents({ user: inConfig("droids"), local: inConfig("droids") }, { tools: "list" }),
    command: markdownCommands({ user: inConfig("commands"), local: inConfig("commands") }),
    mcpServer: mcpConfig({
      file: { user: inConfig("mcp.json"), local: inConfig("mcp.json") },
      format: "json",
      keyPath: ["mcpServers"],
      entry: stdioEntry({ type: "stdio" }),
    }),
  },
  sources: ["https://docs.factory.com/harness/mcp.md"],
});
```

Locations are built from three helpers: `inConfig(...)` (under the harness's own directory at the
scope being planned), `inHome(...)` and `inProject(...)`. Leaving a scope out of a location means
the harness has no such surface there, and the install says so.

Choices that come up:

- **Skills.** If the harness reads `.agents/skills`, use `sharedSkills()` even if it has a
  directory of its own, or it will list a skill twice when another harness installs there. Pass
  `alsoReads` for other directories it reads, such as `CLAUDE_SKILLS`.
- **Dialect.** Start from `dialect()` and override what differs. Use `proseToolRef` when the
  harness does not document a fixed MCP tool identifier, and `noToolGrants` when its subagents take
  no tool list. A tool name you cannot verify should map to `null`, which drops the grant with a
  warning, rather than to a guess.
- **Two scopes that work differently.** Wrap two handlers in `byScope({ user, local })`.
- **A config dialect that depends on the file.** `mcpConfig`'s `keyPath` may be a function of the
  file, as OpenCode's is.

If the harness needs something no surface does, add a surface, not a special case in the harness
file. The next harness will probably want it too.

## 3. Register and generate the goldens

Add it to `HARNESSES` in `src/harnesses/index.ts`, then:

```
pnpm vitest run -u test/harnesses.test.ts
```

This writes `test/golden/<id>.user.txt` and `test/golden/<id>.local.txt`: every file and config
entry the harness produces for the fixture package, in full. Read them against the documentation
before committing. They are the review artifact, and from then on any change to what the harness
writes shows up as a diff.

The same test checks, for every harness, that nothing lands outside the scope's root and that every
node is either installed or explained.
