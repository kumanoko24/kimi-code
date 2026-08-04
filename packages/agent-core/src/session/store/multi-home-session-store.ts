import { resolve } from 'pathe';

import { ErrorCodes, KimiError } from '#/errors';
import type { JsonObject, ListSessionsPayload, SessionSummary } from '#/rpc/core-api';
import {
  SessionStore,
  type CreateSessionRecordInput,
  type ForkSessionRecordInput,
  type SessionStoreOptions,
} from '#/session/store/session-store';

interface OwnedSession {
  readonly store: SessionStore;
  readonly summary: SessionSummary;
}

/**
 * Routes session operations across one primary home and zero or more fallback
 * homes. Creates and forks land in the primary; mutations of existing sessions
 * stay bound to the store that owns their directory.
 */
export class MultiHomeSessionStore {
  private readonly primary: SessionStore;
  private readonly stores: readonly SessionStore[];

  constructor(
    primaryHomeDir: string,
    fallbackHomeDirs: readonly string[],
    options: SessionStoreOptions = {},
  ) {
    const primaryPath = resolve(primaryHomeDir);
    const homes = [primaryPath, ...fallbackHomeDirs.map((homeDir) => resolve(homeDir))].filter(
      (homeDir, index, all) => all.indexOf(homeDir) === index,
    );
    this.primary = new SessionStore(primaryPath, options);
    this.stores = [
      this.primary,
      ...homes.slice(1).map((homeDir) => new SessionStore(homeDir, options)),
    ];
  }

  async create(input: CreateSessionRecordInput): Promise<SessionSummary> {
    await this.assertAvailable(input.id);
    return this.primary.create(input);
  }

  async fork(input: ForkSessionRecordInput): Promise<SessionSummary> {
    const source = await this.owner(input.sourceId);
    await this.assertAvailable(input.targetId);
    return this.primary.forkFrom(input, source.summary);
  }

  async get(id: string): Promise<SessionSummary> {
    return (await this.owner(id)).summary;
  }

  async rename(id: string, title: string): Promise<void> {
    await (await this.owner(id)).store.rename(id, title);
  }

  async archive(id: string): Promise<SessionSummary> {
    return (await this.owner(id)).store.archive(id);
  }

  async delete(id: string): Promise<void> {
    await (await this.owner(id)).store.delete(id);
  }

  async list(options: ListSessionsPayload = {}): Promise<readonly SessionSummary[]> {
    const results = await Promise.all(this.stores.map((store) => store.list(options)));
    const merged = new Map<string, SessionSummary>();
    for (const summary of results.flat()) {
      const existing = merged.get(summary.id);
      if (existing !== undefined && resolve(existing.sessionDir) !== resolve(summary.sessionDir)) {
        throw sessionStorageConflict(summary.id, [existing.sessionDir, summary.sessionDir]);
      }
      merged.set(summary.id, summary);
    }
    return [...merged.values()].toSorted(compareSessionSummary);
  }

  async reindex(): Promise<{
    scanned: number;
    added: number;
    repaired: number;
  }> {
    const results = await Promise.all(this.stores.map((store) => store.reindex()));
    return results.reduce(
      (total, result) => ({
        scanned: total.scanned + result.scanned,
        added: total.added + result.added,
        repaired: total.repaired + result.repaired,
      }),
      { scanned: 0, added: 0, repaired: 0 },
    );
  }

  async assertDirectory(id: string): Promise<string> {
    return (await this.owner(id)).summary.sessionDir;
  }

  private async assertAvailable(id: string): Promise<void> {
    const owners = await this.owners(id);
    if (owners.length === 0) return;
    if (owners.length > 1) {
      throw sessionStorageConflict(
        id,
        owners.map(({ summary }) => summary.sessionDir),
      );
    }
    throw new KimiError(ErrorCodes.SESSION_ALREADY_EXISTS, `Session "${id}" already exists`);
  }

  private async owner(id: string): Promise<OwnedSession> {
    const owners = await this.owners(id);
    if (owners.length === 0) {
      throw new KimiError(ErrorCodes.SESSION_NOT_FOUND, `Session "${id}" was not found`, {
        details: { sessionId: id },
      });
    }
    if (owners.length > 1) {
      throw sessionStorageConflict(
        id,
        owners.map(({ summary }) => summary.sessionDir),
      );
    }
    return owners[0]!;
  }

  private async owners(id: string): Promise<readonly OwnedSession[]> {
    const results = await Promise.all(
      this.stores.map(async (store) => {
        const sessions = await store.list({
          sessionId: id,
          includeArchive: true,
        });
        return sessions[0] === undefined ? undefined : { store, summary: sessions[0] };
      }),
    );
    return results.filter((owner): owner is OwnedSession => owner !== undefined);
  }
}

function sessionStorageConflict(id: string, sessionDirs: readonly string[]): KimiError {
  return new KimiError(
    ErrorCodes.SESSION_STORAGE_CONFLICT,
    `Session "${id}" exists in more than one session home`,
    { details: { sessionId: id, sessionDirs: [...sessionDirs] } as JsonObject },
  );
}

function compareSessionSummary(a: SessionSummary, b: SessionSummary): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  return a.id.localeCompare(b.id);
}
