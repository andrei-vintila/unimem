// =============================================================================
// What this person can edit, answered locally
// =============================================================================
//
// The server decides. This does not.
//
// What it does is tell someone what will happen before they type, rather than
// after a sync refuses them thirty seconds later - which folders are theirs,
// which note is read-only, and when a change is going to be sent as a proposal
// instead of applied. It runs the same parser the server runs, from the same
// DOCOWNERS file, so the two agree; but a client that disagreed would only be
// wrong on screen, never wrong about access.
//
// Anything here being bypassed costs a person a misleading label. Nothing more.

import type { Entity } from '@unimem/types';
import { parseDocowners, policyAllows, slugify, type Policy } from '@unimem/okf';

const policy = ref<Policy | null>(null);
const actor = ref<string | null>(null);
const isOwner = ref(false);
const loaded = ref(false);

export function usePolicy() {
  const settings = useSyncSettings();

  /**
   * Load the policy and who we are.
   *
   * Both come from the server: the policy because that is the copy that
   * governs, and the identity because a device's guess at its own name is not
   * the name access is decided against.
   */
  async function refresh(): Promise<void> {
    if (!settings.isConfigured.value) {
      policy.value = null;
      loaded.value = true;
      return;
    }

    const headers = { Authorization: `Bearer ${settings.authToken.value}` };

    try {
      const [policyResponse, membersResponse] = await Promise.all([
        fetch(`${settings.serverUrl.value}/api/vault/docowners`, { headers }),
        fetch(`${settings.serverUrl.value}/api/vault/members`, { headers }),
      ]);

      if (membersResponse.ok) {
        const me = (await membersResponse.json()).you as {
          actor: string;
          role: string;
        };
        actor.value = me.actor;
        isOwner.value = me.role === 'owner';
      }

      if (policyResponse.ok) {
        const source = ((await policyResponse.json()) as { source: string | null }).source;
        policy.value = source ? parseDocowners(source) : null;
      }
    } catch {
      // Unreachable server means no local answer, which `canWrite` reads as
      // permissive - see below.
      policy.value = null;
    } finally {
      loaded.value = true;
    }
  }

  /**
   * Where this entity lives, or would live, in the bundle.
   *
   * Mirrors the server's own rule that the first segment is the entity's type,
   * so an answer here cannot be more permissive than the one that counts.
   */
  function pathFor(entity: Pick<Entity, 'type' | 'title'>): string {
    return `${entity.type}/${slugify(entity.title || 'untitled')}.md`;
  }

  /**
   * Whether this person may write here.
   *
   * Permissive when unknown - no policy, no identity, no server. A false "you
   * cannot edit this" would stop someone working for no reason, whereas a
   * false "you can" costs them a change request they did not expect, which the
   * server will explain. The safe default for an advisory check is the
   * opposite of the safe default for an enforcing one.
   */
  function canWrite(path: string): boolean {
    if (isOwner.value) return true;
    if (!policy.value || !actor.value) return true;

    return policyAllows(policy.value, actor.value, 'write', path);
  }

  function canWriteEntity(entity: Pick<Entity, 'type' | 'title'>): boolean {
    return canWrite(pathFor(entity));
  }

  /** Folders this person reaches with `access`, for showing them what is theirs. */
  function foldersFor(access: 'read' | 'write'): string[] {
    if (isOwner.value) return ['everything'];
    if (!policy.value || !actor.value) return [];

    return [
      ...new Set(
        policy.value.rules
          .filter(
            (rule) =>
              rule.access === access &&
              (rule.actors.includes(actor.value!) || rule.actors.includes('*'))
          )
          .map((rule) => rule.pattern)
      ),
    ];
  }

  const writableFolders = computed(() => foldersFor('write'));

  /**
   * Write implies read, so a folder someone can edit is one they can see. The
   * server resolves it the same way; listing only the explicit `read` rules
   * would tell someone they cannot see a folder they are editing.
   */
  const readableFolders = computed(() => {
    if (isOwner.value) return ['everything'];
    return [...new Set([...foldersFor('read'), ...foldersFor('write')])];
  });

  return {
    policy: readonly(policy),
    actor: readonly(actor),
    isOwner: readonly(isOwner),
    loaded: readonly(loaded),
    writableFolders,
    readableFolders,
    refresh,
    pathFor,
    canWrite,
    canWriteEntity,
  };
}
