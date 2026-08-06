/** Experimental gate for provider-native Responses compaction. */

import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const OPENAI_RESPONSES_COMPACTION_FLAG_ID = 'openai-responses-compaction';
export const OPENAI_RESPONSES_COMPACTION_FLAG_ENV =
  'KIMI_CODE_EXPERIMENTAL_OPENAI_RESPONSES_COMPACTION';

export const openAIResponsesCompactionFlag: FlagDefinitionInput = {
  id: OPENAI_RESPONSES_COMPACTION_FLAG_ID,
  title: 'OpenAI Responses native compaction',
  description:
    'Use the OpenAI Responses compact endpoint and replay its opaque provider-native context unchanged.',
  env: OPENAI_RESPONSES_COMPACTION_FLAG_ENV,
  default: false,
  surface: 'core',
};

registerFlagDefinition(openAIResponsesCompactionFlag);
