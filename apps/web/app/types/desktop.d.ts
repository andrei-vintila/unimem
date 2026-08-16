// =============================================================================
// The desktop shell's bridge, as the renderer sees it
// =============================================================================
//
// The desktop app runs this exact Nuxt bundle inside Electron, so the surface
// has to be detected at runtime rather than at build time: `window.unimem` is
// injected by the shell's preload script and is simply absent on web.
//
// Kept in sync with `UnimemDesktopBridge` in apps/desktop/src/shared/ipc.ts.

export {};

declare global {
  interface UnimemDesktopDatabase {
    query(request: {
      sql: string;
      params: unknown[];
      rowMode: 'array' | 'object';
    }): Promise<{ rows: unknown[] }>;
    exec(sql: string): Promise<void>;
  }

  interface UnimemDesktopBundle {
    root(): Promise<string>;
    op(request: {
      op:
        | 'list'
        | 'isDirectory'
        | 'readFile'
        | 'writeFile'
        | 'deleteFile'
        | 'mkdir'
        | 'exists';
      path: string;
      content?: string;
    }): Promise<unknown>;
  }

  interface UnimemDesktopBridge {
    readonly isDesktop: true;
    readonly platform: 'macos' | 'windows' | 'linux' | undefined;
    readonly appVersion: string;

    getAppDataDir(): Promise<string>;
    getDocumentDir(): Promise<string>;
    getDatabasePath(): Promise<string>;

    /** The shell's file-backed index, reached over IPC. */
    readonly db: UnimemDesktopDatabase;

    /** The OKF markdown bundle that is the actual store. */
    readonly bundle: UnimemDesktopBundle;
  }

  interface Window {
    readonly unimem?: UnimemDesktopBridge;
  }
}
