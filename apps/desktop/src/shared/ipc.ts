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
  DbQuery: 'unimem:db-query',
  DbExec: 'unimem:db-exec',
} as const;

/** Coarse OS label. Deliberately not the full user-agent or release string. */
export type DesktopPlatform = 'macos' | 'windows' | 'linux';

/**
 * One SQL statement, run against the shell's database.
 *
 * `rowMode` picks how rows come back: `'array'` is what Drizzle's proxy driver
 * consumes, `'object'` is what raw callers read columns by name from.
 */
export interface DbQueryRequest {
  sql: string;
  params: unknown[];
  rowMode: 'array' | 'object';
}

/**
 * The database the renderer talks to.
 *
 * It lives in the main process because the renderer is sandboxed and has no
 * filesystem access - it could otherwise only reach IndexedDB, which is not
 * the file the shell reports in Settings and not a file the user can back up.
 *
 * This channel carries SQL, so it hands the renderer full control over the
 * local database. That is the same authority the renderer already has by being
 * the app's own bundle, and the window's navigation policy is what keeps any
 * other origin out of it - but it is why nothing here takes a file path.
 */
export interface UnimemDesktopDatabase {
  query(request: DbQueryRequest): Promise<{ rows: unknown[] }>;
  exec(sql: string): Promise<void>;
}

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

  readonly db: UnimemDesktopDatabase;
}

export function toDesktopPlatform(
  nodePlatform: string
): DesktopPlatform | undefined {
  if (nodePlatform === 'darwin') return 'macos';
  if (nodePlatform === 'win32') return 'windows';
  if (nodePlatform === 'linux') return 'linux';
  return undefined;
}
