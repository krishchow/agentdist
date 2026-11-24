import { claudePlugin } from "./claude-plugin";
import type { PackTarget } from "./types";

/** Every native plugin format the engine can generate. */
export const PACK_TARGETS: PackTarget[] = [claudePlugin];
