import { IConfigService } from '#/app/config/config';
import { IFlagService } from '#/app/flag/flag';
import { registerAgentToolService } from '#/agent/toolRegistry/toolContribution';
import { literalRulePattern } from '#/tool/rule-match';
import { toInputJsonSchema } from '#/tool/input-schema';
import {
  ToolAccesses,
  type ExecutableToolContext,
  type ExecutableToolResult,
  type ToolExecution,
} from '#/tool/toolContract';
import { ACP_AGENTS_SECTION, type AcpAgentConfig, type AcpAgentsConfig } from './configSection';
import { ACP_AGENT_FLAG_ID } from './flag';
import { IAcpWorkerService, type AcpActivity, type AcpTurnListeners, type AcpTurnResult } from './acpWorkerService';
import {
  ACP_AGENT_TOOL_NAME,
  AcpAgentToolInputSchema,
  IAcpAgentTool,
  type AcpAgentAction,
  type AcpAgentToolInput,
} from './acp-agent';
import ACP_AGENT_DESCRIPTION from './acp-agent.md?raw';

interface SelectedAgent {
  readonly name: string;
  readonly config: AcpAgentConfig;
}

export class AcpAgentTool implements IAcpAgentTool {
  declare readonly _serviceBrand: undefined;
  readonly name = ACP_AGENT_TOOL_NAME;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(AcpAgentToolInputSchema);

  constructor(
    @IConfigService private readonly config: IConfigService,
    @IAcpWorkerService private readonly workers: IAcpWorkerService,
  ) {}

  get description(): string {
    const agents = this.configuredAgents();
    const names = Object.keys(agents);
    const listing =
      names.length === 0
        ? 'None configured. Add an [acp_agents.<name>] table (command, optional args/cwd/env) to config.toml.'
        : names
            .map((name) => {
              const agent = agents[name]!;
              const command = [agent.command, ...(agent.args ?? [])].join(' ');
              return `- ${name}: ${command}`;
            })
            .join('\n');
    return `${ACP_AGENT_DESCRIPTION}\n\nConfigured ACP agents:\n${listing}`;
  }

  resolveExecution(args: AcpAgentToolInput): ToolExecution {
    const action = args.action ?? 'run';
    const needsPrompt = action === 'run' || action === 'start' || action === 'steer';
    const needsWorker = action === 'steer' || action === 'wait' || action === 'status' || action === 'cancel';
    if (needsPrompt && args.prompt === undefined) {
      return { isError: true, output: `AcpAgent action "${action}" requires the prompt parameter.` };
    }
    if (needsWorker && args.worker_id === undefined) {
      return { isError: true, output: `AcpAgent action "${action}" requires the worker_id parameter.` };
    }

    const selected = action === 'run' || action === 'start' ? this.selectAgent(args.agent) : undefined;
    if (typeof selected === 'string') return { isError: true, output: selected };

    const snapshot = needsWorker ? this.workers.status(args.worker_id!) : undefined;
    const label = selected?.name ?? snapshot?.agentName ?? args.worker_id ?? args.agent ?? 'ACP agent';
    return {
      accesses: ToolAccesses.all(),
      description: describeAction(action, args.prompt),
      display: {
        kind: 'agent_call',
        agent_name: label,
        prompt: args.prompt ?? snapshot?.currentPrompt ?? '',
      },
      approvalRule: literalRulePattern(this.name, label),
      matchesRule: (ruleArgs) => ruleArgs === label,
      execute: (ctx) => this.execution(action, args, selected, ctx),
    };
  }

  private configuredAgents(): AcpAgentsConfig {
    return this.config.get<AcpAgentsConfig | undefined>(ACP_AGENTS_SECTION) ?? {};
  }

  private selectAgent(requested: string | undefined): SelectedAgent | string {
    const agents = this.configuredAgents();
    const names = Object.keys(agents);
    if (requested !== undefined) {
      const config = agents[requested];
      if (config === undefined) {
        return `Unknown ACP agent "${requested}". Configured agents: ${names.length === 0 ? 'none' : names.join(', ')}.`;
      }
      return { name: requested, config };
    }
    if (names.length === 1) {
      const name = names[0]!;
      return { name, config: agents[name]! };
    }
    if (names.length === 0) {
      return 'No ACP agent is configured. Add an [acp_agents.<name>] table (command, optional args/cwd/env) to config.toml, then retry.';
    }
    return `More than one ACP agent is configured (${names.join(', ')}); pass the agent parameter to choose one.`;
  }

  private async execution(
    action: AcpAgentAction,
    args: AcpAgentToolInput,
    selected: SelectedAgent | undefined,
    ctx: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    try {
      switch (action) {
        case 'run':
          return await this.run(selected!, args, ctx);
        case 'start':
          return await this.start(selected!, args, ctx);
        case 'steer':
          return await this.steer(args, ctx);
        case 'wait':
          return await this.wait(args, ctx);
        case 'status':
          return this.status(args);
        case 'cancel':
          return await this.cancel(args);
      }
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      return {
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async run(
    selected: SelectedAgent,
    args: AcpAgentToolInput,
    ctx: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    const started = await this.workers.start({
      agentName: selected.name,
      config: selected.config,
      prompt: args.prompt!,
      cwd: args.cwd,
      interaction: interactionOf(ctx),
      listeners: listenersOf(ctx),
    });
    try {
      const result = await this.workers.wait({
        workerId: started.workerId,
        signal: ctx.signal,
        interaction: interactionOf(ctx),
        listeners: listenersOf(ctx),
      });
      return formatTurnResult(started.workerId, result);
    } finally {
      await this.workers.cancel(started.workerId);
    }
  }

  private async start(
    selected: SelectedAgent,
    args: AcpAgentToolInput,
    ctx: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    const started = await this.workers.start({
      agentName: selected.name,
      config: selected.config,
      prompt: args.prompt!,
      cwd: args.cwd,
      interaction: interactionOf(ctx),
      listeners: listenersOf(ctx),
    });
    return {
      output: [
        `worker_id: ${started.workerId}`,
        `session: ${started.sessionId}`,
        `agent: ${selected.name}`,
        ...(started.model === undefined ? [] : [`model: ${started.model}`]),
        ...(started.effort === undefined ? [] : [`effort: ${started.effort}`]),
        'status: running',
        `next_step: AcpAgent(action="wait", worker_id="${started.workerId}") collects the result; action="steer" redirects the worker; action="status" peeks; action="cancel" stops it.`,
      ].join('\n'),
    };
  }

  private async steer(
    args: AcpAgentToolInput,
    ctx: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    const snapshot = await this.workers.steer({
      workerId: args.worker_id!,
      prompt: args.prompt!,
      interaction: interactionOf(ctx),
      listeners: listenersOf(ctx),
    });
    return {
      output:
        `worker ${snapshot.workerId} (${snapshot.agentName}): steered.\n` +
        `The previous turn was cancelled and the new prompt is running.\n` +
        `next_step: AcpAgent(action="wait", worker_id="${snapshot.workerId}") collects the result.`,
    };
  }

  private async wait(
    args: AcpAgentToolInput,
    ctx: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    const result = await this.workers.wait({
      workerId: args.worker_id!,
      signal: ctx.signal,
      interaction: interactionOf(ctx),
      listeners: listenersOf(ctx),
    });
    return formatTurnResult(args.worker_id!, result);
  }

  private status(args: AcpAgentToolInput): ExecutableToolResult {
    const snapshot = this.workers.status(args.worker_id!);
    if (snapshot === undefined) {
      return {
        isError: true,
        output: `Unknown ACP worker "${args.worker_id}".`,
      };
    }
    return { output: formatSnapshot(snapshot) };
  }

  private async cancel(args: AcpAgentToolInput): Promise<ExecutableToolResult> {
    const snapshot = await this.workers.cancel(args.worker_id!);
    if (snapshot === undefined) {
      return {
        isError: true,
        output: `Unknown ACP worker "${args.worker_id}".`,
      };
    }
    return {
      output: `worker ${snapshot.workerId} (${snapshot.agentName}): cancelled and closed after ${String(snapshot.turns)} turn(s).`,
    };
  }
}

function interactionOf(ctx: ExecutableToolContext): { turnId: number; toolCallId: string } {
  return { turnId: ctx.turnId, toolCallId: ctx.toolCallId };
}

function listenersOf(ctx: ExecutableToolContext): AcpTurnListeners {
  return {
    onText: (text) => {
      ctx.write?.(text);
    },
    onActivity: (activity) => {
      const lines = activity.tools.map(toolLine);
      if (activity.plan.length > 0) {
        const done = activity.plan.filter((entry) => entry.status === 'completed').length;
        lines.push(`plan ${done}/${activity.plan.length}`);
        for (const entry of activity.plan) lines.push(`${planBox(entry.status)} ${entry.content}`);
      }
      if (lines.length === 0) return;
      ctx.onUpdate?.({
        kind: 'status',
        text: lines.join('\n'),
        replace: true,
      });
    },
  };
}

function toolLine(call: AcpActivity['tools'][number]): string {
  if (call.status === 'completed') return `[x] ${call.title}`;
  if (call.status === 'failed') return `[!] ${call.title}`;
  return `[>] ${call.title}`;
}

function planBox(status: AcpActivity['plan'][number]['status']): string {
  if (status === 'completed') return '[x]';
  if (status === 'in_progress') return '[>]';
  return '[ ]';
}

function formatTurnResult(workerId: string, result: AcpTurnResult): ExecutableToolResult {
  const text = result.text.trim();
  const note = result.stopReason === 'end_turn' ? '' : `\n\n[acp] stopped: ${result.stopReason}`;
  const body =
    text.length === 0
      ? `ACP worker ${workerId} returned no text (stop reason: ${result.stopReason}).${note}`
      : `${text}${note}`;
  return result.error === undefined
    ? { output: body }
    : { isError: true, output: `${body}\n\n[acp] error: ${result.error}` };
}

function formatSnapshot(snapshot: {
  readonly workerId: string;
  readonly agentName: string;
  readonly state: string;
  readonly turns: number;
  readonly lastStopReason?: string;
  readonly lastError?: string;
  readonly currentPrompt?: string;
  readonly model?: string;
  readonly effort?: string;
  readonly output: string;
}): string {
  const lines = [
    `worker_id: ${snapshot.workerId}`,
    `agent: ${snapshot.agentName}`,
    `state: ${snapshot.state}`,
    `turns: ${String(snapshot.turns)}`,
  ];
  if (snapshot.model !== undefined) lines.push(`model: ${snapshot.model}`);
  if (snapshot.effort !== undefined) lines.push(`effort: ${snapshot.effort}`);
  if (snapshot.currentPrompt !== undefined) lines.push(`current_prompt: ${snapshot.currentPrompt}`);
  if (snapshot.lastStopReason !== undefined) lines.push(`last_stop_reason: ${snapshot.lastStopReason}`);
  if (snapshot.lastError !== undefined) lines.push(`last_error: ${snapshot.lastError}`);
  if (snapshot.output.length > 0) lines.push('', snapshot.output);
  return lines.join('\n');
}

function describeAction(action: AcpAgentAction, prompt: string | undefined): string {
  if (action === 'status') return 'Checking ACP worker status';
  if (action === 'wait') return 'Waiting for ACP worker';
  if (action === 'cancel') return 'Cancelling ACP worker';
  const preview = prompt === undefined || prompt.length <= 60 ? (prompt ?? '') : `${prompt.slice(0, 60)}…`;
  return action === 'steer' ? `Steering ACP worker: ${preview}` : `Running ACP agent: ${preview}`;
}

registerAgentToolService(IAcpAgentTool, AcpAgentTool, {
  name: ACP_AGENT_TOOL_NAME,
  domain: 'acp',
  when: (accessor) => accessor.get(IFlagService).enabled(ACP_AGENT_FLAG_ID),
});
