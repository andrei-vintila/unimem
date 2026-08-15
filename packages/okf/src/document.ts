// =============================================================================
// OKF concept document <-> unimem entity
// =============================================================================
//
// Deliberately free of any filesystem: Obsidian reaches its vault through its
// own API, the Electron shell through node:fs, and the tests through neither.
// Everything here is string in, string out.

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import type { Entity, EntityLink, EntityType, MemoryLayerType } from '@unimem/types';

import {
  PROFILE_KEYS,
  idFromResource,
  resourceForId,
  type OkfStatus,
} from './profile.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface OkfDocument {
  frontmatter: Record<string, unknown>;
  body: string;
}

export class OkfParseError extends Error {}

// -----------------------------------------------------------------------------
// Text <-> document
// -----------------------------------------------------------------------------

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Split a concept document into frontmatter and body.
 *
 * Throws on a document with no frontmatter or no `type`: those are the only
 * two things OKF actually requires, so a file failing them is not a concept
 * document and guessing at one would put junk in the vault.
 */
export function parseDocument(raw: string): OkfDocument {
  const match = FRONTMATTER.exec(raw);
  if (!match) {
    throw new OkfParseError('Document has no YAML frontmatter');
  }

  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(match[1]);
  } catch (error) {
    throw new OkfParseError(
      `Frontmatter is not valid YAML: ${(error as Error).message}`
    );
  }

  if (typeof frontmatter !== 'object' || frontmatter === null || Array.isArray(frontmatter)) {
    throw new OkfParseError('Frontmatter must be a YAML mapping');
  }

  const fields = frontmatter as Record<string, unknown>;
  if (typeof fields.type !== 'string' || fields.type.trim() === '') {
    throw new OkfParseError('Frontmatter is missing a non-empty `type`');
  }

  return { frontmatter: fields, body: raw.slice(match[0].length) };
}

export function serializeDocument(doc: OkfDocument): string {
  const yaml = stringifyYaml(doc.frontmatter, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${doc.body.replace(/^\n+/, '')}`;
}

// -----------------------------------------------------------------------------
// Document -> entity
// -----------------------------------------------------------------------------

/**
 * A document whose `resource` is not a unimem URI still becomes an entity -
 * someone dropping a hand-written markdown file into the vault should not have
 * to know about our id scheme. `fallbackId` is what it gets instead, and the
 * caller is expected to write the file back with that identity recorded.
 */
export function documentToEntity(doc: OkfDocument, fallbackId: string): Entity {
  const fm = doc.frontmatter;

  const entity: Record<string, unknown> = {
    id: idFromResource(fm.resource) ?? fallbackId,
    type: fm.type as EntityType,
    title: typeof fm.title === 'string' ? fm.title : headingOf(doc.body) ?? 'Untitled',
    content: doc.body.trimEnd(),
    memoryLayer: (fm.memory_layer as MemoryLayerType) ?? layerForType(fm.type as EntityType),
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
    links: parseLinks(fm.links),
    createdAt: toDate(fm.created_at) ?? toDate(fm.timestamp) ?? new Date(),
    updatedAt: toDate(fm.timestamp) ?? new Date(),
  };

  if (typeof fm.author === 'string') entity.createdBy = fm.author;
  if (typeof fm.last_edited_by === 'string') entity.updatedBy = fm.last_edited_by;

  // OKF's lifecycle, not a project's or task's `state`.
  if (fm.status === 'deprecated') {
    entity.deletedAt = toDate(fm.timestamp) ?? new Date();
  }

  // Everything the profile does not claim rides along untouched. OKF requires
  // consumers to preserve unknown keys, and unimem's own type-specific fields
  // (a person's email, a task's due date) arrive through exactly this path.
  for (const [key, value] of Object.entries(fm)) {
    if (!PROFILE_KEYS.has(key)) entity[key] = value;
  }

  return entity as unknown as Entity;
}

// -----------------------------------------------------------------------------
// Entity -> document
// -----------------------------------------------------------------------------

const BASE_FIELDS = new Set([
  'id', 'type', 'title', 'content', 'memoryLayer', 'tags', 'links',
  'createdAt', 'updatedAt', 'deletedAt', 'createdBy', 'updatedBy',
  'embedding',
]);

export function entityToDocument(entity: Entity): OkfDocument {
  const frontmatter: Record<string, unknown> = {
    type: entity.type,
    title: entity.title,
    resource: resourceForId(entity.id),
    timestamp: entity.updatedAt.toISOString(),
    created_at: entity.createdAt.toISOString(),
    memory_layer: entity.memoryLayer,
  };

  if (entity.tags.length > 0) frontmatter.tags = entity.tags;
  if (entity.createdBy) frontmatter.author = entity.createdBy;
  if (entity.updatedBy) frontmatter.last_edited_by = entity.updatedBy;
  if (entity.links.length > 0) frontmatter.links = serializeLinks(entity.links);

  const status: OkfStatus | undefined = entity.deletedAt ? 'deprecated' : undefined;
  if (status) frontmatter.status = status;

  // The embedding is deliberately absent: 1536 floats is twenty times the size
  // of the document that carries them, and it would make every diff unreadable
  // - which is the whole reason the store is files. It is derived data and
  // belongs in the local index.
  for (const [key, value] of Object.entries(entity as unknown as Record<string, unknown>)) {
    if (BASE_FIELDS.has(key) || value === undefined) continue;
    frontmatter[key] = value;
  }

  return { frontmatter, body: entity.content.trimEnd() + '\n' };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function headingOf(body: string): string | null {
  return /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? null;
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Layer assumed for a document that never declared one. */
function layerForType(type: EntityType): MemoryLayerType {
  switch (type) {
    case 'daily-note':
      return 'working';
    case 'task':
      return 'procedural';
    case 'area':
    case 'resource':
      return 'semantic';
    default:
      return 'episodic';
  }
}

/**
 * unimem's links carry a relationship and a strength; OKF's carry neither -
 * it treats every link as an untyped directed edge. Keeping ours in
 * frontmatter is what makes the round trip lossless, at the cost that a
 * generic OKF consumer sees them as an unrecognised key rather than as graph
 * edges. Mirroring them into the body as real markdown links is the obvious
 * next step and is not done here.
 */
function parseLinks(value: unknown): EntityLink[] {
  if (!Array.isArray(value)) return [];

  const links: EntityLink[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;

    const targetId = idFromResource(entry.target);
    if (!targetId) continue;

    links.push({
      targetId,
      targetType: entry.type as EntityType,
      relationship: typeof entry.relationship === 'string' ? entry.relationship : 'related',
      strength: typeof entry.strength === 'number' ? entry.strength : 1,
    });
  }
  return links;
}

function serializeLinks(links: EntityLink[]): Array<Record<string, unknown>> {
  return links.map((link) => ({
    target: resourceForId(link.targetId),
    type: link.targetType,
    relationship: link.relationship,
    strength: link.strength,
  }));
}
