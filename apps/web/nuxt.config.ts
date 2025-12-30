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
      syncServerUrl: '',
    },
  },

  // Build optimizations
  build: {
    transpile: ['@unimem/core', '@unimem/db', '@unimem/types'],
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
