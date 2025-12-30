// =============================================================================
// Database Schema - Drizzle ORM with pgvector
// =============================================================================

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  real,
  index,
  uuid,
} from 'drizzle-orm/pg-core';

// -----------------------------------------------------------------------------
// Custom pgvector type
// -----------------------------------------------------------------------------

// Note: pgvector extension must be enabled in the database
// CREATE EXTENSION IF NOT EXISTS vector;

// For now, we store embeddings as real[] until drizzle adds native vector support
// In production, you'd use: vector('embedding', { dimensions: 1536 })

// -----------------------------------------------------------------------------
// Entities Table
// -----------------------------------------------------------------------------

export const entities = pgTable(
  'entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(), // EntityType
    memoryLayer: text('memory_layer').notNull(), // MemoryLayerType

    title: text('title').notNull(),
    content: text('content').notNull(),

    // Vector embedding stored as array of floats
    // TODO: Replace with vector type when using actual pgvector
    embedding: real('embedding').array(),

    // Flexible metadata storage
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    // Relations stored as JSONB for flexibility
    links: jsonb('links')
      .$type<
        Array<{
          targetId: string;
          targetType: string;
          relationship: string;
          strength: number;
        }>
      >()
      .default([]),

    tags: text('tags').array().default([]),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),

    // Sync metadata (for ElectricSQL)
    syncStatus: text('sync_status').default('synced'),
    syncVersion: text('sync_version'),
  },
  (table) => [
    index('idx_entities_type').on(table.type),
    index('idx_entities_memory_layer').on(table.memoryLayer),
    index('idx_entities_created_at').on(table.createdAt),
    index('idx_entities_updated_at').on(table.updatedAt),
    // Note: Vector similarity index would be:
    // CREATE INDEX ON entities USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
  ]
);

// -----------------------------------------------------------------------------
// Daily Notes Table (Working Memory)
// -----------------------------------------------------------------------------

export const dailyNotes = pgTable('daily_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => entities.id, { onDelete: 'cascade' }),
  date: text('date').notNull().unique(), // ISO date YYYY-MM-DD
  summary: text('summary'),
});

// -----------------------------------------------------------------------------
// People Table (Episodic Memory)
// -----------------------------------------------------------------------------

export const people = pgTable('people', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => entities.id, { onDelete: 'cascade' }),
  email: text('email'),
  company: text('company'),
  role: text('role'),
  lastContact: timestamp('last_contact'),
});

// -----------------------------------------------------------------------------
// Companies Table (Episodic Memory)
// -----------------------------------------------------------------------------

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => entities.id, { onDelete: 'cascade' }),
  industry: text('industry'),
  website: text('website'),
});

// -----------------------------------------------------------------------------
// Projects Table (Episodic Memory)
// -----------------------------------------------------------------------------

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => entities.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('active'),
  startDate: timestamp('start_date'),
  endDate: timestamp('end_date'),
});

// -----------------------------------------------------------------------------
// Tasks Table (Procedural Memory)
// -----------------------------------------------------------------------------

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('todo'),
    priority: text('priority').notNull().default('medium'),
    dueDate: timestamp('due_date'),
    projectId: uuid('project_id').references(() => projects.id),
  },
  (table) => [
    index('idx_tasks_status').on(table.status),
    index('idx_tasks_due_date').on(table.dueDate),
  ]
);

// -----------------------------------------------------------------------------
// Areas Table (Semantic Memory)
// -----------------------------------------------------------------------------

export const areas = pgTable('areas', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => entities.id, { onDelete: 'cascade' }),
  scope: text('scope'),
});

// -----------------------------------------------------------------------------
// Resources Table (Semantic Memory)
// -----------------------------------------------------------------------------

export const resources = pgTable('resources', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => entities.id, { onDelete: 'cascade' }),
  sourceUrl: text('source_url'),
  resourceType: text('resource_type').notNull().default('reference'),
});

// -----------------------------------------------------------------------------
// Sync Log (for ElectricSQL conflict resolution)
// -----------------------------------------------------------------------------

export const syncLog = pgTable('sync_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityId: uuid('entity_id').notNull(),
  operation: text('operation').notNull(), // 'create' | 'update' | 'delete'
  payload: jsonb('payload'),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  clientId: text('client_id').notNull(),
  resolved: timestamp('resolved'),
});

// -----------------------------------------------------------------------------
// Type Exports
// -----------------------------------------------------------------------------

export type EntityRow = typeof entities.$inferSelect;
export type NewEntityRow = typeof entities.$inferInsert;
export type DailyNoteRow = typeof dailyNotes.$inferSelect;
export type PersonRow = typeof people.$inferSelect;
export type CompanyRow = typeof companies.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type AreaRow = typeof areas.$inferSelect;
export type ResourceRow = typeof resources.$inferSelect;
