// =============================================================================
// RemoteDatabaseClient - the desktop shell's database path
// =============================================================================
//
// On desktop the database is opened by the Electron main process and driven
// from a sandboxed renderer over IPC. That boundary is invisible to everything
// above it, which is exactly what makes it easy to break silently: a row-shape
// mismatch between PGlite and Drizzle's proxy driver would not show up until
// the packaged app ran.
//
// The transport here is the same contract the preload bridge implements, so
// these run the real storage adapter over the real driver without Electron.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PGlite, types } from '@electric-sql/pglite';

import { PGliteStorageAdapter } from '../dist/storage-adapter.js';
import { RemoteDatabaseClient } from '../dist/remote-client.js';

// Kept in step with `RAW_TEMPORAL_PARSERS` in apps/desktop/src/main/database.ts.
// Without it PGlite parses TIMESTAMP columns as local time and every date the
// proxy path returns is off by the machine's UTC offset.
const RAW_TEMPORAL_PARSERS = {
  [types.TIMESTAMP]: (value) => value,
  [types.TIMESTAMPTZ]: (value) => value,
  [types.INTERVAL]: (value) => value,
  [types.DATE]: (value) => value,
};

/** Mirrors `registerDatabaseHandlers` in apps/desktop/src/main/database.ts. */
async function createTransport() {
  const pglite = new PGlite('memory://');
  await pglite.waitReady;

  return {
    async query({ sql, params, rowMode }) {
      const result = await pglite.query(sql, params, {
        rowMode,
        ...(rowMode === 'array' ? { parsers: RAW_TEMPORAL_PARSERS } : {}),
      });
      return { rows: result.rows };
    },
    async exec(sql) {
      await pglite.exec(sql);
    },
  };
}

async function createAdapter() {
  const client = new RemoteDatabaseClient(await createTransport());
  await client.initialize();
  return { adapter: new PGliteStorageAdapter(client), client };
}

function person(overrides = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    type: 'person',
    memoryLayer: 'episodic',
    title: 'Ada Lovelace',
    content: 'First programmer',
    links: [],
    tags: ['maths', 'history'],
    createdAt: new Date('2026-08-15T10:00:00Z'),
    updatedAt: new Date('2026-08-15T10:00:00Z'),
    email: 'ada@example.com',
    company: 'Analytical Engines',
    ...overrides,
  };
}

test('creates the schema on a fresh remote database', async () => {
  const { client } = await createAdapter();

  const result = await client.execute(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
  );
  const tables = result.rows.map((row) => row.table_name);

  for (const expected of ['entities', 'sync_log', 'tasks', 'people']) {
    assert.ok(tables.includes(expected), `missing table: ${expected}`);
  }
});

test('round-trips an entity through the proxy driver', async () => {
  const { adapter } = await createAdapter();
  const original = person();

  await adapter.create(original);
  const read = await adapter.read(original.id);

  assert.equal(read.title, 'Ada Lovelace');
  assert.equal(read.type, 'person');
  assert.equal(read.memoryLayer, 'episodic');
  assert.deepEqual(read.tags, ['maths', 'history']);
  assert.deepEqual(read.links, []);

  // Type-specific fields live in the metadata JSONB column and are merged back
  // on read; losing them would silently flatten every entity to a BaseEntity.
  assert.equal(read.email, 'ada@example.com');
  assert.equal(read.company, 'Analytical Engines');

  // Positional row mapping is the thing most likely to break: a column-order
  // mismatch shows up as a Date landing in a text field, not as an error.
  assert.ok(read.createdAt instanceof Date);
  assert.equal(read.createdAt.toISOString(), '2026-08-15T10:00:00.000Z');
});

test('marks local writes pending so the sync manager picks them up', async () => {
  const { adapter, client } = await createAdapter();

  await adapter.create(person());

  const created = await client.execute(
    `SELECT sync_status FROM entities WHERE id = $1`,
    [person().id]
  );
  assert.equal(created.rows[0].sync_status, 'pending');

  // An update has to re-arm it: an entity pushed once and then edited is a
  // change the server has not seen either.
  await client.execute(`UPDATE entities SET sync_status = 'synced'`);
  await adapter.update(person().id, { title: 'Ada King' });

  const updated = await client.execute(
    `SELECT sync_status, title FROM entities WHERE id = $1`,
    [person().id]
  );
  assert.equal(updated.rows[0].sync_status, 'pending');
  assert.equal(updated.rows[0].title, 'Ada King');
});

test('queries, filters and counts across the boundary', async () => {
  const { adapter } = await createAdapter();

  await adapter.bulkCreate([
    person(),
    person({
      id: '22222222-2222-2222-2222-222222222222',
      type: 'task',
      memoryLayer: 'procedural',
      title: 'Write the engine',
      tags: ['work'],
      status: 'todo',
      priority: 'high',
    }),
  ]);

  const tasks = await adapter.query({ types: ['task'] });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'Write the engine');
  assert.equal(tasks[0].priority, 'high');

  const stats = await adapter.getStats();
  assert.equal(stats.totalEntities, 2);
  assert.equal(stats.byType.person, 1);
  assert.equal(stats.byType.task, 1);
  assert.equal(stats.byLayer.episodic, 1);
  assert.equal(stats.byLayer.procedural, 1);
});

test('preserves embeddings, which are the widest numeric payload', async () => {
  const { adapter } = await createAdapter();
  const embedding = Array.from({ length: 1536 }, (_, i) => i / 1536);

  await adapter.create(person({ embedding }));
  const read = await adapter.read(person().id);

  assert.equal(read.embedding.length, 1536);
  assert.ok(Math.abs(read.embedding[100] - 100 / 1536) < 1e-6);

  const stats = await adapter.getStats();
  assert.equal(stats.vectorCount, 1);
});
