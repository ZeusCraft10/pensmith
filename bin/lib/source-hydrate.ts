// bin/lib/source-hydrate.ts — the registry record for a source the user adds.
//
// `pensmith add` is given a DOI, an arXiv ID, a URL or a PDF, and must find
// the work's own record. A wrong record would be stored self-consistent (its
// title, authors and DOI all agree), so Pass 1 could never catch it. So:
//   - a DOI is accepted only when the registry answers with that same DOI;
//     arXiv's own DOIs (10.48550/arXiv.<id>) are read from arXiv;
//   - a PDF is identified by a DOI or arXiv ID printed in its opening (before
//     any reference list), and only when the work that identifier names has
//     its title printed word for word as whole lines of the PDF's title block
//     (the lines before the abstract), with its authors named in the lines
//     next to it, as a paper prints its own title and byline, and with
//     nothing above it showing another work: a first page can also print
//     cited works' DOIs, titles and authors below its own title and byline,
//     and a notice (an erratum, a comment) prints those of the work it is
//     about;
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
 * title is printed as whole lines of the title block, and either one of its
 * authors is named in the BYLINE_LINES opening lines after it, with nothing
 * above it showing that another work heads the PDF, or its byline is printed
 * right above it. A work with no personal author has no byline, so its title
 * must be the block's first title line.
 */
function titleHeadsPdf(c: SourceCandidate, block: readonly string[], opening: readonly string[]): boolean {
  const hasAuthors = (c.names ?? []).some((n) => n.family);
  return titleSpans(wholeTitleOf(c), block).some(([first, last]) => {
    if (!hasAuthors) return first === titleLineIndex(block) && !block.slice(0, first).some((line) => NOTICE.test(line));
    if (shareNamed(c, wordsAfter(block, opening, last)) > 0) return !anotherWorkAbove(c, block, first);
    return bylineAbove(c, block, first, opening[last + 1]);
  });
}

/**
 * The words of the BYLINE_LINES opening lines after line `last`, where a
 * title's byline is printed. Those before the abstract are read as a byline
 * (bylineWords); an abstract's words are read as printed.
 */
function wordsAfter(block: readonly string[], opening: readonly string[], last: number): Set<string> {
  const lines = opening.slice(last + 1, last + 1 + BYLINE_LINES);
  const inBlock = Math.max(0, Math.min(lines.length, block.length - last - 1));
  const out = bylineWords(lines.slice(0, inBlock).join('\n'));
  for (const w of nameWords(lines.slice(inBlock).join('\n'))) out.add(w);
  return out;
}

/**
 * Whether the block above line `first` shows that another work heads the
 * PDF: a notice, or a title followed by a byline that names someone who is
 * not one of `c`'s authors (the PDF's own title and byline, with a cited
 * work's set below them). What else sits above a paper's title (a permission
 * notice, a template's header, a running head, an article-type label) names
 * no one, so it does not count against the title below it.
 */
function anotherWorkAbove(c: SourceCandidate, block: readonly string[], first: number): boolean {
  const above = block.slice(0, first);
  return above.some(
    (line, i) => NOTICE.test(line) || (titleLike(line) && above.slice(i + 1, i + 1 + BYLINE_LINES).some((l) => namesSomeoneElse(c, l))),
  );
}

/** Whether `line` reads as a byline and names someone who is not one of `c`'s authors. */
function namesSomeoneElse(c: SourceCandidate, line: string): boolean {
  return bylineNames(line)?.some((name) => shareNamed(c, bylineWords(name)) === 0) ?? false;
}

/**
 * Whether `c`'s byline is printed in the BYLINE_LINES lines right above line
 * `first`: each of them is page furniture or names one of its authors, and
 * only page furniture is above them. A reference set authors first has the
 * same shape, so a line that starts with a reference number or carries a
 * reference's venue, volume or year is not a byline, and a title whose next
 * line (`after`) carries one is a reference's.
 */
function bylineAbove(c: SourceCandidate, block: readonly string[], first: number, after: string | undefined): boolean {
  const from = Math.max(0, first - BYLINE_LINES);
  const byline = block.slice(from, first);
  const namesC = (line: string): boolean => shareNamed(c, bylineWords(line)) > 0 && !REFERENCE_START.test(line) && !REFERENCE_TAIL.test(line);
  return (
    shareNamed(c, bylineWords(byline.join('\n'))) > 0 &&
    byline.every((line) => furniture(line) || namesC(line)) &&
    block.slice(0, from).every(furniture) &&
    !(after !== undefined && REFERENCE_TAIL.test(after))
  );
}

// The start of a numbered reference: "[1] ", "1. ", "12) ".
const REFERENCE_START = /^\s*(?:\[\d+\]|\d+[.)]\s)/;
// A reference's venue, volume or year: "13(2)", "pp. 22", "vol. 13", ", 2011."
const REFERENCE_TAIL = /\b\d+\s*\(\s*\d+(?:\s*[-–]\s*\d+)?\s*\)|\bpp?\.\s*\d|\bvol(?:ume)?\.?\s*\d|,\s*(?:1[5-9]|20)\d\d[a-z]?\s*[.;)]?\s*(?:$|doi\b)/i;

// The opening of a notice about another work: a correction, a comment, a
// reply, a retraction notice, a review or an obituary prints that work's
// title, authors and DOI. A retracted work's own stamp ("RETRACTED ARTICLE")
// is not one: the retraction check flags the work itself.
const NOTICE =
  /^\W*(?:errat(?:um|a)|corrigend(?:um|a)|correction|addendum|comments? on|commentary on|reply to|response to|retraction|expression of concern|book reviews?|news (?:&|and) views|in memoriam)\b/i;

/** Whether `line` is page furniture: too short or too long for a title, or a line NOT_A_TITLE names (a link, a licence, an identifier, a journal's citation line). */
function furniture(line: string): boolean {
  return !NOTICE.test(line) && !titleLike(line);
}

// Affiliation marks set against a name: digits, superscripts, symbols.
const AFFILIATION_MARKS = /[\p{N}*∗†‡§¶✉#]/gu;
// Initials ("S.", "J.-P.", "C").
const INITIALS = /^\p{Lu}\.(?:-?\p{Lu}\.)*$|^\p{Lu}$/u;
// Lower-case particles of a family name ("van der Walt", "de la Cruz"), and
// an affiliation letter set apart from a name ("Walt a").
const PARTICLE = /^(?:van|von|der|den|de|del|della|di|da|du|dos|das|la|le|ter|ten|bin|ibn|al|el|zu|af|[a-z])$/;
// Capitalised words that labels, venues, subject headings and affiliations
// print and names do not ("Research Article", "Open Access", "Editors'
// Suggestion", "Neural Networks", "Computer Science").
const NOT_A_NAME = new Set(
  [
    // article types and labels
    'the article articles research open access review reviews original paper papers letter letters communication',
    'communications report reports technical note notes editorial editor editors perspective perspectives essay essays',
    'issue special section highlight highlights focus feature features featured invited abstract summary introduction',
    'chapter volume supplement supplementary suggestion suggestions choice selected story news views comment',
    'comments opinion forum debate policy tutorial survey resource resources method methods protocol protocols',
    'software dataset tool tools insight insights spotlight track points advance rapid target cc by nc nd sa',
    // venues and affiliations
    'science sciences scientific journal transactions proceedings conference symposium workshop society association',
    'institute university college school department faculty laboratory centre center annals bulletin quarterly',
    'studies international national academy manuscript preprint draft version submitted accepted published online',
    'correspondence contents retracted',
    // subjects
    'nature physics physical chemistry chemical biology biological medicine medical clinical psychology psychological',
    'engineering computing computer computers computation computational mathematics mathematical economics economic',
    'programming machine neural network networks systems intelligence analysis theory applied frontiers expression',
    'neuroscience genetics genomics ecology evolution immunology microbiology molecular cell cancer health social',
    'cognitive behavioral behavioural developmental environmental earth planetary materials astronomy astrophysics',
    'statistics statistical optics quantum biochemistry biophysics pharmacology neurology psychiatry epidemiology',
    'public political sociology anthropology linguistics philosophy history education business management finance',
  ]
    .join(' ')
    .split(' '),
);

/**
 * The names a byline line prints, or undefined when `line` does not read as
 * one: names separated by commas, semicolons, middle dots or "and", made of
 * capitalised words and initials, with lower-case particles and affiliation
 * marks between them, at least two words in all, none of them a word that
 * labels, venues and affiliations print. Initials set apart by a comma
 * ("Colbert, S. C.") are not a name of their own.
 */
function bylineNames(line: string): string[] | undefined {
  const text = line.normalize('NFC').replace(/\bet al\b\.?/giu, ' ').replace(AFFILIATION_MARKS, ' ');
  if (!/^\s*\p{Lu}/u.test(text)) return undefined;
  const names: string[] = [];
  let named = 0;
  for (const name of text.split(/[,;·•&]|\band\b/iu).map((n) => n.trim()).filter(Boolean)) {
    const tokens = name.split(/\s+/);
    if (tokens.length > 6) return undefined;
    let wordsInName = 0;
    for (const t of tokens) {
      if (INITIALS.test(t) || PARTICLE.test(t)) continue;
      if (!/^\p{Lu}[\p{L}'’-]*\.?$/u.test(t) || NOT_A_NAME.has(t.toLowerCase().replace(/(?:['’]s?|\.)$/u, ''))) return undefined;
      wordsInName++;
    }
    if (wordsInName > 0) names.push(name);
    named += wordsInName;
  }
  return named >= 2 ? names : undefined;
}

/** The candidate's whole title: Crossref keeps a subtitle in a field of its own. */
function wholeTitleOf(c: SourceCandidate): string {
  const s = firstString((c.raw as { subtitle?: unknown } | undefined)?.subtitle);
  return wholeTitle(s && !words(c.title).endsWith(words(s)) ? { title: c.title, subtitle: s } : { title: c.title });
}

// Lines on a first page that are not the title: links, licences, journal
// furniture ("Neural Networks 61 (2015) 85–117", "Contents lists available
// at ScienceDirect", "Published as a conference paper at ICLR 2019",
// "Behavioral and Brain Sciences (2017), Page 1 of 72"), templates' headers
// ("Noname manuscript No.", "Typeset using LATEX"), a permission notice,
// identifiers.
const NOT_A_TITLE =
  /https?:\/\/|www\.|©|\bcopyright\b|\blicen[cs]e|\bdoi\b|\barxiv\b|\bissn\b|\bpreprint\b|\bjournal of\b|\bproceedings\b|\bvol(?:ume)?\.?\s*\d|\bpp\.\s*\d|\d\s*\((?:1[89]|20)\d\d\)|\((?:1[89]|20)\d\d\)[\s,.:;]*\d|\breceived\b|\baccepted\b|\bsciencedirect\b|\bcontents lists available\b|\bpublished (?:as|in|online|by)\b|\bunder review\b|\bto appear in\b|\bpage \d+ of \d+\b|\bnoname manuscript\b|\bwill be inserted by the editor\b|\btypeset using\b|^\W*draft version\b|\bauthor manuscript\b|\bhereby grants?\b|\bgrants? permission\b|\bproper attribution\b|^\W*special (?:issue|section)\b|\bthis (?:article|paper) is part of\b|^\W*retracted article\W*$|^\W*\d+\W*$/i;

/** Whether `line` can be a title: 8 to 300 characters, and not page furniture. */
function titleLike(line: string): boolean {
  return line.length >= 8 && line.length <= 300 && !NOT_A_TITLE.test(line);
}

/** Where the PDF's likely title is: the first line in `lines` that can be a title, or -1. */
function titleLineIndex(lines: readonly string[]): number {
  return lines.findIndex(titleLike);
}

/** The PDF's likely title line, if any. */
function titleLine(lines: readonly string[]): string | undefined {
  const i = titleLineIndex(lines);
  return i < 0 ? undefined : lines[i];
}

/**
 * The words of `text` a family name is matched against: runs of letters, so
 * an affiliation mark after a name ("Walt1", "Walt¹", "Walt*") is not part of
 * it.
 */
function nameWords(text: string): Set<string> {
  return new Set(normalizeForFuzzy(text).match(/\p{L}+/gu) ?? []);
}

/**
 * The words of a byline: those of nameWords, and a word with an affiliation
 * letter set against it ("Walta,∗", "Varoquauxc") also without that letter.
 * Only a to d, the letters of a first few affiliations, and only before a
 * comma, a mark or the line's end, so "Cheng," is not read as "Chen", nor
 * "Clarke," as "Clark".
 */
function bylineWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split('\n').map(normalizeForFuzzy)) {
    for (const m of line.matchAll(/\p{L}+/gu)) {
      const w = m[0];
      out.add(w);
      const next = line[m.index + w.length];
      if (w.length > 4 && /[a-d]$/.test(w) && (next === undefined || /[,;*∗†‡§¶✉]/u.test(next))) out.add(w.slice(0, -1));
    }
  }
  return out;
}

/** Share of the candidate's authors whose family name is one of `inText`, 0..1. */
function shareNamed(c: SourceCandidate, inText: ReadonlySet<string>): number {
  const families = (c.names ?? []).map((n) => n.family ?? '').filter(Boolean);
  if (families.length === 0) return 0;
  const named = families.filter((f) => {
    const last = words(f).split(' ').pop() ?? '';
    return last.length >= 2 && inText.has(last);
  });
  return named.length / families.length;
}

/** Why the work an identifier printed in the PDF names is not taken for it. */
function whyNot(shown: string, r: Hydration, block: readonly string[]): string {
  if (r.kind === 'none') return r.reason;
  if (r.kind === 'mismatch') return `the registry answered ${shown} with the record of ${r.returned}`;
  return titleSpans(wholeTitleOf(r.candidate), block).length > 0
    ? `${shown} names "${r.candidate.title}", whose title the PDF prints but not as its own, with its byline`
    : `${shown} names another work, "${r.candidate.title}"`;
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
  const notes: string[] = [];
  for (const p of printed) {
    const r = await p.look();
    if (r.kind === 'found' && titleHeadsPdf(r.candidate, block, opening)) return { ...r, via: p.via };
    notes.push(whyNot(p.shown, r, block));
  }
  const others = notes.length ? `, and ${notes.join('; ')}` : '';
  const title = titleLine(block);
  if (!title) return { kind: 'none', reason: `no title line could be read from the PDF${others}` };
  const hits = await crossrefSearch(title, { limit: 5 });
  let best: { hit: SourceCandidate; named: number } | undefined;
  for (const hit of hits) {
    const heads = titleSpans(wholeTitleOf(hit), block).filter(
      ([first, last]) => !anotherWorkAbove(hit, block, first) || bylineAbove(hit, block, first, opening[last + 1]),
    );
    if (heads.length === 0) continue;
    // The whole opening may name an author, but only a byline next to the
    // title is read with an affiliation letter set against a name.
    const inText = nameWords(openingText);
    for (const [first, last] of heads) {
      const near = [...bylineWords(block.slice(Math.max(0, first - BYLINE_LINES), first).join('\n')), ...wordsAfter(block, opening, last)];
      for (const w of near) inText.add(w);
    }
    const named = shareNamed(hit, inText);
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
