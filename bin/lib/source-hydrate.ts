// bin/lib/source-hydrate.ts — the registry record for a source the user adds.
//
// `pensmith add` is given a DOI, an arXiv ID, a URL or a PDF, and must find
// the work's own record. A wrong record would be stored self-consistent (its
// title, authors and DOI all agree), so Pass 1 could never catch it. So:
//   - a DOI is accepted only when the registry answers with that same DOI;
//     arXiv's own DOIs (10.48550/arXiv.<id>) are read from arXiv;
//   - a PDF is identified by a DOI or arXiv ID printed in its opening (before
//     any reference list), and only when the work that identifier names has
//     its title printed word for word at the head of the PDF's title block
//     (the lines before the abstract), below nothing but page furniture and
//     labels, with its authors named in the lines next to it, as a paper
//     prints its own title and byline: a first page can also print cited
//     works' DOIs, titles and authors, and a notice (an erratum, a comment)
//     prints those of the work it is about;
//   - failing that, by a Crossref title search, whose hit is accepted only
//     when its whole title heads the PDF in the same way, word for word, and
//     one of its authors is named in the opening; of several such hits, the
//     one with most of its authors named.
// Jaro-Winkler on titles is not used: it scores "Climate change and mental
// health" 0.93 against "Climate change and human health".
// Only the title line leaves the machine for that search; the PDF's text stays
// local.

import { search as crossrefSearch, fetchById as crossrefFetchById } from './sources/crossref.js';
import { fetchById as arxivFetchById } from './sources/arxiv.js';
import { arxivFromDoi, arxivIdsIn, bareArxivId, doisIn, normalizeDoi, sameDoi } from './doi.js';
import { normalizeForFuzzy } from './fuzzy.js';
import { firstString, wholeTitle } from './sources/work-record.js';
import { sameWholeTitle } from './verify/work-match.js';
import type { SourceCandidate } from './schemas/source-candidate.js';

export type Hydration =
  | { kind: 'found'; candidate: SourceCandidate; via: string }
  /** The registry answered the DOI with a different work's record. */
  | { kind: 'mismatch'; requested: string; returned: string }
  | { kind: 'none'; reason: string };

/** The record for `doi`, accepted only when it is that DOI's. */
export async function hydrateDoi(doi: string): Promise<Hydration> {
  const norm = normalizeDoi(doi);
  if (!norm) return { kind: 'none', reason: `${doi} is not a valid DOI` };
  const arxiv = arxivFromDoi(norm);
  if (arxiv) {
    const r = await hydrateArxiv(arxiv);
    // The record is arXiv's; the DOI asked for names the same preprint.
    return r.kind === 'found' ? { ...r, candidate: { ...r.candidate, doi: norm } } : r;
  }
  const hit = await crossrefFetchById(norm);
  if (!hit) return { kind: 'none', reason: `Crossref has no record of DOI ${norm}` };
  if (!sameDoi(hit.doi, norm)) return { kind: 'mismatch', requested: norm, returned: hit.doi ?? '(no DOI)' };
  return { kind: 'found', candidate: hit, via: 'Crossref' };
}

/** The arXiv record for `id` (with or without `arXiv:` and a version). */
export async function hydrateArxiv(id: string): Promise<Hydration> {
  const bare = bareArxivId(id);
  if (!bare) return { kind: 'none', reason: `${id} is not an arXiv ID` };
  const hit = await arxivFetchById(bare);
  return hit ? { kind: 'found', candidate: hit, via: 'arXiv' } : { kind: 'none', reason: `arXiv has no record of ${bare}` };
}

/** How much of a PDF's text counts as its opening, where its own identifiers are printed. */
const OPENING_CHARS = 6000;
/** Identifiers tried per kind; a first page rarely prints more of its own. */
const MAX_TRIED = 3;
/** The lines at the top of a PDF that can hold its title. */
const TITLE_BLOCK_LINES = 30;
/** The lines a title can wrap onto. */
const TITLE_MAX_LINES = 4;
/** The lines after a title that can hold its byline, the authors' names. */
const BYLINE_LINES = 3;

// The heading of a reference list ("References", "7 References", "VI.
// BIBLIOGRAPHY", "References and Notes", "Références"). What follows it names
// other works, their titles and authors.
const REFERENCES_HEADING = new RegExp(
  '^(?:[\\divxlc]+\\.?\\s+)?(?:' +
    [
      'references(?: and notes)?', 'notes(?: and references)?', 'endnotes', 'bibliography', 'works cited', 'literature cited',
      'reference list', 'cited literature', 'literatur(?:e|verzeichnis)?', 'r[eé]f[eé]rences(?: bibliographiques)?',
      'referencias(?: bibliogr[aá]ficas)?', 'referenzen', 'bibliograf[ií]a', 'bibliographie',
    ].join('|') +
    ')\\s*:?$',
  'i',
);
// The line that opens the abstract; the title and authors come before it.
// Some journals label it "Summary", and some space its letters out.
const ABSTRACT_START = /^(?:abstract|a b s t r a c t|summary)\b/i;

/** Lowercased words of `s`, accents removed, joined by single spaces. */
function words(s: string): string {
  return normalizeForFuzzy(s).replace(/<[^>]+>/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * The non-empty lines of a PDF's opening, up to its reference list: the part
 * where the paper speaks of itself. A first page can print a reference list
 * (a short paper, a letter), and its titles and authors are other works'.
 */
function openingLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.slice(0, OPENING_CHARS).split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (REFERENCES_HEADING.test(line.normalize('NFC'))) break;
    out.push(line);
  }
  return out;
}

/**
 * The opening lines that can hold the title: those before the abstract, at
 * most TITLE_BLOCK_LINES. A first line that starts with "Abstract" is a title
 * ("Abstract Meaning Representation for Sembanking"), not the abstract.
 */
function titleBlock(opening: readonly string[]): string[] {
  const abstractAt = opening.findIndex((l, i) => i > 0 && ABSTRACT_START.test(l));
  return opening.slice(0, Math.min(abstractAt < 0 ? opening.length : abstractAt, TITLE_BLOCK_LINES));
}

/**
 * Where `title` is printed as whole lines of the title block, as [first,
 * last] line indexes: one line, or up to TITLE_MAX_LINES consecutive lines it
 * wraps onto. Whole lines, so a title quoted inside another ("Comment on
 * ...") is not this paper's.
 */
function titleSpans(title: string, block: readonly string[]): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (let i = 0; i < block.length; i++) {
    let span = '';
    for (let k = i; k < Math.min(block.length, i + TITLE_MAX_LINES); k++) {
      span = span ? `${span} ${block[k]}` : block[k]!;
      if (sameWholeTitle(span, title)) spans.push([i, k]);
    }
  }
  return spans;
}

/**
 * Whether `c` is the work whose title and byline head the PDF: its whole
 * title is printed as whole lines of the title block with only page
 * furniture and labels above it, and one of its authors is named in the
 * BYLINE_LINES opening lines after it, or in those right above it. A cited
 * work's title set in the body, even with its authors under it, comes after
 * the PDF's own title, byline or text. A work with no personal author has no
 * byline, so its title must be the block's first title line.
 */
function titleHeadsPdf(c: SourceCandidate, block: readonly string[], opening: readonly string[]): boolean {
  const hasAuthors = (c.names ?? []).some((n) => n.family);
  return titleSpans(wholeTitleOf(c), block).some(([first, last]) => {
    if (!hasAuthors) return first === titleLineIndex(block) && !block.slice(0, first).some((line) => NOTICE.test(line));
    if (authorsNamedIn(c, opening.slice(last + 1, last + 1 + BYLINE_LINES).join('\n')) > 0) return onlyFurnitureAbove(block, first);
    return bylineAbove(c, block, first);
  });
}

/** Whether every line of the block above line `first` is page furniture or a label. */
function onlyFurnitureAbove(block: readonly string[], first: number): boolean {
  return block.slice(0, first).every(furnitureOrLabel);
}

/**
 * Whether `c`'s byline is printed in the BYLINE_LINES lines right above line
 * `first`, each of them naming one of its authors or a label (a wrapped
 * byline, an affiliation number), with only furniture and labels above it.
 */
function bylineAbove(c: SourceCandidate, block: readonly string[], first: number): boolean {
  const from = Math.max(0, first - BYLINE_LINES);
  const byline = block.slice(from, first);
  return (
    authorsNamedIn(c, byline.join('\n')) > 0 &&
    byline.every((line) => furnitureOrLabel(line) || authorsNamedIn(c, line) > 0) &&
    onlyFurnitureAbove(block, from)
  );
}

// The opening of a notice about another work: a correction, a comment, a
// reply or a retraction prints that work's title, authors and DOI.
const NOTICE = /^\W*(?:errat(?:um|a)|corrigend(?:um|a)|correction|addendum|comments? on|commentary on|reply to|response to|retraction|retracted|expression of concern)\b/i;
/** The most words a label above a title has ("SCIENTIFIC PROGRAMMING", "Research Article", "Open Access"). */
const LABEL_MAX_WORDS = 4;

/** Whether `line` can be printed above a paper's own title: page furniture, or a short or all-capitals label. */
function furnitureOrLabel(line: string): boolean {
  if (NOTICE.test(line)) return false;
  if (line.length < 8 || line.length > 300 || NOT_A_TITLE.test(line)) return true;
  const letters = line.replace(/\P{L}/gu, '');
  return letters === letters.toUpperCase() || (line.match(/\p{L}+/gu)?.length ?? 0) <= LABEL_MAX_WORDS;
}

/** The candidate's whole title: Crossref keeps a subtitle in a field of its own. */
function wholeTitleOf(c: SourceCandidate): string {
  const s = firstString((c.raw as { subtitle?: unknown } | undefined)?.subtitle);
  return wholeTitle(s && !words(c.title).endsWith(words(s)) ? { title: c.title, subtitle: s } : { title: c.title });
}

// Lines on a first page that are not the title: links, licences, journal
// furniture ("Neural Networks 61 (2015) 85–117", "Contents lists available
// at ScienceDirect", "Published as a conference paper at ICLR 2019"),
// identifiers.
const NOT_A_TITLE =
  /https?:\/\/|www\.|©|\bcopyright\b|\blicen[cs]e|\bdoi\b|\barxiv\b|\bissn\b|\bpreprint\b|\bjournal of\b|\bproceedings\b|\bvol(?:ume)?\.?\s*\d|\bpp\.\s*\d|\d\s*\((?:1[89]|20)\d\d\)|\((?:1[89]|20)\d\d\)[\s,.:;]*\d|\breceived\b|\baccepted\b|\bsciencedirect\b|\bcontents lists available\b|\bpublished (?:as|in|online|by)\b|\bunder review\b|\bto appear in\b|^\W*\d+\W*$/i;

/** Where the PDF's likely title is: the first line of 8 to 300 characters in `lines` that is not page furniture, or -1. */
function titleLineIndex(lines: readonly string[]): number {
  return lines.findIndex((line) => line.length >= 8 && line.length <= 300 && !NOT_A_TITLE.test(line));
}

/** The PDF's likely title line, if any. */
function titleLine(lines: readonly string[]): string | undefined {
  const i = titleLineIndex(lines);
  return i < 0 ? undefined : lines[i];
}

/**
 * The words of `text` a family name is matched against: runs of letters, so
 * an affiliation mark after a name ("Walt1", "Walt¹", "Walt*") is not part of
 * it. A word before a comma, a symbol mark or the line's end is also read
 * without its last letter, which can be a letter mark set against the name
 * ("Walta,∗", "Varoquauxc").
 */
function nameWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split('\n').map(normalizeForFuzzy)) {
    for (const m of line.matchAll(/\p{L}+/gu)) {
      const w = m[0];
      out.add(w);
      const next = line[m.index + w.length];
      if (w.length > 3 && (next === undefined || /[,;*∗†‡§¶✉]/u.test(next))) out.add(w.slice(0, -1));
    }
  }
  return out;
}

/** Share of the candidate's authors whose family name is a word of `text`, 0..1. */
function authorsNamedIn(c: SourceCandidate, text: string): number {
  const inText = nameWords(text);
  const families = (c.names ?? []).map((n) => n.family ?? '').filter(Boolean);
  if (families.length === 0) return 0;
  const named = families.filter((f) => {
    const last = words(f).split(' ').pop() ?? '';
    return last.length >= 2 && inText.has(last);
  });
  return named.length / families.length;
}

/**
 * The work a PDF's `text` is: the work an identifier printed in its opening
 * names, when that work's title and byline head the PDF; else the Crossref hit for
 * its title line whose whole title is the PDF's and whose authors the opening
 * names, the one with most of them named.
 */
export async function hydrateFromText(text: string): Promise<Hydration> {
  const opening = openingLines(text);
  const block = titleBlock(opening);
  const openingText = opening.join('\n');
  const printed = [
    ...doisIn(openingText).slice(0, MAX_TRIED).map((doi) => ({ look: () => hydrateDoi(doi), shown: `DOI ${doi}`, via: `the DOI printed in the PDF (${doi})` })),
    ...arxivIdsIn(openingText).slice(0, MAX_TRIED).map((id) => ({ look: () => hydrateArxiv(id), shown: `arXiv:${id}`, via: `the arXiv ID printed in the PDF (${id})` })),
  ];
  const tried: string[] = [];
  for (const p of printed) {
    const r = await p.look();
    if (r.kind === 'found' && titleHeadsPdf(r.candidate, block, opening)) return { ...r, via: p.via };
    tried.push(p.shown);
  }
  const others = tried.length ? `, and ${tried.join(', ')} ${tried.length === 1 ? 'names another work' : 'name other works'}` : '';
  const title = titleLine(block);
  if (!title) return { kind: 'none', reason: `no title line could be read from the PDF${others}` };
  const hits = await crossrefSearch(title, { limit: 5 });
  let best: { hit: SourceCandidate; named: number } | undefined;
  for (const hit of hits) {
    const heads = titleSpans(wholeTitleOf(hit), block).some(([first]) => onlyFurnitureAbove(block, first) || bylineAbove(hit, block, first));
    if (!heads) continue;
    const named = authorsNamedIn(hit, openingText);
    if (named > 0 && (!best || named > best.named)) best = { hit, named };
  }
  if (best) return { kind: 'found', candidate: best.hit, via: `a Crossref title search for "${title}"` };
  return {
    kind: 'none',
    reason:
      `Crossref has no work titled "${title}" by an author the PDF names${others}` +
      ' — add it by its DOI or arXiv ID instead',
  };
}
