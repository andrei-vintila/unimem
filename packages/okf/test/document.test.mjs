// =============================================================================
// OKF document conversion
// =============================================================================
//
// The store is the files, so the conversion is the thing that has to be
// lossless. A field that quietly fails to round-trip is not a display bug -
// it is data destroyed on the next save.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  documentToEntity,
  entityToDocument,
  parseDocument,
  serializeDocument,
  OkfParseError,
} from '../dist/document.js';
import { resourceForId } from '../dist/profile.js';

const FALLBACK = '00000000-0000-4000-8000-000000000000';

function person(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'person',
    memoryLayer: 'episodic',
    title: 'Ada Lovelace',
    content: '# Ada Lovelace\n\nFirst programmer.',
    tags: ['maths', 'history'],
    links: [
      {
        targetId: '22222222-2222-4222-8222-222222222222',
        targetType: 'project',
        relationship: 'works-on',
        strength: 0.8,
      },
    ],
    createdAt: new Date('2026-08-01T09:00:00.000Z'),
    updatedAt: new Date('2026-08-15T10:00:00.000Z'),
    createdBy: 'human:andrei',
    updatedBy: 'human:sam',
    email: 'ada@example.com',
    company: 'Analytical Engines',
    ...overrides,
  };
}

function roundTrip(entity) {
  const text = serializeDocument(entityToDocument(entity));
  return documentToEntity(parseDocument(text), FALLBACK);
}

test('an entity survives a round trip through markdown', () => {
  const original = person();
  const result = roundTrip(original);

  assert.equal(result.id, original.id);
  assert.equal(result.type, 'person');
  assert.equal(result.title, 'Ada Lovelace');
  assert.equal(result.memoryLayer, 'episodic');
  assert.deepEqual(result.tags, ['maths', 'history']);
  assert.equal(result.content.trim(), original.content.trim());

  assert.equal(result.createdAt.toISOString(), '2026-08-01T09:00:00.000Z');
  assert.equal(result.updatedAt.toISOString(), '2026-08-15T10:00:00.000Z');
});

test('contributor identity survives, because a vault has more than one author', () => {
  const result = roundTrip(person());

  assert.equal(result.createdBy, 'human:andrei');
  assert.equal(result.updatedBy, 'human:sam');
});

test('type-specific fields survive as ordinary frontmatter keys', () => {
  const result = roundTrip(person());

  assert.equal(result.email, 'ada@example.com');
  assert.equal(result.company, 'Analytical Engines');
});

test('links keep the relationship and strength OKF cannot express', () => {
  const result = roundTrip(person());

  assert.equal(result.links.length, 1);
  assert.deepEqual(result.links[0], {
    targetId: '22222222-2222-4222-8222-222222222222',
    targetType: 'project',
    relationship: 'works-on',
    strength: 0.8,
  });
});

test('embeddings are kept out of the file', () => {
  const doc = entityToDocument(
    person({ embedding: Array.from({ length: 1536 }, (_, i) => i / 1536) })
  );

  assert.equal(doc.frontmatter.embedding, undefined);
  assert.ok(
    !serializeDocument(doc).includes('embedding'),
    'an embedding in the document would dwarf it and ruin every diff'
  );
});

test('unknown keys written by another producer are preserved', () => {
  const text = [
    '---',
    'type: person',
    'title: Grace Hopper',
    `resource: ${resourceForId('33333333-3333-4333-8333-333333333333')}`,
    'timestamp: 2026-08-15T10:00:00.000Z',
    'some_other_tool_field: keep me',
    'nested_thing:',
    '  a: 1',
    '---',
    '',
    'Body.',
  ].join('\n');

  const entity = documentToEntity(parseDocument(text), FALLBACK);
  assert.equal(entity.some_other_tool_field, 'keep me');

  // And back out again - OKF requires consumers not to drop what they do not
  // understand, which only holds if the write path carries them too.
  const back = entityToDocument(entity);
  assert.equal(back.frontmatter.some_other_tool_field, 'keep me');
  assert.deepEqual(back.frontmatter.nested_thing, { a: 1 });
});

test('identity comes from resource, not the filename or title', () => {
  const renamed = roundTrip(person({ title: 'Ada King, Countess of Lovelace' }));

  assert.equal(renamed.id, '11111111-1111-4111-8111-111111111111');
  assert.equal(renamed.title, 'Ada King, Countess of Lovelace');
});

test('a hand-written document with no resource still becomes an entity', () => {
  const text = '---\ntype: task\n---\n\n# Buy milk\n\nFrom the shop.';
  const entity = documentToEntity(parseDocument(text), FALLBACK);

  assert.equal(entity.id, FALLBACK, 'falls back to the caller-supplied id');
  assert.equal(entity.type, 'task');
  assert.equal(entity.title, 'Buy milk', 'title taken from the first heading');
  assert.equal(entity.memoryLayer, 'procedural', 'layer inferred from the type');
});

test('a deleted entity is written as an OKF deprecation', () => {
  const doc = entityToDocument(person({ deletedAt: new Date('2026-08-16T00:00:00.000Z') }));
  assert.equal(doc.frontmatter.status, 'deprecated');

  assert.ok(roundTrip(person({ deletedAt: new Date('2026-08-16T00:00:00.000Z') })).deletedAt);
  assert.equal(roundTrip(person()).deletedAt, undefined);
});

test('documents OKF would reject are rejected here', () => {
  assert.throws(() => parseDocument('no frontmatter at all'), OkfParseError);
  assert.throws(() => parseDocument('---\ntitle: no type\n---\n\nbody'), OkfParseError);
  assert.throws(() => parseDocument('---\ntype: ""\n---\n\nbody'), OkfParseError);
  assert.throws(() => parseDocument('---\n\tbad: [yaml\n---\n\nbody'), OkfParseError);
});

test('serialized documents are conformant and stable', () => {
  const first = serializeDocument(entityToDocument(person()));
  const second = serializeDocument(entityToDocument(roundTrip(person())));

  assert.ok(first.startsWith('---\n'), 'starts with frontmatter');
  assert.match(first, /^type: person$/m);
  // Byte-stable output keeps a save that changed nothing out of everyone's diff.
  assert.equal(first, second);
});
