// bin/lib/section-slug.ts — resolve a section's slug for the Tier-2 per-section
// verbs (plan / write / verify / revise / add).
//
// Review round 2 (section-registry.ts): a section's identity is its STATE.json
// registration — the same source the router and status walk. OUTLINE.md rows
// are consulted only when nothing is registered yet, and a registered section
// whose OUTLINE row disagrees (a user-renamed slug, a renumbered or deleted
// row) is refused naming `pensmith outline`, so a verb never creates a second
// folder for a registered section number.
//
// Audit #23: those verbs defaulted the slug to the literal 'placeholder' when no
// --slug was passed, so they operated on `.paper/sections/0N-placeholder/` —
// a directory that never matches what `outline` actually registered. The slug
// should come from OUTLINE.md (the roadmap) for section N. An explicit --slug
// still wins; 'placeholder' remains only as the last-resort fallback when
// OUTLINE.md is absent/malformed or has no row for N (e.g. a bare Tier-2 probe
// before any outline exists).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paperDir, projectRoot } from './paths.js';
import { parseOutline } from './outline-parse.js';
import { EXIT_ERROR, EXIT_USAGE, PensmithError } from './exit-codes.js';
import { formatSectionId, parseSectionId, sectionIdOf, sortBySectionId } from './section-id.js';
import { identityLabel, outlineIdentitiesSync, RECONCILE_HINT, registeredSectionsSync, type SectionIdentity } from './section-registry.js';

/**
 * Resolve the slug for section `n`. Precedence:
 *   1. an explicit, non-empty string slug (caller's --slug),
 *   2. the slug STATE.json registers for section `n` (and letter),
 *   3. the slug OUTLINE.md lists for it (nothing registered yet),
 *   4. 'placeholder' (neither has the section).
 *
 * Never throws — a missing or malformed STATE.json / OUTLINE.md falls through.
 */
export function resolveSectionSlug(
  paperRoot: string | undefined,
  n: number,
  explicitSlug?: unknown,
  suffix?: string,
): string {
  if (typeof explicitSlug === 'string' && explicitSlug.length > 0) return explicitSlug;
  const root = paperRoot ?? projectRoot();
  // GRND-09: §1a is its own section (n 1, suffix a); §1 is the one without a letter.
  const match = (s: SectionIdentity): boolean => s.n === n && (s.suffix ?? '') === (suffix ?? '');
  const registered = registeredSectionsSync(root)?.find(match);
  if (registered) return registered.slug;
  const row = outlineIdentitiesSync(root)?.find(match);
  if (row?.slug) return row.slug;
  return 'placeholder';
}

/** The slug shape every section path accepts (paths.ts validateSlug, T-3-12). */
const SLUG_RE = /^[a-z0-9-]+$/;

/** The sections OUTLINE.md lists (id → slug); empty when there is no usable outline. */
function outlineSections(paperRoot: string | undefined): Array<{ n: number; suffix?: string; slug: string }> {
  try {
    const parsed = parseOutline(readFileSync(join(paperDir(paperRoot), 'OUTLINE.md'), 'utf8'));
    return parsed.sections.map((s) => (s.suffix !== undefined ? { n: s.n, suffix: s.suffix, slug: s.slug } : { n: s.n, slug: s.slug }));
  } catch {
    return [];
  }
}

/** Why a registered section's OUTLINE row disagrees with its registration, or null. */
function outlineDisagreement(reg: SectionIdentity, rows: readonly SectionIdentity[]): string | null {
  if (rows.length === 0) return null; // no readable outline: STATE.json alone decides
  const id = identityLabel(reg);
  const bySlug = rows.find((r) => r.slug === reg.slug);
  if (bySlug !== undefined) {
    return identityLabel(bySlug) === id ? null : `OUTLINE.md numbers it §${identityLabel(bySlug)}`;
  }
  const other = rows.find((r) => identityLabel(r) === id);
  return other !== undefined ? `OUTLINE.md lists §${id} as "${other.slug}"` : 'OUTLINE.md does not list it';
}

function describeSections(sections: ReadonlyArray<{ n: number; suffix?: string | undefined }>): string {
  const ids = sortBySectionId(sections.map((s) => sectionIdOf(s.n, s.suffix)));
  const ns = ids.map((id) => id.n);
  const plain = ids.every((id) => id.suffix === undefined);
  const contiguous = plain && ns.every((n, i) => i === 0 || n === (ns[i - 1] as number) + 1);
  if (ids.length > 2 && contiguous) return `${ns[0]}-${ns[ns.length - 1]}`;
  return [...new Set(ids.map(formatSectionId))].join(', ');
}

/** A resolved section argument: the number, the letter (§1a) when it has one, the slug. */
export interface ResolvedSectionArg {
  n: number;
  suffix?: string;
  slug: string;
  /** `1`, `1a` — as the user types and status prints it. */
  id: string;
}

/**
 * Validate a per-section verb's `<n>` (and `--slug`) and resolve its slug
 * (RUN-09: invalid arguments are EXIT_USAGE, one line, before any model call or
 * write):
 *   - `<n>` is a section id: 1..99 with an optional letter (`2`, `1a`,
 *     GRND-09); "abc", "0", "1.5", "1A" are refused;
 *   - `--slug` must be a bare lowercase-kebab slug (path-traversal guard);
 *   - when OUTLINE.md registers sections, `<n>` must be one of them and an
 *     explicit `--slug` must be that section's slug — a registered paper never
 *     gets a `NN-placeholder` folder for a section it does not have. A bare
 *     number with `--slug` names the lettered section with that slug (the
 *     router dispatches §1a as `n: 1, slug`);
 *   - with no usable outline (a bare Tier-2 probe) the resolveSectionSlug
 *     fallback applies.
 */
export function resolveSectionArg(
  verb: string,
  paperRoot: string | undefined,
  rawN: unknown,
  explicitSlug?: unknown,
): ResolvedSectionArg {
  const id = parseSectionId(rawN);
  if (id === null) {
    throw new PensmithError(
      `pensmith ${verb}: <n> must be a section number from 1 to 99; got ${JSON.stringify(rawN ?? '')}`,
      EXIT_USAGE,
    );
  }
  const slugArg = typeof explicitSlug === 'string' && explicitSlug.length > 0 ? explicitSlug : undefined;
  if (slugArg !== undefined && !SLUG_RE.test(slugArg)) {
    throw new PensmithError(
      `pensmith ${verb}: --slug must be lowercase letters, digits and hyphens; got ${JSON.stringify(slugArg)}`,
      EXIT_USAGE,
    );
  }
  const idText = formatSectionId(id);
  // One authority for identity (section-registry.ts): STATE.json's
  // registrations; OUTLINE.md's rows only while nothing is registered.
  const fromState = paperRoot !== undefined ? registeredSectionsSync(paperRoot) ?? [] : [];
  const rows = outlineSections(paperRoot);
  const registered = fromState.length > 0 ? fromState : rows;
  if (registered.length > 0) {
    // A bare number plus --slug may name that number's lettered section.
    const bySlug = slugArg !== undefined && id.suffix === undefined
      ? registered.find((s) => s.slug === slugArg && s.n === id.n)
      : undefined;
    const row = bySlug ?? registered.find((s) => s.n === id.n && (s.suffix ?? '') === (id.suffix ?? ''));
    if (!row) {
      throw new PensmithError(
        `pensmith ${verb}: this paper has no section ${idText} — its outline has section(s) ${describeSections(registered)}`,
        EXIT_USAGE,
      );
    }
    const rowId = formatSectionId(sectionIdOf(row.n, row.suffix));
    if (slugArg !== undefined && slugArg !== row.slug) {
      throw new PensmithError(
        `pensmith ${verb}: section ${rowId} is "${row.slug}" in the outline, not "${slugArg}" — drop --slug or pass --slug ${row.slug}`,
        EXIT_USAGE,
      );
    }
    if (fromState.length > 0) {
      const why = outlineDisagreement(row, rows);
      if (why !== null) {
        throw new PensmithError(
          `pensmith ${verb}: section ${rowId} is "${row.slug}" in STATE.json, but ${why} — ${RECONCILE_HINT}`,
          EXIT_ERROR,
        );
      }
    }
    return row.suffix !== undefined
      ? { n: row.n, suffix: row.suffix, slug: row.slug, id: rowId }
      : { n: row.n, slug: row.slug, id: rowId };
  }
  if (id.suffix !== undefined) {
    throw new PensmithError(
      `pensmith ${verb}: this paper has no outline, so it has no section ${idText} — run \`pensmith outline\` first`,
      EXIT_USAGE,
    );
  }
  return { n: id.n, slug: resolveSectionSlug(paperRoot, id.n, slugArg), id: idText };
}
