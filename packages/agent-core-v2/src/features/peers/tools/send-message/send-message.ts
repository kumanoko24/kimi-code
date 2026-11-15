import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import { type AgentTool } from '#/tool/toolContract';

export const SendMessageInputSchema = z
  .object({
    to: z
      .string()
      .trim()
      .min(1)
      .describe('Peer name or session ID from ListAgents.'),
    message: z
      .string()
      .trim()
      .min(1)
      .describe(
        'Plain-text message for the other session. Include the context it needs; the receiver cannot see this conversation.',
      ),
  })
  .strict();

export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export interface ISendMessageTool extends AgentTool<SendMessageInput> {
  readonly _serviceBrand: undefined;
}

export const ISendMessageTool = createDecorator<ISendMessageTool>('sendMessageTool');
