import type {
  Entity,
  EntityType,
  MemoryStats,
  SearchResponse,
  EntityFilter,
} from '@unimem/types';
import { MemoryEngine } from '@unimem/core';
import { DatabaseClient, PGliteStorageAdapter } from '@unimem/db';

// Global state
const isInitialized = ref(false);
const isLoading = ref(false);
const stats = ref<MemoryStats | null>(null);

let dbClient: DatabaseClient | null = null;
let memoryEngine: MemoryEngine | null = null;

export function useMemory() {
  /**
   * Initialize the memory system
   */
  async function initialize() {
    if (isInitialized.value) return;

    isLoading.value = true;

    try {
      // Create database client with IndexedDB storage (browser)
      dbClient = new DatabaseClient({
        dataDir: 'idb://unimem',
        enableVector: true,
      });

      await dbClient.initialize();

      // Create storage adapter
      const storageAdapter = new PGliteStorageAdapter(dbClient);

      // Create memory engine
      memoryEngine = new MemoryEngine({
        storage: storageAdapter,
        // Note: Embedding provider would be configured here
        // embedding: createEmbeddingProvider({ type: 'openai', apiKey: ... }),
      });

      // Load initial stats
      stats.value = await memoryEngine.getStats();

      isInitialized.value = true;
    } catch (error) {
      console.error('Failed to initialize memory system:', error);
      throw error;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Get the memory engine instance
   */
  function getEngine(): MemoryEngine {
    if (!memoryEngine) {
      throw new Error('Memory engine not initialized');
    }
    return memoryEngine;
  }

  /**
   * Create a new entity
   */
  async function createEntity<T extends Entity>(
    data: Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'embedding'>
  ): Promise<T> {
    const engine = getEngine();
    const entity = await engine.createEntity<T>(data);

    // Refresh stats
    stats.value = await engine.getStats();

    return entity;
  }

  /**
   * Get an entity by ID
   */
  async function getEntity<T extends Entity>(id: string): Promise<T | null> {
    return getEngine().getEntity<T>(id);
  }

  /**
   * Update an entity
   */
  async function updateEntity<T extends Entity>(
    id: string,
    updates: Partial<T>
  ): Promise<T> {
    const engine = getEngine();
    const entity = await engine.updateEntity<T>(id, updates);

    // Refresh stats
    stats.value = await engine.getStats();

    return entity;
  }

  /**
   * Delete an entity
   */
  async function deleteEntity(id: string): Promise<void> {
    const engine = getEngine();
    await engine.deleteEntity(id);

    // Refresh stats
    stats.value = await engine.getStats();
  }

  /**
   * Query entities
   */
  async function queryEntities<T extends Entity>(
    filter: EntityFilter
  ): Promise<T[]> {
    return getEngine().queryEntities<T>(filter);
  }

  /**
   * Search using vector similarity
   */
  async function search<T extends Entity>(
    query: string,
    filter?: EntityFilter
  ): Promise<SearchResponse<T>> {
    return getEngine().searchSimilar<T>(query, { filter });
  }

  /**
   * Refresh stats
   */
  async function refreshStats(): Promise<void> {
    if (memoryEngine) {
      stats.value = await memoryEngine.getStats();
    }
  }

  // Auto-initialize on first use
  onMounted(() => {
    if (!isInitialized.value && !isLoading.value) {
      initialize();
    }
  });

  return {
    // State
    isInitialized: readonly(isInitialized),
    isLoading: readonly(isLoading),
    stats: readonly(stats),

    // Methods
    initialize,
    getEngine,
    createEntity,
    getEntity,
    updateEntity,
    deleteEntity,
    queryEntities,
    search,
    refreshStats,
  };
}
