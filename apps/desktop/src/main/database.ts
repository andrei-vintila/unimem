// =============================================================================
// The local database, opened in the main process
// =============================================================================
//
// PGlite in a browser context can only persist to IndexedDB, and the renderer
// here is sandboxed, so it cannot open a file at all. The database is therefore
// opened on this side, at the path `paths.ts` reports in Settings, and the
// renderer drives it over IPC.
//
// Deliberately dumb: this module runs SQL and returns rows. The schema, the
// migrations, and every query live in `@unimem/db`, so the desktop app and the
// web app are running the exact same database code against the same schema -
// which is what makes an entity written on one surface legible to the other.

import { ipcMain } from 'electron';
import { PGlite, types } from '@electric-sql/pglite';

import { IpcChannel, type DbQueryRequest } from '../shared/ipc';
import { databasePath } from './paths';

/**
 * Hand date and timestamp columns to the caller as raw strings.
 *
 * PGlite otherwise parses them into JS `Date`s, and the columns are
 * `TIMESTAMP WITHOUT TIME ZONE`, so it reads them as *local* time - a note
 * written at 10:00 UTC comes back three hours off in Bucharest. Drizzle's own
 * PGlite driver suppresses these same four parsers and maps the strings itself,
 * so this is what puts the proxy path back in step with it.
 *
 * Only array mode: that is the mode Drizzle consumes. Object-mode rows go to
 * raw `execute` callers, who expect PGlite's ordinary parsed values, exactly as
 * they get from a local `DatabaseClient`.
 *
 * Covered by packages/db/test/remote-client.test.mjs.
 */
const RAW_TEMPORAL_PARSERS = {
  [types.TIMESTAMP]: (value: string) => value,
  [types.TIMESTAMPTZ]: (value: string) => value,
  [types.INTERVAL]: (value: string) => value,
  [types.DATE]: (value: string) => value,
};

let instance: PGlite | null = null;
let opening: Promise<PGlite> | null = null;

/**
 * Opened on first use rather than at startup, and memoised as a promise so
 * that a burst of queries during renderer boot opens one database rather than
 * racing several onto the same directory.
 */
async function database(): Promise<PGlite> {
  if (instance) return instance;

  opening ??= (async () => {
    const pglite = new PGlite(await databasePath());
    await pglite.waitReady;
    instance = pglite;
    return pglite;
  })();

  return opening;
}

/**
 * The renderer is the app's own bundle, but it is still the process that
 * touches the network, so its messages are treated as input: a malformed one
 * is rejected here rather than handed to the SQL engine.
 */
function parseQueryRequest(payload: unknown): DbQueryRequest {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Invalid query request');
  }

  const { sql, params, rowMode } = payload as Record<string, unknown>;

  if (typeof sql !== 'string') {
    throw new Error('Invalid query request: sql must be a string');
  }
  if (params !== undefined && !Array.isArray(params)) {
    throw new Error('Invalid query request: params must be an array');
  }
  if (rowMode !== 'array' && rowMode !== 'object') {
    throw new Error("Invalid query request: rowMode must be 'array' or 'object'");
  }

  return { sql, params: params ?? [], rowMode };
}

export function registerDatabaseHandlers(): void {
  ipcMain.handle(IpcChannel.DbQuery, async (_event, payload: unknown) => {
    const { sql, params, rowMode } = parseQueryRequest(payload);
    const pglite = await database();

    const result = await pglite.query(sql, params, {
      rowMode,
      ...(rowMode === 'array' ? { parsers: RAW_TEMPORAL_PARSERS } : {}),
    });

    // Only the rows cross the boundary. PGlite's `fields` carry driver-internal
    // type OIDs that nothing on the renderer side reads.
    return { rows: result.rows };
  });

  ipcMain.handle(IpcChannel.DbExec, async (_event, sql: unknown) => {
    if (typeof sql !== 'string') {
      throw new Error('Invalid exec request: sql must be a string');
    }

    const pglite = await database();
    await pglite.exec(sql);
  });
}

/** Flush and close, so a quit does not leave the data directory mid-write. */
export async function closeDatabase(): Promise<void> {
  const pglite = instance;
  instance = null;
  opening = null;

  await pglite?.close();
}
