---

name: beacon
description: Probe skill for agentdist end-to-end tests. PROBE_SKILL_BEACON_DESC
---

# Beacon

PROBE_SKILL_BEACON_BODY

Call {{tool:probe.stdio_canary}}, then run `node {{skill_dir}}/scripts/mark.mjs`.
After that, hand off to {{agent:scout}} or run {{skill:beacon}} again.
