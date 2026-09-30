// bin/lib/quote-extractor.ts — every direct quote of a draft, for Pass 3 and
// the drafter's quote policy (VRFY-18, D-20-17; GRND-14).
//
// A direct quote is text a draft presents as the words of a source. Pass 3
// checks each one against the source's real text, so a quote this module
// misses is a quote nobody checks: every rule below errs toward extracting.
//
// What counts as a quote (outside code the one grammar proves Pandoc reads as
// code — citation-token.ts; everything else counts, fail closed):
//   - inline text in straight or typographic double quotes ("…", “…”) or
//     straight or typographic single quotes ('…', ‘…’), paired the way
//     Pandoc's smart-quote reader pairs them, one paragraph at a time — an
//     apostrophe inside a word (`it's`, `the authors'`) never opens one; the
//     marks may be written as HTML entities (`&ldquo;`, `&#8220;`, `&quot;`,
//     `&#39;` …) or escaped (`\"`): the export shows them as quotation marks;
//   - inline text in the other languages' quotation marks — guillemets «…»,
//     »…« and »…», ‹…› and ›…‹, low-high „…“ / „…” and ‚…‘ / ‚…’, corner
//     brackets 「…」 and 『…』 (or their entities, `&laquo;`, `&bdquo;` …):
//     Pandoc leaves them as they are and the export shows them as quotation
//     marks (review round 2);
//   - a block quote: one quote per `>` run, lazy continuation lines included
//     (Pandoc continues a block-quote paragraph on a line without `>`), also
//     inside a list item or a definition (`- > …`, `1. > …`, `:   > …`);
//   - with at least `[verification] quote_min_words` words once citations are
//     stripped (default 5: DEFAULT_QUOTE_MIN_WORDS). Fewer words is a scare
//     quote or a quoted term, not a quotation.
// Excluded by rule (inline only): a quoted title — after an explicit title
// cue (`titled`, `entitled`, `the article`, `the book`, `the paper`, …), or
// written in Title Case with no sentence-ending punctuation inside and at most
// 12 words (after `called` / `named` it must look like one too) — and a
// Markdown link title (`[text](url "title")`). The Title Case rule never
// applies after a reporting colon or verb (`wrote:`, `states that`, `put it,`):
// that quote is a quotation whatever its capitals (review round 2).
//
// Who a quote is attributed to (every Pandoc citation form, read through
// citation-token.ts; a cluster attributes the quote to EVERY key in it — one
// entry per key, each cited source must hold the quote):
//   1. the citation right after it: `"…" [@k, p. 3]`, `"…" [@a; @b]`,
//      `"…" [-@k]`, `"…" @k [p. 3]` (whitespace only, no blank line, between);
//      for a block quote, a citation that ends the block (`> … [@k]`) or opens
//      the next paragraph (`> …` then `[@k]` or `— @k`);
//   2. else a citation before it in the same sentence: `[@k] writes, "…"`,
//      `@k notes that "…"`, `As @k put it, "…"`; for a block quote, one in the
//      last sentence of the lead-in (`@k puts it this way:` then `> …`).
// A quote with neither is UNATTRIBUTED (`citekey: null`): Pass 3 blocks it.
//
// Every quote has an id in document order — `q1`, `q2`, … (verdicts.ts
// quoteId) — shared by its per-key entries, its 1-based line, and the
// locator written with each key (`p. 3`). CRLF and LF drafts give the same
// entries. Pure: no I/O.

import {
  citationItems,
  findCitations,
  offsetInSpans,
  provableCodeSpans,
  replaceCitations,
  type CitationCluster,
} from './citation-token.js';
import { quoteId } from './verify/verdicts.js';
import { DEFAULT_QUOTE_MIN_WORDS } from './schemas/config.js';

export { DEFAULT_QUOTE_MIN_WORDS } from './schemas/config.js';

export type QuoteKind = 'block' | 'inline';

export interface ExtractedQuote {
  /** The quote's id in its draft, in document order (`q1`, `q2`, …); every entry of one quote shares it. */
  readonly id: string;
  /** The quoted text: citations and emphasis markers removed, escapes undone, whitespace collapsed. */
  readonly text: string;
  /** The cited key this entry attributes the quote to; null when the quote has no attributable citation. */
  readonly citekey: string | null;
  readonly kind: QuoteKind;
  /** 1-based line of the quote's opening mark (a block quote: its first line). */
  readonly line: number;
  /** The locator written with this key, as written (`p. 3`, `chap. 2, emphasis added`), when there is one. */
  readonly locator?: string;
}

export interface ExtractQuotesOptions {
  /** `[verification] quote_min_words` (default DEFAULT_QUOTE_MIN_WORDS). */
  readonly minWords?: number;
}

/** How far before a quote a same-sentence citation may start (characters). */
const BEFORE_WINDOW = 240;
/** The longest quoted title (in words) the Title Case rule excludes. */
const MAX_TITLE_WORDS = 12;

/** One attributed key: the key and the locator written with it. */
interface Attribution {
  readonly key: string;
  readonly locator?: string;
}

/** A quote found in the draft, before code exclusion and id assignment. */
interface Candidate {
  readonly kind: QuoteKind;
  /** Offset of the opening mark (a block quote: of its first line). */
  readonly start: number;
  /** The offset whose code-ness decides whether the quote is in code (provableCodeSpans), or -1 (then its start). */
  readonly probe: number;
  readonly text: string;
  readonly attribution: readonly Attribution[];
}

// ---------------------------------------------------------------------------
// Text helpers.
// ---------------------------------------------------------------------------

/** A word: a whitespace-separated token holding a letter or a digit. */
function words(text: string): string[] {
  return text.split(/\s+/u).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/**
 * The quote as a reader sees it: every citation removed (a key is never part
 * of the source's words), emphasis markers and backslash escapes undone, a
 * link reduced to its text, whitespace collapsed.
 */
function quoteText(raw: string): string {
  return decodeTextEntities(replaceCitations(raw, () => ' '))
    .replace(/!?\[([^[\]]*)\]\([^()\s]*(?:\s+"[^"]*")?\)/g, '$1')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .replace(/\*+/g, '')
    .replace(/(^|[\s\p{P}])_+|_+(?=[\s\p{P}]|$)/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** The quotation-mark entities Pandoc's smart reader reads as marks (charOrRef), by name. */
const QUOTE_ENTITY_NAMES: Readonly<Record<string, string>> = {
  quot: '"', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', apos: "'", laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', bdquo: '„', sbquo: '‚',
};
/** Windows-1252 code points HTML maps to quotation marks (`&#147;` is “). */
const CP1252_QUOTES: Readonly<Record<number, string>> = { 130: '‚', 132: '„', 139: '‹', 145: '‘', 146: '’', 147: '“', 148: '”', 155: '›' };
const QUOTE_CHARS = new Set(['"', "'", '“', '”', '‘', '’', '«', '»', '‹', '›', '„', '‚', '「', '」', '『', '』']);

/** The character an entity reference stands for, or null. */
function entityChar(name: string | undefined, dec: string | undefined, hex: string | undefined): string | null {
  if (name !== undefined) return QUOTE_ENTITY_NAMES[name.toLowerCase()] ?? null;
  const code = dec !== undefined ? Number(dec) : Number.parseInt(hex ?? '', 16);
  if (!Number.isFinite(code)) return null;
  const cp = CP1252_QUOTES[code];
  if (cp !== undefined) return cp;
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : null;
}

/**
 * `md` with every quotation-mark entity (`&ldquo;`, `&#8220;`, `&#x201C;`,
 * `&quot;`, `&#39;`, `&#147;` …) written as its mark — the export shows the
 * mark, so the quote is paired like one typed directly. Entities never span
 * a line, so line numbers are unchanged.
 */
function decodeQuoteEntities(md: string): string {
  if (!md.includes('&')) return md;
  return md.replace(/&(?:([A-Za-z]+)|#(\d{1,7})|#[xX]([0-9A-Fa-f]{1,6}));/g, (m, name?: string, dec?: string, hex?: string) => {
    const c = entityChar(name, dec, hex);
    return c !== null && QUOTE_CHARS.has(c) ? c : m;
  });
}

/** Quote text as the export shows it: the common entities decoded (`&amp;` → `&`, `&#8212;` → `—`). */
function decodeTextEntities(text: string): string {
  if (!text.includes('&')) return text;
  const named: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', nbsp: '\u00a0', mdash: '—', ndash: '–', hellip: '…', ...QUOTE_ENTITY_NAMES };
  return text.replace(/&(?:([A-Za-z]+)|#(\d{1,7})|#[xX]([0-9A-Fa-f]{1,6}));/g, (m, name?: string, dec?: string, hex?: string) => {
    if (name !== undefined) return named[name.toLowerCase()] ?? m;
    return entityChar(undefined, dec, hex) ?? m;
  });
}

/** 1-based line of `offset` (lines end at `\n`). */
function lineAt(md: string, offset: number): number {
  let line = 1;
  for (let i = md.indexOf('\n'); i !== -1 && i < offset; i = md.indexOf('\n', i + 1)) line += 1;
  return line;
}

const MINOR_WORDS = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'of', 'in', 'on', 'at', 'by', 'to', 'from',
  'with', 'into', 'onto', 'over', 'upon', 'via', 'vs', 'versus', 'as', 'per', 'than', 'up', 'out', 'off', 'about',
]);

/** Title Case with no sentence-ending punctuation inside and at most MAX_TITLE_WORDS words. */
function looksLikeTitle(text: string): boolean {
  if (/[.!?]["”’)\]]*(?:\s|$)/u.test(text)) return false;
  const ws = words(text);
  if (ws.length === 0 || ws.length > MAX_TITLE_WORDS) return false;
  return ws.every((raw, i) => {
    const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (w === '' || /^\p{N}/u.test(w)) return true;
    if (i > 0 && MINOR_WORDS.has(w.toLowerCase())) return true;
    return /^\p{Lu}/u.test(w);
  });
}

/** True when the words right before the opening mark introduce a title (`a paper titled "…"`). */
const TITLE_INTRO_RE =
  /\b(?:titled|entitled|the\s+(?:article|book|paper|chapter|report|essay|study|novel|poem|film|song|album|play|series|volume|monograph|thesis|dissertation|editorial|column|lecture|talk|speech|section|journal|magazine))[\s,:]*$/iu;
/**
 * A reporting colon or verb right before the opening mark (`wrote:`, `states
 * that`, `put it,`, `according to Smith,`): what follows is a quotation, never
 * a title, whatever its capitals.
 */
const REPORTING_INTRO_RE =
  /(?::|\b(?:wr(?:ote|ites?|itten)|sa(?:id|ys|y)|state[sd]?|argue[sd]?|note[sd]?|conclude[sd]?|observe[sd]?|claim(?:s|ed)?|explain(?:s|ed)?|add(?:s|ed)?|remark(?:s|ed)?|insist(?:s|ed)?|assert(?:s|ed)?|report(?:s|ed)?|declare[sd]?|warn(?:s|ed)?|emphasi[sz]e[sd]?|stress(?:es|ed)?|suggest(?:s|ed)?|contend(?:s|ed)?|maintain(?:s|ed)?|put\s+it|puts\s+it|as\s+follows|that|according\s+to\s+[^,\n]{1,60},|in\s+(?:his|her|their|its)\s+words,?))[\s,]*$/iu;
/** A Markdown link or image destination whose title the mark opens: `](url "…`. */
const LINK_TITLE_RE = /\]\([^()\s]*[ \t]+$/;

/** Abbreviations whose period does not end a sentence. */
const ABBREVIATIONS = new Set([
  'p', 'pp', 'e.g', 'i.e', 'eg', 'ie', 'al', 'cf', 'vs', 'ch', 'chap', 'vol', 'vols', 'no', 'nos', 'fig', 'figs',
  'ed', 'eds', 'dr', 'mr', 'mrs', 'ms', 'prof', 'st', 'sec', 'para', 'ibid', 'op', 'cit', 'approx', 'ca', 'viz', 'etc',
]);

/** True when `text` (the prose between a citation and a quote) holds a sentence end. */
function endsSentence(text: string): boolean {
  if (/\n[ \t]*\n/.test(text)) return true;
  for (const m of text.matchAll(/([\p{L}\p{N}.]*)[.!?]["”’)\]]*(?=\s)/gu)) {
    const token = (m[1] ?? '').replace(/\.$/, '').toLowerCase();
    if (m[0].endsWith('.') || /[.]["”’)\]]*$/.test(m[0])) {
      if (ABBREVIATIONS.has(token)) continue;
      if (/^\p{L}$/u.test(token)) continue; // an initial: "J. Smith"
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Attribution.
// ---------------------------------------------------------------------------

/** The keys (with their locators) of one citation; a narrative `@k [p. 3]` takes the bracket after it. */
function attributionOf(c: CitationCluster, md: string): Attribution[] {
  const out: Attribution[] = [];
  const seen = new Set<string>();
  const trailing = c.narrative ? /^[ \t]*\[([^[\]@]*)\]/.exec(md.slice(c.end)) : null;
  for (const item of citationItems(c)) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    const written = (c.narrative ? trailing?.[1] ?? '' : item.suffix).replace(/^[\s,]+/, '').trim();
    out.push(written !== '' ? { key: item.key, locator: written } : { key: item.key });
  }
  return out;
}

/** The end of a narrative citation, past a `[locator]` bracket right after it. */
function citationEnd(c: CitationCluster, md: string): number {
  if (!c.narrative) return c.end;
  const trailing = /^[ \t]*\[[^[\]@]*\]/.exec(md.slice(c.end));
  return trailing === null ? c.end : c.end + trailing[0].length;
}

/** The citation that starts at `at` after whitespace (no blank line), or null. */
function citationRightAfter(md: string, at: number, cites: readonly CitationCluster[], maxAt = md.length): CitationCluster | null {
  const gap = /^[ \t]*(?:\n[ \t]*)?/.exec(md.slice(at))?.[0].length ?? 0;
  const start = at + gap;
  if (start >= maxAt) return null;
  return cites.find((c) => c.start === start) ?? null;
}

/**
 * The citation before `at` in the same sentence: the last one ending before
 * `at`, at most BEFORE_WINDOW characters back, with no sentence end between.
 */
function citationBefore(md: string, at: number, from: number, cites: readonly CitationCluster[]): CitationCluster | null {
  let best: CitationCluster | null = null;
  for (const c of cites) {
    if (c.start < from || c.end > at) continue;
    if (best === null || c.start > best.start) best = c;
  }
  if (best === null || at - best.start > BEFORE_WINDOW) return null;
  return endsSentence(md.slice(citationEnd(best, md), at)) ? null : best;
}

// ---------------------------------------------------------------------------
// Block quotes.
// ---------------------------------------------------------------------------

/**
 * A list-item or definition marker a block quote may follow on its line
 * (`- > …`, `1. > …`, `(a) > …`, `#. > …`, `(@) > …`, `:   > …`, `~ > …`).
 */
const ITEM_MARKER = String.raw`(?:[-*+:~]|\(?\d{1,9}[.)]|\(?[A-Za-z][.)]|\(?[ivxlcdmIVXLCDM]{1,6}[.)]|#[.)]|\(@[\w-]*\))`;
/**
 * A block-quote line: `>` after any indentation (a list item's continuation,
 * a nested list) and any list or definition markers — Pandoc reads each as a
 * BlockQuote. Deeper indentation outside a list is an indented code block to
 * Pandoc, which the grammar cannot prove: counted, fail closed.
 */
const BLOCK_QUOTE_LINE_RE = new RegExp(String.raw`^([ \t]*)(?:${ITEM_MARKER}[ \t]+)*>`);
const BLOCK_MARKERS_RE = new RegExp(String.raw`^(?:[ \t]*(?:${ITEM_MARKER}[ \t]+)*> ?)+`);
const LIST_ITEM_LINE_RE = new RegExp(String.raw`^ {0,3}${ITEM_MARKER}[ \t]`);

/** Columns of a line's leading whitespace (a tab to the next multiple of 4). */
function indentWidth(ws: string): number {
  let w = 0;
  for (const ch of ws) w = ch === '\t' ? w + 4 - (w % 4) : w + 1;
  return w;
}

/**
 * True when line `i` is a block-quote line: `>` after at most three columns
 * of indentation (and any list or definition markers), or after more inside
 * a list or definition (a line indented under an item). Four columns outside
 * a list is an indented code block to Pandoc, never a quote.
 */
function blockLine(lines: readonly Line[], i: number): boolean {
  const m = BLOCK_QUOTE_LINE_RE.exec(lines[i]!.text);
  if (m === null) return false;
  if (indentWidth(m[1] ?? '') < 4) return true;
  for (let j = i - 1; j >= 0; j -= 1) {
    const t = lines[j]!.text;
    if (/^[ \t\r]*$/.test(t)) continue;
    if (LIST_ITEM_LINE_RE.test(t)) return true;
    if (!/^[ \t]/.test(t)) return false; // an unindented line that is not an item ends the list
  }
  return false;
}

interface Line {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function linesOf(md: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (;;) {
    const nl = md.indexOf('\n', start);
    const end = nl === -1 ? md.length : nl;
    out.push({ start, end, text: md.slice(start, end) });
    if (nl === -1) return out;
    start = nl + 1;
  }
}

const isBlank = (l: Line | undefined): boolean => l === undefined || /^[ \t\r]*$/.test(l.text);

/** Every block-quote run: its line range and its text (markers removed). */
function blockRuns(lines: readonly Line[]): Array<{ first: number; last: number; text: string }> {
  const out: Array<{ first: number; last: number; text: string }> = [];
  let i = 0;
  while (i < lines.length) {
    if (!blockLine(lines, i)) {
      i += 1;
      continue;
    }
    const first = i;
    const parts: string[] = [];
    let lazyOk = false;
    while (i < lines.length) {
      const l = lines[i]!;
      if (blockLine(lines, i)) {
        const content = l.text.replace(BLOCK_MARKERS_RE, '');
        parts.push(content);
        lazyOk = !/^[ \t\r]*$/.test(content);
      } else if (lazyOk && !isBlank(l)) {
        parts.push(l.text); // lazy continuation of the quoted paragraph
      } else {
        break;
      }
      i += 1;
    }
    out.push({ first, last: i - 1, text: parts.join('\n') });
  }
  return out;
}

/** The offset where the paragraph holding line `j` ends. */
function paragraphEnd(lines: readonly Line[], j: number): number {
  let k = j;
  while (k + 1 < lines.length && !isBlank(lines[k + 1]) && !blockLine(lines, k + 1)) k += 1;
  return lines[k]!.end;
}

/** The last citation of `text` when nothing but punctuation follows it. */
function trailingCitation(text: string): CitationCluster | null {
  const cites = findCitations(text);
  const last = cites[cites.length - 1];
  if (last === undefined) return null;
  return /^[\s.,;:!?)\]"'”’—–-]*$/u.test(text.slice(citationEnd(last, text))) ? last : null;
}

function blockCandidates(md: string, lines: readonly Line[], cites: readonly CitationCluster[], minWords: number): Candidate[] {
  const out: Candidate[] = [];
  for (const run of blockRuns(lines)) {
    const text = quoteText(run.text);
    if (words(text).length < minWords) continue;
    const firstLine = lines[run.first]!;
    // 1. A citation that ends the block.
    const inside = trailingCitation(run.text);
    let cite: { c: CitationCluster; src: string } | null = inside !== null ? { c: inside, src: run.text } : null;
    // The citation opening the next paragraph (after at most two blank lines):
    // at the start of the line (`-@k` included) or after a dash (`— @k`).
    let opener: CitationCluster | null = null;
    let openerAlone = false;
    {
      let j = run.last + 1;
      let blanks = 0;
      while (j < lines.length && isBlank(lines[j]) && blanks < 2) {
        j += 1;
        blanks += 1;
      }
      const next = lines[j];
      if (next !== undefined && !isBlank(next) && !blockLine(lines, j)) {
        const ws = /^[ \t]*/.exec(next.text)?.[0].length ?? 0;
        const dashed = /^[ \t]*(?:[—–]|--?)[ \t]*/.exec(next.text)?.[0].length ?? -1;
        opener = cites.find((x) => x.start === next.start + ws || (dashed > ws && x.start === next.start + dashed)) ?? null;
        // A paragraph that is only the citation (`[@k, p. 3].`) attributes the block outright.
        openerAlone = opener !== null && /^[\s.,;:!?)\]]*$/u.test(md.slice(citationEnd(opener, md), paragraphEnd(lines, j)));
      }
    }
    // 2. A citation standing alone after the block.
    if (cite === null && opener !== null && openerAlone) cite = { c: opener, src: md };
    // 3. A citation in the last sentence of the lead-in paragraph (`@k puts it this way:`).
    if (cite === null) {
      let j = run.first - 1;
      if (j >= 0 && isBlank(lines[j])) j -= 1;
      const lead = lines[j];
      if (lead !== undefined && !isBlank(lead) && !blockLine(lines, j)) {
        let k = j;
        while (k - 1 >= 0 && !isBlank(lines[k - 1]) && !blockLine(lines, k - 1)) k -= 1;
        const c = citationBefore(md, lead.end, lines[k]!.start, cites);
        if (c !== null) cite = { c, src: md };
      }
    }
    // 4. A citation that opens the next sentence after the block (`-@k adds …`).
    if (cite === null && opener !== null) cite = { c: opener, src: md };
    const firstText = firstLine.text.replace(BLOCK_MARKERS_RE, '');
    const alnum = firstText.search(/[\p{L}\p{N}_*]/u);
    const probe = alnum > 0 ? firstLine.start + (firstLine.text.length - firstText.length) + alnum - 1 : -1;
    out.push({
      kind: 'block',
      start: firstLine.start,
      probe,
      text,
      attribution: cite === null ? [] : attributionOf(cite.c, cite.src),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Inline quotes.
// ---------------------------------------------------------------------------

interface Span {
  /** Offset of the opening mark. */
  readonly open: number;
  /** Offset of the closing mark. */
  readonly close: number;
}

const ALNUM_RE = /[\p{L}\p{N}]/u;

/** No offsets set aside. */
const NO_MARKS: ReadonlySet<number> = new Set();

/** True when an odd run of backslashes ends just before `i` (the mark there is escaped). */
function oddBackslashesBefore(md: string, i: number): boolean {
  let n = 0;
  for (let j = i - 1; j >= 0 && md[j] === '\\'; j -= 1) n += 1;
  return n % 2 === 1;
}

/**
 * The double-quoted spans of one paragraph (`[from, to)`), paired left to
 * right as Pandoc's smart-quote reader pairs them: outside a quote, `"` or
 * `“` followed by a non-space (a straight `"` also not right after a letter or
 * digit, where it is an inch mark or a closing quote) opens one; inside, the
 * next `"` or `”` closes it, and another `“` starts it again. An escaped `\"`
 * is a literal mark inside such a quote; outside every one, escaped marks
 * pair among themselves (`\"…\"`): Pandoc prints them as straight `"`, which
 * a reader of the export sees as quotation marks.
 */
function doubleQuoteSpans(md: string, from: number, to: number, taken: ReadonlySet<number> = NO_MARKS): Span[] {
  const out = smartDoubleQuoteSpans(md, from, to, taken);
  let open = -1;
  for (let i = from; i < to; i += 1) {
    if (md[i] !== '"' || taken.has(i) || !oddBackslashesBefore(md, i) || out.some((s) => i >= s.open && i <= s.close)) continue;
    if (open === -1) {
      if (/\S/u.test(md[i + 1] ?? ' ')) open = i;
    } else {
      out.push({ open, close: i });
      open = -1;
    }
  }
  return out.sort((a, b) => a.open - b.open);
}

/** The double-quoted spans Pandoc's smart reader makes (escaped marks are literals). */
function smartDoubleQuoteSpans(md: string, from: number, to: number, taken: ReadonlySet<number>): Span[] {
  const out: Span[] = [];
  let open = -1;
  for (let i = from; i < to; i += 1) {
    const c = md[i];
    if (c !== '"' && c !== '“' && c !== '”') continue;
    if (taken.has(i)) continue; // a mark of another language's quote (`„…“`)
    if (oddBackslashesBefore(md, i)) continue;
    if (open !== -1 && c === '“' && /\S/u.test(md[i + 1] ?? ' ')) {
      open = i;
      continue;
    }
    if (open !== -1 && (c === '"' || c === '”')) {
      out.push({ open, close: i });
      open = -1;
      continue;
    }
    if (open === -1 && (c === '"' || c === '“') && /\S/u.test(md[i + 1] ?? ' ') && i + 1 < to) {
      if (c === '"' && ALNUM_RE.test(md[i - 1] ?? ' ')) continue;
      open = i;
    }
  }
  return out;
}

/** Elisions a straight `'` opens without opening a quote ('90s, 'tis, 'em, 'n', 'til, 'cause). */
const ELISION_RE = /^'(?:\d\d?s\b|tis\b|twas\b|em\b|n'|til\b|cause\b)/iu;

/**
 * True when the mark at `i` can open a single quote: `‘`, or a straight `'`
 * that is not inside a word (`it's`, `the authors'` — right after a letter
 * or digit) and not an elision; either followed by a non-space.
 */
function singleOpener(md: string, i: number, taken: ReadonlySet<number> = NO_MARKS): boolean {
  if (taken.has(i)) return false;
  const c = md[i];
  if (c !== '‘' && c !== "'") return false;
  if (!/\S/u.test(md[i + 1] ?? ' ')) return false;
  if (c === "'" && (ALNUM_RE.test(md[i - 1] ?? ' ') || ELISION_RE.test(md.slice(i, i + 8)))) return false;
  return true;
}

/** True when the mark at `i` can close a single quote: `’` or `'` not followed by a letter or digit (`it’s` is an apostrophe), a `'` not after a space. */
function singleCloser(md: string, i: number, taken: ReadonlySet<number> = NO_MARKS): boolean {
  if (taken.has(i)) return false;
  const c = md[i];
  if (c !== '’' && c !== "'") return false;
  if (ALNUM_RE.test(md[i + 1] ?? ' ')) return false;
  return c === '’' || !/\s/u.test(md[i - 1] ?? ' ');
}

/**
 * The single-quoted spans of one paragraph, straight ('…') or typographic
 * (‘…’), mixed as Pandoc mixes them. Of the closing marks before the next
 * opening mark, the first one followed by a citation closes the quote;
 * without one, the last does (a plural possessive `the students’` inside the
 * quote never cuts it short).
 */
function singleQuoteSpans(md: string, from: number, to: number, cites: readonly CitationCluster[], taken: ReadonlySet<number> = NO_MARKS): Span[] {
  const out: Span[] = [];
  const nextOpener = (at: number): number => {
    for (let j = at; j < to; j += 1) if (singleOpener(md, j, taken)) return j;
    return -1;
  };
  let open = nextOpener(from);
  while (open !== -1) {
    const nextOpen = nextOpener(open + 1);
    const limit = nextOpen === -1 ? to : nextOpen;
    const closers: number[] = [];
    for (let j = open + 1; j < limit; j += 1) if (singleCloser(md, j, taken)) closers.push(j);
    const cited = closers.find((j) => citationRightAfter(md, j + 1, cites, to) !== null);
    const close = cited ?? closers[closers.length - 1];
    if (close !== undefined) out.push({ open, close });
    open = close !== undefined ? nextOpener(close + 1) : nextOpen;
  }
  return out;
}

/**
 * The other languages' quotation marks (see the header): each opening mark and
 * the marks that close it. `»` opens a quote only where no `«` is open
 * (German »…«, Swedish »…»); a closing mark must follow a non-space, and a
 * `’` followed by a letter is an apostrophe.
 */
const FOREIGN_MARKS: Readonly<Record<string, readonly string[]>> = {
  '«': ['»'],
  '»': ['«', '»'],
  '‹': ['›'],
  '›': ['‹', '›'],
  '„': ['“', '”'],
  '‚': ['‘', '’'],
  '「': ['」'],
  '『': ['』'],
};

/** The spans of one paragraph in the other languages' quotation marks (see FOREIGN_MARKS). */
function foreignQuoteSpans(md: string, from: number, to: number): Span[] {
  const out: Span[] = [];
  let i = from;
  while (i < to) {
    const closers = FOREIGN_MARKS[md[i] as string];
    if (closers !== undefined && /\S/u.test(md[i + 1] ?? ' ')) {
      let close = -1;
      for (let j = i + 1; j < to; j += 1) {
        const d = md[j] as string;
        if (!closers.includes(d) || !/\S/u.test(md[j - 1] ?? ' ')) continue;
        if (d === '’' && ALNUM_RE.test(md[j + 1] ?? ' ')) continue;
        close = j;
        break;
      }
      if (close !== -1) {
        out.push({ open: i, close });
        i = close + 1;
        continue;
      }
    }
    i += 1;
  }
  return out;
}

/** The paragraphs of `md` outside block-quote runs, as `[start, end)` offsets. */
function paragraphs(lines: readonly Line[], blocked: ReadonlySet<number>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let i = 0;
  while (i < lines.length) {
    if (isBlank(lines[i]) || blocked.has(i)) {
      i += 1;
      continue;
    }
    const first = i;
    while (i + 1 < lines.length && !isBlank(lines[i + 1]) && !blocked.has(i + 1)) i += 1;
    out.push([lines[first]!.start, lines[i]!.end]);
    i += 1;
  }
  return out;
}

function inlineCandidates(
  md: string,
  lines: readonly Line[],
  blocked: ReadonlySet<number>,
  cites: readonly CitationCluster[],
  minWords: number,
): Candidate[] {
  const out: Candidate[] = [];
  for (const [from, to] of paragraphs(lines, blocked)) {
    // The other languages' marks first: a `“` closing „…“ never opens a quote of its own.
    const foreign = foreignQuoteSpans(md, from, to);
    const marks = new Set(foreign.flatMap((f) => [f.open, f.close]));
    const spans = [...foreign, ...doubleQuoteSpans(md, from, to, marks), ...singleQuoteSpans(md, from, to, cites, marks)].sort((a, b) => a.open - b.open);
    let outerEnd = -1;
    for (const s of spans) {
      if (s.open < outerEnd) continue; // a quote inside a quote is part of the outer one
      outerEnd = s.close;
      // An escaped closing mark (`\"`): its backslash is not part of the quote.
      const raw = md.slice(s.open + 1, oddBackslashesBefore(md, s.close) ? s.close - 1 : s.close);
      const text = quoteText(raw);
      if (words(text).length < minWords) continue;
      const lineStart = md.lastIndexOf('\n', s.open) + 1;
      const before = md.slice(lineStart, s.open);
      if (LINK_TITLE_RE.test(before)) continue;
      // A title (see the header) — never after a reporting colon or verb.
      if (TITLE_INTRO_RE.test(before)) continue;
      // (After `called` / `named` only what looks like a title is one: `Smith called
      // "for an immediate halt to all funding …"` is a quote.)
      if (!REPORTING_INTRO_RE.test(before) && looksLikeTitle(text)) continue;
      const after = citationRightAfter(md, s.close + 1, cites, to);
      const cite = after ?? citationBefore(md, s.open, from, cites);
      out.push({
        kind: 'inline',
        start: s.open,
        probe: s.open,
        text,
        attribution: cite === null ? [] : attributionOf(cite, md),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Code.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The extractor.
// ---------------------------------------------------------------------------

/**
 * Every direct quote of `draftMd` in document order (see the header): one
 * entry per cited key, or one UNATTRIBUTED entry (`citekey: null`) for a
 * quote no citation claims.
 */
export function extractQuotes(draftMd: string, opts: ExtractQuotesOptions = {}): ExtractedQuote[] {
  const minWords = Math.max(1, Math.floor(opts.minWords ?? DEFAULT_QUOTE_MIN_WORDS));
  const md = decodeQuoteEntities(draftMd.replace(/\r\n/g, '\n'));
  const lines = linesOf(md);
  const cites = findCitations(md);

  const blocks = blockCandidates(md, lines, cites, minWords);
  // Inline quotes inside a block quote are part of its text, checked with it.
  const blocked = new Set<number>();
  for (const run of blockRuns(lines)) for (let i = run.first; i <= run.last; i += 1) blocked.add(i);

  const candidates = [...blocks, ...inlineCandidates(md, lines, blocked, cites, minWords)].sort((a, b) => a.start - b.start);
  // Quotes inside code the one grammar proves Pandoc reads as code (fenced
  // blocks, inline code spans) are not quotes; code it cannot prove counts as
  // text (fail closed: the quote is checked).
  const code = provableCodeSpans(md);

  const out: ExtractedQuote[] = [];
  let n = 0;
  for (const c of candidates) {
    if (offsetInSpans(c.probe >= 0 ? c.probe : c.start, code)) continue;
    const id = quoteId(n);
    n += 1;
    const line = lineAt(md, c.start);
    if (c.attribution.length === 0) {
      out.push({ id, text: c.text, citekey: null, kind: c.kind, line });
      continue;
    }
    for (const a of c.attribution) {
      out.push({ id, text: c.text, citekey: a.key, kind: c.kind, line, ...(a.locator !== undefined ? { locator: a.locator } : {}) });
    }
  }
  return out;
}
