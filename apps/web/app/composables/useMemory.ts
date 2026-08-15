import type {
  Entity,
  EntityType,
  MemoryStats,
  SearchResponse,
  EntityFilter,
} from '@unimem/types';
import { MemoryEngine } from '@unimem/core';
import { DatabaseClient, PGliteStorageAdapter } from '@unimem/db';
import { toErrorCode } from '@unimem/analytics';

// Global state
const isInitialized = ref(false);
const isLoading = ref(false);
const stats = ref<MemoryStats | null>(null);

let dbClient: DatabaseClient | null = null;
let memoryEngine: MemoryEngine | null = null;

export function useMemory() {
  const analytics = useAnalytics();

  /**
   * Initialize the memory system
   */
  async function initialize() {
    if (isInitialized.value) return;

    isLoading.value = true;
    const startedAt = performance.now();

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

      // Initialise sync manager if a server URL is configured
      const runtimeConfig = useRuntimeConfig();
      const serverUrl = runtimeConfig.public?.syncServerUrl as string | undefined;
      if (serverUrl) {
        const { init, start } = useSync();
        init(dbClient, serverUrl);
        start();
      }

      isInitialized.value = true;

      analytics.capture({
        name: 'memory_initialized',
        properties: {
          duration_ms: Math.round(performance.now() - startedAt),
          success: true,
        },
      });
    } catch (error) {
      console.error('Failed to initialize memory system:', error);

      // PGlite/IndexedDB failures are browser- and platform-specific, and this
      // is currently the only signal we get that a user never got started.
      analytics.capture({
        name: 'memory_initialized',
        properties: {
          duration_ms: Math.round(performance.now() - startedAt),
          success: false,
          error_code: toErrorCode(error),
        },
      });

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

    // Type and layer only - the title and content stay on the device.
    analytics.capture({
      name: 'entity_created',
      properties: {
        entity_type: entity.type,
        memory_layer: entity.memoryLayer,
        creation_method: 'manual',
      },
    });

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
    const startedAt = performance.now();
    const response = await getEngine().searchSimilar<T>(query, { filter });

    // Result count and latency only. The query string never leaves the device.
    analytics.capture({
      name: 'search_performed',
      properties: {
        result_count: response.results.length,
        duration_ms: Math.round(performance.now() - startedAt),
        has_results: response.results.length > 0,
        search_type: 'vector',
      },
    });

    return response;
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
