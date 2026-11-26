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

import { EXIT_REFUSED } from './exit-codes.js';
import { lastCheckedOutline } from './outline-read.js';

/** `raw` as a section number (a positive integer), or null. */
export function parseSectionNumber(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * `raw` as the section number of `pensmith <verb> <n>`. Anything else is
 * refused: one line on stderr, exit code 2, and null back.
 */
export function sectionNumberArg(verb: string, raw: unknown): number | null {
  const n = parseSectionNumber(raw);
  if (n === null) {
    process.stderr.write(`pensmith ${verb}: <n> must be a positive integer; got ${JSON.stringify(raw)}\n`);
    process.exitCode = EXIT_REFUSED;
  }
  return n;
}

/**
 * Resolve the slug for section `n`. Precedence:
 *   1. an explicit, non-empty string slug (caller's --slug),
 *   2. the slug of section `n` in the outline (outline-read.ts); while a hand
 *      edit of OUTLINE.md waits to be checked, the list as last checked,
 *   3. 'placeholder' (no usable outline, or no section `n`).
 *
 * Never throws.
 */
export function resolveSectionSlug(
  paperRoot: string | undefined,
  n: number,
  explicitSlug?: unknown,
  /** The list as lastCheckedOutline read it, for a caller that already has it. */
  outline?: { sections: ReadonlyArray<{ n: number; slug: string }> } | null,
): string {
  if (typeof explicitSlug === 'string' && explicitSlug.length > 0) return explicitSlug;
  const sections = (outline === undefined ? lastCheckedOutline(paperRoot ?? process.cwd()) : outline)?.sections ?? [];
  return sections.find((s) => s.n === n)?.slug ?? 'placeholder';
}
