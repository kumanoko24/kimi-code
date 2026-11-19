import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, join } from 'node:path';

import { watch, type FSWatcher } from 'chokidar';

import { toDisposable } from '#/_base/di/lifecycle';
import { Service } from '#/_base/di/service';
import { abortable } from '#/_base/utils/abort';
import { IAgentLoopService } from '#/agent/loop/loop';
import type { ApprovalResponse } from '#/agent/interaction/approval';
import { IAgentLifecycleService, MAIN_AGENT_ID } from '#/session/agentLifecycle/agentLifecycle';
import { IAgentPermissionModeService } from '#/agent/permissionMode/permissionMode';
import type { PermissionMode } from '#/agent/permissionPolicy/types';
import { ILogService } from '#/_base/log/log';
import { ISessionEventBus } from '#/app/event/eventBus';
import { AgentStatusUpdated } from '#/agent/usage/usageEvents';
import { IAgentSwarmService } from '#/features/swarm/agent/swarm';
import { IAgentTowerService } from '#/features/tower/tower';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IConfigService } from '#/app/config/config';
import { interactions } from '#/human/interaction/facade';
import {
  INTERACTION_TAG_AGENT_ID,
  INTERACTION_TAG_SESSION_ID,
  INTERACTION_TAG_TOOL_CALL_ID,
} from '#/human/interaction/interaction';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import { ISessionMetadata } from '#/session/sessionMetadata/sessionMetadata';
import type { UserPromptOrigin } from '@moonshot-ai/core/llm/origin';

import { PEERS_SECTION, type PeersConfig } from './configSection';
import {
  archivePeerMessage,
  defaultPeerName,
  ensurePeerDirs,
  inboxDir,
  listPeers,
  parsePeerMessage,
  peerMessageText,
  peerNameFromTitle,
  registerPeer,
  resolvePeer,
  unregisterPeer,
  writePeerMessage,
} from './peerRegistry';
import {
  DEFAULT_MAX_PEER_MESSAGE_CHARS,
  IPeerService,
  type PeerInfo,
  type PeerListEntry,
  type PeerMessage,
} from './peers';

export class PeerService extends Service implements IPeerService {
  declare readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  self: PeerInfo;

  private readonly homeDir: string;
  private readonly inbox: string;
  private readonly disposeController = new AbortController();
  private readonly inFlight = new Set<string>();
  private watcher: FSWatcher | undefined;

  constructor(
    @ISessionContext private readonly session: ISessionContext,
    @IBootstrapService private readonly bootstrap: IBootstrapService,
    @IConfigService private readonly configService: IConfigService,
    @IAgentLifecycleService private readonly lifecycle: IAgentLifecycleService,
    @ISessionEventBus private readonly eventBus: ISessionEventBus,
    @ISessionMetadata private readonly metadata: ISessionMetadata,
    @ILogService private readonly log: ILogService,
  ) {
    super();
    this.homeDir = bootstrap.homeDir;
    this.inbox = inboxDir(this.homeDir, session.sessionId);
    const config = this.readConfig();
    this.self = {
      sessionId: session.sessionId,
      name: defaultPeerName(session.cwd, session.sessionId, config.name),
      cwd: session.cwd,
      pid: process.pid,
      hostname: hostname(),
      startedAt: new Date().toISOString(),
    };
    this.ready = this.start();
  }

  private readConfig(): PeersConfig {
    return this.configService.get<PeersConfig | undefined>(PEERS_SECTION) ?? {};
  }

  private async syncName(): Promise<void> {
    const meta = await this.metadata.read();
    const title = meta.titleKind === 'custom' ? peerNameFromTitle(meta.title ?? '') : undefined;
    const name = title ?? defaultPeerName(this.session.cwd, this.session.sessionId, this.readConfig().name);
    if (name === this.self.name) return;
    this.self = { ...this.self, name };
    await registerPeer(this.homeDir, this.self);
  }

  private async start(): Promise<void> {
    await ensurePeerDirs(this.homeDir);
    await mkdir(this.inbox, { recursive: true, mode: 0o700 });
    await this.syncName();
    await registerPeer(this.homeDir, this.self);
    this.watcher = watch(this.inbox, { ignoreInitial: false, depth: 0 });
    this.watcher.on('add', (file) => {
      if (!file.endsWith('.json') || basename(file).startsWith('.')) return;
      void this.process(file);
    });
    this.watcher.on('error', (error) => {
      this.log.warn('peer inbox watcher failed', { error: String(error) });
    });
    this._register(
      this.eventBus.subscribe(AgentStatusUpdated, (event) => {
        if (event.agentId !== MAIN_AGENT_ID) return;
        if (event.swarmMode === false || event.towerMode === false) void this.processInbox();
      }),
    );
    this._register(
      this.metadata.onDidChangeMetadata((event) => {
        if (event.changed.includes('title') || event.changed.includes('titleKind')) {
          void this.syncName();
        }
      }),
    );
    this._register(
      toDisposable(() => {
        this.disposeController.abort(new Error('peer service disposed'));
        void this.watcher?.close();
        void unregisterPeer(this.homeDir, this.self.sessionId);
      }),
    );
    if (this.lifecycle.handleOf(MAIN_AGENT_ID) !== undefined) {
      await this.processInbox();
      return;
    }
    this._register(
      this.lifecycle.onDidCreate((context) => {
        if (context.agentId !== MAIN_AGENT_ID) return;
        void this.processInbox();
      }),
    );
  }

  async list(): Promise<readonly PeerListEntry[]> {
    await this.ready;
    const peers = await listPeers(this.homeDir);
    const entries = peers.map((peer) => ({ ...peer, self: peer.sessionId === this.self.sessionId }));
    if (!entries.some((peer) => peer.self)) {
      entries.unshift({ ...this.self, self: true });
    }
    return entries.toSorted((left, right) => {
      if (left.self !== right.self) return left.self ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  }

  async send(input: {
    readonly to: string;
    readonly text: string;
    readonly agent?: string;
  }): Promise<{ readonly messageId: string; readonly to: PeerInfo }> {
    await this.ready;
    const text = input.text.trim();
    if (text.length === 0) throw new Error('Cannot send an empty peer message.');
    const maxChars = this.readConfig().maxMessageChars ?? DEFAULT_MAX_PEER_MESSAGE_CHARS;
    if (text.length > maxChars) {
      throw new Error(
        `Peer message is ${String(text.length)} characters; the limit is ${String(maxChars)}. Split it or send a file path instead.`,
      );
    }
    const target = resolvePeer(await listPeers(this.homeDir), input.to);
    if (target.sessionId === this.self.sessionId) {
      throw new Error('Cannot send a peer message to the current session.');
    }
    const message: PeerMessage = {
      id: randomUUID(),
      from: { ...this.self, agent: input.agent },
      to: target.sessionId,
      text,
      sentAt: new Date().toISOString(),
    };
    await writePeerMessage(this.homeDir, message);
    return { messageId: message.id, to: target };
  }

  private async processInbox(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(this.inbox);
    } catch {
      return;
    }
    for (const file of files) {
      if (!file.endsWith('.json') || file.startsWith('.')) continue;
      await this.process(join(this.inbox, file));
    }
  }

  private async process(file: string): Promise<void> {
    if (this.inFlight.has(file)) return;
    this.inFlight.add(file);
    try {
      if (!(await lstat(file)).isFile()) {
        this.inFlight.delete(file);
        return;
      }
    } catch {
      this.inFlight.delete(file);
      return;
    }
    let message: PeerMessage | undefined;
    try {
      message = parsePeerMessage(JSON.parse(await readFile(file, 'utf8')));
    } catch {
      message = undefined;
    }
    if (message === undefined) {
      await rm(file, { force: true });
      this.inFlight.delete(file);
      return;
    }
    try {
      if (message.to !== this.self.sessionId) {
        this.log.warn('peer message delivered to the wrong inbox', {
          messageId: message.id,
          to: message.to,
        });
        await archivePeerMessage(this.homeDir, this.self.sessionId, file, message.id, 'failed');
        return;
      }
      if (message.from.sessionId === this.self.sessionId) {
        await archivePeerMessage(this.homeDir, this.self.sessionId, file, message.id, 'refused');
        return;
      }
      if (this.lifecycle.handleOf(MAIN_AGENT_ID) === undefined) return;
      if (this.modeActive()) return;
      const config = this.readConfig();
      const maxChars = config.maxMessageChars ?? DEFAULT_MAX_PEER_MESSAGE_CHARS;
      if (message.text.length > maxChars) {
        await archivePeerMessage(this.homeDir, this.self.sessionId, file, message.id, 'refused');
        return;
      }
      const policy = config.inbound ?? 'hold';
      if (policy === 'refuse') {
        await archivePeerMessage(this.homeDir, this.self.sessionId, file, message.id, 'refused');
        return;
      }
      if (policy === 'hold') {
        if (this.permissionMode() !== 'auto') {
          if (this.bootstrap.args.nonInteractive === true) {
            await archivePeerMessage(this.homeDir, this.self.sessionId, file, message.id, 'refused');
            return;
          }
          const approval = await this.requestApproval(message);
          if (approval === 'aborted') return;
          if (approval === 'refused') {
            await archivePeerMessage(this.homeDir, this.self.sessionId, file, message.id, 'refused');
            return;
          }
        }
      } else if (policy !== 'accept') {
        await archivePeerMessage(this.homeDir, this.self.sessionId, file, message.id, 'refused');
        return;
      }
      if (!this.inject(message)) return;
      await archivePeerMessage(this.homeDir, this.self.sessionId, file, message.id, 'delivered');
    } catch (error) {
      this.log.warn('peer message processing failed', {
        messageId: message?.id,
        error: String(error),
      });
      if (message !== undefined) {
        await archivePeerMessage(this.homeDir, this.self.sessionId, file, message.id, 'failed');
      }
    } finally {
      this.inFlight.delete(file);
    }
  }

  private permissionMode(): PermissionMode | undefined {
    const handle = this.lifecycle.handleOf(MAIN_AGENT_ID);
    if (handle === undefined) return undefined;
    try {
      return handle.accessor.get(IAgentPermissionModeService).mode;
    } catch {
      return undefined;
    }
  }

  private modeActive(): boolean {
    const handle = this.lifecycle.handleOf(MAIN_AGENT_ID);
    if (handle === undefined) return false;
    try {
      if (handle.accessor.get(IAgentSwarmService)?.isActive) return true;
    } catch {
    }
    try {
      if (handle.accessor.get(IAgentTowerService)?.isActive) return true;
    } catch {
    }
    return false;
  }

  private inject(message: PeerMessage): boolean {
    const handle = this.lifecycle.handleOf(MAIN_AGENT_ID);
    const loop = handle?.accessor.get(IAgentLoopService);
    if (loop === undefined) return false;
    const origin: UserPromptOrigin = {
      kind: 'user',
      clientMetadata: [{ peer: { ...message.from }, messageId: message.id }],
    };
    loop.sendNow({
      role: 'user',
      content: [{ type: 'text', text: peerMessageText(message) }],
      attributes: { origin },
    });
    return true;
  }

  private async requestApproval(
    message: PeerMessage,
  ): Promise<'approved' | 'refused' | 'aborted'> {
    const id = `peer_${message.id}`;
    try {
      const response = await abortable(
        interactions.request<Record<string, unknown>, ApprovalResponse>({
          id,
          kind: 'approval',
          payload: {
            id,
            sessionId: this.session.sessionId,
            agentId: MAIN_AGENT_ID,
            toolCallId: id,
            toolName: 'PeerMessage',
            action: `Message from @${message.from.name}`,
            display: {
              kind: 'generic',
              summary: `Message from @${message.from.name}`,
              detail: { from: message.from, text: message.text },
            },
          },
          tags: {
            [INTERACTION_TAG_AGENT_ID]: MAIN_AGENT_ID,
            [INTERACTION_TAG_SESSION_ID]: this.session.sessionId,
            [INTERACTION_TAG_TOOL_CALL_ID]: id,
          },
        }),
        this.disposeController.signal,
      );
      return response.decision === 'approved' ? 'approved' : 'refused';
    } catch {
      return 'aborted';
    }
  }
}
