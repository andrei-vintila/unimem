// =============================================================================
// Filesystem locations, resolved in the main process
// =============================================================================

import { app, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

import { IpcChannel } from '../shared/ipc';

/** Filename of the local PGlite database inside the app data directory. */
const DATABASE_FILENAME = 'unimem.db';

/**
 * Electron creates `userData` lazily, and only on first write. Callers get a
 * path they can immediately write into.
 */
async function appDataDir(): Promise<string> {
  const dir = app.getPath('userData');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function documentDir(): string {
  return app.getPath('documents');
}

/**
 * Where the database belongs on disk.
 *
 * Note that the renderer cannot open this path today: PGlite in a browser
 * context is backed by IndexedDB (`idb://unimem`, see the web app's
 * `useMemory`). This is here for the main-process database that persistence
 * will move to, and so the shell can report the location in settings.
 */
async function databasePath(): Promise<string> {
  return path.join(await appDataDir(), DATABASE_FILENAME);
}

export function registerPathHandlers(): void {
  ipcMain.handle(IpcChannel.AppDataDir, () => appDataDir());
  ipcMain.handle(IpcChannel.DocumentDir, () => documentDir());
  ipcMain.handle(IpcChannel.DatabasePath, () => databasePath());
}
