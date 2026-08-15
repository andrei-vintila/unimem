// =============================================================================
// Sync Manager – REST-based client↔server synchronisation
// =============================================================================
//
// Protocol (last-write-wins with conflict reporting):
//
//  PUSH  POST /api/sync/push
//        { clientId, entities: Entity[], lastSyncVersion }
//        → { success, syncVersion, conflicts[] }
//
//  PULL  GET  /api/sync/pull
//        ?clientId=…&lastSyncVersion=…&limit=…
//        → { entities: Entity[], syncVersion, hasMore }
//
// Every request carries the sync token as a bearer header; the server resolves
// it to a vault, and a request without one reaches nothing.
//
// `lastSyncVersion` is an opaque cursor - currently "<serverMs>|<entityId>",
// because a push stamps a whole batch with one millisecond and the entity ID is
// what breaks the tie. Treat it as opaque here: the server owns its shape, and
// this client only ever echoes back what it was last handed.
//
// The cursor lives in memory (surviving periodic syncs within a session). On a
// fresh page load it starts at '0', which causes a full pull - intentionally
// safe.
// =============================================================================

import type {
  Entity,
  EntityType,
  MemoryLayerType,
  SyncState,
  SyncConflict,
  ReplicationConfig,
  MemoryEvent,
} from '@unimem/types';
import type { SqlDatabase } from './client.js';

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

export interface SyncManagerConfig {
  client: SqlDatabase;
  replication: ReplicationConfig;
  clientId: string;
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

/** Convert a raw entities-table row (snake_case) to an Entity object. */
function rowToEntity(row: Record<string, unknown>): Entity {
  const base = {
    id: row.id as string,
    type: row.type as EntityType,
    memoryLayer: row.memory_layer as MemoryLayerType,
    title: row.title as string,
    content: row.content as string,
    embedding: row.embedding as number[] | undefined,
    links: (row.links as Entity['links']) ?? [],
    tags: (row.tags as string[]) ?? [],
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    // Carried explicitly: a tombstone that lost this field on the way out
    // would arrive at the other devices as an ordinary edit.
    ...(row.deleted_at
      ? { deletedAt: new Date(row.deleted_at as string) }
      : {}),
  };

  const metadata = row.metadata as Record<string, unknown> | null;
  if (metadata) {
    Object.assign(base, metadata);
  }

  return base as Entity;
}

// -----------------------------------------------------------------------------
// SyncManager
// -----------------------------------------------------------------------------

type SyncEventHandler = (event: MemoryEvent) => void;

export class SyncManager {
  private client: SqlDatabase;
  private config: ReplicationConfig;
  private clientId: string;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private eventHandlers: Set<SyncEventHandler> = new Set();

  /** Cursor: the latest server version we have pulled so far. */
  private lastSyncVersion = '0';

  private state: SyncState = {
    status: 'synced',
    pendingChanges: 0,
    conflictCount: 0,
  };

  constructor(config: SyncManagerConfig) {
    this.client = config.client;
    this.config = config.replication;
    this.clientId = config.clientId;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    if (!this.config.enabled || !this.config.serverUrl) {
      console.log('[SyncManager] Sync disabled or no server URL configured');
      return;
    }

    if (!this.config.authToken) {
      console.log('[SyncManager] No sync token configured');
      return;
    }

    await this.sync();

    if (this.config.syncInterval > 0) {
      this.syncInterval = setInterval(
        () => this.sync(),
        this.config.syncInterval
      );
    }
  }

  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Sync cycle
  // ---------------------------------------------------------------------------

  async sync(): Promise<SyncState> {
    this.updateState({ status: 'syncing' });
    this.emit('sync:started', { clientId: this.clientId });

    try {
      const pendingRows = await this.getPendingRows();

      if (pendingRows.length > 0) {
        await this.pushChanges(pendingRows);
      }

      await this.pullChanges();

      this.state = {
        status: 'synced',
        lastSyncedAt: new Date(),
        pendingChanges: 0,
        conflictCount: await this.getConflictCount(),
      };

      this.emit('sync:completed', this.state);
    } catch (error) {
      this.state = { ...this.state, status: 'error' };
      console.error('[SyncManager] Sync error:', error);
    }

    return this.state;
  }

  getState(): SyncState {
    return this.state;
  }

  // ---------------------------------------------------------------------------
  // Conflict resolution
  // ---------------------------------------------------------------------------

  async getConflicts(): Promise<SyncConflict[]> {
    const result = await this.client.execute(`
      SELECT * FROM sync_log
      WHERE resolved IS NULL
      ORDER BY timestamp DESC
    `);

    return (result.rows as Array<Record<string, unknown>>).map((row) => {
      const payload = row.payload as {
        local: SyncConflict['localVersion'] | null;
        remote: SyncConflict['remoteVersion'];
      };

      return {
        entityId: row.entity_id as string,
        localVersion: payload.local ?? payload.remote,
        remoteVersion: payload.remote,
      };
    });
  }

  async resolveConflict(
    entityId: string,
    resolution: 'local' | 'remote' | 'merged',
    mergedEntity?: unknown
  ): Promise<void> {
    if (resolution === 'local') {
      await this.client.execute(
        `UPDATE sync_log SET resolved = NOW() WHERE entity_id = $1 AND resolved IS NULL`,
        [entityId]
      );
    } else if (resolution === 'remote') {
      const conflicts = await this.getConflicts();
      const conflict = conflicts.find((c) => c.entityId === entityId);
      if (conflict) {
        await this.client.execute(
          `UPDATE entities SET title = $1, content = $2, updated_at = NOW()
           WHERE id = $3`,
          [conflict.remoteVersion.title, conflict.remoteVersion.content, entityId]
        );
      }
      await this.client.execute(
        `UPDATE sync_log SET resolved = NOW() WHERE entity_id = $1 AND resolved IS NULL`,
        [entityId]
      );
    } else if (resolution === 'merged' && mergedEntity) {
      const merged = mergedEntity as { title: string; content: string };
      await this.client.execute(
        `UPDATE entities SET title = $1, content = $2, updated_at = NOW()
         WHERE id = $3`,
        [merged.title, merged.content, entityId]
      );
      await this.client.execute(
        `UPDATE sync_log SET resolved = NOW() WHERE entity_id = $1 AND resolved IS NULL`,
        [entityId]
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  on(handler: SyncEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(type: MemoryEvent['type'], payload: unknown): void {
    const event: MemoryEvent = {
      type,
      payload,
      timestamp: new Date(),
      source: 'local',
    };
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error('[SyncManager] Event handler error:', err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Push
  // ---------------------------------------------------------------------------

  private async getPendingRows(): Promise<Entity[]> {
    const result = await this.client.execute(`
      SELECT * FROM entities
      WHERE sync_status = 'pending'
      ORDER BY updated_at ASC
    `);
    return (result.rows as Array<Record<string, unknown>>).map(rowToEntity);
  }

  /**
   * The sync token is what selects the vault on the server, so a request
   * without it reaches nothing - there is no anonymous vault to fall back to.
   */
  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.config.authToken}` };
  }

  private async pushChanges(entities: Entity[]): Promise<void> {
    const serverUrl = this.config.serverUrl!;

    const response = await fetch(`${serverUrl}/api/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify({
        clientId: this.clientId,
        entities,
        lastSyncVersion: this.lastSyncVersion,
      }),
    });

    if (!response.ok) {
      throw new Error(`Push failed: ${response.status} ${response.statusText}`);
    }

    const result = (await response.json()) as {
      success: boolean;
      syncVersion: string;
      conflicts: Array<{ entityId: string; serverVersion: Entity }>;
    };

    // Log conflicts to sync_log for later resolution.
    //
    // Both sides are stored. The local entity is only in hand here, at the
    // moment of the push - by the time anyone resolves the conflict the row
    // may have moved on, and a log holding just the server's copy cannot
    // answer the one question resolution asks: what did these two disagree on?
    const pushedById = new Map(entities.map((entity) => [entity.id, entity]));

    for (const conflict of result.conflicts) {
      await this.client.execute(
        `INSERT INTO sync_log (entity_id, operation, payload, client_id)
         VALUES ($1, 'conflict', $2, $3)`,
        [
          conflict.entityId,
          JSON.stringify({
            local: pushedById.get(conflict.entityId) ?? null,
            remote: conflict.serverVersion,
          }),
          this.clientId,
        ]
      );
      this.emit('sync:conflict', conflict);
    }

    // Mark non-conflicting entities as synced
    const conflictIds = new Set(result.conflicts.map((c) => c.entityId));
    for (const entity of entities) {
      if (!conflictIds.has(entity.id)) {
        await this.client.execute(
          `UPDATE entities
           SET sync_status = 'synced', sync_version = $1
           WHERE id = $2`,
          [result.syncVersion, entity.id]
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pull
  // ---------------------------------------------------------------------------

  private async pullChanges(): Promise<void> {
    const serverUrl = this.config.serverUrl!;

    let hasMore = true;
    let cursor = this.lastSyncVersion;

    while (hasMore) {
      const url = new URL(`${serverUrl}/api/sync/pull`);
      url.searchParams.set('clientId', this.clientId);
      url.searchParams.set('lastSyncVersion', cursor);
      url.searchParams.set('limit', '100');

      const response = await fetch(url.toString(), {
        headers: this.authHeaders(),
      });
      if (!response.ok) {
        throw new Error(`Pull failed: ${response.status} ${response.statusText}`);
      }

      const result = (await response.json()) as {
        entities: Entity[];
        syncVersion: string;
        hasMore: boolean;
      };

      for (const entity of result.entities) {
        await this.upsertRemoteEntity(entity, result.syncVersion);
      }

      // A cursor that does not move means the next request would return this
      // same page. Stop rather than spin: the remaining entities come down on
      // the next sync, and a server old enough to page by timestamp alone
      // cannot advance past a batch written in a single millisecond.
      if (result.syncVersion === cursor) break;

      cursor = result.syncVersion;
      hasMore = result.hasMore;
    }

    this.lastSyncVersion = cursor;
  }

  /**
   * Insert or update a remote entity, keeping the newer version.
   *
   * A tombstone is just an entity carrying `deletedAt`, so it travels the same
   * path as an edit and wins or loses by the same comparison. Inserting one we
   * have never seen is deliberate: without the tombstone on record, a later
   * push from a third device could resurrect the entity here.
   */
  private async upsertRemoteEntity(
    entity: Entity,
    syncVersion: string
  ): Promise<void> {
    const existing = await this.client.execute(
      `SELECT updated_at FROM entities WHERE id = $1`,
      [entity.id]
    );

    const remoteUpdatedMs = new Date(entity.updatedAt).getTime();

    const deletedAt = entity.deletedAt ? new Date(entity.deletedAt) : null;

    if (existing.rows.length === 0) {
      // Insert
      await this.client.execute(
        `INSERT INTO entities
           (id, type, memory_layer, title, content, embedding, metadata,
            links, tags, created_at, updated_at, sync_status, sync_version,
            deleted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'synced',$12,$13)`,
        [
          entity.id,
          entity.type,
          entity.memoryLayer,
          entity.title,
          entity.content,
          entity.embedding ?? null,
          JSON.stringify(this.extractMetadata(entity)),
          JSON.stringify(entity.links ?? []),
          entity.tags ?? [],
          entity.createdAt,
          entity.updatedAt,
          syncVersion,
          deletedAt,
        ]
      );
    } else {
      const localUpdatedMs = new Date(
        (existing.rows[0] as Record<string, unknown>).updated_at as string
      ).getTime();

      if (remoteUpdatedMs > localUpdatedMs) {
        await this.client.execute(
          `UPDATE entities
           SET type=$1, memory_layer=$2, title=$3, content=$4,
               embedding=$5, metadata=$6, links=$7, tags=$8,
               updated_at=$9, sync_status='synced', sync_version=$10,
               deleted_at=$11
           WHERE id=$12`,
          [
            entity.type,
            entity.memoryLayer,
            entity.title,
            entity.content,
            entity.embedding ?? null,
            JSON.stringify(this.extractMetadata(entity)),
            JSON.stringify(entity.links ?? []),
            entity.tags ?? [],
            entity.updatedAt,
            syncVersion,
            deletedAt,
            entity.id,
          ]
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async getConflictCount(): Promise<number> {
    const result = await this.client.execute(
      `SELECT COUNT(*) AS count FROM sync_log WHERE resolved IS NULL`
    );
    return Number(
      (result.rows[0] as Record<string, unknown>)?.count ?? 0
    );
  }

  private updateState(partial: Partial<SyncState>): void {
    this.state = { ...this.state, ...partial };
  }

  private extractMetadata(entity: Partial<Entity>): Record<string, unknown> {
    const baseFields = new Set([
      'id', 'type', 'memoryLayer', 'title', 'content',
      'embedding', 'links', 'tags', 'createdAt', 'updatedAt', 'deletedAt',
    ]);
    const meta: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entity)) {
      if (!baseFields.has(key) && value !== undefined) {
        meta[key] = value;
      }
    }
    return meta;
  }
}

// -----------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------

export function createSyncManager(config: SyncManagerConfig): SyncManager {
  return new SyncManager(config);
}
