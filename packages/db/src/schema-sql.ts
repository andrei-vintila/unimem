// =============================================================================
// Bootstrap DDL, shared by every client
// =============================================================================
//
// The desktop shell runs its PGlite instance in the Electron main process and
// reaches it over IPC, so this has to be usable from either side of that
// boundary. Keeping it as a plain string means the schema is defined exactly
// once no matter which process ends up opening the database.
//
// Must be run with PGlite's `exec` rather than `query`: `query` uses the
// extended protocol, which carries exactly one statement per prepared
// statement and rejects a batch like this one with "cannot insert multiple
// commands into a prepared statement". `exec` uses the simple protocol, which
// takes a script.

export const SCHEMA_SQL = `
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
    sync_version TEXT,
    deleted_at TIMESTAMP
  );

  -- Vaults created before deletions were syncable predate deleted_at, and
  -- CREATE TABLE IF NOT EXISTS leaves their entities table untouched.
  ALTER TABLE entities ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
  CREATE INDEX IF NOT EXISTS idx_entities_memory_layer ON entities(memory_layer);
  CREATE INDEX IF NOT EXISTS idx_entities_created_at ON entities(created_at);
  CREATE INDEX IF NOT EXISTS idx_entities_updated_at ON entities(updated_at);
  CREATE INDEX IF NOT EXISTS idx_entities_sync_status ON entities(sync_status);
  -- Every read filters tombstones out, so this is on the hot path.
  CREATE INDEX IF NOT EXISTS idx_entities_deleted_at ON entities(deleted_at);

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

  -- The version of each entity this device and the server last agreed on.
  --
  -- Without it a divergence is unreadable: there is no way to tell an edit
  -- from a deletion, or which side changed what, so the only available answer
  -- is last-write-wins and somebody's work is thrown away. This is the third
  -- input that makes a real merge possible.
  CREATE TABLE IF NOT EXISTS sync_base (
    entity_id UUID PRIMARY KEY,
    entity JSONB NOT NULL,
    sync_version TEXT,
    captured_at TIMESTAMP NOT NULL DEFAULT NOW()
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
`;
