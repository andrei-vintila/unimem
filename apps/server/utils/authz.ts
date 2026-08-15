// =============================================================================
// Who may write where
// =============================================================================
//
// Grants are bundle path prefixes. A bundle's top-level folder is the entity
// type, so `project/` reads as both "the project folder" and "all projects",
// and `project/internal/` scopes further within it.
//
// The load-bearing rule is that the server does not take the client's word for
// where a document lives. A writer scoped to `task/` would otherwise push a
// person and call it `task/anything.md`, and a writer scoped to a public
// folder could launder a document out of a private one by pushing it back
// under a new path. Both are checked below.

import type { Entity } from '@unimem/types';

import type { Member } from './membership';

/** A grant covering the entire vault. */
export const GRANT_ALL = '';

// -----------------------------------------------------------------------------
// Paths
// -----------------------------------------------------------------------------

/**
 * The path this entity is allowed to occupy, given what the client claims.
 *
 * The first segment is not negotiable: it is the entity's own type, which the
 * server can see. Deeper segments are the client's to choose, because a person
 * filing their notes into subfolders is not a security decision - it only has
 * to stay inside the folder their type puts them in.
 *
 * Returns null when the claim is inconsistent with the entity, which is a
 * request to reject rather than to correct.
 */
export function resolvePath(entity: Entity, claimed: unknown): string | null {
  // Widened deliberately: `type` is typed as a union, but it arrives from the
  // network, so it is a string until proven otherwise.
  const type = entity.type as string;
  if (typeof type !== 'string' || type.length === 0 || type.includes('/')) {
    return null;
  }

  if (typeof claimed !== 'string' || claimed === '') {
    // No claim: scope it to the entity's own folder.
    return `${type}/`;
  }

  const normalized = claimed.replace(/^\/+/, '');
  if (normalized.includes('..') || normalized.includes('\\')) return null;

  const [first] = normalized.split('/');
  if (first !== type) return null;

  return normalized;
}

// -----------------------------------------------------------------------------
// Grants
// -----------------------------------------------------------------------------

/**
 * Prefix match, on folder boundaries.
 *
 * `project/` covers `project/internal/x.md`; it must not also cover
 * `project-secrets/x.md`, which a naive `startsWith` would let through.
 */
export function grantCovers(grant: string, path: string): boolean {
  if (grant === GRANT_ALL || grant === '*') return true;

  if (grant.endsWith('/')) return path === grant || path.startsWith(grant);

  // A grant naming a single document, or a folder written without its slash.
  return path === grant || path.startsWith(`${grant}/`);
}

export function canWritePath(member: Member, path: string): boolean {
  return member.write.some((grant) => grantCovers(grant, path));
}

// -----------------------------------------------------------------------------
// Decisions
// -----------------------------------------------------------------------------

export interface WriteRequest {
  member: Member;
  entity: Entity;
  /** Where the client says this document lives. */
  claimedPath: unknown;
  /** What the server already holds, if anything. */
  stored?: { path: string; createdBy?: string } | null;
}

export type WriteDecision =
  | { allowed: true; path: string }
  | { allowed: false; reason: string };

/**
 * Decide a single write.
 *
 * Creators keep write access to what they made regardless of grants - a person
 * invited to a folder should not lose their own notes when their grants change
 * - but that only applies to the document's *current* location, so it cannot
 * be used to move something into a folder they were never given.
 */
export function decideWrite({
  member,
  entity,
  claimedPath,
  stored,
}: WriteRequest): WriteDecision {
  const path = resolvePath(entity, claimedPath);
  if (path === null) {
    return {
      allowed: false,
      reason: `Path does not belong to a ${entity.type}`,
    };
  }

  const isCreator = stored?.createdBy !== undefined && stored.createdBy === member.actor;

  // Where it already is. Without this, a member could take a document out of a
  // folder they cannot write by pushing it back under one they can.
  if (stored && !canWritePath(member, stored.path) && !isCreator) {
    return {
      allowed: false,
      reason: `No write access to ${folderOf(stored.path)}`,
    };
  }

  // Where it is going.
  if (!canWritePath(member, path) && !isCreator) {
    return { allowed: false, reason: `No write access to ${folderOf(path)}` };
  }

  return { allowed: true, path };
}

function folderOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at === -1 ? path : path.slice(0, at + 1);
}
