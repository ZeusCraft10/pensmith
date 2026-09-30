// bin/lib/verify/draft-text.ts — a draft's prose paragraphs, its sentences and
// the (citing sentence, key) pairs they hold: the one splitter Pass 2, Pass 4
// and the cost estimator share (D-20-28, D-20-29; review round 2: the
// estimator counts the model calls the advisory passes will make from the
// same text).
//
// PURE: no I/O, no model — so the estimator can use it without reaching the
// model transport.

import { citationItems, findCitations, replaceCitations, type CitationCluster } from '../citation-token.js';

/** One prose paragraph of a draft: offsets into the draft and its text. */
export interface DraftParagraph {
  /** 1-based, among the prose paragraphs. */
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** One sentence of a draft: its paragraph, offsets, one-line text and the citations it carries. */
export interface DraftSentence {
  readonly paragraph: number;
  readonly start: number;
  readonly end: number;
  /** The sentence with its whitespace collapsed. */
  readonly text: string;
  /** Every citation (any Pandoc form) that starts inside the sentence. */
  readonly citations: readonly CitationCluster[];
}

const FENCE_RE = /^ {0,3}(?:`{3,}|~{3,})/;
/** Lines that are not prose: headings, rules, table rows, a setext underline, a comment line. */
const NON_PROSE_LINE_RE = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|(?:[-*_][ \t]*){3,}$|=+[ \t]*$|\||<!--.*-->[ \t]*$)/;

interface SourceLine {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function lines(md: string): SourceLine[] {
  const out: SourceLine[] = [];
  let start = 0;
  for (;;) {
    const nl = md.indexOf('\n', start);
    const rawEnd = nl === -1 ? md.length : nl;
    const end = rawEnd > start && md[rawEnd - 1] === '\r' ? rawEnd - 1 : rawEnd;
    out.push({ start, end, text: md.slice(start, end) });
    if (nl === -1) return out;
    start = nl + 1;
  }
}

/** The prose paragraphs of `md` (CRLF-safe), in order. */
export function proseParagraphs(md: string): DraftParagraph[] {
  const out: DraftParagraph[] = [];
  let first: SourceLine | null = null;
  let last: SourceLine | null = null;
  let fence: string | null = null;
  const flush = (): void => {
    if (first !== null && last !== null) {
      const text = md.slice(first.start, last.end);
      if (text.trim().length > 0) out.push({ index: out.length + 1, start: first.start, end: last.end, text });
    }
    first = null;
    last = null;
  };
  const all = lines(md);
  for (let i = 0; i < all.length; i += 1) {
    const line = all[i] as SourceLine;
    const f = FENCE_RE.exec(line.text);
    if (fence !== null) {
      if (f !== null && (f[0].trim()[0] as string) === fence) fence = null;
      continue;
    }
    if (f !== null) {
      flush();
      fence = f[0].trim()[0] as string;
      continue;
    }
    const next = all[i + 1];
    const setextTitle = next !== undefined && /^ {0,3}(?:=+|-+)[ \t]*$/.test(next.text) && line.text.trim() !== '';
    if (line.text.trim() === '' || NON_PROSE_LINE_RE.test(line.text) || setextTitle) {
      flush();
      if (setextTitle) i += 1;
      continue;
    }
    if (first === null) first = line;
    last = line;
  }
  flush();
  return out;
}

/** A sentence boundary: terminal punctuation (and closing quotes or brackets) followed by whitespace or the end. */
const BOUNDARY_RE = /[.!?]+["'”’»)\]]*(?=\s|$)/g;

export function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** `text` without its citations (every Pandoc form), whitespace collapsed. */
export function prose(text: string): string {
  return oneLine(replaceCitations(text, () => ' '));
}

/**
 * The sentences of `md`: each prose paragraph split at every boundary that is
 * not inside a citation (`[see @a, p. 5. Also @b]` stays whole); a piece that
 * is nothing but citations and punctuation (`… shown. [@k]`) joins the
 * sentence before it.
 */
export function draftSentences(md: string): DraftSentence[] {
  const citations = findCitations(md);
  const out: DraftSentence[] = [];
  for (const p of proseParagraphs(md)) {
    const inside = citations.filter((c) => c.start >= p.start && c.start < p.end);
    const cuts: number[] = [];
    for (const m of p.text.matchAll(BOUNDARY_RE)) {
      const at = p.start + m.index;
      if (inside.some((c) => at >= c.start && at < c.end)) continue;
      cuts.push(p.start + m.index + m[0].length);
    }
    const pieces: Array<{ start: number; end: number }> = [];
    let from = p.start;
    for (const cut of [...cuts, p.end]) {
      if (cut <= from) continue;
      const raw = md.slice(from, cut);
      const lead = raw.length - raw.trimStart().length;
      if (raw.trim().length > 0) pieces.push({ start: from + lead, end: cut });
      from = cut;
    }
    const merged: Array<{ start: number; end: number }> = [];
    for (const piece of pieces) {
      const onlyCitations = prose(md.slice(piece.start, piece.end)).replace(/[\p{P}\s]/gu, '') === '';
      const prev = merged[merged.length - 1];
      if (onlyCitations && prev !== undefined) prev.end = piece.end;
      else merged.push({ ...piece });
    }
    for (const s of merged) {
      const text = md.slice(s.start, s.end);
      out.push({
        paragraph: p.index,
        start: s.start,
        end: s.end,
        text: oneLine(text),
        citations: inside.filter((c) => c.start >= s.start && c.start < s.end),
      });
    }
  }
  return out;
}


/** One (citing sentence, citekey) pair: what Pass 2 judges with one model call. */
export interface ClaimPair {
  readonly citekey: string;
  readonly claimSentence: string;
}

/**
 * Every (citing sentence, citekey) pair of `draftMd`, in document order, each
 * once: a sentence citing A and B yields two pairs; the same sentence citing A
 * twice, or repeated word for word, yields one.
 */
export function claimPairs(draftMd: string): ClaimPair[] {
  const seen = new Set<string>();
  const out: ClaimPair[] = [];
  for (const s of draftSentences(draftMd)) {
    for (const c of s.citations) {
      for (const item of citationItems(c)) {
        const id = `${item.key}\u0000${s.text}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ citekey: item.key, claimSentence: s.text });
      }
    }
  }
  return out;
}
