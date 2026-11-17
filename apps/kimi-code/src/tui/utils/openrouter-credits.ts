import { parseKimiCodeCustomHeaders } from '@moonshot-ai/kimi-code-oauth';
import { declaredProviderCredential, nonEmptyString } from '@moonshot-ai/kimi-code-oauth/provider-credential';
import type { KimiConfig } from '@moonshot-ai/kimi-code-sdk';

import { OPENROUTER_CREDITS_URL } from '../constant/kimi-tui';

export function openRouterCreditsApiKey(
  config: KimiConfig,
  alias: string,
): string | undefined {
  const model = config.models?.[alias];
  if (model === undefined) return undefined;
  const providerId =
    nonEmptyString('providerId' in model ? model.providerId : undefined) ??
    nonEmptyString(model.provider) ??
    nonEmptyString(config.defaultProvider);
  if (providerId === undefined) return undefined;
  const provider = config.providers?.[providerId];
  if (provider?.type !== 'openrouter') return undefined;

  const baseUrl =
    nonEmptyString(model.baseUrl) ??
    nonEmptyString(provider.baseUrl) ??
    nonEmptyString(provider.env?.['OPENROUTER_BASE_URL']);
  if (baseUrl !== undefined && URL.parse(baseUrl)?.origin !== new URL(OPENROUTER_CREDITS_URL).origin) {
    return undefined;
  }
  const headers = { ...parseKimiCodeCustomHeaders(), ...provider.customHeaders };
  if (Object.keys(headers).some((name) => name.toLowerCase() === 'authorization')) return undefined;

  if ('oauth' in model && model.oauth !== undefined) return undefined;
  const modelKey = nonEmptyString('apiKey' in model ? model.apiKey : undefined);
  if (modelKey !== undefined) return modelKey;
  if (provider.oauth !== undefined) return undefined;
  const credential = declaredProviderCredential(provider, providerId);
  if (credential.kind === 'conflict') return undefined;
  if (credential.kind === 'inline') return credential.apiKey;
  const key = credential.kind === 'env'
    ? process.env[credential.apiKeyEnv]
    : provider.env?.['OPENROUTER_API_KEY'];
  return nonEmptyString(key);
}

export async function fetchOpenRouterCredits(
  apiKey: string,
  signal: AbortSignal,
): Promise<number | undefined> {
  try {
    const response = await fetch(OPENROUTER_CREDITS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      return undefined;
    }
    const { data } = (await response.json()) as {
      data?: { total_credits?: unknown; total_usage?: unknown };
    };
    const { total_credits: total, total_usage: used } = data ?? {};
    if (typeof total !== 'number' || typeof used !== 'number') return undefined;
    const remaining = total - used;
    return Number.isFinite(remaining) ? remaining : undefined;
  } catch {
    return undefined;
  }
}
