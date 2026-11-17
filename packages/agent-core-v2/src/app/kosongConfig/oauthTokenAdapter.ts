import { ChatGPTSessions, chatGPTAccountId } from '@moonshot-ai/kimi-code-oauth';

import { IBootstrapService } from '#/app/bootstrap/bootstrap';

import { LifecycleScope } from '#/app/scopes';

import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Error2 } from '#/_base/errors/errors';

import { IOAuthService } from '#/app/auth/auth';
import { AuthErrors } from '#/app/auth/errors';
import { nonEmpty } from '#/llm-adapter/model/model-auth';
import { IModelOAuthTokens } from '#/llm-adapter/model/model-oauth';
import type { OAuthRef } from '#/llm-adapter/provider/provider';

export class ModelOAuthTokenAdapter implements IModelOAuthTokens {
  declare readonly _serviceBrand: undefined;
  private readonly chatGPT: ChatGPTSessions;

  constructor(
    @IOAuthService private readonly oauth: IOAuthService,
    @IBootstrapService bootstrap: IBootstrapService,
  ) {
    this.chatGPT = new ChatGPTSessions(bootstrap.homeDir);
  }

  async hasCachedAccessToken(provider: string, oauthRef: OAuthRef): Promise<boolean> {
    try {
      const account = chatGPTAccountId(oauthRef.key);
      const token = account === undefined
        ? await this.oauth.getCachedAccessToken(provider, oauthRef)
        : await this.chatGPT.getCachedAccessToken(account);
      return nonEmpty(token) !== undefined;
    } catch {
      return false;
    }
  }

  async getAccessToken(
    provider: string,
    oauthRef: OAuthRef,
    options?: { readonly force?: boolean },
  ): Promise<string> {
    const account = chatGPTAccountId(oauthRef.key);
    if (account !== undefined) return this.chatGPT.getAccessToken(account, options?.force);
    const tokenProvider = this.oauth.resolveTokenProvider(provider, oauthRef);
    if (tokenProvider === undefined) throw loginRequired(provider);
    const token = await tokenProvider.getAccessToken(
      options?.force === true ? { force: true } : undefined,
    );
    if (token.trim().length === 0) throw loginRequired(provider);
    return token;
  }
}

function loginRequired(providerKey: string): Error2 {
  return new Error2(
    AuthErrors.codes.AUTH_LOGIN_REQUIRED,
    `OAuth provider "${providerKey}" requires login before it can be used.`,
  );
}

registerScopedService(
LifecycleScope.App,
  IModelOAuthTokens,
  ModelOAuthTokenAdapter,
  ScopeActivation.OnScopeCreated,
  'kosongConfig',
);
