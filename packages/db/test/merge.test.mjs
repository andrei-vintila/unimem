// =============================================================================
// Three-way merge
// =============================================================================
//
// The failure this replaces: two people edit different paragraphs of one note
// and whoever pushes second erases the other. Every test here is a shape that
// used to lose somebody's writing.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mergeEntities, mergeText } from '../dist/merge.js';

function note(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'person',
    memoryLayer: 'episodic',
    title: 'Ada Lovelace',
    content: '# Ada Lovelace\n\nFirst programmer.\n\n## Notes\n\nNothing yet.',
    tags: ['maths'],
    links: [],
    createdAt: new Date('2026-08-01T09:00:00Z'),
    updatedAt: new Date('2026-08-15T10:00:00Z'),
    createdBy: 'human:andrei',
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// Text
// -----------------------------------------------------------------------------

test('edits to different parts of a note both survive', () => {
  const base = 'Alpha\n\nBravo\n\nCharlie';
  const mine = 'Alpha EDITED\n\nBravo\n\nCharlie';
  const theirs = 'Alpha\n\nBravo\n\nCharlie EDITED';

  const result = mergeText(base, mine, theirs);

  assert.equal(result.conflicted, false);
  assert.match(result.text, /Alpha EDITED/);
  assert.match(result.text, /Charlie EDITED/);
});

test('the same edit made twice is agreement, not a conflict', () => {
  const base = 'Alpha\n\nBravo';
  const both = 'Alpha\n\nBravo EDITED';

  const result = mergeText(base, both, both);
  assert.equal(result.conflicted, false);
  assert.equal(result.text, both);
});

test('one side editing and the other not is not a merge at all', () => {
  const base = 'Alpha';
  assert.deepEqual(mergeText(base, 'Changed', base), { text: 'Changed', conflicted: false });
  assert.deepEqual(mergeText(base, base, 'Changed'), { text: 'Changed', conflicted: false });
});

test('the same line changed differently is left for a person', () => {
  const result = mergeText('Alpha\n\nBravo', 'MINE\n\nBravo', 'THEIRS\n\nBravo');

  assert.equal(result.conflicted, true);
  assert.match(result.text, /MINE/);
  assert.match(result.text, /THEIRS/, 'both sides are kept, so nothing is lost');
  assert.match(result.text, /<{7}/, 'and marked, so it is obvious something needs deciding');
});

test('an insertion by one side and an edit elsewhere by the other merge', () => {
  const base = '# Title\n\nOne\n\nTwo';
  const mine = '# Title\n\nOne\n\nTwo\n\nThree';
  const theirs = '# Title\n\nOne EDITED\n\nTwo';

  const result = mergeText(base, mine, theirs);
  assert.equal(result.conflicted, false);
  assert.match(result.text, /One EDITED/);
  assert.match(result.text, /Three/);
});

// -----------------------------------------------------------------------------
// Entities
// -----------------------------------------------------------------------------

test('two people editing different sections of one note both keep their work', () => {
  const base = note();
  const mine = note({
    content: '# Ada Lovelace\n\nFirst programmer, and a mathematician.\n\n## Notes\n\nNothing yet.',
    updatedAt: new Date('2026-08-15T11:00:00Z'),
  });
  const theirs = note({
    content: '# Ada Lovelace\n\nFirst programmer.\n\n## Notes\n\nFollow up about the engine.',
    updatedAt: new Date('2026-08-15T12:00:00Z'),
  });

  const merged = mergeEntities(base, mine, theirs);

  assert.equal(merged.conflicted, false);
  assert.match(merged.entity.content, /and a mathematician/);
  assert.match(merged.entity.content, /Follow up about the engine/);
});

test('tags added on both sides are kept, and a removal is honoured', () => {
  const base = note({ tags: ['maths', 'history'] });
  const mine = note({ tags: ['maths', 'history', 'mine'] });
  const theirs = note({ tags: ['maths', 'theirs'] });

  const merged = mergeEntities(base, mine, theirs);

  assert.deepEqual(merged.entity.tags.sort(), ['maths', 'mine', 'theirs']);
  assert.ok(!merged.entity.tags.includes('history'), 'removed by one side, not re-added');
});

test('a field changed on one side only takes that change', () => {
  const base = note({ email: 'old@example.com' });
  const mine = note({ email: 'old@example.com', company: 'Analytical Engines' });
  const theirs = note({ email: 'new@example.com' });

  const merged = mergeEntities(base, mine, theirs);

  assert.equal(merged.entity.email, 'new@example.com', 'their change to email');
  assert.equal(merged.entity.company, 'Analytical Engines', 'my new field');
  assert.equal(merged.conflicted, false);
});

test('a title changed differently on both sides is reported, not silently picked', () => {
  const merged = mergeEntities(
    note(),
    note({ title: 'Ada King' }),
    note({ title: 'Augusta Ada Byron' })
  );

  assert.equal(merged.conflicted, true);
  assert.ok(merged.conflicts.includes('title'));
  assert.equal(merged.entity.title, 'Ada King', 'the local side is kept so the editor sees their own work');
});

test('identity and origin never move', () => {
  const merged = mergeEntities(
    note(),
    note({ id: 'SHOULD-NOT-WIN', createdBy: 'human:impostor', createdAt: new Date('2020-01-01') }),
    note()
  );

  assert.equal(merged.entity.id, note().id);
  assert.equal(merged.entity.createdBy, 'human:andrei');
  assert.equal(merged.entity.createdAt.toISOString(), '2026-08-01T09:00:00.000Z');
});

test('a deletion beats a concurrent edit', () => {
  const deletedAt = new Date('2026-08-16T00:00:00Z');

  const theirsDeleted = mergeEntities(
    note(),
    note({ content: 'Still editing away.' }),
    note({ deletedAt })
  );
  assert.ok(theirsDeleted.entity.deletedAt, 'someone deciding it should go is the stronger statement');

  const mineDeleted = mergeEntities(
    note(),
    note({ deletedAt }),
    note({ content: 'Still editing away.' })
  );
  assert.ok(mineDeleted.entity.deletedAt);
});

test('the merged version is later than either side', () => {
  const merged = mergeEntities(
    note(),
    note({ updatedAt: new Date('2026-08-15T11:00:00Z') }),
    note({ updatedAt: new Date('2026-08-15T12:00:00Z') })
  );

  assert.equal(merged.entity.updatedAt.toISOString(), '2026-08-15T12:00:00.000Z');
});

test('an entity that has been through JSON still merges', () => {
  // The base is stored as JSON, so its dates come back as strings. Comparing
  // those against Dates would report a conflict where there is none.
  const base = JSON.parse(JSON.stringify(note()));
  base.createdAt = new Date(base.createdAt);
  base.updatedAt = new Date(base.updatedAt);

  const merged = mergeEntities(base, note({ content: 'Mine.' }), note());
  assert.equal(merged.conflicted, false);
  assert.equal(merged.entity.content, 'Mine.');
});
