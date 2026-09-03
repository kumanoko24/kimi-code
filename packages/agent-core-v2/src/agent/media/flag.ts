import { registerFlagDefinition } from '#/app/flag/flagRegistry';

export const VIDEO_MEDIA_FALLBACK_FLAG_ID = 'video-media-fallback';

registerFlagDefinition({
  id: VIDEO_MEDIA_FALLBACK_FLAG_ID,
  title: 'Video media fallback model',
  description: 'Analyze videos through a configured media-capable fallback model.',
  env: 'KIMI_CODE_EXPERIMENTAL_VIDEO_MEDIA_FALLBACK',
  default: false,
  surface: 'core',
});
