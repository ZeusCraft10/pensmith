// bin/lib/verify/name-match.ts — how Pass 1 compares a citation's claimed
// title, first author and year with a registrar's record (Phase 20, VRFY-13,
// D-20-11).
//
// PURE: no I/O. The D-11 AND-gate stays: title Jaro-Winkler ≥
// TITLE_JW_THRESHOLD and first-author Jaro-Winkler ≥ AUTHOR_JW_THRESHOLD, both
// from fuzzy.ts (never duplicated). What changed is what is compared, so that
// real-world spellings of the SAME work pass and a different work still fails:
//
//   - Text is folded first: NFKD with combining marks removed (Müller →
//     muller), every Unicode dash and hyphen (U+2010–U+2015, U+2212, U+FE58,
//     U+FE63, U+FF0D) to `-`, lower case, whitespace collapsed. Non-Latin
//     scripts are compared as they are written — nothing is transliterated on
//     either side.
//   - A title is compared whole and without its subtitle (the text after the
//     first `: `, ` - `, ` – `, ` — ` or `. `), as plain text (registrar
//     markup out, markup.ts); a record's separate subtitle is joined back as
//     one more form. The best score counts.
//   - A name's surname forms: the family name of "Family, Given"; the family
//     of a display name ("Given Family", "A. B. Family"), with lower-case
//     particles (van, der, de, von, …) joined to it; PubMed's compact
//     "Family INITIALS" ("Smith JA", "van den Berg R") read as family
//     `Family`; a BibTeX parse of that compact form ("JA, Smith": family JA,
//     given Smith) also read the right way round; "et al." and trailing
//     initials dropped; a braced corporate name ({The ENCODE Project
//     Consortium}) compared whole, without a leading "The". A surname with
//     particles counts both with and without them ("van der Maaten" and
//     "Maaten"), and a compound surname also counts each of its words
//     ("Reid Chassiakos" — Crossref's family — and "Chassiakos", the family
//     of OpenAlex's display name "Yolanda Reid Chassiakos"; "García Márquez"
//     and "García"): a bibliography often keeps one. The best pair counts.
//   - A name whose family and given parts a registrar deposited the other way
//     round ("Qi, Lin" for Lin Qi — common for names written family-first)
//     also matches crosswise, when BOTH parts match (an initial matches the
//     name it begins).
//   - An editor-only work (an edited volume) compares its first editor.
//   - The year, when both the citation and the record carry one, must be
//     within YEAR_TOLERANCE (an online-first year versus the issue's year);
//     a larger gap is a mismatch of its own.
// A mismatch names the failing fields (`title`, `first author`, `year`).

import { jaroWinkler, TITLE_JW_THRESHOLD, AUTHOR_JW_THRESHOLD } from '../fuzzy.js';
import { plainText } from '../markup.js';

/** How far apart the claimed and the recorded year may be (online-first vs issue year). */
export const YEAR_TOLERANCE = 1;

/** The title threshold a metadata-search match must meet (D-20-11: strict). */
export const STRICT_TITLE_JW = 0.95;

/** Every Unicode dash / hyphen / minus a registrar or a bib may use in place of `-`. */
const DASHES = /[‐-―−﹘﹣－­]/gu;

/** Lower-case particles that belong to a surname (compared with and without them). */
const PARTICLES: ReadonlySet<string> = new Set([
  'van', 'von', 'der', 'den', 'de', 'del', 'della', 'dei', 'di', 'da', 'dos', 'das', 'do', 'du', 'la', 'le', 'ten', 'ter', 'te',
  'zu', 'vom', 'zum', 'bin', 'ben', 'al', 'el', 'abu', 'y', 'e', "d'", "o'",
]);

/**
 * Fold text for comparison: NFKD, combining marks removed, every dash to `-`,
 * lower case, whitespace collapsed. Scripts are kept as written.
 */
export function foldText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(DASHES, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Brackets a translated title is wrapped in, and trailing sentence punctuation. */
function tidyTitle(title: string): string {
  let t = plainText(title).trim();
  // PubMed prints a translated title in square brackets: `[Title].`
  const bracketed = /^\[(.*)\][.]?$/su.exec(t);
  if (bracketed?.[1]) t = bracketed[1];
  return t.replace(/[\s.]+$/u, '');
}

/** The title without its subtitle, or null when it has none. */
export function mainTitle(title: string): string | null {
  const t = tidyTitle(title);
  const m = /^(.+?)(?::\s|\s[-–—‐]\s|\.\s)/su.exec(t);
  const main = m?.[1]?.trim();
  return main && main.length >= 3 && main !== t ? main : null;
}

/** The forms a title is compared in: whole and without its subtitle. */
export function titleForms(title: string, subtitle?: string | null): string[] {
  const whole = tidyTitle(title);
  const forms = new Set<string>([foldText(whole)]);
  const main = mainTitle(whole);
  if (main !== null) forms.add(foldText(main));
  const sub = typeof subtitle === 'string' ? tidyTitle(subtitle) : '';
  if (sub) forms.add(foldText(`${whole}: ${sub}`));
  forms.delete('');
  return [...forms];
}

/** The best Jaro-Winkler score between the claimed title's forms (only its whole form with `whole`) and the record's. */
export function titleSimilarity(record: { title: string | null | undefined; subtitle?: string | null | undefined }, claimed: string, whole = false): number {
  const a = titleForms(record.title ?? '', record.subtitle ?? null);
  const b = whole ? [foldText(tidyTitle(claimed))].filter((x) => x !== '') : titleForms(claimed);
  let best = 0;
  for (const x of a) for (const y of b) best = Math.max(best, jaroWinkler(x, y));
  return best;
}

const INITIALS_TOKEN = /^(?:\p{Lu}\.?-?){1,4}$/u;
const COMPACT_INITIALS = /^\p{Lu}{1,4}$/u;

function isInitialToken(t: string): boolean {
  return INITIALS_TOKEN.test(t);
}

/**
 * A surname, its form without leading particles (when it has any), and — for
 * a compound surname — each of its words that is neither a particle nor an
 * initial ("reid chassiakos" → "chassiakos", "reid").
 */
function withAndWithoutParticles(surname: string): string[] {
  const s = foldText(surname);
  if (!s) return [];
  const words = s.split(' ');
  let i = 0;
  while (i < words.length - 1 && PARTICLES.has(words[i]!)) i++;
  const forms = i > 0 ? [s, words.slice(i).join(' ')] : [s];
  const core = words.slice(i);
  if (core.length > 1) {
    for (const w of core) if (w.length >= 2 && !PARTICLES.has(w) && !/^\p{L}\.?$/u.test(w)) forms.push(w);
  }
  return forms;
}

/** The family name of a display name with no comma ("A. B. Family", "Given van der Family", "Family INITIALS"). */
function displayFamily(name: string): string {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return name;
  // PubMed's compact "Family INITIALS" (and "Family J.A."): trailing initials.
  let end = tokens.length;
  while (end > 1 && (COMPACT_INITIALS.test(tokens[end - 1]!) || isInitialToken(tokens[end - 1]!))) end--;
  if (end < tokens.length) return tokens.slice(0, end).join(' ');
  // "Given [Middle] van der Family[-van der Other]": the family starts at the
  // first lower-case particle after a given name (person-name.ts's rule).
  for (let i = 1; i < tokens.length - 1; i++) {
    if (/^\p{Ll}/u.test(tokens[i]!) && PARTICLES.has(foldText(tokens[i]!))) return tokens.slice(i).join(' ');
  }
  // Otherwise the last token, extended left through particles ("Sofie Van Landeghem").
  let start = tokens.length - 1;
  while (start > 0 && PARTICLES.has(foldText(tokens[start - 1]!))) start--;
  return tokens.slice(start).join(' ');
}

/**
 * The surname forms of one author string (see the header). A braced corporate
 * name is one form, whole. Empty for "et al." or an empty string.
 */
export function surnameForms(author: string | null | undefined): string[] {
  let s = String(author ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  s = s.replace(/[,\s]*\bet\s+al\b\.?$/iu, '').replace(/[,\s]*\band\s+others$/iu, '').trim();
  if (!s) return [];
  const braced = /^\{(.*)\}$/su.exec(s);
  if (braced) {
    const whole = foldText(braced[1] ?? '').replace(/^the\s+/, '');
    return whole ? [whole] : [];
  }
  const forms = new Set<string>();
  if (s.includes(',')) {
    const [familyRaw, ...rest] = s.split(',');
    const family = (familyRaw ?? '').trim();
    const given = rest.join(',').trim();
    for (const f of withAndWithoutParticles(family)) forms.add(f);
    // A BibTeX parse of PubMed's compact "Smith JA" is family "JA", given
    // "Smith": the real family is the given part.
    if (COMPACT_INITIALS.test(family) && /^[\p{L}'’-]+$/u.test(given) && /\p{Ll}/u.test(given)) {
      for (const f of withAndWithoutParticles(given)) forms.add(f);
    }
    if (forms.size === 0 && given) for (const f of withAndWithoutParticles(displayFamily(given))) forms.add(f);
  } else {
    for (const f of withAndWithoutParticles(displayFamily(s))) forms.add(f);
  }
  forms.delete('');
  return [...forms];
}

/**
 * A personal name's family and first given name, folded ("Family, Given…" or a
 * two-word "Given Family"), or null (a corporate name, one word, a longer
 * display name). The given name loses a trailing period (`Q.` → `q`).
 */
function nameParts(author: string | null | undefined): { family: string; given: string } | null {
  let s = String(author ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  s = s.replace(/[,\s]*\bet\s+al\b\.?$/iu, '').trim();
  if (!s || s.startsWith('{')) return null;
  let family: string;
  let given: string;
  if (s.includes(',')) {
    const [f, ...rest] = s.split(',');
    family = (f ?? '').trim();
    given = (rest.join(',').trim().split(' ')[0] ?? '').trim();
  } else {
    const tokens = s.split(' ');
    if (tokens.length !== 2) return null;
    [given, family] = [tokens[0] ?? '', tokens[1] ?? ''];
  }
  const g = foldText(given).replace(/\.$/u, '');
  const f = foldText(family);
  return f && g && !f.includes(' ') ? { family: f, given: g } : null;
}

/**
 * The score of two names read the other way round: one side's family name is
 * the other's given name AND its given name the other's family name ("Qi, Lin"
 * — a registrar deposit with the parts swapped, common for names written
 * family-first — against "Lin, Qi"). Both halves must match; an initial
 * matches a name it begins (`Q.` ↔ `Qi`). 0 when either is not a personal name.
 */
function swappedNameScore(a: string | null | undefined, b: string | null | undefined): number {
  const x = nameParts(a);
  const y = nameParts(b);
  if (x === null || y === null) return 0;
  const half = (family: string, given: string): number => (given.length === 1 ? (family.startsWith(given) ? 1 : 0) : jaroWinkler(family, given));
  return Math.min(half(x.family, y.given), half(y.family, x.given));
}

/**
 * The best Jaro-Winkler score between two authors' surname forms (0 when
 * either has none), or the two names read the other way round when that
 * scores higher (swappedNameScore).
 */
export function authorSimilarity(recordAuthor: string | null | undefined, claimedAuthor: string | null | undefined): number {
  const a = surnameForms(recordAuthor);
  const b = surnameForms(claimedAuthor);
  let best = 0;
  for (const x of a) for (const y of b) best = Math.max(best, jaroWinkler(x, y));
  return Math.max(best, swappedNameScore(recordAuthor, claimedAuthor));
}

/** What a citation claims about the work (D-14 author strings). */
export interface ClaimedWork {
  readonly title: string;
  /**
   * Compare the claimed title only whole, never without its subtitle: the
   * subtitle is one the bibliography entry adds (biblatex `subtitle`,
   * `titleaddon`) and the export prints, so it must be the record's too.
   */
  readonly wholeTitle?: boolean;
  readonly authors: readonly string[];
  /** Editors, for an editor-only work (an edited volume). */
  readonly editors?: readonly string[];
  readonly year: number | null;
}

/** What the registrar's record says. */
export interface RecordWork {
  readonly title: string | null | undefined;
  readonly subtitle?: string | null | undefined;
  readonly authors?: readonly string[] | undefined;
  readonly editors?: readonly string[] | undefined;
  readonly year?: number | null | undefined;
}

export type MatchField = 'title' | 'first author' | 'year';

export interface MatchResult {
  readonly titleJW: number;
  readonly authorJW: number;
  /** The claimed and the recorded year, when both are known. */
  readonly years: { readonly claimed: number; readonly record: number } | null;
  /** The fields that do not match (empty when the record matches). */
  readonly failing: readonly MatchField[];
  readonly ok: boolean;
  /** One clause: `D-11 AND-gate passed (year 2015 = 2015)` or `mismatch: title (0.61 < 0.92), year (claimed 1999, record 2015)`. */
  readonly detail: string;
}

/** The first-author score: the claimed first author (or first editor of an editor-only work) against the record's. */
function firstAuthorScore(claimed: ClaimedWork, record: RecordWork): number {
  const claimedFirst = claimed.authors[0] ?? claimed.editors?.[0];
  const recordFirsts = [record.authors?.[0], ...(claimed.authors.length === 0 || (record.authors ?? []).length === 0 ? [record.editors?.[0]] : [])];
  let best = 0;
  for (const r of recordFirsts) if (r !== undefined) best = Math.max(best, authorSimilarity(r, claimedFirst));
  return best;
}

/**
 * Compare a citation with a registrar record (see the header). `titleThreshold`
 * defaults to TITLE_JW_THRESHOLD (a metadata search passes STRICT_TITLE_JW).
 */
export function matchWork(
  claimed: ClaimedWork,
  record: RecordWork,
  opts: { titleThreshold?: number; authorThreshold?: number; yearTolerance?: number } = {},
): MatchResult {
  const tt = opts.titleThreshold ?? TITLE_JW_THRESHOLD;
  const at = opts.authorThreshold ?? AUTHOR_JW_THRESHOLD;
  const tol = opts.yearTolerance ?? YEAR_TOLERANCE;
  const titleJW = titleSimilarity(record, claimed.title, claimed.wholeTitle === true);
  const authorJW = firstAuthorScore(claimed, record);
  const years =
    typeof claimed.year === 'number' && Number.isInteger(claimed.year) && typeof record.year === 'number' && Number.isInteger(record.year)
      ? { claimed: claimed.year, record: record.year }
      : null;
  const failing: MatchField[] = [];
  const parts: string[] = [];
  if (titleJW < tt) {
    failing.push('title');
    parts.push(`title (${titleJW.toFixed(2)} < ${tt})`);
  }
  if (authorJW < at) {
    failing.push('first author');
    parts.push(`first author (${authorJW.toFixed(2)} < ${at})`);
  }
  if (years !== null && Math.abs(years.claimed - years.record) > tol) {
    failing.push('year');
    parts.push(`year (claimed ${years.claimed}, record ${years.record})`);
  }
  const ok = failing.length === 0;
  const yearNote = years === null ? '' : years.claimed === years.record ? ` (year ${years.claimed})` : ` (year ${years.claimed}, record ${years.record}: within ${tol})`;
  return {
    titleJW,
    authorJW,
    years,
    failing,
    ok,
    detail: ok ? `D-11 AND-gate passed${yearNote}` : `mismatch: ${parts.join(', ')}`,
  };
}
