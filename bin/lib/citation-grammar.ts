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
const KEY_BODY = String.raw`[\p{L}\p{N}_](?:[\p{L}\p{N}_]|[:.#$%&\-+?<>~/](?=[\p{L}\p{N}_]))*`;
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

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
  for (const [term, label] of LOCATOR_TERMS) {
    const re = new RegExp(`^${escapeRe(term)}(?=\\s|\\d|$)\\s*`, 'iu');
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

/** Character ranges of inline code spans and fenced code blocks. */
export function codeRanges(md: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const fence = /^(?: {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^(?: {0,3})\1[`~]*[ \t]*$|(?![\s\S]))/gm;
  for (const m of md.matchAll(fence)) ranges.push([m.index, m.index + m[0].length]);
  const inline = /(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
  for (const m of md.matchAll(inline)) {
    const s = m.index;
    if (!ranges.some(([a, b]) => s >= a && s < b)) ranges.push([s, s + m[0].length]);
  }
  return ranges;
}

/**
 * Every citation in `md`, in document order. A bracketed group is a cluster
 * only when each `;`-separated part cites a key, as in Pandoc; otherwise it is
 * ordinary text. A bracket followed by `(` is a link, not a citation.
 */
export function findCitations(md: string): Citation[] {
  const skip = codeRanges(md);
  const inCode = (i: number): boolean => skip.some(([a, b]) => i >= a && i < b);
  const out: Citation[] = [];
  const claimed: Array<[number, number]> = [];

  // Bracketed clusters: no nested brackets, at least one @.
  for (const m of md.matchAll(/\[([^[\]]*@[^[\]]*)\]/g)) {
    const start = m.index;
    const end = start + m[0].length;
    if (inCode(start)) continue;
    if (start > 0 && md[start - 1] === '\\') continue;
    if (md[end] === '(') continue;
    // `@key [p. 4]` is a narrative citation's locator, handled below.
    const parts = m[1]!.split(';');
    const items: CiteItem[] = [];
    let ok = true;
    for (const p of parts) {
      const it = parseItem(p);
      if (!it) { ok = false; break; }
      items.push(it);
    }
    if (!ok || items.length === 0) continue;
    out.push({ start, end, raw: m[0], narrative: false, items });
    claimed.push([start, end]);
  }

  // Narrative citations: `@key`, optionally followed by ` [locator]`.
  const narrativeRe = new RegExp(String.raw`(?<![\p{L}\p{N}_@\\])@(?:\{([^{}]+)\}|(${KEY_BODY}))`, 'gu');
  for (const m of md.matchAll(narrativeRe)) {
    const start = m.index;
    if (inCode(start)) continue;
    if (claimed.some(([a, b]) => start >= a && start < b)) continue;
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

/** Keys cited anywhere in `md`, deduplicated in first-appearance order. */
export function citedKeys(md: string): string[] {
  const seen = new Set<string>();
  for (const c of findCitations(md)) for (const it of c.items) seen.add(it.key);
  return [...seen];
}
