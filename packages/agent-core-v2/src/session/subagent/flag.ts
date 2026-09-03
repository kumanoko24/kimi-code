import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const AGENT_PROFILE_MODEL_BINDING_FLAG_ID = 'agent-profile-model-binding';
export const AGENT_PROFILE_MODEL_BINDING_FLAG_ENV =
  'KIMI_CODE_EXPERIMENTAL_AGENT_PROFILE_MODEL_BINDING';

export const SECONDARY_MODEL_FLAG_ID = 'secondary-model';
export const SECONDARY_MODEL_FLAG_ENV = 'KIMI_CODE_EXPERIMENTAL_SECONDARY_MODEL';

export const secondaryModelFlag: FlagDefinitionInput = {
  id: SECONDARY_MODEL_FLAG_ID,
  title: 'Secondary model for subagents',
  description:
    'Let newly spawned subagents use a separately configured secondary model by default, with an explicit primary-model override for quality-sensitive tasks.',
  env: SECONDARY_MODEL_FLAG_ENV,
  default: true,
  surface: 'core',
};

registerFlagDefinition(secondaryModelFlag);

registerFlagDefinition({
  id: AGENT_PROFILE_MODEL_BINDING_FLAG_ID,
  title: 'Exact model binding in agent files',
  description: 'Let file-defined subagent profiles bind an exact model alias and thinking effort.',
  env: AGENT_PROFILE_MODEL_BINDING_FLAG_ENV,
  default: false,
  surface: 'core',
});

export const SUBAGENT_FORK_FLAG_ID = 'subagent_fork';
export const SUBAGENT_FORK_FLAG_ENV = 'KIMI_CODE_EXPERIMENTAL_SUBAGENT_FORK';

export const subagentForkFlag: FlagDefinitionInput = {
  id: SUBAGENT_FORK_FLAG_ID,
  title: 'Fork context for subagents',
  description:
    'Let the Agent and AgentSwarm tools start a subagent with a snapshot of the calling agent\'s conversation history via the fork parameter.',
  env: SUBAGENT_FORK_FLAG_ENV,
  default: false,
  surface: 'core',
};

registerFlagDefinition(subagentForkFlag);
