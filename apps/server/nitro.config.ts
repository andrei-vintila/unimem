import { defineNitroConfig } from 'nitropack/config';

export default defineNitroConfig({
  // Cloudflare Workers preset
  preset: 'cloudflare-module',

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
  srcDir: '.',

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
