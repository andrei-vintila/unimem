import { createNoopClient, type AnalyticsClient } from '@unimem/analytics';

/**
 * Access the analytics client.
 *
 * Falls back to the no-op client during SSR and anywhere the Nuxt context is
 * unavailable, so call sites never need a null check and instrumentation can
 * never be the thing that breaks a render.
 */
export function useAnalytics(): AnalyticsClient {
  try {
    const { $analytics } = useNuxtApp();
    return ($analytics as AnalyticsClient | undefined) ?? createNoopClient();
  } catch {
    return createNoopClient();
  }
}
