import type { SlashCommandHost } from './dispatch';

export async function handleRestartCommand(host: SlashCommandHost): Promise<void> {
  const sessionId = host.session?.id ?? host.state.appState.sessionId;
  host.setExitRestart(sessionId.length > 0 ? sessionId : undefined);
  await host.stop();
}
