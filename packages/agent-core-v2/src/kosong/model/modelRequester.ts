import type {
  Message,
  ProviderState,
  StreamedMessagePart,
  VideoURLPart,
} from '#/kosong/contract/message';
import type {
  FinishReason,
  ResponseFormat,
  SamplingOptions,
  ThinkingEffort,
  VideoUploadInput,
} from '#/kosong/contract/provider';
import type { Tool } from '#/kosong/contract/tool';
import type { TokenUsage } from '#/kosong/contract/usage';

import type { Model } from './catalog';

export interface ModelRequestInput {
  readonly systemPrompt: string;
  readonly tools: readonly Tool[];
  readonly messages: readonly Message[];
  readonly responseFormat?: ResponseFormat;
}

export interface ModelRequestTiming {
  readonly firstTokenLatencyMs: number;
  readonly streamDurationMs: number;
  readonly requestBuildMs?: number;
  readonly serverFirstTokenMs?: number;
  readonly serverDecodeMs?: number;
  readonly clientConsumeMs?: number;
}

export type ModelRequestEvent =
  | { readonly type: 'part'; readonly part: StreamedMessagePart }
  | { readonly type: 'usage'; readonly usage: TokenUsage; readonly model?: string }
  | {
      readonly type: 'finish';
      readonly message: Message;
      readonly providerFinishReason?: FinishReason;
      readonly rawFinishReason?: string;
      readonly id?: string;
      readonly traceId?: string;
    }
  | ({ readonly type: 'timing' } & ModelRequestTiming);

export interface ModelRequestParams {
  readonly cacheKey?: string;
  readonly sampling?: SamplingOptions;
  readonly thinkingEffort?: ThinkingEffort;
  readonly thinkingKeep?: string;
  readonly maxCompletionTokens?: number;
  readonly maxCompletionTokensMode?: 'hard_cap' | 'fallback';
  readonly usedContextTokens?: number;
  readonly maxContextTokens?: number;
  readonly onTraceId?: (traceId: string | null) => void;
}

export interface ModelCompactionResult {
  readonly state: ProviderState;
  readonly usage: TokenUsage;
  readonly id?: string;
}

export interface ModelRequester {
  readonly model: Model;

  request(
    input: ModelRequestInput,
    signal?: AbortSignal,
    params?: ModelRequestParams,
  ): AsyncIterable<ModelRequestEvent>;

  compact?(
    input: Pick<ModelRequestInput, 'systemPrompt' | 'messages'>,
    signal?: AbortSignal,
    params?: ModelRequestParams,
  ): Promise<ModelCompactionResult | undefined>;

  uploadVideo?(
    input: string | VideoUploadInput,
    options?: { readonly signal?: AbortSignal },
  ): Promise<VideoURLPart>;
}

export function effectiveMaxCompletionTokens(params?: ModelRequestParams): number | undefined {
  return params?.maxCompletionTokens;
}
