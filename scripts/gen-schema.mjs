// Emit the JSON Schema for agentpkg.json from the Zod type, so editors validate manifests.
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { AgentPkg } from "../dist/index.js";

const schema = z.toJSONSchema(AgentPkg, { io: "input" });
schema.title = "agentpkg.json";
mkdirSync(new URL("../schema/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../schema/agentpkg.schema.json", import.meta.url),
  `${JSON.stringify(schema, null, 2)}\n`,
);
