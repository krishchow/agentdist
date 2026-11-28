---
"agentdist": patch
---

Types now resolve for consumers using `"module": "node16"` or `"nodenext"`. Before, every import from `agentdist` was `any` there, and `skipLibCheck` hid the error.
