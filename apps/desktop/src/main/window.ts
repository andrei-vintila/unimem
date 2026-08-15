// =============================================================================
// The main window, and the navigation rules that keep it a shell
// =============================================================================

import { BrowserWindow, shell } from 'electron';
import path from 'node:path';

import { APP_ORIGIN } from './protocol';

const WINDOW = {
  width: 1200,
  height: 800,
  minWidth: 800,
  minHeight: 600,
} as const;

export interface WindowOptions {
  /**
   * Dev server URL, or `undefined` to load the packaged bundle.
   *
   * Electron logs an "Insecure Content-Security-Policy" warning when this is
   * set: the CSP is attached by the `app://` handler, which dev does not go
   * through, and the Nuxt dev server sends none of its own. The warning is
   * emitted for unpackaged builds only and does not apply to shipped ones.
   */
  devUrl?: string;
}

export function createMainWindow({ devUrl }: WindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    ...WINDOW,
    title: 'Unimem - Neural Memory',
    resizable: true,
    // Paint the window only once the renderer has something to show, instead
    // of flashing an empty frame while Nuxt hydrates.
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
    },
  });

  window.once('ready-to-show', () => window.show());

  applyNavigationPolicy(window, devUrl);

  void window.loadURL(devUrl ?? `${APP_ORIGIN}/`);

  return window;
}

/**
 * The renderer is a notes app, not a browser. Anything that would navigate the
 * shell away from our own origin - a link in a note, a redirect, an injected
 * `window.open` - goes to the user's real browser instead, where it is subject
 * to their extensions, profile isolation and address bar.
 */
function applyNavigationPolicy(window: BrowserWindow, devUrl?: string): void {
  const allowedOrigin = devUrl ? originOf(devUrl) : APP_ORIGIN;

  window.webContents.on('will-navigate', (event, url) => {
    if (originOf(url) === allowedOrigin) return;

    event.preventDefault();
    void openExternal(url);
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url);
    return { action: 'deny' };
  });

  // Nothing in the app needs the camera, microphone, or the user's location;
  // a request for one means something unexpected is running in the renderer.
  window.webContents.session.setPermissionRequestHandler((_wc, _perm, grant) => {
    grant(false);
  });
}

/**
 * Built from the parts rather than read off `URL.origin`.
 *
 * `app:` is not one of the WHATWG "special" schemes, so in the main process
 * `new URL('app://unimem/settings').origin` is the *string* `"null"` - Chromium
 * knows the scheme is standard, Node's URL parser does not. Comparing that
 * against APP_ORIGIN never matches, which made this policy block every
 * same-origin hard navigation in the packaged app (a reload, a `location.href`,
 * an anchor that escapes the router) while client-side `pushState` routing
 * carried on working and hid it.
 */
function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/** Only ever hand http(s) to the OS - `file:`, `smb:` and friends open apps. */
async function openExternal(url: string): Promise<void> {
  const protocol = safeProtocol(url);
  if (protocol !== 'http:' && protocol !== 'https:') return;

  await shell.openExternal(url);
}

function safeProtocol(url: string): string | null {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
}
