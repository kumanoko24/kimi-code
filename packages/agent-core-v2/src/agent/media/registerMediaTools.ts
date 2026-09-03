import type { ModelCapability } from '#/kosong/contract/capability';
import { extractText, type Message } from '#/kosong/contract/message';
import type { ModelRequester } from '#/kosong/model/modelRequester';
import type { VideoUploadEvent } from '#/app/telemetry/events';
import type { ITelemetryService } from '#/app/telemetry/telemetry';

import { toDisposable, type IDisposable } from '#/_base/di/lifecycle';
import type { WorkspaceConfig } from '#/tool/path-access';
import type { IAgentRuntimeService } from '#/agent/runtimeBinding/agentRuntime';
import type { IAgentToolRegistryService } from '#/agent/toolRegistry/toolRegistry';
import { ReadMediaFileTool } from '#/agent/tools/read-media-file/readMediaFileTool';
import type {
  VideoAnalyzer,
  VideoUploader,
} from '#/agent/tools/read-media-file/read-media-file';

const VIDEO_FALLBACK_SYSTEM_PROMPT =
  'Answer the user question from the attached video. Be precise and do not invent unseen details.';

export interface RegisterMediaToolsDeps {
  readonly runtime: IAgentRuntimeService;
  readonly workspace: WorkspaceConfig;
  readonly capabilities: ModelCapability;
  readonly videoUploader?: VideoUploader;
  readonly telemetry?: ITelemetryService;
  readonly inlineVideoSupported?: boolean;
  readonly videoAnalyzer?: VideoAnalyzer;
}

export function registerMediaTools(
  toolRegistry: IAgentToolRegistryService,
  deps: RegisterMediaToolsDeps,
): IDisposable {
  if (
    !deps.runtime.isAvailable(['fs']) ||
    (!deps.capabilities.image_in &&
      !deps.capabilities.video_in &&
      deps.videoAnalyzer === undefined)
  ) {
    return toDisposable(() => {});
  }
  return toolRegistry.register(
    new ReadMediaFileTool(
      deps.runtime,
      deps.workspace,
      deps.capabilities,
      deps.videoUploader,
      deps.telemetry,
      deps.inlineVideoSupported,
      deps.videoAnalyzer,
    ),
  );
}

export function createVideoAnalyzer(
  requester: ModelRequester | undefined,
  model: string,
  effort: string,
): VideoAnalyzer | undefined {
  if (requester?.uploadVideo === undefined) return undefined;
  const uploadVideo = requester.uploadVideo.bind(requester);
  return async (input) => {
    const video = await uploadVideo(
      { data: input.data, mimeType: input.mimeType, filename: input.filename },
      { signal: input.signal },
    );
    const message: Message = {
      role: 'user',
      content: [{ type: 'text', text: input.question }, video],
      toolCalls: [],
    };
    let answer = '';
    for await (const event of requester.request(
      { systemPrompt: VIDEO_FALLBACK_SYSTEM_PROMPT, tools: [], messages: [message] },
      input.signal,
      { thinkingEffort: effort },
    )) {
      if (event.type === 'finish') answer = extractText(event.message, '\n').trim();
    }
    if (answer.length === 0) throw new Error('Video fallback model returned no text.');
    return { text: answer, model, effort };
  };
}

export function createVideoUploader(
  requester: Pick<ModelRequester, 'uploadVideo'> | undefined,
  telemetry?: VideoUploadTelemetry,
): VideoUploader | undefined {
  const uploadVideo = requester?.uploadVideo;
  if (uploadVideo === undefined) return undefined;
  const bound = uploadVideo.bind(requester);
  if (telemetry === undefined) return (input, options) => bound(input, options);

  return async (input, options) => {
    const startedAt = Date.now();
    const base = {
      ...telemetry.props,
      mime_type: input.mimeType,
      size_bytes: input.data.length,
    };
    const track = (props: VideoUploadEvent): void => {
      try {
        telemetry.client.track2('video_upload', props);
      } catch {
      }
    };
    try {
      const part = await bound(input, options);
      track({ ...base, outcome: 'success', duration_ms: Date.now() - startedAt });
      return part;
    } catch (error) {
      track({
        ...base,
        outcome: 'error',
        duration_ms: Date.now() - startedAt,
        error_type: error instanceof Error ? error.name : 'Unknown',
      });
      throw error;
    }
  };
}

export interface VideoUploadTelemetry {
  readonly client: ITelemetryService;
  readonly props?: Pick<VideoUploadEvent, 'model' | 'provider_type' | 'protocol'>;
}
