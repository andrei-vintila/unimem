import { createError, getHeader, type H3Event } from 'h3';
import { useRuntimeConfig } from 'nitro/runtime-config';

import {
  findMember,
  hashToken,
  isMemberToken,
  putMember,
  vaultHasMembers,
  type Member,
} from './membership';

/**
 * Extract and validate auth token from request
 */
export function getAuthToken(event: H3Event): string | null {
  const authHeader = getHeader(event, 'authorization');

  if (!authHeader) {
    return null;
  }

  // Support both "Bearer token" and just "token" formats
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return authHeader;
}

export interface AuthenticatedMember extends Member {
  /** Hash of the presenting token, for revocation and member listing. */
  tokenHash: string;
}

/**
 * Resolve who is making this request, and what they may write.
 *
 * A token no longer *is* the vault. It resolves to a membership record naming
 * a person and their grants, so several people can share one vault while the
 * server still knows which of them is writing - which is what makes authorship
 * a fact it can stamp rather than a claim it has to take on trust.
 *
 * A token nobody has seen before claims a fresh vault and becomes its owner.
 * That keeps a self-hosted server usable with no signup, and it is why
 * `NITRO_SYNC_TOKENS` matters on anything internet-facing: it gates who may
 * create a vault at all. Minted member tokens skip that check, having already
 * been authorised by the owner who created them.
 */
export async function requireMember(event: H3Event): Promise<AuthenticatedMember> {
  const token = getAuthToken(event);

  if (!token) {
    throw createError({
      statusCode: 401,
      message: 'Authentication required: send a sync token as a bearer token',
    });
  }

  const tokenHash = await hashToken(token);

  const existing = await findMember(tokenHash);
  if (existing) return { ...existing, tokenHash };

  // A minted token that resolves to no member has been revoked. It must be
  // refused outright rather than falling through to the claim path below,
  // which would hand it a fresh empty vault and make revocation look like it
  // had worked while the token still opened something.
  if (isMemberToken(token)) {
    throw createError({
      statusCode: 401,
      message: 'This sync token has been revoked',
    });
  }

  // Unknown token. It may claim a vault, but only an unclaimed one: a vault
  // that already has members is reachable only through a membership record,
  // so a revoked token cannot walk back in by hashing to the same namespace.
  const vaultId = await deriveVaultId(token);

  if (await vaultHasMembers(vaultId)) {
    throw createError({
      statusCode: 403,
      message: 'Sync token is not a member of this vault',
    });
  }

  const allowed = parseAllowedTokens(useRuntimeConfig().syncTokens);
  if (allowed.length > 0 && !allowed.some((candidate) => tokensMatch(candidate, token))) {
    throw createError({
      statusCode: 403,
      message: 'Sync token not recognised',
    });
  }

  const owner: Member = {
    vaultId,
    actor: `human:owner-${vaultId.slice(0, 6)}`,
    role: 'owner',
    write: [''],
    createdAt: new Date().toISOString(),
  };
  await putMember(tokenHash, owner);

  return { ...owner, tokenHash };
}

/** Reject anyone who is not the vault's owner. */
export function requireOwner(member: AuthenticatedMember): void {
  if (member.role !== 'owner') {
    throw createError({
      statusCode: 403,
      message: 'Only the vault owner can manage members',
    });
  }
}

/** Stable, non-reversible vault namespace for a token. */
async function deriveVaultId(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`unimem:vault:${token}`)
  );

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

function parseAllowedTokens(configured: unknown): string[] {
  if (typeof configured !== 'string' || !configured) return [];

  return configured
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Compares in time independent of where the two differ, so a caller cannot
 * recover a configured token one character at a time from response timings.
 * Length still leaks, which is not a useful oracle for a random token.
 */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}
