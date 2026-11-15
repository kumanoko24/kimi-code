import { z } from 'zod';

import { registerConfigSection } from '#/app/config/configSectionContributions';

export const ACP_AGENTS_SECTION = 'acpAgents';

export const AcpAgentConfigSchema = z.object({
  command: z.string().trim().min(1),
  args: z.array(z.string()).optional(),
  cwd: z.string().trim().min(1).optional(),
  env: z.record(z.string(), z.string()).optional(),
  model: z.string().trim().min(1).optional(),
  effort: z.string().trim().min(1).optional(),
});

export type AcpAgentConfig = z.infer<typeof AcpAgentConfigSchema>;

export const AcpAgentsConfigSchema = z.record(z.string(), AcpAgentConfigSchema);

export type AcpAgentsConfig = z.infer<typeof AcpAgentsConfigSchema>;

registerConfigSection(ACP_AGENTS_SECTION, AcpAgentsConfigSchema);
