import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import { type AgentTool } from '#/tool/toolContract';

export const ListAgentsInputSchema = z.object({}).strict();

export type ListAgentsInput = z.infer<typeof ListAgentsInputSchema>;

export interface IListAgentsTool extends AgentTool<ListAgentsInput> {
  readonly _serviceBrand: undefined;
}

export const IListAgentsTool = createDecorator<IListAgentsTool>('listAgentsTool');
