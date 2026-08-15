import { defineEventHandler } from 'h3';

import { requireMember } from '~/utils/auth';
import { listMembers } from '~/utils/membership';

/**
 * Who shares this vault, and what each of them may write.
 *
 * Readable by any member rather than only the owner: in a vault several people
 * write to, knowing who else can change a folder is part of using it, not an
 * administrative privilege. No token or hash is returned.
 */
export default defineEventHandler(async (event) => {
  const member = await requireMember(event);
  const members = await listMembers(member.vaultId);

  return {
    you: { actor: member.actor, role: member.role, write: member.write },
    members: members.map((entry) => ({
      actor: entry.actor,
      role: entry.role,
      write: entry.write,
      createdAt: entry.createdAt,
    })),
  };
});
