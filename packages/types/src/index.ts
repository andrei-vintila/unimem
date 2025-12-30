// =============================================================================
// Unimem Neural Memory Architecture - Type Definitions
// =============================================================================

// -----------------------------------------------------------------------------
// Vector & Embedding Types
// -----------------------------------------------------------------------------

export interface Vector {
  id: string;
  embedding: number[];
  dimensions: number;
}

export interface EmbeddingConfig {
  model: string;
  dimensions: number;
}

// -----------------------------------------------------------------------------
// Memory Layer Types (Cognitive Architecture)
// -----------------------------------------------------------------------------

export type MemoryLayerType =
  | 'working'    // Short-term, daily notes, current context
  | 'episodic'   // Events, people, companies, projects
  | 'semantic'   // Areas, resources, concepts
  | 'procedural'; // Tasks, workflows, habits

export interface MemoryLayer {
  type: MemoryLayerType;
  name: string;
  description: string;
  retentionPolicy: RetentionPolicy;
}

export interface RetentionPolicy {
  maxAge?: number;         // Max age in milliseconds
  maxItems?: number;       // Max items to retain
  consolidationInterval?: number; // How often to consolidate
}

// -----------------------------------------------------------------------------
// Entity Types
// -----------------------------------------------------------------------------

export type EntityType =
  | 'daily-note'
  | 'person'
  | 'company'
  | 'project'
  | 'task'
  | 'area'
  | 'resource';

export interface BaseEntity {
  id: string;
  type: EntityType;
  title: string;
  content: string;
  embedding?: number[];

  // Metadata
  createdAt: Date;
  updatedAt: Date;

  // Relations
  links: EntityLink[];
  tags: string[];

  // Memory layer assignment
  memoryLayer: MemoryLayerType;
}

export interface EntityLink {
  targetId: string;
  targetType: EntityType;
  relationship: string;
  strength: number; // 0-1, based on interaction frequency
}

// Specific entity types
export interface DailyNote extends BaseEntity {
  type: 'daily-note';
  date: string; // ISO date string YYYY-MM-DD
  summary?: string;
}

export interface Person extends BaseEntity {
  type: 'person';
  email?: string;
  company?: string;
  role?: string;
  lastContact?: Date;
}

export interface Company extends BaseEntity {
  type: 'company';
  industry?: string;
  website?: string;
  employees?: Person['id'][];
}

export interface Project extends BaseEntity {
  type: 'project';
  status: 'active' | 'paused' | 'completed' | 'archived';
  startDate?: Date;
  endDate?: Date;
  participants?: Person['id'][];
}

export interface Task extends BaseEntity {
  type: 'task';
  status: 'todo' | 'in-progress' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: Date;
  projectId?: Project['id'];
}

export interface Area extends BaseEntity {
  type: 'area';
  scope: string;
}

export interface Resource extends BaseEntity {
  type: 'resource';
  sourceUrl?: string;
  resourceType: 'article' | 'book' | 'video' | 'tool' | 'reference';
}

export type Entity = DailyNote | Person | Company | Project | Task | Area | Resource;

// -----------------------------------------------------------------------------
// Query & Search Types
// -----------------------------------------------------------------------------

export interface VectorQuery {
  embedding: number[];
  limit?: number;
  threshold?: number; // Minimum similarity score
  filter?: EntityFilter;
}

export interface EntityFilter {
  types?: EntityType[];
  memoryLayers?: MemoryLayerType[];
  tags?: string[];
  dateRange?: {
    start?: Date;
    end?: Date;
  };
}

export interface SearchResult<T extends Entity = Entity> {
  entity: T;
  score: number;
  highlights?: string[];
}

export interface SearchResponse<T extends Entity = Entity> {
  results: SearchResult<T>[];
  total: number;
  query: string;
  took: number; // milliseconds
}

// -----------------------------------------------------------------------------
// Sync & Replication Types (ElectricSQL)
// -----------------------------------------------------------------------------

export type SyncStatus = 'synced' | 'pending' | 'conflict' | 'error';

export interface SyncState {
  status: SyncStatus;
  lastSyncedAt?: Date;
  pendingChanges: number;
  conflictCount: number;
}

export interface SyncConflict {
  entityId: string;
  localVersion: Entity;
  remoteVersion: Entity;
  resolvedAt?: Date;
  resolution?: 'local' | 'remote' | 'merged';
}

export interface ReplicationConfig {
  enabled: boolean;
  serverUrl?: string;
  syncInterval: number; // milliseconds
  conflictResolution: 'local-wins' | 'remote-wins' | 'manual';
}

// -----------------------------------------------------------------------------
// Memory Operations
// -----------------------------------------------------------------------------

export interface ConsolidationResult {
  processedCount: number;
  consolidatedCount: number;
  archivedCount: number;
  duration: number;
}

export interface MemoryStats {
  totalEntities: number;
  byLayer: Record<MemoryLayerType, number>;
  byType: Record<EntityType, number>;
  storageSize: number; // bytes
  vectorCount: number;
}

// -----------------------------------------------------------------------------
// API Types
// -----------------------------------------------------------------------------

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// -----------------------------------------------------------------------------
// Event Types (for reactivity)
// -----------------------------------------------------------------------------

export type MemoryEventType =
  | 'entity:created'
  | 'entity:updated'
  | 'entity:deleted'
  | 'sync:started'
  | 'sync:completed'
  | 'sync:conflict'
  | 'consolidation:started'
  | 'consolidation:completed';

export interface MemoryEvent<T = unknown> {
  type: MemoryEventType;
  payload: T;
  timestamp: Date;
  source: 'local' | 'remote';
}
