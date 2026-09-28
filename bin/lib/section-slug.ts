// bin/lib/section-slug.ts — resolve a section's slug for the Tier-2 per-section
// verbs (plan / write / verify).
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
import { paperDir } from './paths.js';
import { parseOutline } from './outline-parse.js';
import { EXIT_USAGE, PensmithError } from './exit-codes.js';
import { formatSectionId, parseSectionId, sectionIdOf, sortBySectionId } from './section-id.js';

/**
 * Resolve the slug for section `n`. Precedence:
 *   1. an explicit, non-empty string slug (caller's --slug),
 *   2. the slug registered for section `n` in OUTLINE.md,
 *   3. 'placeholder' (OUTLINE.md absent/malformed, or no row for `n`).
 *
 * Never throws — a missing or malformed OUTLINE.md falls through to (3).
 */
export function resolveSectionSlug(
  paperRoot: string | undefined,
  n: number,
  explicitSlug?: unknown,
): string {
  if (typeof explicitSlug === 'string' && explicitSlug.length > 0) return explicitSlug;
  try {
    const outlinePath = join(paperDir(paperRoot), 'OUTLINE.md');
    const parsed = parseOutline(readFileSync(outlinePath, 'utf8'));
    const section = parsed.sections.find((s) => s.n === n && s.suffix === undefined);
    if (section?.slug) return section.slug;
  } catch {
    // OUTLINE.md absent or malformed — fall through to the placeholder default.
  }
  return 'placeholder';
}

/** The slug shape every section path accepts (paths.ts validateSlug, T-3-12). */
const SLUG_RE = /^[a-z0-9-]+$/;

/** The sections OUTLINE.md registers (id → slug); empty when there is no usable outline. */
function outlineSections(paperRoot: string | undefined): Array<{ n: number; suffix?: string; slug: string }> {
  try {
    const parsed = parseOutline(readFileSync(join(paperDir(paperRoot), 'OUTLINE.md'), 'utf8'));
    return parsed.sections.map((s) => (s.suffix !== undefined ? { n: s.n, suffix: s.suffix, slug: s.slug } : { n: s.n, slug: s.slug }));
  } catch {
    return [];
  }
}

function describeSections(sections: ReadonlyArray<{ n: number; suffix?: string }>): string {
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
  const registered = outlineSections(paperRoot);
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
