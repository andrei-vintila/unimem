// =============================================================================
// The bundle as the store, PGlite as a derived index
// =============================================================================
//
// The claim being tested is a strong one: the index holds nothing that cannot
// be reconstructed from the markdown. If that holds, a schema change is a
// rebuild rather than a migration, and a vault edited in Obsidian - or by
// another person over git - is the store rather than an import.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DatabaseClient } from '../dist/client.js';
import { OkfStorageAdapter } from '../dist/okf-storage-adapter.js';
import { createNodeBundleFs } from '../../okf/dist/node-fs.js';

async function createStore({ actor = 'human:andrei', root } = {}) {
  const bundleRoot = root ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'okf-store-')));
  const client = new DatabaseClient({ dataDir: 'memory://', enableVector: false });
  await client.initialize();

  const adapter = new OkfStorageAdapter({
    fs: createNodeBundleFs(),
    root: bundleRoot,
    index: client,
    actor,
  });
  await adapter.rebuild();

  return { adapter, client, root: bundleRoot };
}

function person(overrides = {}) {
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
    email: 'ada@example.com',
    ...overrides,
  };
}

test('creating an entity writes markdown a person can read', async () => {
  const { adapter, root } = await createStore();

  await adapter.create(person());

  const file = path.join(root, 'person', 'ada-lovelace.md');
  const raw = await fs.readFile(file, 'utf8');

  assert.match(raw, /^type: person$/m);
  assert.match(raw, /^title: Ada Lovelace$/m);
  assert.match(raw, /^email: ada@example\.com$/m);
  assert.match(raw, /First programmer\./);
});

test('the index can be thrown away and rebuilt from the files', async () => {
  const { adapter, client, root } = await createStore();

  await adapter.create(person());
  await adapter.create(
    person({ id: '22222222-2222-4222-8222-222222222222', title: 'Grace Hopper' })
  );

  // Simulate losing the index entirely - a schema change, a corrupt file, a
  // new device pointed at the same vault.
  await client.execute('DELETE FROM entities');
  assert.deepEqual(await adapter.query({}), [], 'index really is empty');

  const report = await adapter.rebuild();
  assert.equal(report.entities, 2);
  assert.deepEqual(report.skipped, []);

  const titles = (await adapter.query({})).map((e) => e.title).sort();
  assert.deepEqual(titles, ['Ada Lovelace', 'Grace Hopper']);

  const ada = await adapter.read(person().id);
  assert.equal(ada.email, 'ada@example.com', 'type-specific fields survive');
  assert.equal(ada.createdAt.toISOString(), '2026-08-01T09:00:00.000Z');
});

test('a file written by hand becomes an entity on rebuild', async () => {
  const { adapter, root } = await createStore();

  // What Obsidian - or a colleague's git push - leaves behind.
  await fs.mkdir(path.join(root, 'task'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'task', 'write-the-spec.md'),
    '---\ntype: task\ntitle: Write the spec\nstate: todo\n---\n\nDue Friday.\n'
  );

  await adapter.rebuild();

  const tasks = await adapter.query({ types: ['task'] });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'Write the spec');
  assert.equal(tasks[0].state, 'todo');
  assert.equal(tasks[0].memoryLayer, 'procedural');
});

test('edits made outside the app win, because the files are the store', async () => {
  const { adapter, root } = await createStore();
  await adapter.create(person());

  const file = path.join(root, 'person', 'ada-lovelace.md');
  const edited = (await fs.readFile(file, 'utf8')).replace(
    'First programmer.',
    'Edited in Obsidian by someone else.'
  );
  await fs.writeFile(file, edited);

  await adapter.rebuild();

  const ada = await adapter.read(person().id);
  assert.match(ada.content, /Edited in Obsidian by someone else\./);
});

test('deleting records an attributed tombstone and removes the file', async () => {
  const { adapter, root } = await createStore({ actor: 'human:sam' });
  await adapter.create(person());

  await adapter.delete(person().id);

  assert.equal(await adapter.read(person().id), null);
  assert.deepEqual(
    await fs.readdir(path.join(root, 'person')),
    [],
    'the document is gone from the bundle'
  );

  const log = await fs.readFile(path.join(root, 'log.md'), 'utf8');
  assert.match(log, /\*\*Deletion\*\*/);
  assert.match(log, /human:sam/);

  // And the deletion survives a rebuild, or the entity would walk back in the
  // moment another device pushed its copy.
  await adapter.rebuild();
  assert.equal(await adapter.read(person().id), null, 'still deleted after rebuild');
});

test('authorship is stamped, and the original author is never overwritten', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'okf-store-'));

  const andrei = await createStore({ actor: 'human:andrei', root });
  const created = await andrei.adapter.create(person());
  assert.equal(created.createdBy, 'human:andrei');
  assert.equal(created.updatedBy, 'human:andrei');

  // A second contributor opens the same vault and edits it.
  const sam = await createStore({ actor: 'human:sam', root });
  const edited = await sam.adapter.update(person().id, { title: 'Ada King' });

  assert.equal(edited.createdBy, 'human:andrei', 'the original author stands');
  assert.equal(edited.updatedBy, 'human:sam');

  const raw = await fs.readFile(path.join(root, 'person', 'ada-king.md'), 'utf8');
  assert.match(raw, /^author: human:andrei$/m);
  assert.match(raw, /^last_edited_by: human:sam$/m);
});

test('a rebuild does not queue the whole vault for pushing', async () => {
  const { adapter, client } = await createStore();
  await adapter.create(person());

  await adapter.rebuild();

  const pending = await client.execute(
    `SELECT count(*) AS n FROM entities WHERE sync_status = 'pending'`
  );
  assert.equal(
    Number(pending.rows[0].n),
    0,
    'entities read from the bundle are not local changes'
  );
});

test('a malformed file does not stop the vault from loading', async () => {
  const { adapter, root } = await createStore();
  await adapter.create(person());

  await fs.mkdir(path.join(root, 'notes'), { recursive: true });
  await fs.writeFile(path.join(root, 'notes', 'broken.md'), 'no frontmatter here\n');

  const report = await adapter.rebuild();

  assert.equal(report.entities, 1, 'the good document still loads');
  assert.equal(report.skipped.length, 1);
  assert.match(report.skipped[0].reason, /frontmatter/i);
});

test('a hand-written document can be deleted, file and all', async () => {
  const { adapter, root } = await createStore();

  // No `resource` - typed by hand, or written by a tool that has never heard
  // of us. It still has to be a first-class entity.
  await fs.mkdir(path.join(root, 'project'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'project', 'cobol.md'),
    '---\ntype: project\ntitle: COBOL\n---\n\nFrom someone else.\n'
  );

  await adapter.rebuild();
  const [cobol] = await adapter.query({ types: ['project'] });

  await adapter.delete(cobol.id);

  assert.deepEqual(
    await fs.readdir(path.join(root, 'project')),
    [],
    'the document has to actually leave the vault, not just the index'
  );
  const log = await fs.readFile(path.join(root, 'log.md'), 'utf8');
  assert.match(log, /COBOL/);
});

test('hand-written documents are claimed so their identity stops moving', async () => {
  const { adapter, root } = await createStore();

  await fs.mkdir(path.join(root, 'task'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'task', 'buy-milk.md'),
    '---\ntype: task\ntitle: Buy milk\n---\n\nFrom the shop.\n'
  );

  const report = await adapter.rebuild();
  assert.equal(report.adopted, 1);

  const raw = await fs.readFile(path.join(root, 'task', 'buy-milk.md'), 'utf8');
  assert.match(raw, /^resource: unimem:\/\/entity\//m, 'identity is now recorded');

  // The point of claiming it: renaming the file no longer changes who it is.
  const claimed = (await adapter.query({ types: ['task'] }))[0];
  await fs.rename(
    path.join(root, 'task', 'buy-milk.md'),
    path.join(root, 'task', 'groceries.md')
  );
  await adapter.rebuild();

  const afterRename = (await adapter.query({ types: ['task'] }))[0];
  assert.equal(afterRename.id, claimed.id, 'same entity, renamed file');
  assert.equal((await adapter.query({ types: ['task'] })).length, 1, 'not duplicated');
});
