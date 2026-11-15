import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const CROSS_SESSION_FLAG_ID = 'cross_session';
export const CROSS_SESSION_FLAG_ENV = 'KIMI_CODE_EXPERIMENTAL_CROSS_SESSION';

export const crossSessionFlag: FlagDefinitionInput = {
  id: CROSS_SESSION_FLAG_ID,
  title: 'Cross-session messaging',
  description:
    'Give the model the ListAgents and SendMessage tools so live kimi sessions on this machine can message each other by name.',
  env: CROSS_SESSION_FLAG_ENV,
  default: false,
  surface: 'both',
};

registerFlagDefinition(crossSessionFlag);
