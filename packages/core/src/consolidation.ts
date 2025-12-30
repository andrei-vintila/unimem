// =============================================================================
// Memory Consolidation - Transfer between memory layers
// =============================================================================

import type {
  Entity,
  MemoryLayerType,
  ConsolidationResult,
  EntityFilter,
} from '@unimem/types';
import type { MemoryEngine } from './memory-engine';

// -----------------------------------------------------------------------------
// Consolidation Strategy Interface
// -----------------------------------------------------------------------------

export interface ConsolidationStrategy {
  /**
   * Determine if an entity should be consolidated
   */
  shouldConsolidate(entity: Entity): boolean;

  /**
   * Transform entity during consolidation (e.g., summarize, merge)
   */
  transform?(entity: Entity): Promise<Partial<Entity>>;

  /**
   * Determine target layer for consolidated entity
   */
  getTargetLayer(entity: Entity): MemoryLayerType | null;
}

// -----------------------------------------------------------------------------
// Default Consolidation Strategies
// -----------------------------------------------------------------------------

export class WorkingMemoryConsolidation implements ConsolidationStrategy {
  private maxAgeDays: number;

  constructor(maxAgeDays = 7) {
    this.maxAgeDays = maxAgeDays;
  }

  shouldConsolidate(entity: Entity): boolean {
    if (entity.memoryLayer !== 'working') return false;

    const age = Date.now() - entity.createdAt.getTime();
    const maxAge = this.maxAgeDays * 24 * 60 * 60 * 1000;

    return age > maxAge;
  }

  getTargetLayer(entity: Entity): MemoryLayerType | null {
    // Daily notes with significant content move to episodic
    // Light notes get archived (null = delete)
    if (entity.type === 'daily-note') {
      const hasSignificantContent = entity.content.length > 500;
      const hasLinks = entity.links.length > 0;

      return hasSignificantContent || hasLinks ? 'episodic' : null;
    }

    return 'episodic';
  }
}

export class TaskConsolidation implements ConsolidationStrategy {
  private completedMaxAgeDays: number;

  constructor(completedMaxAgeDays = 30) {
    this.completedMaxAgeDays = completedMaxAgeDays;
  }

  shouldConsolidate(entity: Entity): boolean {
    if (entity.type !== 'task') return false;

    const task = entity as Entity & { status: string };
    if (task.status !== 'done' && task.status !== 'cancelled') return false;

    const age = Date.now() - entity.updatedAt.getTime();
    const maxAge = this.completedMaxAgeDays * 24 * 60 * 60 * 1000;

    return age > maxAge;
  }

  getTargetLayer(): MemoryLayerType | null {
    // Completed tasks get archived
    return null;
  }
}

// -----------------------------------------------------------------------------
// Consolidation Engine
// -----------------------------------------------------------------------------

export class ConsolidationEngine {
  private engine: MemoryEngine;
  private strategies: ConsolidationStrategy[];

  constructor(engine: MemoryEngine, strategies?: ConsolidationStrategy[]) {
    this.engine = engine;
    this.strategies = strategies ?? [
      new WorkingMemoryConsolidation(),
      new TaskConsolidation(),
    ];
  }

  /**
   * Run consolidation process
   */
  async consolidate(filter?: EntityFilter): Promise<ConsolidationResult> {
    const startTime = Date.now();
    let processedCount = 0;
    let consolidatedCount = 0;
    let archivedCount = 0;

    // Get entities to process
    const entities = await this.engine.queryEntities(filter ?? {});

    for (const entity of entities) {
      processedCount++;

      // Find applicable strategy
      const strategy = this.strategies.find((s) => s.shouldConsolidate(entity));
      if (!strategy) continue;

      const targetLayer = strategy.getTargetLayer(entity);

      if (targetLayer === null) {
        // Archive (delete) the entity
        await this.engine.deleteEntity(entity.id);
        archivedCount++;
      } else if (targetLayer !== entity.memoryLayer) {
        // Transform and move to target layer
        const updates = strategy.transform
          ? await strategy.transform(entity)
          : {};

        await this.engine.updateEntity(entity.id, {
          ...updates,
          memoryLayer: targetLayer,
        });
        consolidatedCount++;
      }
    }

    return {
      processedCount,
      consolidatedCount,
      archivedCount,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Add a custom consolidation strategy
   */
  addStrategy(strategy: ConsolidationStrategy): void {
    this.strategies.push(strategy);
  }
}
