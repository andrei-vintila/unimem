// =============================================================================
// DOCOWNERS
// =============================================================================
//
// The policy that decides whether one person may change another's notes. As
// with authz, a failure here is a security hole rather than a bug - and the
// resolution rules are the part most likely to be subtly wrong, because
// "which pattern wins" is where every ACL system goes astray.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ownersOf,
  parseDocowners,
  patternMatches,
  policyAllows,
  specificity,
} from '../.test-dist/utils/docowners.js';

const allows = (source, actor, access, path) =>
  policyAllows(parseDocowners(source), actor, access, path);

// -----------------------------------------------------------------------------
// CODEOWNERS compatibility
// -----------------------------------------------------------------------------

test('a plain CODEOWNERS file is a valid policy', () => {
  const codeowners = `
# Standard CODEOWNERS syntax, no verbs anywhere.
*                    @andrei
/project/            @sam @andrei
/person/             @andrei
`;

  assert.ok(allows(codeowners, 'human:sam', 'write', 'project/roadmap.md'));
  assert.equal(allows(codeowners, 'human:sam', 'write', 'person/ada.md'), false);
  assert.ok(allows(codeowners, 'human:andrei', 'write', 'person/ada.md'));
});

test('a bare line means write, and write implies read', () => {
  const policy = '/project/   @sam';

  assert.ok(allows(policy, 'human:sam', 'write', 'project/a.md'));
  assert.ok(
    allows(policy, 'human:sam', 'read', 'project/a.md'),
    'nobody should edit what they cannot see'
  );
});

test('@name and human:name are the same person', () => {
  assert.ok(allows('/task/ @sam', 'human:sam', 'write', 'task/a.md'));
  assert.ok(allows('/task/ human:sam', 'human:sam', 'write', 'task/a.md'));
  assert.ok(
    allows('/task/ agent:summariser/v1', 'agent:summariser/v1', 'write', 'task/a.md'),
    'an actor that is already qualified is left alone'
  );
});

// -----------------------------------------------------------------------------
// The extra axis
// -----------------------------------------------------------------------------

test('read can be granted without write', () => {
  const policy = `
write  /task/     @sam
read   /person/   @sam
`;

  assert.ok(allows(policy, 'human:sam', 'read', 'person/ada.md'));
  assert.equal(
    allows(policy, 'human:sam', 'write', 'person/ada.md'),
    false,
    'reading is not editing'
  );
  assert.equal(allows(policy, 'human:sam', 'read', 'project/x.md'), false);
});

// -----------------------------------------------------------------------------
// Resolution
// -----------------------------------------------------------------------------

test('the most specific pattern wins, not the last one', () => {
  // Written in the order that trips GitHub's last-match rule: the broad grant
  // comes second, and must not undo the narrow one above it.
  const policy = `
/project/internal/   @andrei
/project/            @sam @andrei
`;

  assert.ok(allows(policy, 'human:sam', 'write', 'project/roadmap.md'));
  assert.equal(
    allows(policy, 'human:sam', 'write', 'project/internal/salaries.md'),
    false,
    'the narrower rule governs its own folder'
  );
  assert.ok(allows(policy, 'human:andrei', 'write', 'project/internal/salaries.md'));
});

test('a literal beats a wildcard at the same depth', () => {
  assert.ok(specificity('/project/notes.md') > specificity('/project/*'));
  assert.ok(specificity('/project/internal/') > specificity('/project/'));
  assert.equal(specificity('*'), 0, 'a catch-all is the weakest thing there is');
});

test('a catch-all does not override anything narrower', () => {
  const policy = `
*             @everyone
/finance/     @andrei
`;

  assert.ok(allows(policy, 'human:everyone', 'write', 'person/ada.md'));
  assert.equal(allows(policy, 'human:everyone', 'write', 'finance/q3.md'), false);
});

test('* as an actor means anyone', () => {
  assert.ok(allows('read /project/ *', 'human:anybody', 'read', 'project/a.md'));
});

// -----------------------------------------------------------------------------
// Matching
// -----------------------------------------------------------------------------

test('a folder covers what is under it and nothing beside it', () => {
  assert.ok(patternMatches('/project/', 'project/a.md'));
  assert.ok(patternMatches('/project/', 'project/internal/a.md'));

  // The one a naive prefix check gets wrong.
  assert.equal(patternMatches('/project/', 'project-secrets/a.md'), false);
  assert.equal(patternMatches('/project/', 'person/a.md'), false);
});

test('wildcards behave the way a shell would suggest', () => {
  assert.ok(patternMatches('/project/*.md', 'project/a.md'));
  assert.equal(
    patternMatches('/project/*.md', 'project/internal/a.md'),
    false,
    'a single star stays within one segment'
  );

  assert.ok(patternMatches('/project/**/*.md', 'project/internal/a.md'));
  assert.ok(patternMatches('/project/**', 'project/internal/deep/a.md'));
});

test('a leading slash is optional', () => {
  assert.ok(patternMatches('project/', 'project/a.md'));
  assert.ok(patternMatches('/project/', 'project/a.md'));
});

// -----------------------------------------------------------------------------
// Parsing
// -----------------------------------------------------------------------------

test('comments and blank lines are ignored', () => {
  const policy = parseDocowners(`
# Who owns what.

/project/   @sam      # trailing comments too

`);

  assert.equal(policy.rules.length, 1);
  assert.deepEqual(policy.rules[0].actors, ['human:sam']);
  assert.deepEqual(policy.problems, []);
});

test('one bad line does not take the rest of the policy with it', () => {
  const policy = parseDocowners(`
/project/       @sam
/broken/
../escape/      @attacker
/task/          @kit
`);

  assert.equal(policy.rules.length, 2, 'the good rules still stand');
  assert.equal(policy.problems.length, 2);
  assert.match(policy.problems[0].reason, /actors/i);
  assert.match(policy.problems[1].reason, /\.\./);

  // And a rule that failed to parse grants nothing.
  assert.equal(policyAllows(policy, 'human:attacker', 'write', 'person/ada.md'), false);
});

test('nothing matching means no access', () => {
  assert.equal(allows('/project/ @sam', 'human:sam', 'write', 'person/ada.md'), false);
  assert.equal(allows('', 'human:sam', 'write', 'anything.md'), false);
});

// -----------------------------------------------------------------------------
// Routing a change request
// -----------------------------------------------------------------------------

test('owners of a path are who a change request goes to', () => {
  const policy = parseDocowners(`
/project/            @sam @andrei
/project/internal/   @andrei
`);

  assert.deepEqual(ownersOf(policy, 'project/roadmap.md').sort(), [
    'human:andrei',
    'human:sam',
  ]);
  assert.deepEqual(ownersOf(policy, 'project/internal/salaries.md'), ['human:andrei']);
  assert.deepEqual(ownersOf(policy, 'person/ada.md'), [], 'nobody owns it yet');
});
