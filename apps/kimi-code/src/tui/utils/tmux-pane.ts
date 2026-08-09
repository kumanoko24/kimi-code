/**
 * Normalize tmux's pane identity for opt-in TUI presentation.
 *
 * tmux exposes pane IDs as `%<digits>`. Invalid or absent values stay absent
 * so a reused process environment can never render a guessed identity.
 */

const TMUX_PANE_PATTERN = /^%\d+$/;

export function normalizeTmuxPaneId(
  value: string | undefined,
): string | undefined {
  return value !== undefined && TMUX_PANE_PATTERN.test(value)
    ? value
    : undefined;
}
