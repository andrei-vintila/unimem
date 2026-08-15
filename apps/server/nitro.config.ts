import { defineNitroConfig } from 'nitro/config';

export default defineNitroConfig({
  // Cloudflare Workers preset
  preset: 'cloudflare-module',

  compatibilityDate: '2026-08-09',

  // Experimental features
  experimental: {
    openAPI: true,
  },

  // CORS lives in middleware/cors.ts rather than here: route rules attach
  // headers to a handler's response, which is too late for the OPTIONS
  // preflight that a bearer token forces the browser to send.

  // The `sync` namespace holds every vault. Without an explicit driver it
  // defaults to memory, which for a sync server means the vaults survive only
  // as long as the process - or, on Workers, as long as an isolate.
  //
  // KV is eventually consistent: a push is visible immediately in the region
  // that wrote it and globally within about a minute. That is within tolerance
  // here because the pull cursor only ever moves forward - a device that
  // misses a change reads it on the next cycle rather than losing it.
  storage: {
    sync: {
      driver: 'cloudflare-kv-binding',
      binding: 'SYNC_KV',
    },
  },

  // Dev has no KV binding. Write to disk rather than memory so restarting the
  // dev server does not silently empty every vault mid-session.
  devStorage: {
    sync: {
      driver: 'fs',
      base: './.data/sync',
    },
  },

  // Runtime config
  runtimeConfig: {
    // Private keys (server-only)
    openaiApiKey: '',
    databaseUrl: '',

    appVersion: '0.1.0',

    // Comma-separated allowlist of accepted sync tokens. Empty means any token
    // opens its own isolated vault - see utils/auth.ts. Set in production with:
    //   wrangler secret put NITRO_SYNC_TOKENS
    syncTokens: '',

    // Analytics. Set in production with:
    //   wrangler secret put NITRO_POSTHOG_KEY
    // Empty key => no client is constructed and nothing is sent.
    posthogKey: '',
    // Direct origin, not the web app's /_ph proxy - there is no ad blocker
    // between a Worker and PostHog, and the extra hop would only add latency.
    posthogHost: 'https://eu.i.posthog.com',

    // Public keys (can be used by sync clients)
    public: {
      syncEnabled: true,
    },
  },

  // Source directory
  serverDir: '.',

  // Cloudflare specific configuration
  cloudflare: {
    pages: {
      routes: {
        include: ['/*'],
        exclude: ['/static/*'],
      },
    },
  },
});
