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

/**
 * One MCP server the package wants registered with the harness.
 *
 * `env` holds literal values the package sets. `envPassthrough` names variables the server reads
 * from the user's own environment: the package never sees their values, and harnesses that sandbox
 * a server's environment are told to let exactly these through.
 */
export const McpServer = z.strictObject({
  transport: z.literal("stdio").default("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  envPassthrough: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).default([]),
  startupTimeoutSec: z.number().int().positive().optional(),
  toolTimeoutSec: z.number().int().positive().optional(),
});
export type McpServer = z.infer<typeof McpServer>;

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
  engine: z.literal("v1"),
  /** Package identity and ownership namespace. Installed artifacts are prefixed with it. */
  name: identifier,
  /** Defaults to the `version` of the `package.json` beside the manifest. */
  version: z.string().optional(),
  description: z.string().optional(),

  /** Directory of `<name>/SKILL.md` folders. */
  skills: z.string().optional(),
  /** Directory of `<name>.md` subagent definitions. */
  agents: z.string().optional(),
  /** Directory of `<name>.md` slash commands. */
  commands: z.string().optional(),
  mcpServers: z.record(identifier, McpServer).default({}),

  /**
   * How vendored artifact names are kept from colliding with the user's own.
   * `prefix` installs skill `setup` of package `notarize` as `notarize-setup`.
   */
  namespace: z.enum(["prefix", "none"]).default("prefix"),
  /** Skill a harness should offer straight after installing, where it has such a concept. */
  onboardingSkill: z.string().optional(),

  scopes: z.array(Scope).min(1).default(["local", "user"]),
  /** Restrict the package to these harness ids. Omit to allow every harness the engine knows. */
  harnesses: z.array(z.string()).optional(),

  listing: Listing.optional(),
  /** Per-target options for `pack`, keyed by pack target id. Each target validates its own. */
  pack: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});
export type AgentPkg = z.infer<typeof AgentPkg>;
export type AgentPkgInput = z.input<typeof AgentPkg>;

export const MANIFEST_FILE = "agentpkg.json";
