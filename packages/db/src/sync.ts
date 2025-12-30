// =============================================================================
// ElectricSQL Sync Layer
// =============================================================================

import type {
  SyncState,
  SyncConflict,
  ReplicationConfig,
  MemoryEvent,
} from '@unimem/types';
import type { DatabaseClient } from './client';

// -----------------------------------------------------------------------------
// Sync Manager Configuration
// -----------------------------------------------------------------------------

export interface SyncManagerConfig {
  client: DatabaseClient;
  replication: ReplicationConfig;
  clientId: string;
}

// -----------------------------------------------------------------------------
// Sync Manager
// -----------------------------------------------------------------------------

type SyncEventHandler = (event: MemoryEvent) => void;

export class SyncManager {
  private client: DatabaseClient;
  private config: ReplicationConfig;
  private clientId: string;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private eventHandlers: Set<SyncEventHandler> = new Set();
  private state: SyncState = {
    status: 'synced',
    pendingChanges: 0,
    conflictCount: 0,
  };

  constructor(config: SyncManagerConfig) {
    this.client = config.client;
    this.config = config.replication;
    this.clientId = config.clientId;
  }

  // ---------------------------------------------------------------------------
  // Sync Operations
  // ---------------------------------------------------------------------------

  /**
   * Start the sync process
   */
  async start(): Promise<void> {
    if (!this.config.enabled || !this.config.serverUrl) {
      console.log('Sync disabled or no server URL configured');
      return;
    }

    // Initial sync
    await this.sync();

    // Set up periodic sync
    if (this.config.syncInterval > 0) {
      this.syncInterval = setInterval(
        () => this.sync(),
        this.config.syncInterval
      );
    }
  }

  /**
   * Stop the sync process
   */
  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Perform a sync operation
   */
  async sync(): Promise<SyncState> {
    this.emit('sync:started', { clientId: this.clientId });

    try {
      // Get pending changes from local
      const pendingChanges = await this.getPendingChanges();

      if (pendingChanges.length > 0) {
        // Push local changes to server
        await this.pushChanges(pendingChanges);
      }

      // Pull remote changes
      await this.pullChanges();

      // Update state
      this.state = {
        status: 'synced',
        lastSyncedAt: new Date(),
        pendingChanges: 0,
        conflictCount: await this.getConflictCount(),
      };

      this.emit('sync:completed', this.state);
    } catch (error) {
      this.state = {
        ...this.state,
        status: 'error',
      };
      console.error('Sync error:', error);
    }

    return this.state;
  }

  /**
   * Get current sync state
   */
  getState(): SyncState {
    return this.state;
  }

  /**
   * Get unresolved conflicts
   */
  async getConflicts(): Promise<SyncConflict[]> {
    const result = await this.client.execute(`
      SELECT * FROM sync_log
      WHERE resolved IS NULL
      ORDER BY timestamp DESC
    `);

    // Parse conflicts from sync log
    // This is a simplified implementation
    return (result.rows as Array<Record<string, unknown>>).map((row) => ({
      entityId: row.entity_id as string,
      localVersion: row.payload as SyncConflict['localVersion'],
      remoteVersion: row.payload as SyncConflict['remoteVersion'],
    }));
  }

  /**
   * Resolve a conflict
   */
  async resolveConflict(
    entityId: string,
    resolution: 'local' | 'remote' | 'merged',
    mergedEntity?: unknown
  ): Promise<void> {
    if (resolution === 'local') {
      // Keep local version, mark as resolved
      await this.client.execute(
        `UPDATE sync_log SET resolved = NOW() WHERE entity_id = $1`,
        [entityId]
      );
    } else if (resolution === 'remote') {
      // Apply remote version
      const conflicts = await this.getConflicts();
      const conflict = conflicts.find((c) => c.entityId === entityId);
      if (conflict) {
        await this.client.execute(
          `UPDATE entities SET
            title = $1, content = $2, updated_at = NOW()
          WHERE id = $3`,
          [conflict.remoteVersion.title, conflict.remoteVersion.content, entityId]
        );
      }
      await this.client.execute(
        `UPDATE sync_log SET resolved = NOW() WHERE entity_id = $1`,
        [entityId]
      );
    } else if (resolution === 'merged' && mergedEntity) {
      // Apply merged version
      const merged = mergedEntity as { title: string; content: string };
      await this.client.execute(
        `UPDATE entities SET
          title = $1, content = $2, updated_at = NOW()
        WHERE id = $3`,
        [merged.title, merged.content, entityId]
      );
      await this.client.execute(
        `UPDATE sync_log SET resolved = NOW() WHERE entity_id = $1`,
        [entityId]
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Event Handling
  // ---------------------------------------------------------------------------

  on(handler: SyncEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(type: MemoryEvent['type'], payload: unknown): void {
    const event: MemoryEvent = {
      type,
      payload,
      timestamp: new Date(),
      source: 'local',
    };

    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Sync event handler error:', error);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private async getPendingChanges(): Promise<unknown[]> {
    const result = await this.client.execute(`
      SELECT * FROM entities
      WHERE sync_status = 'pending'
      ORDER BY updated_at ASC
    `);
    return result.rows as unknown[];
  }

  private async pushChanges(_changes: unknown[]): Promise<void> {
    // TODO: Implement actual ElectricSQL push
    // This would use the ElectricSQL client to push changes
    // For now, this is a placeholder

    if (!this.config.serverUrl) return;

    // Mark changes as synced
    await this.client.execute(`
      UPDATE entities
      SET sync_status = 'synced'
      WHERE sync_status = 'pending'
    `);
  }

  private async pullChanges(): Promise<void> {
    // TODO: Implement actual ElectricSQL pull
    // This would use the ElectricSQL client to pull changes
    // and handle conflict detection

    if (!this.config.serverUrl) return;

    // Placeholder for ElectricSQL integration
    // In production, this would:
    // 1. Connect to ElectricSQL server
    // 2. Subscribe to changes
    // 3. Apply remote changes
    // 4. Detect and log conflicts
  }

  private async getConflictCount(): Promise<number> {
    const result = await this.client.execute(`
      SELECT COUNT(*) as count FROM sync_log WHERE resolved IS NULL
    `);
    return Number((result.rows[0] as { count: number })?.count ?? 0);
  }
}

// -----------------------------------------------------------------------------
// Factory Function
// -----------------------------------------------------------------------------

export function createSyncManager(config: SyncManagerConfig): SyncManager {
  return new SyncManager(config);
}
