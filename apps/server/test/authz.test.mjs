// =============================================================================
// Who may write where
// =============================================================================
//
// These are the rules that decide whether one person in a shared vault can
// change another's notes. Everything here is a bypass someone could try, so a
// failure in this file is a security hole rather than a bug.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decideWrite, grantCovers, resolvePath } from '../.test-dist/utils/authz.js';

function member(write, overrides = {}) {
  return {
    vaultId: '0'.repeat(32),
    actor: 'human:sam',
    role: 'member',
    write,
    createdAt: '2026-08-16T00:00:00.000Z',
    ...overrides,
  };
}

function entity(type = 'project') {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    type,
    memoryLayer: 'episodic',
    title: 'Sync Engine',
    content: '',
    links: [],
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// -----------------------------------------------------------------------------

test('a folder grant covers what is under it and nothing beside it', () => {
  assert.ok(grantCovers('project/', 'project/sync-engine.md'));
  assert.ok(grantCovers('project/', 'project/internal/secret.md'));

  // The one a naive startsWith gets wrong.
  assert.equal(grantCovers('project/', 'project-secrets/x.md'), false);
  assert.equal(grantCovers('project/', 'person/ada.md'), false);
});

test('an empty grant is the whole vault', () => {
  assert.ok(grantCovers('', 'anything/at/all.md'));
  assert.ok(grantCovers('*', 'anything/at/all.md'));
});

test('a grant naming one document covers only that document', () => {
  assert.ok(grantCovers('project/sync-engine.md', 'project/sync-engine.md'));
  assert.equal(grantCovers('project/sync-engine.md', 'project/other.md'), false);
});

// -----------------------------------------------------------------------------

test('the first path segment is the entity type, not the client claim', () => {
  // The bypass: a member scoped to project/ pushing a person and filing it
  // under project/ to slip past the grant.
  assert.equal(resolvePath(entity('person'), 'project/disguised.md'), null);

  assert.equal(
    resolvePath(entity('project'), 'project/sync-engine.md'),
    'project/sync-engine.md'
  );
});

test('traversal and absolute paths are refused', () => {
  assert.equal(resolvePath(entity(), 'project/../person/escape.md'), null);
  assert.equal(resolvePath(entity(), '../../etc/passwd'), null);
  assert.equal(resolvePath(entity(), 'project\\windows.md'), null);

  // A leading slash is stripped rather than refused - it is a formatting
  // difference, not an escape, once the first segment still has to match.
  assert.equal(resolvePath(entity(), '/project/x.md'), 'project/x.md');
});

test('a document with no claimed path is scoped to its own folder', () => {
  assert.equal(resolvePath(entity('task'), undefined), 'task/');
  assert.equal(resolvePath(entity('task'), ''), 'task/');
});

// -----------------------------------------------------------------------------

test('a member may write inside their folder and not outside it', () => {
  const sam = member(['project/']);

  assert.deepEqual(
    decideWrite({ member: sam, entity: entity('project'), claimedPath: 'project/a.md' }),
    { allowed: true, path: 'project/a.md' }
  );

  const refused = decideWrite({
    member: sam,
    entity: entity('person'),
    claimedPath: 'person/ada.md',
  });
  assert.equal(refused.allowed, false);
  assert.match(refused.reason, /person\//);
});

test('a document cannot be laundered out of a folder the member cannot write', () => {
  const pub = member(['project/public/']);

  // It currently lives somewhere they have no access to. Pushing it back under
  // a path they *can* write must not move it.
  const refused = decideWrite({
    member: pub,
    entity: entity('project'),
    claimedPath: 'project/public/leaked.md',
    stored: { path: 'project/internal/secret.md' },
  });

  assert.equal(refused.allowed, false);
  assert.match(refused.reason, /project\/internal\//);
});

test('a creator keeps access to their own note when grants change', () => {
  // Sam wrote this while scoped to project/; his grants have since narrowed.
  const narrowed = member(['task/']);

  const allowed = decideWrite({
    member: narrowed,
    entity: entity('project'),
    claimedPath: 'project/mine.md',
    stored: { path: 'project/mine.md', createdBy: 'human:sam' },
  });

  assert.equal(allowed.allowed, true, 'a person does not lose their own notes');
});

test('being the creator does not let you move a note somewhere new', () => {
  // Creator access covers the document where it is, not a folder the member
  // was never granted - otherwise it would be an escalation path.
  const narrowed = member(['task/']);

  const decision = decideWrite({
    member: narrowed,
    entity: entity('person'),
    claimedPath: 'person/ada.md',
    stored: { path: 'person/ada.md', createdBy: 'human:someone-else' },
  });

  assert.equal(decision.allowed, false);
});

test('an owner writes anywhere', () => {
  const owner = member([''], { actor: 'human:owner', role: 'owner' });

  for (const type of ['person', 'project', 'task', 'area']) {
    const decision = decideWrite({
      member: owner,
      entity: entity(type),
      claimedPath: `${type}/x.md`,
    });
    assert.equal(decision.allowed, true, `owner should write ${type}`);
  }
});

test('a member with no grants writes nothing', () => {
  const reader = member([]);

  const decision = decideWrite({
    member: reader,
    entity: entity('project'),
    claimedPath: 'project/a.md',
  });

  assert.equal(decision.allowed, false);
});
