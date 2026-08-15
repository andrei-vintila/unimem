// =============================================================================
// Unimem's OKF profile
// =============================================================================
//
// OKF requires exactly two things of a concept document: parseable YAML
// frontmatter, and a non-empty `type`. Everything else is convention. This
// file is unimem's convention - which OKF fields carry which entity field, and
// which custom keys we add - kept in one place because it is the contract
// every surface has to agree on, not just the code that happens to write it.
//
// Spec: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md

/** Reserved by OKF; never a concept document. */
export const RESERVED_FILENAMES = new Set(['index.md', 'log.md']);

/** URI scheme that makes a document's identity independent of its path. */
export const RESOURCE_PREFIX = 'unimem://entity/';

/**
 * Frontmatter keys this profile assigns meaning to.
 *
 * Anything *not* in here is carried through to the entity untouched and
 * written back out on save - OKF requires consumers to preserve keys they do
 * not recognise, and unimem's own type-specific fields (a person's `email`, a
 * resource's `source_url`) ride the same path.
 */
export const PROFILE_KEYS = new Set([
  // OKF-defined
  'type',
  'title',
  'description',
  'resource',
  'timestamp',
  'tags',
  'status',
  // unimem additions
  'created_at',
  'memory_layer',
  'author',
  'last_edited_by',
  'links',
]);

/**
 * OKF's lifecycle vocabulary. Note this is *not* a project's or task's status:
 * unimem's domain status lives under `state`, because `status: active` on a
 * project would otherwise claim to be an OKF lifecycle value and mean nothing
 * to another consumer. The Obsidian templates predate this and still write
 * `status: active` - see the migration note in the package README.
 */
export type OkfStatus = 'draft' | 'stable' | 'deprecated';

// -----------------------------------------------------------------------------
// Identity
// -----------------------------------------------------------------------------

export function resourceForId(id: string): string {
  return `${RESOURCE_PREFIX}${id}`;
}

/** The entity id inside a resource URI, or null if it is not one of ours. */
export function idFromResource(resource: unknown): string | null {
  if (typeof resource !== 'string') return null;
  if (!resource.startsWith(RESOURCE_PREFIX)) return null;

  const id = resource.slice(RESOURCE_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

// -----------------------------------------------------------------------------
// Actors
// -----------------------------------------------------------------------------

/** `human:andrei`, for the OKF actor convention. */
export function humanActor(id: string): string {
  return `human:${id}`;
}

export function isHumanActor(actor: string | undefined): boolean {
  return typeof actor === 'string' && actor.startsWith('human:');
}

// -----------------------------------------------------------------------------
// Filenames
// -----------------------------------------------------------------------------

/**
 * A filename is presentation, not identity - `resource` is identity. That is
 * what lets someone rename a note in Obsidian without every other device
 * treating it as a new entity.
 */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return slug || 'untitled';
}

/** Disambiguator appended when two entities in a directory slug the same. */
export function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8);
}
