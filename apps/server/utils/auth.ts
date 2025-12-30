import type { H3Event } from 'h3';

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
 * Require authentication for an endpoint
 */
export async function requireAuth(event: H3Event): Promise<string> {
  const token = getAuthToken(event);

  if (!token) {
    throw createError({
      statusCode: 401,
      message: 'Authentication required',
    });
  }

  // TODO: Validate token (JWT, API key, etc.)
  // For now, just return the token as client ID

  return token;
}

/**
 * Generate a unique client ID
 */
export function generateClientId(): string {
  return `client_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}
