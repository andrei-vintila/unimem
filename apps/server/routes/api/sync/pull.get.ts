import type { Entity } from '@unimem/types';

interface PullResponse {
  entities: Entity[];
  syncVersion: string;
  hasMore: boolean;
}

export default defineEventHandler(async (event): Promise<PullResponse> => {
  const query = getQuery(event);
  const clientId = query.clientId as string;
  const lastSyncVersion = query.lastSyncVersion as string;
  const limit = parseInt(query.limit as string) || 100;

  if (!clientId) {
    throw createError({
      statusCode: 400,
      message: 'clientId is required',
    });
  }

  // TODO: Implement actual sync logic with ElectricSQL
  // For now, this returns an empty set

  console.log(`[Sync] Pull for client ${clientId}:`, {
    lastSyncVersion,
    limit,
  });

  // In a real implementation, you would:
  // 1. Query entities modified after lastSyncVersion
  // 2. Filter by clientId to exclude own changes
  // 3. Paginate results

  return {
    entities: [],
    syncVersion: lastSyncVersion || generateSyncVersion(),
    hasMore: false,
  };
});

function generateSyncVersion(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
