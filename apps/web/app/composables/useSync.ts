import type { SyncState } from '@unimem/types';
import type { SqlDatabase } from '@unimem/db';
import { SyncManager } from '@unimem/db';

// Singleton SyncManager shared across the app
let syncManager: SyncManager | null = null;
let database: SqlDatabase | null = null;

const IDLE: SyncState = {
  status: 'synced',
  pendingChanges: 0,
  conflictCount: 0,
};

// Reactive state exposed to components
const syncState = ref<SyncState>({ ...IDLE });

export function useSync() {
  const settings = useSyncSettings();

  /**
   * Hand the sync manager the open database. Call once, after the database is
   * ready (see useMemory).
   */
  function attach(client: SqlDatabase): void {
    database = client;
    void reconfigure();
  }

  /**
   * (Re)build the sync manager from the current settings and start it.
   *
   * Called on attach and again whenever the user changes the server or token,
   * because a SyncManager holds its server URL and token for its lifetime -
   * the old one has to be stopped rather than reconfigured.
   */
  async function reconfigure(): Promise<void> {
    syncManager?.stop();
    syncManager = null;

    if (!database || !settings.isConfigured.value) {
      syncState.value = { ...IDLE };
      return;
    }

    syncManager = new SyncManager({
      client: database,
      clientId: getOrCreateClientId(),
      replication: {
        enabled: true,
        serverUrl: settings.serverUrl.value,
        authToken: settings.authToken.value,
        syncInterval: 30_000, // 30 s
        conflictResolution: 'manual',
      },
    });

    // Mirror events into reactive state
    syncManager.on((event) => {
      if (
        event.type === 'sync:started' ||
        event.type === 'sync:completed' ||
        event.type === 'sync:conflict'
      ) {
        syncState.value = syncManager!.getState();
      }
    });

    syncState.value = { ...syncState.value, status: 'syncing' };
    await syncManager.start();
    syncState.value = syncManager.getState();
  }

  /** Trigger an immediate sync cycle. */
  async function syncNow(): Promise<void> {
    if (!syncManager) return;
    syncState.value = { ...syncState.value, status: 'syncing' };
    syncState.value = await syncManager.sync();
  }

  function stop(): void {
    syncManager?.stop();
  }

  return {
    syncState: readonly(syncState),
    attach,
    reconfigure,
    syncNow,
    stop,
  };
}

// ---------------------------------------------------------------------------
// Client ID persistence
// ---------------------------------------------------------------------------

const CLIENT_ID_KEY = 'unimem:clientId';

function getOrCreateClientId(): string {
  if (typeof localStorage === 'undefined') {
    return `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}
