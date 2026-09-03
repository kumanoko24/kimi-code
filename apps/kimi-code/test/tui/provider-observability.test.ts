/**
 * Scenario: an opt-in provider observability endpoint reports safe facts for
 * the active session. The real parser and selection logic run; only fetch is
 * stubbed as the external network boundary.
 */

import { describe, expect, it, vi } from 'vitest';

import { fetchProviderObservability } from '#/tui/utils/provider-observability';
import type { AppState } from '#/tui/types';

const state = {
  version: '1.2.3',
  workDir: '/workspace',
  additionalDirs: [],
  model: 'local/gpt',
  sessionId: 'session-example',
  sessionTitle: null,
  permissionMode: 'auto',
  planMode: false,
  inputMode: 'prompt',
  swarmMode: false,
  towerMode: false,
  thinkingEffort: 'xhigh',
  contextUsage: 0,
  contextTokens: 0,
  maxContextTokens: 258000,
  isCompacting: false,
  isReplaying: false,
  streamingPhase: 'idle',
  streamingStartTime: 0,
  stepRetry: null,
  theme: 'dark',
  editorCommand: null,
  notifications: { enabled: true, condition: 'unfocused' },
  upgrade: { autoInstall: true },
  availableModels: {
    'local/gpt': { provider: 'local', model: 'gpt', maxContextSize: 258000 },
  },
  availableProviders: {
    local: {
      type: 'openai_responses',
      observabilityUrl: 'http://127.0.0.1:2234/dashboard/api/session',
    },
  },
  mcpServersSummary: null,
} satisfies AppState;

describe('provider observability (session selection and safe parsing)', () => {
  it('returns the selected account and cache facts when the endpoint observed the session', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          state: 'observed',
          session: {
            request_count: 2,
            terminal_count: 2,
            success_count: 2,
            failure_count: 0,
            usage_observed_count: 2,
            usage_missing_count: 0,
            input_tokens: 100,
            cached_input_tokens: 75,
            output_tokens: 10,
            reasoning_tokens: 5,
            cache_hit_ratio: 0.75,
            last_activity_age_seconds: 1,
            in_flight_count: 0,
          },
          account: {
            label: 'codex-example',
            healthy: true,
            quota: { state: 'fresh', weekly_remaining: 61, age_seconds: 2 },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await fetchProviderObservability(state, fetchImpl);

    expect(result).toMatchObject({
      kind: 'observed',
      accountLabel: 'codex-example',
      weekly: { remaining: 61 },
      cacheHitRatio: 0.75,
      usageObservedCount: 2,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:2234/dashboard/api/session',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Pool-Session-ID': 'session-example' }),
      }),
    );
  });

  it('returns not_observed when the session has made no provider request', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ state: 'not_observed' }), { status: 404 }),
    );

    await expect(fetchProviderObservability(state, fetchImpl)).resolves.toEqual({
      kind: 'not_observed',
      provider: 'local',
    });
  });

  it('does not fetch when the active provider has no observability endpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const withoutEndpoint = {
      ...state,
      availableProviders: { local: { type: 'openai_responses' as const } },
    };

    await expect(fetchProviderObservability(withoutEndpoint, fetchImpl)).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports an unavailable endpoint without inventing zero usage', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('gateway unavailable'));

    await expect(fetchProviderObservability(state, fetchImpl)).resolves.toEqual({
      kind: 'error',
      provider: 'local',
      message: 'gateway unavailable',
    });
  });

  it('rejects an observed response that omits safe account and quota facts', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ state: 'observed', session: {} }), { status: 200 }),
    );

    await expect(fetchProviderObservability(state, fetchImpl)).resolves.toEqual({
      kind: 'error',
      provider: 'local',
      message: 'Invalid observability response.',
    });
  });
});
