import { useStorage } from 'nitro/storage';

// =============================================================================
// Server-side Sync Store (Nitro KV Storage)
// =============================================================================
//
// Entities are stored as StoredEntity records keyed by entity ID.
// Versions are Unix ms timestamps (as strings) for easy chronological
// comparison without a separate sequence counter.
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
}

const NS = 'sync';
const PREFIX = 'entity:';

// -----------------------------------------------------------------------------
// Single-entity operations
// -----------------------------------------------------------------------------

export async function getStoredEntity(id: string): Promise<StoredEntity | null> {
  return useStorage(NS).getItem<StoredEntity>(`${PREFIX}${id}`);
}

export async function setStoredEntity(
  id: string,
  data: StoredEntity
): Promise<void> {
  await useStorage(NS).setItem(`${PREFIX}${id}`, data);
}

// -----------------------------------------------------------------------------
// Bulk query
// -----------------------------------------------------------------------------

/**
 * Return entities modified strictly after `sinceVersion` (exclusive),
 * excluding those last written by `excludeClientId` (to avoid echo),
 * sorted oldest-first and limited to `limit` items.
 */
export async function getEntitiesAfterVersion(
  sinceVersion: string,
  excludeClientId: string,
  limit: number
): Promise<{ items: StoredEntity[]; hasMore: boolean }> {
  const storage = useStorage(NS);
  const keys = await storage.getKeys(PREFIX);

  const sinceMs = sinceVersion ? parseInt(sinceVersion, 10) : 0;
  const matching: StoredEntity[] = [];

  for (const key of keys) {
    const item = await storage.getItem<StoredEntity>(key);
    if (!item) continue;

    const itemMs = parseInt(item.serverVersion, 10);
    if (itemMs > sinceMs && item.clientId !== excludeClientId) {
      matching.push(item);
    }
  }

  // Sort ascending so the client advances its cursor correctly
  matching.sort(
    (a, b) => parseInt(a.serverVersion, 10) - parseInt(b.serverVersion, 10)
  );

  const hasMore = matching.length > limit;
  return { items: matching.slice(0, limit), hasMore };
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
  return parseInt(candidate, 10) > parseInt(reference, 10);
}
