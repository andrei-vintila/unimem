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
import { mergeEntities } from './merge.js';

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

export interface SyncManagerConfig {
  client: SqlDatabase;
  replication: ReplicationConfig;
  clientId: string;
  /**
   * Where each entity lives in the bundle, by id.
   *
   * The server scopes write grants by folder, so it needs to know where a
   * document sits - though it verifies the claim rather than trusting it, and
   * an entity whose path is unknown is simply scoped to its type's folder.
   */
  paths?: () => Record<string, string>;
  /**
   * Persist a document that arrived from the server into the store.
   *
   * On a surface whose store is the markdown bundle, the index alone is not
   * where the vault lives - a pulled change that only reached the index would
   * be discarded by the next rebuild. Omit on a surface where the index *is*
   * the store, such as the browser.
   */
  applyRemote?: (entity: Entity) => Promise<void>;
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

/**
 * Restore the Date fields JSON flattened into strings.
 *
 * A merge base is stored as JSON, and a merge compares timestamps - so a base
 * whose dates came back as strings would compare unequal to an identical Date
 * and report a conflict that is not one.
 */
function reviveDates(value: Record<string, unknown>): Entity {
  const revived = { ...value };
  for (const key of ['createdAt', 'updatedAt', 'deletedAt']) {
    if (typeof revived[key] === 'string') revived[key] = new Date(revived[key] as string);
  }
  return revived as unknown as Entity;
}

// -----------------------------------------------------------------------------
// SyncManager
// -----------------------------------------------------------------------------

type SyncEventHandler = (event: MemoryEvent) => void;

export class SyncManager {
  private client: SqlDatabase;
  private config: ReplicationConfig;
  private clientId: string;
  private paths: () => Record<string, string>;
  private applyRemote?: (entity: Entity) => Promise<void>;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private eventHandlers: Set<SyncEventHandler> = new Set();

  /** Cursor: the latest server version we have pulled so far. */
  private lastSyncVersion = '0';

  /** Who the server says we are. Absent until the first successful push. */
  private actor: string | null = null;

  /** Documents that arrived but could not be stored locally. */
  private skipped: Array<{ entityId: string; reason: string }> = [];

  /** Writes the server turned into change requests, for the UI to surface. */
  private rejections: Array<{
    entityId: string;
    reason: string;
    requestId?: string;
  }> = [];

  private state: SyncState = {
    status: 'synced',
    pendingChanges: 0,
    conflictCount: 0,
  };

  constructor(config: SyncManagerConfig) {
    this.client = config.client;
    this.config = config.replication;
    this.clientId = config.clientId;
    this.paths = config.paths ?? (() => ({}));
    this.applyRemote = config.applyRemote;
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

      const conflictCount = await this.getConflictCount();

      this.state = {
        status: conflictCount > 0 ? 'conflict' : 'synced',
        lastSyncedAt: new Date(),
        pendingChanges: 0,
        conflictCount,
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

  /**
   * Changes the server would not accept, from the last push.
   *
   * Distinct from a conflict: a conflict is two people editing the same thing,
   * a rejection is being told this is not yours to edit.
   */
  getRejections(): Array<{ entityId: string; reason: string; requestId?: string }> {
    return this.rejections;
  }

  /**
   * Who the server recognises this device as, once it has said so.
   *
   * Null before the first push. The client cannot know it in advance: on a
   * vault nobody has claimed, the identity is assigned at the moment of
   * claiming it.
   */
  getActor(): string | null {
    return this.actor;
  }

  /** Documents the last pull could not store. Separate from a rejection: this
   * one is our fault, or the sender's, rather than a permission decision. */
  getSkipped(): Array<{ entityId: string; reason: string }> {
    return this.skipped;
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
  // Merge base
  // ---------------------------------------------------------------------------

  /**
   * Record what this device and the server now agree the entity says.
   *
   * Captured on every accepted push and every applied pull, because that is
   * exactly when the two sides are known to be in step. It is the third input
   * a real merge needs; without it the only available answer is to pick a
   * winner and discard the loser's work.
   */
  private async captureBase(entity: Entity, syncVersion: string): Promise<void> {
    await this.client.execute(
      `INSERT INTO sync_base (entity_id, entity, sync_version, captured_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (entity_id) DO UPDATE
         SET entity = EXCLUDED.entity,
             sync_version = EXCLUDED.sync_version,
             captured_at = NOW()`,
      [entity.id, JSON.stringify(entity), syncVersion]
    );
  }

  private async readBase(entityId: string): Promise<Entity | null> {
    const result = await this.client.execute(
      `SELECT entity FROM sync_base WHERE entity_id = $1`,
      [entityId]
    );

    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;

    // JSONB comes back parsed; a driver that hands back text is still valid.
    const value = typeof row.entity === 'string' ? JSON.parse(row.entity) : row.entity;
    return reviveDates(value as Record<string, unknown>);
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
        paths: this.paths(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Push failed: ${response.status} ${response.statusText}`);
    }

    const result = (await response.json()) as {
      success: boolean;
      syncVersion: string;
      conflicts: Array<{ entityId: string; serverVersion: Entity }>;
      rejected?: Array<{ entityId: string; reason: string; requestId?: string }>;
      actor?: string;
    };

    // Writes the server would not apply directly. They are not lost: the
    // server keeps each as a change request for someone who can write there.
    // Locally they become 'proposed' rather than 'synced' - the change is
    // still only here until somebody accepts it - and rather than 'pending',
    // which would re-push them on every cycle and count them as unsaved work.
    // The server decides who we are; the local guess was only ever a
    // placeholder for the first write. Adopting it keeps one name for one
    // person, instead of files saying one thing and the server another.
    if (result.actor) this.actor = result.actor;

    const rejected = result.rejected ?? [];
    for (const refusal of rejected) {
      console.warn(
        `[SyncManager] Server refused ${refusal.entityId}: ${refusal.reason}`
      );
      this.emit('sync:rejected', refusal);
    }
    this.rejections = rejected;

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

    for (const refusal of rejected) {
      await this.client.execute(
        `UPDATE entities SET sync_status = 'proposed' WHERE id = $1`,
        [refusal.entityId]
      );
    }

    // Mark accepted entities as synced
    const settled = new Set([
      ...result.conflicts.map((c) => c.entityId),
      ...rejected.map((r) => r.entityId),
    ]);
    for (const entity of entities) {
      if (!settled.has(entity.id)) {
        await this.client.execute(
          `UPDATE entities
           SET sync_status = 'synced', sync_version = $1
           WHERE id = $2`,
          [result.syncVersion, entity.id]
        );
        await this.captureBase(entity, result.syncVersion);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pull
  // ---------------------------------------------------------------------------

  private async pullChanges(): Promise<void> {
    const serverUrl = this.config.serverUrl!;

    this.skipped = [];

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
        actor?: string;
      };

      // A device with nothing to push would otherwise never be told who it is.
      if (result.actor) this.actor = result.actor;

      for (const entity of result.entities) {
        try {
          await this.upsertRemoteEntity(entity, result.syncVersion);
        } catch (error) {
          // One unusable document must not stop the vault from syncing. In a
          // vault several people write to, aborting the cycle would let a
          // single malformed push from any contributor block everyone else's
          // changes indefinitely - and the cursor would never advance past it.
          console.error(
            `[SyncManager] Skipping ${entity.id}:`,
            error instanceof Error ? error.message : error
          );
          this.skipped.push({
            entityId: String(entity.id),
            reason: error instanceof Error ? error.message : String(error),
          });
        }
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
      `SELECT * FROM entities WHERE id = $1`,
      [entity.id]
    );

    const remoteUpdatedMs = new Date(entity.updatedAt).getTime();

    const deletedAt = entity.deletedAt ? new Date(entity.deletedAt) : null;

    let applied = false;

    if (existing.rows.length === 0) {
      // Insert
      applied = true;
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
      const localRow = existing.rows[0] as Record<string, unknown>;
      const localUpdatedMs = new Date(localRow.updated_at as string).getTime();

      // 'proposed' counts: it is a local change the server declined to apply
      // directly, not an absence of one.
      const status = localRow.sync_status as string;
      const hasLocalChanges = status === 'pending' || status === 'proposed';

      // Both sides have moved since they last agreed. Rather than picking a
      // winner and discarding the other's work, merge against the version they
      // diverged from - which is what `sync_base` is for. Only genuinely
      // overlapping edits survive as a conflict for someone to settle.
      const base = hasLocalChanges ? await this.readBase(entity.id) : null;

      if (base) {
        const local = rowToEntity(localRow);
        const merged = mergeEntities(base, local, entity);

        if (merged.conflicted) {
          await this.client.execute(
            `INSERT INTO sync_log (entity_id, operation, payload, client_id)
             VALUES ($1, 'conflict', $2, $3)`,
            [
              entity.id,
              JSON.stringify({ local, remote: entity }),
              this.clientId,
            ]
          );
          this.emit('sync:conflict', { entityId: entity.id, fields: merged.conflicts });
        }

        // The remote is now something this device has seen, so it becomes the
        // point any *next* divergence is measured from. Leaving the old base in
        // place would merge the following change against an ancestor two steps
        // back and reintroduce edits that were already reconciled.
        await this.captureBase(entity, syncVersion);

        // A merge is a new local edit: it has to go back to the server, or the
        // other side never learns what this one reconciled.
        await this.writeMerged(merged.entity, merged.conflicted);
        if (this.applyRemote) await this.applyRemote(merged.entity);
        return;
      }

      // No local changes, so there is nothing to weigh the remote against and
      // the server is simply right. Comparing timestamps here is what used to
      // strand a device: two edits in the same millisecond tie, the comparison
      // says "not newer", and the vault silently stops converging.
      if (!hasLocalChanges || remoteUpdatedMs > localUpdatedMs) {
        applied = true;
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

    // The index is not the store on every surface. Where the vault is markdown
    // on disk, a change that only reached the index would be thrown away by
    // the next rebuild - so the files are brought into line here, and only for
    // changes actually accepted by the comparison above.
    if (applied) {
      await this.captureBase(entity, syncVersion);
      if (this.applyRemote) await this.applyRemote(entity);
    }
  }

  /**
   * Persist the result of a merge.
   *
   * Left pending, not synced: the merged text exists only here until the
   * server has it, and marking it synced would strand the reconciliation on
   * this device. A conflicted merge stays pending too - the markers are in the
   * body, and pushing them is how the other side learns there is something to
   * settle rather than silently keeping a version nobody agreed to.
   */
  private async writeMerged(entity: Entity, conflicted: boolean): Promise<void> {
    await this.client.execute(
      `UPDATE entities
       SET title=$1, content=$2, metadata=$3, links=$4, tags=$5,
           updated_at=$6, sync_status='pending'
       WHERE id=$7`,
      [
        entity.title,
        entity.content,
        JSON.stringify(this.extractMetadata(entity)),
        JSON.stringify(entity.links ?? []),
        entity.tags ?? [],
        entity.updatedAt,
        entity.id,
      ]
    );

    if (conflicted) this.updateState({ status: 'conflict' });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * How many conflicts this vault is carrying.
   *
   * Counts documents holding merge markers as well as entries in the log,
   * because the device that merged is often not the device someone is looking
   * at: the markers travel with the text, so a second device pulls a conflicted
   * document without ever having merged anything. Reporting only what this
   * device merged would show "synced" over a note full of `<<<<<<<`.
   */
  private async getConflictCount(): Promise<number> {
    const logged = await this.client.execute(
      `SELECT COUNT(*) AS count FROM sync_log WHERE resolved IS NULL`
    );
    const marked = await this.client.execute(
      `SELECT COUNT(*) AS count FROM entities
       WHERE deleted_at IS NULL AND content LIKE '%<<<<<<<%'`
    );

    return (
      Number((logged.rows[0] as Record<string, unknown>)?.count ?? 0) +
      Number((marked.rows[0] as Record<string, unknown>)?.count ?? 0)
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
