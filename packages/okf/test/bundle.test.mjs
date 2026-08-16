// =============================================================================
// OKF bundle - a directory as the store
// =============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  readBundle,
  writeEntity,
  appendDeletion,
  indexPaths,
} from '../dist/bundle.js';
import { createNodeBundleFs } from '../dist/node-fs.js';

const bundleFs = createNodeBundleFs();

async function tempBundle() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'okf-'));
}

function entity(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'person',
    memoryLayer: 'episodic',
    title: 'Ada Lovelace',
    content: 'First programmer.',
    tags: ['maths'],
    links: [],
    createdAt: new Date('2026-08-01T09:00:00.000Z'),
    updatedAt: new Date('2026-08-15T10:00:00.000Z'),
    createdBy: 'human:andrei',
    ...overrides,
  };
}

test('writes entities into type directories and reads them back', async () => {
  const root = await tempBundle();

  await writeEntity(bundleFs, root, entity());
  await writeEntity(
    bundleFs,
    root,
    entity({
      id: '22222222-2222-4222-8222-222222222222',
      type: 'task',
      memoryLayer: 'procedural',
      title: 'Ship the sync engine',
      state: 'todo',
    })
  );

  assert.deepEqual(
    (await fs.readdir(path.join(root, 'person'))),
    ['ada-lovelace.md'],
    'filename is a slug of the title'
  );

  const { entities, skipped } = await readBundle(bundleFs, root);
  assert.deepEqual(skipped, []);
  assert.equal(entities.length, 2);

  const task = entities.find((e) => e.type === 'task');
  assert.equal(task.title, 'Ship the sync engine');
  assert.equal(task.state, 'todo');
  assert.equal(task.memoryLayer, 'procedural');
});

test('retitling moves the file instead of forking a second copy', async () => {
  const root = await tempBundle();
  await writeEntity(bundleFs, root, entity());

  const known = await indexPaths(bundleFs, root);
  const moved = await writeEntity(bundleFs, root, entity({ title: 'Ada King' }), known);

  // The filename has to follow the title, or the vault fills up with notes
  // whose names describe what they used to be called.
  assert.equal(moved, 'person/ada-king.md');
  assert.deepEqual(
    await fs.readdir(path.join(root, 'person')),
    ['ada-king.md'],
    'the old file is gone, not left behind as a duplicate'
  );

  const { entities } = await readBundle(bundleFs, root);
  assert.equal(entities.length, 1, 'still one entity, not two');
  assert.equal(entities[0].title, 'Ada King');
  assert.equal(entities[0].id, '11111111-1111-4111-8111-111111111111');
});

test('an ordinary edit rewrites in place without churning the path', async () => {
  const root = await tempBundle();
  const first = await writeEntity(bundleFs, root, entity());

  const known = await indexPaths(bundleFs, root);
  const second = await writeEntity(
    bundleFs,
    root,
    entity({ content: 'Revised.' }),
    known
  );

  assert.equal(second, first, 'same title, same path');
  assert.deepEqual(await fs.readdir(path.join(root, 'person')), ['ada-lovelace.md']);
});

test('a disambiguated file keeps its name across edits', async () => {
  const root = await tempBundle();

  await writeEntity(bundleFs, root, entity());
  const second = { ...entity({ id: '33333333-3333-4333-8333-333333333333' }) };
  const secondPath = await writeEntity(bundleFs, root, second);

  const known = await indexPaths(bundleFs, root);
  const again = await writeEntity(bundleFs, root, { ...second, content: 'Edited.' }, known);

  assert.equal(again, secondPath, 'does not oscillate between names');
  assert.equal((await fs.readdir(path.join(root, 'person'))).length, 2);
});

test('two entities that slug alike get distinct files', async () => {
  const root = await tempBundle();

  await writeEntity(bundleFs, root, entity());
  await writeEntity(
    bundleFs,
    root,
    entity({ id: '33333333-3333-4333-8333-333333333333' })
  );

  const files = (await fs.readdir(path.join(root, 'person'))).sort();
  assert.equal(files.length, 2, `expected two files, got ${files}`);

  const { entities } = await readBundle(bundleFs, root);
  assert.equal(entities.length, 2);
  assert.equal(new Set(entities.map((e) => e.id)).size, 2);
});

test('a deletion is recorded in log.md and the document removed', async () => {
  const root = await tempBundle();
  const documentPath = await writeEntity(bundleFs, root, entity());

  await appendDeletion(
    bundleFs,
    root,
    {
      id: entity().id,
      title: 'Ada Lovelace',
      deletedAt: new Date('2026-08-16T12:00:00.000Z'),
      deletedBy: 'human:sam',
    },
    documentPath
  );

  const log = await fs.readFile(path.join(root, 'log.md'), 'utf8');
  assert.match(log, /^# Update Log$/m);
  assert.match(log, /^## 2026-08-16$/m, 'date heading in YYYY-MM-DD, per the spec');
  assert.match(log, /\*\*Deletion\*\*/);
  assert.match(log, /human:sam/, 'attributed, because more than one person writes here');
  assert.ok(!log.startsWith('---'), 'reserved files carry no frontmatter');

  const { entities, tombstones } = await readBundle(bundleFs, root);
  assert.deepEqual(entities, [], 'document gone');
  assert.equal(tombstones.length, 1);
  assert.equal(tombstones[0].id, entity().id);
  assert.equal(tombstones[0].deletedBy, 'human:sam');
  assert.equal(tombstones[0].deletedAt.toISOString(), '2026-08-16T12:00:00.000Z');
});

test('deletions accumulate across days without losing earlier entries', async () => {
  const root = await tempBundle();

  await appendDeletion(bundleFs, root, {
    id: '44444444-4444-4444-8444-444444444444',
    title: 'First',
    deletedAt: new Date('2026-08-14T09:00:00.000Z'),
  });
  await appendDeletion(bundleFs, root, {
    id: '55555555-5555-4555-8555-555555555555',
    title: 'Second',
    deletedAt: new Date('2026-08-16T09:00:00.000Z'),
  });
  await appendDeletion(bundleFs, root, {
    id: '66666666-6666-4666-8666-666666666666',
    title: 'Third',
    deletedAt: new Date('2026-08-16T11:00:00.000Z'),
  });

  const { tombstones } = await readBundle(bundleFs, root);
  assert.deepEqual(
    tombstones.map((t) => t.title).sort(),
    ['First', 'Second', 'Third']
  );

  const log = await fs.readFile(path.join(root, 'log.md'), 'utf8');
  assert.equal((log.match(/^## /gm) ?? []).length, 2, 'one heading per day');
});

test('a malformed document is reported, not fatal', async () => {
  const root = await tempBundle();
  await writeEntity(bundleFs, root, entity());

  await fs.mkdir(path.join(root, 'notes'), { recursive: true });
  await fs.writeFile(path.join(root, 'notes', 'stray.md'), 'just some text\n');

  const { entities, skipped } = await readBundle(bundleFs, root);
  assert.equal(entities.length, 1, 'the good document still loads');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].path, 'notes/stray.md');
  assert.match(skipped[0].reason, /frontmatter/i);
});

test('reserved filenames are never treated as concepts', async () => {
  const root = await tempBundle();
  await writeEntity(bundleFs, root, entity());
  await fs.writeFile(path.join(root, 'index.md'), '# Vault\n\n* [Ada](/person/ada-lovelace.md)\n');

  const { entities, skipped } = await readBundle(bundleFs, root);
  assert.equal(entities.length, 1);
  assert.deepEqual(skipped, [], 'index.md is not a malformed concept');
});

test('a document with no resource keeps the same id on every read', async () => {
  const root = await tempBundle();
  await fs.mkdir(path.join(root, 'task'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'task', 'buy-milk.md'),
    '---\ntype: task\n---\n\n# Buy milk\n'
  );

  const first = await readBundle(bundleFs, root);
  const second = await readBundle(bundleFs, root);

  assert.equal(first.entities.length, 1);
  assert.equal(
    first.entities[0].id,
    second.entities[0].id,
    'a path-derived id must be stable, or every read creates a duplicate'
  );
  assert.match(first.entities[0].id, /^[0-9a-f-]{36}$/, 'shaped like a uuid');
});

test('reading a bundle that does not exist yet yields nothing', async () => {
  const result = await readBundle(bundleFs, path.join(os.tmpdir(), 'okf-absent-xyz'));

  assert.deepEqual(result.entities, []);
  assert.deepEqual(result.tombstones, []);
});
