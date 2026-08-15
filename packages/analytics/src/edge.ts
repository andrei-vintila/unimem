// =============================================================================
// Unimem Analytics - Edge Adapter (Cloudflare Workers)
// =============================================================================
//
// Why not `posthog-node`: its queue drains on a background timer, which assumes
// a long-lived process. A Workers isolate is frozen between requests and may be
// discarded at any point, so timer-driven flushes are silently dropped. This
// adapter instead buffers within a single request and hands one promise to
// `event.waitUntil()`, which is the only mechanism the runtime guarantees.
//
// State lives in the closure, never at module scope. Isolates are reused across
// requests, so a module-level buffer would leak one client's events into
// another client's request.
// =============================================================================

import {
  createNoopClient,
  shouldEnable,
  type AnalyticsClient,
  type AnalyticsOptions,
} from './client.js';
import type { FeatureFlag, PersonProps, UnimemEvent } from './events.js';
import { sanitizeEvent } from './sanitize.js';

export interface EdgeAnalyticsOptions extends AnalyticsOptions {
  /** Full ingestion origin, e.g. `https://eu.i.posthog.com`. No proxy server-side. */
  host?: string;
  /**
   * Pseudonymous actor for this request. Callers must pass a hashed value -
   * see `hashDistinctId`. Raw auth tokens must never appear here.
   */
  distinctId: string;
}

const DEFAULT_HOST = 'https://eu.i.posthog.com';

/** Guard against an unbounded buffer if a handler loops over capture. */
const MAX_BATCH = 50;

interface BatchItem {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

/**
 * Derive a stable pseudonymous id from a client token or client id.
 *
 * The raw value is a credential in the auth-token case and user-controlled in
 * the clientId case; neither belongs in an analytics payload. SHA-256 gives a
 * stable identifier across requests without carrying the original.
 */
export async function hashDistinctId(value: string, salt = 'unimem'): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${value}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface EdgeAnalyticsClient extends AnalyticsClient {
  /**
   * Resolves once the batch has been posted. Pass this to `event.waitUntil()`;
   * a bare call would be a floating promise and the isolate may be discarded
   * before the request completes.
   */
  flush(): Promise<void>;
}

export function createEdgeAnalytics(
  options: EdgeAnalyticsOptions
): EdgeAnalyticsClient {
  if (!shouldEnable(options)) {
    return createNoopClient();
  }

  const {
    apiKey,
    host = DEFAULT_HOST,
    context,
    strict = false,
    distinctId,
  } = options;

  // Request-scoped: one buffer per client instance, never shared.
  const batch: BatchItem[] = [];

  const superProperties = {
    surface: context.surface,
    app_version: context.app_version,
    ...(context.platform ? { platform: context.platform } : {}),
  };

  return {
    capture(event: UnimemEvent) {
      if (batch.length >= MAX_BATCH) return;

      try {
        batch.push({
          event: event.name,
          distinct_id: distinctId,
          properties: { ...sanitizeEvent(event, strict), ...superProperties },
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        if (strict) throw error;
      }
    },

    // Pageviews are a browser concept; there is nothing to record here.
    capturePageview() {},

    // Server-side identity is the hashed distinct id passed at construction.
    // A separate identify call would only re-assert it.
    identify() {},

    // Flags need a decide() round trip we deliberately do not make on the
    // request path. Server-side flags land in Phase 4 with a cached payload.
    isFeatureEnabled(_flag: FeatureFlag) {
      return false;
    },

    async flush() {
      if (batch.length === 0) return;

      const payload = { api_key: apiKey, batch: batch.splice(0, batch.length) };

      try {
        const response = await fetch(`${host}/batch/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          // Structured so it is filterable in Workers Logs.
          console.error(
            JSON.stringify({
              message: 'analytics batch rejected',
              status: response.status,
              count: payload.batch.length,
            })
          );
        }

        // Drain the body so the connection can be reused. The response is a
        // small ack, so this is bounded.
        await response.arrayBuffer();
      } catch (error) {
        console.error(
          JSON.stringify({
            message: 'analytics batch failed',
            error: error instanceof Error ? error.name : 'unknown',
          })
        );
        if (strict) throw error;
      }
    },

    reset() {
      batch.length = 0;
    },
  };
}

// Present so `PersonProps` stays part of the adapter's public surface for
// callers that pre-build person properties.
export type { PersonProps };
