import type { H3Event } from 'h3';
import { useRuntimeConfig } from 'nitro/runtime-config';
import { createEdgeAnalytics, hashDistinctId } from '@unimem/analytics/edge';
import type { UnimemEvent } from '@unimem/analytics';

// Re-exported so Nitro auto-imports it alongside `trackEvents` - routes
// classify errors without reaching into the package directly.
export { toErrorCode } from '@unimem/analytics';

/**
 * Record one or more events for the current request.
 *
 * Synchronous by design. The whole chain - hashing the actor, buffering, and
 * posting the batch - is wrapped in a single promise handed to
 * `event.waitUntil()`, so:
 *
 *   - the response is never blocked on PostHog,
 *   - the promise is never floating (the isolate stays alive until it settles),
 *   - and a route cannot forget to flush, because flushing is not its job.
 *
 * Pass every event for a request in one call; each call is a separate batch.
 *
 * `actorKey` is hashed before it leaves the Worker. Callers may pass an auth
 * token or a clientId - neither reaches PostHog in its original form.
 */
export function trackEvents(
  event: H3Event,
  actorKey: string,
  ...unimemEvents: UnimemEvent[]
): void {
  if (unimemEvents.length === 0) return;

  const config = useRuntimeConfig();

  if (!config.posthogKey) return;

  const work = (async () => {
    try {
      const analytics = createEdgeAnalytics({
        apiKey: config.posthogKey,
        host: config.posthogHost,
        distinctId: await hashDistinctId(actorKey),
        context: {
          surface: 'server',
          app_version: config.appVersion,
          platform: 'worker',
        },
      });

      for (const unimemEvent of unimemEvents) {
        analytics.capture(unimemEvent);
      }

      await analytics.flush();
    } catch (error) {
      // Telemetry must never surface as a request failure.
      console.error(
        JSON.stringify({
          message: 'trackEvents failed',
          error: error instanceof Error ? error.name : 'unknown',
        })
      );
    }
  })();

  event.waitUntil(work);
}
