// tests/ris-write.test.ts — the RIS writer (CITE-05; EXP-02, D-21-11).
//
// Every RIS file pensmith writes — `.paper/CITATIONS.ris` (rendered from
// LIBRARY.json by the one library writer) and an export's `CITATIONS.ris`
// (rendered from the same parsed entries as the export's bib) — is re-imported
// here by an INDEPENDENT strict parser (tests/helpers/ris-strict.ts, no code
// shared with the writer), which refuses anything a strict reference manager
// would misread:
//   - every line is `TAG  - value` (two capitals or capital+digit, two spaces,
//     a hyphen, a space) — no untagged continuation line, so no value is ever
//     wrapped (citation-js's formatter wraps long titles; a strict reader drops
//     the rest);
//   - a record opens with `TY` and closes with `ER  - `, nothing between
//     records, no empty value, no trailing white space in a value, LF only.
// Then the contract: AU `Family, Given` (particles kept, a suffix after the
// given names, an organisation as written), a page range split into SP and
// EP, a journal article's journal as JO (and T2), a chapter's book as T2 and
// its editors as A2, and the two files of each pair holding the same keys,
// authors and titles as the bib they sit beside. The export RIS never carries
// the library's RETRACTED note (zero trace, D-20-15).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';
import { renderRis, renderRisFromCsl, risName, splitPages, writeRis } from '../bin/lib/ris-write.js';
import { exportCitedCitations, upsertSources, type LibraryCandidate } from '../bin/lib/library.js';
import { parseBib } from '../bin/lib/citations.js';
import { plainText } from '../bin/lib/markup.js';
import { parseRisStrict, risAll as all, risById as byId, risFirst as first } from './helpers/ris-strict.js';

test('the strict parser refuses what a strict reader would misread (negative controls)', () => {
  assert.throws(() => parseRisStrict('TY  - JOUR\nTI  - A long title\n  that wraps\nER  - \n'), /wrapped or stray/);
  assert.throws(() => parseRisStrict('TY  - JOUR\nTI  - A\n'), /not closed/);
  assert.throws(() => parseRisStrict('TI  - A\nER  - \n'), /outside a record/);
  assert.throws(() => parseRisStrict('TY  - JOUR\nTY  - BOOK\nER  - \n'), /inside an open record/);
  assert.throws(() => parseRisStrict('TY  - JOUR\r\nER  - \r\n'), /carriage return/);
  assert.throws(() => parseRisStrict('TY  - JOUR\nAU  - \nER  - \n'), /not "TAG|empty value/);
  assert.equal(parseRisStrict('TY  - JOUR\nID  - a\nER  - \n').length, 1);
});

// ---------------------------------------------------------------------------
// The writer.
// ---------------------------------------------------------------------------

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'pensmith-ris-')), 'CITATIONS.ris');
}

// The Phase 10 fixtures (Vaswani / He / Doe), each with a DOI.
const fixtures: SourceCandidate[] = [
  { source: 'crossref', id: '10.0000/aaa', doi: '10.0000/aaa', title: 'Attention Is All You Need', authors: ['Vaswani, Ashish'], year: 2017, retracted: false, citekey: 'vaswani2017', last_verified: '2024-01-01T00:00:00.000Z', raw: {} },
  { source: 'openalex', id: '10.0000/bbb', doi: '10.0000/bbb', title: 'Deep Residual Learning', authors: ['He, Kaiming'], year: 2016, retracted: false, citekey: 'he2016', last_verified: '2024-01-01T00:00:00.000Z', raw: {} },
  { source: 'arxiv', id: '2401.00001', doi: '10.48550/arXiv.2401.00001', title: 'Naive Bayes Revisited (na\\"ive)', authors: ['Doe, Jane'], year: 2024, retracted: false, citekey: 'doe2024', last_verified: '2024-01-01T00:00:00.000Z', raw: { arxivId: '2401.00001' } } as SourceCandidate,
];

test('CITE-05: writeRis writes one strict record per source, keyed and sorted like the bib', async () => {
  const target = tmpFile();
  await writeRis(fixtures, target);
  const records = parseRisStrict(readFileSync(target, 'utf8'));
  assert.deepEqual(records.map((r) => first(r, 'ID')), ['doe2024', 'he2016', 'vaswani2017']);
  const v = byId(records).get('vaswani2017')!;
  assert.equal(v.type, 'JOUR');
  assert.deepEqual(all(v, 'AU'), ['Vaswani, Ashish']);
  assert.equal(first(v, 'TI'), 'Attention Is All You Need');
  assert.equal(first(v, 'PY'), '2017');
  assert.equal(first(v, 'DO'), '10.0000/aaa');
  // An arXiv preprint is GEN (as the bib's @misc reads back) with its arXiv page as UR.
  const doe = byId(records).get('doe2024')!;
  assert.equal(doe.type, 'GEN');
  assert.equal(first(doe, 'UR'), 'https://arxiv.org/abs/2401.00001');
});

test('CITE-05: an empty list writes a zero-length file (no reader ENOENTs); a source with no identifier is dropped, never thrown on', async () => {
  const empty = tmpFile();
  await writeRis([], empty);
  assert.equal(readFileSync(empty, 'utf8'), '');
  const target = tmpFile();
  const noId = { source: 'crossref', id: 'tmp-noid', title: 'No id', authors: ['Nobody, N'], year: 2020, retracted: false, citekey: 'noid2020', last_verified: '2024-01-01T00:00:00.000Z', raw: {} } as unknown as SourceCandidate;
  await writeRis([...fixtures, noId], target);
  assert.deepEqual(parseRisStrict(readFileSync(target, 'utf8')).map((r) => first(r, 'ID')), ['doe2024', 'he2016', 'vaswani2017']);
});

const LONG_TITLE = 'Growth in the Baltic economies after the war: a very long title that goes on '.repeat(6).trim();

const RICH: LibraryCandidate[] = [
  { citekey: 'berg2012', doi: '10.5555/berg', title: LONG_TITLE, authors: ['van der Berg, Anna', 'King, Martin Luther, Jr.', 'Xu, Wei'], year: 2012, type: 'article-journal', venue: 'Journal of Economic History', volume: 12, issue: '3', pages: '145--162', abstract: 'Line one.\nLine two\n\n  indented.' },
  { citekey: 'kuhn1962', isbn: '9780226458083', title: 'The Structure of Scientific Revolutions', authors: ['Kuhn, Thomas S.'], year: 1962, type: 'book', publisher: 'University of Chicago Press' },
  { citekey: 'smith2010', doi: '10.5555/chap', title: 'A Chapter on China', authors: ['Smith, Jo'], year: 2010, type: 'chapter', venue: 'The Big Book', editors: ['Editor, Ed', 'Other, Ann'], publisher: 'Pub', pages: '5–19' },
  { citekey: 'gone2019', doi: '10.5555/gone', title: 'A Retracted Study', authors: ['Gone, Al'], year: 2019, type: 'article-journal', venue: 'J', retracted: true },
];

test('D-21-11: no value is ever wrapped — a 470-character title and a multi-line abstract are one line each', () => {
  const records = parseRisStrict(renderRis(RICH as never));
  const berg = byId(records).get('berg2012')!;
  assert.equal(first(berg, 'TI'), LONG_TITLE);
  assert.ok(LONG_TITLE.length > 400);
  assert.equal(first(berg, 'AB'), 'Line one. Line two indented.');
});

test('D-21-11: AU is "Family, Given" — particles kept, a suffix after the given names, an organisation as written; a chapter\'s editors are A2', () => {
  const records = byId(parseRisStrict(renderRis(RICH as never)));
  assert.deepEqual(all(records.get('berg2012')!, 'AU'), ['van der Berg, Anna', 'King, Martin Luther, Jr.', 'Xu, Wei']);
  assert.deepEqual(all(records.get('smith2010')!, 'A2'), ['Editor, Ed', 'Other, Ann']);
  assert.equal(risName({ family: 'Berg', 'non-dropping-particle': 'van der', given: 'Anna' }), 'van der Berg, Anna');
  assert.equal(risName({ family: 'Beethoven', given: 'Ludwig', 'dropping-particle': 'van' }), 'Beethoven, Ludwig van');
  assert.equal(risName({ family: 'King', given: 'Martin Luther', suffix: 'Jr.' }), 'King, Martin Luther, Jr.');
  assert.equal(risName({ literal: 'World Health Organization' }), 'World Health Organization');
  assert.equal(risName({ family: 'Plato' }), 'Plato');
  const org = parseRisStrict(renderRisFromCsl([{ id: 'who2020', type: 'report', title: 'Report', author: [{ literal: 'World Health Organization' }], issued: { 'date-parts': [[2020, 3, 15]] } }]));
  assert.deepEqual(all(org[0]!, 'AU'), ['World Health Organization']);
  assert.equal(org[0]!.type, 'RPRT');
  assert.equal(first(org[0]!, 'DA'), '2020/03/15/');
});

test('D-21-11: a page range is SP and EP; a journal article\'s journal is JO (and T2); a book is BOOK with PB and SN; a chapter is CHAP with its book as T2', () => {
  const records = byId(parseRisStrict(renderRis(RICH as never)));
  const berg = records.get('berg2012')!;
  assert.equal(berg.type, 'JOUR');
  assert.equal(first(berg, 'SP'), '145');
  assert.equal(first(berg, 'EP'), '162');
  assert.equal(first(berg, 'JO'), 'Journal of Economic History');
  assert.equal(first(berg, 'T2'), 'Journal of Economic History');
  assert.equal(first(berg, 'VL'), '12');
  assert.equal(first(berg, 'IS'), '3');
  const kuhn = records.get('kuhn1962')!;
  assert.equal(kuhn.type, 'BOOK');
  assert.equal(first(kuhn, 'PB'), 'University of Chicago Press');
  assert.equal(first(kuhn, 'SN'), '9780226458083');
  assert.equal(kuhn.tags.has('JO'), false);
  const smith = records.get('smith2010')!;
  assert.equal(smith.type, 'CHAP');
  assert.equal(first(smith, 'T2'), 'The Big Book');
  assert.equal(smith.tags.has('JO'), false);
  assert.equal(first(smith, 'SP'), '5');
  assert.equal(first(smith, 'EP'), '19');
  assert.deepEqual(splitPages('145--162'), ['145', '162']);
  assert.deepEqual(splitPages('5–19'), ['5', '19']);
  assert.deepEqual(splitPages('e1001'), ['e1001', undefined]);
  assert.deepEqual(splitPages('S12 - S19'), ['S12', 'S19']);
});

// ---------------------------------------------------------------------------
// Both RIS files re-imported beside their bib.
// ---------------------------------------------------------------------------

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-ris-paper-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  return root;
}

interface Work {
  readonly title: string;
  readonly firstFamily: string;
  readonly authors: number;
  readonly year: string;
  readonly doi: string | undefined;
}

/** What the bib says of each key (parsed with the project's own reader). */
async function bibWorks(text: string): Promise<Map<string, Work>> {
  const map = new Map<string, Work>();
  for (const e of await parseBib(text)) {
    const authors = (e['author'] as Array<{ family?: string; literal?: string; 'non-dropping-particle'?: string }> | undefined) ?? [];
    const a0 = authors[0];
    const family = a0 === undefined ? '' : a0.literal ?? [a0['non-dropping-particle'], a0.family].filter((p) => p !== undefined).join(' ');
    const issued = (e['issued'] as { 'date-parts'?: number[][] } | undefined)?.['date-parts']?.[0]?.[0];
    map.set(String(e['id']), {
      title: plainText(String(e['title'] ?? '')).replace(/\s+/g, ' ').trim(),
      firstFamily: family,
      authors: authors.length,
      year: String(issued ?? ''),
      doi: typeof e['DOI'] === 'string' ? e['DOI'].toLowerCase() : undefined,
    });
  }
  return map;
}

/** What the RIS says of each key. */
function risWorks(text: string): Map<string, Work> {
  const map = new Map<string, Work>();
  for (const [id, r] of byId(parseRisStrict(text))) {
    map.set(id, {
      title: first(r, 'TI') ?? '',
      firstFamily: (first(r, 'AU') ?? '').split(', ')[0] ?? '',
      authors: all(r, 'AU').length,
      year: first(r, 'PY') ?? '',
      doi: first(r, 'DO')?.toLowerCase(),
    });
  }
  return map;
}

test('CITE-05 / BRDTH-01: .paper/CITATIONS.ris re-imports strictly with the same keys, titles, first authors, years and DOIs as .paper/CITATIONS.bib', async () => {
  const root = project();
  await upsertSources(root, RICH, { provenance: 'add' });
  const bibText = readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8');
  const risText = readFileSync(join(root, '.paper', 'CITATIONS.ris'), 'utf8');
  const bib = await bibWorks(bibText);
  const ris = risWorks(risText);
  assert.deepEqual([...ris.keys()].sort(), [...bib.keys()].sort());
  assert.deepEqual([...ris.keys()].sort(), ['berg2012', 'gone2019', 'kuhn1962', 'smith2010']);
  for (const [k, w] of bib) assert.deepEqual(ris.get(k), w, k);
  // The library's own RIS keeps the retraction flag as a note (D-15).
  assert.equal(first(byId(parseRisStrict(risText)).get('gone2019')!, 'N1'), 'RETRACTED');
});

test('EXP-02 / D-21-11: the export pair holds exactly the cited keys, the RIS re-imports strictly with the bib\'s titles and authors, and carries no RETRACTED note', async () => {
  const root = project();
  await upsertSources(root, RICH, { provenance: 'add' });
  const exportDir = join(root, '.paper', 'export');
  const res = await exportCitedCitations(root, ['smith2010', 'berg2012', 'gone2019'], exportDir);
  assert.ok(res.bibPath !== null && res.risPath !== null);
  const bibText = readFileSync(res.bibPath, 'utf8');
  const risText = readFileSync(res.risPath, 'utf8');
  const bib = await bibWorks(bibText);
  const ris = risWorks(risText);
  assert.deepEqual([...bib.keys()].sort(), ['berg2012', 'gone2019', 'smith2010'], 'only the cited keys');
  assert.deepEqual([...ris.keys()].sort(), [...bib.keys()].sort(), 'the RIS holds the bib\'s keys');
  for (const [k, w] of bib) assert.deepEqual(ris.get(k), w, k);
  assert.ok(!/RETRACTED/.test(bibText) && !/RETRACTED/.test(risText), 'the library\'s flag never leaves .paper/ (zero trace)');
  const records = byId(parseRisStrict(risText));
  assert.equal(first(records.get('berg2012')!, 'JO'), 'Journal of Economic History');
  assert.equal(first(records.get('berg2012')!, 'EP'), '162');
  assert.deepEqual(all(records.get('smith2010')!, 'A2'), ['Editor, Ed', 'Other, Ann']);
  assert.equal(first(records.get('smith2010')!, 'TI'), 'A Chapter on China', 'the title as written — never sentence-cased');
  assert.ok(!existsSync(join(exportDir, 'CITATIONS.dry-run.ris')));
});
