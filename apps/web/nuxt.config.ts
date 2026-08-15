// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },

  modules: [
    '@pinia/nuxt',
    '@nuxtjs/tailwindcss',
    '@vueuse/nuxt',
  ],

  future: {
    compatibilityVersion: 4,
  },

  compatibilityDate: '2024-12-01',

  // App configuration
  app: {
    head: {
      title: 'Unimem - Neural Memory',
      meta: [
        { name: 'description', content: 'Neural memory architecture for knowledge management' },
      ],
    },
  },

  // TypeScript configuration
  typescript: {
    strict: true,
  },

  // Tailwind configuration
  tailwindcss: {
    cssPath: '~/assets/css/tailwind.css',
  },

  // Runtime config
  runtimeConfig: {
    // Private keys (server-only)
    openaiApiKey: '',

    // Public keys (exposed to client)
    public: {
      appName: 'Unimem',
      appVersion: process.env.npm_package_version || '0.1.0',
      syncServerUrl: '',

      // Analytics. The key is a PostHog *project* key - write-only and safe to
      // ship to the client. Absent key => the no-op client, so dev and
      // self-hosted builds send nothing.
      posthogKey: '',
      // Same-origin proxy path, see routeRules below.
      posthogHost: '/_ph',
      // Used by the Electron desktop build, which has no Nitro server to proxy
      // through. See app/plugins/analytics.client.ts.
      posthogDirectHost: 'https://eu.i.posthog.com',
      posthogUiHost: 'https://eu.posthog.com',
    },
  },

  // Route rules
  routeRules: {
    // Reverse-proxy PostHog ingestion through our own origin. Two reasons:
    // content blockers drop requests to posthog.com outright (our audience
    // runs them), and first-party requests keep cookies first-party.
    '/_ph/static/**': {
      proxy: 'https://eu-assets.i.posthog.com/static/**',
    },
    '/_ph/**': {
      proxy: 'https://eu.i.posthog.com/**',
    },
  },

  // Build optimizations
  build: {
    transpile: ['@unimem/analytics', '@unimem/core', '@unimem/db', '@unimem/types'],
  },

  // Vite configuration for PGlite
  vite: {
    optimizeDeps: {
      exclude: ['@electric-sql/pglite'],
    },
    worker: {
      format: 'es',
    },
  },
});
