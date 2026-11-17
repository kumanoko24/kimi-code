import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { createRemoteJWKSet, jwtVerify } from 'jose';
import lockfile from 'proper-lockfile';
import { z } from 'zod';

import {
  DEFAULT_OAUTH_HTTP_TIMEOUT_MS,
  DEFAULT_OAUTH_LOGIN_TIMEOUT_MS,
  OAUTH_FILE_LOCK_OPTIONS,
} from './constants';
import { OAuthAccessDeniedError, OAuthConnectionError, OAuthError, OAuthUnauthorizedError } from './errors';

export const CHATGPT_PROVIDER_NAME = 'chatgpt';
export const CHATGPT_SIGN_IN_FLAG = 'chatgpt_sign_in';
export const CHATGPT_API_BASE_URL = 'https://api.openai.com/v1';
export const CHATGPT_OAUTH_KEY_PREFIX = 'oauth/chatgpt/';
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';
export const CHATGPT_SERVICE_TIERS = ['priority', 'ultrafast'] as const;
export type ChatGPTServiceTier = (typeof CHATGPT_SERVICE_TIERS)[number];

const ISSUER = 'https://auth.openai.com';
const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`;
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const DYNAMIC_CLIENT_ID = 'dynamic_agent_client';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const REQUESTED_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', PLAN_SCOPE];
const LOOPBACK_HOST = '127.0.0.1';
const CALLBACK_PATH = '/auth/callback';
const LAUNCH_PATH = '/auth/start';
const EXPIRED_REFRESH_CODES = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);
const jwks = createRemoteJWKSet(new URL('/.well-known/jwks.json', ISSUER), {
  timeoutDuration: DEFAULT_OAUTH_HTTP_TIMEOUT_MS,
});

const text = z.string().min(1);
const sessionSchema = z.object({
  accessToken: text,
  refreshToken: text,
  expiresAt: z.number().positive(),
  scopes: z.array(text),
});
const registrationSchema = z.object({
  id: text,
  subject: text,
  clientId: text,
  email: text.optional(),
  idToken: text.optional(),
  session: sessionSchema.optional(),
});
const credentialsSchema = z.object({
  hostId: text,
  accounts: z.array(registrationSchema),
});
const tokenResponseSchema = z.object({
  access_token: text,
  refresh_token: text.optional(),
  id_token: text.optional(),
  scope: text.optional(),
  expires_in: z.number().positive(),
  token_type: z.string().refine((value) => value.toLowerCase() === 'bearer').optional(),
});
const modelsSchema = z.object({
  models: z.array(z.object({
    slug: text,
    display_name: text,
    visibility: text,
    context_window: z.number().int().positive().optional(),
    supported_reasoning_levels: z.array(z.object({ effort: text })).optional(),
    default_reasoning_level: text.nullish(),
    service_tiers: z.array(z.object({ id: text })).nullish(),
  })),
});

type Registration = z.infer<typeof registrationSchema>;
type Credentials = z.infer<typeof credentialsSchema>;
type Session = z.infer<typeof sessionSchema>;

export interface ChatGPTAccount {
  readonly id: string;
  readonly label: string;
  readonly connected: boolean;
}

export interface ChatGPTLoginOptions {
  readonly account?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly onBrowserUrl: (url: string) => void;
}

export interface ChatGPTModel {
  readonly slug: string;
  readonly displayName: string;
  readonly contextWindow?: number | undefined;
  readonly reasoningEfforts?: readonly string[] | undefined;
  readonly defaultEffort?: string | undefined;
  readonly serviceTiers: readonly ChatGPTServiceTier[];
}

export function chatGPTAccountId(oauthKey: string | undefined): string | undefined {
  return oauthKey?.startsWith(CHATGPT_OAUTH_KEY_PREFIX)
    ? oauthKey.slice(CHATGPT_OAUTH_KEY_PREFIX.length)
    : undefined;
}

export class ChatGPTSessions {
  private readonly dir: string;
  private readonly path: string;

  constructor(homeDir: string) {
    this.dir = join(homeDir, 'credentials', 'chatgpt');
    this.path = join(this.dir, 'accounts.json');
  }

  async list(): Promise<readonly ChatGPTAccount[]> {
    const credentials = await this.read();
    return (credentials?.accounts ?? []).map((account) => ({
      id: account.id,
      label: account.email === undefined ? `Account ${account.id}` : `${account.id}. ${account.email}`,
      connected: account.session !== undefined,
    }));
  }

  async getCachedAccessToken(accountId: string): Promise<string | undefined> {
    const credentials = await this.read();
    return credentials?.accounts.find((item) => item.id === accountId)?.session?.accessToken;
  }

  async listModels(accountId: string): Promise<readonly ChatGPTModel[]> {
    return fetchModels(await this.getAccessToken(accountId));
  }

  async login(
    options: ChatGPTLoginOptions,
    activate: (accountId: string, models: readonly ChatGPTModel[]) => Promise<void>,
  ): Promise<string> {
    const credentials = await this.withLock(async () => {
      const current = await this.read();
      if (current !== undefined) return current;
      const next = { hostId: `urn:uuid:${randomUUID()}`, accounts: [] };
      await this.write(next);
      return next;
    });
    const existing = credentials.accounts.find((item) => item.id === options.account);
    if (options.account !== undefined && existing === undefined) {
      throw new OAuthError('Unknown ChatGPT account. Run kimi login --provider chatgpt --list-accounts.');
    }
    const signal = requestSignal(DEFAULT_OAUTH_LOGIN_TIMEOUT_MS, options.signal);
    const { registration, session } = await authorize(credentials.hostId, existing, options.onBrowserUrl, signal);
    return this.withLock(async () => {
      signal.throwIfAborted();
      const latest = (await this.read()) ?? credentials;
      const matching = latest.accounts.find((item) => item.clientId === registration.clientId);
      if (matching !== undefined && matching.subject !== registration.subject) {
        throw new OAuthError('ChatGPT returned a different identity for this registration.');
      }
      const id = matching?.id ?? String(latest.accounts.length + 1);
      const next = { ...registration, id, session };
      const accounts = matching === undefined
        ? [...latest.accounts, next]
        : latest.accounts.map((item) => item.id === id ? next : item);
      const updated = { ...latest, accounts };
      if (session === undefined) {
        if (matching?.session === undefined) await this.write(updated);
        throw new OAuthError(
          'ChatGPT saved the account without plan permission. Select the account again and allow ChatGPT plan usage, or configure another provider.',
        );
      }
      if (matching?.session === undefined) await this.write(updated);
      const models = await fetchModels(session.accessToken, signal);
      if (models.length === 0) {
        throw new OAuthError('This ChatGPT account has no models available for plan usage.');
      }
      if (matching?.session !== undefined) await this.write(updated);
      try {
        await activate(id, models);
      } catch (error) {
        if (matching?.session !== undefined) await this.write(latest);
        throw error;
      }
      return id;
    });
  }

  async getAccessToken(accountId: string, force = false): Promise<string> {
    const initial = (await this.read())?.accounts.find((item) => item.id === accountId)?.session;
    if (initial === undefined) throw loginRequired();
    if (!force && initial.expiresAt > Date.now() + DEFAULT_OAUTH_HTTP_TIMEOUT_MS) {
      return initial.accessToken;
    }
    return this.withLock(async () => {
      const credentials = await this.read();
      const account = credentials?.accounts.find((item) => item.id === accountId);
      const current = account?.session;
      if (credentials === undefined || account === undefined || current === undefined) throw loginRequired();
      if (
        current.expiresAt > Date.now() + DEFAULT_OAUTH_HTTP_TIMEOUT_MS &&
        (!force || current.accessToken !== initial.accessToken)
      ) return current.accessToken;

      let session: Session | undefined;
      try {
        const token = await requestTokens({
          grant_type: 'refresh_token',
          client_id: account.clientId,
          refresh_token: current.refreshToken,
        });
        session = planSession(token, current);
      } catch (error) {
        if (!(error instanceof ChatGPTGrantError) || !EXPIRED_REFRESH_CODES.has(error.oauthCode ?? '')) {
          throw error;
        }
      }
      await this.write({
        ...credentials,
        accounts: credentials.accounts.map((item) => item.id === accountId
          ? { ...item, session }
          : item),
      });
      if (session === undefined) throw loginRequired();
      return session.accessToken;
    });
  }

  async logout(accountId: string, deactivate: () => Promise<void>): Promise<boolean> {
    return this.withLock(async () => {
      const credentials = await this.read();
      const account = credentials?.accounts.find((item) => item.id === accountId);
      const session = account?.session;
      const revoked = account === undefined || session === undefined || await revoke(account.clientId, session.refreshToken);
      if (credentials !== undefined && account !== undefined) {
        await this.write({
          ...credentials,
          accounts: credentials.accounts.map((item) => item.id === accountId
            ? { ...item, session: undefined, idToken: undefined }
            : item),
        });
      }
      await deactivate();
      return revoked;
    });
  }

  private async read(): Promise<Credentials | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    try {
      return credentialsSchema.parse(JSON.parse(raw));
    } catch {
      throw new OAuthError('ChatGPT credential file is invalid.');
    }
  }

  private async write(credentials: Credentials): Promise<void> {
    const temp = `${this.path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temp, 'wx', 0o600);
      try {
        await file.writeFile(`${JSON.stringify(credentials)}\n`);
        await file.chmod(0o600);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, this.path);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await chmod(this.dir, 0o700);
    const release = await lockfile.lock(this.dir, OAUTH_FILE_LOCK_OPTIONS);
    try {
      return await operation();
    } finally {
      await release();
    }
  }
}

function requestSignal(timeout: number, signal?: AbortSignal): AbortSignal {
  const deadline = AbortSignal.timeout(timeout);
  return signal === undefined ? deadline : AbortSignal.any([deadline, signal]);
}

function loginRequired(): OAuthUnauthorizedError {
  return new OAuthUnauthorizedError('ChatGPT plan access needs sign-in. Run kimi login --provider chatgpt.');
}

class ChatGPTGrantError extends OAuthError {
  constructor(status: number, readonly oauthCode: string | undefined, requestId: string | null) {
    super(`OpenAI rejected the ChatGPT token grant (HTTP ${status}${oauthCode ? `, ${oauthCode}` : ''}${requestId ? `, request ID ${requestId}` : ''}).`);
  }
}

async function requestTokens(
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<z.infer<typeof tokenResponseSchema>> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({ ...params, resource: CHATGPT_API_BASE_URL }),
    signal: requestSignal(DEFAULT_OAUTH_HTTP_TIMEOUT_MS, signal),
    redirect: 'error',
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const failure = z.object({ error: z.string().regex(/^[a-z0-9_]+$/u) }).safeParse(body);
    throw new ChatGPTGrantError(response.status, failure.data?.error, response.headers.get('x-request-id'));
  }
  const token = tokenResponseSchema.safeParse(body);
  if (!token.success) throw new OAuthError('OpenAI returned an invalid ChatGPT token response.');
  return token.data;
}

function planSession(token: z.infer<typeof tokenResponseSchema>, previous?: Session): Session | undefined {
  const scopes = token.scope?.split(/\s+/u) ?? previous?.scopes ?? [];
  if (!scopes.includes(PLAN_SCOPE)) return undefined;
  const refreshToken = token.refresh_token ?? previous?.refreshToken;
  if (refreshToken === undefined) throw new OAuthError('OpenAI did not return a ChatGPT refresh token.');
  return {
    accessToken: token.access_token,
    refreshToken,
    expiresAt: Date.now() + token.expires_in * 1000,
    scopes,
  };
}

async function fetchModels(accessToken: string, signal?: AbortSignal): Promise<ChatGPTModel[]> {
  const response = await fetch(`${CHATGPT_API_BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: requestSignal(DEFAULT_OAUTH_HTTP_TIMEOUT_MS, signal),
    redirect: 'error',
  });
  if (!response.ok) {
    const requestId = response.headers.get('x-request-id');
    await response.body?.cancel();
    throw new OAuthError(`ChatGPT model discovery failed (HTTP ${response.status}${requestId ? `, request ID ${requestId}` : ''}).`);
  }
  const parsed = modelsSchema.safeParse(await response.json());
  if (!parsed.success) throw new OAuthError('OpenAI returned an invalid ChatGPT model catalog.');
  return parsed.data.models
    .filter((model) => model.visibility === 'list')
    .map((model) => ({
      slug: model.slug,
      displayName: model.display_name,
      contextWindow: model.context_window,
      reasoningEfforts: model.supported_reasoning_levels === undefined
        ? undefined
        : [...new Set(model.supported_reasoning_levels.map(({ effort }) => effort))],
      defaultEffort: model.default_reasoning_level ?? undefined,
      serviceTiers: CHATGPT_SERVICE_TIERS.filter((tier) => model.service_tiers?.some(({ id }) => id === tier)),
    }));
}

async function revoke(clientId: string, refreshToken: string): Promise<boolean> {
  try {
    const response = await fetch(`${ISSUER}/.well-known/openid-configuration`, {
      signal: requestSignal(DEFAULT_OAUTH_HTTP_TIMEOUT_MS),
      redirect: 'error',
    });
    if (!response.ok) return false;
    const metadata = z.object({ revocation_endpoint: z.url() }).parse(await response.json());
    if (new URL(metadata.revocation_endpoint).origin !== ISSUER) return false;
    const result = await fetch(metadata.revocation_endpoint, {
      method: 'POST',
      body: new URLSearchParams({
        token: refreshToken,
        token_type_hint: 'refresh_token',
        client_id: clientId,
      }),
      signal: requestSignal(DEFAULT_OAUTH_HTTP_TIMEOUT_MS),
      redirect: 'error',
    });
    await result.body?.cancel();
    return result.status === 200;
  } catch {
    return false;
  }
}

async function authorize(
  hostId: string,
  existing: Registration | undefined,
  onBrowserUrl: (url: string) => void,
  signal: AbortSignal,
): Promise<{ registration: Omit<Registration, 'id' | 'session'>; session: Session | undefined }> {
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const launchKey = randomBytes(32).toString('base64url');

  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: existing?.clientId ?? DYNAMIC_CLIENT_ID,
    ext_agent_host_id: hostId,
    scope: REQUESTED_SCOPES.join(' '),
    resource: CHATGPT_API_BASE_URL,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state,
    nonce,
  }).toString();
  if (existing === undefined) authorizeUrl.searchParams.set('agent_name_hint', 'Kimi Code CLI');
  if (existing?.email !== undefined) authorizeUrl.searchParams.set('login_hint', existing.email);
  if (existing?.idToken !== undefined) authorizeUrl.searchParams.set('id_token_hint', existing.idToken);
  if (existing !== undefined && existing.session === undefined) authorizeUrl.searchParams.set('prompt', 'consent');

  let resolveCallback!: (result: { code: string; clientId: string }) => void;
  let rejectCallback!: (error: unknown) => void;
  const callback = new Promise<{ code: string; clientId: string }>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  void callback.catch(() => undefined);
  const abort = (): void => {
    rejectCallback(signal.reason);
  };
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const url = URL.parse(request.url ?? '', 'http://127.0.0.1');
    if (request.method !== 'GET' || url === null || request.headers.host !== `${LOOPBACK_HOST}:${port}`) {
      response.writeHead(404).end();
      return;
    }
    if (url.pathname === LAUNCH_PATH && url.searchParams.get('key') === launchKey) {
      response.writeHead(302, { Location: authorizeUrl.href }).end();
      return;
    }
    if (url.pathname !== CALLBACK_PATH || url.searchParams.get('state') !== state) {
      response.writeHead(400).end('This request does not match the active ChatGPT sign-in.');
      return;
    }
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const issued = url.searchParams.get('client_id');
    const clientId = existing?.clientId ?? issued;
    if (error !== null || !code || !clientId || clientId === DYNAMIC_CLIENT_ID || (issued !== null && issued !== clientId)) {
      response.writeHead(400).end('ChatGPT authorization could not be completed. Return to Kimi Code CLI.');
      rejectCallback(error === 'access_denied'
        ? new OAuthAccessDeniedError('ChatGPT authorization was declined.')
        : new OAuthError('OpenAI returned an invalid ChatGPT authorization response.'));
      return;
    }
    response.end('ChatGPT authorization received. Return to Kimi Code CLI to finish signing in.');
    resolveCallback({ code, clientId });
  });
  let port: number;
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, LOOPBACK_HOST, () => {
        server.off('error', reject);
        resolve();
      });
    });
    const onError = (): void => {
      rejectCallback(new OAuthConnectionError('The ChatGPT callback listener failed.'));
    };
    server.on('error', onError);
    port = (server.address() as AddressInfo).port;
    const origin = `http://${LOOPBACK_HOST}:${port}`;
    const redirectUri = `${origin}${CALLBACK_PATH}`;
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    signal.throwIfAborted();
    onBrowserUrl(`${origin}${LAUNCH_PATH}?key=${launchKey}`);
    const { code, clientId } = await callback;
    const token = await requestTokens({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }, signal);
    if (token.id_token === undefined) throw new OAuthError('OpenAI did not return a ChatGPT identity token.');
    const idToken = token.id_token;
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: ISSUER,
      audience: clientId,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'exp', 'nonce'],
    }).catch(() => {
      throw new OAuthError('OpenAI returned an unverifiable ChatGPT identity token.');
    });
    if (!payload.sub || payload['nonce'] !== nonce || (existing !== undefined && payload.sub !== existing.subject)) {
      throw new OAuthError('ChatGPT identity did not match this sign-in attempt.');
    }
    return {
      registration: {
        subject: payload.sub,
        clientId,
        email: typeof payload['email'] === 'string' ? payload['email'] : existing?.email,
        idToken,
      },
      session: planSession(token),
    };
  } finally {
    signal.removeEventListener('abort', abort);
    server.close();
    server.closeAllConnections();
  }
}
