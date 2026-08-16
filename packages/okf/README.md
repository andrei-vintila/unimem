# @unimem/okf

Unimem's store is a directory of markdown files conforming to the
[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).
This package converts between that bundle and `Entity` objects.

The files are the source of truth. Anything else — the PGlite index, embeddings,
per-device sync state — is derived and can be deleted and rebuilt by re-reading
the bundle.

## Why files

The memory outlives the app. A vault is greppable, diffable, and reviewable by
more than one person without any of them running unimem. OKF is what makes it
legible to other agents too, rather than being merely "our markdown".

## The frontmatter contract

```yaml
---
type: person                                          # OKF, required
title: Ada Lovelace                                   # OKF
resource: unimem://entity/7ade589f-…                  # OKF — identity
timestamp: 2026-08-15T10:00:00.000Z                   # OKF — updatedAt
tags: [maths, history]                                # OKF
status: deprecated                                    # OKF lifecycle — see below
created_at: 2026-08-01T09:00:00.000Z                  # ours
memory_layer: episodic                                # ours
author: human:andrei                                  # ours — createdBy
last_edited_by: human:sam                             # ours — updatedBy
links:                                                # ours — see below
  - target: unimem://entity/cccccccc-…
    type: project
    relationship: works-on
    strength: 0.8
email: ada@example.com                                # type-specific, passed through
---

# Ada Lovelace

Body becomes `content`.
```

Any key not listed above is carried onto the entity and written back
unchanged. OKF requires consumers to preserve what they don't recognise, and
unimem's own type-specific fields ride that same path — there is no separate
mechanism for them.

## Decisions worth arguing with

**`resource` is identity, the filename is not.** Renaming a note in Obsidian
moves the file; the entity is unchanged. Pass the map from `indexPaths()` to
`writeEntity()` so a retitle moves rather than forks.

**Domain status moved to `state`.** OKF defines `status` as a lifecycle —
`draft | stable | deprecated`. A project writing `status: active` would be
claiming an OKF lifecycle value that means nothing to any other consumer, so
unimem's domain status is `state: active` / `state: todo`.

> **Migration:** the Obsidian templates in `plugins/obsidian/main.ts` still
> write `status: active` for projects. They need updating to `state`, along
> with `type: daily` → `type: daily-note`.

**Deletion is a `log.md` entry.** OKF has no tombstone, and `deprecated` means
"still true, don't build on it" rather than "gone". `log.md` is the reserved
file for chronological history, it stays legible to a person reading the vault,
and it attributes the deletion — which matters once more than one person can
delete things.

**Embeddings are never written.** 1536 floats is roughly twenty times the size
of the document carrying them and would make every diff unreadable. They belong
in the derived index.

**Links are lossy in one direction.** OKF treats links as untyped directed
edges; ours carry a relationship and a strength. Keeping them in frontmatter
makes the round trip lossless, at the cost that a generic OKF consumer sees an
unrecognised key rather than graph edges.

## Not done yet

- Mirroring `links` into the body as real markdown links, so generic OKF
  consumers see the graph. Harvesting Obsidian `[[wikilinks]]` from the body is
  the same job from the other side.
- Generating `index.md` per directory (OKF's progressive-disclosure listing).
- `generated` / `verified` provenance, for when consolidation starts writing
  entities and a reader needs to tell an inference from a statement.
