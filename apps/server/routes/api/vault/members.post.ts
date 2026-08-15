import { createError, defineEventHandler, readBody } from 'h3';

import { requireMember, requireOwner } from '~/utils/auth';
import {
  generateMemberToken,
  hashToken,
  putMember,
} from '~/utils/membership';

interface InvitePayload {
  /** Who they are, e.g. `human:sam`. */
  actor: string;
  /**
   * Bundle path prefixes they may write: `project/` is a folder and, because a
   * bundle's top-level folder is its entity type, also "all projects".
   * Omit to let them only propose changes rather than make them.
   */
  write?: string[];
  /**
   * Path prefixes they may read. Defaults to what they can write, so an invite
   * that says nothing about reading grants the least that still works rather
   * than the whole vault. Pass `[""]` for a member who should see everything.
   */
  read?: string[];
}

interface InviteResponse {
  actor: string;
  write: string[];
  read: string[];
  /**
   * Shown once. Only its hash is stored, so it cannot be recovered - which is
   * also what stops a leaked backup of the member store from being a set of
   * working credentials.
   */
  token: string;
}

export default defineEventHandler(async (event): Promise<InviteResponse> => {
  const member = await requireMember(event);
  requireOwner(member);

  const body = await readBody<InvitePayload>(event);

  if (!body?.actor || typeof body.actor !== 'string') {
    throw createError({
      statusCode: 400,
      message: 'actor is required, e.g. "human:sam"',
    });
  }

  const write = Array.isArray(body.write) ? body.write.filter(isGrant) : [];
  // Recorded explicitly even when defaulted, so that an absent `read` only
  // ever means "written before reads were scoped" and never "granted today
  // and left open".
  const read = Array.isArray(body.read) ? body.read.filter(isGrant) : [...write];

  const token = generateMemberToken();
  await putMember(await hashToken(token), {
    vaultId: member.vaultId,
    actor: body.actor,
    role: 'member',
    write,
    read,
    createdAt: new Date().toISOString(),
  });

  return { actor: body.actor, write, read, token };
});

/**
 * A grant is a bundle path prefix. Rejecting traversal here as well as at the
 * point of use keeps a stored grant from ever meaning something the owner did
 * not intend.
 */
function isGrant(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !value.startsWith('/') &&
    !value.includes('..') &&
    !value.includes('\\')
  );
}
