import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { MAIN_AGENT_ID } from '#/session/agentLifecycle/agentLifecycle';
import { toInputJsonSchema } from '#/tool/input-schema';
import { literalRulePattern, matchesGlobRuleSubject } from '#/tool/rule-match';
import {
  ToolAccesses,
  type ExecutableToolContext,
  type ExecutableToolResult,
  type ToolExecution,
} from '#/tool/toolContract';

import { IPeerService } from '../../peers';
import {
  ISendMessageTool,
  SendMessageInputSchema,
  type SendMessageInput,
} from './send-message';
import DESCRIPTION from './send-message.md?raw';

export class SendMessageTool implements ISendMessageTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'SendMessage';
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(SendMessageInputSchema);

  constructor(
    @IPeerService private readonly peers: IPeerService,
    @IAgentScopeContext private readonly scopeContext: IAgentScopeContext,
  ) {}

  resolveExecution(args: SendMessageInput): ToolExecution {
    const preview = args.message.length <= 60 ? args.message : `${args.message.slice(0, 60)}…`;
    return {
      accesses: ToolAccesses.none(),
      description: `Sending message to @${args.to}: ${preview}`,
      display: {
        kind: 'generic',
        summary: `Message to @${args.to}`,
        detail: { to: args.to, message: preview },
      },
      approvalRule: literalRulePattern(this.name, args.to),
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, args.to),
      execute: (ctx) => this.execution(args, ctx),
    };
  }

  private async execution(
    args: SendMessageInput,
    _ctx: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    try {
      await this.peers.ready;
      const agent =
        this.scopeContext.agentId === MAIN_AGENT_ID ? undefined : this.scopeContext.agentId;
      const result = await this.peers.send({ to: args.to, text: args.message, agent });
      return {
        output: `Sent message ${result.messageId} to @${result.to.name} (session ${result.to.sessionId}).`,
      };
    } catch (error) {
      return {
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

