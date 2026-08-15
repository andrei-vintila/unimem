// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite';

export default defineNuxtConfig({
  devtools: { enabled: true },

  modules: [
    '@pinia/nuxt',
    '@vueuse/nuxt',
  ],

  // Tailwind v4 is a Vite plugin rather than a Nuxt module, and its config
  // lives in the stylesheet (`@theme`) instead of tailwind.config.ts.
  css: ['~/assets/css/tailwind.css'],

  // Opt in to Nuxt 5 defaults ahead of the release: the Options API runtime is
  // compiled out (every component here is `<script setup>`), unhead's legacy
  // plugin set is dropped, payload extraction becomes client-only, and the Vite
  // Environment API is enabled.
  future: {
    compatibilityVersion: 5,
  },

  compatibilityDate: '2026-08-15',

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
    plugins: [tailwindcss()],
    optimizeDeps: {
      exclude: ['@electric-sql/pglite'],
    },
    worker: {
      format: 'es',
    },
  },
});
