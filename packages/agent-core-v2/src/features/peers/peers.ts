import { createDecorator } from '#/_base/di/instantiation';

export const LIST_AGENTS_TOOL_NAME = 'ListAgents';
export const SEND_MESSAGE_TOOL_NAME = 'SendMessage';
export const DEFAULT_MAX_PEER_MESSAGE_CHARS = 100_000;

export interface PeerInfo {
  readonly sessionId: string;
  readonly name: string;
  readonly cwd: string;
  readonly pid: number;
  readonly hostname: string;
  readonly startedAt: string;
}

export interface PeerMessageFrom extends PeerInfo {
  readonly agent?: string;
}

export interface PeerMessage {
  readonly id: string;
  readonly from: PeerMessageFrom;
  readonly to: string;
  readonly text: string;
  readonly sentAt: string;
}

export interface PeerListEntry extends PeerInfo {
  readonly self: boolean;
}

export interface IPeerService {
  readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly self: PeerInfo;
  list(): Promise<readonly PeerListEntry[]>;
  send(input: {
    readonly to: string;
    readonly text: string;
    readonly agent?: string;
  }): Promise<{ readonly messageId: string; readonly to: PeerInfo }>;
}

export const IPeerService = createDecorator<IPeerService>('peerService');
