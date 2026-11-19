import type { OAuthFlowConfig } from './types';

export const DEFAULT_KIMI_CODE_OAUTH_HOST = 'https://auth.kimi.com';
export const DEFAULT_OAUTH_HTTP_TIMEOUT_MS = 30_000;
export const DEFAULT_OAUTH_LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
export const OAUTH_FILE_LOCK_OPTIONS = {
  retries: { retries: 120, factor: 1, minTimeout: 500, maxTimeout: 1_000 },
  stale: 5_000,
  realpath: false,
};

function envOverride(key: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[key];
}

export const KIMI_CODE_FLOW_CONFIG: OAuthFlowConfig = {
  name: 'kimi-code',
  oauthHost:
    envOverride('KIMI_CODE_OAUTH_HOST') ??
    envOverride('KIMI_OAUTH_HOST') ??
    DEFAULT_KIMI_CODE_OAUTH_HOST,
  clientId: '17e5f671-d194-4dfb-9706-5516cb48c098',
};
