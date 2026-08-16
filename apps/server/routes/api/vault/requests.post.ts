import { createError, defineEventHandler, readBody } from 'h3';

import { requireMember } from '~/utils/auth';
import { canWritePath } from '~/utils/authz';
import { getRequest, putRequest } from '~/utils/changeRequests';
import { generateVersion, getStoredEntity, setStoredEntity } from '~/utils/syncStore';

interface ReviewPayload {
  id: string;
  action: 'accept' | 'decline';
}

/**
 * Accept or decline a change request.
 *
 * Only someone who can write the folder may decide, which is the same rule
 * that sent the change here in the first place. Accepting applies the proposal
 * as an ordinary write - so it reaches everyone else through the usual pull -
 * and records both people: the content is still the proposer's work, and the
 * review is the reviewer's.
 */
export default defineEventHandler(async (event) => {
  const member = await requireMember(event);
  const body = await readBody<ReviewPayload>(event);

  if (!body?.id || (body.action !== 'accept' && body.action !== 'decline')) {
    throw createError({
      statusCode: 400,
      message: 'id and action ("accept" or "decline") are required',
    });
  }

  const request = await getRequest(member.vaultId, body.id);
  if (!request) {
    throw createError({ statusCode: 404, message: 'No such change request' });
  }

  if (request.status !== 'open') {
    throw createError({
      statusCode: 409,
      message: `This request was already ${request.status}`,
    });
  }

  if (!canWritePath(member, request.path)) {
    throw createError({
      statusCode: 403,
      message: 'Only someone who can write this folder can decide',
    });
  }

  if (request.proposedBy === member.actor) {
    throw createError({
      statusCode: 403,
      message: 'A change request cannot be accepted by the person who proposed it',
    });
  }

  const reviewedAt = new Date().toISOString();

  if (body.action === 'accept') {
    const stored = await getStoredEntity(member.vaultId, request.entityId);

    await setStoredEntity(member.vaultId, request.entityId, {
      // The proposer wrote the content, so authorship stays theirs. OKF's
      // `verified` is exactly a review event, which is what this is - and it
      // is what makes the document human-reviewed rather than merely asserted.
      entity: {
        ...request.entity,
        createdBy: stored?.createdBy ?? request.proposedBy,
        updatedBy: request.proposedBy,
        // `verified` is OKF's own review record, not a field of our Entity
        // union - it rides along as a passthrough key, which is exactly how it
        // reaches the markdown on the other side.
        verified: [...priorReviews(request.entity), { by: member.actor, at: reviewedAt }],
      } as unknown as typeof request.entity,
      serverVersion: generateVersion(),
      // Attributed to the reviewer's decision rather than to any client, so the
      // proposer's own device still pulls the accepted version back.
      clientId: `review:${member.actor}`,
      path: request.path,
      createdBy: stored?.createdBy ?? request.proposedBy,
      updatedBy: request.proposedBy,
    });
  }

  await putRequest(member.vaultId, {
    ...request,
    status: body.action === 'accept' ? 'accepted' : 'declined',
    reviewedBy: member.actor,
    reviewedAt,
  });

  return { id: request.id, status: body.action === 'accept' ? 'accepted' : 'declined' };
});

/**
 * Reviews already recorded on the document.
 *
 * `verified` is OKF's, carried through as an unrecognised key rather than one
 * we model, so it has to be read defensively.
 */
function priorReviews(entity: unknown): unknown[] {
  const value = (entity as Record<string, unknown> | null)?.verified;
  return Array.isArray(value) ? value : [];
}
