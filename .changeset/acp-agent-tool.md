---
"@moonshot-ai/kimi-code": minor
---

Add the AcpAgent tool so kimi can run and steer an external ACP coding agent as a worker; the worker's tool calls and plan are streamed into the TUI as it runs. Enable it with `KIMI_CODE_EXPERIMENTAL_ACP_AGENT=1` and configure an `[acp_agents.<name>]` table.
