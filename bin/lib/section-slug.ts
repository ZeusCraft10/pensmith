// bin/lib/section-slug.ts — resolve a section's slug for the per-section verbs
// (plan, write, verify, revise, ack).
//
// The slug comes from the outline's section N; an explicit --slug wins. When
// neither names one, the verb is refused: these verbs used to fall back to a
// 'placeholder' slug and work in a new `.paper/sections/0N-placeholder/`
// folder that no outline registered, so the user's real section was never
// touched and the run looked like it had worked.

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
 *      edit of OUTLINE.md waits to be checked, the list as last checked.
 * Null when neither names one (no usable outline, or no section `n`).
 *
 * Never throws.
 */
export function resolveSectionSlug(
  paperRoot: string | undefined,
  n: number,
  explicitSlug?: unknown,
  /** The list as lastCheckedOutline read it, for a caller that already has it. */
  outline?: { sections: ReadonlyArray<{ n: number; slug: string }> } | null,
): string | null {
  if (typeof explicitSlug === 'string' && explicitSlug.length > 0) return explicitSlug;
  const sections = (outline === undefined ? lastCheckedOutline(paperRoot ?? process.cwd()) : outline)?.sections ?? [];
  return sections.find((s) => s.n === n)?.slug ?? null;
}

/**
 * The slug of section `n` for `pensmith <verb> <n>` (resolveSectionSlug), or
 * null after refusing: one line on stderr and exit code 2.
 */
export function sectionSlugArg(
  verb: string,
  paperRoot: string | undefined,
  n: number,
  explicitSlug?: unknown,
  outline?: { sections: ReadonlyArray<{ n: number; slug: string }> } | null,
): string | null {
  const slug = resolveSectionSlug(paperRoot, n, explicitSlug, outline);
  if (slug === null) {
    process.stderr.write(
      `pensmith ${verb}: section ${n} is not in the outline, so there is no such section — ` +
      'run `pensmith outline` first (or `pensmith status` to see the sections), or name the section\'s folder with --slug.\n',
    );
    process.exitCode = EXIT_REFUSED;
  }
  return slug;
}
