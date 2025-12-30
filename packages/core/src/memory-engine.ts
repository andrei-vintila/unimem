// =============================================================================
// Memory Engine - Core orchestration for neural memory operations
// =============================================================================

import type {
  Entity,
  EntityType,
  MemoryLayerType,
  MemoryLayer,
  MemoryStats,
  MemoryEvent,
  MemoryEventType,
  EntityFilter,
  SearchResponse,
  VectorQuery,
} from '@unimem/types';

// -----------------------------------------------------------------------------
// Storage Adapter Interface
// -----------------------------------------------------------------------------

export interface StorageAdapter {
  // CRUD operations
  create<T extends Entity>(entity: T): Promise<T>;
  read<T extends Entity>(id: string): Promise<T | null>;
  update<T extends Entity>(id: string, updates: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;

  // Query operations
  query<T extends Entity>(filter: EntityFilter): Promise<T[]>;
  search<T extends Entity>(query: VectorQuery): Promise<SearchResponse<T>>;

  // Bulk operations
  bulkCreate<T extends Entity>(entities: T[]): Promise<T[]>;
  bulkDelete(ids: string[]): Promise<void>;

  // Stats
  getStats(): Promise<MemoryStats>;
}

// -----------------------------------------------------------------------------
// Embedding Provider Interface
// -----------------------------------------------------------------------------

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
}

// -----------------------------------------------------------------------------
// Memory Engine Configuration
// -----------------------------------------------------------------------------

export interface MemoryEngineConfig {
  storage: StorageAdapter;
  embedding?: EmbeddingProvider;
  layers?: MemoryLayer[];
}

// -----------------------------------------------------------------------------
// Default Memory Layers
// -----------------------------------------------------------------------------

export const DEFAULT_MEMORY_LAYERS: MemoryLayer[] = [
  {
    type: 'working',
    name: 'Working Memory',
    description: 'Short-term context: daily notes, current tasks',
    retentionPolicy: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      consolidationInterval: 24 * 60 * 60 * 1000, // Daily
    },
  },
  {
    type: 'episodic',
    name: 'Episodic Memory',
    description: 'Events and entities: people, companies, projects',
    retentionPolicy: {
      consolidationInterval: 7 * 24 * 60 * 60 * 1000, // Weekly
    },
  },
  {
    type: 'semantic',
    name: 'Semantic Memory',
    description: 'Knowledge and concepts: areas, resources',
    retentionPolicy: {
      consolidationInterval: 30 * 24 * 60 * 60 * 1000, // Monthly
    },
  },
  {
    type: 'procedural',
    name: 'Procedural Memory',
    description: 'Actions and workflows: tasks, habits',
    retentionPolicy: {
      maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days for completed tasks
      consolidationInterval: 7 * 24 * 60 * 60 * 1000, // Weekly
    },
  },
];

// -----------------------------------------------------------------------------
// Memory Engine
// -----------------------------------------------------------------------------

type EventHandler = (event: MemoryEvent) => void;

export class MemoryEngine {
  private storage: StorageAdapter;
  private embedding?: EmbeddingProvider;
  private layers: Map<MemoryLayerType, MemoryLayer>;
  private eventHandlers: Map<MemoryEventType, Set<EventHandler>>;

  constructor(config: MemoryEngineConfig) {
    this.storage = config.storage;
    this.embedding = config.embedding;
    this.layers = new Map();
    this.eventHandlers = new Map();

    // Initialize layers
    const layerConfig = config.layers ?? DEFAULT_MEMORY_LAYERS;
    for (const layer of layerConfig) {
      this.layers.set(layer.type, layer);
    }
  }

  // ---------------------------------------------------------------------------
  // Entity Operations
  // ---------------------------------------------------------------------------

  async createEntity<T extends Entity>(
    entity: Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'embedding'>
  ): Promise<T> {
    const now = new Date();
    const id = this.generateId();

    // Generate embedding if provider available
    let embedding: number[] | undefined;
    if (this.embedding) {
      const textToEmbed = `${entity.title} ${entity.content}`;
      embedding = await this.embedding.embed(textToEmbed);
    }

    const fullEntity = {
      ...entity,
      id,
      embedding,
      createdAt: now,
      updatedAt: now,
    } as T;

    const created = await this.storage.create(fullEntity);

    this.emit('entity:created', created);

    return created;
  }

  async getEntity<T extends Entity>(id: string): Promise<T | null> {
    return this.storage.read<T>(id);
  }

  async updateEntity<T extends Entity>(
    id: string,
    updates: Partial<Omit<T, 'id' | 'createdAt'>>
  ): Promise<T> {
    const existing = await this.storage.read<T>(id);
    if (!existing) {
      throw new Error(`Entity not found: ${id}`);
    }

    // Re-generate embedding if content changed
    let embedding = existing.embedding;
    if (this.embedding && (updates.title || updates.content)) {
      const title = updates.title ?? existing.title;
      const content = updates.content ?? existing.content;
      embedding = await this.embedding.embed(`${title} ${content}`);
    }

    const updated = await this.storage.update<T>(id, {
      ...updates,
      embedding,
      updatedAt: new Date(),
    } as Partial<T>);

    this.emit('entity:updated', updated);

    return updated;
  }

  async deleteEntity(id: string): Promise<void> {
    const entity = await this.storage.read(id);
    if (entity) {
      await this.storage.delete(id);
      this.emit('entity:deleted', { id, entity });
    }
  }

  // ---------------------------------------------------------------------------
  // Query Operations
  // ---------------------------------------------------------------------------

  async queryEntities<T extends Entity>(filter: EntityFilter): Promise<T[]> {
    return this.storage.query<T>(filter);
  }

  async searchSimilar<T extends Entity>(
    text: string,
    options?: Partial<VectorQuery>
  ): Promise<SearchResponse<T>> {
    if (!this.embedding) {
      throw new Error('Embedding provider not configured');
    }

    const embedding = await this.embedding.embed(text);

    return this.storage.search<T>({
      embedding,
      limit: options?.limit ?? 10,
      threshold: options?.threshold ?? 0.7,
      filter: options?.filter,
    });
  }

  // ---------------------------------------------------------------------------
  // Layer Operations
  // ---------------------------------------------------------------------------

  getLayer(type: MemoryLayerType): MemoryLayer | undefined {
    return this.layers.get(type);
  }

  getLayerForEntityType(type: EntityType): MemoryLayerType {
    const mapping: Record<EntityType, MemoryLayerType> = {
      'daily-note': 'working',
      'person': 'episodic',
      'company': 'episodic',
      'project': 'episodic',
      'task': 'procedural',
      'area': 'semantic',
      'resource': 'semantic',
    };
    return mapping[type];
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  async getStats(): Promise<MemoryStats> {
    return this.storage.getStats();
  }

  // ---------------------------------------------------------------------------
  // Event System
  // ---------------------------------------------------------------------------

  on(event: MemoryEventType, handler: EventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.eventHandlers.get(event)?.delete(handler);
    };
  }

  private emit<T>(type: MemoryEventType, payload: T): void {
    const event: MemoryEvent<T> = {
      type,
      payload,
      timestamp: new Date(),
      source: 'local',
    };

    const handlers = this.eventHandlers.get(type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (error) {
          console.error(`Error in event handler for ${type}:`, error);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  private generateId(): string {
    // Simple UUID v4 implementation
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
