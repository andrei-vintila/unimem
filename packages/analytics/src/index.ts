// =============================================================================
// Unimem Analytics
// =============================================================================
//
// The root entry is transport-free: types, the client contract, the event
// catalog and the sanitizer. It pulls in no SDK.
//
// Adapters are separate entry points so a surface only bundles its own
// transport - the Obsidian plugin and the Cloudflare Worker must not drag
// `posthog-js` in behind them:
//
//   import { createBrowserAnalytics } from '@unimem/analytics/browser';
// =============================================================================

export * from './events.js';
export * from './client.js';
export * from './sanitize.js';
export * from './errors.js';
export * from './redact.js';
