// =============================================================================
// Unimem Analytics - Client Interface
// =============================================================================
//
// Deliberately small. Every surface (browser, Cloudflare Worker, Obsidian)
// implements this, and application code only ever sees this shape - so a
// component cannot reach past the contract into a raw PostHog handle.
// =============================================================================

import type { FeatureFlag, PersonProps, Surface, UnimemEvent } from './events.js';

/** Attached to every event by the adapter, not by call sites. */
export interface AnalyticsContext {
  surface: Surface;
  app_version: string;
  /** Coarse platform label. Never a full user-agent or OS build string. */
  platform?: 'macos' | 'windows' | 'linux' | 'ios' | 'android' | 'browser' | 'worker';
}

export interface AnalyticsClient {
  /** Fire-and-forget. Must never throw and never block the caller. */
  capture(event: UnimemEvent): void;

  /**
   * Record a navigation.
   *
   * Takes the *matched route pattern* (`/entities/[id]`), never the resolved
   * path - resolved paths carry entity IDs and, once slugs land, entity names.
   */
  capturePageview(routePattern: string): void;

  /** Associate subsequent events with a known user. No-op until auth exists. */
  identify(distinctId: string, props?: PersonProps): void;

  /** Synchronous flag read. Returns `false` when flags are unavailable. */
  isFeatureEnabled(flag: FeatureFlag): boolean;

  /** Drain the queue. Called on unload / before a Worker isolate is discarded. */
  flush(): Promise<void>;

  /** Forget the local identity. For opt-out and sign-out. */
  reset(): void;
}

export interface AnalyticsOptions {
  /** PostHog project API key. When absent, the no-op client is returned. */
  apiKey?: string;
  /** Ingestion host. Defaults to the app's same-origin reverse proxy. */
  host?: string;
  context: AnalyticsContext;
  /**
   * Throw on contract violations instead of dropping them. Enable in
   * development; leave off in production so telemetry never breaks the app.
   */
  strict?: boolean;
  /** Master switch. `false` produces the no-op client (opt-out, Obsidian default). */
  enabled?: boolean;
}

/**
 * The default everywhere a key is missing or the user has opted out.
 *
 * Returning a working object rather than `null` means call sites never need a
 * guard, so there is no branch that can accidentally be inverted.
 */
export function createNoopClient(): AnalyticsClient {
  return {
    capture() {},
    capturePageview() {},
    identify() {},
    isFeatureEnabled() {
      return false;
    },
    async flush() {},
    reset() {},
  };
}

/** True when a real client should be constructed. */
export function shouldEnable(options: AnalyticsOptions): boolean {
  return options.enabled !== false && Boolean(options.apiKey);
}
