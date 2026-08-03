/** Experimental gate for provider-native Responses compaction. */

import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const OPENAI_RESPONSES_COMPACTION_FLAG_ID = 'openai-responses-compaction';
export const OPENAI_RESPONSES_COMPACTION_FLAG_ENV =
  'KIMI_CODE_EXPERIMENTAL_OPENAI_RESPONSES_COMPACTION';

export const openAIResponsesCompactionFlag: FlagDefinitionInput = {
  id: OPENAI_RESPONSES_COMPACTION_FLAG_ID,
  title: 'OpenAI Responses native compaction',
  description:
    'Use a configured OpenAI Responses provider compact endpoint and preserve its opaque context state.',
  env: OPENAI_RESPONSES_COMPACTION_FLAG_ENV,
  default: false,
  surface: 'core',
};

registerFlagDefinition(openAIResponsesCompactionFlag);
