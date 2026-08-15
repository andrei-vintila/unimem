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
  interface UnimemDesktopBridge {
    readonly isDesktop: true;
    readonly platform: 'macos' | 'windows' | 'linux' | undefined;
    readonly appVersion: string;

    getAppDataDir(): Promise<string>;
    getDocumentDir(): Promise<string>;
    getDatabasePath(): Promise<string>;
  }

  interface Window {
    readonly unimem?: UnimemDesktopBridge;
  }
}
