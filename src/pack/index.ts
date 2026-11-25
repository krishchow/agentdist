import { agentPlugin } from "./agent-plugin.js";
import { claudePlugin } from "./claude-plugin.js";
import { codexPlugin } from "./codex-plugin.js";
import { dshBundle } from "./dsh-bundle.js";
import type { PackTarget } from "./types.js";

/** Every native plugin format the engine can generate. */
export const PACK_TARGETS: PackTarget[] = [claudePlugin, codexPlugin, agentPlugin, dshBundle];
