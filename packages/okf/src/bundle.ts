// =============================================================================
// OKF bundle - a directory of concept documents
// =============================================================================
//
// The filesystem is injected rather than imported. Obsidian reaches its vault
// through its own API and never through node:fs, and the desktop shell reaches
// the bundle from the main process - so the bundle logic has to be able to sit
// on top of either. `createNodeBundleFs` is the Node implementation.

import type { Entity } from '@unimem/types';

import {
  documentToEntity,
  entityToDocument,
  parseDocument,
  serializeDocument,
  OkfParseError,
} from './document.js';
import {
  RESERVED_FILENAMES,
  resourceForId,
  shortId,
  slugify,
} from './profile.js';

// -----------------------------------------------------------------------------
// Filesystem port
// -----------------------------------------------------------------------------

export interface BundleFs {
  /** Entry names directly under `path`. Empty array when it does not exist. */
  list(path: string): Promise<string[]>;
  isDirectory(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

export interface Tombstone {
  id: string;
  title: string;
  deletedAt: Date;
  deletedBy?: string;
}

export interface BundleReadResult {
  entities: Entity[];
  /**
   * Documents that carried no `resource` and were given a path-derived one.
   * Their identity is only stable while their path is, so the caller should
   * write them back to claim them - see `OkfStorageAdapter.rebuild`.
   */
  unclaimed: Array<{ path: string; id: string }>;
  /** Deletions recorded in log.md - see `appendDeletion`. */
  tombstones: Tombstone[];
  /** Documents that were not conformant, with the reason. Never thrown. */
  skipped: Array<{ path: string; reason: string }>;
}

/**
 * Read every concept document in the bundle.
 *
 * Malformed documents are collected rather than thrown: OKF requires consumers
 * to tolerate bundles they do not fully understand, and one hand-edited file
 * with a stray tab must not stop a vault from loading.
 */
export async function readBundle(
  fs: BundleFs,
  root: string
): Promise<BundleReadResult> {
  const entities: Entity[] = [];
  const skipped: BundleReadResult['skipped'] = [];
  const unclaimed: BundleReadResult['unclaimed'] = [];

  async function walk(dir: string): Promise<void> {
    for (const name of await fs.list(dir)) {
      const full = join(dir, name);

      if (await fs.isDirectory(full)) {
        await walk(full);
        continue;
      }

      if (!name.endsWith('.md') || RESERVED_FILENAMES.has(name)) continue;

      const relativePath = relative(root, full);

      try {
        const doc = parseDocument(await fs.readFile(full));
        // A document with no `resource` gets an id derived from its path, so
        // the same file yields the same entity on every device that reads it
        // rather than a fresh duplicate each time.
        const fallback = idForPath(relativePath);
        const entity = documentToEntity(doc, fallback);

        if (typeof doc.frontmatter.resource !== 'string') {
          unclaimed.push({ path: relativePath, id: entity.id });
        }
        entities.push(entity);
      } catch (error) {
        skipped.push({
          path: relativePath,
          reason:
            error instanceof OkfParseError
              ? error.message
              : (error as Error).message,
        });
      }
    }
  }

  await walk(root);

  return { entities, tombstones: await readLog(fs, root), skipped, unclaimed };
}

// -----------------------------------------------------------------------------
// Writing
// -----------------------------------------------------------------------------

/**
 * Write an entity into the bundle, returning its bundle-relative path.
 *
 * `knownPaths` maps resource URI to the path an entity already occupies, so a
 * retitled entity moves rather than forking into a second file. Pass the map
 * from a previous `indexPaths` call; omit it and the entity is placed fresh.
 */
export async function writeEntity(
  fs: BundleFs,
  root: string,
  entity: Entity,
  knownPaths?: Map<string, string>
): Promise<string> {
  const dir = entity.type;
  await fs.mkdir(join(root, dir));

  const existing = knownPaths?.get(resourceForId(entity.id));
  const target = await desiredPath(fs, root, dir, entity, existing);

  await fs.writeFile(join(root, target), serializeDocument(entityToDocument(entity)));

  // Retitling moves the note rather than leaving it at a filename that no
  // longer describes it - a vault is read by people, in a file browser, and
  // "Ada King" living in ada-lovelace.md is worse than a rename. Safe because
  // identity is `resource`: other devices match on that, not on the path.
  if (existing && existing !== target) {
    await fs.deleteFile(join(root, existing));
  }

  return target;
}

/**
 * Record a deletion in the bundle-root `log.md` and remove the document.
 *
 * OKF has no tombstone of its own, and `status: deprecated` means "still true,
 * do not build on it" rather than "gone". `log.md` is the reserved file for
 * chronological history, which is exactly what a deletion is - and unlike a
 * column in a database it stays legible to a person reading the vault.
 */
export async function appendDeletion(
  fs: BundleFs,
  root: string,
  tombstone: Tombstone,
  documentPath?: string
): Promise<void> {
  if (documentPath && (await fs.exists(join(root, documentPath)))) {
    await fs.deleteFile(join(root, documentPath));
  }

  const logPath = join(root, 'log.md');
  const existing = (await fs.exists(logPath)) ? await fs.readFile(logPath) : '';

  const day = tombstone.deletedAt.toISOString().slice(0, 10);
  const by = tombstone.deletedBy ? ` by ${tombstone.deletedBy}` : '';
  const entry =
    `* **Deletion**: "${tombstone.title}" ` +
    `(\`${resourceForId(tombstone.id)}\`)${by} at ${tombstone.deletedAt.toISOString()}`;

  await fs.writeFile(logPath, insertLogEntry(existing, day, entry));
}

/** Map resource URI to bundle-relative path, for move-aware writes. */
export async function indexPaths(
  fs: BundleFs,
  root: string
): Promise<Map<string, string>> {
  const paths = new Map<string, string>();

  async function walk(dir: string): Promise<void> {
    for (const name of await fs.list(dir)) {
      const full = join(dir, name);
      if (await fs.isDirectory(full)) {
        await walk(full);
        continue;
      }
      if (!name.endsWith('.md') || RESERVED_FILENAMES.has(name)) continue;

      const relativePath = relative(root, full);

      try {
        const doc = parseDocument(await fs.readFile(full));

        // Falls back to the path-derived identity for the same reason
        // `readBundle` does: a document nobody has claimed yet still has to be
        // findable, or it can never be moved or deleted.
        paths.set(
          typeof doc.frontmatter.resource === 'string'
            ? doc.frontmatter.resource
            : resourceForId(idForPath(relativePath)),
          relativePath
        );
      } catch {
        // Unreadable documents simply have no known path.
      }
    }
  }

  await walk(root);
  return paths;
}

// -----------------------------------------------------------------------------
// log.md
// -----------------------------------------------------------------------------

// Per the spec, index.md and log.md carry no frontmatter and use date headings
// in YYYY-MM-DD form under a top-level title.
const LOG_HEADING = '# Update Log';
const DELETION_ENTRY =
  /^\*\s+\*\*Deletion\*\*:\s+"(.*)"\s+\(`([^`]+)`\)(?:\s+by\s+(\S+))?\s+at\s+(\S+)\s*$/;

async function readLog(fs: BundleFs, root: string): Promise<Tombstone[]> {
  const logPath = join(root, 'log.md');
  if (!(await fs.exists(logPath))) return [];

  const tombstones: Tombstone[] = [];
  for (const line of (await fs.readFile(logPath)).split('\n')) {
    const match = DELETION_ENTRY.exec(line.trim());
    if (!match) continue;

    const [, title, resource, by, at] = match;
    const id = resource.startsWith('unimem://entity/')
      ? resource.slice('unimem://entity/'.length)
      : null;
    const deletedAt = new Date(at);
    if (!id || Number.isNaN(deletedAt.getTime())) continue;

    tombstones.push({ id, title, deletedAt, ...(by ? { deletedBy: by } : {}) });
  }
  return tombstones;
}

function insertLogEntry(existing: string, day: string, entry: string): string {
  if (!existing.trim()) {
    return `${LOG_HEADING}\n\n## ${day}\n\n${entry}\n`;
  }
  if (existing.includes(entry)) return existing;

  const heading = `## ${day}`;
  const at = existing.indexOf(heading);

  // Newest day first, so the top of the file is the recent history.
  if (at === -1) {
    const afterTitle = existing.indexOf('\n', existing.indexOf(LOG_HEADING));
    const head = existing.slice(0, afterTitle + 1);
    const tail = existing.slice(afterTitle + 1);
    return `${head}\n${heading}\n\n${entry}\n${tail}`;
  }

  const insertAt = existing.indexOf('\n', at) + 1;
  return `${existing.slice(0, insertAt)}\n${entry}${existing.slice(insertAt)}`;
}

// -----------------------------------------------------------------------------
// Paths
// -----------------------------------------------------------------------------

/**
 * Where this entity's document belongs now.
 *
 * Returns `existing` unchanged when the entity still slugs to the file it is
 * already in, so an ordinary edit rewrites in place rather than churning the
 * path on every save.
 */
async function desiredPath(
  fs: BundleFs,
  root: string,
  dir: string,
  entity: Entity,
  existing?: string
): Promise<string> {
  const slug = slugify(entity.title);
  const plain = join(dir, `${slug}.md`);

  // Already correctly placed, either plainly or under its disambiguated name.
  if (existing === plain || existing === join(dir, `${slug}-${shortId(entity.id)}.md`)) {
    return existing;
  }

  if (!(await fs.exists(join(root, plain)))) return plain;

  // Two entities that slug the same are still distinct; the id disambiguates.
  return join(dir, `${slug}-${shortId(entity.id)}.md`);
}

/**
 * Deterministic id for a document that carries no `resource`, derived from its
 * path so every device agrees. Formatted as a UUID because the rest of the
 * system stores ids in a UUID column.
 */
function idForPath(path: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < path.length; i++) {
    h1 = Math.imul(h1 ^ path.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + path.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  const hex = (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(2);

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

function join(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}

function relative(root: string, path: string): string {
  return path.startsWith(root) ? path.slice(root.length).replace(/^\/+/, '') : path;
}
