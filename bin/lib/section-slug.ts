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
import { EXIT_REFUSED } from './exit-codes.js';
import { paperDir } from './paths.js';
import { parseOutline } from './outline-parse.js';

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
    const section = parsed.sections.find((s) => s.n === n);
    if (section?.slug) return section.slug;
  } catch {
    // OUTLINE.md absent or malformed — fall through to the placeholder default.
  }
  return 'placeholder';
}
