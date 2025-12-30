import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // PGlite uses a file path, not connection string
    // This is used for migration generation only
    url: 'postgresql://localhost:5432/unimem',
  },
});
