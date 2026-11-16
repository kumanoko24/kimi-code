import { Readable, Writable } from 'node:stream';

import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type StopReason,
  type ActiveSession,
  type ClientConnection,
  type PlanEntry,
} from '@agentclientprotocol/sdk';

import type { IHostProcess } from '#/os/interface/hostProcess';

export interface AcpToolCallEvent {
  readonly id: string;
  readonly title: string;
  readonly status?: string;
}

export interface AcpSessionOptions {
  readonly process: IHostProcess;
  readonly cwd: string;
  readonly model?: string;
  readonly effort?: string;
  readonly requestPermission: (
    request: RequestPermissionRequest,
  ) => Promise<RequestPermissionResponse>;
  readonly onText: (text: string) => void;
  readonly onToolCall: (call: AcpToolCallEvent) => void;
  readonly onPlan: (entries: readonly PlanEntry[]) => void;
}

export interface AcpPromptResult {
  readonly stopReason: StopReason;
}

export interface AcpSession {
  readonly sessionId: string;
  readonly config: { readonly model?: string; readonly effort?: string };
  readonly closed: Promise<void>;
  prompt(text: string, signal: AbortSignal): Promise<AcpPromptResult>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}

export async function openAcpSession(options: AcpSessionOptions): Promise<AcpSession> {
  const toolTitles = new Map<string, string>();
  const app = client({ name: 'kimi-code' })
    .onNotification(methods.client.session.update, (context) => {
      const update = context.params.update;
      if (update.sessionUpdate === 'agent_message_chunk') {
        if (update.content.type === 'text') options.onText(update.content.text);
        return;
      }
      if (update.sessionUpdate === 'tool_call') {
        toolTitles.set(update.toolCallId, update.title);
        options.onToolCall({
          id: update.toolCallId,
          title: update.title,
          status: update.status ?? undefined,
        });
        return;
      }
      if (update.sessionUpdate === 'tool_call_update') {
        const title = update.title ?? toolTitles.get(update.toolCallId);
        if (title === undefined) return;
        toolTitles.set(update.toolCallId, title);
        options.onToolCall({
          id: update.toolCallId,
          title,
          status: update.status ?? undefined,
        });
        return;
      }
      if (update.sessionUpdate === 'plan') {
        options.onPlan(update.entries);
      }
    })
    .onRequest(methods.client.session.requestPermission, (context) =>
      options.requestPermission(context.params),
    );

  const stream = ndJsonStream(
    Writable.toWeb(options.process.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(options.process.stdout) as ReadableStream<Uint8Array>,
  );
  const connection = app.connect(stream);
  connection.closed.catch(() => {});

  try {
    await connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    });
    const session = await connection.agent
      .buildSession({ cwd: options.cwd, mcpServers: [] })
      .start();
    const config = await applySessionConfig(connection, session, options);
    let closing = false;
    let activePrompt: Promise<{ readonly stopReason: StopReason }> | undefined;
    const cancelTurn = (): Promise<void> =>
      connection.agent
        .notify(methods.agent.session.cancel, { sessionId: session.sessionId })
        .catch(() => undefined);

    return {
      sessionId: session.sessionId,
      config,
      closed: connection.closed,
      async prompt(text, signal) {
        if (signal.aborted) throw signal.reason;
        let rejectAborted: ((reason: unknown) => void) | undefined;
        const aborted = new Promise<never>((_resolve, reject) => {
          rejectAborted = reject;
        });
        aborted.catch(() => {});
        const onAbort = (): void => {
          void cancelTurn();
          rejectAborted?.(signal.reason);
        };
        const response = session.prompt(text);
        activePrompt = response;
        response.finally(() => {
          if (activePrompt === response) activePrompt = undefined;
        }).catch(() => {});
        signal.addEventListener('abort', onAbort, { once: true });
        try {
          const settled = await Promise.race([response, aborted]);
          return { stopReason: settled.stopReason };
        } finally {
          signal.removeEventListener('abort', onAbort);
        }
      },
      async cancel() {
        if (closing) return;
        await cancelTurn();
        await activePrompt?.catch(() => undefined);
      },
      async close() {
        if (closing) return;
        closing = true;
        session.dispose();
        connection.close();
        await connection.closed.catch(() => undefined);
      },
    };
  } catch (error) {
    connection.close();
    throw error;
  }
}

async function applySessionConfig(
  connection: ClientConnection,
  session: ActiveSession,
  options: Pick<AcpSessionOptions, 'model' | 'effort'>,
): Promise<{ readonly model?: string; readonly effort?: string }> {
  const configs = session.newSessionResponse.configOptions ?? [];
  const applied: { model?: string; effort?: string } = {};
  for (const [category, value, label] of [
    ['model', options.model, 'model'],
    ['thought_level', options.effort, 'effort'],
  ] as const) {
    if (value === undefined) continue;
    const option = configs.find(
      (candidate) => candidate.category === category || candidate.id === category,
    );
    if (option === undefined) {
      throw new Error(
        `This ACP agent does not expose a ${label} selector; remove ${label} from its [acp_agents] entry or use an agent that supports it.`,
      );
    }
    try {
      await connection.agent.request(methods.agent.session.setConfigOption, {
        sessionId: session.sessionId,
        configId: option.id,
        value,
      });
    } catch (error) {
      throw new Error(
        `The ACP agent rejected ${label} "${value}": ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    applied[label] = value;
  }
  return applied;
}
