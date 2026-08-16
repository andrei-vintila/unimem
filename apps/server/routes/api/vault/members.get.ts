import { defineEventHandler } from 'h3';

import { requireMember } from '~/utils/auth';
import { listMembers } from '~/utils/membership';

/**
 * Who shares this vault.
 *
 * Any member may see who else is here - knowing who to send a change request
 * to is part of using a shared vault, not an administrative privilege. But
 * only the owner sees everyone's grants: a grant names folders, and a folder
 * this member cannot read is one they should not learn the name of. No token
 * or hash is ever returned.
 */
export default defineEventHandler(async (event) => {
  const requester = await requireMember(event);
  const members = await listMembers(requester.vaultId);
  const isOwner = requester.role === 'owner';

  return {
    you: {
      actor: requester.actor,
      role: requester.role,
      write: requester.write,
      read: requester.read ?? [''],
    },
    members: members.map((entry) => ({
      actor: entry.actor,
      role: entry.role,
      createdAt: entry.createdAt,
      ...(isOwner ? { write: entry.write, read: entry.read ?? [''] } : {}),
    })),
  };
});
