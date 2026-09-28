// bin/lib/bibtex-write.ts — source records -> BibTeX serializer for
// .paper/CITATIONS.bib (SRC-12 / D-19-19; D-07 atomic-write chokepoint;
// BRDTH-01 one library writer).
//
// BRDTH-01 / D-17-43: .paper/CITATIONS.bib is RENDERED from LIBRARY.json by the
// one library writer (bin/lib/library.ts). Only library.ts may call
// renderBibtex / writeBibtex (chokepoint row `library-writer`); every ingest
// path goes through upsertSources instead. The input is the structural
// BibSource shape, which both a LIBRARY.json v3 entry and a research
// SourceCandidate satisfy.
//
// SRC-12 (D-19-19) — what an entry carries, so a reference can be formatted
// from the bib alone and the bib always parses back as the same work:
//   - names parsed by person-name.ts ("Family, Given[, Suffix]", "Given
//     Family" with lower-case particles joining the family, "{Corporate}",
//     a single token = family) and written as raw UTF-8 — never `{\u …}`
//     escapes, which the old citation-js formatter produced for Cyrillic and
//     its own parser then rejected (E2E-12). A family name with a space or a
//     lower-case first letter is braced ({van der Maaten}, Laurens), so BibTeX
//     never splits it into a particle and a family;
//   - title, abstract, journal / booktitle, volume, number (issue), pages,
//     publisher (institution / school), editor, isbn, doi, eprint +
//     archivePrefix = {arXiv} + primaryClass for arXiv works, note = {RETRACTED};
//   - the entry type from the CSL `type`: article-journal / -newspaper /
//     -magazine → @article, book → @book, chapter → @incollection,
//     paper-conference → @inproceedings, report → @techreport, thesis →
//     @phdthesis, preprint / dataset / webpage / other → @misc.
//
// The serializer is written here, not delegated to citation-js's BibTeX
// formatter: that formatter escapes non-ASCII as LaTeX its parser cannot read,
// drops abstracts and eprints, and cannot keep a particle in the family name.
// Every entry is still parsed back through the ONE parser verify, compile and
// done use (citations.ts parseBibSync, the citation-js chokepoint) before it
// is returned; an entry that does not read back as the same work throws
// BibRenderError and library.ts refuses the write.
//
// Value encoding (escapeBibtexUtf8): NFC, control characters dropped,
// whitespace collapsed, the BibTeX-special ASCII characters escaped
// (\ { } $ & % # _ ~ ^ `), and the TeX ligatures -- --- '' broken with an
// empty group, so every character the library holds comes back exactly.
//
// Citekey strategy:
//   - Entries are keyed by their (collision-suffixed) citekeys. Collisions
//     resolve via base-26 spreadsheet-column encoding (seen=1 -> 'a', 26 -> 'z',
//     27 -> 'aa', …). (Library citekeys are already unique — LIBRARY.json
//     enforces it — so this only fires for callers that hand in raw candidates.)
//   - Entries are sorted by final citekey (diff-stable output).
//
// Which sources are written: those with a persistent identifier (DOI, ISBN,
// arXiv id, PMID, PMCID) and bring-your-own PDFs (their hashes identify them;
// VRFY-14 checks them). A source with neither cannot be cited and is dropped.
//
// Empty array: renderBibtex([]) is '' and writeBibtex([], target) writes a
// zero-length file (verify reads CITATIONS.bib; it must never ENOENT just
// because a paper has zero sources).

import { parseBibSync } from './citations.js';
import { atomicWriteFile } from './atomic-write.js';
import { generateCitekey } from './citekey.js';
import { parsePersonName, type PersonName } from './person-name.js';
import { normArxiv, normDoi, normIsbn, normPmcid, normPmid } from './migrations/library/shape.js';

/**
 * The fields the BibTeX/RIS renderers read. A LIBRARY.json v3 entry and a
 * research SourceCandidate both satisfy it structurally.
 */
export interface BibSource {
  citekey: string;
  title?: string | null | undefined;
  authors?: string[] | undefined;
  year?: number | null | undefined;
  doi?: string | null | undefined;
  isbn?: string | null | undefined;
  /** Bare arXiv id (LIBRARY.json). */
  arxiv?: string | null | undefined;
  /** Legacy spelling carried by bib-derived candidates. */
  arxivId?: string | null | undefined;
  pmid?: string | null | undefined;
  pmcid?: string | null | undefined;
  retracted?: boolean | undefined;
  /** SourceCandidate adapter name — 'arxiv' renders as a preprint. */
  source?: string | undefined;
  /** SourceCandidate id (the arXiv id when `source` is 'arxiv'). */
  id?: string | undefined;
  venue?: string | null | undefined;
  abstract?: string | null | undefined;
  /** CSL type (schemas/source-types.ts). */
  type?: string | null | undefined;
  publisher?: string | null | undefined;
  volume?: string | number | null | undefined;
  issue?: string | number | null | undefined;
  pages?: string | null | undefined;
  editors?: string[] | undefined;
  /** A bring-your-own PDF record (SRC-15): such a source is citable without a registrar id. */
  byo?: { file: string; sha256: string } | null | undefined;
}

// ---------------------------------------------------------------------------
// Identifiers and type.
// ---------------------------------------------------------------------------

interface Ids {
  doi: string | null;
  isbn: string | null;
  arxiv: string | null;
  pmid: string | null;
  pmcid: string | null;
}

function idsOf(c: BibSource): Ids {
  // A LIBRARY entry's DOI is already doi.ts-normalized; a raw candidate's DOI
  // that does not normalize is still its identifier and is written as given.
  const doi = normDoi(c.doi) ?? (typeof c.doi === 'string' && c.doi.trim() ? c.doi.trim() : null);
  const arxiv =
    normArxiv(c.arxiv) ??
    normArxiv(c.arxivId) ??
    (c.source === 'arxiv' && typeof c.id === 'string' ? normArxiv(c.id) : null) ??
    (doi ? normArxiv(doi) : null);
  return { doi, isbn: normIsbn(c.isbn), arxiv, pmid: normPmid(c.pmid), pmcid: normPmcid(c.pmcid) };
}

function citable(c: BibSource, ids: Ids): boolean {
  return Boolean(ids.doi || ids.isbn || ids.arxiv || ids.pmid || ids.pmcid || c.byo);
}

/** A DataCite arXiv DOI (10.48550/arxiv.<id>) — the arXiv record, not a journal version. */
function isArxivDoi(doi: string | null): boolean {
  return doi !== null && normArxiv(doi) !== null;
}

const KNOWN_TYPES = new Set([
  'article-journal', 'paper-conference', 'chapter', 'book', 'report', 'thesis', 'preprint', 'dataset',
  'article-newspaper', 'article-magazine', 'webpage', 'other',
]);

/** The CSL type of a source: its recorded `type`, else inferred from its identifiers. */
export function cslTypeOf(c: BibSource): string {
  if (typeof c.type === 'string' && KNOWN_TYPES.has(c.type)) return c.type;
  const ids = idsOf(c);
  if (ids.arxiv && (!ids.doi || isArxivDoi(ids.doi))) return 'preprint';
  if (c.source === 'arxiv') return 'preprint';
  if (!ids.doi && ids.isbn) return 'book';
  // A bring-your-own PDF no registrar identified: nothing says what kind of work it is.
  if (!ids.doi && !ids.pmid && !ids.pmcid && c.byo) return 'other';
  return 'article-journal';
}

const BIBTEX_TYPE: Readonly<Record<string, string>> = {
  'article-journal': 'article',
  'article-newspaper': 'article',
  'article-magazine': 'article',
  book: 'book',
  chapter: 'incollection',
  'paper-conference': 'inproceedings',
  report: 'techreport',
  thesis: 'phdthesis',
  preprint: 'misc',
  dataset: 'misc',
  webpage: 'misc',
  other: 'misc',
};

// ---------------------------------------------------------------------------
// Value encoding.
// ---------------------------------------------------------------------------

/**
 * Normalize a text value the way the bib stores it: NFC, control characters
 * dropped, whitespace runs collapsed to one space, trimmed. This is the form a
 * value reads back in (the round trip is exact on it).
 */
export function normalizeBibValue(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// The BibTeX-special ASCII characters. Braces are written as \textbraceleft{} /
// \textbraceright{} (not \{ \}) so every value keeps balanced braces for BibTeX
// itself; `<`/`>` stay raw (citation-js reads them as the rich-text tags —
// <i>, <sub> — Crossref titles carry).
const BIBTEX_SPECIAL: Readonly<Record<string, string>> = {
  '\\': '\\textbackslash{}',
  '{': '\\textbraceleft{}',
  '}': '\\textbraceright{}',
  $: '\\textdollar{}',
  '&': '\\&',
  '%': '\\%',
  '#': '\\#',
  _: '\\textunderscore{}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  '`': '\\textasciigrave{}',
};

/**
 * Encode a text value for a braced BibTeX field: normalizeBibValue, the
 * special ASCII characters escaped, and the TeX ligatures `--`, `---` and `''`
 * broken with an empty group (`-{}-`, `'{}'`) so they read back as typed.
 */
export function escapeBibtexUtf8(value: string): string {
  return normalizeBibValue(value)
    .replace(/[\\{}$&%#_~^`]/g, (ch) => BIBTEX_SPECIAL[ch] ?? ch)
    .replace(/-(?=-)/g, '-{}')
    .replace(/'(?=')/g, "'{}");
}

/** A verbatim field (doi, eprint): written as is; null when it cannot be (unbalanced braces). */
function verbatim(value: string): string | null {
  const v = value.trim();
  let depth = 0;
  for (const ch of v) {
    if (ch === '{') depth++;
    else if (ch === '}' && --depth < 0) return null;
  }
  return depth === 0 && !/[\r\n\\]/.test(v) ? v : null;
}

/** A name-list or publisher-list value containing the word "and" must be braced whole. */
function hasAndToken(s: string): boolean {
  return /(?:^|\s)and(?:\s|$)/i.test(s);
}

/**
 * A name part BibTeX's name grammar would re-tokenize: the word "and", or a
 * hyphen at a word edge ("Jean -Paul", "X- y"), which BibTeX reads as a
 * token separator. Such a part is braced so it reads back verbatim.
 */
function needsNameBraces(s: string): boolean {
  return hasAndToken(s) || /(?:^|\s)-|-(?:\s|$)/.test(s);
}

/**
 * True when BibTeX would not read `family` back as one family name: it has a
 * space, or a space- or hyphen-separated part whose first cased letter is
 * lower case (BibTeX's "von" rule: "van der Maaten" → particle "van der" +
 * "Maaten"; "de-Souza" → "de" + "Souza"), or a part the name grammar
 * re-tokenizes.
 */
function familyNeedsBraces(family: string): boolean {
  if (/\s/.test(family) || needsNameBraces(family)) return true;
  return family.split('-').some((part) => {
    const cased = /[\p{Lu}\p{Ll}\p{Lt}]/u.exec(part);
    return cased !== null && /\p{Ll}/u.test(cased[0]);
  });
}

/** One personal / corporate name in BibTeX "Family, Given" form. */
export function bibtexName(n: PersonName): string {
  const family = escapeBibtexUtf8(n.family);
  if (n.literal) return `{${family}}`;
  // Brace a family BibTeX would otherwise split ("van der Maaten" → a "van der"
  // particle and "Maaten") or read as a name-list separator.
  const bracedFamily = familyNeedsBraces(n.family) ? `{${family}}` : family;
  const given = n.given ? escapeBibtexUtf8(n.given) : '';
  const givenOut = given && needsNameBraces(n.given ?? '') ? `{${given}}` : given;
  if (n.suffix) {
    const suffix = escapeBibtexUtf8(n.suffix);
    return givenOut ? `${bracedFamily}, ${suffix}, ${givenOut}` : `{${family} ${suffix}}`;
  }
  return givenOut ? `${bracedFamily}, ${givenOut}` : bracedFamily;
}

/** Parsed names of a display-string list (empty strings dropped). */
export function parseNames(list: readonly string[] | undefined): PersonName[] {
  return (list ?? []).map((a) => parsePersonName(a)).filter((n): n is PersonName => n !== null);
}

/** "436-444" / "436–444" → "436--444"; any other page string escaped as text. */
function bibtexPages(pages: string): string {
  const p = normalizeBibValue(pages);
  const range = /^([^\s\-–—]+)\s*(?:-+|–|—)\s*([^\s\-–—]+)$/.exec(p);
  if (range) return `${escapeBibtexUtf8(range[1]!)}--${escapeBibtexUtf8(range[2]!)}`;
  return escapeBibtexUtf8(p);
}

function text(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const s = normalizeBibValue(v);
  return s.length > 0 ? s : null;
}

/** The primary arXiv class of an old-style id ("hep-th/9901001" → "hep-th"), else null. */
function primaryClassOf(arxiv: string): string | null {
  const slash = arxiv.indexOf('/');
  return slash > 0 ? arxiv.slice(0, slash) : null;
}

// ---------------------------------------------------------------------------
// Entries.
// ---------------------------------------------------------------------------

/** One rendered entry (the fields in writing order). */
export interface BibRecord {
  readonly citekey: string;
  /** BibTeX entry type without the `@`. */
  readonly entryType: string;
  readonly fields: ReadonlyArray<readonly [string, string]>;
  /** What the round-trip check compares against. */
  readonly expect: {
    readonly title: string;
    readonly authors: readonly PersonName[];
    readonly abstract: string | null;
    readonly eprint: string | null;
  };
}

/** The BibTeX record for one citable source (null when it has no identifier and no BYO PDF). */
export function toBibRecord(c: BibSource, citekey: string): BibRecord | null {
  const ids = idsOf(c);
  if (!citable(c, ids)) return null;
  const csl = cslTypeOf(c);
  const entryType = BIBTEX_TYPE[csl] ?? 'misc';
  const fields: Array<[string, string]> = [];
  const push = (name: string, value: string | null): void => {
    if (value !== null && value.length > 0) fields.push([name, value]);
  };

  const authors = parseNames(c.authors);
  const editors = parseNames(c.editors);
  const nameList = (names: PersonName[]): string | null => (names.length > 0 ? names.map(bibtexName).join(' and ') : null);
  push('author', nameList(authors));
  push('editor', nameList(editors));

  const title = text(c.title) ?? citekey;
  push('title', escapeBibtexUtf8(title));

  const venue = text(c.venue);
  const publisher = text(c.publisher);
  const listValue = (s: string): string => (hasAndToken(s) ? `{${escapeBibtexUtf8(s)}}` : escapeBibtexUtf8(s));
  if (venue) {
    if (entryType === 'article') push('journal', escapeBibtexUtf8(venue));
    else if (entryType === 'incollection' || entryType === 'inproceedings') push('booktitle', escapeBibtexUtf8(venue));
    else if (entryType === 'misc') push('howpublished', escapeBibtexUtf8(venue));
  }
  if (typeof c.year === 'number' && Number.isInteger(c.year)) push('year', String(c.year));
  const volume = text(c.volume);
  if (volume) push('volume', escapeBibtexUtf8(volume));
  const issue = text(c.issue);
  if (issue) push('number', escapeBibtexUtf8(issue));
  const pages = text(c.pages);
  if (pages) push('pages', bibtexPages(pages));
  const org = publisher ?? (entryType === 'techreport' || entryType === 'phdthesis' ? venue : null);
  if (org) {
    if (entryType === 'techreport') push('institution', listValue(org));
    else if (entryType === 'phdthesis') push('school', listValue(org));
    else push('publisher', listValue(org));
  }
  if (ids.isbn) push('isbn', ids.isbn);
  const doi = ids.doi ? verbatim(ids.doi) : null;
  if (ids.doi && doi === null) throw new BibRenderError(citekey, `the DOI ${ids.doi} cannot be written as a BibTeX field`);
  push('doi', doi);
  let eprint: string | null = null;
  if (ids.arxiv) {
    eprint = verbatim(ids.arxiv);
    push('eprint', eprint);
    push('archivePrefix', 'arXiv');
    push('primaryClass', primaryClassOf(ids.arxiv));
  }
  const abstract = text(c.abstract);
  if (abstract) push('abstract', escapeBibtexUtf8(abstract));
  if (c.retracted === true) push('note', 'RETRACTED');

  return {
    citekey,
    entryType,
    fields,
    expect: { title, authors, abstract, eprint },
  };
}

/** The text of one record: `@type{key,\n  field = {value},\n…}\n`. */
export function formatBibRecord(r: BibRecord): string {
  const body = r.fields.map(([k, v]) => `  ${k} = {${v}},`).join('\n');
  return `@${r.entryType}{${r.citekey},\n${body}\n}\n`;
}

// ---------------------------------------------------------------------------
// The CSL view (the RIS writer renders it).
// ---------------------------------------------------------------------------

export interface CslName {
  family?: string;
  given?: string;
  suffix?: string;
  literal?: string;
}

export interface CslEntry {
  id?: string;
  type: string;
  title: string;
  author: CslName[];
  editor?: CslName[];
  issued?: { 'date-parts': [[number]] };
  'container-title'?: string;
  volume?: string;
  issue?: string;
  page?: string;
  publisher?: string;
  DOI?: string;
  ISBN?: string;
  PMID?: string;
  PMCID?: string;
  /** The arXiv id of a preprint (CSL `number`, as citation-js's RIS mapping expects). */
  number?: string;
  // A retracted source surfaces as CSL `note = "RETRACTED"` (D-15).
  note?: string;
}

function cslName(n: PersonName): CslName {
  if (n.literal) return { literal: n.family };
  return { family: n.family, ...(n.given ? { given: n.given } : {}), ...(n.suffix ? { suffix: n.suffix } : {}) };
}

/** CSL-JSON for one source, or null when it cannot be cited (no identifier, no BYO PDF). */
export function toCsl(c: BibSource): CslEntry | null {
  const ids = idsOf(c);
  if (!citable(c, ids)) return null;
  const entry: CslEntry = {
    type: cslTypeOf(c),
    title: text(c.title) ?? c.citekey,
    author: parseNames(c.authors).map(cslName),
  };
  const editors = parseNames(c.editors).map(cslName);
  if (editors.length > 0) entry.editor = editors;
  if (typeof c.year === 'number') entry.issued = { 'date-parts': [[c.year]] };
  const venue = text(c.venue);
  if (venue) entry['container-title'] = venue;
  const volume = text(c.volume);
  if (volume) entry.volume = volume;
  const issue = text(c.issue);
  if (issue) entry.issue = issue;
  const pages = text(c.pages);
  if (pages) entry.page = pages;
  const publisher = text(c.publisher);
  if (publisher) entry.publisher = publisher;
  if (ids.doi) entry.DOI = ids.doi;
  if (ids.isbn) entry.ISBN = ids.isbn;
  if (ids.pmid) entry.PMID = ids.pmid;
  if (ids.pmcid) entry.PMCID = ids.pmcid;
  if (ids.arxiv) entry.number = ids.arxiv;
  if (c.retracted === true) entry.note = 'RETRACTED';
  return entry;
}

// ---------------------------------------------------------------------------
// Citekeys.
// ---------------------------------------------------------------------------

/**
 * Base-26 spreadsheet-column collision suffix.
 *
 * seen=1 -> 'a', seen=26 -> 'z', seen=27 -> 'aa', seen=52 -> 'az',
 * seen=53 -> 'ba', seen=702 -> 'zz'.
 *
 * Pure, deterministic, ASCII-lowercase. Satisfies the D-14 citekey
 * regex /^[a-z][a-z0-9_-]*$/ for any positive integer input.
 */
export function suffixForCollision(seen: number): string {
  if (!Number.isInteger(seen) || seen < 1) {
    throw new Error(`suffixForCollision: seen must be a positive integer (got ${seen})`);
  }
  let n = seen;
  let out = '';
  while (n > 0) {
    n--; // 1-indexed -> 0-indexed
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

/**
 * Assign collision-suffixed citekeys that are GLOBALLY UNIQUE across the set, so
 * the citekey is a stable primary key shared by LIBRARY.json, CITATIONS.bib, the
 * RIS export, and the research keep-sets (audit #21/#31/#32).
 *
 * Two sources sharing a base key (same first-author + year) get
 * base / base+'a' / base+'b' …. The suffix loop also skips any value already
 * taken, so a base key that happens to equal another source's suffixed form
 * (e.g. a literal 'wu2017a' alongside a second 'wu2017') ends up unique.
 *
 * Order-preserving. A source whose citekey is already unique is returned by
 * reference; others get a shallow copy with the new `citekey`.
 */
export function assignUniqueCitekeys<T extends { citekey: string; authors?: string[] | undefined; year?: number | null | undefined }>(
  candidates: T[],
): T[] {
  const used = new Set<string>();
  return candidates.map((c) => {
    const base =
      c.citekey ||
      generateCitekey({ authors: c.authors ?? [], ...(typeof c.year === 'number' ? { year: c.year } : {}) });
    let citekey = base;
    let n = 0;
    while (used.has(citekey)) {
      n += 1;
      citekey = base + suffixForCollision(n);
    }
    used.add(citekey);
    return citekey === c.citekey ? c : { ...c, citekey };
  });
}

// ---------------------------------------------------------------------------
// Round-trip check and rendering.
// ---------------------------------------------------------------------------

/**
 * A source whose BibTeX entry does not read back as the same work (it does not
 * parse, or its citekey, title, authors, abstract or eprint differ). library.ts
 * refuses the upsert with a one-line error rather than write a CITATIONS.bib
 * that verify cannot read.
 */
export class BibRenderError extends Error {
  readonly citekey: string;
  constructor(citekey: string, detail: string) {
    super(`the BibTeX entry for "${citekey}" does not read back as the same source (${detail})`);
    this.name = 'BibRenderError';
    this.citekey = citekey;
  }
}

function parsedName(a: unknown): PersonName {
  const o = (a ?? {}) as Record<string, unknown>;
  const str = (k: string): string => (typeof o[k] === 'string' ? (o[k] as string) : '');
  const family = [str('non-dropping-particle'), str('dropping-particle'), str('family') || str('literal')]
    .filter(Boolean)
    .join(' ');
  return {
    family,
    ...(str('given') ? { given: str('given') } : {}),
    ...(str('suffix') ? { suffix: str('suffix') } : {}),
  };
}

/** Why `entryText` does not read back as `r`, or null when it does. */
function roundTripProblem(entryText: string, r: BibRecord): string | null {
  let parsed: Array<Record<string, unknown>>;
  try {
    parsed = parseBibSync(entryText);
  } catch (e) {
    return ((e instanceof Error ? e.message : String(e)).split('\n')[0] ?? '').replace(/^parseBib: /, '');
  }
  const got = parsed[0];
  if (parsed.length !== 1 || !got) return `parsed ${parsed.length} entries`;
  if (got['id'] !== r.citekey) return `citekey became "${String(got['id'])}"`;
  if (got['title'] !== r.expect.title) return 'title changed';
  const authors = Array.isArray(got['author']) ? (got['author'] as unknown[]) : [];
  if (authors.length !== r.expect.authors.length) return `${r.expect.authors.length} author(s) read back as ${authors.length}`;
  for (let i = 0; i < authors.length; i++) {
    const want = r.expect.authors[i]!;
    const have = parsedName(authors[i]);
    if (have.family !== want.family || (have.given ?? '') !== (want.given ?? '') || (have.suffix ?? '') !== (want.suffix ?? '')) {
      // A suffix without a given name is written braced into the family.
      const folded = !want.given && want.suffix ? `${want.family} ${want.suffix}` : null;
      if (folded === null || have.family !== folded) return `author ${i + 1} changed`;
    }
  }
  if (r.expect.abstract !== null && got['abstract'] !== r.expect.abstract) return 'abstract changed';
  if (r.expect.eprint !== null && got['eprint'] !== r.expect.eprint) return 'eprint changed';
  return null;
}

/**
 * Render sources as BibTeX text: keyed by their (collision-suffixed) citekeys,
 * sorted by citekey (diff-stable), uncitable sources dropped. '' for none.
 * Every entry is parsed back through parseBibSync; one that does not read back
 * as the same work throws BibRenderError.
 */
export function renderBibtex(sources: BibSource[]): string {
  const survivors = sources.filter((c) => citable(c, idsOf(c)));
  const keyed = assignUniqueCitekeys(survivors);
  const records = keyed
    .map((c) => toBibRecord(c, c.citekey))
    .filter((r): r is BibRecord => r !== null)
    .sort((a, b) => a.citekey.localeCompare(b.citekey));
  if (records.length === 0) return '';
  const parts = records.map((r) => {
    const entry = formatBibRecord(r);
    const problem = roundTripProblem(entry, r);
    if (problem !== null) throw new BibRenderError(r.citekey, problem);
    return entry;
  });
  return parts.join('\n');
}

/**
 * Render `sources` (renderBibtex) and write them atomically to `targetPath`.
 * Only bin/lib/library.ts calls this in shipped code (chokepoint row
 * `library-writer`).
 */
export async function writeBibtex(sources: BibSource[], targetPath: string): Promise<void> {
  await atomicWriteFile(targetPath, renderBibtex(sources));
}
