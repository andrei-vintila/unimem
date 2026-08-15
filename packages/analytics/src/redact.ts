// =============================================================================
// Unimem Analytics - Auto-Property Redaction
// =============================================================================
//
// PostHog's browser SDK attaches location and title properties to every event
// under a number of different names. In a notes app each of them is user data:
// a route resolves to `/entities/<id>` and the document title is the entity's
// own name.
//
// Kept in its own module (no SDK import) so it is directly testable.
// =============================================================================

/**
 * Matches the *family* of a property name rather than a fixed list.
 *
 * An enumerated denylist was tried first and missed three real cases found by
 * inspecting live payloads: `$session_entry_url`, `$session_entry_pathname`,
 * and the un-prefixed `title` that `$pageview` sends. Matching on shape means
 * new SDK properties in the same families are redacted without a code change.
 */
export const REDACTED_PATTERN =
  /(^|_)(url|pathname|path|host|referrer|referring_domain|title)$/i;

/**
 * Not note content, but a full user-agent string is fingerprinting data we
 * have no use for. The coarse `$browser` / `$os` properties survive.
 */
export const REDACTED_EXACT = new Set(['$raw_user_agent']);

/** Matches the pattern but is required by PostHog. Empty today; kept explicit. */
export const REDACTION_EXEMPT = new Set<string>([]);

export function shouldRedact(key: string): boolean {
  if (REDACTION_EXEMPT.has(key)) return false;
  if (REDACTED_EXACT.has(key)) return true;

  const bare = key.startsWith('$') ? key.slice(1) : key;
  return REDACTED_PATTERN.test(bare);
}

/**
 * Mutates and returns `properties`, matching the signature PostHog's
 * `sanitize_properties` hook expects.
 */
export function stripLocationAndTitle<T extends Record<string, unknown>>(
  properties: T
): T {
  for (const key of Object.keys(properties)) {
    if (shouldRedact(key)) {
      delete properties[key];
    }
  }
  return properties;
}
