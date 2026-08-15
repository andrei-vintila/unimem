import type {
  Entity,
  EntityType,
  MemoryStats,
  SearchResponse,
  EntityFilter,
} from '@unimem/types';
import { MemoryEngine } from '@unimem/core';
import type { SqlDatabase } from '@unimem/db';
import type { StorageAdapter } from '@unimem/core';
import {
  DatabaseClient,
  OkfStorageAdapter,
  PGliteStorageAdapter,
  RemoteDatabaseClient,
} from '@unimem/db';
import { toErrorCode } from '@unimem/analytics';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

const ACTOR_KEY = 'unimem:actor';

/**
 * Who this device writes as, stamped onto everything it saves.
 *
 * Self-asserted for now: the sync server authenticates the vault, not the
 * person, so this says who *claims* to have written something rather than who
 * demonstrably did. Fine while a vault is a small group of people who trust
 * each other; it is the thing to fix before it is not.
 */
function getOrCreateActor(): string {
  if (typeof localStorage === 'undefined') return 'human:unknown';

  let actor = localStorage.getItem(ACTOR_KEY);
  if (!actor) {
    actor = `human:${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(ACTOR_KEY, actor);
  }
  return actor;
}

// Global state
const isInitialized = ref(false);
const isLoading = ref(false);
const stats = ref<MemoryStats | null>(null);

let dbClient: SqlDatabase | null = null;
let memoryEngine: MemoryEngine | null = null;

/**
 * Open the store this surface can actually use.
 *
 * On desktop the store is the OKF markdown bundle and the database is only a
 * derived index, rebuilt from the files on every launch - which is also how
 * edits made in Obsidian, or pulled in from another contributor, arrive.
 *
 * A browser has no filesystem to hold a bundle, so the index *is* the store
 * there and the vault reaches it over sync.
 */
async function openStore(database: SqlDatabase): Promise<StorageAdapter> {
  const desktop = typeof window === 'undefined' ? undefined : window.unimem;

  if (!desktop) return new PGliteStorageAdapter(database);

  const adapter = new OkfStorageAdapter({
    fs: createDesktopBundleFs(desktop.bundle),
    root: DESKTOP_BUNDLE_ROOT,
    index: database,
    actor: getOrCreateActor(),
  });

  const report = await adapter.rebuild();
  console.log(
    `[Memory] Vault: ${report.entities} entities, ${report.tombstones} tombstones ` +
      `in ${report.durationMs}ms` +
      (report.adopted > 0 ? `, ${report.adopted} adopted` : '') +
      (report.skipped.length > 0 ? `, ${report.skipped.length} unreadable` : '')
  );
  for (const skipped of report.skipped) {
    console.warn(`[Memory] Skipped ${skipped.path}: ${skipped.reason}`);
  }

  return adapter;
}

/**
 * Open the database this surface can actually use.
 *
 * On desktop that is a real file in the user's app data directory, opened by
 * the Electron main process and reached over IPC - the renderer is sandboxed
 * and cannot open it directly. In a browser there is no filesystem to reach,
 * so PGlite persists to IndexedDB. Everything above this returns the same
 * `SqlDatabase` either way.
 */
async function openDatabase(): Promise<SqlDatabase> {
  const desktop = typeof window === 'undefined' ? undefined : window.unimem;

  if (desktop) {
    const client = new RemoteDatabaseClient(desktop.db);
    await client.initialize();
    return client;
  }

  const client = new DatabaseClient({
    dataDir: 'idb://unimem',
    enableVector: true,
  });
  await client.initialize();
  return client;
}

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
      dbClient = await openDatabase();
      const storageAdapter = await openStore(dbClient);

      // Create memory engine
      memoryEngine = new MemoryEngine({
        storage: storageAdapter,
        // Note: Embedding provider would be configured here
        // embedding: createEmbeddingProvider({ type: 'openai', apiKey: ... }),
      });

      // Load initial stats
      stats.value = await memoryEngine.getStats();

      // Sync starts itself if this device has a server and token configured.
      useSync().attach(
        dbClient,
        storageAdapter instanceof OkfStorageAdapter ? storageAdapter : undefined
      );

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
