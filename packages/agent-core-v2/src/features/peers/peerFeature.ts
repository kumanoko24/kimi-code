import { ScopeActivation } from '#/_base/di/scope';
import type { ServicesAccessor } from '#/_base/di/instantiation';
import { LifecycleScope } from '#/app/scopes';
import { IAgentSwarmService } from '#/features/swarm/agent/swarm';
import { IAgentTowerService } from '#/features/tower/tower';
import { IFlagService } from '#/app/flag/flag';
import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';

import './configSection';
import { CROSS_SESSION_FLAG_ID } from './flag';
import { IPeerService } from './peers';
import { PeerService } from './peerService';
import { IListAgentsTool } from './tools/list-agents/list-agents';
import { ListAgentsTool } from './tools/list-agents/listAgentsTool';
import { ISendMessageTool } from './tools/send-message/send-message';
import { SendMessageTool } from './tools/send-message/sendMessageTool';

function peerToolsEnabled(accessor: ServicesAccessor): boolean {
  try {
    if (accessor.get(IAgentSwarmService).isActive) return false;
  } catch {
  }
  try {
    if (accessor.get(IAgentTowerService).isActive) return false;
  } catch {
  }
  return true;
}

export class PeersFeature extends Feature {
  static override readonly name = 'peers';

  constructor(@IFlagService flags: IFlagService) {
    super();
    if (!flags.enabled(CROSS_SESSION_FLAG_ID)) return;
    this.contributeService(LifecycleScope.Session, IPeerService, PeerService, {
      activation: ScopeActivation.OnScopeCreated,
    });
    this.contributeTool(IListAgentsTool, ListAgentsTool, {
      name: 'ListAgents',
      domain: 'peers',
      when: peerToolsEnabled,
    });
    this.contributeTool(ISendMessageTool, SendMessageTool, {
      name: 'SendMessage',
      domain: 'peers',
      when: peerToolsEnabled,
    });
  }
}

registerFeature(PeersFeature);
