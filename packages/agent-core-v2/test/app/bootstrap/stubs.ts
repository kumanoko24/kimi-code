import type { ServiceRegistration } from '#/_base/di/test';
import { join, relative } from 'pathe';
import {
  IBootstrapService,
  resolveHostArgs,
  type HostArgsInput,
  type PersistenceScopeName,
  type SessionStorageRoot,
} from '#/app/bootstrap/bootstrap';

export const stubClientIdentity = {
  productName: 'test-product',
  version: '0.0.0-test',
  platform: 'test_platform',
} as const;

export function stubBootstrap(
  homeDir = '/tmp/kimi-home',
  env: NodeJS.ProcessEnv = {},
  args: HostArgsInput = {},
  homes: { readonly authHomeDir?: string; readonly sessionHomeDir?: string } = {},
): IBootstrapService {
  const authHomeDir = homes.authHomeDir ?? homeDir;
  const sessionHomeDir = homes.sessionHomeDir ?? homeDir;
  const roots: SessionStorageRoot[] = [sessionHomeDir, ...(sessionHomeDir === homeDir ? [] : [homeDir])].map(
    (rootHomeDir) => {
      const homeScope = relative(homeDir, rootHomeDir);
      return {
        homeDir: rootHomeDir,
        homeScope: homeScope === '.' ? '' : homeScope,
        sessionsDir: join(rootHomeDir, 'sessions'),
        sessionsScope: relative(homeDir, join(rootHomeDir, 'sessions')),
      };
    },
  );
  const scopes: Record<PersistenceScopeName, string> = {
    config: '',
    sessions: roots[0]!.sessionsScope,
    blobs: 'blobs',
    store: 'store',
    logs: 'logs',
    cache: 'cache',
    credentials: 'credentials',
  };
  return {
    _serviceBrand: undefined,
    platform: 'linux',
    arch: 'x64',
    cwd: '/tmp',
    osHomeDir: '/home/test',
    homeDir,
    authHomeDir,
    authCredentialsReadOnly: authHomeDir !== homeDir,
    configPath: `${homeDir}/config.toml`,
    configKey: 'config.toml',
    clientIdentity: stubClientIdentity,
    args: resolveHostArgs(args),
    sessionStorageRoots: roots,
    sessionsDir: roots[0]!.sessionsDir,
    blobsDir: `${homeDir}/blobs`,
    storeDir: `${homeDir}/store`,
    cacheDir: `${homeDir}/cache`,
    logsDir: `${homeDir}/logs`,
    getEnv: (name) => env[name],
    scope: (name) => scopes[name],
  };
}

export function registerBootstrapServices(reg: ServiceRegistration): void {
  const homeDir = `/tmp/kimi-code-agent-core-v2-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  reg.defineInstance(IBootstrapService, stubBootstrap(homeDir));
}
