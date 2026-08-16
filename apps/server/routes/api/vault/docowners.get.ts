import { defineEventHandler } from 'h3';

import { requireMember } from '~/utils/auth';
import { parseDocowners } from '@unimem/okf';
import { getPolicySource } from '~/utils/policyStore';

/**
 * The vault's policy file.
 *
 * Readable by any member. The rules are not secret - and a member who cannot
 * see a folder learning that it exists is a weaker disclosure than reading it,
 * which is the trade a policy-as-a-file makes and worth making knowingly.
 */
export default defineEventHandler(async (event) => {
  const member = await requireMember(event);
  const stored = await getPolicySource(member.vaultId);

  if (!stored) {
    return { source: null, problems: [], updatedBy: null, updatedAt: null };
  }

  return {
    source: stored.source,
    problems: parseDocowners(stored.source).problems,
    updatedBy: stored.updatedBy,
    updatedAt: stored.updatedAt,
  };
});
