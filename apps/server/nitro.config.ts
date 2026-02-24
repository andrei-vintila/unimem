import { fileURLToPath } from 'node:url';
import { defineNitroConfig } from 'nitro/config';

export default defineNitroConfig({
  // Cloudflare Workers preset
  preset: 'cloudflare-module',

  // Resolve ~ to the server source root so utils/ imports work with Rollup
  alias: {
    '~': fileURLToPath(new URL('.', import.meta.url)),
  },

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
