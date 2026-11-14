import type { ThinkPart } from '#/llm/message';
import { createRequester } from '#/llm/requester';
import { openAIProtocol, lowerMessage } from '../../protocol/openai/index';
import { createDecoder, type RawChunk } from '../../protocol/openai/decode';

function detailsOf(value: unknown): Record<string, unknown>[] | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const details = (value as Record<string, unknown>)['reasoning_details'];
  if (!Array.isArray(details)) return undefined;
  if (details.some((part) => typeof part !== 'object' || part === null || Array.isArray(part))) {
    throw new TypeError('OpenRouter returned invalid reasoning_details');
  }
  return details as Record<string, unknown>[];
}

function displayText(detail: Record<string, unknown>): string {
  const value = detail['type'] === 'reasoning.summary' ? detail['summary'] : detail['text'];
  return typeof value === 'string' ? value : '';
}

export const openRouterProtocol = openAIProtocol.with({
  thinkingHistory: () => [],
  thinking: (thinking, module) => {
    const configured = module.options?.openrouter?.reasoning;
    const reasoning = configured === undefined ? {} : { ...configured };
    if (configured === undefined && thinking !== undefined) {
      if (thinking.effort === 'on') reasoning.enabled = true;
      else if (thinking.effort === 'off') reasoning.enabled = false;
      else reasoning.effort = thinking.effort as typeof reasoning.effort;
    }
    return {
      reasoning: Object.keys(reasoning).length === 0 ? undefined : reasoning,
      provider: module.options?.openrouter?.provider,
    };
  },
  maxOutputTokens: (cap) => ({ max_tokens: cap }),
  message: (message, module) => {
    const bundles = message.content.flatMap((part) =>
      part.type === 'think' && part.openRouterReasoning !== undefined ? [part.openRouterReasoning] : [],
    );
    const content = bundles.length === 0 ? message.content : message.content.filter((part) => part.type !== 'think');
    const replayMessage = message.role === 'assistant'
      ? { ...message, content, toolCalls: message.toolCalls.map((call) => ({ ...call, id: call.rawId ?? call.id })) }
      : message.role === 'tool'
        ? { ...message, content, toolCallId: module.content.messages.flatMap((entry) => entry.role === 'assistant' ? entry.toolCalls : []).find((call) => call.id === message.toolCallId)?.rawId ?? message.toolCallId }
        : { ...message, content };
    const converted = lowerMessage(replayMessage, {
      reasoningKey: 'reasoning',
      preserveThinking: false,
      toolMessageConversion: module.options?.toolMessageConversion,
    });
    if (bundles.length > 0) {
      for (const native of converted) {
        native['reasoning_details'] = bundles.flatMap((bundle) => bundle.details);
      }
    }
    return converted;
  },
  replay: (response) => Array.from(openAIProtocol.replay(response)).map((chunk) => ({
    ...chunk,
    choices: chunk.choices?.map((choice, index) => ({ ...choice, message: response.choices?.[index]?.message })),
  })),
  decoder: (module, sink) => {
    const base = createDecoder(sink, module.options?.reasoningKey);
    const details: Record<string, unknown>[] = [];
    const byIndex = new Map<unknown, Record<string, unknown>[]>();
    let complete = false;
    let hasStringReasoning = false;
    return {
      push(chunk: RawChunk) {
        const choice = chunk.choices?.[0];
        const delta = choice?.delta as Record<string, unknown> | undefined;
        const snapshot = (choice as { message?: unknown } | undefined)?.message;
        const incoming = detailsOf(snapshot) ?? detailsOf(delta);
        const isSnapshot = snapshot !== undefined;
        if (isSnapshot) {
          details.length = 0;
          byIndex.clear();
        }
        if (delta !== undefined) {
          hasStringReasoning ||= typeof delta['reasoning'] === 'string' || typeof delta['reasoning_content'] === 'string';
        }
        for (const part of incoming ?? []) {
          const key = part['index'] ?? part['id'];
          const candidates = key === undefined ? [] : (byIndex.get(key) ?? []);
          const target = candidates.find((candidate) => ['type', 'id'].every((field) =>
            part[field] === undefined || candidate[field] === undefined || part[field] === candidate[field],
          ));
          if (target === undefined || isSnapshot) {
            const copy = structuredClone(part);
            details.push(copy);
            if (key !== undefined) byIndex.set(key, [...candidates, copy]);
          } else {
            for (const [field, value] of Object.entries(part)) {
              if (['text', 'summary', 'signature', 'data'].includes(field) && typeof value === 'string' && typeof target[field] === 'string') {
                target[field] += value;
              } else {
                target[field] = structuredClone(value);
              }
            }
          }
          if (!hasStringReasoning) {
            const text = displayText(part);
            if (text.length > 0) sink.onDelta({ type: 'think', think: text, reasoningKey: 'reasoning' });
          }
        }
        const sanitizedDelta = delta === undefined ? undefined : { ...choice?.delta, ...delta, reasoning_details: undefined };
        base.push({ ...chunk, choices: choice === undefined ? [] : [{ ...choice, delta: sanitizedDelta }] });
        complete ||= choice?.finish_reason !== undefined && choice.finish_reason !== null;
      },
      end() {
        base.end();
        if (complete && details.length > 0) {
          sink.onDelta({
            type: 'think', think: '', hidden: true,
            openRouterReasoning: { provider: 'openrouter', model: module.model.spec.name, details },
          } satisfies ThinkPart);
        }
      },
    };
  },
});

export const openRouterRequester = createRequester().with({ protocol: { base: openRouterProtocol } });
