import { useStorage } from 'nitro/storage';

// =============================================================================
// Change requests
// =============================================================================
//
// A write into a folder you cannot write is not an error to be thrown away.
// It is a proposal: this is what I think that document should say. The server
// keeps it, and anyone who *can* write there decides.
//
// That turns the permission boundary from a wall into a workflow. Someone with
// read access to a folder can still contribute to it, and the people
// responsible for it see the suggestion rather than the contributor silently
// losing their work.

import type { Entity } from '@unimem/types';

const NS = 'sync';
const PREFIX = 'request';

export type ChangeRequestStatus = 'open' | 'accepted' | 'declined';

export interface ChangeRequest {
  id: string;
  entityId: string;
  /** Where the document lives, or would live. Reviewers are found by this. */
  path: string;
  /** The content being proposed. */
  entity: Entity;
  proposedBy: string;
  proposedAt: string;
  status: ChangeRequestStatus;
  /** Why the write could not be applied directly. */
  reason: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

function key(vaultId: string, id: string): string {
  return `${PREFIX}:${vaultId}:${id}`;
}

/**
 * One open proposal per person per document.
 *
 * Derived rather than random, so a client that keeps pushing an unaccepted
 * change updates its proposal instead of filing a new one on every sync.
 */
export function requestId(entityId: string, proposedBy: string): string {
  return `${entityId}:${proposedBy.replace(/[^a-zA-Z0-9:_-]/g, '_')}`;
}

export async function putRequest(
  vaultId: string,
  request: ChangeRequest
): Promise<void> {
  await useStorage(NS).setItem(key(vaultId, request.id), request);
}

export async function getRequest(
  vaultId: string,
  id: string
): Promise<ChangeRequest | null> {
  return useStorage(NS).getItem<ChangeRequest>(key(vaultId, id));
}

export async function listRequests(vaultId: string): Promise<ChangeRequest[]> {
  const storage = useStorage(NS);
  const keys = await storage.getKeys(`${PREFIX}:${vaultId}:`);

  const requests: ChangeRequest[] = [];
  for (const entry of keys) {
    const request = await storage.getItem<ChangeRequest>(entry);
    if (request) requests.push(request);
  }

  // Newest first: a reviewer wants the thing that just came in.
  return requests.sort((a, b) => b.proposedAt.localeCompare(a.proposedAt));
}

export async function removeRequest(
  vaultId: string,
  id: string
): Promise<void> {
  await useStorage(NS).removeItem(key(vaultId, id));
}
