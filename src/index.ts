/**
 * agentdist: the install engine for agent packages.
 *
 * A package is content in one canonical dialect plus an `agentdist.json` manifest. The engine turns
 * it into typed nodes, asks each harness what those nodes become, and applies the result while
 * recording exactly what it owns.
 */

export {
  allowedHarnesses,
  describeSupport,
  ENGINE_VERSION,
  findProjectRoot,
  type InstallOutcome,
  type InstallRequest,
  install,
  realEnv,
  type Support,
  status,
  type UninstallRequest,
  uninstall,
} from "./api.js";
export { runAuthorCommand } from "./cli/author.js";
export { type CliOptions, runCli } from "./cli/run.js";
export type { Action, ApplyResult, Conflict } from "./executor/apply.js";
export type { Ledger } from "./executor/ledger.js";
export {
  byScope,
  type Dialect,
  defineHarness,
  type Env,
  type Handler,
  type HarnessDef,
  type Loc,
  type PlanCtx,
  type ScopedLoc,
  unsupported,
} from "./harness/define.js";
export {
  canonicalDialect,
  dialect,
  noToolGrants,
  portableDialect,
  proseSkillRef,
  proseToolRef,
} from "./harness/dialect.js";
export { configRootExists, dotHome, inConfig, inHome, inProject, xdgConfig } from "./harness/locations.js";
export { findHarness, HARNESSES } from "./harnesses/index.js";
export { loadPackage, PackageError } from "./ir/load.js";
export type {
  AgentNode,
  CommandNode,
  McpServerNode,
  Node,
  NodeKind,
  Package,
  SkillNode,
} from "./ir/nodes.js";
export { installedName } from "./ir/nodes.js";
export { planInstall } from "./ops/plan.js";
export type { ConfigOp, Diagnostic, FileOp, Op, Plan } from "./ops/types.js";
export { PACK_TARGETS } from "./pack/index.js";
export { runPack } from "./pack/run.js";
export type { PackOutput, PackTarget } from "./pack/types.js";
export { AgentFrontmatter, CommandFrontmatter, SkillFrontmatter } from "./schema/content.js";
export {
  AgentDist,
  type AgentDistInput,
  Listing,
  MANIFEST_FILE,
  McpServer,
  SCOPES,
  Scope,
} from "./schema/manifest.js";
export { markdownAgents, tomlAgents } from "./surfaces/agents.js";
export { markdownCommands, tomlCommands } from "./surfaces/commands.js";
export { mcpConfig, stdioEntry } from "./surfaces/mcp.js";
export { AGENTS_SKILLS, CLAUDE_SKILLS, sharedSkills } from "./surfaces/shared.js";
export { skillsDir } from "./surfaces/skills.js";
