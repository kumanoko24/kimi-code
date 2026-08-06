/**
 * `bootstrap` domain — frozen startup snapshot and composition root.
 *
 * Defines the `IBootstrapService`, the snapshot of the world the process runs
 * in, resolved once at startup and frozen for the process: observed host facts
 * (`platform`, `arch`, `cwd`, `osHomeDir`, `getEnv`, `clientIdentity`), the
 * app path layout (`homeDir`, `configPath`, …), and the host's process-level
 * invocation arguments (`args` — mirroring VS Code's `NativeParsedArgs`
 * carried on the environment service: the host states them once in
 * `BootstrapInput`; downstream services read them here instead of through
 * per-domain runtime-options services). `resolveBootstrapOptions` is
 * the single place that reads `process.env` / `os.homedir()` / invocation
 * input to resolve the snapshot; everything downstream reads from
 * `IBootstrapService` instead of touching `process` directly. Bound at App
 * scope. Also seeds the `IFileSystemStorageService` with a `FileStorageService`
 * rooted at `homeDir` so the byte layer (and every Store above it) persists
 * to disk.
 */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

import { join, relative } from 'pathe';

import type { KimiHostIdentity } from '@moonshot-ai/kimi-code-oauth';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import { createAppScope, type Scope, type ScopeSeed } from '#/_base/di/scope';
import {
  IFileSystemStorageService,
} from '#/persistence/interface/storage';
import { FileStorageService } from '#/persistence/backends/node-fs/fileStorageService';
import { FileSkillDiscovery } from '#/app/skillCatalog/fileSkillDiscovery';
import { ISkillDiscovery } from '#/app/skillCatalog/skillDiscovery';

/**
 * Host invocation arguments — process-level overrides the embedding host
 * states once at startup (mirrors VS Code's `NativeParsedArgs` carried on the
 * environment service). Resolved from {@link HostArgsInput} and read via
 * `IBootstrapService.args`.
 */
export interface HostArgs {
  /**
   * Explicit agent definition files for this process (the CLI's
   * `--agent-file`): loaded as the highest-priority `explicit` agent-profile
   * source. Undefined means no explicit files.
   */
  readonly agentFiles?: readonly string[];
  /**
   * Explicit skill directories for this process (v1's SDK `skillDirs`): when
   * non-empty, default user / project skill discovery is skipped and these
   * directories serve as the user skill source.
   */
  readonly skillDirs?: readonly string[];
  /**
   * Host identity headers applied to outbound provider requests (User-Agent +
   * `X-Msh-*`, built by the host through `createKimiDefaultHeaders`).
   * Materialized to `{}` when the host passes none.
   */
  readonly requestHeaders: Readonly<Record<string, string>>;
  /** Fills the `${product_name}` slot in the base system-prompt template. */
  readonly displayName?: string;
  /** Replaces the `${reply_style_guide}` block in the base system prompt. */
  readonly replyStyleGuide?: string;
}

/** {@link HostArgs} as accepted from the host: `requestHeaders` may be omitted. */
export interface HostArgsInput {
  readonly agentFiles?: readonly string[];
  readonly skillDirs?: readonly string[];
  readonly requestHeaders?: Readonly<Record<string, string>>;
  readonly displayName?: string;
  readonly replyStyleGuide?: string;
}

export function resolveHostArgs(input: HostArgsInput | undefined): HostArgs {
  return {
    agentFiles: input?.agentFiles,
    skillDirs: input?.skillDirs,
    requestHeaders: input?.requestHeaders ?? {},
    displayName: input?.displayName,
    replyStyleGuide: input?.replyStyleGuide,
  };
}

export interface IBootstrapOptions {
  readonly homeDir: string;
  readonly authHomeDir: string;
  readonly authCredentialsReadOnly: boolean;
  readonly sessionStorageRoots: readonly SessionStorageRoot[];
  readonly configPath: string;
  readonly osHomeDir: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly clientIdentity: KimiHostIdentity;
  readonly args: HostArgs;
}

export interface SessionStorageRoot {
  /** Absolute Kimi home owning this session tree. */
  readonly homeDir: string;
  /** Storage scope addressing the owning home from the runtime home. */
  readonly homeScope: string;
  /** Absolute directory containing workspace session buckets. */
  readonly sessionsDir: string;
  /** Storage scope addressing the sessions directory from the runtime home. */
  readonly sessionsScope: string;
}

export const IBootstrapOptions: ServiceIdentifier<IBootstrapOptions> =
  createDecorator<IBootstrapOptions>('bootstrapOptions');

export type PersistenceScopeName =
  | 'config'
  | 'sessions'
  | 'blobs'
  | 'store'
  | 'logs'
  | 'cache'
  | 'credentials'
  | 'cron';

export interface IBootstrapService {
  readonly _serviceBrand: undefined;

  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly cwd: string;
  readonly osHomeDir: string;
  readonly homeDir: string;
  /** Home used for OAuth credential IO. */
  readonly authHomeDir: string;
  /** Explicit login/logout must not mutate credentials borrowed from another home. */
  readonly authCredentialsReadOnly: boolean;
  readonly configPath: string;
  readonly clientIdentity: KimiHostIdentity;
  /** Host invocation arguments; see {@link HostArgs}. */
  readonly args: HostArgs;
  /** Primary session root first, followed by read/resume fallbacks. */
  readonly sessionStorageRoots: readonly SessionStorageRoot[];
  readonly sessionsDir: string;
  readonly blobsDir: string;
  readonly storeDir: string;
  readonly cacheDir: string;
  readonly logsDir: string;
  getEnv(name: string): string | undefined;
  scope(name: PersistenceScopeName): string;
  readonly configKey: string;
}

export const IBootstrapService: ServiceIdentifier<IBootstrapService> =
  createDecorator<IBootstrapService>('bootstrapService');

export interface BootstrapInput {
  readonly homeDir?: string;
  /** OAuth credential home; defaults to `homeDir`. */
  readonly authHomeDir?: string;
  /** Primary session home; defaults to `homeDir`. A distinct runtime home remains a fallback. */
  readonly sessionHomeDir?: string;
  readonly configPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly osHomeDir?: string;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly cwd?: string;
  /** Required: every process names its host. There is deliberately no default
      — a fabricated identity would silently misreport the host upstream. */
  readonly clientIdentity: KimiHostIdentity;
  /** Host invocation arguments; see {@link HostArgsInput}. */
  readonly args?: HostArgsInput;
}

export function resolveBootstrapOptions(input: BootstrapInput): IBootstrapOptions {
  const env = input.env ?? process.env;
  const osHomeDir = input.osHomeDir ?? homedir();
  const homeDir = resolveKimiHome(input.homeDir, env, osHomeDir);
  const authHomeDir = resolveKimiHome(input.authHomeDir ?? homeDir, env, osHomeDir);
  const sessionHomeDir = resolveKimiHome(input.sessionHomeDir ?? homeDir, env, osHomeDir);
  const configPath = input.configPath ?? join(homeDir, 'config.toml');
  const sessionHomeDirs = sessionHomeDir === homeDir ? [sessionHomeDir] : [sessionHomeDir, homeDir];
  const sessionStorageRoots = sessionHomeDirs.map((rootHomeDir): SessionStorageRoot => ({
    homeDir: rootHomeDir,
    homeScope: relativeScope(homeDir, rootHomeDir),
    sessionsDir: join(rootHomeDir, 'sessions'),
    sessionsScope: relativeScope(homeDir, join(rootHomeDir, 'sessions')),
  }));
  return {
    homeDir,
    authHomeDir,
    authCredentialsReadOnly: authHomeDir !== homeDir,
    sessionStorageRoots,
    configPath,
    osHomeDir,
    platform: input.platform ?? process.platform,
    arch: input.arch ?? process.arch,
    cwd: input.cwd ?? process.cwd(),
    env,
    clientIdentity: input.clientIdentity,
    args: resolveHostArgs(input.args),
  };
}

function relativeScope(from: string, to: string): string {
  const scope = relative(from, to);
  return scope === '.' ? '' : scope;
}

export function bootstrapSeed(input: BootstrapInput): ScopeSeed {
  return [[IBootstrapOptions as ServiceIdentifier<unknown>, resolveBootstrapOptions(input)]];
}

export interface BootstrapResult {
  readonly app: Scope;
}

export function bootstrap(input: BootstrapInput, extraSeeds: ScopeSeed = []): BootstrapResult {
  const options = resolveBootstrapOptions(input);
  const app = createAppScope({
    extra: [...bootstrapSeed(input), ...storageSeed(options), ...skillSeed(), ...extraSeeds],
  });
  return { app };
}

function storageSeed(options: IBootstrapOptions): ScopeSeed {
  const file = (): SyncDescriptor<IFileSystemStorageService> =>
    new SyncDescriptor(FileStorageService, [options.homeDir, 0o700, 0o600]);
  return [
    [IFileSystemStorageService as ServiceIdentifier<unknown>, file()],
  ];
}

function skillSeed(): ScopeSeed {
  return [
    [
      ISkillDiscovery as ServiceIdentifier<unknown>,
      new SyncDescriptor(FileSkillDiscovery, []),
    ],
  ];
}

export function resolveKimiHome(
  homeDir?: string,
  env: NodeJS.ProcessEnv = process.env,
  osHomeDir: string = homedir(),
): string {
  return homeDir ?? env['KIMI_CODE_HOME'] ?? join(osHomeDir, '.kimi-code');
}

export function resolveConfigPath(input: {
  readonly homeDir?: string;
  readonly configPath?: string;
}): string {
  return input.configPath ?? join(resolveKimiHome(input.homeDir), 'config.toml');
}

export function ensureKimiHome(homeDir: string): void {
  mkdirSync(homeDir, { recursive: true, mode: 0o700 });
}
