// =============================================================================
// Retrieval System - Context-aware memory retrieval
// =============================================================================

import type {
  Entity,
  EntityType,
  MemoryLayerType,
  SearchResult,
  EntityFilter,
} from '@unimem/types';
import type { MemoryEngine } from './memory-engine';

// -----------------------------------------------------------------------------
// Retrieval Configuration
// -----------------------------------------------------------------------------

export interface RetrievalConfig {
  /**
   * Maximum number of results to return
   */
  maxResults: number;

  /**
   * Minimum similarity threshold (0-1)
   */
  similarityThreshold: number;

  /**
   * Weight multipliers for different memory layers
   * Higher weight = more likely to appear in results
   */
  layerWeights: Record<MemoryLayerType, number>;

  /**
   * Recency decay factor (0-1)
   * Higher = more recent items get boosted
   */
  recencyDecay: number;

  /**
   * Link strength factor (0-1)
   * Higher = items with more links get boosted
   */
  linkBoost: number;
}

export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  maxResults: 10,
  similarityThreshold: 0.7,
  layerWeights: {
    working: 1.5,   // Boost recent/working memory
    episodic: 1.0,  // Standard weight
    semantic: 1.2,  // Slightly boost knowledge
    procedural: 0.8, // Slightly reduce tasks
  },
  recencyDecay: 0.1,
  linkBoost: 0.2,
};

// -----------------------------------------------------------------------------
// Retrieval Context
// -----------------------------------------------------------------------------

export interface RetrievalContext {
  /**
   * Current query text
   */
  query: string;

  /**
   * Current active entity (for contextual retrieval)
   */
  activeEntity?: Entity;

  /**
   * Recently accessed entities
   */
  recentEntities?: Entity[];

  /**
   * Entity types to include
   */
  entityTypes?: EntityType[];

  /**
   * Memory layers to search
   */
  memoryLayers?: MemoryLayerType[];
}

// -----------------------------------------------------------------------------
// Retrieval Engine
// -----------------------------------------------------------------------------

export class RetrievalEngine {
  private engine: MemoryEngine;
  private config: RetrievalConfig;

  constructor(engine: MemoryEngine, config?: Partial<RetrievalConfig>) {
    this.engine = engine;
    this.config = { ...DEFAULT_RETRIEVAL_CONFIG, ...config };
  }

  /**
   * Retrieve relevant memories based on context
   */
  async retrieve(context: RetrievalContext): Promise<SearchResult[]> {
    // Build filter from context
    const filter: EntityFilter = {};

    if (context.entityTypes) {
      filter.types = context.entityTypes;
    }

    if (context.memoryLayers) {
      filter.memoryLayers = context.memoryLayers;
    }

    // Perform vector search
    const searchResponse = await this.engine.searchSimilar(context.query, {
      limit: this.config.maxResults * 2, // Get extra for re-ranking
      threshold: this.config.similarityThreshold,
      filter,
    });

    // Re-rank results
    const reranked = this.rerank(searchResponse.results, context);

    // Return top results
    return reranked.slice(0, this.config.maxResults);
  }

  /**
   * Get related entities for a given entity
   */
  async getRelated(entity: Entity, limit = 5): Promise<SearchResult[]> {
    // Use entity content for similarity search
    const searchText = `${entity.title} ${entity.content}`;

    const searchResponse = await this.engine.searchSimilar(searchText, {
      limit: limit + 1, // +1 to exclude self
      threshold: this.config.similarityThreshold,
    });

    // Filter out the source entity
    return searchResponse.results.filter((r) => r.entity.id !== entity.id);
  }

  /**
   * Get context window for an entity (recent + related)
   */
  async getContextWindow(entity: Entity, windowSize = 10): Promise<Entity[]> {
    const related = await this.getRelated(entity, windowSize);
    const relatedEntities = related.map((r) => r.entity);

    // Get directly linked entities
    const linkedIds = entity.links.map((l) => l.targetId);
    const linkedEntities: Entity[] = [];

    for (const id of linkedIds) {
      const linked = await this.engine.getEntity(id);
      if (linked) {
        linkedEntities.push(linked);
      }
    }

    // Merge and deduplicate
    const entityMap = new Map<string, Entity>();
    for (const e of [...linkedEntities, ...relatedEntities]) {
      if (!entityMap.has(e.id)) {
        entityMap.set(e.id, e);
      }
    }

    return Array.from(entityMap.values()).slice(0, windowSize);
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  private rerank(
    results: SearchResult[],
    context: RetrievalContext
  ): SearchResult[] {
    return results
      .map((result) => ({
        ...result,
        score: this.computeScore(result, context),
      }))
      .sort((a, b) => b.score - a.score);
  }

  private computeScore(result: SearchResult, context: RetrievalContext): number {
    let score = result.score;

    // Apply layer weight
    const layerWeight =
      this.config.layerWeights[result.entity.memoryLayer] ?? 1.0;
    score *= layerWeight;

    // Apply recency boost
    const age = Date.now() - result.entity.updatedAt.getTime();
    const daysSinceUpdate = age / (24 * 60 * 60 * 1000);
    const recencyBoost = Math.exp(-this.config.recencyDecay * daysSinceUpdate);
    score *= 1 + recencyBoost * 0.5;

    // Apply link boost
    const linkCount = result.entity.links.length;
    score *= 1 + Math.min(linkCount * this.config.linkBoost, 0.5);

    // Boost if linked to active entity
    if (context.activeEntity) {
      const isLinked = context.activeEntity.links.some(
        (l) => l.targetId === result.entity.id
      );
      if (isLinked) {
        score *= 1.3;
      }
    }

    // Boost if in recent entities
    if (context.recentEntities) {
      const isRecent = context.recentEntities.some(
        (e) => e.id === result.entity.id
      );
      if (isRecent) {
        score *= 1.2;
      }
    }

    return score;
  }
}
