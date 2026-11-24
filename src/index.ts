/**
 * agentpkg: the install engine for agent packages.
 *
 * A package is content in one canonical dialect plus an `agentpkg.json` manifest. The engine turns
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
} from "./api";
export { runAuthorCommand } from "./cli/author";
export { type CliOptions, runCli } from "./cli/run";
export type { Action, ApplyResult, Conflict } from "./executor/apply";
export type { Ledger } from "./executor/ledger";
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
} from "./harness/define";
export {
  canonicalDialect,
  dialect,
  noToolGrants,
  portableDialect,
  proseSkillRef,
  proseToolRef,
} from "./harness/dialect";
export { configRootExists, dotHome, inConfig, inHome, inProject, xdgConfig } from "./harness/locations";
export { findHarness, HARNESSES } from "./harnesses/index";
export { loadPackage, PackageError } from "./ir/load";
export type { AgentNode, CommandNode, McpServerNode, Node, NodeKind, Package, SkillNode } from "./ir/nodes";
export { installedName } from "./ir/nodes";
export { planInstall } from "./ops/plan";
export type { ConfigOp, Diagnostic, FileOp, Op, Plan } from "./ops/types";
export { PACK_TARGETS } from "./pack/index";
export { runPack } from "./pack/run";
export type { PackOutput, PackTarget } from "./pack/types";
export { AgentFrontmatter, CommandFrontmatter, SkillFrontmatter } from "./schema/content";
export {
  AgentPkg,
  type AgentPkgInput,
  Listing,
  MANIFEST_FILE,
  McpServer,
  SCOPES,
  Scope,
} from "./schema/manifest";
export { markdownAgents, tomlAgents } from "./surfaces/agents";
export { markdownCommands, tomlCommands } from "./surfaces/commands";
export { mcpConfig, stdioEntry } from "./surfaces/mcp";
export { AGENTS_SKILLS, CLAUDE_SKILLS, sharedSkills } from "./surfaces/shared";
export { skillsDir } from "./surfaces/skills";
