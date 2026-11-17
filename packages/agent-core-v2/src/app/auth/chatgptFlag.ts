import { CHATGPT_SIGN_IN_FLAG } from '@moonshot-ai/kimi-code-oauth';

import { registerFlagDefinition } from '#/app/flag/flagRegistry';

registerFlagDefinition({
  id: CHATGPT_SIGN_IN_FLAG,
  title: 'Sign in with ChatGPT',
  description: 'Use an eligible ChatGPT plan for model requests.',
  env: 'KIMI_CODE_EXPERIMENTAL_CHATGPT_SIGN_IN',
  default: false,
  surface: 'core',
});
