import type { SyncState } from '@unimem/types';
import { SyncManager } from '@unimem/db';
import { DatabaseClient } from '@unimem/db';

// Singleton SyncManager shared across the app
let syncManager: SyncManager | null = null;

// Reactive state exposed to components
const syncState = ref<SyncState>({
  status: 'synced',
  pendingChanges: 0,
  conflictCount: 0,
});

export function useSync() {
  /**
   * Initialise the SyncManager with an already-open DatabaseClient.
   * Call this once after the database is ready (e.g. inside useMemory).
   */
  function init(client: DatabaseClient, serverUrl: string): void {
    if (syncManager) return;

    syncManager = new SyncManager({
      client,
      clientId: getOrCreateClientId(),
      replication: {
        enabled: true,
        serverUrl,
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
  }

  /** Start periodic syncing. No-op when no server URL is configured. */
  async function start(): Promise<void> {
    if (!syncManager) return;
    syncState.value = { ...syncState.value, status: 'syncing' as const };
    await syncManager.start();
    syncState.value = syncManager.getState();
  }

  /** Trigger an immediate sync cycle. */
  async function syncNow(): Promise<void> {
    if (!syncManager) return;
    syncState.value = { ...syncState.value, status: 'syncing' as const };
    const result = await syncManager.sync();
    syncState.value = result;
  }

  function stop(): void {
    syncManager?.stop();
  }

  return {
    syncState: readonly(syncState),
    init,
    start,
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
