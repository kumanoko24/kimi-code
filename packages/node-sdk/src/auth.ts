import {
  loadRuntimeConfigSafe,
  readConfigFile,
  readConfigFileForUpdate,
  writeConfigFile,
  type KimiConfig,
  type ModelAlias,
  type OAuthRef,
} from '#/config/index';
import {
  applyManagedKimiCodeConfig,
  applyManagedKimiCodeLogoutConfig,
  CHATGPT_API_BASE_URL,
  CHATGPT_OAUTH_KEY_PREFIX,
  CHATGPT_PROVIDER_NAME,
  ChatGPTSessions,
  CUSTOM_REGISTRY_DEFAULT_MAX_CONTEXT,
  chatGPTAccountId,
  KIMI_CODE_PROVIDER_NAME,
  KimiOAuthToolkit,
  kimiRegionLoginHosts,
  resolveKimiCodeLoginAuth,
  resolveKimiCodeRuntimeAuth,
  type AuthManagedUsageResult,
  type AuthStatus,
  type BearerTokenProvider,
  type ChatGPTLoginOptions,
  type ChatGPTModel,
  type KimiHostIdentity,
  type KimiOAuthLoginOptions,
  type KimiRegion,
  type ManagedKimiConfigShape,
  type OAuthRefreshOutcome,
} from '@moonshot-ai/kimi-code-oauth';
import type { RefreshProviderModelsResponse } from '@moonshot-ai/klient';

import { mapOAuthTokenError } from '#/oauth-error';

export type KimiAuthLoginOptions = Omit<KimiOAuthLoginOptions, 'provisionConfig'> & {
  /**
   * Explicit region choice from the login UI ('mainland-cn' / 'global'). Maps
   * to the region profile's OAuth/API hosts — including for 'mainland-cn', so
   * switching back overrides a persisted global login. Yields to
   * `KIMI_CODE_OAUTH_HOST` / `KIMI_CODE_BASE_URL` env overrides and to
   * explicit `oauthHost` / `baseUrl` options.
   */
  readonly region?: KimiRegion;
};

export interface KimiAuthLoginResult {
  readonly providerName: string;
  readonly ok: true;
  readonly defaultModel: string;
  readonly defaultThinking: boolean;
  readonly configPath?: string | undefined;
}

export interface KimiAuthLogoutResult {
  readonly providerName: string;
  readonly ok: true;
  readonly revocationConfirmed?: boolean;
}

export interface KimiAuthFacadeOptions {
  readonly homeDir: string;
  readonly configPath: string;
  readonly identity?: KimiHostIdentity | undefined;
  readonly onConfigUpdated?: ((config: KimiConfig) => void) | undefined;
  readonly onRefresh?: ((outcome: OAuthRefreshOutcome) => void) | undefined;
}

type SDKManagedConfig = KimiConfig & ManagedKimiConfigShape;

export class KimiAuthFacade {
  private readonly toolkit: KimiOAuthToolkit<SDKManagedConfig>;
  private readonly chatGPT: ChatGPTSessions;
  private refreshedChatGPTAccount: string | undefined;

  constructor(private readonly options: KimiAuthFacadeOptions) {
    this.chatGPT = new ChatGPTSessions(options.homeDir);
    this.toolkit = new KimiOAuthToolkit<SDKManagedConfig>({
      homeDir: options.homeDir,
      identity: options.identity,
      onRefresh: options.onRefresh,
      configAdapter: {
        configPath: options.configPath,
        // Write-path base read: strict (a salvaged base would drop the user's
        // broken-but-fixable sections on rewrite) with an actionable message.
        read: () => readConfigFileForUpdate(options.configPath) as SDKManagedConfig,
        write: async (config) => {
          await writeConfigFile(options.configPath, config);
        },
        apply: applyManagedKimiCodeConfig,
        remove: applyManagedKimiCodeLogoutConfig,
      },
    });
  }

  async status(providerName?: string | undefined): Promise<AuthStatus> {
    const accountId = providerName === CHATGPT_PROVIDER_NAME ? this.activeChatGPTAccount() : undefined;
    if (accountId !== undefined) {
      return {
        providers: [{
          providerName: CHATGPT_PROVIDER_NAME,
          hasToken: (await this.chatGPT.getCachedAccessToken(accountId)) !== undefined,
        }],
      };
    }
    return this.toolkit.status(providerName, this.resolveRuntimeManagedAuth(providerName).oauthRef);
  }

  async listChatGPTAccounts() {
    const active = this.activeChatGPTAccount();
    return (await this.chatGPT.list()).map((account) => ({ ...account, active: account.id === active }));
  }

  async loginWithChatGPT(options: ChatGPTLoginOptions): Promise<void> {
    const path = this.options.configPath;
    const checkProvider = (config: KimiConfig): void => {
      const provider = config.providers[CHATGPT_PROVIDER_NAME];
      if (provider !== undefined && chatGPTAccountId(provider.oauth?.key) === undefined) {
        throw new Error('A custom provider already uses the name "chatgpt". Rename that provider before using Sign in with ChatGPT.');
      }
    };
    checkProvider(readConfigFileForUpdate(path));
    await this.chatGPT.login(options, async (accountId, models) => {
      const config = readConfigFileForUpdate(path);
      checkProvider(config);
      config.providers[CHATGPT_PROVIDER_NAME] = {
        type: 'openai_responses',
        baseUrl: CHATGPT_API_BASE_URL,
        oauth: { storage: 'file', key: CHATGPT_OAUTH_KEY_PREFIX + accountId },
      };
      applyChatGPTModels(config, models);
      await writeConfigFile(path, config);
    });
    this.options.onConfigUpdated?.(readConfigFile(path));
  }

  async refreshChatGPTModelCatalog(force = false): Promise<RefreshProviderModelsResponse | undefined> {
    const accountId = this.activeChatGPTAccount();
    if (accountId === undefined) return undefined;
    const configured = loadRuntimeConfigSafe(this.options.configPath).config.models ?? {};
    const aliases = Object.values(configured).filter((model) => model.provider === CHATGPT_PROVIDER_NAME);
    if (!force && (this.refreshedChatGPTAccount === accountId || aliases.some((model) => model.supportEfforts !== undefined || model.serviceTier !== undefined))) return undefined;
    const models = await this.chatGPT.listModels(accountId);
    const path = this.options.configPath;
    const config = readConfigFileForUpdate(path);
    if (chatGPTAccountId(config.providers[CHATGPT_PROVIDER_NAME]?.oauth?.key) !== accountId) return undefined;
    const previous = { ...config.models };
    const previousDefault = config.defaultModel;
    applyChatGPTModels(config, models);
    const next = config.models ?? {};
    if (previousDefault === config.defaultModel && JSON.stringify(previous) === JSON.stringify(next)) {
      this.refreshedChatGPTAccount = accountId;
      return { changed: [], unchanged: [CHATGPT_PROVIDER_NAME], failed: [] };
    }
    await writeConfigFile(path, config);
    this.options.onConfigUpdated?.(config);
    this.refreshedChatGPTAccount = accountId;
    return {
      changed: [{
        provider_id: CHATGPT_PROVIDER_NAME,
        provider_name: 'ChatGPT',
        added: Object.keys(next).filter((alias) => !Object.hasOwn(previous, alias)).length,
        removed: Object.keys(previous).filter((alias) => !Object.hasOwn(next, alias)).length,
      }],
      unchanged: [],
      failed: [],
    };
  }

  async login(
    providerName: string | undefined = KIMI_CODE_PROVIDER_NAME,
    options: KimiAuthLoginOptions = {},
  ): Promise<KimiAuthLoginResult> {
    const { region, ...loginOptions } = options;
    const regionHosts = region === undefined ? undefined : kimiRegionLoginHosts(region);
    const auth = this.resolveManagedAuth(providerName);
    const loginAuth = resolveKimiCodeLoginAuth({
      configuredBaseUrl: auth.baseUrl,
      configuredOAuthRef: auth.oauthRef,
      requestedBaseUrl: loginOptions.baseUrl ?? regionHosts?.baseUrl,
      requestedOAuthHost: loginOptions.oauthHost ?? regionHosts?.oauthHost,
    });
    const result = await this.toolkit.login(providerName, {
      ...loginOptions,
      baseUrl: loginAuth.baseUrl,
      oauthHost: loginAuth.oauthHost,
      oauthRef: loginOptions.oauthRef ?? loginAuth.oauthRef,
      provisionConfig: true,
    });
    if (result.provision === undefined) {
      throw new Error('Kimi auth login did not provision model config.');
    }
    const updated = readConfigFile(this.options.configPath);
    this.options.onConfigUpdated?.(updated);
    return {
      providerName: result.providerName,
      ok: true,
      defaultModel: result.provision.defaultModel,
      defaultThinking: result.provision.defaultThinking,
      configPath: result.provision.configPath,
    };
  }

  async logout(providerName?: string | undefined): Promise<KimiAuthLogoutResult> {
    if (providerName === CHATGPT_PROVIDER_NAME && this.activeChatGPTAccount() !== undefined) {
      return this.logoutChatGPT();
    }
    const result = await this.toolkit.logout(
      providerName,
      this.resolveRuntimeManagedAuth(providerName).oauthRef,
    );
    const updated = readConfigFile(this.options.configPath);
    this.options.onConfigUpdated?.(updated);
    return {
      providerName: result.providerName,
      ok: result.ok,
    };
  }

  async logoutChatGPT(): Promise<KimiAuthLogoutResult> {
    const providerName = CHATGPT_PROVIDER_NAME;
    const path = this.options.configPath;
    const current = readConfigFileForUpdate(path);
    const accountId = chatGPTAccountId(current.providers[providerName]?.oauth?.key);
    if (accountId === undefined) return { providerName, ok: true };
    const revocationConfirmed = await this.chatGPT.logout(accountId, async () => {
      const config = readConfigFileForUpdate(path);
      if (chatGPTAccountId(config.providers[providerName]?.oauth?.key) !== accountId) return;
      removeChatGPTModels(config);
      await writeConfigFile(path, config);
    });
    this.options.onConfigUpdated?.(readConfigFile(path));
    return { providerName, ok: true, revocationConfirmed };
  }

  async getManagedUsage(providerName?: string | undefined): Promise<AuthManagedUsageResult> {
    const auth = this.resolveRuntimeManagedAuth(providerName);
    return this.toolkit.getManagedUsage(providerName, {
      oauthRef: auth.oauthRef,
      baseUrl: auth.baseUrl,
    });
  }

  async getCachedAccessToken(
    providerName?: string,
    oauthRef?: OAuthRef | undefined,
  ): Promise<string | undefined> {
    return this.toolkit.getCachedAccessToken(
      providerName,
      this.runtimeOAuthRef(providerName, oauthRef),
    );
  }

  readonly resolveOAuthTokenProvider = (
    providerName: string,
    oauthRef?: OAuthRef | undefined,
  ): BearerTokenProvider => {
    const provider = this.toolkit.tokenProvider(
      providerName,
      this.runtimeOAuthRef(providerName, oauthRef),
    );
    return {
      getAccessToken: async (options) => {
        try {
          return await provider.getAccessToken(options);
        } catch (error) {
          // Classify OAuth token failures into the public KimiError protocol;
          // unrecognized errors are rethrown raw (see mapOAuthTokenError).
          throw mapOAuthTokenError(error, providerName) ?? error;
        }
      },
    };
  };

  private resolveManagedAuth(providerName?: string | undefined): {
    readonly oauthRef?: OAuthRef | undefined;
    readonly baseUrl?: string | undefined;
  } {
    const name = providerName ?? KIMI_CODE_PROVIDER_NAME;
    // Read path: token/status resolution must work off a degraded config
    // instead of failing the session when an unrelated section is broken.
    // Write paths (the toolkit's configAdapter.read) stay strict.
    const config = loadRuntimeConfigSafe(this.options.configPath).config;
    const provider = config.providers[name];
    return {
      oauthRef: provider?.oauth,
      baseUrl: provider?.baseUrl,
    };
  }

  private activeChatGPTAccount(): string | undefined {
    return chatGPTAccountId(this.resolveManagedAuth(CHATGPT_PROVIDER_NAME).oauthRef?.key);
  }

  private resolveRuntimeManagedAuth(providerName?: string | undefined): {
    readonly oauthRef: OAuthRef;
    readonly baseUrl?: string | undefined;
  } {
    const auth = this.resolveManagedAuth(providerName);
    return resolveKimiCodeRuntimeAuth({
      configuredBaseUrl: auth.baseUrl,
      configuredOAuthRef: auth.oauthRef,
    });
  }

  private runtimeOAuthRef(
    providerName: string | undefined,
    oauthRef?: OAuthRef | undefined,
  ): OAuthRef | undefined {
    if ((providerName ?? KIMI_CODE_PROVIDER_NAME) !== KIMI_CODE_PROVIDER_NAME) return oauthRef;
    const auth = this.resolveManagedAuth(providerName);
    return resolveKimiCodeRuntimeAuth({
      configuredBaseUrl: auth.baseUrl,
      configuredOAuthRef: oauthRef ?? auth.oauthRef,
    }).oauthRef;
  }
}

function applyChatGPTModels(config: KimiConfig, models: readonly ChatGPTModel[]): void {
  if (models.length === 0) throw new Error('This ChatGPT account has no models available for plan usage.');
  const aliases = (config.models ??= {});
  const previousDefault = aliases[config.defaultModel ?? ''];
  const bySlug = new Map(models.map((model) => [model.slug, model]));
  for (const [alias, model] of Object.entries(aliases)) {
    if (model.provider !== CHATGPT_PROVIDER_NAME) continue;
    const metadata = bySlug.get(model.model);
    if (metadata === undefined || (model.serviceTier !== undefined && !metadata.serviceTiers.includes(model.serviceTier))) {
      delete aliases[alias];
    } else {
      aliases[alias] = withChatGPTModelEfforts(model, metadata);
    }
  }
  for (const model of models) {
    const alias = `${CHATGPT_PROVIDER_NAME}/${model.slug}`;
    const previous = aliases[alias];
    if (previous !== undefined && (previous.provider !== CHATGPT_PROVIDER_NAME || previous.model !== model.slug || previous.serviceTier !== undefined)) {
      throw new Error(`A configured model already uses the alias "${alias}".`);
    }
    const normal = previous ?? withChatGPTModelEfforts({
      provider: CHATGPT_PROVIDER_NAME,
      model: model.slug,
      displayName: model.displayName,
      maxContextSize: model.contextWindow ?? CUSTOM_REGISTRY_DEFAULT_MAX_CONTEXT,
    }, model);
    aliases[alias] = normal;
    for (const tier of model.serviceTiers) {
      const variantAlias = `${alias}/${tier}`;
      const saved = aliases[variantAlias];
      if (saved !== undefined && (saved.provider !== normal.provider || saved.model !== normal.model || saved.serviceTier !== tier)) {
        throw new Error(`A configured model already uses the alias "${variantAlias}".`);
      }
      const label = tier === 'priority' ? 'Fast' : 'Ultrafast';
      aliases[variantAlias] = {
        ...normal,
        displayName: `${normal.displayName ?? normal.model} · ${label}`,
        serviceTier: tier,
        overrides: saved?.overrides ?? normal.overrides,
      };
    }
  }
  if (config.defaultModel === undefined || aliases[config.defaultModel] === undefined) {
    const sameModel = previousDefault?.provider === CHATGPT_PROVIDER_NAME && bySlug.has(previousDefault.model);
    config.defaultModel = `${CHATGPT_PROVIDER_NAME}/${sameModel ? previousDefault.model : models[0]!.slug}`;
    if (!sameModel) config.thinking = undefined;
  }
}

function withChatGPTModelEfforts(model: ModelAlias, metadata: ChatGPTModel): ModelAlias {
  if (metadata.reasoningEfforts === undefined || metadata.reasoningEfforts.length === 0) return model;
  const efforts = metadata.reasoningEfforts.filter((effort) => effort !== 'none');
  const offEffort = metadata.reasoningEfforts.includes('none') ? 'none' : undefined;
  const capabilities = (model.capabilities ?? []).filter((capability) => capability !== 'always_thinking');
  if (efforts.length > 0) capabilities.push(offEffort === undefined ? 'always_thinking' : 'thinking');
  return {
    ...model,
    supportEfforts: efforts,
    offEffort,
    defaultEffort: metadata.defaultEffort !== undefined && efforts.includes(metadata.defaultEffort)
      ? metadata.defaultEffort
      : undefined,
    capabilities: [...new Set(capabilities)],
  };
}

function removeChatGPTModels(config: KimiConfig): void {
  delete config.providers[CHATGPT_PROVIDER_NAME];
  if (config.models !== undefined) {
    for (const [alias, model] of Object.entries(config.models)) {
      if (model.provider === CHATGPT_PROVIDER_NAME) delete config.models[alias];
    }
  }
  if (config.defaultModel !== undefined && config.models?.[config.defaultModel] === undefined) {
    config.defaultModel = undefined;
    config.thinking = undefined;
  }
  if (config.defaultProvider === CHATGPT_PROVIDER_NAME) config.defaultProvider = undefined;
}
