import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

import type {
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
  StopReason,
} from '@agentclientprotocol/sdk';

import { createDecorator } from '#/_base/di/instantiation';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Service } from '#/_base/di/service';
import { abortable, linkAbortSignal } from '#/_base/utils/abort';
import {
  acquireOrWhenReady,
  IAgentEnvironmentService,
} from '#/agent/environmentBinding/agentEnvironment';
import type { ApprovalResponse } from '#/agent/interaction/approval';
import { IAgentPermissionModeService } from '#/agent/permissionMode/permissionMode';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IConfigService } from '#/app/config/config';
import { LifecycleScope } from '#/app/scopes';
import type { EnvironmentLease } from '#/environment/environment';
import { EnvironmentWorkspaceView } from '#/environment/environmentWorkspaceView';
import { interactions } from '#/human/interaction/facade';
import {
  INTERACTION_TAG_AGENT_ID,
  INTERACTION_TAG_SESSION_ID,
  INTERACTION_TAG_TOOL_CALL_ID,
  INTERACTION_TAG_TURN_ID,
} from '#/human/interaction/interaction';
import type { IHostProcess } from '#/os/interface/hostProcess';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import { resolveSubagentTimeoutMs } from '#/session/subagent/configSection';
import { ISessionWorkspaceContext } from '#/session/workspaceContext/workspaceContext';

import { openAcpSession, type AcpSession } from './acpClient';
import type { AcpAgentConfig } from './configSection';

const STATUS_TEXT_TAIL_CHARS = 4_000;
const STDERR_TAIL_MAX_CHARS = 4_000;

export type AcpWorkerState = 'running' | 'idle' | 'failed' | 'closed';

export interface AcpWorkerInteraction {
  readonly turnId: number;
  readonly toolCallId: string;
}

export interface AcpTurnListeners {
  readonly onText?: (text: string) => void;
  readonly onToolCall?: (title: string, status: string | undefined) => void;
}

export interface AcpTurnResult {
  readonly prompt: string;
  readonly text: string;
  readonly stopReason: StopReason | 'error';
  readonly error?: string;
}

export interface AcpWorkerSnapshot {
  readonly workerId: string;
  readonly agentName: string;
  readonly state: AcpWorkerState;
  readonly turns: number;
  readonly output: string;
  readonly lastStopReason?: string;
  readonly lastError?: string;
  readonly currentPrompt?: string;
  readonly model?: string;
  readonly effort?: string;
}

export interface StartAcpWorkerOptions {
  readonly agentName: string;
  readonly config: AcpAgentConfig;
  readonly prompt: string;
  readonly cwd?: string;
  readonly interaction: AcpWorkerInteraction;
  readonly listeners?: AcpTurnListeners;
}

export interface SteerAcpWorkerOptions {
  readonly workerId: string;
  readonly prompt: string;
  readonly interaction: AcpWorkerInteraction;
  readonly listeners?: AcpTurnListeners;
}

export interface WaitAcpWorkerOptions {
  readonly workerId: string;
  readonly signal: AbortSignal;
  readonly interaction: AcpWorkerInteraction;
  readonly listeners?: AcpTurnListeners;
}

export interface IAcpWorkerService {
  readonly _serviceBrand: undefined;

  start(options: StartAcpWorkerOptions): Promise<{
    workerId: string;
    sessionId: string;
    model?: string;
    effort?: string;
  }>;
  steer(options: SteerAcpWorkerOptions): Promise<AcpWorkerSnapshot>;
  wait(options: WaitAcpWorkerOptions): Promise<AcpTurnResult>;
  status(workerId: string): AcpWorkerSnapshot | undefined;
  cancel(workerId: string): Promise<AcpWorkerSnapshot | undefined>;
  list(): readonly AcpWorkerSnapshot[];
}

export const IAcpWorkerService = createDecorator<IAcpWorkerService>('acpWorkerService');

interface Turn {
  readonly prompt: string;
  readonly controller: AbortController;
  listeners: AcpTurnListeners;
  text: string;
  completion: Promise<AcpTurnResult>;
}

interface Worker {
  readonly id: string;
  readonly agentName: string;
  readonly config: AcpAgentConfig;
  readonly cwd: string;
  readonly lease: EnvironmentLease;
  readonly proc: IHostProcess;
  readonly session: AcpSession;
  readonly stderr: StderrTail;
  readonly sessionConfig: { readonly model?: string; readonly effort?: string };
  readonly lifetime: AbortController;
  state: AcpWorkerState;
  sessionClosed: boolean;
  turns: number;
  interaction: AcpWorkerInteraction;
  current?: Turn;
  last?: AcpTurnResult;
  lastError?: string;
}

export class AcpWorkerService extends Service implements IAcpWorkerService {
  declare readonly _serviceBrand: undefined;
  private readonly workers = new Map<string, Worker>();

  constructor(
    @IAgentEnvironmentService private readonly environment: IAgentEnvironmentService,
    @ISessionWorkspaceContext private readonly workspace: ISessionWorkspaceContext,
    @ISessionContext private readonly session: ISessionContext,
    @IAgentScopeContext private readonly scopeContext: IAgentScopeContext,
    @IConfigService private readonly configService: IConfigService,
    @IAgentPermissionModeService private readonly permissionMode: IAgentPermissionModeService,
    @IBootstrapService private readonly bootstrap: IBootstrapService,
  ) {
    super();
  }

  async start(options: StartAcpWorkerOptions): Promise<{
    workerId: string;
    sessionId: string;
    model?: string;
    effort?: string;
  }> {
    const lease = await acquireOrWhenReady(this.environment, ['process']);
    let proc: IHostProcess | undefined;
    let stderr: StderrTail | undefined;
    const timeoutMs = resolveSubagentTimeoutMs(this.configService);
    const openController = new AbortController();
    const openTimeout =
      timeoutMs > 0
        ? setTimeout(() => {
            openController.abort(
              new Error(
                `ACP agent "${options.agentName}" did not start within ${formatDuration(timeoutMs)}`,
              ),
            );
          }, timeoutMs)
        : undefined;
    openTimeout?.unref?.();
    try {
      const view = new EnvironmentWorkspaceView(lease.environment, this.workspace);
      const cwd = view.resolve(options.cwd ?? options.config.cwd ?? view.workDir);
      const processService = lease.environment.process;
      if (processService === undefined) {
        throw new Error('The current environment does not provide processes.');
      }
      proc = lease.track(
        await processService.spawn(options.config.command, options.config.args ?? [], {
          cwd,
          env: options.config.env,
        }),
        this.session.sessionId,
      );
      stderr = new StderrTail(proc.stderr, STDERR_TAIL_MAX_CHARS);

      const id = `acp_${randomUUID().slice(0, 8)}`;
      let worker: Worker | undefined;
      const lifetime = new AbortController();
      const session = await abortable(
        openAcpSession({
          process: proc,
          cwd,
          model: options.config.model,
          effort: options.config.effort,
          requestPermission: (request) =>
            worker === undefined
              ? Promise.resolve(selectPermissionOption(request.options, 'reject'))
              : this.requestPermission(worker, request),
          onText: (text) => {
            const turn = worker?.current;
            if (turn === undefined) return;
            turn.text += text;
            turn.listeners.onText?.(text);
          },
          onToolCall: (title, status) => {
            worker?.current?.listeners.onToolCall?.(title, status);
          },
        }),
        openController.signal,
      );
      const created: Worker = {
        id,
        agentName: options.agentName,
        config: options.config,
        cwd,
        lease,
        proc,
        session,
        stderr,
        sessionConfig: session.config,
        lifetime,
        state: 'idle',
        sessionClosed: false,
        turns: 0,
        interaction: options.interaction,
      };
      worker = created;
      session.closed.then(
        () => {
          created.sessionClosed = true;
          if (created.state !== 'closed') created.state = 'closed';
        },
        () => {
          created.sessionClosed = true;
          if (created.state !== 'closed') created.state = 'closed';
        },
      );
      this.workers.set(id, created);
      this._register({
        dispose: () => {
          void this.closeWorker(created);
        },
      });
      this.startTurn(created, options.prompt, options.listeners ?? {});
      return {
        workerId: id,
        sessionId: session.sessionId,
        model: session.config.model,
        effort: session.config.effort,
      };
    } catch (error) {
      openController.abort();
      if (proc !== undefined && proc.exitCode === null) {
        await proc.kill('SIGTERM').catch(() => undefined);
      }
      await Promise.resolve(proc?.dispose()).catch(() => undefined);
      stderr?.dispose();
      lease.dispose();
      const message = error instanceof Error ? error.message : String(error);
      const tail = stderr?.text() ?? '';
      throw new Error(tail.length === 0 ? message : `${message}\n\n${tail}`, { cause: error });
    } finally {
      if (openTimeout !== undefined) clearTimeout(openTimeout);
    }
  }

  async steer(options: SteerAcpWorkerOptions): Promise<AcpWorkerSnapshot> {
    const worker = this.requireWorker(options.workerId);
    worker.interaction = options.interaction;
    if (worker.state === 'closed') throw new Error(`ACP worker ${worker.id} is closed.`);
    const current = worker.current;
    if (current !== undefined) {
      await worker.session.cancel();
      await current.completion;
    }
    if (worker.sessionClosed) throw new Error(`ACP worker ${worker.id} closed while being steered.`);
    this.startTurn(worker, options.prompt, options.listeners ?? {});
    return snapshotOf(worker);
  }

  async wait(options: WaitAcpWorkerOptions): Promise<AcpTurnResult> {
    const worker = this.requireWorker(options.workerId);
    worker.interaction = options.interaction;
    const current = worker.current;
    if (current !== undefined) {
      current.listeners = options.listeners ?? current.listeners;
      return abortable(current.completion, options.signal);
    }
    if (worker.last !== undefined) return worker.last;
    throw new Error(`ACP worker ${worker.id} has not run a prompt yet.`);
  }

  status(workerId: string): AcpWorkerSnapshot | undefined {
    const worker = this.workers.get(workerId);
    return worker === undefined ? undefined : snapshotOf(worker);
  }

  async cancel(workerId: string): Promise<AcpWorkerSnapshot | undefined> {
    const worker = this.workers.get(workerId);
    if (worker === undefined) return undefined;
    const snapshot = snapshotOf(worker);
    await this.closeWorker(worker);
    return { ...snapshot, state: 'closed' };
  }

  list(): readonly AcpWorkerSnapshot[] {
    return [...this.workers.values()].map(snapshotOf);
  }

  override dispose(): void {
    for (const worker of this.workers.values()) {
      void this.closeWorker(worker);
    }
    this.workers.clear();
    super.dispose();
  }

  private startTurn(worker: Worker, prompt: string, listeners: AcpTurnListeners): void {
    if (worker.state === 'closed') throw new Error(`ACP worker ${worker.id} is closed.`);
    if (worker.current !== undefined) {
      throw new Error(`ACP worker ${worker.id} is already running a turn; steer it instead.`);
    }
    const controller = new AbortController();
    linkAbortSignal(worker.lifetime.signal, controller);
    const timeoutMs = resolveSubagentTimeoutMs(this.configService);
    let timedOut = false;
    const timeout =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort(new Error(`ACP turn timed out after ${formatDuration(timeoutMs)}`));
          }, timeoutMs)
        : undefined;
    timeout?.unref?.();
    const turn: Turn = {
      prompt,
      controller,
      listeners,
      text: '',
      completion: Promise.resolve({ prompt, text: '', stopReason: 'end_turn' }),
    };
    worker.current = turn;
    worker.state = 'running';
    worker.turns += 1;
    turn.completion = (async () => {
      try {
        const result = await worker.session.prompt(prompt, controller.signal);
        const outcome: AcpTurnResult = {
          prompt,
          text: turn.text,
          stopReason: result.stopReason,
        };
        worker.last = outcome;
        worker.state = 'idle';
        worker.lastError = undefined;
        return outcome;
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        const tail = worker.stderr.text();
        const message = tail.length === 0 ? raw : `${raw}\n\n${tail}`;
        const outcome: AcpTurnResult = {
          prompt,
          text: turn.text,
          stopReason: 'error',
          error: message,
        };
        worker.last = outcome;
        worker.lastError = message;
        worker.state = worker.sessionClosed ? 'closed' : timedOut ? 'failed' : 'idle';
        return outcome;
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
        if (worker.current === turn) worker.current = undefined;
      }
    })();
    turn.completion.catch(() => {});
  }

  private async closeWorker(worker: Worker): Promise<void> {
    worker.state = 'closed';
    worker.lifetime.abort(new Error(`ACP worker ${worker.id} was stopped.`));
    await worker.current?.completion;
    await worker.session.close().catch(() => undefined);
    worker.stderr.dispose();
    if (worker.proc.exitCode === null) {
      await worker.proc.kill('SIGTERM').catch(() => undefined);
    }
    await Promise.resolve(worker.proc.dispose()).catch(() => undefined);
    worker.lease.dispose();
    this.workers.delete(worker.id);
  }

  private requireWorker(workerId: string): Worker {
    const worker = this.workers.get(workerId);
    if (worker === undefined) {
      const known = [...this.workers.keys()].join(', ');
      throw new Error(
        `Unknown ACP worker "${workerId}". ${known.length === 0 ? 'No worker is running.' : `Running workers: ${known}.`}`,
      );
    }
    return worker;
  }

  private async requestPermission(
    worker: Worker,
    request: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    if (this.permissionMode.mode !== 'manual') {
      return selectPermissionOption(request.options, 'allow');
    }
    if (this.bootstrap.args.nonInteractive === true) {
      return selectPermissionOption(request.options, 'reject');
    }
    const title = request.toolCall.title ?? 'External agent tool call';
    const id = `acp_permission_${randomUUID()}`;
    const interaction = worker.interaction;
    try {
      const response = await abortable(
        interactions.request<Record<string, unknown>, ApprovalResponse>({
          id,
          kind: 'approval',
          payload: {
            id,
            sessionId: this.session.sessionId,
            agentId: this.scopeContext.agentId,
            turnId: interaction.turnId,
            toolCallId: interaction.toolCallId,
            toolName: 'AcpAgent',
            action: title,
            display: {
              kind: 'generic',
              summary: title,
              detail: { agent: worker.agentName, tool: title },
            },
          },
          tags: {
            [INTERACTION_TAG_AGENT_ID]: this.scopeContext.agentId,
            [INTERACTION_TAG_SESSION_ID]: this.session.sessionId,
            [INTERACTION_TAG_TURN_ID]: interaction.turnId,
            [INTERACTION_TAG_TOOL_CALL_ID]: interaction.toolCallId,
          },
        }),
        worker.lifetime.signal,
      );
      return response.decision === 'approved'
        ? selectPermissionOption(request.options, 'allow', response.scope === 'session')
        : selectPermissionOption(request.options, 'reject', response.scope === 'session');
    } catch {
      return { outcome: { outcome: 'cancelled' } };
    }
  }
}

function snapshotOf(worker: Worker): AcpWorkerSnapshot {
  const text = worker.current?.text ?? worker.last?.text ?? '';
  return {
    workerId: worker.id,
    agentName: worker.agentName,
    state: worker.state,
    turns: worker.turns,
    output: tail(text, STATUS_TEXT_TAIL_CHARS),
    lastStopReason: worker.last?.stopReason,
    lastError: worker.lastError,
    currentPrompt: worker.current?.prompt,
    model: worker.sessionConfig.model,
    effort: worker.sessionConfig.effort,
  };
}

function tail(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(-maxChars);
}

function selectPermissionOption(
  options: readonly PermissionOption[],
  decision: 'allow' | 'reject',
  sessionScope = false,
): RequestPermissionResponse {
  const preferred: PermissionOption['kind'][] =
    decision === 'allow'
      ? sessionScope
        ? ['allow_always', 'allow_once']
        : ['allow_once', 'allow_always']
      : sessionScope
        ? ['reject_always', 'reject_once']
        : ['reject_once', 'reject_always'];
  for (const kind of preferred) {
    const option = options.find((candidate) => candidate.kind === kind);
    if (option !== undefined) {
      return { outcome: { outcome: 'selected', optionId: option.optionId } };
    }
  }
  const fallback = options.find((candidate) =>
    decision === 'allow' ? candidate.kind.startsWith('allow') : candidate.kind.startsWith('reject'),
  );
  return fallback === undefined
    ? { outcome: { outcome: 'cancelled' } }
    : { outcome: { outcome: 'selected', optionId: fallback.optionId } };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  if (ms < 60_000) return `${String(Math.round(ms / 1000))}s`;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(rest)}m`;
}

class StderrTail {
  private tail = '';
  private readonly onData: (chunk: Buffer | string) => void;

  constructor(
    private readonly stream: Readable,
    private readonly maxChars: number,
  ) {
    this.onData = (chunk) => {
      this.tail += chunk.toString();
      if (this.tail.length > this.maxChars) {
        this.tail = this.tail.slice(-this.maxChars);
      }
    };
    this.stream.on('data', this.onData);
  }

  text(): string {
    return this.tail.trim();
  }

  dispose(): void {
    this.stream.off('data', this.onData);
  }
}

registerScopedService(
  LifecycleScope.Agent,
  IAcpWorkerService,
  AcpWorkerService,
  ScopeActivation.OnScopeCreated,
  'acp',
);
