// bin/lib/quote-extractor.ts — every direct quote of a draft, for Pass 3 and
// the drafter's quote policy (VRFY-18, D-20-17; GRND-14).
//
// A direct quote is text a draft presents as the words of a source. Pass 3
// checks each one against the source's real text, so a quote this module
// misses is a quote nobody checks: every rule below errs toward extracting.
//
// What counts as a quote (outside code the one grammar proves Pandoc reads as
// code — citation-token.ts; everything else counts, fail closed):
//   - inline text in straight or typographic double quotes ("…", “…”) or in
//     typographic single quotes (‘…’), paired the way Pandoc's smart-quote
//     reader pairs them, one paragraph at a time;
//   - a block quote: one quote per `>` run, lazy continuation lines included
//     (Pandoc continues a block-quote paragraph on a line without `>`);
//   - with at least `[verification] quote_min_words` words once citations are
//     stripped (default 5: DEFAULT_QUOTE_MIN_WORDS). Fewer words is a scare
//     quote or a quoted term, not a quotation.
// Excluded by rule (inline only): a quoted title — preceded by `titled`,
// `entitled`, `called`, `named`, `the article`, `the book` or `the paper`, or
// written in Title Case with no sentence-ending punctuation inside and at most
// 12 words — and a Markdown link title (`[text](url "title")`).
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
  findNarrativeCitations,
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
  /** The offset the code probe overwrites (see provablyInCode), or -1 when none can be probed. */
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
  return replaceCitations(raw, () => ' ')
    .replace(/!?\[([^[\]]*)\]\([^()\s]*(?:\s+"[^"]*")?\)/g, '$1')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .replace(/\*+/g, '')
    .replace(/(^|[\s\p{P}])_+|_+(?=[\s\p{P}]|$)/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
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
const TITLE_INTRO_RE = /\b(?:titled|entitled|called|named|the\s+article|the\s+book|the\s+paper)[\s,:]*$/iu;
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

const BLOCK_LINE_RE = /^ {0,3}>/;
const BLOCK_MARKERS_RE = /^(?: {0,3}> ?)+/;

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
    if (!BLOCK_LINE_RE.test(lines[i]!.text)) {
      i += 1;
      continue;
    }
    const first = i;
    const parts: string[] = [];
    let lazyOk = false;
    while (i < lines.length) {
      const l = lines[i]!;
      if (BLOCK_LINE_RE.test(l.text)) {
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
    // 1a. A citation that ends the block.
    const inside = trailingCitation(run.text);
    let cite: { c: CitationCluster; src: string } | null = inside !== null ? { c: inside, src: run.text } : null;
    // 1b. A citation opening the next paragraph (after at most two blank lines), after an optional dash.
    if (cite === null) {
      let j = run.last + 1;
      let blanks = 0;
      while (j < lines.length && isBlank(lines[j]) && blanks < 2) {
        j += 1;
        blanks += 1;
      }
      const next = lines[j];
      if (next !== undefined && !isBlank(next) && !BLOCK_LINE_RE.test(next.text)) {
        const lead = /^[ \t]*(?:[—–]|--?)?[ \t]*/.exec(next.text)?.[0].length ?? 0;
        const c = cites.find((x) => x.start === next.start + lead);
        if (c !== undefined) cite = { c, src: md };
      }
    }
    // 2. A citation in the last sentence of the lead-in paragraph.
    if (cite === null) {
      let j = run.first - 1;
      if (j >= 0 && isBlank(lines[j])) j -= 1;
      const lead = lines[j];
      if (lead !== undefined && !isBlank(lead) && !BLOCK_LINE_RE.test(lead.text)) {
        let k = j;
        while (k - 1 >= 0 && !isBlank(lines[k - 1]) && !BLOCK_LINE_RE.test(lines[k - 1]!.text)) k -= 1;
        const c = citationBefore(md, lead.end, lines[k]!.start, cites);
        if (c !== null) cite = { c, src: md };
      }
    }
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

/**
 * The double-quoted spans of one paragraph (`[from, to)`), paired left to
 * right as Pandoc's smart-quote reader pairs them: outside a quote, `"` or
 * `“` followed by a non-space (a straight `"` also not right after a letter or
 * digit, where it is an inch mark or a closing quote) opens one; inside, the
 * next `"` or `”` closes it, and another `“` starts it again.
 */
function doubleQuoteSpans(md: string, from: number, to: number): Span[] {
  const out: Span[] = [];
  let open = -1;
  for (let i = from; i < to; i += 1) {
    const c = md[i];
    if (c !== '"' && c !== '“' && c !== '”') continue;
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

/**
 * The typographic single-quoted spans of one paragraph. A `’` right before a
 * letter or digit is an apostrophe (`it’s`), never a closing mark. Of the
 * closing marks before the next `‘`, the first one followed by a citation
 * closes the quote; without one, the last does (a plural possessive `the
 * students’` inside the quote never cuts it short).
 */
function singleQuoteSpans(md: string, from: number, to: number, cites: readonly CitationCluster[]): Span[] {
  const out: Span[] = [];
  let i = from;
  while (i < to) {
    const open = md.indexOf('‘', i);
    if (open === -1 || open >= to) break;
    if (!/\S/u.test(md[open + 1] ?? ' ')) {
      i = open + 1;
      continue;
    }
    const nextOpen = md.indexOf('‘', open + 1);
    const limit = nextOpen === -1 || nextOpen > to ? to : nextOpen;
    const closers: number[] = [];
    for (let j = md.indexOf('’', open + 1); j !== -1 && j < limit; j = md.indexOf('’', j + 1)) {
      if (!ALNUM_RE.test(md[j + 1] ?? ' ')) closers.push(j);
    }
    const cited = closers.find((j) => citationRightAfter(md, j + 1, cites, to) !== null);
    const close = cited ?? closers[closers.length - 1];
    if (close !== undefined) out.push({ open, close });
    i = close !== undefined ? close + 1 : limit;
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
    const spans = [...doubleQuoteSpans(md, from, to), ...singleQuoteSpans(md, from, to, cites)].sort((a, b) => a.open - b.open);
    let outerEnd = -1;
    for (const s of spans) {
      if (s.open < outerEnd) continue; // a quote inside a quote is part of the outer one
      outerEnd = s.close;
      const raw = md.slice(s.open + 1, s.close);
      const text = quoteText(raw);
      if (words(text).length < minWords) continue;
      const lineStart = md.lastIndexOf('\n', s.open) + 1;
      const before = md.slice(lineStart, s.open);
      if (LINK_TITLE_RE.test(before)) continue;
      if (TITLE_INTRO_RE.test(before) || looksLikeTitle(text)) continue;
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

/** Characters the probe may overwrite: none of them changes how the grammar proves code. */
const PROBE_SAFE = new Set([' ', '\t', '"', '“', '”', '‘', '’', "'", '>', '*', '_']);
const KEY_START_RE = /[\p{L}\p{N}_*]/u;
const FENCE_LIKE_RE = /^ {0,3}(?:`{3,}|~{3,})/;

/**
 * Which probe offsets lie in code the one citation grammar (citation-token.ts)
 * proves Pandoc reads as code. The grammar skips a narrative `@key` there and
 * nowhere else, so each probe character is overwritten with `@` — making the
 * word after it a narrative citation — and the probe is in code exactly when
 * the grammar reports that citation in a control copy with every backtick and
 * tilde neutralised (no code at all) but not in the draft itself. Only
 * characters that play no part in the grammar's code proof are overwritten; a
 * probe it cannot place counts as text (fail closed: the quote is checked).
 */
function provablyInCode(md: string, probes: readonly number[]): Set<number> {
  const out = new Set<number>();
  if (!md.includes('`') && !md.includes('~')) return out;
  const usable = probes.filter((p) => {
    if (p < 0 || !PROBE_SAFE.has(md[p] ?? '') || !KEY_START_RE.test(md[p + 1] ?? '')) return false;
    const lineStart = md.lastIndexOf('\n', p) + 1;
    return !FENCE_LIKE_RE.test(md.slice(lineStart, p + 1));
  });
  if (usable.length === 0) return out;
  // Every probe character is one UTF-16 unit, so offsets stay put.
  let probed = '';
  let last = 0;
  for (const p of [...new Set(usable)].sort((a, b) => a - b)) {
    probed += md.slice(last, p) + '@';
    last = p + 1;
  }
  probed += md.slice(last);
  const control = probed.replace(/[`~]/g, "'");
  const starts = (text: string): Set<number> => {
    const s = new Set<number>();
    for (const c of findNarrativeCitations(text)) s.add(text[c.start] === '-' ? c.start + 1 : c.start);
    return s;
  };
  const inDraft = starts(probed);
  const inControl = starts(control);
  for (const p of usable) if (inControl.has(p) && !inDraft.has(p)) out.add(p);
  return out;
}

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
  const md = draftMd.replace(/\r\n/g, '\n');
  const lines = linesOf(md);
  const cites = findCitations(md);

  const blocks = blockCandidates(md, lines, cites, minWords);
  // Inline quotes inside a block quote are part of its text, checked with it.
  const blocked = new Set<number>();
  for (const run of blockRuns(lines)) for (let i = run.first; i <= run.last; i += 1) blocked.add(i);

  const candidates = [...blocks, ...inlineCandidates(md, lines, blocked, cites, minWords)].sort((a, b) => a.start - b.start);
  const code = provablyInCode(md, candidates.map((c) => c.probe));

  const out: ExtractedQuote[] = [];
  let n = 0;
  for (const c of candidates) {
    if (code.has(c.probe)) continue;
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
