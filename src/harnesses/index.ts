import type { HarnessDef } from "../harness/define";
import { claude } from "./claude";

/** Every harness the engine can install into, in the order prompts list them. */
export const HARNESSES: HarnessDef[] = [claude];

export function findHarness(id: string, harnesses: HarnessDef[] = HARNESSES): HarnessDef | undefined {
  return harnesses.find((h) => h.id === id);
}
