// =============================================================================
// Remote Database Client - a database that lives in another process
// =============================================================================
//
// The desktop shell's renderer runs sandboxed, with no filesystem access, so
// it cannot open the PGlite file the shell keeps in the user's app data
// directory. The database is opened by the Electron main process instead, and
// the renderer drives it through a transport (an IPC round-trip) that carries
// nothing but SQL text, parameters, and rows.
//
// Everything above this layer - the schema, the DDL, the storage adapter, the
// sync manager - is the same code the browser runs against local PGlite.

import { drizzle } from 'drizzle-orm/pg-proxy';

import * as schema from './schema.js';
import type { SqlDatabase, UnimemDatabase } from './client.js';
import { SCHEMA_SQL } from './schema-sql.js';

// -----------------------------------------------------------------------------
// Transport
// -----------------------------------------------------------------------------

export interface SqlQueryRequest {
  sql: string;
  params: unknown[];
  /**
   * Drizzle's proxy driver maps rows positionally and needs `'array'`; raw
   * `execute` callers read columns by name and need `'object'`.
   */
  rowMode: 'array' | 'object';
}

export interface SqlTransport {
  query(request: SqlQueryRequest): Promise<{ rows: unknown[] }>;
  /** Runs a multi-statement script over the simple protocol. */
  exec(sql: string): Promise<void>;
}

// -----------------------------------------------------------------------------
// Client
// -----------------------------------------------------------------------------

export class RemoteDatabaseClient implements SqlDatabase {
  private transport: SqlTransport;
  private db: UnimemDatabase;
  private initialized = false;

  constructor(transport: SqlTransport) {
    this.transport = transport;

    // Both drivers build on the same PgDialect and generate the same SQL; they
    // differ only in the result-type parameter, which is not observable through
    // `SqlDatabase`. The cast keeps one database type across both surfaces so
    // the storage adapter does not have to be generic over the driver.
    this.db = drizzle(
      (sql, params) => this.transport.query({ sql, params, rowMode: 'array' }),
      { schema }
    ) as unknown as UnimemDatabase;
  }

  /** Create the schema if the remote database is new. Safe to call twice. */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.transport.exec(SCHEMA_SQL);
    this.initialized = true;
  }

  getDb(): UnimemDatabase {
    return this.db;
  }

  async execute(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    return this.transport.query({ sql, params, rowMode: 'object' });
  }
}
