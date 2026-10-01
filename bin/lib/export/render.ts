// bin/lib/export/render.ts — the gated text's citations, rendered and placed
// (EXP-02, EXP-04, D-21-03, D-21-04, D-21-12).
//
// prepareText reads every citation of the gated text with the one citation
// grammar (citation-token.ts findRenderedCitations / citationItems — the
// grammar every gate uses, VRFY-09), renders them all through ONE citeproc
// pass (citations.ts renderDocumentCitations) and places each result where
// pandoc's citeproc places it:
//   - an in-text citation replaces its source text (`[@k]` → `(Kuhn, 1962)`);
//     one whose rendering opens with a superscript (AMA) drops the white space
//     before it (`claim^1^.`);
//   - a note style's citation becomes a footnote: the white space before it
//     goes, and the run of punctuation right after it — every Unicode
//     punctuation character but the en and em dash, as pandoc's mvPunct takes
//     it (`...`, `?!`, `).`) — moves before the marker (`claim [@k]...` →
//     `claim...[^1]`), unless a narrative citation's author already ends with
//     punctuation; with a locale that puts punctuation inside quotes (en-US),
//     a period or comma that lands after a closing straight quotation mark
//     goes inside it (`"…here" [@k].` → `"…here."[^1]`), and a period there
//     after `?` or `!` is dropped (review round 1); a narrative citation keeps
//     its author in the text and the rest of its citation in the note
//     (`Lindqvist and Berg[^7] argue`);
//   - an in-text citation whose rendering ends with a period swallows the
//     sentence's period right after it (IEEE `[@k, 33ff.].` → `[1, p. 33ff].`,
//     as pandoc prints it);
//   - a locator is read with the terms of the style's own locale
//     (citations.ts styleLocaleFacts: under en-GB `chap.` is not a term);
//   - a narrative citation followed by a bracketed locator (`@k [p. 5]`)
//     takes it as its locator, as pandoc reads it.
// A citation in code stays as written; a key the bibliography lacks stays a
// visible `[@key]` (WR-01, never a silent surname).
//
// The result is a list of edits over the gated text plus the notes and the
// bibliography. Every writer serialises the same edits (md-writer.ts as
// Markdown text; document.ts for the docx, PDF and LaTeX writers), so nothing
// a writer adds can carry a citation the gate did not read (D-21-12): the
// rendered keys are a subset of the gated keys and the bibliography holds
// exactly the rendered keys — exporter.ts asserts both before writing.

import {
  citationItems,
  findRenderedCitations,
  splitLocator,
  type CitationCluster,
  type CitationItem,
} from '../citation-token.js';
import { smartText } from './markdown.js';
import {
  renderDocumentCitations,
  styleLocaleFacts,
  type CitationItemInput,
  type DocumentCitation,
  type RenderedBibEntry,
  type RichRun,
} from '../citations.js';

/** One part of the text that replaces a citation. */
export type PlacedPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'runs'; readonly runs: readonly RichRun[] }
  | { readonly kind: 'note'; readonly n: number };

/** One citation's edit of the gated text: the span it replaces and what stands there. */
export interface PlacedCitation {
  /** Start of the replaced span (white space removed before a note or a superscript included). */
  readonly start: number;
  /** End of the replaced span (a punctuation mark moved before a note included). */
  readonly end: number;
  readonly parts: readonly PlacedPart[];
  /** The keys this citation rendered (the bibliography's keys). */
  readonly keys: readonly string[];
}

/** The gated text with its citations rendered and placed. */
export interface PreparedText {
  /** The gated text, exactly as given. */
  readonly text: string;
  /** The edits, in order, non-overlapping. */
  readonly placed: readonly PlacedCitation[];
  /** Note n is `notes[n - 1]`. */
  readonly notes: ReadonlyArray<readonly RichRun[]>;
  /** The bibliography of exactly the rendered keys, in the style's order (empty when nothing is rendered). */
  readonly bibliography: readonly RenderedBibEntry[];
  /** The heading over the bibliography: `References`, or `Bibliography` for a note style (D-21-04). */
  readonly referencesTitle: string;
  readonly hangingIndent: boolean;
  readonly noteStyle: boolean;
  /** Every key a rendered citation names, in first-citation order. */
  readonly renderedKeys: readonly string[];
  /** Cited keys the bibliography lacks (left as written). */
  readonly unresolved: readonly string[];
  /** The style's default locale when it is not available (rendered in en-US), else null. */
  readonly localeFallback: string | null;
  /** Keys of citations the style prints nothing for (removed, as pandoc removes them: "no printed form"). */
  readonly unprinted: readonly string[];
}

/**
 * A narrative citation followed by a bracketed locator Pandoc reads as its
 * locator (`@k [p. 5]` → "Smith (2020, p. 5)"): the bracket's text.
 */
const BARE_LOCATOR_RE = /^[ \t]*\[([^[\]@^][^[\]@]*)\](?![({:])/;

/**
 * One citeproc item for a citation item: prefix, key, locator and its label
 * (citation-token.ts splitLocator, D-21-04, with `terms` — the style's
 * locale's locator terms; the en-US table by default), suffix.
 */
export function toCslItem(item: CitationItem, terms?: ReadonlyArray<readonly [RegExp, string]>): CitationItemInput {
  // A prefix or suffix is Markdown text to pandoc: its smart typography
  // (`--` an en dash, `---` an em dash, `...` an ellipsis, curly quotes)
  // applies there as in the body (review round 1).
  const base: CitationItemInput = {
    id: item.key,
    ...(item.prefix ? { prefix: `${smartText(item.prefix)} ` } : {}),
    ...(item.suppressAuthor ? { suppressAuthor: true } : {}),
  };
  if (item.suffix.replace(/^\s*,?\s*/, '') === '') return base;
  const loc = terms !== undefined ? splitLocator(item.suffix, terms) : splitLocator(item.suffix);
  if (loc !== null) return { ...base, locator: loc.locator, label: loc.label, ...(loc.rest.trim() ? { suffix: smartText(loc.rest) } : {}) };
  return { ...base, suffix: smartText(item.suffix.startsWith(' ') || item.suffix.startsWith(',') ? item.suffix : ` ${item.suffix}`) };
}

/** True when `runs` open with a superscript (a superscript style's citation, AMA). */
function opensWithSuperscript(runs: readonly RichRun[]): boolean {
  return runs[0]?.sup === true;
}

/**
 * The punctuation a note marker moves past (pandoc's mvPunct takes every
 * punctuation character — brackets, quotes, `…`, `%`, `/` included — but not
 * the en or em dash; checked against pandoc 3.9).
 */
const NOTE_PUNCT_RUN = /^[^\P{P}\u2013\u2014]+/u;

/**
 * The closing straight quotation mark right before `at` (pandoc's smart
 * reader reads `"…"` and `'…'` as quoted text when an opening mark precedes
 * it in the paragraph), as its offset and character, or null.
 */
function closingQuoteBefore(text: string, at: number, floor: number): { index: number; char: string } | null {
  const q = text[at - 1];
  if (q !== '"' && q !== "'") return null;
  if (at - 2 < floor || /\s/u.test(text[at - 2] ?? ' ')) return null;
  const para = Math.max(floor, text.lastIndexOf('\n\n', at - 1) + 1);
  // An opening mark: after white space, an opening bracket or the paragraph's start, before a non-space.
  const open = new RegExp(`(?:^|[\\s(\\[{])${q === '"' ? '"' : "'"}(?=\\S)`, 'u');
  return open.test(text.slice(para, at - 1)) ? { index: at - 1, char: q } : null;
}

/** The plain text of runs (for the punctuation rule). */
function plain(runs: readonly RichRun[]): string {
  return runs.map((r) => r.text).join('');
}

/** The start of the horizontal white space right before `at` in `text` (`at` when there is none). */
function spaceStart(text: string, at: number, floor: number): number {
  let i = at;
  while (i > floor && (text[i - 1] === ' ' || text[i - 1] === '\t')) i--;
  return i;
}

/**
 * Render and place every citation of `text` (the module header has the
 * rules). `entries` are the parsed bibliography entries (the export bib's);
 * `style` a bundled key or a `.csl` path; null renders nothing (the text is
 * exported as written).
 */
export async function prepareText(
  text: string,
  entries: ReadonlyArray<Record<string, unknown>>,
  style: string | null,
): Promise<PreparedText> {
  const empty = (unresolved: string[] = []): PreparedText => ({
    text, placed: [], notes: [], bibliography: [], referencesTitle: 'References', hangingIndent: false, noteStyle: false, renderedKeys: [], unresolved, localeFallback: null, unprinted: [],
  });
  const known = new Set(entries.map((e) => String(e['id'] ?? '')));
  // The citations in order, each with its items and the span it covers.
  const found: Array<{ c: CitationCluster; end: number; items: CitationItem[] }> = [];
  let at = 0;
  for (const c of findRenderedCitations(text)) {
    if (c.start < at) continue;
    let end = c.end;
    let items = citationItems(c);
    if (c.narrative === true && items[0] !== undefined) {
      const loc = BARE_LOCATOR_RE.exec(text.slice(c.end));
      if (loc !== null) {
        items = [{ ...items[0], suffix: `, ${(loc[1] as string).trim()}` }];
        end = c.end + loc[0].length;
      }
    }
    found.push({ c, end, items });
    at = end;
  }
  const unresolved = [...new Set(found.flatMap((f) => f.items.filter((i) => !known.has(i.key)).map((i) => i.key)))];
  if (style === null) return empty(unresolved);
  const rendered = found.filter((f) => f.items.some((i) => known.has(i.key)));
  if (rendered.length === 0) return empty(unresolved);
  const terms = styleLocaleFacts(style).locatorTerms;
  const docCitations: DocumentCitation[] = rendered.map((f) => ({
    items: f.items.filter((i) => known.has(i.key)).map((i) => toCslItem(i, terms)),
    ...(f.c.narrative === true && f.items[0]?.suppressAuthor !== true ? { narrative: true } : {}),
  }));
  const doc = await renderDocumentCitations(entries, style, docCitations);

  const placed: PlacedCitation[] = [];
  const notes: Array<readonly RichRun[]> = [];
  let floor = 0;
  rendered.forEach((f, idx) => {
    const r = doc.citations[idx] as (typeof doc.citations)[number];
    const keys = f.items.filter((i) => known.has(i.key)).map((i) => i.key);
    // WR-01: an unknown key in a cluster with known ones follows it as `[@key]`.
    const unknownTail = f.items.filter((i) => !known.has(i.key)).map((i) => `[@${i.key}]`).join(' ');
    let start = f.c.start;
    let end = f.end;
    const parts: PlacedPart[] = [];
    if (r.note !== null) {
      const n = notes.length + 1;
      notes.push(r.note);
      if (r.inline.length > 0) {
        parts.push({ kind: 'runs', runs: r.inline });
      } else {
        start = spaceStart(text, start, floor);
      }
      // The punctuation run after the citation moves before the note marker
      // (see the header), unless a narrative author already ends with
      // punctuation (pandoc's mvPunct).
      const run = unknownTail === '' ? (NOTE_PUNCT_RUN.exec(text.slice(end))?.[0] ?? '') : '';
      const narrativeEnds = r.inline.length > 0 && /\p{P}$/u.test(plain(r.inline));
      if (run !== '' && !narrativeEnds) {
        end += run.length;
        const quote = doc.punctuationInQuote && r.inline.length === 0 && /^[.,]/u.test(run) ? closingQuoteBefore(text, start, floor) : null;
        if (quote !== null) {
          // `"…here" [@k].` → `"…here."[^1]` (en-US); `"…here?" [@k].` → `"…here?"[^1]`.
          start = quote.index;
          const mark = run[0] as string;
          const inner = mark === '.' && /[.?!]/u.test(text[quote.index - 1] ?? '') ? '' : mark;
          parts.push({ kind: 'text', text: `${inner}${quote.char}${run.slice(1)}` });
        } else {
          parts.push({ kind: 'text', text: run });
        }
      }
      parts.push({ kind: 'note', n });
    } else if (r.inline.length > 0) {
      if (opensWithSuperscript(r.inline)) start = spaceStart(text, start, floor);
      parts.push({ kind: 'runs', runs: r.inline });
      // A rendering that ends with a period in plain text (not a superscript)
      // swallows the sentence's own (pandoc).
      const last = r.inline[r.inline.length - 1];
      if (unknownTail === '' && last !== undefined && last.sup !== true && /\.$/u.test(last.text) && text[end] === '.' && text[end + 1] !== '.') end += 1;
    }
    if (unknownTail !== '') parts.push({ kind: 'text', text: parts.length > 0 ? ` ${unknownTail}` : unknownTail });
    placed.push({ start, end, parts, keys });
    floor = end;
  });
  const renderedKeys = [...new Set(placed.flatMap((p) => p.keys))];
  return {
    text,
    placed,
    notes,
    bibliography: doc.bibliography,
    referencesTitle: doc.noteStyle ? 'Bibliography' : 'References',
    hangingIndent: doc.hangingIndent,
    noteStyle: doc.noteStyle,
    renderedKeys,
    unresolved,
    localeFallback: doc.localeFallback,
    unprinted: [...new Set(placed.filter((p) => p.parts.every((x) => x.kind === 'text')).flatMap((p) => p.keys))],
  };
}
