// =============================================================================
// Auto-property redaction regression tests
// =============================================================================
//
// Every case below was found by decompressing real posthog-js payloads against
// a local capture server. An earlier enumerated denylist passed review and
// still shipped three of them, which is why these are pinned.
// =============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldRedact, stripLocationAndTitle } from '../dist/index.js';

test('redacts every location/title property seen in live payloads', () => {
  const observed = [
    '$current_url',
    '$pathname',
    '$initial_current_url',
    '$initial_pathname',
    '$session_entry_url',
    '$session_entry_pathname',
    '$session_entry_host',
    '$session_entry_referrer',
    '$session_entry_referring_domain',
    '$host',
    '$referrer',
    '$referring_domain',
    '$initial_referrer',
    '$title',
    // $pageview sends this one WITHOUT the $ prefix - missed by the first pass.
    'title',
    '$raw_user_agent',
  ];

  for (const key of observed) {
    assert.equal(shouldRedact(key), true, `${key} must be redacted`);
  }
});

test('keeps the properties PostHog needs and we rely on', () => {
  const keep = [
    '$session_id',
    '$device_id',
    '$window_id',
    '$insert_id',
    '$time',
    '$lib',
    '$lib_version',
    '$browser',
    '$browser_version',
    '$os',
    '$os_version',
    '$device_type',
    '$screen_width',
    '$screen_height',
    '$timezone',
    // Our own catalog properties must never be caught by the pattern.
    'route',
    'surface',
    'app_version',
    'platform',
    'entity_type',
    'memory_layer',
    'result_count',
    'duration_ms',
    'direction',
    'entity_count',
  ];

  for (const key of keep) {
    assert.equal(shouldRedact(key), false, `${key} must survive`);
  }
});

test('strips a realistic pageview payload', () => {
  const props = {
    $current_url: 'http://localhost:3201/entities/9f3a-secret?q=SarahChen',
    $session_entry_url: 'http://localhost:3201/entities/9f3a-secret',
    $session_entry_pathname: '/entities/9f3a-secret',
    $host: 'localhost:3201',
    title: 'Sarah Chen - therapy notes',
    $raw_user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...',
    $session_id: 'sess-1',
    $browser: 'Chrome',
    route: '/entities/[id]',
    surface: 'web',
  };

  const result = stripLocationAndTitle({ ...props });

  assert.deepEqual(Object.keys(result).sort(), [
    '$browser',
    '$session_id',
    'route',
    'surface',
  ]);

  const serialized = JSON.stringify(result);
  for (const secret of ['SarahChen', 'Sarah Chen', '9f3a-secret', 'localhost:3201', 'Mozilla']) {
    assert.equal(serialized.includes(secret), false, `${secret} leaked`);
  }
});

test('route patterns survive but resolved paths never appear', () => {
  // We send the matched pattern, not the resolved path. The pattern contains
  // no user data, so it must not be redacted.
  assert.equal(shouldRedact('route'), false);
});
