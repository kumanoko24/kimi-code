import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import { type AgentTool } from '#/tool/toolContract';

export const ACP_AGENT_TOOL_NAME = 'AcpAgent';

export const ACP_AGENT_ACTIONS = ['run', 'start', 'steer', 'wait', 'status', 'cancel'] as const;

export type AcpAgentAction = (typeof ACP_AGENT_ACTIONS)[number];

export const AcpAgentToolInputSchema = z
  .object({
    action: z
      .enum(ACP_AGENT_ACTIONS)
      .optional()
      .describe(
        'Operation to perform. Defaults to "run": start a worker, wait for the turn, and close it. "start" keeps the worker alive for steering, "steer" cancels the current turn and sends a new prompt on the same session, "wait" collects the current or latest turn, "status" peeks without blocking, "cancel" stops and closes the worker.',
      ),
    prompt: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Complete, self-contained instruction for the external agent. Required for run, start, and steer. For steer, describe what to change or add; the worker keeps its session context.',
      ),
    worker_id: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Worker ID returned by action="start" or action="run". Required for steer, wait, status, and cancel.',
      ),
    agent: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Configured ACP agent name from the [acp_agents] config table. Required only when more than one agent is configured; used by run and start.',
      ),
    cwd: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Working directory for a new worker. Relative paths resolve against the session workspace; defaults to the workspace root.',
      ),
  })
  .strict();

export type AcpAgentToolInput = z.infer<typeof AcpAgentToolInputSchema>;

export interface IAcpAgentTool extends AgentTool<AcpAgentToolInput> {
  readonly _serviceBrand: undefined;
}

export const IAcpAgentTool = createDecorator<IAcpAgentTool>('acpAgentTool');
