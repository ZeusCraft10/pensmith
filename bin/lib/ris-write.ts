// bin/lib/ris-write.ts — CSL items -> RIS serializer: `.paper/CITATIONS.ris`
// (CITE-05) and the export's `export/CITATIONS.ris` (EXP-02, D-21-11).
//
// BRDTH-01 / D-17-43: .paper/CITATIONS.ris is RENDERED from LIBRARY.json by the
// one library writer (bin/lib/library.ts), in the same critical section as
// CITATIONS.bib. Only library.ts may call renderRis / writeRis / renderRisFromCsl
// (chokepoint row `library-writer`).
//
// The CSL intermediate (toCsl: names parsed by person-name.ts, the CSL type,
// container title, volume, issue, pages, publisher, editors and identifiers —
// SRC-12) and the citekey uniqueness authority (assignUniqueCitekeys) are
// imported from bibtex-write.ts, so a source describes the same work in both
// files and the .ris order matches the .bib order.
//
// The RIS text is written here, tag by tag, from CSL items (D-21-11) — not by
// citation-js's RIS formatter, which wraps a long value onto an untagged
// continuation line (a strict reader drops the rest of the title), writes a
// page range as one `SP` and never `EP`, puts a journal's name only in `T2`,
// and drops a name particle (`van der Berg`). Every record here:
//   - is `TY  - <type>` … `ER  - `, one `TAG  - value` per line, no value ever
//     wrapped (white space runs, newlines included, become one space);
//   - names authors `AU  - Family, Given` (particles kept: `van der Berg,
//     Anna`; a suffix after the given names: `King, Martin Luther, Jr.`; an
//     organisation as written), editors `A2`;
//   - splits a page range into `SP` and `EP`;
//   - gives a journal article's journal as `JO` (and `T2`, which RIS 2011
//     readers take as the journal name);
//   - carries `ID  - <citekey>`, the key both files share.
// The export RIS is rendered from the SAME parsed bibliography entries the
// export bib keeps (library.ts exportCitedCitations), so the two files hold
// the same key set by construction (asserted there). An independent strict
// parser in tests/ris-write.test.ts re-imports both files.
//
// Empty input: '' (and writeRis([], target) writes a zero-length file, parity
// with CITATIONS.bib, so no downstream reader ENOENTs).

import { atomicWriteFile } from './atomic-write.js';
import { lookupTable } from './lookup-table.js';
import { decodeEntities, stripMarkupTags } from './markup.js';
import { assignUniqueCitekeys, toCsl, type BibSource, type CslEntry } from './bibtex-write.js';

/** CSL item type → RIS type (citation-js's mapping; anything else is GEN). */
const RIS_TYPES: Readonly<Record<string, string>> = lookupTable({
  'article-journal': 'JOUR', 'article-magazine': 'MGZN', 'article-newspaper': 'NEWS', article: 'JOUR', bill: 'BILL',
  book: 'BOOK', broadcast: 'MPCT', chapter: 'CHAP', classic: 'CLSWK', collection: 'GEN', dataset: 'DATA', document: 'GEN',
  entry: 'CTLG', 'entry-dictionary': 'DICT', 'entry-encyclopedia': 'ENCYC', event: 'GEN', figure: 'FIGURE', graphic: 'ART',
  hearing: 'HEAR', interview: 'GEN', legal_case: 'CASE', legislation: 'LEGAL', manuscript: 'MANSCPT', map: 'MAP',
  motion_picture: 'MPCT', musical_score: 'MUSIC', pamphlet: 'PAMP', 'paper-conference': 'CONF', patent: 'PAT',
  performance: 'GEN', periodical: 'SER', preprint: 'GEN', personal_communication: 'PCOMM', 'post-weblog': 'BLOG', post: 'ICOMM',
  regulation: 'LEGAL', report: 'RPRT', 'review-book': 'BOOK', review: 'JOUR', software: 'COMP', song: 'SOUND',
  speech: 'SOUND', standard: 'STAND', thesis: 'THES', treaty: 'GEN', webpage: 'ELEC',
});

/** An arXiv identifier, new style (`1706.03762`) or old (`hep-th/9901001`), optionally versioned. */
const ARXIV_ID_RE = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?$/i;

/** RIS types whose `A2` is the book's (or proceedings') editors. */
const EDITED_CONTAINER_TYPES = new Set(['CHAP', 'CONF', 'CPAPER', 'BOOK', 'EDBOOK', 'ENCYC', 'DICT']);

/** One CSL name as citation-js and toCsl write it. */
interface CslNameLike {
  readonly family?: unknown;
  readonly given?: unknown;
  readonly suffix?: unknown;
  readonly literal?: unknown;
  readonly 'non-dropping-particle'?: unknown;
  readonly 'dropping-particle'?: unknown;
}

/**
 * A value on one line: the markup tags citation-js and CSL write removed (only
 * known tags — markup.ts stripMarkupTags: `<i>`, `<sup>`, `<span
 * class="nocase">`, …; review round 3: a `<` or `>` of the text, as in `<5 mg`
 * or `p<0.05`, is kept), entities decoded once, white space runs (newlines
 * too) as one space.
 */
function oneLine(value: unknown): string {
  if (value === undefined || value === null) return '';
  return decodeEntities(stripMarkupTags(String(value))).replace(/\s+/gu, ' ').trim();
}

/** `Family, Given` (particles kept, suffix after the given names), or an organisation as written. */
export function risName(n: CslNameLike): string {
  const literal = oneLine(n.literal);
  if (literal !== '') return literal;
  const family = [oneLine(n['non-dropping-particle']), oneLine(n.family)].filter((p) => p !== '').join(' ');
  const given = [oneLine(n.given), oneLine(n['dropping-particle'])].filter((p) => p !== '').join(' ');
  const suffix = oneLine(n.suffix);
  if (family === '') return given;
  return [family, given, suffix].filter((p) => p !== '').join(', ');
}

/** A page range split at its dash (`145--162`, `145–162`, `5-19`): `[start, end?]`. */
export function splitPages(page: string): [string, string | undefined] {
  const m = /^\s*([^\s\-–—]+)\s*(?:-{1,3}|–|—)\s*([^\s\-–—]+)\s*$/u.exec(page);
  if (m !== null) return [m[1] as string, m[2] as string];
  return [page.trim(), undefined];
}

/** The year and, when known, the full RIS date (`2012/03/15/`). */
function dates(issued: unknown): { year: string; date: string | null } | null {
  const parts = (issued as { 'date-parts'?: unknown } | undefined)?.['date-parts'];
  const first = Array.isArray(parts) ? (parts[0] as unknown) : undefined;
  if (!Array.isArray(first) || first[0] === undefined) {
    const raw = oneLine((issued as { raw?: unknown; literal?: unknown } | undefined)?.raw ?? (issued as { literal?: unknown } | undefined)?.literal);
    const y = /\b(\d{4})\b/.exec(raw)?.[1];
    return y !== undefined ? { year: y, date: null } : null;
  }
  const [y, m, d] = first.map((p) => String(p));
  if (y === undefined || !/^-?\d+$/.test(y)) return null;
  if (m === undefined) return { year: y, date: null };
  const pad = (s: string): string => (s.length === 1 ? `0${s}` : s);
  return { year: y, date: `${y}/${pad(m)}/${d !== undefined ? pad(d) : ''}/` };
}

/** Options of renderRisFromCsl. */
export interface RisOptions {
  /** Write a `note` (the library's `RETRACTED` flag, D-15) as `N1`. Never in an export (zero trace, D-20-15). */
  readonly notes?: boolean;
}

/** One RIS record for one CSL item (its `id` is the record's `ID`). */
function risRecord(item: Record<string, unknown>, opts: RisOptions): string {
  const lines: string[] = [];
  const tag = (t: string, value: unknown): void => {
    const v = oneLine(value);
    if (v !== '') lines.push(`${t}  - ${v}`);
  };
  const type = RIS_TYPES[String(item['type'] ?? '')] ?? 'GEN';
  lines.push(`TY  - ${type}`);
  tag('ID', item['id']);
  for (const a of Array.isArray(item['author']) ? (item['author'] as CslNameLike[]) : []) tag('AU', risName(a));
  const editors = Array.isArray(item['editor']) ? (item['editor'] as CslNameLike[]) : [];
  for (const e of editors) tag(EDITED_CONTAINER_TYPES.has(type) ? 'A2' : 'ED', risName(e));
  tag('TI', item['title']);
  const container = item['container-title'];
  if (type === 'JOUR') {
    tag('JO', container);
    tag('T2', container);
  } else {
    tag('T2', container);
  }
  tag('T3', item['collection-title']);
  const when = dates(item['issued']);
  if (when !== null) {
    tag('PY', when.year);
    if (when.date !== null) tag('DA', when.date);
  }
  tag('VL', item['volume']);
  tag('IS', item['issue']);
  const page = oneLine(item['page']);
  if (page !== '') {
    const [sp, ep] = splitPages(page);
    tag('SP', sp);
    if (ep !== undefined) tag('EP', ep);
  }
  tag('ET', item['edition']);
  tag('PB', item['publisher']);
  tag('CY', item['publisher-place']);
  tag('SN', item['ISBN'] ?? item['ISSN']);
  tag('DO', item['DOI']);
  // An arXiv preprint: the bib's eprint, or the arXiv id toCsl puts in `number` (CSL preprint / article).
  const numberIsArxiv = (item['type'] === 'preprint' || type === 'JOUR') && ARXIV_ID_RE.test(oneLine(item['number']));
  const arxiv = oneLine(item['eprint'] ?? (numberIsArxiv ? item['number'] : undefined));
  tag('UR', item['URL'] ?? (arxiv !== '' ? `https://arxiv.org/abs/${arxiv}` : undefined));
  tag('AB', item['abstract']);
  tag('LA', item['language']);
  if (opts.notes === true) tag('N1', item['note']);
  lines.push('ER  - ');
  return lines.join('\n') + '\n';
}

/**
 * Render CSL items as RIS, one record per item in the order given (each
 * item's `id` is its citekey and its `ID`). '' for none.
 */
export function renderRisFromCsl(items: ReadonlyArray<Record<string, unknown>>, opts: RisOptions = {}): string {
  return items.map((i) => risRecord(i, opts)).join('');
}

/**
 * Render sources as RIS, keyed and sorted exactly like renderBibtex
 * (diff-stable), id-less sources dropped. '' for none.
 */
export function renderRis(sources: BibSource[]): string {
  const survivors: Array<{ source: BibSource; csl: CslEntry }> = [];
  for (const c of sources) {
    const csl = toCsl(c);
    if (csl) survivors.push({ source: c, csl });
  }
  const keyed = assignUniqueCitekeys(survivors.map((s) => s.source));
  const entries = keyed.map((c, i) => {
    const csl = survivors[i]!.csl;
    csl.id = c.citekey;
    return { citekey: c.citekey, csl };
  });
  entries.sort((a, b) => a.citekey.localeCompare(b.citekey));
  return renderRisFromCsl(entries.map((e) => e.csl as unknown as Record<string, unknown>), { notes: true });
}

/**
 * Render `sources` (renderRis) and write them atomically to `targetPath`.
 * Only bin/lib/library.ts calls this in shipped code (chokepoint row
 * `library-writer`).
 *
 * @param sources LIBRARY.json v2 entries (or SourceCandidate[]).
 * @param targetPath Absolute or relative path; parent dir created if missing.
 */
export async function writeRis(sources: BibSource[], targetPath: string): Promise<void> {
  await atomicWriteFile(targetPath, renderRis(sources));
}
