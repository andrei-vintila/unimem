// =============================================================================
// Vault members
// =============================================================================
//
// Who shares this vault and what each of them may reach. Only the owner can
// invite or revoke, and only the owner is shown everyone's grants - a grant
// names folders, and a folder someone cannot read is one they should not learn
// the name of.

export interface VaultMember {
  actor: string;
  role: 'owner' | 'member';
  createdAt: string;
  /** Present only when the viewer is the owner. */
  write?: string[];
  read?: string[];
}

export interface Invitation {
  actor: string;
  write: string[];
  read: string[];
  /** Shown once. The server keeps only a hash and cannot show it again. */
  token: string;
}

const members = ref<VaultMember[]>([]);
const you = ref<VaultMember | null>(null);
const isLoading = ref(false);
const error = ref<string | null>(null);

export function useVaultMembers() {
  const settings = useSyncSettings();

  const isOwner = computed(() => you.value?.role === 'owner');

  function headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${settings.authToken.value}`,
      'Content-Type': 'application/json',
    };
  }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${settings.serverUrl.value}${path}`, {
      ...init,
      headers: headers(),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? `${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  async function refresh(): Promise<void> {
    if (!settings.isConfigured.value) {
      members.value = [];
      you.value = null;
      return;
    }

    isLoading.value = true;
    error.value = null;

    try {
      const result = await request<{ you: VaultMember; members: VaultMember[] }>(
        '/api/vault/members'
      );
      you.value = result.you;
      members.value = result.members;
    } catch (cause) {
      error.value = (cause as Error).message;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Invite someone, returning the one and only sight of their token.
   *
   * Grants are bundle path prefixes. An empty `write` invites someone who can
   * read and propose changes but not make them directly - which is a useful
   * thing to be, not a degraded one.
   */
  async function invite(input: {
    actor: string;
    write: string[];
    read: string[];
  }): Promise<Invitation> {
    const invitation = await request<Invitation>('/api/vault/members', {
      method: 'POST',
      body: JSON.stringify(input),
    });

    await refresh();
    return invitation;
  }

  async function revoke(actor: string): Promise<void> {
    await request(`/api/vault/members?actor=${encodeURIComponent(actor)}`, {
      method: 'DELETE',
    });
    await refresh();
  }

  return {
    members: readonly(members),
    you: readonly(you),
    isOwner,
    isLoading: readonly(isLoading),
    error: readonly(error),
    refresh,
    invite,
    revoke,
  };
}

/**
 * Turn what someone typed into grant prefixes.
 *
 * A folder is written with a trailing slash so it cannot be confused with a
 * document of the same name, and `project` typed without one clearly means the
 * folder.
 */
export function parseGrants(input: string): string[] {
  return input
    .split(',')
    .map((entry) => entry.trim().replace(/^\/+/, ''))
    .filter(Boolean)
    .map((entry) => (entry.endsWith('.md') || entry.endsWith('/') ? entry : `${entry}/`));
}

/** How a grant list reads to a person. */
export function describeGrants(grants: readonly string[] | undefined): string {
  if (grants === undefined) return 'everything';
  if (grants.length === 0) return 'nothing';
  if (grants.some((grant) => grant === '' || grant === '*')) return 'everything';
  return grants.join(', ');
}
