/**
 * Provider observability boundary — fetches one session's safe aggregate facts
 * from an explicitly configured read-only endpoint. Raw credentials and
 * account identities beyond the endpoint's local label never enter the TUI.
 */

import type { AppState, ProviderObservabilityState } from '#/tui/types';

const OBSERVABILITY_TIMEOUT_MS = 3_000;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && Number.isInteger(number) && number >= 0 ? number : undefined;
}

function quotaState(value: unknown): ProviderObservabilityState['quotaState'] {
  return value === 'fresh' ||
    value === 'last_known_good' ||
    value === 'stale' ||
    value === 'unavailable'
    ? value
    : undefined;
}

function observedState(provider: string, payload: Record<string, unknown>): ProviderObservabilityState {
  const session = record(payload['session']);
  const account = record(payload['account']);
  const quota = record(account?.['quota']);
  if (session === undefined || account === undefined || quota === undefined) {
    return { kind: 'error', provider, message: 'Invalid observability response.' };
  }
  const accountLabel = account['label'];
  if (typeof accountLabel !== 'string' || accountLabel.length === 0) {
    return { kind: 'error', provider, message: 'Observability response has no account label.' };
  }
  const ratio = finiteNumber(session['cache_hit_ratio']);
  return {
    kind: 'observed',
    provider,
    accountLabel,
    accountHealthy: account['healthy'] === true,
    quotaState: quotaState(quota['state']),
    quotaAgeSeconds: finiteNumber(quota['age_seconds']),
    fiveHour: {
      remaining: finiteNumber(quota['five_hour_remaining']),
      resetAt: finiteNumber(quota['five_hour_reset_at']),
    },
    weekly: {
      remaining: finiteNumber(quota['weekly_remaining']),
      resetAt: finiteNumber(quota['weekly_reset_at']),
    },
    requestCount: nonNegativeInteger(session['request_count']),
    terminalCount: nonNegativeInteger(session['terminal_count']),
    successCount: nonNegativeInteger(session['success_count']),
    failureCount: nonNegativeInteger(session['failure_count']),
    usageObservedCount: nonNegativeInteger(session['usage_observed_count']),
    usageMissingCount: nonNegativeInteger(session['usage_missing_count']),
    inputTokens: nonNegativeInteger(session['input_tokens']),
    cachedInputTokens: nonNegativeInteger(session['cached_input_tokens']),
    outputTokens: nonNegativeInteger(session['output_tokens']),
    reasoningTokens: nonNegativeInteger(session['reasoning_tokens']),
    cacheHitRatio: ratio !== undefined && ratio >= 0 && ratio <= 1 ? ratio : undefined,
    lastActivityAgeSeconds: finiteNumber(session['last_activity_age_seconds']),
    inFlightCount: nonNegativeInteger(session['in_flight_count']),
  };
}

export async function fetchProviderObservability(
  state: AppState,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderObservabilityState | undefined> {
  const model = state.availableModels[state.model];
  const providerId = model?.provider;
  const endpoint = providerId === undefined
    ? undefined
    : state.availableProviders[providerId]?.observabilityUrl;
  if (providerId === undefined || endpoint === undefined || state.sessionId.length === 0) {
    return undefined;
  }

  try {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-Pool-Session-ID': state.sessionId },
      signal: AbortSignal.timeout(OBSERVABILITY_TIMEOUT_MS),
    });
    const payload = record(await response.json());
    if (response.status === 404 && payload?.['state'] === 'not_observed') {
      return { kind: 'not_observed', provider: providerId };
    }
    if (!response.ok || payload?.['state'] !== 'observed') {
      return {
        kind: 'error',
        provider: providerId,
        message: `Observability endpoint returned HTTP ${String(response.status)}.`,
      };
    }
    return observedState(providerId, payload);
  } catch (error) {
    return {
      kind: 'error',
      provider: providerId,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function refreshProviderObservability(input: {
  readonly state: AppState;
  readonly setState: (patch: Partial<AppState>) => void;
}): Promise<ProviderObservabilityState | undefined> {
  const sessionId = input.state.sessionId;
  const result = await fetchProviderObservability(input.state);
  if (input.state.sessionId !== sessionId) return undefined;
  input.setState({ providerObservability: result });
  return result;
}
