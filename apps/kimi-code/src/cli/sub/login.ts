/**
 * `kimi login` — drive the OAuth device-code flow non-interactively.
 * The `authMethods.terminal-auth.args=['login']` (legacy `_meta` path)
 * advertised by the ACP server points clients at this entry point. The
 * first-class ACP `args=['--login']` path enters the same flow via
 * `kimi acp --login`.
 */

import { CHATGPT_PROVIDER_NAME, CHATGPT_SIGN_IN_FLAG } from '@moonshot-ai/kimi-code-oauth';
import { createKimiHarness } from '@moonshot-ai/kimi-code-sdk';
import { Option, type Command } from 'commander';

import { createKimiCodeHostIdentity } from '#/cli/host-identity';
import { openUrl } from '#/utils/open-url';

import { parseRegionFlag, runLoginFlow } from './login-flow';

export function registerLoginCommand(parent: Command): void {
  parent
    .command('login')
    .description('Sign in to Kimi Code CLI.')
    .addOption(new Option('--provider <provider>', 'Provider to sign in to.').choices(['kimi-code', CHATGPT_PROVIDER_NAME]))
    .option('--account <id>', 'Sign in again with a saved ChatGPT account.')
    .option('--list-accounts', 'List saved ChatGPT accounts.')
    .option(
      '--region <region>',
      'Login region: "mainland-cn" (kimi.com) or "global" (kimi.ai).',
    )
    .action(async (opts: { region?: string; provider?: string; account?: string; listAccounts?: boolean }) => {
      if (opts.provider === CHATGPT_PROVIDER_NAME) {
        if (opts.region !== undefined || (opts.account !== undefined && opts.listAccounts)) {
          throw new Error('Use --account or --list-accounts for ChatGPT. --region applies to Kimi Code.');
        }
        await runChatGPTAuth('login', opts);
        return;
      }
      if (opts.account !== undefined || opts.listAccounts) {
        throw new Error('Use --provider chatgpt with --account or --list-accounts.');
      }
      await runLoginFlow({
        region: opts.region === undefined ? undefined : parseRegionFlag(opts.region),
      });
    });
}

export function registerLogoutCommand(parent: Command): void {
  parent
    .command('logout')
    .description('Sign out of ChatGPT.')
    .addOption(new Option('--provider <provider>', 'Provider to sign out of.').choices([CHATGPT_PROVIDER_NAME]).makeOptionMandatory())
    .action(async () => runChatGPTAuth('logout', {}));
}

async function runChatGPTAuth(
  action: 'login' | 'logout',
  options: { account?: string; listAccounts?: boolean },
): Promise<void> {
  const harness = createKimiHarness({ identity: createKimiCodeHostIdentity(), uiMode: 'cli' });
  const controller = new AbortController();
  const cancel = (): void => {
    controller.abort();
  };
  process.once('SIGINT', cancel);
  try {
    if (action === 'logout') {
      const result = await harness.auth.logoutChatGPT();
      process.stdout.write(result.revocationConfirmed === undefined ? 'No active ChatGPT sign-in.\n' : 'Signed out of ChatGPT locally.\n');
      if (result.revocationConfirmed === false) {
        process.stderr.write('OpenAI revocation could not be confirmed. Disconnect the app in ChatGPT Settings.\n');
      }
      return;
    }
    if (!(await harness.getExperimentalFeatures()).some((flag) => flag.id === CHATGPT_SIGN_IN_FLAG && flag.enabled)) {
      throw new Error('Enable Sign in with ChatGPT with KIMI_CODE_EXPERIMENTAL_CHATGPT_SIGN_IN=1.');
    }
    if (options.listAccounts) {
      const accounts = await harness.auth.listChatGPTAccounts();
      for (const account of accounts) {
        process.stdout.write(`${account.label}${account.active && account.connected ? ' (active)' : ''}\n`);
      }
      return;
    }
    await harness.auth.loginWithChatGPT({
      account: options.account,
      signal: controller.signal,
      onBrowserUrl: (url) => {
        process.stderr.write(`Open this link in a browser on this machine to sign in with ChatGPT\n${url}\n`);
        openUrl(url);
      },
    });
    process.stdout.write('Signed in with ChatGPT. Select an available ChatGPT model with /model.\n');
  } catch (error) {
    if (controller.signal.aborted) {
      process.stderr.write('Sign-in cancelled.\n');
    } else {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`ChatGPT ${action} failed. ${message}\n`);
    }
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', cancel);
    await harness.close();
  }
}
