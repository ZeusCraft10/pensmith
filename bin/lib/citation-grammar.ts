// bin/lib/citation-grammar.ts — Pandoc citation syntax, parsed once.
//
// Pandoc writes a citation two ways:
//   - a bracketed cluster: `[see @doe99, pp. 33-35; also -@smith04, ch. 1]`
//   - a narrative (in-text) citation: `@doe99` or `@doe99 [p. 33]`
// Each cited item can carry a prefix, a locator with an optional label, a
// suffix, and a leading `-` that suppresses the author. Rendering a paper
// correctly needs all of them, so the exporter reads citations through this
// parser rather than a bracket regex that loses the locator and the prefix.
//
// Code spans and fenced code blocks are skipped: Pandoc does not read
// citations there either.
//
// Every part of pensmith that reads citations reads them here: the verifier,
// compile, the export, the humanizer gate and revise. The module also finds
// what a reader would take for a citation but Pandoc would not render as one
// (a DOI or `(Author, 2020)` typed as text, a `[@ key]` that does not parse),
// and the direct quotations in a draft with the citation each is attributed to.
//
// PURE module: no I/O.

/** One cited work inside a cluster. */
export interface CiteItem {
  key: string;
  /** Text before the key (`see`). */
  prefix?: string;
  /** Locator value (`33-35`), present only when one was written. */
  locator?: string;
  /** CSL locator label (`page`, `chapter`, ...). Set whenever `locator` is. */
  label?: string;
  /** Text after the locator (`, emphasis added`). */
  suffix?: string;
  /** `-@key`: print the year/number but not the author. */
  suppressAuthor?: boolean;
}

/** A citation as written in the text, with its character span. */
export interface Citation {
  /** Offset of the first character (`[` or `@`). */
  start: number;
  /** Offset just past the last character. */
  end: number;
  /** The source text of the citation. */
  raw: string;
  /** True for `@key` written in running text rather than in brackets. */
  narrative: boolean;
  items: CiteItem[];
}

// A key starts with a letter, digit or `_`. Punctuation from :.#$%&-+?<>~/ may
// appear inside it, but not at its end, so `@doe99.` cites `doe99`.
const KEY_CHAR = String.raw`[\p{L}\p{N}_]`;
const KEY_PUNCT = String.raw`[:.#$%&\-+?<>~/]`;
const KEY_BODY = String.raw`${KEY_CHAR}(?:${KEY_CHAR}|${KEY_PUNCT}(?=${KEY_CHAR}))*`;
const KEY_RE = new RegExp(String.raw`^(?:\{([^{}]+)\}|(${KEY_BODY}))`, 'u');

// Pandoc's locator terms, longest spellings first so `pp.` wins over `p.`.
const LOCATOR_TERMS: ReadonlyArray<readonly [string, string]> = [
  ['sub verbo', 'sub verbo'], ['s.vv.', 'sub verbo'], ['s.v.', 'sub verbo'],
  ['paragraphs', 'paragraph'], ['paragraph', 'paragraph'], ['paras.', 'paragraph'], ['para.', 'paragraph'],
  ['chapters', 'chapter'], ['chapter', 'chapter'], ['chaps.', 'chapter'], ['chap.', 'chapter'], ['ch.', 'chapter'],
  ['sections', 'section'], ['section', 'section'], ['secs.', 'section'], ['sec.', 'section'],
  ['columns', 'column'], ['column', 'column'], ['cols.', 'column'], ['col.', 'column'],
  ['figures', 'figure'], ['figure', 'figure'], ['figs.', 'figure'], ['fig.', 'figure'],
  ['volumes', 'volume'], ['volume', 'volume'], ['vols.', 'volume'], ['vol.', 'volume'],
  ['numbers', 'number'], ['number', 'number'], ['nos.', 'number'], ['no.', 'number'],
  ['folios', 'folio'], ['folio', 'folio'], ['fols.', 'folio'], ['fol.', 'folio'],
  ['verses', 'verse'], ['verse', 'verse'], ['vv.', 'verse'], ['v.', 'verse'],
  ['books', 'book'], ['book', 'book'], ['bks.', 'book'], ['bk.', 'book'],
  ['lines', 'line'], ['line', 'line'], ['ll.', 'line'], ['l.', 'line'],
  ['notes', 'note'], ['note', 'note'], ['nn.', 'note'], ['n.', 'note'],
  ['opera', 'opus'], ['opus', 'opus'], ['opp.', 'opus'], ['op.', 'opus'],
  ['pages', 'page'], ['page', 'page'], ['pp.', 'page'], ['p.', 'page'],
  ['parts', 'part'], ['part', 'part'], ['pts.', 'part'], ['pt.', 'part'],
  ['¶¶', 'paragraph'], ['¶', 'paragraph'], ['§§', 'section'], ['§', 'section'],
];

// A locator value: numbers or roman numerals, joined by ranges, commas or `&`.
// Roman numerals must be well formed, so a suffix word such as "civil" is not
// read as part of the locator.
const ROMAN = '(?=[ivxlcdm])m{0,4}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})';
const LOCATOR_TOKEN = `(?:\\d+[a-z]?|${ROMAN})(?![\\p{L}\\p{N}])`;
const LOCATOR_VALUE_RE = new RegExp(`^${LOCATOR_TOKEN}(?:\\s*(?:[-–—]|,|&)\\s*${LOCATOR_TOKEN})*`, 'iu');

/** `s` with every regex metacharacter escaped, to match it literally. */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Each term as the pattern that reads it at the start of a locator, compiled once.
const LOCATOR_TERM_RES: ReadonlyArray<readonly [RegExp, string]> = LOCATOR_TERMS.map(
  ([term, label]) => [new RegExp(`^${escapeRe(term)}(?=\\s|\\d|$)\\s*`, 'iu'), label] as const,
);

/** Split `rest` (the text after a key) into locator, label and suffix. */
export function parseLocator(rest: string): Pick<CiteItem, 'locator' | 'label' | 'suffix'> {
  const comma = /^\s*,/.test(rest);
  let s = rest.replace(/^\s*,?\s*/, '');
  if (s.length === 0) return {};

  // `{pp. iv, vi-xi}`: an explicit locator in braces.
  if (s.startsWith('{')) {
    const close = s.indexOf('}');
    if (close > 0) {
      const inner = s.slice(1, close).trim();
      const after = s.slice(close + 1);
      const { label, value } = splitLabel(inner);
      const out: Pick<CiteItem, 'locator' | 'label' | 'suffix'> = {
        locator: value || inner,
        label: label ?? 'page',
      };
      const suffix = after.trim();
      if (suffix) out.suffix = after.replace(/^\s+/, ' ').trimEnd();
      return out;
    }
  }

  const { label, value, remainder } = splitLabel(s);
  if (value) {
    const out: Pick<CiteItem, 'locator' | 'label' | 'suffix'> = { locator: value, label: label ?? 'page' };
    const suffix = remainder.trim();
    if (suffix) out.suffix = /^[,;:.]/.test(suffix) ? suffix : ` ${suffix}`;
    return out;
  }
  // No locator: the rest is suffix, kept with the comma that introduced it.
  s = s.trim();
  return { suffix: comma ? `, ${s}` : ` ${s}` };
}

function splitLabel(s: string): { label?: string; value: string; remainder: string } {
  for (const [re, label] of LOCATOR_TERM_RES) {
    const m = re.exec(s);
    if (!m) continue;
    const afterTerm = s.slice(m[0].length);
    const v = LOCATOR_VALUE_RE.exec(afterTerm);
    if (v) return { label, value: v[0].trim(), remainder: afterTerm.slice(v[0].length) };
    return { value: '', remainder: s };
  }
  // A bare number is a page.
  if (/^\d/.test(s)) {
    const v = LOCATOR_VALUE_RE.exec(s);
    if (v) return { value: v[0].trim(), remainder: s.slice(v[0].length) };
  }
  return { value: '', remainder: s };
}

/** Parse one `;`-separated part of a cluster, or return null if it cites nothing. */
function parseItem(part: string): CiteItem | null {
  // The key's `@` must open the part or follow whitespace (or the `-` that
  // suppresses the author); `name@host` is not a citation.
  const at = /(^|\s)(-?)@/u.exec(part);
  if (!at) return null;
  const atIdx = at.index + at[1]!.length + at[2]!.length;
  const km = KEY_RE.exec(part.slice(atIdx + 1));
  if (!km) return null;
  const key = km[1] ?? km[2]!;
  const item: CiteItem = { key };
  const prefix = part.slice(0, at.index + at[1]!.length).trim();
  if (prefix) item.prefix = prefix;
  if (at[2] === '-') item.suppressAuthor = true;
  const rest = part.slice(atIdx + 1 + km[0].length);
  Object.assign(item, parseLocator(rest));
  return item;
}

/** Whether `i` falls inside one of the [start, end) ranges `rs`. */
function inRanges(rs: ReadonlyArray<readonly [number, number]>, i: number): boolean {
  return rs.some(([a, b]) => i >= a && i < b);
}

/** Character ranges of inline code spans and fenced code blocks. */
export function codeRanges(md: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const fence = /^(?: {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^(?: {0,3})\1[`~]*[ \t]*$|(?![\s\S]))/gm;
  for (const m of md.matchAll(fence)) ranges.push([m.index, m.index + m[0].length]);
  const inline = /(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
  for (const m of md.matchAll(inline)) {
    const s = m.index;
    if (!inRanges(ranges, s)) ranges.push([s, s + m[0].length]);
  }
  return ranges;
}

/**
 * The bracketed groups of `md` that may be citation clusters: no nested
 * brackets, at least one `@`, not in code, not escaped as `\[`, and not a link
 * (a bracket followed by `(`).
 */
function* bracketGroups(
  md: string,
  skip: ReadonlyArray<readonly [number, number]>,
): Generator<{ start: number; end: number; inner: string }> {
  for (const m of md.matchAll(/\[([^[\]]*@[^[\]]*)\]/g)) {
    const start = m.index;
    const end = start + m[0].length;
    if (inRanges(skip, start)) continue;
    if (start > 0 && md[start - 1] === '\\') continue;
    if (md[end] === '(') continue;
    yield { start, end, inner: m[1]! };
  }
}

/**
 * Every citation in `md`, in document order. A bracketed group is a cluster
 * only when each `;`-separated part cites a key, as in Pandoc; otherwise it is
 * ordinary text. A bracket followed by `(` is a link, not a citation.
 */
export function findCitations(md: string): Citation[] {
  const skip = codeRanges(md);
  const out: Citation[] = [];
  const claimed: Array<[number, number]> = [];

  for (const { start, end, inner } of bracketGroups(md, skip)) {
    // `@key [p. 4]` is a narrative citation's locator, handled below.
    const parts = inner.split(';');
    const items: CiteItem[] = [];
    let ok = true;
    for (const p of parts) {
      const it = parseItem(p);
      if (!it) { ok = false; break; }
      items.push(it);
    }
    if (!ok || items.length === 0) continue;
    out.push({ start, end, raw: md.slice(start, end), narrative: false, items });
    claimed.push([start, end]);
  }

  // Narrative citations: `@key`, optionally followed by ` [locator]`.
  const narrativeRe = new RegExp(String.raw`(?<![\p{L}\p{N}_@\\])@(?:\{([^{}]+)\}|(${KEY_BODY}))`, 'gu');
  for (const m of md.matchAll(narrativeRe)) {
    const start = m.index;
    if (inRanges(skip, start) || inRanges(claimed, start)) continue;
    const key = m[1] ?? m[2]!;
    let end = start + m[0].length;
    const item: CiteItem = { key };
    const loc = /^ \[([^[\]@]*)\]/.exec(md.slice(end));
    if (loc && md[end + loc[0].length] !== '(') {
      Object.assign(item, parseLocator(loc[1]!));
      end += loc[0].length;
    }
    out.push({ start, end, raw: md.slice(start, end), narrative: true, items: [item] });
  }

  return out.sort((a, b) => a.start - b.start);
}

/** The keys `cites` name, deduplicated in first-appearance order. */
export function citedKeys(cites: readonly Citation[]): string[] {
  const seen = new Set<string>();
  for (const c of cites) for (const it of c.items) seen.add(it.key);
  return [...seen];
}

/**
 * How the export reads the citations of `md` against the bibliography's keys:
 * the citations it renders, the narrative `@word`s with no entry that it
 * leaves as ordinary text (a handle, an email-like word, as it would read in
 * the source), and the keys of bracketed citations with no entry, which it
 * refuses. Compile refuses the same keys.
 */
export function exportCitations(
  md: string,
  known: ReadonlySet<string>,
): { cites: Citation[]; ignored: Citation[]; unknownCited: string[] } {
  const all = findCitations(md);
  return {
    cites: all.filter((c) => !c.narrative || known.has(c.items[0]!.key)),
    ignored: all.filter((c) => c.narrative && !known.has(c.items[0]!.key)),
    unknownCited: citedKeys(all.filter((c) => !c.narrative)).filter((k) => !known.has(k)),
  };
}

// ---------------------------------------------------------------------------
// Editing citations
// ---------------------------------------------------------------------------

/** The citations in `md` that cite `key`, in any Pandoc form, in document order. */
export function citationsOf(md: string, key: string, cites: readonly Citation[] = findCitations(md)): Citation[] {
  return cites.filter((c) => c.items.some((i) => i.key === key));
}

/**
 * `md` with each of `cites` replaced by `fn` of it. `cites` must be in
 * document order and not overlap. findCitations can give a braced narrative
 * key that wraps a cluster (`@{foo [@bar] baz}`), which overlaps it.
 */
export function replaceCitations(
  md: string,
  fn: (c: Citation) => string,
  cites: readonly Citation[] = findCitations(md),
): string {
  let out = '';
  let at = 0;
  for (const c of cites) {
    out += md.slice(at, c.start) + fn(c);
    at = c.end;
  }
  return out + md.slice(at);
}

/** `@key` or `@{key}` exactly, not the start of a longer key. */
function citedKeyPattern(key: string): RegExp {
  const k = escapeRe(key);
  return new RegExp(String.raw`@(?:\{${k}\}|${k}(?!${KEY_CHAR}|${KEY_PUNCT}${KEY_CHAR}))`, 'gu');
}

/** Apply `edit` to every citation of `key` in `md`, last first so offsets stay valid. */
function editCitationsOf(md: string, key: string, edit: (c: Citation, text: string) => string): string {
  let out = md;
  for (const c of citationsOf(md, key).reverse()) out = edit(c, out);
  return out;
}

/** `md` with every citation of `from` citing `to` instead; prefixes and locators stay. */
export function renameCitedKey(md: string, from: string, to: string): string {
  return replaceCitations(md, (c) => c.raw.replace(citedKeyPattern(from), `@${to}`), citationsOf(md, from));
}

/**
 * `md` with `key` taken out of every bracketed cluster that cites it:
 * `[@a; @key, p. 4]` becomes `[@a]`, and a cluster citing only `key` goes,
 * with the space before it (` [@key].` becomes `.`). Narrative citations are
 * left alone, since removing one would leave a sentence without its subject.
 */
export function dropCitedKey(md: string, key: string): string {
  return editCitationsOf(md, key, (c, text) => {
    if (c.narrative) return text;
    const kept = c.raw.slice(1, -1).split(';').filter((part) => !citedKeyPattern(key).test(part));
    if (kept.length > 0) return `${text.slice(0, c.start)}[${kept.map((p) => p.trim()).join('; ')}]${text.slice(c.end)}`;
    const start = c.start - (/\s*$/.exec(text.slice(0, c.start))?.[0].length ?? 0);
    return text.slice(0, start) + text.slice(c.end);
  });
}

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

// A full stop after one of these is not the end of a sentence.
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  'al', 'e.g', 'i.e', 'cf', 'vs', 'viz', 'dr', 'mr', 'mrs', 'ms', 'prof', 'st', 'jr', 'sr',
  'fig', 'figs', 'no', 'nos', 'vol', 'vols', 'p', 'pp', 'ch', 'chap', 'sec', 'eq', 'approx', 'ca',
]);

// `.`, `!` or `?`, closing quotes or brackets, then space and a capital or an
// opening mark: the end of a sentence.
const SENTENCE_END = /[.!?]["”’')\]]*(?=\s+[\p{Lu}\p{N}"“‘'[@])/gu;

// A blank line, with LF or CRLF line endings (a draft edited on Windows).
const BLANK_LINE = /\n[ \t\r]*\n/g;
// The same, matched only where it starts at `lastIndex`.
const BLANK_LINE_AT = new RegExp(BLANK_LINE.source, 'y');

// How far back from a full stop endsSentence looks for the word before it:
// further than any abbreviation or initial reaches.
const WORD_LOOKBACK = 32;

/**
 * Whether the `.`, `!` or `?` at `at` ends a sentence. A full stop after an
 * abbreviation or an initial does not; `from` bounds the word read before it.
 */
function endsSentence(text: string, from: number, at: number): boolean {
  if (text[at] !== '.') return true;
  const word = /([\p{L}.]+)$/u.exec(text.slice(from, at))?.[1] ?? '';
  return word.length !== 1 && !ABBREVIATIONS.has(word.toLowerCase());
}

/**
 * Offsets of the `.`, `!` or `?` that end each sentence of plain text, such as
 * the text extracted from a source.
 */
export function sentenceEnds(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(SENTENCE_END)) {
    if (endsSentence(text, Math.max(0, m.index - WORD_LOOKBACK), m.index)) out.push(m.index);
  }
  return out;
}

/**
 * The offset just past each blank line of `md`, in order: where each paragraph
 * after the first starts. sentenceSpan takes it, as it takes the citations,
 * so a caller that asks for many sentences of one text reads it once.
 */
export function paragraphBreaks(md: string): number[] {
  return [...md.matchAll(BLANK_LINE)].map((m) => m.index + m[0].length);
}

/** Offset of the paragraph that holds `at`: just after the last blank line that ends at or before it. */
function paragraphStart(breaks: readonly number[], at: number): number {
  let lo = 0;
  let hi = breaks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (breaks[mid]! <= at) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? breaks[lo - 1]! : 0;
}

/**
 * The sentence of `md` that holds [start, end), as [sentenceStart, sentenceEnd).
 * A sentence never crosses a blank line. A full stop inside a citation
 * (`p. 5`), after an abbreviation or initial, or inside [start, end) itself
 * does not end one.
 */
export function sentenceSpan(
  md: string,
  start: number,
  end: number,
  cites: readonly Citation[] = findCitations(md),
  breaks: readonly number[] = paragraphBreaks(md),
): [number, number] {
  const paraStart = paragraphStart(breaks, start);
  const afterBreak = md.slice(end).search(BLANK_LINE);
  const paraEnd = afterBreak === -1 ? md.length : end + afterBreak;
  const masked = (i: number): boolean =>
    (i >= start && i < end) || cites.some((c) => i >= c.start && i < c.end);

  let s = paraStart;
  let e = paraEnd;
  const para = md.slice(paraStart, paraEnd);
  for (const m of para.matchAll(SENTENCE_END)) {
    const at = paraStart + m.index;
    if (masked(at) || !endsSentence(md, Math.max(paraStart, at - WORD_LOOKBACK), at)) continue;
    const boundary = at + m[0].length;
    if (boundary <= start) s = boundary;
    else if (at >= end) { e = boundary; break; }
  }
  return [s, e];
}

// ---------------------------------------------------------------------------
// Citations written as text
// ---------------------------------------------------------------------------

/** What kind of identifier or citation a RawCitation is. */
export type RawCitationKind = 'doi' | 'arxiv' | 'pmid' | 'author-year';

/**
 * A citation typed as plain text: a DOI, arXiv ID or PMID, or an author-year
 * citation such as `(Smith, 2020)`. Pandoc renders these as ordinary words, so
 * nothing in them is checked against a bibliography; the verifier blocks them
 * until each is written as a `[@key]` citation.
 */
export interface RawCitation {
  kind: RawCitationKind;
  start: number;
  end: number;
  raw: string;
}

// Words that sit before a year in brackets but are not names: dates, and the
// laws, treaties, events and studies that are named with their year.
const NOT_A_NAME = String.raw`(?!(?:${[
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec',
  'Spring', 'Summer', 'Autumn', 'Fall', 'Winter',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'In', 'On', 'At', 'The', 'This', 'That', 'These', 'Those', 'Since', 'From', 'By', 'Until', 'Till', 'During',
  'Before', 'After', 'Circa', 'Fiscal', 'Year',
  'Figure', 'Fig', 'Table', 'Version', 'Volume', 'Vol', 'Issue', 'Edition', 'Chapter', 'Section', 'Part', 'Release',
  'Act', 'Acts', 'Law', 'Bill', 'Amendment', 'Code', 'Directive', 'Regulation', 'Treaty', 'Accord', 'Agreement',
  'Convention', 'Declaration', 'Protocol', 'Charter', 'Constitution', 'Report', 'Survey', 'Census', 'Study',
  'Trial', 'Cohort', 'Election', 'Elections', 'Referendum', 'War', 'Crisis', 'Revolution', 'Pandemic',
  'Summit', 'Conference', 'Olympics', 'Games', 'Cup', 'Prize', 'Award', 'Plan', 'Program', 'Programme',
  'Project', 'Initiative', 'Strategy', 'Policy', 'Standard', 'Model',
  'Recession', 'Depression', 'Outbreak', 'Epidemic', 'Famine', 'Disaster', 'Earthquake', 'Tsunami',
  'Wildfire', 'Wildfires', 'Massacre', 'Uprising',
].join('|')})(?![\p{L}\p{M}'’-]))`;
// A storm is named after its kind: `Hurricane Katrina (2005)` is not a citation.
const NOT_AFTER = String.raw`(?<!\b(?:Hurricane|Typhoon|Cyclone|Storm)\s+)`;
const PARTICLE = String.raw`(?:(?:van|von|der|den|de|del|della|di|da|du|dos|das|le|la|ten|ter)\s+){0,3}`;
// A surname in brackets may be an acronym (`WHO`); in running text it must
// have a lower-case letter, so `World War II (1939)` is not a citation.
const SURNAME_ANY = String.raw`${PARTICLE}${NOT_A_NAME}\p{Lu}[\p{L}\p{M}'’-]*[\p{L}\p{M}]`;
const SURNAME_PROSE = String.raw`${PARTICLE}${NOT_A_NAME}\p{Lu}(?=[\p{L}\p{M}'’-]*\p{Ll})[\p{L}\p{M}'’-]*[\p{L}\p{M}]`;
const authors = (name: string): string =>
  String.raw`${name}(?:(?:,\s*|\s+)(?:and|&)\s+${name}|,\s+${name}|\s+et\s+al\.?)*`;
// One or more years (`2020`, `2020a`, `n.d.`, `in press`), comma-separated;
// `range` is what may follow a year's digits.
const years = (range: string): string => {
  const year = String.raw`(?:(?:1[5-9]\d\d|20\d\d)${range}[a-z]?(?![\p{L}\p{N}])|n\.\s?d\.|in\s+press|forthcoming)`;
  return String.raw`${year}(?:,\s*${year})*`;
};
// After a name in running text, single years only: a range there is far more
// often a lifespan or a period (`Darwin (1809–1882)`, `Weimar Republic
// (1919–1933)`) than a citation.
const PROSE_YEARS = years('');
// Inside an author-year bracket a year may be a range (`2019-2021`, `2018–19`).
const CITED_YEARS = years(String.raw`(?:\s*[-–—]\s*(?:\d{4}|\d\d))?`);
// A page after the year: `, p. 4`, `, ch. 2`, Harvard `: 45`, or a bare `, 45`.
const PAGE_VALUE = String.raw`[\dIVXLCivxlc]+(?:\s*[-–—]\s*[\dIVXLCivxlc]+)?`;
const PAGES = String.raw`(?:,\s*(?:pp?\.|paras?\.|chaps?\.|ch\.|sec\.|§)\s*${PAGE_VALUE}|:\s*\d+(?:\s*[-–—]\s*\d+)?|,\s*\d+(?:\s*[-–—]\s*\d+)?)?`;
const LEAD = String.raw`(?:(?:see|e\.g\.|cf\.|i\.e\.|also),?\s+(?:also\s+)?)?`;
const ONE_WORK = String.raw`${LEAD}${authors(SURNAME_ANY)},?\s+${CITED_YEARS}${PAGES}`;

// In priority order: a match that overlaps an earlier one is dropped, so a
// DOI inside a doi.org link is reported once, as the link.
const RAW_PATTERNS: ReadonlyArray<readonly [RawCitationKind, RegExp]> = [
  ['doi', /\bhttps?:\/\/(?:dx\.)?doi\.org\/\S+/giu],
  ['arxiv', /\bhttps?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\/\S+/giu],
  ['pmid', /\bhttps?:\/\/(?:www\.)?(?:pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/(?:pubmed|pmc\/articles))\/\S+/giu],
  ['doi', /\bdoi:\s*10\.\d{4,9}\/\S+/giu],
  ['doi', /(?<![\p{L}\p{N}_./])10\.\d{4,9}\/\S+/gu],
  ['arxiv', /\barxiv:\s*(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?)/giu],
  ['pmid', /\bPMID:?\s*\d{1,9}\b/giu],
  ['pmid', /\b(?:PMCID:?\s*)?PMC\d{4,9}\b/giu],
  ['author-year', new RegExp(String.raw`(?<!\\)\(\s*${ONE_WORK}(?:\s*;\s*${ONE_WORK})*\s*\)`, 'gu')],
  // `[Smith, 2020]`, but not a link (`[Smith, 2020](url)`, `[...][ref]`, `[...]: url`).
  ['author-year', new RegExp(String.raw`(?<!\\)\[\s*${ONE_WORK}(?:\s*;\s*${ONE_WORK})*\s*\](?![(\[:])`, 'gu')],
  ['author-year', new RegExp(String.raw`(?<![\p{L}\p{N}])${NOT_AFTER}${authors(SURNAME_PROSE)}\s+\(\s*${PROSE_YEARS}${PAGES}\s*\)`, 'gu')],
];

/** Drop sentence punctuation and unbalanced closing brackets from the end of an identifier. */
function trimIdentifier(raw: string): string {
  let s = raw;
  for (;;) {
    const last = s.at(-1);
    if (last === undefined) return s;
    const count = (ch: string): number => s.split(ch).length - 1;
    if ('.,;:!?\'"’”>}'.includes(last)) s = s.slice(0, -1);
    else if (last === ')' && count('(') < count(')')) s = s.slice(0, -1);
    else if (last === ']' && count('[') < count(']')) s = s.slice(0, -1);
    else return s;
  }
}

/**
 * Every DOI, arXiv ID, PMID and author-year citation typed as text in `md`,
 * in document order. Text inside code, inside a Pandoc citation (a key may
 * look like a DOI) and a bracket escaped as `\(` is skipped.
 */
export function findRawCitations(md: string, cites: readonly Citation[] = findCitations(md)): RawCitation[] {
  const skip = codeRanges(md);
  const taken: Array<[number, number]> = [
    ...skip,
    ...cites.map((c): [number, number] => [c.start, c.end]),
  ];
  const overlaps = (a: number, b: number): boolean => taken.some(([x, y]) => a < y && b > x);
  const out: RawCitation[] = [];
  for (const [kind, re] of RAW_PATTERNS) {
    for (const m of md.matchAll(re)) {
      const raw = kind === 'author-year' ? m[0] : trimIdentifier(m[0]);
      const start = m.index;
      const end = start + raw.length;
      if (raw.length === 0 || overlaps(start, end)) continue;
      out.push({ kind, start, end, raw });
      taken.push([start, end]);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** A bracketed group that was meant as a citation but has no key that parses. */
export interface UnparsedCitation {
  start: number;
  end: number;
  raw: string;
}

/**
 * Bracketed groups with an `@` where a citation key should start (`[@ key]`,
 * `[@]`, `[-@]`) that parse as no citation. Pandoc would print them as they
 * stand, so they must not pass as text. An `@` inside a word, as in an email
 * address, is not a citation.
 */
export function findUnparseableCitations(md: string, cites: readonly Citation[] = findCitations(md)): UnparsedCitation[] {
  const out: UnparsedCitation[] = [];
  for (const { start, end, inner } of bracketGroups(md, codeRanges(md))) {
    if (cites.some((c) => !c.narrative && c.start === start)) continue;
    // An `@` where a key starts (the group's start, a space or `;`, then
    // `-?@`) that opens no narrative citation.
    const unparsed = [...inner.matchAll(/(^|[\s;])-?@/g)]
      .some((a) => !cites.some((c) => c.narrative && c.start === start + a.index + a[0].length));
    if (unparsed) out.push({ start, end, raw: md.slice(start, end) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Direct quotations
// ---------------------------------------------------------------------------

/** A direct quotation and the citation it is attributed to. */
export interface Quote {
  kind: 'inline' | 'block';
  /** Span of the quotation, quote marks or `>` markers included. */
  start: number;
  end: number;
  /** The quoted words: citations inside removed, whitespace collapsed, closing punctuation dropped. */
  text: string;
  /** The citation the quotation is attributed to, or null when there is none. */
  citation: Citation | null;
}

const CLOSERS: Readonly<Record<string, string>> = { '"': '"”', '“': '”"', "'": "'’", '‘': '’\'' };

// Words clipped with a leading apostrophe ('em, 'tis, rock 'n' roll): the
// apostrophe is part of the word, not an opening quote mark. A capital after
// the mark opens a quotation (`'Cause and effect ...'`, `'Til the end ...'`),
// except in 'Tis and 'Twas, which open a sentence clipped as well.
const CLIPPED_WORD = /^(?:em|tis|twas|til|cause|n|bout|nuff|Tis|Twas)(?![\p{L}\p{N}])/u;

// A link reference definition, `[ref]: url "title"`: the label, then one
// destination (`<...>` or a run of non-space characters that does not open
// with a quote mark), then an optional title in `"..."`, `'...'` or `(...)`,
// and nothing else on the line. A line that has more, such as
// `[Translation]: "..." [@key]`, is ordinary text.
const LINK_DEFINITION = /^( {0,3}\[[^\]\n]+\]:[ \t]*)(?:<[^<>\n]*>|[^\s"'“‘(<]\S*)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t\r]*$/gm;

/**
 * Character ranges of link and image destinations with their titles
 * (`](url "title")`) and of the destination and title of each link reference
 * definition: a title is not a quotation.
 */
function linkTargetRanges(md: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of md.matchAll(/\]\((?:[^()\n]|\([^()\n]*\))*\)/g)) ranges.push([m.index, m.index + m[0].length]);
  for (const m of md.matchAll(LINK_DEFINITION)) ranges.push([m.index + m[1]!.length, m.index + m[0].length]);
  return ranges;
}

function quoteText(inner: string): string {
  // Last first, on the text already edited, and not through replaceCitations:
  // a braced narrative key can wrap a cluster (`@{foo [@bar] baz}`), and
  // walking overlapping citations forward puts part of one back.
  let text = inner;
  for (const c of findCitations(inner).reverse()) text = text.slice(0, c.start) + text.slice(c.end);
  return text.replace(/\s+/g, ' ').trim().replace(/[\s.,;:]+$/u, '');
}

interface Line { start: number; end: number; text: string }

function splitLines(md: string): Line[] {
  const lines: Line[] = [];
  let pos = 0;
  for (;;) {
    const nl = md.indexOf('\n', pos);
    const end = nl === -1 ? md.length : nl;
    lines.push({ start: pos, end, text: md.slice(pos, end) });
    if (nl === -1) return lines;
    pos = nl + 1;
  }
}

/** Markdown block quotes: runs of `>` lines and their lazy continuation lines. */
function blockQuoteSpans(md: string, inCode: (i: number) => boolean): Array<{ start: number; end: number; inner: string }> {
  const lines = splitLines(md);
  const out: Array<{ start: number; end: number; inner: string }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const first = lines[i]!;
    if (!/^ {0,3}>/.test(first.text) || inCode(first.start)) continue;
    const body: string[] = [];
    let j = i;
    for (; j < lines.length; j += 1) {
      const l = lines[j]!;
      if (/^ {0,3}>/.test(l.text)) body.push(l.text.replace(/^ {0,3}> ?/, ''));
      else if (l.text.trim() !== '' && (body.at(-1) ?? '').trim() !== '') body.push(l.text);
      else break;
    }
    const last = lines[j - 1]!;
    out.push({ start: first.start, end: last.end, inner: body.join('\n') });
    i = j - 1;
  }
  return out;
}

/** The citation a block quotation is attributed to. */
function blockAttribution(
  md: string,
  start: number,
  end: number,
  cites: readonly Citation[],
  breaks: readonly number[],
): Citation | null {
  // A citation inside the block, usually on its last line.
  const inside = cites.filter((c) => c.start >= start && c.start < end);
  if (inside.length > 0) return inside.at(-1)!;
  // A citation that opens the next paragraph: `[@key, p. 4]` on its own line.
  const next = end + (/^\s*/.exec(md.slice(end))?.[0].length ?? 0);
  const opening = cites.find((c) => c.start === next);
  if (opening) return opening;
  // The paragraph before introduces it: `As @key argues:`.
  const before = md.slice(0, start).replace(/\s+$/, '');
  if (before.endsWith(':')) {
    const from = paragraphStart(breaks, before.length);
    const intro = cites.filter((c) => c.start >= from && c.end <= before.length);
    if (intro.length > 0) return intro.at(-1)!;
  }
  return null;
}

/** The citation an inline quotation is attributed to. */
function inlineAttribution(
  md: string,
  start: number,
  end: number,
  cites: readonly Citation[],
  breaks: readonly number[],
): Citation | null {
  // Right after the closing mark: `"..." [@key, p. 4]`, `"...," [@key]`, `"..." (p. 4) [@key]`.
  const tail = /^[\s,.;:]*(?:\([^()\n]{0,40}\)[\s,.;:]*)?/.exec(md.slice(end))?.[0] ?? '';
  const direct = cites.find((c) => c.start === end + tail.length);
  if (direct) return direct;
  const inner = cites.filter((c) => c.start > start && c.end <= end);
  if (inner.length > 0) return inner.at(-1)!;
  const [s, e] = sentenceSpan(md, start, end, cites, breaks);
  const following = cites.find((c) => c.start >= end && c.start < e);
  if (following) return following;
  const preceding = cites.filter((c) => c.start >= s && c.end <= start);
  return preceding.at(-1) ?? null;
}

/**
 * Every direct quotation in `md`, in document order: block quotes, and text in
 * straight or curly, double or single quote marks. Each is attributed to the
 * citation right after it, a citation inside it, or else the nearest citation
 * after it, then before it, in the same sentence. A block quote takes the
 * citation inside it, a citation opening the next paragraph, or one in a
 * paragraph that introduces it with a colon. Apostrophes (`don't`,
 * `authors'`, `'em`), quote marks inside code and link titles are not
 * quotations.
 */
export function findQuotes(md: string, cites: readonly Citation[] = findCitations(md)): Quote[] {
  const skip = codeRanges(md);
  const inCode = (i: number): boolean => inRanges(skip, i);
  const links = linkTargetRanges(md);
  const breaks = paragraphBreaks(md);
  const out: Quote[] = [];

  const blocks = blockQuoteSpans(md, inCode);
  for (const b of blocks) {
    out.push({ kind: 'block', start: b.start, end: b.end, text: quoteText(b.inner), citation: blockAttribution(md, b.start, b.end, cites, breaks) });
  }
  const inBlockOrCite = (i: number): boolean =>
    blocks.some((b) => i >= b.start && i < b.end) || cites.some((c) => i >= c.start && i < c.end);

  const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
  for (let i = 0; i < md.length; i += 1) {
    const open = md[i]!;
    const closers = CLOSERS[open];
    if (!closers || inCode(i) || inBlockOrCite(i) || inRanges(links, i)) continue;
    const prev = i > 0 ? md[i - 1]! : ' ';
    const next = md[i + 1];
    if (next === undefined || /\s/.test(next)) continue;
    if ((open === '"' || open === "'") && !/[\s([{—–\-/]/.test(prev)) continue;
    if ((open === "'" || open === '‘') && (!/\p{L}/u.test(next) || CLIPPED_WORD.test(md.slice(i + 1, i + 8)))) continue;
    let close = -1;
    for (let j = i + 1; j < md.length; j += 1) {
      if (md[j] === '\n') {
        BLANK_LINE_AT.lastIndex = j;
        if (BLANK_LINE_AT.test(md)) break;
      }
      if (!closers.includes(md[j]!) || /\s/.test(md[j - 1]!) || isWordChar(md[j + 1])) continue;
      close = j;
      break;
    }
    if (close === -1) continue;
    const start = i;
    const end = close + 1;
    const text = quoteText(md.slice(i + 1, close));
    if (text.length > 0) {
      out.push({ kind: 'inline', start, end, text, citation: inlineAttribution(md, start, end, cites, breaks) });
    }
    i = close;
  }
  return out.sort((a, b) => a.start - b.start);
}
