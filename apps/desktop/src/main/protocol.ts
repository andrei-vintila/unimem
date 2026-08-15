// =============================================================================
// The `app://` scheme that serves the generated Nuxt bundle
// =============================================================================
//
// Loading the renderer over `file://` would work but is the wrong trade: every
// `file://` document is a unique opaque origin, so localStorage is unreliable
// (which analytics persistence depends on) and absolute asset paths like
// `/_nuxt/entry.js` resolve against the filesystem root. A registered standard
// scheme gives the app a single stable, secure origin - the same thing the
// `tauri://` scheme did before.

import { net, protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const APP_SCHEME = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://unimem`;

/**
 * PostHog ingestion. The desktop build has no Nitro server to proxy `/_ph`
 * through, so the renderer talks to PostHog directly and the CSP has to say so.
 * Kept in sync with `posthogDirectHost` in the web app's runtime config.
 */
const POSTHOG_HOSTS = 'https://eu.i.posthog.com https://eu-assets.i.posthog.com';

/**
 * `wasm-unsafe-eval` is required: PGlite is a WebAssembly build of Postgres and
 * cannot instantiate without it. It permits WASM compilation only - not `eval`
 * of JavaScript.
 */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${POSTHOG_HOSTS}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  `connect-src 'self' ${POSTHOG_HOSTS}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Must run before `app.whenReady()`. `standard` makes the scheme origin-bearing
 * (so storage and relative URLs behave), `secure` puts it in a secure context
 * (so crypto.subtle, service workers and friends are available).
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ]);
}

/**
 * Resolve a request path to a file inside `root`, or `null` if it escapes.
 *
 * The renderer is trusted-ish, but a request URL is still attacker-reachable
 * (a crafted link, an injected asset reference), and `..` segments in a path
 * that we hand to the filesystem are exactly how a shell like this leaks
 * arbitrary files off disk.
 */
function resolveWithinRoot(root: string, requestPath: string): string | null {
  const decoded = decodeURIComponent(requestPath);
  const candidate = path.resolve(root, `.${path.posix.normalize(decoded)}`);

  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;

  return candidate;
}

async function serveFile(filePath: string): Promise<Response | null> {
  try {
    const response = await net.fetch(pathToFileURL(filePath).toString());
    return response.ok ? response : null;
  } catch {
    return null;
  }
}

/**
 * Serve the prerendered bundle from `rendererRoot`.
 *
 * Resolution order mirrors a static host: exact file, then `<path>/index.html`
 * for prerendered routes, then the root `index.html` so client-side routes that
 * were never prerendered still boot the SPA instead of 404ing.
 */
export function handleAppScheme(rendererRoot: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const { pathname } = new URL(request.url);

    const candidates =
      pathname === '/' || pathname.endsWith('/')
        ? [path.posix.join(pathname, 'index.html')]
        : [pathname, path.posix.join(pathname, 'index.html')];

    for (const candidate of candidates) {
      const resolved = resolveWithinRoot(rendererRoot, candidate);
      if (!resolved) return new Response('Forbidden', { status: 403 });

      const response = await serveFile(resolved);
      if (response) return withSecurityHeaders(response);
    }

    // SPA fallback. Assets must not fall through to HTML - a 404 for a missing
    // script is a readable error, an HTML body served as JavaScript is not.
    if (path.extname(pathname) === '') {
      const fallback = await serveFile(path.join(rendererRoot, 'index.html'));
      if (fallback) return withSecurityHeaders(fallback);
    }

    return new Response('Not Found', { status: 404 });
  });
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', CSP);
  headers.set('X-Content-Type-Options', 'nosniff');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
