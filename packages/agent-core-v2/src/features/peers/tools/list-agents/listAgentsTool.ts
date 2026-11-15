import { toInputJsonSchema } from '#/tool/input-schema';
import {
  ToolAccesses,
  type ExecutableToolContext,
  type ExecutableToolResult,
  type ToolExecution,
} from '#/tool/toolContract';

import { IPeerService } from '../../peers';
import { IListAgentsTool, ListAgentsInputSchema, type ListAgentsInput } from './list-agents';
import DESCRIPTION from './list-agents.md?raw';

export class ListAgentsTool implements IListAgentsTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'ListAgents';
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(ListAgentsInputSchema);

  constructor(@IPeerService private readonly peers: IPeerService) {}

  resolveExecution(_args: ListAgentsInput): ToolExecution {
    return {
      accesses: ToolAccesses.none(),
      description: 'Listing peer kimi sessions',
      approvalRule: this.name,
      execute: (ctx) => this.execution(ctx),
    };
  }

  private async execution(_ctx: ExecutableToolContext): Promise<ExecutableToolResult> {
    try {
      await this.peers.ready;
      const peers = await this.peers.list();
      const lines = peers.map((peer) => {
        const self = peer.self ? ' [self]' : '';
        return `- @${peer.name}${self} session=${peer.sessionId} cwd=${peer.cwd}`;
      });
      if (lines.length === 1 && peers[0]?.self === true) {
        lines.push('No other live kimi session is reachable on this machine.');
      }
      return { output: lines.join('\n') };
    } catch (error) {
      return {
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

