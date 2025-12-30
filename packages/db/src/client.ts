// =============================================================================
// PGlite Database Client
// =============================================================================

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from './schema';

// -----------------------------------------------------------------------------
// Database Client Configuration
// -----------------------------------------------------------------------------

export interface DatabaseConfig {
  /**
   * Path for persistent storage
   * - Use 'memory://' for in-memory database
   * - Use 'idb://dbname' for IndexedDB (browser)
   * - Use file path for Node.js/Tauri
   */
  dataDir: string;

  /**
   * Enable pgvector extension
   */
  enableVector?: boolean;

  /**
   * Vector dimensions for embedding storage
   */
  vectorDimensions?: number;
}

// -----------------------------------------------------------------------------
// Database Client
// -----------------------------------------------------------------------------

export class DatabaseClient {
  private pglite: PGlite | null = null;
  private db: ReturnType<typeof drizzle<typeof schema>> | null = null;
  private config: DatabaseConfig;
  private initialized = false;

  constructor(config: DatabaseConfig) {
    this.config = {
      enableVector: true,
      vectorDimensions: 1536,
      ...config,
    };
  }

  /**
   * Initialize the database connection
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create PGlite instance
    this.pglite = new PGlite(this.config.dataDir);

    // Create Drizzle instance
    this.db = drizzle(this.pglite, { schema });

    // Run initialization SQL
    await this.runInitialization();

    this.initialized = true;
  }

  /**
   * Get the Drizzle database instance
   */
  getDb() {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Get the raw PGlite instance
   */
  getPGlite() {
    if (!this.pglite) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.pglite;
  }

  /**
   * Execute raw SQL
   */
  async execute(sql: string, params?: unknown[]) {
    const pg = this.getPGlite();
    return pg.query(sql, params);
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.pglite) {
      await this.pglite.close();
      this.pglite = null;
      this.db = null;
      this.initialized = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  private async runInitialization(): Promise<void> {
    const pg = this.getPGlite();

    // Enable pgvector extension (if available)
    if (this.config.enableVector) {
      try {
        await pg.query('CREATE EXTENSION IF NOT EXISTS vector');
      } catch {
        console.warn('pgvector extension not available, using fallback');
      }
    }

    // Create tables
    await pg.query(`
      -- Entities table
      CREATE TABLE IF NOT EXISTS entities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type TEXT NOT NULL,
        memory_layer TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding REAL[],
        metadata JSONB,
        links JSONB DEFAULT '[]',
        tags TEXT[] DEFAULT '{}',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        sync_status TEXT DEFAULT 'synced',
        sync_version TEXT
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
      CREATE INDEX IF NOT EXISTS idx_entities_memory_layer ON entities(memory_layer);
      CREATE INDEX IF NOT EXISTS idx_entities_created_at ON entities(created_at);
      CREATE INDEX IF NOT EXISTS idx_entities_updated_at ON entities(updated_at);

      -- Daily notes
      CREATE TABLE IF NOT EXISTS daily_notes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        date TEXT NOT NULL UNIQUE,
        summary TEXT
      );

      -- People
      CREATE TABLE IF NOT EXISTS people (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        email TEXT,
        company TEXT,
        role TEXT,
        last_contact TIMESTAMP
      );

      -- Companies
      CREATE TABLE IF NOT EXISTS companies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        industry TEXT,
        website TEXT
      );

      -- Projects
      CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'active',
        start_date TIMESTAMP,
        end_date TIMESTAMP
      );

      -- Tasks
      CREATE TABLE IF NOT EXISTS tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'todo',
        priority TEXT NOT NULL DEFAULT 'medium',
        due_date TIMESTAMP,
        project_id UUID REFERENCES projects(id)
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);

      -- Areas
      CREATE TABLE IF NOT EXISTS areas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        scope TEXT
      );

      -- Resources
      CREATE TABLE IF NOT EXISTS resources (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        source_url TEXT,
        resource_type TEXT NOT NULL DEFAULT 'reference'
      );

      -- Sync log
      CREATE TABLE IF NOT EXISTS sync_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id UUID NOT NULL,
        operation TEXT NOT NULL,
        payload JSONB,
        timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
        client_id TEXT NOT NULL,
        resolved TIMESTAMP
      );
    `);
  }
}

// -----------------------------------------------------------------------------
// Factory Function
// -----------------------------------------------------------------------------

let defaultClient: DatabaseClient | null = null;

export async function createDatabase(
  config: DatabaseConfig
): Promise<DatabaseClient> {
  const client = new DatabaseClient(config);
  await client.initialize();
  return client;
}

export function getDefaultDatabase(): DatabaseClient {
  if (!defaultClient) {
    throw new Error('Default database not initialized');
  }
  return defaultClient;
}

export async function initializeDefaultDatabase(
  config: DatabaseConfig
): Promise<DatabaseClient> {
  defaultClient = await createDatabase(config);
  return defaultClient;
}
