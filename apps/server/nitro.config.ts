import { defineNitroConfig } from 'nitro/config';

export default defineNitroConfig({
  // Cloudflare Workers preset
  preset: 'cloudflare-module',

  compatibilityDate: '2026-08-09',

  // Experimental features
  experimental: {
    openAPI: true,
  },

  // Route rules
  routeRules: {
    '/api/**': {
      cors: true,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    },
  },

  // Runtime config
  runtimeConfig: {
    // Private keys (server-only)
    openaiApiKey: '',
    databaseUrl: '',

    appVersion: '0.1.0',

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
