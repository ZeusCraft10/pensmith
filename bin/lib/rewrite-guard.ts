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
//        - the reply echoes no untrusted-data fence marker and adds no
//          "pensmith" (a model that repeats its fenced input would put a
//          pensmith artifact into FINAL.md and every export — zero trace);
//        - every ATX heading line is byte-identical, in order (`a heading changed`);
//        - the paragraph count is kept and each paragraph holds exactly the
//          placeholders it held (no citation or quote crosses a paragraph — for
//          the smoother, the SECTION boundary, PRD §7.6; for the humanizer, a
//          preamble or closing chatter paragraph is a structure change);
//        - nothing outside the allowed paragraphs changed (the smoother may touch
//          only the two boundary paragraphs; the humanizer any body paragraph);
//        - restored, it cites exactly the keys the original did (the broad
//          grammar, D-18-40) and holds the same direct quotes (quote-extractor.ts,
//          the Pass-3 reader) — masking is the first line, this the second;
//        - every citation stays on its claim (citationAnchorProblem): the
//          sentence that holds it in the rewrite is not better matched by
//          another sentence of the original than by the one that held it, and
//          citations that shared a sentence keep their order — a swap of two
//          citations between claims passes every multiset check but would
//          leave a citation on a claim Pass 2 never judged;
//        - boundaryAdditions finds nothing new the gate would check: no text
//          finding (an unparseable or unsupported citation form, TEXT_SCANNERS),
//          no direct quote, no bare identifier (VRFY-25).
//      A rejected rewrite keeps the original text; the reasons say why.
//
// The guard never calls a model and never writes a file. The gate core still
// runs over the final text (compile's DRAFT.md is gated by done; done gates the
// humanized text before it becomes FINAL.md — humanizer.ts acceptHumanized).

import { extractCitedKeysForVerification, findCitations, replaceCitations } from './citation-token.js';
import { TEXT_SCANNERS } from './verify/gate.js';
import { extractQuotes } from './quote-extractor.js';
import { findBareIdentifiers } from './doi.js';
import { DEFAULT_QUOTE_MIN_WORDS } from './schemas/config.js';
import { networkMode } from './http-mock.js';
import { resolveRuntime } from './runtime.js';
import { fenceMarkerCount } from './untrusted-fence.js';
import { contentTerms } from './claim-consistency.js';

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

/** The non-blank paragraphs of `text` (blocks between blank lines), CRLF folded. */
function paragraphBlocks(text: string): string[] {
  const t = text.replace(/\r\n/g, '\n').trim();
  return paragraphRanges(t)
    .map(([s, e]) => t.slice(s, e))
    .filter((p) => p.trim().length > 0);
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

/**
 * A pensmith artifact the rewrite adds: an untrusted-data fence marker (a
 * model that echoed its fenced input) or the word "pensmith" — either would
 * reach FINAL.md and every export (zero trace). Null when it adds neither.
 */
function addedArtifact(original: string, rewritten: string): string | null {
  if (fenceMarkerCount(rewritten) > fenceMarkerCount(original)) return 'the reply echoes the untrusted-data fence (a model artifact)';
  const named = (t: string): number => t.match(/pensmith/gi)?.length ?? 0;
  if (named(rewritten) > named(original)) return 'the reply adds the word "pensmith" (a model artifact)';
  return null;
}

/** Sentence breaks: a blank line, or sentence-final punctuation (closing quotes and brackets included) and whitespace. */
const SENTENCE_BREAK_RE = /\n[ \t]*\n|(?<=[.!?\u2026]["'\u201d\u2019)\]]*)\s+/u;

/** A citation slot written into the text while it is split into sentences (no sentence punctuation, never in prose). */
const SLOT_RE = /\uE000(\d+)\uE001/g;

interface AnchorSentence {
  /** The sentence's content terms (claim-consistency.ts contentTerms: stemmed, stop words out). */
  readonly terms: ReadonlySet<string>;
  /** The citations (as written) the sentence holds. */
  readonly cites: ReadonlySet<string>;
  readonly text: string;
}

interface AnchorView {
  readonly sentences: readonly AnchorSentence[];
  /** Each citation occurrence in text order: as written, its sentence, and its ordinal among occurrences of the same text. */
  readonly occ: ReadonlyArray<{ readonly cite: string; readonly sentence: number; readonly ordinal: number }>;
}

/** The sentences of `text` and the sentence each citation occurrence sits in. */
function anchorView(text: string): AnchorView {
  const found: Array<{ cite: string; sentence: number; ordinal: number }> = [];
  const seen = new Map<string, number>();
  const slotted = replaceCitations(text.replace(/\r\n/g, '\n'), (c) => {
    const ordinal = seen.get(c.text) ?? 0;
    seen.set(c.text, ordinal + 1);
    found.push({ cite: c.text, sentence: -1, ordinal });
    return `\uE000${found.length - 1}\uE001`;
  });
  const sentences = slotted.split(SENTENCE_BREAK_RE).map((piece, si) => {
    const cites = new Set<string>();
    for (const m of piece.matchAll(SLOT_RE)) {
      const o = found[Number(m[1])];
      if (o === undefined) continue;
      o.sentence = si;
      cites.add(o.cite);
    }
    const plain = piece.replace(SLOT_RE, ' ').replace(/\s+/g, ' ').trim();
    return { terms: new Set(contentTerms(plain)), cites, text: plain };
  });
  return { sentences, occ: found };
}

/** The share of `of`'s terms that `n` holds (0 when `of` has none). */
function coverage(of: ReadonlySet<string>, n: ReadonlySet<string>): number {
  if (of.size === 0) return 0;
  let shared = 0;
  for (const t of of) if (n.has(t)) shared += 1;
  return shared / of.size;
}

/** At least half of the claim's terms survive: the claim is still there, whatever was merged into its sentence. */
const CLAIM_KEPT = 0.5;

/**
 * Why a rewrite moved a citation onto another claim, or null (see the
 * header). For each citation of the rewrite, the original sentences that held
 * it are its claim: the claim counts as kept when at least half of its content
 * terms are in the citation's new sentence, or when no other original sentence
 * covers the new sentence better (a sentence reworded beyond recognition, or
 * merged with uncited context, is not a move). Citations that came from one
 * original sentence and still share a sentence keep their order (a swap
 * inside a sentence). Pure, never throws.
 */
export function citationAnchorProblem(original: string, rewritten: string): string | null {
  const a = anchorView(original);
  const b = anchorView(rewritten);
  const quoteOf = (t: string): string => (t.length > 60 ? `${t.slice(0, 57)}…` : t);
  for (const o of b.occ) {
    const n = b.sentences[o.sentence];
    if (n === undefined || n.terms.size === 0) continue;
    let own = -1;
    let other = 0;
    for (const s of a.sentences) {
      if (s.terms.size === 0) continue;
      const c = coverage(s.terms, n.terms);
      if (s.cites.has(o.cite)) own = Math.max(own, c);
      else other = Math.max(other, c);
    }
    if (own === -1 || own >= CLAIM_KEPT) continue;
    if (other > own) return `a citation moved to another claim (${o.cite} now sits on "${quoteOf(n.text)}")`;
  }
  // Order inside a sentence: the k-th occurrence of a citation in the rewrite
  // is the k-th in the original.
  const origIndex = new Map<string, number>();
  a.occ.forEach((o, i) => origIndex.set(`${o.cite}\u0000${o.ordinal}`, i));
  const bySentence = new Map<number, number[]>();
  for (const o of b.occ) {
    const i = origIndex.get(`${o.cite}\u0000${o.ordinal}`);
    if (i === undefined) continue;
    const list = bySentence.get(o.sentence) ?? [];
    list.push(i);
    bySentence.set(o.sentence, list);
  }
  for (const [si, list] of bySentence) {
    for (let x = 0; x < list.length; x += 1) {
      for (let y = x + 1; y < list.length; y += 1) {
        const ox = a.occ[list[x] as number];
        const oy = a.occ[list[y] as number];
        if (ox === undefined || oy === undefined || ox.sentence !== oy.sentence) continue;
        if ((list[x] as number) > (list[y] as number)) {
          return `a citation moved to another claim (${ox.cite} and ${oy.cite} swapped places in "${quoteOf(b.sentences[si]?.text ?? '')}")`;
        }
      }
    }
  }
  return null;
}

/**
 * The rewrite guard's checks on two UNMASKED texts (a Tier-1 humanized
 * FINAL.md, or a masked rewrite after restoration): the reasons `rewritten`
 * may not replace `original`, in order — empty when it may:
 *   - `a heading changed` (every ATX heading line, in order);
 *   - `citation set changed` (every citation as written — key, locator,
 *     prefix — and every cited key, multisets: D-18-40);
 *   - `a quoted passage changed` (every direct quote Pass 3 reads, with its
 *     attribution);
 *   - a fence marker or "pensmith" the original did not hold (addedArtifact);
 *   - `paragraph structure changed` (the non-blank paragraph count) and
 *     `a citation moved to another paragraph`;
 *   - `a citation moved to another claim` (citationAnchorProblem);
 *   - `adds …, which no section verified` (boundaryAdditions: a text finding,
 *     a new quote or a bare identifier).
 * Pure, never throws.
 */
export function compareRewrite(original: string, rewritten: string, opts: { readonly quoteMinWords?: number } = {}): string[] {
  const reasons: string[] = [];
  const hb = headingLines(original);
  const ha = headingLines(rewritten);
  if (hb.length !== ha.length || hb.some((h, i) => h !== ha[i])) reasons.push('a heading changed');
  const citesOf = (t: string): string[] => findCitations(t).map((c) => c.text);
  if (!sameMultiset(citesOf(original), citesOf(rewritten)) || !sameMultiset(extractCitedKeysForVerification(original), extractCitedKeysForVerification(rewritten))) {
    reasons.push('citation set changed');
  }
  const qOpts = opts.quoteMinWords !== undefined ? { minWords: opts.quoteMinWords } : {};
  const quotesOf = (t: string): string[] => extractQuotes(t, qOpts).map((x) => `${x.text}\u0000${x.citekey ?? ''}`);
  if (!sameMultiset(quotesOf(original), quotesOf(rewritten))) reasons.push('a quoted passage changed');
  const marker = addedArtifact(original, rewritten);
  if (marker !== null) reasons.push(marker);
  const pb = paragraphBlocks(original);
  const pa = paragraphBlocks(rewritten);
  if (pb.length !== pa.length) reasons.push(`paragraph structure changed (${pb.length} paragraph(s) became ${pa.length})`);
  else if (!reasons.includes('citation set changed') && pb.some((p, i) => !sameMultiset(citesOf(p), citesOf(pa[i] as string)))) {
    reasons.push('a citation moved to another paragraph');
  }
  if (reasons.length === 0) {
    const moved = citationAnchorProblem(original, rewritten);
    if (moved !== null) reasons.push(moved);
  }
  if (reasons.length === 0) {
    const added = boundaryAdditions(original, rewritten, opts.quoteMinWords);
    if (added !== null) reasons.push(`adds ${added}, which no section verified`);
  }
  return reasons;
}

export interface ValidateRewriteInput {
  /** The original text, unmasked (what maskForRewrite was given). */
  readonly original: string;
  /** The mask the model's input was built with. */
  readonly mask: RewriteMask;
  /** The model's reply: the rewritten masked text. */
  readonly rewritten: string;
  /**
   * The paragraphs (0-based, non-blank blocks between blank lines of the
   * masked text) the rewrite may change. Given: every other paragraph stays
   * byte-identical (the smoother: the two boundary paragraphs). Omitted: any
   * paragraph may change (the humanizer). Either way the paragraph count is
   * kept and each paragraph keeps exactly its own placeholders.
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
  const citeCountsOk = sameCounts(placeholderCounts(maskedBefore, 'cite'), placeholderCounts(rewritten, 'cite'));
  const quoteCountsOk = sameCounts(placeholderCounts(maskedBefore, 'quote'), placeholderCounts(rewritten, 'quote'));
  if (!citeCountsOk) reasons.push('citation set changed');
  if (!quoteCountsOk) reasons.push('a quoted passage changed');
  const marker = addedArtifact(maskedBefore, rewritten);
  if (marker !== null) reasons.push(marker);
  const before = headingLines(maskedBefore);
  const after = headingLines(rewritten);
  if (before.length !== after.length || before.some((h, i) => h !== after[i])) reasons.push('a heading changed');
  const pb = paragraphBlocks(maskedBefore);
  const pa = paragraphBlocks(rewritten);
  if (pb.length !== pa.length) reasons.push(`paragraph structure changed (${pb.length} paragraph(s) became ${pa.length})`);
  else {
    // Each paragraph keeps exactly its own placeholders: for the smoother the
    // two paragraphs are two SECTIONS (PRD §7.6), so a citation — and the
    // claim it supports — never crosses the boundary.
    if (citeCountsOk && pb.some((p, i) => !sameCounts(placeholderCounts(p, 'cite'), placeholderCounts(pa[i] as string, 'cite')))) {
      reasons.push(input.allowedParagraphs !== undefined ? 'a citation crossed the boundary between the paragraphs' : 'a citation moved to another paragraph');
    }
    if (quoteCountsOk && pb.some((p, i) => !sameCounts(placeholderCounts(p, 'quote'), placeholderCounts(pa[i] as string, 'quote')))) {
      reasons.push(input.allowedParagraphs !== undefined ? 'a quoted passage crossed the boundary between the paragraphs' : 'a quoted passage moved to another paragraph');
    }
    if (input.allowedParagraphs !== undefined) {
      const allowed = new Set(input.allowedParagraphs);
      if (pb.some((p, i) => !allowed.has(i) && p !== pa[i])) reasons.push('text outside the allowed paragraphs changed');
    }
  }
  if (reasons.length > 0) return reject();

  const restored = unmaskRewrite(rewritten, input.mask);
  if (/\{\{(?:cite|quote)_\d+_\d+\}\}/.test(restored.replace(/\{\{(?:cite|quote)_\d+_\d+\}\}/g, (ph) => (input.original.includes(ph) ? '' : ph)))) {
    reasons.push('an unknown placeholder');
    return reject();
  }
  const unmasked = compareRewrite(input.original, restored, input.quoteMinWords !== undefined ? { quoteMinWords: input.quoteMinWords } : {});
  if (unmasked.length > 0) {
    reasons.push(...unmasked);
    return reject();
  }
  return { ok: true, text: restored, reasons: [] };
}

/** A loopback model endpoint (127.0.0.0/8, ::1, localhost): reachable while sources are offline (S-15). */
function isLoopbackEndpoint(endpoint: string | null): boolean {
  if (endpoint === null) return false;
  let host: string;
  try {
    host = new URL(endpoint).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  return host === 'localhost' || host === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * Why a model step of compile or done (the smoother, the contradiction judge,
 * the humanizer) cannot run in this invocation's mode, as the skip reason the
 * report and the terminal name (S-15): `dry-run` (--dry-run: zero sockets),
 * `no LLM` (PENSMITH_NO_LLM=1 — a stub would rewrite nothing real), `offline`
 * (sources offline and the model endpoint is not loopback), or null when the
 * step can run. Never throws (an unusable runtime config is left to the model
 * call, which names it).
 */
export async function modelStepSkipReason(paperRoot: string): Promise<'dry-run' | 'no LLM' | 'offline' | null> {
  const mode = networkMode();
  if (mode.dryRun) return 'dry-run';
  if (mode.llmStubbed) return 'no LLM';
  if (!mode.sourcesOffline) return null;
  try {
    const rt = await resolveRuntime({ paperRoot });
    return isLoopbackEndpoint(rt.endpoint) ? null : 'offline';
  } catch {
    return 'offline';
  }
}
