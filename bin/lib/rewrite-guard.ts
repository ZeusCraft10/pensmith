// bin/lib/rewrite-guard.ts — the ONE guard around every model rewrite of
// verified prose (Phase 21, EXP-10, EXP-14; D-21-14).
//
// compile's boundary smoother, done's humanizer and the Tier-1 submission tools
// (PLUG-07 boundary submissions, PLUG-10 humanized FINAL.md) rewrite text the
// gate core already judged. None of them may change what the gate judged, so
// every rewrite goes through the same two steps:
//
//   1. maskForRewrite(text) — before the model sees the text, every citation
//      cluster the one Pandoc grammar reads (citation-token.ts replaceCitations:
//      `[@k]`, clusters, locators, `[-@k]`, `@{k}`, narrative `@k`) becomes an
//      opaque `{{cite_K_M}}` placeholder, and then every direct quote of at
//      least `[verification] quote_min_words` words — a double-quoted span (",
//      “…”, «…», „…“) or a block-quote run — becomes `{{quote_K_M}}`. `K` is a
//      caller namespace (the section index) so two masked windows never share a
//      placeholder.
//   2. validateRewrite(...) — after the call, the rewrite is accepted only when
//        - the placeholder multiset is unchanged (each placeholder exactly once:
//          `citation set changed` / `a quoted passage changed`);
//        - every ATX heading line is byte-identical, in order (`a heading changed`);
//        - nothing outside the allowed paragraphs changed (the smoother may touch
//          only the two boundary paragraphs; the humanizer any body paragraph);
//        - restored, it cites exactly the keys the original did (the broad
//          grammar, D-18-40) and holds the same direct quotes (quote-extractor.ts,
//          the Pass-3 reader) — masking is the first line, this the second;
//        - boundaryAdditions finds nothing new the gate would check: no text
//          finding (an unparseable or unsupported citation form, TEXT_SCANNERS),
//          no direct quote, no bare identifier (VRFY-25).
//      A rejected rewrite keeps the original text; the reasons say why.
//
// The guard never calls a model and never writes a file. The gate core still
// runs over the final text (compile's DRAFT.md is gated by done; done gates the
// humanized text before it becomes FINAL.md — humanizer.ts acceptHumanized).

import { extractCitedKeysForVerification, replaceCitations } from './citation-token.js';
import { TEXT_SCANNERS } from './verify/gate.js';
import { extractQuotes } from './quote-extractor.js';
import { findBareIdentifiers } from './doi.js';
import { DEFAULT_QUOTE_MIN_WORDS } from './schemas/config.js';

/** A masked text and how to put the original spans back. */
export interface RewriteMask {
  /** The text the model sees: citations and direct quotes replaced by placeholders. */
  readonly masked: string;
  /** `{{cite_K_M}}` → the citation as written. */
  readonly cites: ReadonlyMap<string, string>;
  /** `{{quote_K_M}}` → the quoted span as written (its citations still masked). */
  readonly quotes: ReadonlyMap<string, string>;
}

export interface MaskOptions {
  /** The namespace `K` of this window's placeholders (default 0). */
  readonly namespace?: number;
  /** `[verification] quote_min_words` (default 5): shorter quoted spans are not masked. */
  readonly quoteMinWords?: number;
}

/** Every placeholder token the guard writes. Disjoint from the citation grammar (no `@`). */
const PLACEHOLDER_RE = /\{\{(?:cite|quote)_\d+_\d+\}\}/g;

/** The words of a span (tokens holding a letter or a digit). */
function wordCount(s: string): number {
  return s.split(/\s+/u).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Opening mark → its closing marks. */
const QUOTE_PAIRS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['"', ['"']],
  ['“', ['”']], // “ ”
  ['«', ['»']], // « »
  ['„', ['“', '”']], // „ “ / „ ”
];

/**
 * The double-quoted spans of one paragraph (offsets into `text`, the marks
 * included), outermost first, never crossing a blank line. A straight `"`
 * pairs with the next straight `"`.
 */
function quotedSpans(text: string, from: number, to: number): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let i = from;
  while (i < to) {
    const ch = text[i] as string;
    const pair = QUOTE_PAIRS.find(([open]) => open === ch);
    if (pair === undefined) {
      i += 1;
      continue;
    }
    let close = -1;
    for (let j = i + 1; j < to; j += 1) {
      if (pair[1].includes(text[j] as string)) {
        close = j;
        break;
      }
    }
    if (close === -1) {
      i += 1;
      continue;
    }
    spans.push([i, close + 1]);
    i = close + 1;
  }
  return spans;
}

/** [start, end) of each paragraph (blocks between blank lines) of `text`. */
function paragraphRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /\n[ \t]*\n/g;
  let start = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    out.push([start, m.index]);
    start = m.index + m[0].length;
  }
  out.push([start, text.length]);
  return out;
}

/** True when every non-blank line of the block is a block-quote line. */
function isBlockQuote(block: string): boolean {
  const lines = block.split('\n').filter((l) => l.trim().length > 0);
  return lines.length > 0 && lines.every((l) => /^\s{0,3}>/.test(l));
}

/**
 * Mask every citation and every direct quote of `text` (see the header). The
 * model sees `masked`; unmaskRewrite puts the originals back.
 */
export function maskForRewrite(text: string, opts: MaskOptions = {}): RewriteMask {
  const k = opts.namespace ?? 0;
  const minWords = Math.max(1, Math.floor(opts.quoteMinWords ?? DEFAULT_QUOTE_MIN_WORDS));
  const cites = new Map<string, string>();
  let m = 0;
  const citeMasked = replaceCitations(text, (cluster) => {
    const ph = `{{cite_${k}_${m}}}`;
    m += 1;
    cites.set(ph, cluster.text);
    return ph;
  });
  const quotes = new Map<string, string>();
  let q = 0;
  const parts: string[] = [];
  let cursor = 0;
  for (const [from, to] of paragraphRanges(citeMasked)) {
    const block = citeMasked.slice(from, to);
    if (isBlockQuote(block) && wordCount(block.replace(PLACEHOLDER_RE, ' ').replace(/^\s*>/gm, ' ')) >= minWords) {
      parts.push(citeMasked.slice(cursor, from));
      const ph = `{{quote_${k}_${q}}}`;
      q += 1;
      quotes.set(ph, block);
      parts.push(ph);
      cursor = to;
      continue;
    }
    for (const [s, e] of quotedSpans(citeMasked, from, to)) {
      const span = citeMasked.slice(s, e);
      if (wordCount(span.slice(1, -1).replace(PLACEHOLDER_RE, ' ')) < minWords) continue;
      parts.push(citeMasked.slice(cursor, s));
      const ph = `{{quote_${k}_${q}}}`;
      q += 1;
      quotes.set(ph, span);
      parts.push(ph);
      cursor = e;
    }
  }
  parts.push(citeMasked.slice(cursor));
  return { masked: parts.join(''), cites, quotes };
}

/** Put the masked spans back: quotes first (their citations are still masked), then citations — each in one pass. */
export function unmaskRewrite(text: string, mask: RewriteMask): string {
  const withQuotes = text.replace(/\{\{quote_\d+_\d+\}\}/g, (ph) => mask.quotes.get(ph) ?? ph);
  return withQuotes.replace(/\{\{cite_\d+_\d+\}\}/g, (ph) => mask.cites.get(ph) ?? ph);
}

/** placeholder → how often it occurs. */
function placeholderCounts(text: string, kind: 'cite' | 'quote'): Map<string, number> {
  const counts = new Map<string, number>();
  const re = kind === 'cite' ? /\{\{cite_\d+_\d+\}\}/g : /\{\{quote_\d+_\d+\}\}/g;
  for (const hit of text.matchAll(re)) counts.set(hit[0], (counts.get(hit[0]) ?? 0) + 1);
  return counts;
}

function sameCounts(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

function sameMultiset(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}

/** The ATX heading lines of a text, in order. */
export function headingLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n').filter((l) => /^\s{0,3}#{1,6}(?:\s|$)/.test(l));
}

/**
 * What `after` (a rewrite) adds to `before` that the gate core would check — a
 * text finding (an unsupported or unparseable citation form), a direct quote,
 * a bare identifier — as a short phrase, or null when it adds none (VRFY-25).
 */
export function boundaryAdditions(before: string, after: string, quoteMinWords?: number): string | null {
  const findings = (t: string): string[] => TEXT_SCANNERS.flatMap((scan) => scan(t)).map((f) => `${f.verdict} \`${f.text}\``);
  const was = findings(before);
  for (const f of findings(after)) {
    const at = was.indexOf(f);
    if (at === -1) return f;
    was.splice(at, 1);
  }
  const opts = quoteMinWords !== undefined ? { minWords: quoteMinWords } : {};
  const quotes = new Set(extractQuotes(before, opts).map((x) => x.text));
  const newQuote = extractQuotes(after, opts).find((x) => !quotes.has(x.text));
  if (newQuote !== undefined) return `a direct quote ("${newQuote.text.slice(0, 40)}…")`;
  const ids = new Set(findBareIdentifiers(before).map((b) => `${b.kind}:${b.id}`));
  const newId = findBareIdentifiers(after).find((b) => !ids.has(`${b.kind}:${b.id}`));
  if (newId !== undefined) return `an identifier written in the prose (${newId.text})`;
  return null;
}

export interface ValidateRewriteInput {
  /** The original text, unmasked (what maskForRewrite was given). */
  readonly original: string;
  /** The mask the model's input was built with. */
  readonly mask: RewriteMask;
  /** The model's reply: the rewritten masked text. */
  readonly rewritten: string;
  /**
   * The paragraphs (0-based, blocks between blank lines of the masked text) the
   * rewrite may change. Given: the rewrite must keep the paragraph count and
   * every other paragraph byte-identical (the smoother: the two boundary
   * paragraphs). Omitted: any paragraph may change (the humanizer).
   */
  readonly allowedParagraphs?: readonly number[];
  /** `[verification] quote_min_words`, for the quote comparison (default 5). */
  readonly quoteMinWords?: number;
}

export interface RewriteVerdict {
  readonly ok: boolean;
  /** The restored rewrite when accepted, else the original text. */
  readonly text: string;
  /** Why it was rejected (empty when accepted). The first is the report's reason. */
  readonly reasons: readonly string[];
}

/**
 * Accept or reject a model rewrite of masked text (see the header). Pure,
 * deterministic, never throws.
 */
export function validateRewrite(input: ValidateRewriteInput): RewriteVerdict {
  const reasons: string[] = [];
  const rewritten = input.rewritten.replace(/\r\n/g, '\n').trim();
  const reject = (): RewriteVerdict => ({ ok: false, text: input.original, reasons });
  if (rewritten.length === 0) {
    reasons.push('empty rewrite');
    return reject();
  }
  const maskedBefore = input.mask.masked.replace(/\r\n/g, '\n').trim();
  if (!sameCounts(placeholderCounts(maskedBefore, 'cite'), placeholderCounts(rewritten, 'cite'))) reasons.push('citation set changed');
  if (!sameCounts(placeholderCounts(maskedBefore, 'quote'), placeholderCounts(rewritten, 'quote'))) reasons.push('a quoted passage changed');
  const before = headingLines(maskedBefore);
  const after = headingLines(rewritten);
  if (before.length !== after.length || before.some((h, i) => h !== after[i])) reasons.push('a heading changed');
  if (input.allowedParagraphs !== undefined) {
    const allowed = new Set(input.allowedParagraphs);
    const pb = paragraphRanges(maskedBefore).map(([s, e]) => maskedBefore.slice(s, e));
    const pa = paragraphRanges(rewritten).map(([s, e]) => rewritten.slice(s, e));
    if (pb.length !== pa.length) reasons.push(`paragraph structure changed (${pb.length} paragraph(s) became ${pa.length})`);
    else if (pb.some((p, i) => !allowed.has(i) && p !== pa[i])) reasons.push('text outside the allowed paragraphs changed');
  }
  if (reasons.length > 0) return reject();

  const restored = unmaskRewrite(rewritten, input.mask);
  if (/\{\{(?:cite|quote)_\d+_\d+\}\}/.test(restored.replace(/\{\{(?:cite|quote)_\d+_\d+\}\}/g, (ph) => (input.original.includes(ph) ? '' : ph)))) {
    reasons.push('an unknown placeholder');
    return reject();
  }
  // D-18-40: the placeholders cover every citation the reader finds, but the
  // model could still write a NEW one (or rebuild one from its prose).
  if (!sameMultiset(extractCitedKeysForVerification(input.original), extractCitedKeysForVerification(restored))) {
    reasons.push('citation set changed');
    return reject();
  }
  const minWords = input.quoteMinWords;
  const qOpts = minWords !== undefined ? { minWords } : {};
  const quotesBefore = extractQuotes(input.original, qOpts).map((x) => `${x.text}\u0000${x.citekey ?? ''}`);
  const quotesAfter = extractQuotes(restored, qOpts).map((x) => `${x.text}\u0000${x.citekey ?? ''}`);
  if (!sameMultiset(quotesBefore, quotesAfter)) {
    reasons.push('a quoted passage changed');
    return reject();
  }
  const added = boundaryAdditions(input.original, restored, minWords);
  if (added !== null) {
    reasons.push(`adds ${added}, which no section verified`);
    return reject();
  }
  return { ok: true, text: restored, reasons: [] };
}
