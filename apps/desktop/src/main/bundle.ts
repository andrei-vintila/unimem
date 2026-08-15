// =============================================================================
// The OKF bundle, reached from the sandboxed renderer
// =============================================================================
//
// The markdown bundle is the store. The renderer holds the logic that reads
// and writes it, but has no filesystem of its own, so every operation arrives
// here as a bundle-relative path.
//
// Which makes this file the trust boundary. The renderer is the process that
// talks to the network; a path it supplies is input, not instruction. Every
// path is resolved against the bundle root and rejected unless it stays
// inside - otherwise `../../../.ssh/id_rsa` would be a readable document.

import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

import { IpcChannel, type BundleOpRequest } from '../shared/ipc';
import { appDataDir } from './paths';

/** Directory name of the vault inside the app data directory. */
const BUNDLE_DIRNAME = 'vault';

export async function bundleRoot(): Promise<string> {
  const root = path.join(await appDataDir(), BUNDLE_DIRNAME);
  await fs.mkdir(root, { recursive: true });
  return root;
}

/**
 * Resolve a caller-supplied path inside the bundle, or throw.
 *
 * `path.resolve` collapses `..` before the check, so a traversal cannot hide
 * behind one; the trailing separator on the prefix stops `/vault-elsewhere`
 * from passing as a child of `/vault`.
 */
function resolveInsideBundle(root: string, relative: string): string {
  if (typeof relative !== 'string') {
    throw new Error('Invalid bundle path');
  }

  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Bundle path escapes the vault');
  }

  return resolved;
}

async function run(root: string, request: BundleOpRequest): Promise<unknown> {
  const target = resolveInsideBundle(root, request.path ?? '');

  switch (request.op) {
    case 'list':
      try {
        return await fs.readdir(target);
      } catch (error) {
        // A vault that does not exist yet reads as empty; the first write
        // creates it.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }

    case 'isDirectory':
      try {
        return (await fs.stat(target)).isDirectory();
      } catch {
        return false;
      }

    case 'readFile':
      return fs.readFile(target, 'utf8');

    case 'writeFile': {
      if (typeof request.content !== 'string') {
        throw new Error('writeFile needs string content');
      }
      // Only ever markdown. The renderer has no business putting anything
      // else in the user's vault directory.
      if (path.extname(target) !== '.md') {
        throw new Error('Bundle writes must be .md files');
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, request.content, 'utf8');
      return true;
    }

    case 'deleteFile':
      if (path.extname(target) !== '.md') {
        throw new Error('Bundle deletes must be .md files');
      }
      await fs.rm(target, { force: true });
      return true;

    case 'mkdir':
      await fs.mkdir(target, { recursive: true });
      return true;

    case 'exists':
      try {
        await fs.access(target);
        return true;
      } catch {
        return false;
      }

    default:
      throw new Error(`Unknown bundle operation: ${String(request.op)}`);
  }
}

export function registerBundleHandlers(): void {
  ipcMain.handle(IpcChannel.BundleRoot, () => bundleRoot());

  ipcMain.handle(IpcChannel.BundleOp, async (_event, payload: unknown) => {
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('Invalid bundle request');
    }
    return run(await bundleRoot(), payload as BundleOpRequest);
  });
}
