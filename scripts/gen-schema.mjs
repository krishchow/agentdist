// Emit the JSON Schema for agentdist.json from the Zod type, so editors validate manifests.
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { AgentDist } from "../dist/index.js";

const schema = z.toJSONSchema(AgentDist, { io: "input" });
schema.title = "agentdist.json";
mkdirSync(new URL("../schema/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../schema/agentdist.schema.json", import.meta.url),
  `${JSON.stringify(schema, null, 2)}\n`,
);
