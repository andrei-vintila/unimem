import type { Entity } from '@unimem/types';
import {
  getStoredEntity,
  setStoredEntity,
  generateVersion,
  versionIsAfter,
} from '~/utils/syncStore';

interface PushPayload {
  clientId: string;
  entities: Entity[];
  lastSyncVersion: string;
}

interface PushResponse {
  success: boolean;
  syncVersion: string;
  conflicts: Array<{
    entityId: string;
    serverVersion: Entity;
  }>;
}

export default defineEventHandler(async (event): Promise<PushResponse> => {
  const startedAt = Date.now();
  const body = await readBody<PushPayload>(event);

  if (!body.clientId || !Array.isArray(body.entities)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid push payload: clientId and entities are required',
    });
  }

  const newVersion = generateVersion();
  const conflicts: PushResponse['conflicts'] = [];

  for (const entity of body.entities) {
    if (!entity.id) continue;

    const stored = await getStoredEntity(entity.id);

    if (stored && stored.clientId !== body.clientId) {
      // Another client owns the last write. Conflict if the server version
      // is newer than the pushing client's last sync point.
      if (versionIsAfter(stored.serverVersion, body.lastSyncVersion || '0')) {
        conflicts.push({ entityId: entity.id, serverVersion: stored.entity });
        continue;
      }
    }

    // No conflict – persist the entity
    await setStoredEntity(entity.id, {
      entity,
      serverVersion: newVersion,
      clientId: body.clientId,
    });
  }

  console.log(`[Sync] Push from ${body.clientId}: ${body.entities.length} entities, ${conflicts.length} conflicts`);

  // Counts and timing only. The entities themselves are the user's notes.
  trackEvents(
    event,
    body.clientId,
    {
      name: 'sync_started',
      properties: { direction: 'push', entity_count: body.entities.length },
    },
    {
      name: 'sync_completed',
      properties: {
        direction: 'push',
        entity_count: body.entities.length,
        duration_ms: Math.round(Date.now() - startedAt),
        conflict_count: conflicts.length,
      },
    }
  );

  return { success: true, syncVersion: newVersion, conflicts };
});
