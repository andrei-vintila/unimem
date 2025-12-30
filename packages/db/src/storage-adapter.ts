// =============================================================================
// PGlite Storage Adapter - Implements StorageAdapter from @unimem/core
// =============================================================================

import { eq, and, inArray, gte, lte, sql } from 'drizzle-orm';
import type {
  Entity,
  EntityType,
  MemoryLayerType,
  EntityFilter,
  VectorQuery,
  SearchResponse,
  SearchResult,
  MemoryStats,
} from '@unimem/types';
import type { StorageAdapter } from '@unimem/core';
import type { DatabaseClient } from './client';
import { entities, type EntityRow, type NewEntityRow } from './schema';

// -----------------------------------------------------------------------------
// PGlite Storage Adapter
// -----------------------------------------------------------------------------

export class PGliteStorageAdapter implements StorageAdapter {
  private client: DatabaseClient;

  constructor(client: DatabaseClient) {
    this.client = client;
  }

  // ---------------------------------------------------------------------------
  // CRUD Operations
  // ---------------------------------------------------------------------------

  async create<T extends Entity>(entity: T): Promise<T> {
    const db = this.client.getDb();

    const row: NewEntityRow = {
      id: entity.id,
      type: entity.type,
      memoryLayer: entity.memoryLayer,
      title: entity.title,
      content: entity.content,
      embedding: entity.embedding ?? null,
      metadata: this.extractMetadata(entity),
      links: entity.links,
      tags: entity.tags,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };

    await db.insert(entities).values(row);

    return entity;
  }

  async read<T extends Entity>(id: string): Promise<T | null> {
    const db = this.client.getDb();

    const rows = await db
      .select()
      .from(entities)
      .where(eq(entities.id, id))
      .limit(1);

    if (rows.length === 0) return null;

    return this.rowToEntity<T>(rows[0]);
  }

  async update<T extends Entity>(id: string, updates: Partial<T>): Promise<T> {
    const db = this.client.getDb();

    const updateData: Partial<NewEntityRow> = {
      updatedAt: new Date(),
    };

    if (updates.title !== undefined) updateData.title = updates.title;
    if (updates.content !== undefined) updateData.content = updates.content;
    if (updates.embedding !== undefined) updateData.embedding = updates.embedding;
    if (updates.memoryLayer !== undefined) updateData.memoryLayer = updates.memoryLayer;
    if (updates.links !== undefined) updateData.links = updates.links;
    if (updates.tags !== undefined) updateData.tags = updates.tags;

    // Handle metadata updates
    if (this.hasMetadataFields(updates)) {
      const existing = await this.read<T>(id);
      if (existing) {
        const currentMetadata = this.extractMetadata(existing);
        const newMetadata = this.extractMetadata(updates as Partial<Entity>);
        updateData.metadata = { ...currentMetadata, ...newMetadata };
      }
    }

    await db.update(entities).set(updateData).where(eq(entities.id, id));

    const updated = await this.read<T>(id);
    if (!updated) {
      throw new Error(`Entity not found after update: ${id}`);
    }

    return updated;
  }

  async delete(id: string): Promise<void> {
    const db = this.client.getDb();
    await db.delete(entities).where(eq(entities.id, id));
  }

  // ---------------------------------------------------------------------------
  // Query Operations
  // ---------------------------------------------------------------------------

  async query<T extends Entity>(filter: EntityFilter): Promise<T[]> {
    const db = this.client.getDb();

    const conditions = [];

    if (filter.types && filter.types.length > 0) {
      conditions.push(inArray(entities.type, filter.types));
    }

    if (filter.memoryLayers && filter.memoryLayers.length > 0) {
      conditions.push(inArray(entities.memoryLayer, filter.memoryLayers));
    }

    if (filter.dateRange?.start) {
      conditions.push(gte(entities.createdAt, filter.dateRange.start));
    }

    if (filter.dateRange?.end) {
      conditions.push(lte(entities.createdAt, filter.dateRange.end));
    }

    // Note: Tag filtering requires array overlap operation
    // This is a simplified implementation
    if (filter.tags && filter.tags.length > 0) {
      // For each tag, check if it's in the array
      // In production, use: entities.tags && filter.tags (array overlap)
      for (const tag of filter.tags) {
        conditions.push(sql`${tag} = ANY(${entities.tags})`);
      }
    }

    const query = conditions.length > 0
      ? db.select().from(entities).where(and(...conditions))
      : db.select().from(entities);

    const rows = await query;
    return rows.map((row) => this.rowToEntity<T>(row));
  }

  async search<T extends Entity>(query: VectorQuery): Promise<SearchResponse<T>> {
    const startTime = Date.now();

    // Get all entities (with optional filter)
    const allEntities = await this.query<T>(query.filter ?? {});

    // Filter to those with embeddings
    const withEmbeddings = allEntities.filter((e) => e.embedding?.length);

    // Compute similarity scores
    const scored: SearchResult<T>[] = withEmbeddings
      .map((entity) => ({
        entity,
        score: this.cosineSimilarity(query.embedding, entity.embedding!),
      }))
      .filter((r) => r.score >= (query.threshold ?? 0))
      .sort((a, b) => b.score - a.score)
      .slice(0, query.limit ?? 10);

    return {
      results: scored,
      total: scored.length,
      query: '', // Vector query doesn't have text
      took: Date.now() - startTime,
    };
  }

  // ---------------------------------------------------------------------------
  // Bulk Operations
  // ---------------------------------------------------------------------------

  async bulkCreate<T extends Entity>(entityList: T[]): Promise<T[]> {
    const db = this.client.getDb();

    const rows: NewEntityRow[] = entityList.map((entity) => ({
      id: entity.id,
      type: entity.type,
      memoryLayer: entity.memoryLayer,
      title: entity.title,
      content: entity.content,
      embedding: entity.embedding ?? null,
      metadata: this.extractMetadata(entity),
      links: entity.links,
      tags: entity.tags,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    }));

    await db.insert(entities).values(rows);

    return entityList;
  }

  async bulkDelete(ids: string[]): Promise<void> {
    const db = this.client.getDb();
    await db.delete(entities).where(inArray(entities.id, ids));
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  async getStats(): Promise<MemoryStats> {
    const db = this.client.getDb();

    // Total count
    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(entities);
    const totalEntities = Number(totalResult[0]?.count ?? 0);

    // By layer
    const layerCounts = await db
      .select({
        layer: entities.memoryLayer,
        count: sql<number>`count(*)`,
      })
      .from(entities)
      .groupBy(entities.memoryLayer);

    const byLayer: Record<MemoryLayerType, number> = {
      working: 0,
      episodic: 0,
      semantic: 0,
      procedural: 0,
    };
    for (const row of layerCounts) {
      byLayer[row.layer as MemoryLayerType] = Number(row.count);
    }

    // By type
    const typeCounts = await db
      .select({
        type: entities.type,
        count: sql<number>`count(*)`,
      })
      .from(entities)
      .groupBy(entities.type);

    const byType: Record<EntityType, number> = {
      'daily-note': 0,
      person: 0,
      company: 0,
      project: 0,
      task: 0,
      area: 0,
      resource: 0,
    };
    for (const row of typeCounts) {
      byType[row.type as EntityType] = Number(row.count);
    }

    // Vector count (entities with embeddings)
    const vectorResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(entities)
      .where(sql`embedding IS NOT NULL`);
    const vectorCount = Number(vectorResult[0]?.count ?? 0);

    return {
      totalEntities,
      byLayer,
      byType,
      storageSize: 0, // Would need to query pg_total_relation_size
      vectorCount,
    };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private rowToEntity<T extends Entity>(row: EntityRow): T {
    const base: Entity = {
      id: row.id,
      type: row.type as EntityType,
      memoryLayer: row.memoryLayer as MemoryLayerType,
      title: row.title,
      content: row.content,
      embedding: row.embedding ?? undefined,
      links: (row.links as Entity['links']) ?? [],
      tags: row.tags ?? [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    // Merge in type-specific metadata
    const metadata = row.metadata as Record<string, unknown> | null;
    if (metadata) {
      Object.assign(base, metadata);
    }

    return base as T;
  }

  private extractMetadata(entity: Partial<Entity>): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};

    // Extract type-specific fields
    const baseFields = new Set([
      'id', 'type', 'memoryLayer', 'title', 'content',
      'embedding', 'links', 'tags', 'createdAt', 'updatedAt',
    ]);

    for (const [key, value] of Object.entries(entity)) {
      if (!baseFields.has(key) && value !== undefined) {
        metadata[key] = value;
      }
    }

    return metadata;
  }

  private hasMetadataFields(updates: Partial<Entity>): boolean {
    const baseFields = new Set([
      'id', 'type', 'memoryLayer', 'title', 'content',
      'embedding', 'links', 'tags', 'createdAt', 'updatedAt',
    ]);

    return Object.keys(updates).some((key) => !baseFields.has(key));
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }
}
