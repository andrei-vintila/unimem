// =============================================================================
// Unimem Analytics - Property Sanitizer
// =============================================================================
//
// The type system stops accidents at compile time. This module stops them at
// runtime, for the cases types cannot reach: `any` at a call site, a value
// widened through JSON, a property added to an object literal by spread.
//
// The rule is allowlist, not denylist. A property that is not declared below
// never reaches the network, regardless of what the caller passed.
// =============================================================================

import type { UnimemEvent, UnimemEventName } from './events.js';

/**
 * Requires one entry per event, and each listed key must actually be a key of
 * that event's properties. Adding an event without an allowlist entry is a
 * compile error; listing a key that does not exist is a compile error.
 *
 * Omitting a key is allowed and fails safe - the property is simply stripped.
 */
type PropertyAllowlist = {
  [E in UnimemEvent as E['name']]: readonly (keyof E['properties'])[];
};

export const EVENT_PROPERTIES = {
  app_installed: ['version'],
  session_started: ['days_since_install'],
  memory_initialized: ['duration_ms', 'success', 'error_code'],
  entity_created: ['entity_type', 'memory_layer', 'creation_method'],
  search_performed: ['result_count', 'duration_ms', 'has_results', 'search_type'],
  consolidation_run: ['entities_processed', 'duration_ms', 'trigger'],
  embedding_requested: ['text_count', 'duration_ms', 'success', 'error_code'],
  sync_started: ['direction', 'entity_count'],
  sync_completed: ['direction', 'entity_count', 'duration_ms', 'conflict_count'],
  sync_failed: ['direction', 'error_code', 'stage'],
  feature_used: ['feature'],
  setting_changed: ['setting_key', 'new_value', 'is_default'],
} as const satisfies PropertyAllowlist;

/**
 * Values longer than this are dropped. Every legitimate string in the catalog
 * is an enum member or a semver string; anything longer is a bug or a leak.
 */
const MAX_STRING_LENGTH = 64;

export type SanitizedProperties = Record<string, string | number | boolean | null>;

export class AnalyticsContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalyticsContractError';
  }
}

/**
 * Scalars only. Objects and arrays are rejected outright - nested structures
 * are how note content would smuggle itself into a payload.
 */
function sanitizeValue(
  eventName: string,
  key: string,
  value: unknown,
  strict: boolean
): string | number | boolean | null | undefined {
  if (value === null || value === undefined) return null;

  switch (typeof value) {
    case 'boolean':
      return value;

    case 'number':
      if (!Number.isFinite(value)) {
        return reject(eventName, key, 'non-finite number', strict);
      }
      return value;

    case 'string':
      if (value.length > MAX_STRING_LENGTH) {
        return reject(
          eventName,
          key,
          `string exceeds ${MAX_STRING_LENGTH} chars (got ${value.length}) - user content?`,
          strict
        );
      }
      return value;

    default:
      return reject(eventName, key, `unsupported type "${typeof value}"`, strict);
  }
}

function reject(
  eventName: string,
  key: string,
  reason: string,
  strict: boolean
): undefined {
  const message = `[unimem/analytics] dropped ${eventName}.${key}: ${reason}`;
  if (strict) {
    throw new AnalyticsContractError(message);
  }
  // Production: drop silently rather than break the app for a telemetry bug.
  return undefined;
}

/**
 * Reduce an event to the properties its catalog entry permits.
 *
 * @param strict When true (development), contract violations throw so they are
 *   caught before shipping. In production, offending properties are dropped.
 */
export function sanitizeEvent(
  event: UnimemEvent,
  strict = false
): SanitizedProperties {
  const allowed = EVENT_PROPERTIES[event.name] as readonly string[] | undefined;

  if (!allowed) {
    if (strict) {
      throw new AnalyticsContractError(
        `[unimem/analytics] unknown event "${event.name}" - add it to EVENT_PROPERTIES`
      );
    }
    return {};
  }

  const source = (event.properties ?? {}) as Record<string, unknown>;

  if (strict) {
    const undeclared = Object.keys(source).filter((k) => !allowed.includes(k));
    if (undeclared.length > 0) {
      throw new AnalyticsContractError(
        `[unimem/analytics] ${event.name} carries undeclared properties: ${undeclared.join(', ')}`
      );
    }
  }

  const result: SanitizedProperties = {};

  for (const key of allowed) {
    if (!(key in source)) continue;
    const value = sanitizeValue(event.name, key, source[key], strict);
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

/** Exposed for tests and for the docs generator that produces PRIVACY.md. */
export function listEventNames(): UnimemEventName[] {
  return Object.keys(EVENT_PROPERTIES) as UnimemEventName[];
}
