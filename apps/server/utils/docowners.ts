// =============================================================================
// DOCOWNERS - who may touch which documents
// =============================================================================
//
// A superset of CODEOWNERS. A bare line is exactly CODEOWNERS - the listed
// actors own, and may write, the matching path:
//
//     /project/                @sam @andrei
//     /project/internal/       @andrei
//
// Verbs extend it, which is what CODEOWNERS cannot express: it says who must
// approve a change, never who may look.
//
//     read   /person/          @sam
//     write  /task/            @sam
//
// Two deliberate differences from GitHub, both worth knowing:
//
//   * Resolution is most-specific-wins, not last-match-wins. `/project/internal/`
//     overriding `/project/` is what people mean, and GitHub's rule surprises
//     everyone. In practice they agree, because authors write general patterns
//     first and specific ones last.
//   * There are no deny rules. Most-specific-wins already expresses "Sam has
//     project/ but not project/internal/", and deny lists are a reliable source
//     of confusion about what is actually in force.
//
// The policy lives in the vault as a file, so it is versioned, diffable and
// travels with a clone - but the server enforces its *own* copy. A client's
// word for what the rules say is not evidence.

export type Access = 'read' | 'write';

export interface Rule {
  access: Access;
  /** The pattern as written, before matching. */
  pattern: string;
  actors: string[];
  /** Line it came from, for reporting a bad file back to whoever wrote it. */
  line: number;
}

export interface Policy {
  rules: Rule[];
  /** Lines that could not be understood. Never thrown - see `parseDocowners`. */
  problems: Array<{ line: number; text: string; reason: string }>;
}

// -----------------------------------------------------------------------------
// Parsing
// -----------------------------------------------------------------------------

const VERBS = new Set(['read', 'write']);

/**
 * Parse a DOCOWNERS file.
 *
 * Unreadable lines are collected rather than thrown. A policy file is edited by
 * people, and one fat-fingered line must not take the whole vault's
 * authorization with it - the remaining rules still stand, and a rule that
 * failed to parse simply grants nothing.
 */
export function parseDocowners(source: string): Policy {
  const rules: Rule[] = [];
  const problems: Policy['problems'] = [];

  source.split('\n').forEach((raw, index) => {
    const line = index + 1;
    const text = raw.replace(/#.*$/, '').trim();
    if (!text) return;

    const parts = text.split(/\s+/);
    const hasVerb = VERBS.has(parts[0]);
    const access: Access = hasVerb ? (parts[0] as Access) : 'write';
    const [pattern, ...actors] = hasVerb ? parts.slice(1) : parts;

    if (!pattern) {
      problems.push({ line, text, reason: 'No path pattern' });
      return;
    }
    if (actors.length === 0) {
      problems.push({ line, text, reason: 'No actors listed' });
      return;
    }
    if (pattern.includes('..')) {
      problems.push({ line, text, reason: 'Pattern may not contain ".."' });
      return;
    }

    rules.push({ access, pattern, actors: actors.map(normaliseActor), line });
  });

  return { rules, problems };
}

/**
 * `@sam` in a file is `human:sam` everywhere else.
 *
 * CODEOWNERS writes people with an `@`, and a policy file people hand-edit
 * should read like one - but the rest of the system speaks OKF's actor
 * convention, and only one of the two should reach a comparison.
 */
function normaliseActor(actor: string): string {
  if (actor === '*') return '*';
  const bare = actor.startsWith('@') ? actor.slice(1) : actor;
  return bare.includes(':') ? bare : `human:${bare}`;
}

// -----------------------------------------------------------------------------
// Matching
// -----------------------------------------------------------------------------

/**
 * Does this pattern cover this path?
 *
 * Patterns are anchored to the bundle root, with or without a leading slash.
 * A trailing slash means a folder and everything under it. `*` matches within
 * one segment, `**` across segments - the shell conventions CODEOWNERS uses.
 */
export function patternMatches(pattern: string, path: string): boolean {
  const normalised = pattern.replace(/^\/+/, '');

  if (normalised === '' || normalised === '*' || normalised === '**') return true;

  // A folder covers itself and its contents.
  if (normalised.endsWith('/')) {
    return path === normalised || path.startsWith(normalised);
  }

  if (!normalised.includes('*')) {
    // A bare name is a document, or the folder of that name.
    return path === normalised || path.startsWith(`${normalised}/`);
  }

  return globToRegExp(normalised).test(path);
}

function globToRegExp(pattern: string): RegExp {
  let source = '';

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];

    if (char === '*') {
      if (pattern[i + 1] === '*') {
        source += '.*';
        i++;
        // `**/` should also match zero directories.
        if (pattern[i + 1] === '/') i++;
        continue;
      }
      source += '[^/]*';
      continue;
    }

    source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }

  return new RegExp(`^${source}$`);
}

/**
 * How specific a pattern is, for resolution.
 *
 * Deeper wins over shallower, and a literal wins over a wildcard at the same
 * depth - so `/project/internal/` beats `/project/`, and `/project/notes.md`
 * beats `/project/*`.
 */
export function specificity(pattern: string): number {
  const normalised = pattern.replace(/^\/+/, '');
  if (normalised === '' || normalised === '*' || normalised === '**') return 0;

  const segments = normalised.split('/').filter(Boolean);
  const literal = segments.filter((segment) => !segment.includes('*')).length;

  return segments.length * 10 + literal;
}

// -----------------------------------------------------------------------------
// Resolution
// -----------------------------------------------------------------------------

/**
 * Whether `actor` has `access` to `path` under this policy.
 *
 * Only the most specific matching rules for that access are consulted. A less
 * specific rule granting the whole vault does not survive a narrower rule that
 * names someone else - that is the entire point of writing the narrower one.
 *
 * Write implies read, always: someone able to change a document they cannot see
 * would be resolving conflicts against something invisible.
 */
export function policyAllows(
  policy: Policy,
  actor: string,
  access: Access,
  path: string
): boolean {
  if (access === 'read' && policyAllows(policy, actor, 'write', path)) return true;

  const matching = policy.rules.filter(
    (rule) => rule.access === access && patternMatches(rule.pattern, path)
  );
  if (matching.length === 0) return false;

  const strongest = Math.max(...matching.map((rule) => specificity(rule.pattern)));

  return matching
    .filter((rule) => specificity(rule.pattern) === strongest)
    .some((rule) => rule.actors.includes(actor) || rule.actors.includes('*'));
}

/** Everyone who may write a path - the people a change request goes to. */
export function ownersOf(policy: Policy, path: string): string[] {
  const matching = policy.rules.filter(
    (rule) => rule.access === 'write' && patternMatches(rule.pattern, path)
  );
  if (matching.length === 0) return [];

  const strongest = Math.max(...matching.map((rule) => specificity(rule.pattern)));

  return [
    ...new Set(
      matching
        .filter((rule) => specificity(rule.pattern) === strongest)
        .flatMap((rule) => rule.actors)
    ),
  ];
}
