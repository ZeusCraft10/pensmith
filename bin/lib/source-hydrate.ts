// bin/lib/source-hydrate.ts — the registry record for a source the user adds.
//
// `pensmith add` is given a DOI, an arXiv ID, a URL or a PDF, and must find
// the work's own record. A wrong record would be stored self-consistent (its
// title, authors and DOI all agree), so Pass 1 could never catch it. So:
//   - a DOI is accepted only when the registry answers with that same DOI;
//     arXiv's own DOIs (10.48550/arXiv.<id>) are read from arXiv;
//   - a PDF is identified by a DOI or arXiv ID printed near its start, and
//     only when the work that identifier names has its title in the PDF (a
//     paper's first page also prints the DOIs of works it cites);
//   - failing that, by a Crossref title search, whose hit is accepted only
//     when its title matches the PDF's title line (Jaro-Winkler at or above
//     TITLE_JW_THRESHOLD) and one of its authors is named in the PDF.
// Only the title line leaves the machine for that search; the PDF's text stays
// local.

import { search as crossrefSearch, fetchById as crossrefFetchById } from './sources/crossref.js';
import { fetchById as arxivFetchById } from './sources/arxiv.js';
import { arxivFromDoi, bareArxivId, normalizeDoi, sameDoi } from './doi.js';
import { jaroWinkler, normalizeForFuzzy, TITLE_JW_THRESHOLD } from './fuzzy.js';
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

/** Lowercased words of `s`, accents removed, joined by single spaces. */
function words(s: string): string {
  return normalizeForFuzzy(s).replace(/<[^>]+>/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Whether `title` appears, word for word, in `text`. */
export function titleInText(title: string, text: string): boolean {
  const t = words(title);
  return t.length > 0 && ` ${words(text)} `.includes(` ${t} `);
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

/** The PDF's likely title: its first line of 8 to 300 characters that is not page furniture. */
export function titleLine(text: string): string | undefined {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (line.length >= 8 && line.length <= 300 && !NOT_A_TITLE.test(line)) return line;
  }
  return undefined;
}

/** Whether one of the candidate's authors is named in `text` (a family name, as a word). */
export function authorNamedIn(c: SourceCandidate, text: string): boolean {
  const inText = new Set(words(text).split(' '));
  const families = (c.names ?? []).map((n) => n.family ?? '').filter(Boolean);
  return families.some((f) => {
    const last = words(f).split(' ').pop() ?? '';
    return last.length >= 2 && inText.has(last);
  });
}

/**
 * The work a PDF's `text` is, by the identifiers printed at its start, else by
 * a title search whose hit has the PDF's title and an author it names.
 */
export async function hydrateFromText(text: string): Promise<Hydration> {
  const opening = text.slice(0, OPENING_CHARS);
  const tried: string[] = [];
  for (const doi of doisIn(opening).slice(0, MAX_TRIED)) {
    const r = await hydrateDoi(doi);
    if (r.kind === 'found' && titleInText(r.candidate.title, text)) return { ...r, via: `the DOI printed in the PDF (${doi})` };
    tried.push(`DOI ${doi}`);
  }
  for (const id of arxivIdsIn(opening).slice(0, MAX_TRIED)) {
    const r = await hydrateArxiv(id);
    if (r.kind === 'found' && titleInText(r.candidate.title, text)) return { ...r, via: `the arXiv ID printed in the PDF (${id})` };
    tried.push(`arXiv:${id}`);
  }
  const title = titleLine(opening);
  if (!title) {
    return { kind: 'none', reason: `no title line could be read from the PDF${tried.length ? `, and ${tried.join(', ')} name other works` : ''}` };
  }
  const hits = await crossrefSearch(title, { limit: 5 });
  const wanted = normalizeForFuzzy(title);
  const hit = hits.find((h) => jaroWinkler(wanted, normalizeForFuzzy(h.title)) >= TITLE_JW_THRESHOLD && authorNamedIn(h, text));
  if (hit) return { kind: 'found', candidate: hit, via: `a Crossref title search for "${title}"` };
  return {
    kind: 'none',
    reason:
      `Crossref has no work titled "${title}" by an author the PDF names` +
      (tried.length ? `, and ${tried.join(', ')} name other works` : '') +
      ' — add it by its DOI or arXiv ID instead',
  };
}
