import { useStorage } from 'nitro/storage';

// =============================================================================
// The vault's DOCOWNERS file
// =============================================================================
//
// Held server-side because the server is the enforcement point: it must decide
// against its own copy, never against what a client says the rules are.
//
// Clients receive it and write it into the bundle as a plain file, so the
// policy is visible, diffable and travels with a clone - but that copy is a
// projection, the way the index is a projection of the files.

import { parseDocowners, type Policy } from './docowners';

const NS = 'sync';
const KEY = 'docowners';

export interface StoredPolicy {
  source: string;
  updatedBy: string;
  updatedAt: string;
}

export async function getPolicySource(vaultId: string): Promise<StoredPolicy | null> {
  return useStorage(NS).getItem<StoredPolicy>(`${KEY}:${vaultId}`);
}

export async function setPolicySource(
  vaultId: string,
  policy: StoredPolicy
): Promise<void> {
  await useStorage(NS).setItem(`${KEY}:${vaultId}`, policy);
}

/**
 * The vault's policy, or null when it has none.
 *
 * A vault with no DOCOWNERS falls back to the grants on each membership
 * record. That is the migration path: existing vaults keep working untouched,
 * and adopting a policy file is a decision rather than an upgrade side effect.
 */
export async function loadPolicy(vaultId: string): Promise<Policy | null> {
  const stored = await getPolicySource(vaultId);
  return stored ? parseDocowners(stored.source) : null;
}
