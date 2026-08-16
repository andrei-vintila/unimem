// =============================================================================
// BundleFs backed by node:fs
// =============================================================================
//
// A separate entry point so that importing the bundle logic from a browser
// bundle does not drag node:fs in behind it.

import fs from 'node:fs/promises';

import type { BundleFs } from './bundle.js';

export function createNodeBundleFs(): BundleFs {
  return {
    async list(path) {
      try {
        return await fs.readdir(path);
      } catch (error) {
        // A bundle that does not exist yet reads as empty rather than failing;
        // the first write creates it.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    },

    async isDirectory(path) {
      try {
        return (await fs.stat(path)).isDirectory();
      } catch {
        return false;
      }
    },

    readFile: (path) => fs.readFile(path, 'utf8'),

    async writeFile(path, content) {
      await fs.mkdir(dirname(path), { recursive: true });
      await fs.writeFile(path, content, 'utf8');
    },

    deleteFile: (path) => fs.rm(path, { force: true }),

    mkdir: async (path) => {
      await fs.mkdir(path, { recursive: true });
    },

    async exists(path) {
      try {
        await fs.access(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}

function dirname(path: string): string {
  const at = path.lastIndexOf('/');
  return at <= 0 ? '.' : path.slice(0, at);
}
