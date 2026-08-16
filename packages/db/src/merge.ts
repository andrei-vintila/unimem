// =============================================================================
// Three-way merge
// =============================================================================
//
// Last-write-wins loses work. Two people editing different paragraphs of one
// note, and whoever pushes second silently erases the other - which for prose
// in markdown is the failure people actually hit.
//
// A three-way merge fixes that without any of the machinery a CRDT needs,
// because the pieces are already here: the client knows the version it last
// pulled (the base), it has its own edit (mine), and the server hands back its
// current version on conflict (theirs). That is the whole input to diff3.
//
// Only genuinely overlapping edits - the same lines, changed differently -
// still need a person.

import { merge as diff3 } from 'node-diff3';

import type { Entity } from '@unimem/types';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface MergeResult<T extends Entity = Entity> {
  entity: T;
  /** True when a human has to choose. The body carries conflict markers. */
  conflicted: boolean;
  /** Fields that could not be reconciled without picking a side. */
  conflicts: string[];
}

/** Fields merged by rule rather than carried through. */
const STRUCTURAL = new Set([
  'id',
  'type',
  'content',
  'title',
  'tags',
  'links',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'createdBy',
  'updatedBy',
  'embedding',
]);

// -----------------------------------------------------------------------------
// Merge
// -----------------------------------------------------------------------------

/**
 * Reconcile two versions of an entity against the version they diverged from.
 *
 * `base` is what both sides last agreed on. Without it there is no way to tell
 * an edit from a deletion - which is precisely why last-write-wins throws work
 * away - so a caller with no base should not be calling this.
 */
export function mergeEntities<T extends Entity>(
  base: T,
  mine: T,
  theirs: T
): MergeResult<T> {
  const conflicts: string[] = [];

  const body = mergeText(base.content ?? '', mine.content ?? '', theirs.content ?? '');
  if (body.conflicted) conflicts.push('content');

  const merged: Record<string, unknown> = {
    ...(theirs as unknown as Record<string, unknown>),
    ...(mine as unknown as Record<string, unknown>),
    content: body.text,
    tags: mergeSets(base.tags ?? [], mine.tags ?? [], theirs.tags ?? []),
    links: mergeLinks(base, mine, theirs),
    // Identity and origin never move.
    id: base.id,
    type: base.type,
    createdAt: base.createdAt,
    createdBy: base.createdBy ?? mine.createdBy ?? theirs.createdBy,
    // The merge is a new version, later than either side.
    updatedAt: latest(mine.updatedAt, theirs.updatedAt),
  };

  // A title changed on both sides differently is not something a text merge can
  // settle - there is one of it, and no way to have both.
  const title = mergeScalar(base.title, mine.title, theirs.title);
  merged.title = title.value;
  if (title.conflicted) conflicts.push('title');

  // A deletion on either side wins over an edit on the other. Someone deciding
  // a note should not exist is a stronger statement than someone amending it,
  // and the tombstone is recoverable while an accidental resurrection is not
  // obviously so.
  const deletedAt = mine.deletedAt ?? theirs.deletedAt;
  if (deletedAt) merged.deletedAt = deletedAt;
  else delete merged.deletedAt;

  // Everything else - a person's email, a task's due date - merges per field.
  for (const key of allKeys(base, mine, theirs)) {
    if (STRUCTURAL.has(key)) continue;

    const field = mergeScalar(
      valueOf(base, key),
      valueOf(mine, key),
      valueOf(theirs, key)
    );
    if (field.value === undefined) delete merged[key];
    else merged[key] = field.value;
    if (field.conflicted) conflicts.push(key);
  }

  return {
    entity: merged as unknown as T,
    conflicted: conflicts.length > 0,
    conflicts,
  };
}

// -----------------------------------------------------------------------------
// Text
// -----------------------------------------------------------------------------

export interface TextMerge {
  text: string;
  conflicted: boolean;
}

/**
 * Line-based three-way merge, the same shape git uses.
 *
 * Conflicts are left in the text with markers rather than resolved, because
 * the two sides genuinely disagree and only the person who wrote them knows
 * which is right. Markdown tolerates them as ordinary text, so nothing is lost
 * while the note waits to be sorted out.
 */
export function mergeText(base: string, mine: string, theirs: string): TextMerge {
  if (mine === theirs) return { text: mine, conflicted: false };
  if (base === mine) return { text: theirs, conflicted: false };
  if (base === theirs) return { text: mine, conflicted: false };

  const result = diff3(mine.split('\n'), base.split('\n'), theirs.split('\n'), {
    stringSeparator: '\n',
    // Both sides making the same change is agreement, not a conflict.
    excludeFalseConflicts: true,
    label: { a: 'yours', o: 'base', b: 'theirs' },
  });

  return {
    text: Array.isArray(result.result) ? result.result.join('\n') : String(result.result),
    conflicted: result.conflict,
  };
}

// -----------------------------------------------------------------------------
// Fields
// -----------------------------------------------------------------------------

/**
 * Set merge: adds from both sides survive, and a removal on one side is
 * honoured unless the other side has re-added it.
 */
function mergeSets(base: string[], mine: string[], theirs: string[]): string[] {
  const inBase = new Set(base);
  const inMine = new Set(mine);
  const inTheirs = new Set(theirs);

  const merged = new Set<string>();
  for (const value of new Set([...mine, ...theirs])) {
    const removedByMine = inBase.has(value) && !inMine.has(value);
    const removedByTheirs = inBase.has(value) && !inTheirs.has(value);
    if (!removedByMine && !removedByTheirs) merged.add(value);
  }

  return [...merged];
}

/** Links merge by target, treating the set of edges the way tags are treated. */
function mergeLinks(base: Entity, mine: Entity, theirs: Entity): Entity['links'] {
  const key = (link: Entity['links'][number]) => `${link.targetId}:${link.relationship}`;
  const byKey = new Map<string, Entity['links'][number]>();

  for (const link of [...(theirs.links ?? []), ...(mine.links ?? [])]) {
    byKey.set(key(link), link);
  }

  const kept = mergeSets(
    (base.links ?? []).map(key),
    (mine.links ?? []).map(key),
    (theirs.links ?? []).map(key)
  );

  return kept.map((entry) => byKey.get(entry)!).filter(Boolean);
}

function mergeScalar(
  base: unknown,
  mine: unknown,
  theirs: unknown
): { value: unknown; conflicted: boolean } {
  if (same(mine, theirs)) return { value: mine, conflicted: false };
  if (same(base, mine)) return { value: theirs, conflicted: false };
  if (same(base, theirs)) return { value: mine, conflicted: false };

  // Both changed it, differently. Keeping the local value means the person who
  // hit the conflict still sees their own work; `conflicts` says so out loud.
  return { value: mine, conflicted: true };
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

function latest(a: Date | string, b: Date | string): Date {
  const left = new Date(a).getTime();
  const right = new Date(b).getTime();
  return new Date(Math.max(left, right));
}

function allKeys(...entities: Entity[]): Set<string> {
  const keys = new Set<string>();
  for (const entity of entities) {
    for (const key of Object.keys(entity as unknown as Record<string, unknown>)) {
      keys.add(key);
    }
  }
  return keys;
}

function valueOf(entity: Entity, key: string): unknown {
  return (entity as unknown as Record<string, unknown>)[key];
}
