// =============================================================================
// Preload - the only bridge between the Nuxt renderer and the main process
// =============================================================================
//
// This file runs with `sandbox: true` and `contextIsolation: true`, so it is
// bundled into a single self-contained script (see the build step in
// package.json): a sandboxed preload cannot `require` sibling files.
//
// Nothing here forwards a caller-supplied path or channel name. The renderer
// can only ask the questions enumerated in `IpcChannel`; the main process
// decides what the answers are.

import { contextBridge, ipcRenderer } from 'electron';

import {
  IpcChannel,
  toDesktopPlatform,
  type DbQueryRequest,
  type UnimemDesktopBridge,
} from '../shared/ipc';

const bridge: UnimemDesktopBridge = {
  isDesktop: true,
  platform: toDesktopPlatform(process.platform),
  appVersion: process.env.UNIMEM_APP_VERSION ?? '0.0.0',

  getAppDataDir: () => ipcRenderer.invoke(IpcChannel.AppDataDir),
  getDocumentDir: () => ipcRenderer.invoke(IpcChannel.DocumentDir),
  getDatabasePath: () => ipcRenderer.invoke(IpcChannel.DatabasePath),

  db: {
    // Rebuilt field by field rather than forwarded whole: the renderer's object
    // is the caller's, and only these three properties belong on the wire.
    query: (request: DbQueryRequest) =>
      ipcRenderer.invoke(IpcChannel.DbQuery, {
        sql: request.sql,
        params: request.params,
        rowMode: request.rowMode,
      }),
    exec: (sql: string) => ipcRenderer.invoke(IpcChannel.DbExec, sql),
  },
};

contextBridge.exposeInMainWorld('unimem', bridge);
