import { defineEventHandler } from 'h3';

import { requireMember } from '~/utils/auth';
import { canReadPath, canWritePath } from '~/utils/authz';
import { listRequests } from '~/utils/changeRequests';
import { loadPolicy } from '~/utils/policyStore';

/**
 * Change requests this member has anything to do with.
 *
 * `toReview` is what they can act on - proposals against folders they write.
 * `mine` is what they have proposed and are waiting on. A proposal against a
 * folder they cannot even read is neither, and is not returned at all.
 */
export default defineEventHandler(async (event) => {
  const member = await requireMember(event);
  const requests = await listRequests(member.vaultId);
  const policy = await loadPolicy(member.vaultId);

  const visible = requests.filter(
    (request) =>
      request.proposedBy === member.actor || canReadPath(member, request.path, policy)
  );

  const summarise = (request: (typeof visible)[number]) => ({
    id: request.id,
    entityId: request.entityId,
    path: request.path,
    title: request.entity.title,
    proposedBy: request.proposedBy,
    proposedAt: request.proposedAt,
    status: request.status,
    reason: request.reason,
    reviewedBy: request.reviewedBy,
    reviewedAt: request.reviewedAt,
  });

  return {
    toReview: visible
      .filter(
        (request) =>
          request.status === 'open' &&
          request.proposedBy !== member.actor &&
          canWritePath(member, request.path, policy)
      )
      .map(summarise),
    mine: visible
      .filter((request) => request.proposedBy === member.actor)
      .map(summarise),
  };
});
