// =============================================================================
// Unimem Analytics - Error Classification
// =============================================================================
//
// Maps a thrown value to a bounded `ErrorCode`. The message itself is read for
// classification and then discarded - it is never returned, never captured,
// and never stored. Error messages in this codebase routinely contain vault
// paths and entity titles.
// =============================================================================

import type { ErrorCode } from './events.js';

const PATTERNS: ReadonlyArray<[RegExp, ErrorCode]> = [
  [/quota|exceeded the quota|storage full/i, 'storage-quota'],
  [/indexeddb|pglite|opfs|failed to open database|migration/i, 'storage-init'],
  [/vector|pgvector|embedding dimension/i, 'vector-unavailable'],
  [/openai|embedding provider|api key/i, 'embedding-provider'],
  [/abort|timed? ?out|deadline/i, 'timeout'],
  [/401|403|unauthor|forbidden|token/i, 'auth'],
  [/429|rate.?limit|too many requests/i, 'rate-limited'],
  [/conflict|409|version mismatch/i, 'conflict'],
  [/network|fetch failed|econnrefused|dns|offline/i, 'network'],
];

/**
 * Classify an error for telemetry.
 *
 * Always returns a member of the closed `ErrorCode` set; unrecognised errors
 * become `'unknown'` rather than leaking their text.
 */
export function toErrorCode(error: unknown): ErrorCode {
  const haystack =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === 'string'
        ? error
        : '';

  if (!haystack) return 'unknown';

  for (const [pattern, code] of PATTERNS) {
    if (pattern.test(haystack)) return code;
  }

  return 'unknown';
}
