// =============================================================================
// BundleFs over the desktop bridge
// =============================================================================
//
// The bundle logic in @unimem/okf takes its filesystem as a parameter, which
// is what lets the same code run here - in a sandboxed renderer that reaches
// disk only through IPC - as runs in Node and, eventually, on Obsidian's vault
// API.
//
// Paths are bundle-relative on this side. The main process resolves them
// against the vault root and refuses anything that escapes it.

import type { BundleFs } from '@unimem/okf';

type BundleBridge = NonNullable<Window['unimem']>['bundle'];

export function createDesktopBundleFs(bundle: BundleBridge): BundleFs {
  return {
    list: (path) => bundle.op({ op: 'list', path }) as Promise<string[]>,
    isDirectory: (path) => bundle.op({ op: 'isDirectory', path }) as Promise<boolean>,
    readFile: (path) => bundle.op({ op: 'readFile', path }) as Promise<string>,
    exists: (path) => bundle.op({ op: 'exists', path }) as Promise<boolean>,

    async writeFile(path, content) {
      await bundle.op({ op: 'writeFile', path, content });
    },
    async deleteFile(path) {
      await bundle.op({ op: 'deleteFile', path });
    },
    async mkdir(path) {
      await bundle.op({ op: 'mkdir', path });
    },
  };
}

/**
 * The bundle root as the OKF helpers should address it.
 *
 * Empty, deliberately: every path crossing the bridge is relative to the vault
 * the main process chose. The renderer never learns an absolute path, so it
 * cannot accidentally send one back.
 */
export const DESKTOP_BUNDLE_ROOT = '';
