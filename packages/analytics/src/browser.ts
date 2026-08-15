// =============================================================================
// Unimem Analytics - Browser Adapter (web + desktop webview)
// =============================================================================

import posthog, { type PostHog, type Properties } from 'posthog-js';

import {
  createNoopClient,
  shouldEnable,
  type AnalyticsClient,
  type AnalyticsOptions,
} from './client.js';
import type { FeatureFlag, PersonProps, UnimemEvent } from './events.js';
import { sanitizeEvent } from './sanitize.js';
import { stripLocationAndTitle } from './redact.js';

export interface BrowserAnalyticsOptions extends AnalyticsOptions {
  /**
   * Where PostHog's own UI lives, used only for the toolbar link. Distinct
   * from `host`, which is our same-origin ingestion proxy.
   */
  uiHost?: string;
  /**
   * The desktop shell serves the app from a custom scheme, where cookie
   * handling is inconsistent across platforms, so it pins localStorage.
   * Browsers keep the default.
   */
  persistence?: 'localStorage+cookie' | 'localStorage' | 'memory';
}

// Redaction lives in ./redact.js so it can be unit-tested without loading the
// browser SDK. See that module for why it is pattern-based.

export function createBrowserAnalytics(
  options: BrowserAnalyticsOptions
): AnalyticsClient {
  if (typeof window === 'undefined' || !shouldEnable(options)) {
    return createNoopClient();
  }

  const { apiKey, host = '/_ph', uiHost, context, strict = false, persistence } = options;

  let instance: PostHog | undefined;

  try {
    instance =
      posthog.init(apiKey!, {
        api_host: host,
        ui_host: uiHost,

        // Spread rather than pass directly: an explicit `undefined` would
        // override posthog-js's own default instead of deferring to it.
        ...(persistence ? { persistence } : {}),

        // Autocapture reads DOM text. In a notes app the DOM *is* the notes.
        autocapture: false,

        // Session replay would record note content verbatim.
        disable_session_recording: true,

        // Routing is client-side and paths carry entity IDs; we emit these by hand.
        capture_pageview: false,
        capture_pageleave: false,

        // Anonymous users cost money and tell us nothing until accounts exist.
        person_profiles: 'identified_only',

        // Defense in depth behind the catalog's own sanitizer.
        sanitize_properties: stripLocationAndTitle,

        // Masks personal-data properties on captured events. Note: verified
        // against a local capture server that this does NOT cover the
        // feature-flag request - see `advanced_disable_flags` below.
        mask_personal_data_properties: true,

        // The flags request (POST /flags/) sends `person_properties` on a path
        // that neither `sanitize_properties` nor
        // `mask_personal_data_properties` touches, and it includes
        // `$initial_current_url` and `$initial_pathname` verbatim. Once
        // /entities/[id] routes exist those are note identifiers, so the
        // request is disabled outright.
        //
        // Confirmed empirically with cleared storage: masking alone still sent
        // the full URL; only disabling stops it. Nothing depends on client-side
        // flags today. When flags are needed, evaluate them server-side and
        // bootstrap the result rather than re-enabling this.
        advanced_disable_flags: true,

        // Respect the browser signal; the settings-level opt-out is separate.
        respect_dnt: true,

        loaded: (ph) => {
          ph.register({
            surface: context.surface,
            app_version: context.app_version,
            ...(context.platform ? { platform: context.platform } : {}),
          });
        },
      }) ?? undefined;
  } catch (error) {
    if (strict) throw error;
    return createNoopClient();
  }

  if (!instance) {
    return createNoopClient();
  }

  const ph = instance;

  /** Telemetry must never take the app down with it. */
  function guard(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      if (strict) throw error;
      // Intentionally swallowed in production.
    }
  }

  return {
    capture(event: UnimemEvent) {
      guard(() => {
        ph.capture(event.name, sanitizeEvent(event, strict));
      });
    },

    capturePageview(routePattern: string) {
      guard(() => {
        ph.capture('$pageview', { route: routePattern });
      });
    },

    identify(distinctId: string, props?: PersonProps) {
      guard(() => {
        ph.identify(distinctId, props as Properties | undefined);
      });
    },

    /**
     * Always false: the flags request is disabled (see `advanced_disable_flags`).
     * Kept on the interface so Phase 4 can swap in bootstrapped, server-evaluated
     * flags without touching call sites.
     */
    isFeatureEnabled(_flag: FeatureFlag) {
      return false;
    },

    async flush() {
      // posthog-js batches internally and flushes on pagehide; there is no
      // public drain hook, so this resolves immediately by design.
    },

    reset() {
      guard(() => ph.reset());
    },
  };
}
