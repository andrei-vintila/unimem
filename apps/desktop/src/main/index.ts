// =============================================================================
// Unimem desktop shell - main process entry point
// =============================================================================
//
// The desktop app is the same Nuxt bundle as the web app. In development it
// loads the Nuxt dev server so HMR works; in a packaged build it loads the
// prerendered output over the `app://` scheme (see ./protocol).

import { app, BrowserWindow } from 'electron';
import path from 'node:path';

import { registerBundleHandlers } from './bundle';
import { closeDatabase, registerDatabaseHandlers } from './database';
import { registerPathHandlers } from './paths';
import { handleAppScheme, registerAppScheme } from './protocol';
import { createMainWindow } from './window';

/** Matches `devUrl` in the web app's Nuxt dev server. */
const DEV_URL = process.env.UNIMEM_DEV_URL ?? 'http://localhost:3000';

const isDev = !app.isPackaged;

/**
 * Where the generated bundle lands inside the packaged app. `electron-builder`
 * copies `apps/web/.output/public` to `renderer/` next to `dist/` - see the
 * `files` entry in electron-builder.yml.
 */
const RENDERER_ROOT = path.join(app.getAppPath(), 'renderer');

// A second launch should focus the window the user already has, not start a
// second copy fighting over the same database file.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main(): void {
  // Must happen before `whenReady`; the scheme's privileges are baked in at
  // protocol-registration time.
  registerAppScheme();

  // Read by the preload bridge, which has no access to `app`.
  process.env.UNIMEM_APP_VERSION = app.getVersion();

  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (!existing) return;

    if (existing.isMinimized()) existing.restore();
    existing.focus();
  });

  app.whenReady().then(() => {
    if (!isDev) handleAppScheme(RENDERER_ROOT);

    registerPathHandlers();
    registerDatabaseHandlers();
    registerBundleHandlers();
    createMainWindow({ devUrl: isDev ? DEV_URL : undefined });

    // macOS keeps the process alive after the last window closes; clicking the
    // dock icon is expected to bring the app back.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow({ devUrl: isDev ? DEV_URL : undefined });
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Electron will not wait on an async listener, so the close is held open by
  // deferring the quit until PGlite has finished flushing its data directory.
  let closed = false;
  app.on('before-quit', (event) => {
    if (closed) return;

    event.preventDefault();
    void closeDatabase().finally(() => {
      closed = true;
      app.quit();
    });
  });

  // Belt and braces alongside the per-window handler: no renderer in this app
  // has any reason to attach to a webview or open a second web contents.
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}
