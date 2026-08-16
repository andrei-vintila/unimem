import { createError, defineEventHandler, readBody } from 'h3';

import { trackEvents } from '~/utils/analytics';
import { requireMember } from '~/utils/auth';
import { decideWrite, resolvePath } from '~/utils/authz';
import { putRequest, requestId } from '~/utils/changeRequests';
import { loadPolicy } from '~/utils/policyStore';
import type { Entity } from '@unimem/types';
import {
  getStoredEntity,
  setStoredEntity,
  generateVersion,
  parseCursor,
  versionIsAfter,
} from '~/utils/syncStore';

interface PushPayload {
  clientId: string;
  entities: Entity[];
  lastSyncVersion: string;
  /** Entity id -> bundle-relative path. The server verifies these. */
  paths?: Record<string, string>;
}

interface PushResponse {
  success: boolean;
  syncVersion: string;
  conflicts: Array<{
    entityId: string;
    serverVersion: Entity;
  }>;
  /**
   * Writes the member could not apply directly. Each is kept as a change
   * request for someone who can write there to accept or decline, so the work
   * is proposed rather than lost.
   */
  rejected: Array<{
    entityId: string;
    reason: string;
    requestId: string;
  }>;
  /** Who the server believes is writing, whatever the client claimed. */
  actor: string;
}

export default defineEventHandler(async (event): Promise<PushResponse> => {
  const startedAt = Date.now();
  const member = await requireMember(event);
  const body = await readBody<PushPayload>(event);

  // h3 v2 resolves `readBody` to `T | undefined`; see the note in embed.post.ts.
  if (!body?.clientId || !Array.isArray(body.entities)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid push payload: clientId and entities are required',
    });
  }

  const policy = await loadPolicy(member.vaultId);

  const newVersion = generateVersion();
  const seenAt = parseCursor(body.lastSyncVersion).version;
  const conflicts: PushResponse['conflicts'] = [];
  const rejected: PushResponse['rejected'] = [];

  for (const entity of body.entities) {
    if (!entity.id) continue;

    const stored = await getStoredEntity(member.vaultId, entity.id);

    const decision = decideWrite({
      member,
      entity,
      claimedPath: body.paths?.[entity.id],
      stored: stored ? { path: stored.path, createdBy: stored.createdBy } : null,
      policy,
    });

    if (!decision.allowed) {
      // Filed as a proposal rather than discarded. The id is derived from the
      // document and the proposer, so a client that keeps pushing an
      // unaccepted change refreshes its own request instead of filing a new
      // one on every sync.
      const id = requestId(entity.id, member.actor);

      await putRequest(member.vaultId, {
        id,
        entityId: entity.id,
        // Where it would go if accepted. Falls back to the document's own
        // folder when the claim was the thing that was wrong.
        path: resolvePath(entity, body.paths?.[entity.id]) ?? `${entity.type}/`,
        entity,
        proposedBy: member.actor,
        proposedAt: new Date().toISOString(),
        status: 'open',
        reason: decision.reason,
      });

      rejected.push({ entityId: entity.id, reason: decision.reason, requestId: id });
      continue;
    }

    if (stored && stored.clientId !== body.clientId) {
      // Another client owns the last write. Conflict if the server version
      // is newer than the pushing client's last sync point.
      if (versionIsAfter(stored.serverVersion, seenAt)) {
        conflicts.push({ entityId: entity.id, serverVersion: stored.entity });
        continue;
      }
    }

    // Authorship is stamped from the authenticated member, never from the
    // entity the client sent. Otherwise "who wrote this" would be a claim
    // anyone holding a token could make about anyone else.
    const createdBy = stored?.createdBy ?? member.actor;

    await setStoredEntity(member.vaultId, entity.id, {
      entity: { ...entity, createdBy, updatedBy: member.actor },
      serverVersion: newVersion,
      clientId: body.clientId,
      path: decision.path,
      createdBy,
      updatedBy: member.actor,
    });
  }

  // Counts and timing only. The entities themselves are the user's notes.
  trackEvents(
    event,
    member.vaultId,
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

  return {
    success: true,
    syncVersion: newVersion,
    conflicts,
    rejected,
    actor: member.actor,
  };
});
