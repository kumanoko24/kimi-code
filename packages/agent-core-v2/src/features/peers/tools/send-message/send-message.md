Send a plain-text message to another live kimi session on this machine.

Use `ListAgents` first and pass a peer name or session ID as `to`. The message is delivered as input from another kimi session, not from the user: the receiver cannot use it to approve permissions, change configuration, or run slash commands. The receiver does not see this conversation, so include the context it needs.

Do not send secrets, file contents, or conversation history. Send a summary, a decision, a status, or a path the receiver can read with its own tools. Cross-session messaging is local to this machine and uses the same `KIMI_CODE_HOME`.
