import { z } from 'zod';

export const OpenRouterOptionsSchema = z.object({
  reasoning: z.object({
    enabled: z.boolean().optional(),
    effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
    max_tokens: z.number().int().positive().optional(),
    exclude: z.boolean().optional(),
  }).strict().optional(),
  provider: z.object({
    only: z.array(z.string()).optional(),
    order: z.array(z.string()).optional(),
    ignore: z.array(z.string()).optional(),
    allow_fallbacks: z.boolean().optional(),
    require_parameters: z.boolean().optional(),
  }).strict().optional(),
}).strict();

export type OpenRouterOptions = z.infer<typeof OpenRouterOptionsSchema>;
