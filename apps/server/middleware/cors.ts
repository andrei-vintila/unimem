import { defineEventHandler, getHeader, setResponseHeader, setResponseStatus } from 'h3';

// =============================================================================
// CORS for the sync API
// =============================================================================
//
// Every sync client is cross-origin by construction: the web app runs on its
// own domain, and the desktop shell's renderer is on `app://`. Sending a bearer
// token makes each request non-simple, so the browser sends an OPTIONS
// preflight first - and a preflight that goes unanswered fails the request
// before the real handler is ever reached.
//
// `*` is the right origin here precisely because the API authenticates with a
// bearer token rather than a cookie: there is no ambient authority for another
// site to borrow, since it would have to already hold the user's sync token,
// and holding the token is the whole of being authorised.

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  // Without this the browser re-preflights constantly; sync runs on a timer.
  'Access-Control-Max-Age': '86400',
};

export default defineEventHandler((event): string | undefined => {
  if (!event.path.startsWith('/api/')) return undefined;

  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    setResponseHeader(event, name, value);
  }

  // Answer the preflight here. Returning a body short-circuits the chain, so
  // no route handler runs - which is what we want: a preflight carries no
  // credentials and must not be treated as an unauthenticated sync attempt.
  if (event.req.method === 'OPTIONS') {
    setResponseStatus(event, 204);
    return '';
  }

  // Responses vary by origin only in principle today, but caches in front of
  // the Worker should not serve one origin's response to another.
  if (getHeader(event, 'origin')) {
    setResponseHeader(event, 'Vary', 'Origin');
  }

  return undefined;
});
