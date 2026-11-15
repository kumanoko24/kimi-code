Run an external ACP coding agent as a worker and return its final answer.

The external agent is a separate process with its own model and tools. It runs against a working directory shared with this session, starts cold, and sees only the prompts you pass. Each turn's final assistant message becomes the tool result.

Use this only when the user explicitly asks for an external ACP agent or a skill/AGENTS.md instructs you to. Prefer the built-in Agent tool for ordinary kimi subagents: AcpAgent exists for agents outside kimi, not as a replacement for Agent or AgentSwarm.

Actions:

- run (default): start a worker, wait for the turn, return the result, then close the worker. Use it for one-shot delegation.
- start: start a worker, return its worker_id immediately, and keep the session alive. Use it when you may need to steer or when you want to do other work while the worker runs.
- steer: cancel the worker's current turn and send a new prompt on the same session. The worker keeps its conversation context. ACP has no native steer method, so this is implemented as session/cancel followed by a new session/prompt. Use it to change direction, add constraints, or correct a mistake.
- wait: block until the worker's current turn finishes (or return its latest result when idle), and surface its output.
- status: return the worker's state and output tail without blocking.
- cancel: cancel the current turn, close the session, and stop the process.

A started worker keeps running between tool calls. Always cancel workers you no longer need; a worker that is never cancelled keeps its process alive until the agent scope ends. A turn is bounded by the [subagent] timeoutMs config. When the worker's [acp_agents] entry sets model or effort, the worker is pinned to those values through the agent's ACP selectors.

Write the prompt as a complete brief: the goal, what you already know, absolute paths of relevant files, the expected handoff, and any constraints. The external agent cannot see this conversation, so do not refer to earlier turns. When steering, state only what changed or what to do differently; the worker already has the earlier prompts and its own work.

The external agent's own permission requests follow this agent's permission mode: auto and yolo approve them, manual asks the user.
