// =============================================================================
// Deletion propagation
// =============================================================================
//
// Deleting used to drop the row, which meant the deletion never left the
// device: other devices kept their copy indefinitely, and an edit on one of
// them pushed the entity back. These pin the tombstone behaviour that fixes
// it - both that a deletion travels, and that a deleted entity stays deleted.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DatabaseClient } from '../dist/client.js';
import { PGliteStorageAdapter } from '../dist/storage-adapter.js';

async function createAdapter() {
  const client = new DatabaseClient({ dataDir: 'memory://', enableVector: false });
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
    tags: ['maths'],
    createdAt: new Date('2026-08-15T10:00:00Z'),
    updatedAt: new Date('2026-08-15T10:00:00Z'),
    email: 'ada@example.com',
    ...overrides,
  };
}

test('a deleted entity disappears from every read path', async () => {
  const { adapter } = await createAdapter();
  await adapter.create(person());

  await adapter.delete(person().id);

  assert.equal(await adapter.read(person().id), null);
  assert.deepEqual(await adapter.query({}), []);
  assert.deepEqual(await adapter.query({ types: ['person'] }), []);

  const stats = await adapter.getStats();
  assert.equal(stats.totalEntities, 0);
  assert.equal(stats.byType.person, 0);
  assert.equal(stats.byLayer.episodic, 0);
});

test('the row survives as a tombstone so the deletion can be pushed', async () => {
  const { adapter, client } = await createAdapter();
  await adapter.create(person());

  // Simulate the entity having already been pushed once.
  await client.execute(`UPDATE entities SET sync_status = 'synced'`);
  await adapter.delete(person().id);

  const rows = await client.execute(
    `SELECT sync_status, deleted_at FROM entities WHERE id = $1`,
    [person().id]
  );

  assert.equal(rows.rows.length, 1, 'row must remain for sync to carry');
  assert.equal(rows.rows[0].sync_status, 'pending');
  assert.ok(rows.rows[0].deleted_at, 'deleted_at must be set');
});

test('bulkDelete tombstones rather than dropping rows', async () => {
  const { adapter, client } = await createAdapter();
  const second = '22222222-2222-2222-2222-222222222222';

  await adapter.bulkCreate([person(), person({ id: second, title: 'Grace' })]);
  await adapter.bulkDelete([person().id, second]);

  assert.deepEqual(await adapter.query({}), []);

  const rows = await client.execute(
    `SELECT count(*) AS n FROM entities WHERE deleted_at IS NOT NULL`
  );
  assert.equal(Number(rows.rows[0].n), 2);
});

test('a tombstone reaching a second device deletes it there', async () => {
  // Device A deletes; device B has its own live copy of the same entity.
  const a = await createAdapter();
  const b = await createAdapter();

  await a.adapter.create(person());
  await b.adapter.create(person());
  await a.adapter.delete(person().id);

  // What A would push: the row as the sync manager reads it.
  const pending = await a.client.execute(
    `SELECT * FROM entities WHERE sync_status = 'pending'`
  );
  assert.equal(pending.rows.length, 1);
  const tombstone = pending.rows[0];
  assert.ok(tombstone.deleted_at, 'the pushed row carries the tombstone');

  // What B does on receiving it (mirrors upsertRemoteEntity's update branch).
  await b.client.execute(
    `UPDATE entities SET updated_at = $1, deleted_at = $2, sync_status = 'synced'
     WHERE id = $3`,
    [tombstone.updated_at, tombstone.deleted_at, tombstone.id]
  );

  assert.equal(await b.adapter.read(person().id), null, 'deleted on device B');

  // And B must not push it back: the entity is settled, not pending.
  const bPending = await b.client.execute(
    `SELECT count(*) AS n FROM entities WHERE sync_status = 'pending'`
  );
  assert.equal(Number(bPending.rows[0].n), 0, 'device B has nothing to resurrect');
});

test('an update does not revive a deleted entity', async () => {
  const { adapter } = await createAdapter();
  await adapter.create(person());
  await adapter.delete(person().id);

  // `update` re-reads the row afterwards and finds nothing, because reads
  // filter tombstones - it must fail rather than quietly resurrect.
  await assert.rejects(
    () => adapter.update(person().id, { title: 'Ada King' }),
    /not found/i
  );

  assert.equal(await adapter.read(person().id), null);
});
