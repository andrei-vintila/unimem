import type { Entity } from '@unimem/types';

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
  const body = await readBody<PushPayload>(event);

  // Validate payload
  if (!body.clientId || !body.entities) {
    throw createError({
      statusCode: 400,
      message: 'Invalid push payload',
    });
  }

  // TODO: Implement actual sync logic with ElectricSQL
  // For now, this is a placeholder that accepts all changes

  const newSyncVersion = generateSyncVersion();
  const conflicts: PushResponse['conflicts'] = [];

  // In a real implementation, you would:
  // 1. Check for conflicts with server state
  // 2. Apply non-conflicting changes
  // 3. Return conflicting entities for client resolution

  console.log(`[Sync] Push from client ${body.clientId}:`, {
    entityCount: body.entities.length,
    lastSyncVersion: body.lastSyncVersion,
  });

  return {
    success: true,
    syncVersion: newSyncVersion,
    conflicts,
  };
});

function generateSyncVersion(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
