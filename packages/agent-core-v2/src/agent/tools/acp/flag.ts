import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const ACP_AGENT_FLAG_ID = 'acp_agent';
export const ACP_AGENT_FLAG_ENV = 'KIMI_CODE_EXPERIMENTAL_ACP_AGENT';

export const acpAgentFlag: FlagDefinitionInput = {
  id: ACP_AGENT_FLAG_ID,
  title: 'ACP agent tool',
  description:
    'Give the model the AcpAgent tool so it can run an external Agent Client Protocol (ACP) coding agent as a worker. Configure agents under [acp_agents].',
  env: ACP_AGENT_FLAG_ENV,
  default: false,
  surface: 'core',
};

registerFlagDefinition(acpAgentFlag);
