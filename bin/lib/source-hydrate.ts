// bin/lib/source-hydrate.ts — the registry record for a source the user adds.
//
// `pensmith add` is given a DOI, an arXiv ID, a URL or a PDF, and must find
// the work's own record. A wrong record would be stored self-consistent (its
// title, authors and DOI all agree), so Pass 1 could never catch it. So:
//   - a DOI is accepted only when the registry answers with that same DOI;
//     arXiv's own DOIs (10.48550/arXiv.<id>) are read from arXiv;
//   - a PDF is identified by a DOI or arXiv ID printed in its opening (before
//     any reference list), and only when the work that identifier names has
//     the PDF's title word for word in its title block (the lines before the
//     abstract): a first page can also print cited works' DOIs and titles;
//   - failing that, by a Crossref title search, whose hit is accepted only
//     when its whole title is the PDF's, word for word, and one of its
//     authors is named in the opening; of several such hits, the one with
//     most of its authors named.
// Jaro-Winkler on titles is not used: it scores "Climate change and mental
// health" 0.93 against "Climate change and human health".
// Only the title line leaves the machine for that search; the PDF's text stays
// local.

import { search as crossrefSearch, fetchById as crossrefFetchById } from './sources/crossref.js';
import { fetchById as arxivFetchById } from './sources/arxiv.js';
import { arxivFromDoi, bareArxivId, normalizeDoi, sameDoi } from './doi.js';
import { normalizeForFuzzy } from './fuzzy.js';
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

// The heading of a reference list ("References", "7 References", "VI.
// BIBLIOGRAPHY"). What follows it names other works, their titles and authors.
const REFERENCES_HEADING = /^(?:[\divxlc]+\.?\s+)?(?:references|bibliography|works cited|literature cited|reference list|cited literature)\s*:?$/i;
// The line that opens the abstract; the title and authors come before it.
const ABSTRACT_START = /^abstract\b/i;

/** Lowercased words of `s`, accents removed, joined by single spaces. */
function words(s: string): string {
  return normalizeForFuzzy(s).replace(/<[^>]+>/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * The non-empty lines of a PDF's opening, up to its reference list: the part
 * where the paper speaks of itself. A first page can print a reference list
 * (a short paper, a letter), and its titles and authors are other works'.
 */
export function openingLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.slice(0, OPENING_CHARS).split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (REFERENCES_HEADING.test(line)) break;
    out.push(line);
  }
  return out;
}

/**
 * The opening lines that can hold the title: those before the abstract, at
 * most TITLE_BLOCK_LINES. A first line that starts with "Abstract" is a title
 * ("Abstract Meaning Representation for Sembanking"), not the abstract.
 */
export function titleBlock(opening: readonly string[]): string[] {
  const abstractAt = opening.findIndex((l, i) => i > 0 && ABSTRACT_START.test(l));
  return opening.slice(0, Math.min(abstractAt < 0 ? opening.length : abstractAt, TITLE_BLOCK_LINES));
}

/**
 * Whether `title` is printed as whole lines of the title block: one line, or
 * up to TITLE_MAX_LINES consecutive lines it wraps onto. Whole lines, so a
 * title quoted inside another ("Comment on ...") is not this paper's.
 */
export function titleInBlock(title: string, block: readonly string[]): boolean {
  for (let i = 0; i < block.length; i++) {
    let span = '';
    for (let k = i; k < Math.min(block.length, i + TITLE_MAX_LINES); k++) {
      span = span ? `${span} ${block[k]}` : block[k]!;
      if (sameWholeTitle(span, title)) return true;
    }
  }
  return false;
}

/** The candidate's whole title: Crossref keeps a subtitle in a field of its own. */
function wholeTitleOf(c: SourceCandidate): string {
  const sub = (c.raw as { subtitle?: unknown } | undefined)?.subtitle;
  const s = Array.isArray(sub) && typeof sub[0] === 'string' ? sub[0].trim() : '';
  return s && !words(c.title).endsWith(words(s)) ? `${c.title}: ${s}` : c.title;
}

/** The DOIs printed in `text`, in order, each once. */
export function doisIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b10\.\d{4,9}\/[^\s"'<>]+/g)) {
    const d = normalizeDoi(m[0]);
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

/** The arXiv IDs printed in `text` ("arXiv:1706.03762", "arXiv 1706.03762v7", an arxiv.org link), in order, each once. */
export function arxivIdsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\barxiv(?:\.org\/(?:abs|pdf)\/|[:\s]+)(\d{4}\.\d{4,5}(?:v\d+)?)/gi)) {
    const id = bareArxivId(m[1]!);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

// Lines on a first page that are not the title: links, licences, journal
// furniture, identifiers.
const NOT_A_TITLE = /https?:\/\/|www\.|©|\bcopyright\b|\blicen[cs]e|\bdoi\b|\barxiv\b|\bissn\b|\bpreprint\b|\bjournal of\b|\bproceedings\b|\bvol(?:ume)?\.?\s*\d|\breceived\b|\baccepted\b|^\W*\d+\W*$/i;

/** The PDF's likely title: the first line of 8 to 300 characters in `lines` that is not page furniture. */
export function titleLine(lines: readonly string[]): string | undefined {
  return lines.find((line) => line.length >= 8 && line.length <= 300 && !NOT_A_TITLE.test(line));
}

/** Share of the candidate's authors whose family name is a word of `text`, 0..1. */
export function authorsNamedIn(c: SourceCandidate, text: string): number {
  const inText = new Set(words(text).split(' '));
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
 * names, when that work's title is the PDF's title; else the Crossref hit for
 * its title line whose whole title is the PDF's and whose authors the opening
 * names, the one with most of them named.
 */
export async function hydrateFromText(text: string): Promise<Hydration> {
  const opening = openingLines(text);
  const block = titleBlock(opening);
  const openingText = opening.join('\n');
  const tried: string[] = [];
  for (const doi of doisIn(openingText).slice(0, MAX_TRIED)) {
    const r = await hydrateDoi(doi);
    if (r.kind === 'found' && titleInBlock(wholeTitleOf(r.candidate), block)) return { ...r, via: `the DOI printed in the PDF (${doi})` };
    tried.push(`DOI ${doi}`);
  }
  for (const id of arxivIdsIn(openingText).slice(0, MAX_TRIED)) {
    const r = await hydrateArxiv(id);
    if (r.kind === 'found' && titleInBlock(wholeTitleOf(r.candidate), block)) return { ...r, via: `the arXiv ID printed in the PDF (${id})` };
    tried.push(`arXiv:${id}`);
  }
  const title = titleLine(block);
  if (!title) {
    return { kind: 'none', reason: `no title line could be read from the PDF${tried.length ? `, and ${tried.join(', ')} name other works` : ''}` };
  }
  const hits = await crossrefSearch(title, { limit: 5 });
  let best: { hit: SourceCandidate; named: number } | undefined;
  for (const hit of hits) {
    if (!titleInBlock(wholeTitleOf(hit), block)) continue;
    const named = authorsNamedIn(hit, openingText);
    if (named > 0 && (!best || named > best.named)) best = { hit, named };
  }
  if (best) return { kind: 'found', candidate: best.hit, via: `a Crossref title search for "${title}"` };
  return {
    kind: 'none',
    reason:
      `Crossref has no work titled "${title}" by an author the PDF names` +
      (tried.length ? `, and ${tried.join(', ')} name other works` : '') +
      ' — add it by its DOI or arXiv ID instead',
  };
}
