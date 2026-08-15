// =============================================================================
// OKF-backed storage - the bundle is the store, PGlite is the index
// =============================================================================
//
// Every write lands in the markdown bundle first and is then reflected into
// PGlite; every read is served from PGlite. The index holds nothing that is
// not either derived from the files (entities) or specific to this device
// (sync status, embeddings), which is what makes `rebuild()` safe: delete the
// index, read the bundle, and you are whole again.
//
// That is the whole point of the arrangement. A schema change stops being a
// migration and becomes a rebuild, and a vault edited in Obsidian - or by
// another person, over git - is not a foreign format to be imported but the
// store itself.

import type {
  Entity,
  EntityFilter,
  MemoryStats,
  SearchResponse,
  VectorQuery,
} from '@unimem/types';
import type { StorageAdapter } from '@unimem/core';
import {
  appendDeletion,
  indexPaths,
  readBundle,
  writeEntity,
  type BundleFs,
} from '@unimem/okf';

import { PGliteStorageAdapter } from './storage-adapter.js';
import type { SqlDatabase } from './client.js';

export interface OkfStorageConfig {
  fs: BundleFs;
  /** Bundle root. Created on first write if absent. */
  root: string;
  index: SqlDatabase;
  /**
   * Who this device writes as, in OKF's actor convention (`human:<id>`).
   * Stamped on every entity so a shared vault can say who changed what.
   */
  actor?: string;
}

export interface RebuildReport {
  entities: number;
  tombstones: number;
  /** Hand-written documents given a `resource` so their identity stops moving. */
  adopted: number;
  skipped: Array<{ path: string; reason: string }>;
  durationMs: number;
}

export class OkfStorageAdapter implements StorageAdapter {
  private fs: BundleFs;
  private root: string;
  private index: PGliteStorageAdapter;
  private db: SqlDatabase;
  private actor?: string;

  /** Resource URI -> bundle-relative path, so a retitle moves its file. */
  private paths = new Map<string, string>();

  constructor(config: OkfStorageConfig) {
    this.fs = config.fs;
    this.root = config.root;
    this.db = config.index;
    this.index = new PGliteStorageAdapter(config.index);
    this.actor = config.actor;
  }

  // ---------------------------------------------------------------------------
  // Index lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Discard the index and rebuild it from the bundle.
   *
   * Called on startup, which is also how edits made while the app was closed -
   * in Obsidian, or pulled in by someone else's git push - become visible.
   */
  async rebuild(): Promise<RebuildReport> {
    const startedAt = Date.now();
    const { entities, tombstones, skipped, unclaimed } = await readBundle(
      this.fs,
      this.root
    );

    await this.db.execute('DELETE FROM entities');

    if (entities.length > 0) {
      await this.index.bulkCreate(entities);
      // Straight from the files, so nothing here is a local change awaiting a
      // push - the sync manager would otherwise re-push the entire vault on
      // every launch.
      await this.db.execute(`UPDATE entities SET sync_status = 'synced'`);
    }

    for (const tombstone of tombstones) {
      await this.db.execute(
        `INSERT INTO entities
           (id, type, memory_layer, title, content, links, tags,
            created_at, updated_at, deleted_at, sync_status)
         VALUES ($1,'unknown','episodic',$2,'','[]','{}',$3,$3,$3,'synced')
         ON CONFLICT (id) DO UPDATE SET deleted_at = EXCLUDED.deleted_at`,
        [tombstone.id, tombstone.title, tombstone.deletedAt]
      );
    }

    this.paths = await indexPaths(this.fs, this.root);

    // Claim documents that arrived without a `resource` - typed by hand, or
    // written by a tool that does not know our scheme. Until one has an id
    // recorded in it, its identity is derived from its path, so renaming the
    // file would present it to every other device as a brand new entity and
    // orphan the old one.
    const unclaimedIds = new Set(unclaimed.map((doc) => doc.id));
    for (const entity of entities) {
      if (unclaimedIds.has(entity.id)) await this.writeToBundle(entity);
    }

    return {
      entities: entities.length,
      tombstones: tombstones.length,
      adopted: unclaimed.length,
      skipped,
      durationMs: Date.now() - startedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Writes - bundle first, index second
  // ---------------------------------------------------------------------------

  async create<T extends Entity>(entity: T): Promise<T> {
    const stamped = this.stamp(entity, { created: true });

    await this.writeToBundle(stamped);
    await this.index.create(stamped);

    return stamped;
  }

  async update<T extends Entity>(id: string, updates: Partial<T>): Promise<T> {
    // Through the index, which already merges metadata and bumps updatedAt.
    const updated = this.stamp(await this.index.update<T>(id, updates), {
      created: false,
    });

    await this.writeToBundle(updated);
    await this.index.update<T>(id, updated as Partial<T>);

    return updated;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.index.read(id);

    await appendDeletion(
      this.fs,
      this.root,
      {
        id,
        title: existing?.title ?? id,
        deletedAt: new Date(),
        ...(this.actor ? { deletedBy: this.actor } : {}),
      },
      this.paths.get(`unimem://entity/${id}`)
    );

    this.paths.delete(`unimem://entity/${id}`);
    await this.index.delete(id);
  }

  async bulkCreate<T extends Entity>(entities: T[]): Promise<T[]> {
    const stamped = entities.map((entity) => this.stamp(entity, { created: true }));

    for (const entity of stamped) {
      await this.writeToBundle(entity);
    }
    await this.index.bulkCreate(stamped);

    return stamped;
  }

  async bulkDelete(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete(id);
    }
  }

  // ---------------------------------------------------------------------------
  // Reads - served entirely from the index
  // ---------------------------------------------------------------------------

  read<T extends Entity>(id: string): Promise<T | null> {
    return this.index.read<T>(id);
  }

  query<T extends Entity>(filter: EntityFilter): Promise<T[]> {
    return this.index.query<T>(filter);
  }

  search<T extends Entity>(query: VectorQuery): Promise<SearchResponse<T>> {
    return this.index.search<T>(query);
  }

  getStats(): Promise<MemoryStats> {
    return this.index.getStats();
  }

  /**
   * Entity id -> bundle-relative path, for the sync manager to send on push.
   *
   * The server scopes write grants by folder, so it has to know where a
   * document sits. It verifies the claim against the entity's type rather than
   * trusting it, so this is a hint that can only ever narrow what we are
   * allowed to do, never widen it.
   */
  entityPaths(): Record<string, string> {
    const paths: Record<string, string> = {};
    for (const [resource, path] of this.paths) {
      paths[resource.replace('unimem://entity/', '')] = path;
    }
    return paths;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async writeToBundle(entity: Entity): Promise<void> {
    const path = await writeEntity(this.fs, this.root, entity, this.paths);
    this.paths.set(`unimem://entity/${entity.id}`, path);
  }

  /**
   * Record who is writing. `createdBy` is set once and never overwritten -
   * the point of authorship in a shared vault is that a later editor does not
   * erase who wrote it in the first place.
   */
  private stamp<T extends Entity>(entity: T, { created }: { created: boolean }): T {
    if (!this.actor) return entity;

    return {
      ...entity,
      ...(created && !entity.createdBy ? { createdBy: this.actor } : {}),
      updatedBy: this.actor,
    };
  }
}
