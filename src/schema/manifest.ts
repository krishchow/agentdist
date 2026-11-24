import { z } from "zod";

/** Where a package can be installed: inside one repository, or for the user across all of them. */
export const SCOPES = ["local", "user"] as const;
export const Scope = z.enum(SCOPES);
export type Scope = z.infer<typeof Scope>;

const identifier = z
  .string()
  .regex(
    /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
    "lowercase letters, digits and single hyphens, starting with a letter",
  );

const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "an environment variable name");

const timeouts = {
  startupTimeoutSec: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("How long a harness should wait for the server to start, where it lets a package say."),
  toolTimeoutSec: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("How long a harness should wait for one tool call, where it lets a package say."),
};

/**
 * An MCP server the harness starts as a subprocess.
 *
 * `env` holds literal values the package sets. `envPassthrough` names variables the server reads
 * from the user's own environment: the package never sees their values, and harnesses that sandbox
 * a server's environment are told to let exactly these through.
 */
export const StdioServer = z.strictObject({
  transport: z.literal("stdio").default("stdio"),
  command: z.string().min(1).describe("The executable to run. {{version}} and {{name}} are filled in."),
  args: z
    .array(z.string())
    .default([])
    .describe('Arguments. {{version}} and {{name}} are filled in, e.g. "my-server@{{version}}".'),
  env: z
    .record(z.string(), z.string())
    .default({})
    .describe("Literal environment values the package sets. Never put a secret here."),
  envPassthrough: z
    .array(envName)
    .default([])
    .describe(
      "Names of variables the server reads from the user's own environment. Harnesses that do not hand a server the whole environment are told to let these through; an unset one may arrive as an empty string.",
    ),
  ...timeouts,
});
export type StdioServer = z.infer<typeof StdioServer>;

/**
 * An MCP server the harness connects to over streamable HTTP.
 *
 * A server that uses OAuth needs only its `url`: the harness runs the login itself. A server that
 * takes a static credential names the variable holding it, as `{{env:NAME}}` inside a header
 * value. The manifest never contains the credential, and neither does anything the engine writes:
 * each harness is given a reference in its own syntax and resolves it when it connects.
 */
export const HttpServer = z.strictObject({
  transport: z.literal("http"),
  url: z.url().describe("The server's streamable HTTP endpoint."),
  headers: z
    .record(z.string(), z.string())
    .default({})
    .describe(
      'Request headers. A value may reference a variable from the user\'s environment as {{env:NAME}}, e.g. "Bearer {{env:ACME_TOKEN}}". Never put a credential here.',
    ),
  ...timeouts,
});
export type HttpServer = z.infer<typeof HttpServer>;

/** `transport` may be left out for a stdio server, which is what most packages declare. */
export const McpServer = z.preprocess(
  (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value) && !("transport" in value)
      ? { ...value, transport: "stdio" }
      : value,
  z.discriminatedUnion("transport", [StdioServer, HttpServer]),
);
export type McpServer = z.infer<typeof McpServer>;

/** The canonical lifecycle events, which are Claude Code's. Each harness maps them to its own. */
export const HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SubagentStop",
  "PreCompact",
  "Notification",
] as const;
export const HookEvent = z.enum(HOOK_EVENTS);
export type HookEvent = z.infer<typeof HookEvent>;

/**
 * A command the harness runs at a point in its lifecycle. The contract a hook script is written
 * against (JSON on stdin, what exit codes mean) is Claude Code's; a harness that does not honour
 * that contract for an event does not get the hook.
 */
export const Hook = z.strictObject({
  event: HookEvent,
  matcher: z
    .array(z.string())
    .optional()
    .describe(
      "For tool events, the canonical tool names the hook applies to (Bash, Edit, Write, ...). Omit for every tool.",
    ),
  command: z
    .string()
    .min(1)
    .describe("The shell command to run. {{hooks_dir}} is where the package's hook files are installed."),
  timeoutSec: z.number().int().positive().optional(),
});
export type Hook = z.infer<typeof Hook>;

/** What the package wants to say about one environment variable it reads. */
export const EnvVar = z.strictObject({
  description: z.string().optional(),
  required: z
    .boolean()
    .default(false)
    .describe("The package does not work without it. The installer says so when it is not set."),
});
export type EnvVar = z.infer<typeof EnvVar>;

/** Marketplace metadata. Only `pack` reads it; a vendored install ignores it. */
export const Listing = z.strictObject({
  displayName: z.string().optional(),
  shortDescription: z.string().optional(),
  longDescription: z.string().optional(),
  category: z.string().optional(),
  keywords: z.array(z.string()).default([]),
  defaultPrompts: z.array(z.string()).default([]),
  brandColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  author: z
    .strictObject({ name: z.string(), email: z.string().optional(), url: z.string().optional() })
    .optional(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  license: z.string().optional(),
});
export type Listing = z.infer<typeof Listing>;

/**
 * `agentpkg.json`: the only file the engine reads for intent.
 *
 * A package is content in one canonical dialect plus this manifest. It contains no installer code
 * and never names a harness, except to restrict where it may be installed.
 */
export const AgentPkg = z.strictObject({
  $schema: z.string().optional(),
  /** Manifest contract version. A floating major: the engine accepts every `v1` manifest. */
  engine: z
    .literal("v1")
    .describe("Contract version. A floating major: every v1 engine accepts every v1 manifest."),
  /** Package identity and ownership namespace. Installed artifacts are prefixed with it. */
  name: identifier.describe(
    "Package identity and ownership namespace. Vendored artifacts are prefixed with it.",
  ),
  /** Defaults to the `version` of the `package.json` beside the manifest. */
  version: z.string().optional().describe("Defaults to the version of the package.json beside the manifest."),
  description: z.string().optional(),

  /** Directory of `<name>/SKILL.md` folders. */
  skills: z.string().optional().describe("Directory of <name>/SKILL.md folders, relative to the manifest."),
  /** Directory of `<name>.md` subagent definitions. */
  agents: z
    .string()
    .optional()
    .describe("Directory of <name>.md subagent definitions, relative to the manifest."),
  /** Directory of `<name>.md` slash commands. */
  commands: z
    .string()
    .optional()
    .describe("Directory of <name>.md slash commands, relative to the manifest."),
  mcpServers: z
    .record(identifier, McpServer)
    .default({})
    .describe("MCP servers to register with each harness, keyed by server name."),

  hooks: z
    .record(identifier, Hook)
    .default({})
    .describe("Lifecycle hooks to register with each harness, keyed by a name of your choosing."),
  hooksDir: z
    .string()
    .optional()
    .describe("Directory of files the hook commands run, installed once and shared by every harness."),
  environment: z
    .record(envName, EnvVar)
    .default({})
    .describe(
      "Environment variables the package reads: what each is for and whether it is required. Used to tell the user what to set; values are never read or stored.",
    ),

  /**
   * How vendored artifact names are kept from colliding with the user's own.
   * `prefix` installs skill `setup` of package `notarize` as `notarize-setup`.
   */
  namespace: z
    .enum(["prefix", "none"])
    .default("prefix")
    .describe(
      'How vendored artifact names avoid colliding with the user\'s own. "prefix" installs skill "setup" of package "notarize" as "notarize-setup".',
    ),
  /** Skill a harness should offer straight after installing, where it has such a concept. */
  onboardingSkill: z
    .string()
    .optional()
    .describe("A skill to offer straight after installing. Must name a skill the package has."),

  scopes: z
    .array(Scope)
    .min(1)
    .default(["local", "user"])
    .describe(
      'Where the package may be installed: "local" (one repository), "user" (every project). Default both.',
    ),
  /** Restrict the package to these harness ids. Omit to allow every harness the engine knows. */
  harnesses: z
    .array(z.string())
    .optional()
    .describe("Restrict the package to these harness ids. Omit to allow every harness the engine knows."),

  listing: Listing.optional().describe("Marketplace metadata, read only by `agentpkg pack`."),
  /** Per-target options for `pack`, keyed by pack target id. Each target validates its own. */
  pack: z
    .record(z.string(), z.record(z.string(), z.unknown()))
    .default({})
    .describe(
      "Native plugin formats to generate with `agentpkg pack`, keyed by target id (claude-plugin, codex-plugin, agent-plugin, dsh-bundle), each with its own options.",
    ),
});
export type AgentPkg = z.infer<typeof AgentPkg>;
export type AgentPkgInput = z.input<typeof AgentPkg>;

export const MANIFEST_FILE = "agentpkg.json";
