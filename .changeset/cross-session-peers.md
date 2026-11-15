---
"@moonshot-ai/kimi-code": minor
---

Add experimental cross-session peer messaging: `ListAgents` and `SendMessage` let the main agent message other live kimi sessions on the same machine, with messages deferred while swarm or tower mode is active. Enable with `KIMI_CODE_EXPERIMENTAL_CROSS_SESSION=1` or `[experimental] cross_session = true`.
