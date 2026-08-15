// =============================================================================
// IPC contract shared by the main process and the preload bridge
// =============================================================================

/**
 * Channel names are namespaced so they can never collide with a channel used
 * by Electron itself or by a dependency that also talks over ipcRenderer.
 */
export const IpcChannel = {
  AppDataDir: 'unimem:app-data-dir',
  DocumentDir: 'unimem:document-dir',
  DatabasePath: 'unimem:database-path',
} as const;

/** Coarse OS label. Deliberately not the full user-agent or release string. */
export type DesktopPlatform = 'macos' | 'windows' | 'linux';

/**
 * The entire surface the renderer gets. Everything here is exposed through
 * `contextBridge`, so it is also the full list of things a compromised
 * renderer could reach - keep it small and keep every handler validating.
 */
export interface UnimemDesktopBridge {
  /** Always true when present. Absence of `window.unimem` means "web". */
  readonly isDesktop: true;
  readonly platform: DesktopPlatform | undefined;
  readonly appVersion: string;

  /** Per-user application data directory, created if missing. */
  getAppDataDir(): Promise<string>;
  /** The OS documents directory. */
  getDocumentDir(): Promise<string>;
  /** Absolute path the local database should live at. */
  getDatabasePath(): Promise<string>;
}

export function toDesktopPlatform(
  nodePlatform: string
): DesktopPlatform | undefined {
  if (nodePlatform === 'darwin') return 'macos';
  if (nodePlatform === 'win32') return 'windows';
  if (nodePlatform === 'linux') return 'linux';
  return undefined;
}
