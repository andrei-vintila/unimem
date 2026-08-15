import { useStorage } from 'nitro/storage';

// =============================================================================
// Server-side Sync Store (Nitro KV Storage)
// =============================================================================
//
// Entities are stored as StoredEntity records keyed by vault and entity ID.
// The vault segment is the isolation boundary: a request can only ever name
// keys inside the vault its token resolved to (see utils/auth.ts).
//
// Versions are Unix ms timestamps (as strings), paired with the entity ID into
// a cursor so that a batch written within the same millisecond still has a
// total order to page through.
// =============================================================================

import type { Entity } from '@unimem/types';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface StoredEntity {
  entity: Entity;
  /** Unix ms timestamp string - when this entity was last written to server */
  serverVersion: string;
  /** Which client last modified this entity */
  clientId: string;
  /**
   * Where this document lives in the bundle, which is what write grants are
   * scoped to. Server-held rather than client-supplied on each request, so a
   * document cannot be moved out of a protected folder by claiming it was
   * somewhere else all along.
   */
  path: string;
  /** The actor who first wrote it. Creators keep access to their own notes. */
  createdBy?: string;
  /** The actor who last wrote it, as observed - never as claimed. */
  updatedBy?: string;
}

const NS = 'sync';
const PREFIX = 'entity';

/**
 * Vault IDs come from `deriveVaultId`, so they are always lowercase hex. This
 * is asserted rather than assumed: a key separator smuggled into the vault
 * segment would let one vault address another's keys.
 */
function vaultPrefix(vaultId: string): string {
  if (!/^[0-9a-f]{32}$/.test(vaultId)) {
    throw new Error('Invalid vault id');
  }
  return `${PREFIX}:${vaultId}:`;
}

// -----------------------------------------------------------------------------
// Cursors
// -----------------------------------------------------------------------------

/**
 * A pull cursor: the (version, entityId) pair of the last item the client has
 * seen. Ordering by version alone is not enough - a single push stamps every
 * entity in the batch with the same millisecond, so a batch larger than the
 * page limit would hand back the same page forever.
 */
export interface SyncCursor {
  version: string;
  entityId: string;
}

export const EMPTY_CURSOR: SyncCursor = { version: '0', entityId: '' };

export function formatCursor(cursor: SyncCursor): string {
  return `${cursor.version}|${cursor.entityId}`;
}

export function parseCursor(raw: string | undefined): SyncCursor {
  if (!raw) return EMPTY_CURSOR;

  const separator = raw.indexOf('|');

  // A bare version is what an older client sends, and what a fresh client
  // sends before its first successful pull ('0').
  if (separator === -1) {
    return { version: raw, entityId: '' };
  }

  return {
    version: raw.slice(0, separator),
    entityId: raw.slice(separator + 1),
  };
}

/** Negative if `a` sorts before `b`. */
function compareCursors(a: SyncCursor, b: SyncCursor): number {
  const versionDiff = toMs(a.version) - toMs(b.version);
  if (versionDiff !== 0) return versionDiff;

  return a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0;
}

function toMs(version: string): number {
  const parsed = parseInt(version, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

// -----------------------------------------------------------------------------
// Single-entity operations
// -----------------------------------------------------------------------------

export async function getStoredEntity(
  vaultId: string,
  id: string
): Promise<StoredEntity | null> {
  return useStorage(NS).getItem<StoredEntity>(`${vaultPrefix(vaultId)}${id}`);
}

export async function setStoredEntity(
  vaultId: string,
  id: string,
  data: StoredEntity
): Promise<void> {
  await useStorage(NS).setItem(`${vaultPrefix(vaultId)}${id}`, data);
}

// -----------------------------------------------------------------------------
// Bulk query
// -----------------------------------------------------------------------------

/**
 * Return this vault's entities ordered after `since` (exclusive), excluding
 * those last written by `excludeClientId` (to avoid echo), oldest-first and
 * limited to `limit` items.
 */
export async function getEntitiesAfter(
  vaultId: string,
  since: SyncCursor,
  excludeClientId: string,
  limit: number
): Promise<{ items: StoredEntity[]; hasMore: boolean; cursor: SyncCursor }> {
  const storage = useStorage(NS);
  const prefix = vaultPrefix(vaultId);
  const keys = await storage.getKeys(prefix);

  const matching: Array<{ item: StoredEntity; cursor: SyncCursor }> = [];

  for (const key of keys) {
    const item = await storage.getItem<StoredEntity>(key);
    if (!item) continue;
    if (item.clientId === excludeClientId) continue;

    const cursor: SyncCursor = {
      version: item.serverVersion,
      entityId: item.entity.id,
    };

    if (compareCursors(cursor, since) > 0) {
      matching.push({ item, cursor });
    }
  }

  matching.sort((a, b) => compareCursors(a.cursor, b.cursor));

  const page = matching.slice(0, limit);

  return {
    items: page.map((entry) => entry.item),
    hasMore: matching.length > limit,
    // Echo the caller's cursor back when nothing matched, so it never regresses.
    cursor: page.length > 0 ? page[page.length - 1].cursor : since,
  };
}

// -----------------------------------------------------------------------------
// Version helper
// -----------------------------------------------------------------------------

/** Generate a new server version string (Unix ms). */
export function generateVersion(): string {
  return Date.now().toString();
}

/**
 * Return true if `candidate` was written strictly after `reference`.
 * Both are Unix ms timestamp strings.
 */
export function versionIsAfter(candidate: string, reference: string): boolean {
  return toMs(candidate) > toMs(reference);
}
