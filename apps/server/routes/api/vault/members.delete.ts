import { createError, defineEventHandler, getQuery } from 'h3';

import { requireMember, requireOwner } from '~/utils/auth';
import { listVaultMembers, removeMember } from '~/utils/membership';

/**
 * Revoke a member.
 *
 * By actor rather than by token, because the owner never saw the token again
 * after minting it. Revoking removes the membership record, and an unknown
 * token cannot claim a vault that already has members - so the revoked token
 * is inert rather than merely unprivileged.
 */
export default defineEventHandler(async (event) => {
  const member = await requireMember(event);
  requireOwner(member);

  const actor = getQuery(event).actor as string | undefined;
  if (!actor) {
    throw createError({ statusCode: 400, message: 'actor is required' });
  }

  if (actor === member.actor) {
    throw createError({
      statusCode: 400,
      message: 'The owner cannot revoke themselves',
    });
  }

  const matches = (await listVaultMembers(member.vaultId)).filter(
    (entry) => entry.member.actor === actor
  );

  if (matches.length === 0) {
    throw createError({ statusCode: 404, message: 'No such member' });
  }

  // One actor may hold several tokens - a second device, a reissue. Revoking
  // the person means revoking all of them.
  for (const match of matches) {
    await removeMember(member.vaultId, match.tokenHash);
  }

  return { revoked: actor, tokens: matches.length };
});
