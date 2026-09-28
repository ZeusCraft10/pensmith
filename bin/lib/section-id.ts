// bin/lib/section-id.ts — section identity: a number plus an optional letter
// (GRND-09, D-18-16).
//
// A section is `N` (1..99) or, when a re-outline inserted it after §N while a
// kept section followed, `Na` (one lowercase letter; REV-05). Its folder is
// `sections/NN[a]-<slug>/` and is never renamed or renumbered afterwards, so
// the letter is part of the section's identity for good. Everything that
// orders sections — the router, `status`, the estimator, compile and the wave
// scheduler — orders by (n, suffix): 1 < 1a < 1b < 2.
//
// Pure: no fs, no network.

/** One section id: `{n: 1}` is §1, `{n: 1, suffix: 'a'}` is §1a. */
export interface SectionId {
  readonly n: number;
  readonly suffix?: string | undefined;
}

/** The accepted spelling of a section argument (`plan 1a`, `paper://section/1a`). */
export const SECTION_ID_RE = /^(\d{1,2})([a-z])?$/;

/** The largest section number a folder name (`NN`) can carry. */
export const MAX_SECTION_NUMBER = 99;

/** True when `suffix` is a valid section letter. */
export function isSectionSuffix(suffix: unknown): suffix is string {
  return typeof suffix === 'string' && /^[a-z]$/.test(suffix);
}

/**
 * Parse `1`, `12` or `1a` into a SectionId; null for anything else (`0`,
 * `100`, `1A`, `1ab`, `a1`, ``). Surrounding whitespace is ignored.
 */
export function parseSectionId(raw: unknown): SectionId | null {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  const m = SECTION_ID_RE.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SECTION_NUMBER) return null;
  return m[2] !== undefined ? { n, suffix: m[2] } : { n };
}

/** `1`, `1a`. */
export function formatSectionId(id: SectionId): string {
  return `${id.n}${id.suffix ?? ''}`;
}

/** `§1a` (or `#1a` in an ASCII-only terminal). */
export function sectionLabel(id: SectionId, mark = '§'): string {
  return `${mark}${formatSectionId(id)}`;
}

/** Order by number, then letter (no letter first): 1 < 1a < 1b < 2. */
export function compareSectionIds(a: SectionId, b: SectionId): number {
  if (a.n !== b.n) return a.n - b.n;
  const sa = a.suffix ?? '';
  const sb = b.suffix ?? '';
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** A copy of `items` sorted by (n, suffix); stable for equal ids. */
export function sortBySectionId<T extends SectionId>(items: readonly T[]): T[] {
  return [...items].sort(compareSectionIds);
}

/** Same section id? */
export function sameSectionId(a: SectionId, b: SectionId): boolean {
  return a.n === b.n && (a.suffix ?? '') === (b.suffix ?? '');
}

/** `NN[a]` — the folder-name prefix of a section. */
export function sectionFolderPrefix(id: SectionId): string {
  if (!Number.isInteger(id.n) || id.n < 1 || id.n > MAX_SECTION_NUMBER) {
    throw new Error(`section number must be an integer from 1 to ${MAX_SECTION_NUMBER}; got ${id.n}`);
  }
  if (id.suffix !== undefined && !isSectionSuffix(id.suffix)) {
    throw new Error(`section letter must be one lowercase letter; got ${JSON.stringify(id.suffix)}`);
  }
  return `${String(id.n).padStart(2, '0')}${id.suffix ?? ''}`;
}

/** `NN[a]-<slug>` — the section's folder name under `.paper/sections/`. */
export function sectionFolderName(id: SectionId, slug: string): string {
  return `${sectionFolderPrefix(id)}-${slug}`;
}

/** The id without an undefined suffix key (exactOptionalPropertyTypes-safe). */
export function sectionIdOf(n: number, suffix?: string | null): SectionId {
  return suffix !== undefined && suffix !== null && suffix !== '' ? { n, suffix } : { n };
}

/**
 * The section as a model-call record names it (SESSION.log `section`, the COSTS
 * scope id): the number for §1, the text `1a` for a lettered section — so
 * `resume --replay <id>` re-dispatches the section the call was made for.
 */
export function loggedSectionId(n: number, suffix?: string | null): number | string {
  const id = sectionIdOf(n, suffix);
  return id.suffix !== undefined ? formatSectionId(id) : n;
}
