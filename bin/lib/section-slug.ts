// bin/lib/section-slug.ts — resolve a section's slug for the per-section verbs
// (plan, write, verify, revise, ack).
//
// A section is a phase of the outline, so its folder is the one the outline
// names. With an outline, the slug comes from the outline's section N: a
// section the outline does not have is refused, and so is a --slug that names
// a different folder, since either would make a section folder no outline
// registered. Only with no usable outline does --slug name the folder (tests
// and power users work on a section that way); with neither, the verb is
// refused. These verbs used to fall back to a 'placeholder' slug and work in a
// new `.paper/sections/0N-placeholder/` folder, so the user's real section was
// never touched and the run looked like it had worked.

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

type OutlineList = { sections: ReadonlyArray<{ n: number; slug: string }> } | null;

/** Section `n`'s slug, or why it has none (one sentence, for the refusal). */
function lookUpSlug(
  paperRoot: string | undefined,
  n: number,
  explicitSlug: unknown,
  outline: OutlineList | undefined,
): { slug: string } | { slug: null; why: string } {
  const explicit = typeof explicitSlug === 'string' && explicitSlug.length > 0 ? explicitSlug : null;
  const list = outline === undefined ? lastCheckedOutline(paperRoot ?? process.cwd()) : outline;
  if (list === null) {
    if (explicit !== null) return { slug: explicit };
    return {
      slug: null,
      why: `section ${n} is not in the outline, so there is no such section — ` +
        'run `pensmith outline` first (or `pensmith status` to see the sections), or name the section\'s folder with --slug',
    };
  }
  const registered = list.sections.find((s) => s.n === n)?.slug;
  if (registered === undefined) {
    const have = list.sections.map((s) => s.n).sort((a, b) => a - b).join(', ') || 'none';
    return {
      slug: null,
      why: `section ${n} is not in the outline (its sections are ${have}) — ` +
        'run `pensmith status` to see them, or `pensmith outline` to change the outline',
    };
  }
  if (explicit !== null && explicit !== registered) {
    return {
      slug: null,
      why: `--slug ${explicit} is not section ${n}'s folder: the outline names it '${registered}' — ` +
        'drop --slug, or change the outline with `pensmith outline`',
    };
  }
  return { slug: registered };
}

/**
 * Resolve the slug for section `n`:
 *   - with an outline (outline-read.ts; while a hand edit of OUTLINE.md waits
 *     to be checked, the list as last checked), section `n`'s slug there. An
 *     explicit slug must be that same slug.
 *   - with no usable outline, an explicit, non-empty string slug (--slug).
 * Null when neither gives one, or when an explicit slug is not the outline's.
 *
 * Never throws.
 */
export function resolveSectionSlug(
  paperRoot: string | undefined,
  n: number,
  explicitSlug?: unknown,
  /** The list as lastCheckedOutline read it, for a caller that already has it. */
  outline?: OutlineList,
): string | null {
  return lookUpSlug(paperRoot, n, explicitSlug, outline).slug;
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
  outline?: OutlineList,
): string | null {
  const r = lookUpSlug(paperRoot, n, explicitSlug, outline);
  if (r.slug === null) {
    process.stderr.write(`pensmith ${verb}: ${r.why}.\n`);
    process.exitCode = EXIT_REFUSED;
  }
  return r.slug;
}
