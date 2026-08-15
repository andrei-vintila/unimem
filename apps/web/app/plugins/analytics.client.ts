import { createBrowserAnalytics } from '@unimem/analytics/browser';
import type { AnalyticsClient, AnalyticsContext } from '@unimem/analytics';

const INSTALLED_AT_KEY = 'unimem:installed_at';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The desktop app is this same Nuxt bundle loaded by the Electron shell (see
 * apps/desktop), so the surface has to be resolved at runtime rather than at
 * build time. `window.unimem` is injected by the shell's preload script.
 */
function desktopBridge(): UnimemDesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.unimem;
}

/**
 * Coarse OS label, reported by the shell rather than sniffed from the
 * user-agent - inside Electron the UA is Chrome's and says nothing we should
 * be guessing from.
 */
function detectPlatform(
  bridge: UnimemDesktopBridge | undefined
): AnalyticsContext['platform'] {
  return bridge ? bridge.platform : 'browser';
}

/**
 * First run for this browser profile, and how long ago it was.
 *
 * Returns `null` for `daysSinceInstall` when storage is unavailable (private
 * mode, blocked storage) rather than guessing zero and inflating new-user counts.
 */
function readInstallState(): { isFirstRun: boolean; daysSinceInstall: number | null } {
  try {
    const existing = window.localStorage.getItem(INSTALLED_AT_KEY);

    if (!existing) {
      window.localStorage.setItem(INSTALLED_AT_KEY, String(Date.now()));
      return { isFirstRun: true, daysSinceInstall: 0 };
    }

    const installedAt = Number(existing);
    if (!Number.isFinite(installedAt)) {
      return { isFirstRun: false, daysSinceInstall: null };
    }

    return {
      isFirstRun: false,
      daysSinceInstall: Math.floor((Date.now() - installedAt) / DAY_MS),
    };
  } catch {
    return { isFirstRun: false, daysSinceInstall: null };
  }
}

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig();

  const bridge = desktopBridge();
  const desktop = bridge !== undefined;

  const analytics: AnalyticsClient = createBrowserAnalytics({
    apiKey: config.public.posthogKey,

    // The `/_ph` proxy is served by Nitro. The desktop build is `nuxt generate`
    // output loaded from an app:// origin, where no such server exists - so it
    // must talk to PostHog directly (the shell's CSP allows exactly that host).
    // There is also no content blocker inside the shell, which is the only
    // reason the proxy exists on web.
    host: desktop ? config.public.posthogDirectHost : config.public.posthogHost,

    uiHost: config.public.posthogUiHost,

    // Cookies on a custom-scheme origin are inconsistent across platforms, so
    // the desktop app pins localStorage.
    persistence: desktop ? 'localStorage' : undefined,

    strict: import.meta.dev,
    context: {
      // The shell knows its own version; the runtime config's copy is the web
      // app's, and the two drift once the desktop app ships on its own cadence.
      surface: desktop ? 'desktop' : 'web',
      app_version: bridge?.appVersion ?? config.public.appVersion,
      platform: detectPlatform(bridge),
    },
  });

  const { isFirstRun, daysSinceInstall } = readInstallState();

  if (isFirstRun) {
    analytics.capture({
      name: 'app_installed',
      properties: { version: bridge?.appVersion ?? config.public.appVersion },
    });
  }

  if (daysSinceInstall !== null) {
    analytics.capture({
      name: 'session_started',
      properties: { days_since_install: daysSinceInstall },
    });
  }

  // Pageviews by matched route pattern only. `to.path` would resolve to
  // /entities/<id>, and the id identifies a specific note.
  //
  // Whether `afterEach` fires for the initial navigation depends on how the
  // page was entered (hydration vs. client-side nav), so we emit on mount as
  // well and dedupe - double-counted landings would skew every funnel built
  // on top of this.
  let lastPattern: string | null = null;

  function sendPageview(pattern: string) {
    if (pattern === lastPattern) return;
    lastPattern = pattern;
    analytics.capturePageview(pattern);
  }

  const router = useRouter();
  router.afterEach((to) => {
    sendPageview(to.matched.at(-1)?.path ?? to.name?.toString() ?? '/');
  });

  nuxtApp.hook('app:beforeMount', () => {
    sendPageview(router.currentRoute.value.matched.at(-1)?.path ?? '/');
  });

  return {
    provide: { analytics },
  };
});
