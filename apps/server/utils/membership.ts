import { useStorage } from 'nitro/storage';

// =============================================================================
// Vault membership
// =============================================================================
//
// A vault used to be a pure function of its token: hash the token, get the
// namespace. That is why the server could say *which vault* a request belonged
// to but never *who* was making it - and why authorship was only ever a claim
// the client made about itself.
//
// Membership records break that identity apart. A token now resolves to a
// person and their grants, and several tokens can resolve to the same vault.
// The token itself is never stored; only its hash, so a dump of this store
// hands an attacker no credentials.
//
// Bootstrapping is trust-on-first-use: the first token to touch a vault
// becomes its owner. There are no accounts to create, which is the point on a
// server one person self-hosts and then invites a few others into.

const NS = 'sync';
const MEMBER_PREFIX = 'member';
const VAULT_PREFIX = 'vaultmember';

export type MemberRole = 'owner' | 'member';

export interface Member {
  vaultId: string;
  /** OKF actor convention - `human:<id>`. */
  actor: string;
  role: MemberRole;
  /**
   * Bundle path prefixes this member may write.
   *
   * `''` means the whole vault. `'project/'` is a folder, and because a
   * bundle's top-level folder is its entity type, it is also "all projects".
   * `'project/internal/'` is a subfolder within it.
   */
  write: string[];
  /**
   * Path prefixes this member may read. Write access implies read, so this
   * only ever adds to what `write` already reaches.
   *
   * Absent on records written before reads were scoped, and treated as the
   * whole vault - which is what those members already had. New invites always
   * record it explicitly, so the permissive reading applies to nothing that
   * was granted after the fact.
   */
  read?: string[];
  createdAt: string;
}

function memberKey(tokenHash: string): string {
  return `${MEMBER_PREFIX}:${tokenHash}`;
}

/** Secondary index, so a vault can list its own members. */
function vaultMemberKey(vaultId: string, tokenHash: string): string {
  return `${VAULT_PREFIX}:${vaultId}:${tokenHash}`;
}

// -----------------------------------------------------------------------------
// Hashing
// -----------------------------------------------------------------------------

/**
 * Hash a token for storage and lookup.
 *
 * Distinct from `deriveVaultId`'s hash by its prefix, so the value stored here
 * cannot be replayed as a vault id, or the reverse.
 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`unimem:member:${token}`)
  );

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

export async function findMember(tokenHash: string): Promise<Member | null> {
  return useStorage(NS).getItem<Member>(memberKey(tokenHash));
}

/** Every membership record in a vault, paired with the hash that keys it. */
export async function listVaultMembers(
  vaultId: string
): Promise<Array<{ tokenHash: string; member: Member }>> {
  const storage = useStorage(NS);
  const keys = await storage.getKeys(`${VAULT_PREFIX}:${vaultId}:`);

  const entries: Array<{ tokenHash: string; member: Member }> = [];
  for (const key of keys) {
    const tokenHash = key.slice(key.lastIndexOf(':') + 1);
    const member = await findMember(tokenHash);
    if (member) entries.push({ tokenHash, member });
  }
  return entries;
}

export async function listMembers(vaultId: string): Promise<Member[]> {
  return (await listVaultMembers(vaultId)).map((entry) => entry.member);
}

/** Whether this vault has been claimed yet. */
export async function vaultHasMembers(vaultId: string): Promise<boolean> {
  const keys = await useStorage(NS).getKeys(`${VAULT_PREFIX}:${vaultId}:`);
  return keys.length > 0;
}

// -----------------------------------------------------------------------------
// Writing
// -----------------------------------------------------------------------------

export async function putMember(
  tokenHash: string,
  member: Member
): Promise<void> {
  const storage = useStorage(NS);
  await storage.setItem(memberKey(tokenHash), member);
  await storage.setItem(vaultMemberKey(member.vaultId, tokenHash), true);
}

export async function removeMember(
  vaultId: string,
  tokenHash: string
): Promise<void> {
  const storage = useStorage(NS);
  await storage.removeItem(memberKey(tokenHash));
  await storage.removeItem(vaultMemberKey(vaultId, tokenHash));
}

/**
 * Marks a token as minted for a member rather than chosen by someone claiming
 * a vault. Without it a revoked token would fall through to trust-on-first-use
 * and quietly be handed a brand new empty vault of its own instead of being
 * refused - revocation that reads as success.
 */
export const MEMBER_TOKEN_PREFIX = 'unimem_m_';

export function isMemberToken(token: string): boolean {
  return token.startsWith(MEMBER_TOKEN_PREFIX);
}

/**
 * Mint a token for a new member.
 *
 * Returned once and never stored, so it cannot be recovered later - which is
 * also what makes the store safe to lose. 32 bytes from the platform CSPRNG.
 */
export function generateMemberToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${MEMBER_TOKEN_PREFIX}${hex}`;
}
