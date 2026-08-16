import { createError, defineEventHandler, readBody } from 'h3';

import { requireMember, requireOwner } from '~/utils/auth';
import { parseDocowners } from '~/utils/docowners';
import { setPolicySource } from '~/utils/policyStore';

interface PolicyPayload {
  source: string;
}

/**
 * Replace the vault's policy. Owner only.
 *
 * This is the bootstrap that keeps the whole scheme standing up: if the rules
 * lived only in the file they govern, anyone able to write any folder could
 * write themselves into every folder. The owner is the out-of-band root of
 * trust, and it is deliberately not expressible in DOCOWNERS itself.
 */
export default defineEventHandler(async (event) => {
  const member = await requireMember(event);
  requireOwner(member);

  const body = await readBody<PolicyPayload>(event);
  if (typeof body?.source !== 'string') {
    throw createError({ statusCode: 400, message: 'source is required' });
  }

  // Parsed but not validated against the owner: they sit outside the policy by
  // design, the same way a repository admin sits outside branch protection.
  // That is what makes a policy safe to write - there is no way to compose one
  // that nobody can undo.
  const policy = parseDocowners(body.source);

  await setPolicySource(member.vaultId, {
    source: body.source,
    updatedBy: member.actor,
    updatedAt: new Date().toISOString(),
  });

  return { saved: true, rules: policy.rules.length, problems: policy.problems };
});
