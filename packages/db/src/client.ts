// =============================================================================
// PGlite Database Client
// =============================================================================

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from './schema.js';
import { SCHEMA_SQL } from './schema-sql.js';

// -----------------------------------------------------------------------------
// Database surface
// -----------------------------------------------------------------------------

/** A Drizzle handle bound to this package's schema. */
export type UnimemDatabase = ReturnType<typeof drizzle<typeof schema>>;

/**
 * What the storage adapter and the sync manager actually need from a database.
 *
 * Kept narrower than `DatabaseClient` so the desktop shell can supply a client
 * that forwards to a PGlite instance in another process - the renderer there is
 * sandboxed and cannot open the database file itself. See `RemoteDatabaseClient`.
 */
export interface SqlDatabase {
  getDb(): UnimemDatabase;
  execute(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

// -----------------------------------------------------------------------------
// Database Client Configuration
// -----------------------------------------------------------------------------

export interface DatabaseConfig {
  /**
   * Path for persistent storage
   * - Use 'memory://' for in-memory database
   * - Use 'idb://dbname' for IndexedDB (browser)
   * - Use file path for Node.js / the desktop shell's main process
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

export class DatabaseClient implements SqlDatabase {
  private pglite: PGlite | null = null;
  private db: UnimemDatabase | null = null;
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

    await pg.exec(SCHEMA_SQL);
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
