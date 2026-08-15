import { createError, defineEventHandler, getQuery } from 'h3';

import { trackEvents } from '~/utils/analytics';
import type { Entity } from '@unimem/types';
import { getEntitiesAfterVersion, generateVersion } from '~/utils/syncStore';

interface PullResponse {
  entities: Entity[];
  syncVersion: string;
  hasMore: boolean;
}

export default defineEventHandler(async (event): Promise<PullResponse> => {
  const startedAt = Date.now();
  const query = getQuery(event);
  const clientId = query.clientId as string;
  const lastSyncVersion = (query.lastSyncVersion as string) || '0';
  const limit = Math.min(parseInt((query.limit as string) || '100', 10), 500);

  if (!clientId) {
    throw createError({
      statusCode: 400,
      message: 'clientId is required',
    });
  }

  const { items, hasMore } = await getEntitiesAfterVersion(
    lastSyncVersion,
    clientId,
    limit
  );

  // The new cursor for the client is the version of the last returned item.
  // If nothing changed, echo back the client's cursor so it doesn't regress.
  const syncVersion =
    items.length > 0
      ? items[items.length - 1].serverVersion
      : lastSyncVersion || generateVersion();

  console.log(
    `[Sync] Pull for ${clientId} since ${lastSyncVersion}: ${items.length} entities, hasMore=${hasMore}`
  );

  const entities = items.map((stored) => stored.entity);

  trackEvents(
    event,
    clientId,
    {
      name: 'sync_started',
      properties: { direction: 'pull', entity_count: 0 },
    },
    {
      name: 'sync_completed',
      properties: {
        direction: 'pull',
        entity_count: entities.length,
        duration_ms: Math.round(Date.now() - startedAt),
        conflict_count: 0,
      },
    }
  );

  return { entities, syncVersion, hasMore };
});
