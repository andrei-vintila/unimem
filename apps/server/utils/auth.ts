import { createError, getHeader, type H3Event } from 'h3';
import { useRuntimeConfig } from 'nitro/runtime-config';

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

/**
 * Resolve the vault a request is allowed to touch.
 *
 * There is no account system. The sync token *is* the capability: whoever
 * holds it reaches exactly one vault namespace and nothing else, because the
 * namespace is derived from the token by a one-way hash. Two devices sharing a
 * token share a vault; a different token is a different, empty vault. The
 * token itself is never stored server-side, so a dump of the KV store does not
 * hand an attacker the credential for any vault in it.
 *
 * Set `NITRO_SYNC_TOKENS` (comma-separated) to additionally restrict which
 * tokens are accepted. Leaving it empty means any token opens its own vault -
 * fine for a server only you can reach, not for one exposed to the internet,
 * where an unlisted token would otherwise be free storage.
 */
export async function requireVaultId(event: H3Event): Promise<string> {
  const token = getAuthToken(event);

  if (!token) {
    throw createError({
      statusCode: 401,
      message: 'Authentication required: send a sync token as a bearer token',
    });
  }

  const allowed = parseAllowedTokens(useRuntimeConfig().syncTokens);

  if (allowed.length > 0 && !allowed.some((candidate) => tokensMatch(candidate, token))) {
    throw createError({
      statusCode: 403,
      message: 'Sync token not recognised',
    });
  }

  return deriveVaultId(token);
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
