// =============================================================================
// Privacy contract regression tests
// =============================================================================
//
// These assert the guarantee the whole analytics design rests on: note content
// cannot reach the network, even when a call site tries to send it.
//
// Runs against the built output (`pnpm --filter @unimem/analytics test`), with
// no test framework - `node --test` is enough and keeps the dependency count at
// zero for a package that ships to four surfaces.
// =============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeEvent,
  toErrorCode,
  bucketEntityCount,
  listEventNames,
  AnalyticsContractError,
} from '../dist/index.js';

test('passes through properties the catalog declares', () => {
  assert.deepEqual(
    sanitizeEvent({
      name: 'entity_created',
      properties: {
        entity_type: 'person',
        memory_layer: 'episodic',
        creation_method: 'manual',
      },
    }),
    { entity_type: 'person', memory_layer: 'episodic', creation_method: 'manual' }
  );
});

test('strips an undeclared property carrying an entity title', () => {
  const result = sanitizeEvent({
    name: 'entity_created',
    properties: {
      entity_type: 'person',
      memory_layer: 'episodic',
      creation_method: 'manual',
      title: 'Dr. Sarah Chen - therapy notes',
    },
  });

  assert.equal('title' in result, false);
  assert.deepEqual(Object.keys(result).sort(), [
    'creation_method',
    'entity_type',
    'memory_layer',
  ]);
});

test('drops an over-long string smuggled into a declared slot', () => {
  assert.deepEqual(
    sanitizeEvent({
      name: 'app_installed',
      properties: { version: 'note about the merger with '.repeat(5) },
    }),
    {}
  );
});

test('drops nested objects and arrays', () => {
  const base = { result_count: 3, duration_ms: 12, has_results: true };

  assert.deepEqual(
    sanitizeEvent({
      name: 'search_performed',
      properties: { ...base, search_type: { raw: 'divorce lawyer contact' } },
    }),
    base
  );

  assert.deepEqual(
    sanitizeEvent({
      name: 'search_performed',
      properties: { ...base, search_type: ['note-a', 'note-b'] },
    }),
    base
  );
});

test('drops events missing from the catalog', () => {
  assert.deepEqual(
    sanitizeEvent({ name: 'note_content_dump', properties: { body: 'secret' } }),
    {}
  );
});

test('strict mode surfaces contract violations instead of dropping them', () => {
  const violations = [
    {
      name: 'entity_created',
      properties: {
        entity_type: 'person',
        memory_layer: 'episodic',
        creation_method: 'manual',
        title: 'leak',
      },
    },
    { name: 'bogus_event', properties: {} },
    { name: 'app_installed', properties: { version: 'x'.repeat(100) } },
  ];

  for (const event of violations) {
    assert.throws(() => sanitizeEvent(event, true), AnalyticsContractError);
  }
});

test('error classification never returns the original message', () => {
  const leaky = new Error(
    'IndexedDB open failed for /Users/andrei/vault/01-people/Sarah Chen.md'
  );

  assert.equal(toErrorCode(leaky), 'storage-init');
  assert.equal(toErrorCode(new Error('something unrecognised')), 'unknown');
  assert.equal(toErrorCode({ secret: 'x' }), 'unknown');
});

test('entity counts are bucketed, not exact', () => {
  assert.equal(bucketEntityCount(0), '0');
  assert.equal(bucketEntityCount(7), '1-10');
  assert.equal(bucketEntityCount(4210), '1000+');
});

test('every catalog event has an allowlist entry', () => {
  const names = listEventNames();
  assert.ok(names.length > 0);
  for (const name of names) {
    assert.deepEqual(sanitizeEvent({ name, properties: {} }), {});
  }
});
