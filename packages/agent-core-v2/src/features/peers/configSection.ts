import { z } from 'zod';

import { registerConfigSection } from '#/app/config/configSectionContributions';

import { DEFAULT_MAX_PEER_MESSAGE_CHARS } from './peers';

export const PEERS_SECTION = 'peers';

export const PeersConfigSchema = z.object({
  name: z.string().trim().min(1).optional(),
  inbound: z.enum(['accept', 'hold', 'refuse']).optional(),
  maxMessageChars: z.number().int().positive().optional(),
});

export type PeersConfig = z.infer<typeof PeersConfigSchema>;

registerConfigSection(PEERS_SECTION, PeersConfigSchema, {
  defaultValue: {
    inbound: 'hold',
    maxMessageChars: DEFAULT_MAX_PEER_MESSAGE_CHARS,
  },
});
