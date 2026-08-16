import { createError, defineEventHandler, getQuery } from 'h3';

import { trackEvents } from '~/utils/analytics';
import { requireVaultId } from '~/utils/auth';
import type { Entity } from '@unimem/types';
import {
  getEntitiesAfter,
  formatCursor,
  parseCursor,
} from '~/utils/syncStore';

interface PullResponse {
  entities: Entity[];
  syncVersion: string;
  hasMore: boolean;
}

export default defineEventHandler(async (event): Promise<PullResponse> => {
  const startedAt = Date.now();
  const vaultId = await requireVaultId(event);

  const query = getQuery(event);
  const clientId = query.clientId as string;
  const since = parseCursor(query.lastSyncVersion as string | undefined);
  const limit = Math.min(parseInt((query.limit as string) || '100', 10), 500);

  if (!clientId) {
    throw createError({
      statusCode: 400,
      message: 'clientId is required',
    });
  }

  const { items, hasMore, cursor } = await getEntitiesAfter(
    vaultId,
    since,
    clientId,
    limit
  );

  const entities = items.map((stored) => stored.entity);

  trackEvents(
    event,
    vaultId,
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

  return { entities, syncVersion: formatCursor(cursor), hasMore };
});
