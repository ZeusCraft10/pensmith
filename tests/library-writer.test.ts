// tests/library-writer.test.ts — BRDTH-01 / D-17-43: LIBRARY.json has one
// schema (v2) and one validated writer (bin/lib/library.ts upsertSources).
//
// Covers:
//   - the v1 → v2 migration of BOTH v1 shapes (the strict foundation entry and
//     the research-written SourceCandidate entry that lacked addedAt — T-1-9),
//     with write-back through loadLibrary;
//   - dedup by doi.ts-normalized DOI, then arXiv id / PMID / ISBN;
//   - merge: richer metadata wins, provenance tags are unioned, `retracted` is
//     sticky, `last_verified` keeps the latest time;
//   - preprint ↔ version-of-record collapse (SSRN, Research Square, arXiv),
//     the record's DOI primary and the preprint DOI kept as a candidate only;
//     two distinct version-of-record DOIs never collapse;
//   - citekeys: an existing key never changes; a new work gets a unique key;
//   - CITATIONS.bib / CITATIONS.ris are rendered from LIBRARY.json, and a
//     bib-only key (older papers, hand edits) is imported, never dropped;
//   - 5 concurrent upserts (in one process and across 5 processes) lose nothing;
//   - the real user path: `research --yolo` (built CLI) writes a v2 library that
//     paper://library (built MCP server) returns, and a re-run adds no duplicate.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  upsertSources,
  loadLibrary,
  recordLastVerified,
  libraryPaths,
  type LibraryCandidate,
} from '../bin/lib/library.js';
import { tryAcquire } from '../bin/lib/lock.js';
import { pensmithLockDir } from '../bin/lib/paths.js';
import { Schema as LibrarySchema } from '../bin/lib/schemas/library.js';
import { migrate } from '../bin/lib/migrations/library/v1_to_v2.js';
import { migrate as migrateV2toV3 } from '../bin/lib/migrations/library/v2_to_v3.js';
import { CURRENT_LIBRARY_VERSION } from '../bin/lib/schemas/library.js';
import { isPreprintDoi } from '../bin/lib/migrations/library/shape.js';
import { parseBib } from '../bin/lib/citations.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-libwriter-'));
  fs.mkdirSync(path.join(root, '.paper'), { recursive: true });
  return root;
}

function cand(over: Partial<LibraryCandidate> & { title: string }): LibraryCandidate {
  return {
    source: 'crossref',
    authors: ['Engel, Gregory S.'],
    year: 2007,
    retracted: false,
    last_verified: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const ENGEL = cand({
  citekey: 'engel2007',
  id: '10.1038/nature05678',
  doi: '10.1038/nature05678',
  title: 'Evidence for wavelike energy transfer through quantum coherence in photosynthetic systems',
});

// ---------------------------------------------------------------------------
// Migration.
// ---------------------------------------------------------------------------

test('BRDTH-01 migration: the research-written v1 shape (SourceCandidate[], no addedAt) becomes a valid v2 library', () => {
  const v1 = {
    $schemaVersion: 1,
    entries: [
      {
        source: 'openalex',
        id: '10.48550/arXiv.1706.03762',
        doi: '10.48550/arXiv.1706.03762',
        title: 'Attention Is All You Need',
        authors: ['Vaswani, Ashish', 'Shazeer, Noam'],
        year: 2017,
        abstract: 'The dominant sequence transduction models…',
        oa_pdf_url: 'https://arxiv.org/pdf/1706.03762',
        retracted: false,
        last_verified: '2026-02-03T04:05:06.000Z',
        citekey: 'vaswani2017',
        raw: { huge: 'adapter payload' },
      },
      {
        source: 'pubmed',
        id: '34265844',
        title: 'Highly accurate protein structure prediction with AlphaFold',
        authors: ['Jumper, John'],
        year: 2021,
        retracted: true,
        retraction_details: 'test flag',
        last_verified: '2026-02-03T04:05:06.000Z',
        citekey: 'jumper2021',
        raw: {},
      },
    ],
  };
  const v2 = migrate(v1, '2026-09-27T00:00:00.000Z') as { $schemaVersion: number };
  assert.equal(v2.$schemaVersion, 2, 'the v1 → v2 step yields v2');
  // Phase 19 seam S-B: the loader chains v2 → v3; the current schema is v3.
  const lib = LibrarySchema.parse(migrateV2toV3(v2));
  assert.equal(lib.$schemaVersion, CURRENT_LIBRARY_VERSION);
  const [a, b] = lib.entries;
  assert.equal(a!.citekey, 'vaswani2017');
  assert.equal(a!.doi, '10.48550/arxiv.1706.03762', 'DOI normalized (lowercase)');
  assert.equal(a!.arxiv, '1706.03762', 'a DataCite arXiv DOI also records the arXiv id');
  assert.equal(a!.oa_url, 'https://arxiv.org/pdf/1706.03762', 'oa_pdf_url → oa_url');
  assert.equal(a!.addedAt, '2026-02-03T04:05:06.000Z', 'missing addedAt ← last_verified');
  assert.deepEqual(a!.provenance, ['research:openalex']);
  assert.ok(!('raw' in a!), 'the adapter payload is dropped');
  assert.equal(b!.pmid, '34265844', 'a PubMed id becomes pmid');
  assert.equal(b!.doi, null);
  assert.equal(b!.retracted, true);
  assert.equal(b!.retraction_details, 'test flag');
});

test('BRDTH-01 migration: the strict v1 foundation shape migrates; duplicate keys are suffixed, nothing is dropped; v2 input is unchanged', () => {
  const v1 = {
    $schemaVersion: 1,
    entries: [
      { id: 'cite-1', doi: 'https://doi.org/10.5555/ABC', title: 'One', addedAt: '2099-01-01T00:00:00.000Z' },
      { id: 'cite-1', pmid: '123', addedAt: '2099-01-02T00:00:00.000Z' },
    ],
  };
  const v2 = migrate(v1, '2026-09-27T00:00:00.000Z');
  const lib = LibrarySchema.parse(migrateV2toV3(v2));
  assert.deepEqual(lib.entries.map((e) => e.citekey), ['cite-1', 'cite-1a']);
  assert.equal(lib.entries[0]!.doi, '10.5555/abc');
  assert.equal(lib.entries[0]!.addedAt, '2099-01-01T00:00:00.000Z');
  assert.deepEqual(lib.entries[1]!.provenance, ['v1']);
  assert.equal(lib.entries[1]!.title, null);
  assert.deepEqual(migrate(v2), v2, 'idempotent on v2');
});

test('BRDTH-01 migration: loadLibrary migrates a research-written v1 file and writes the current-version file back', async () => {
  const root = project();
  const file = path.join(root, '.paper', 'LIBRARY.json');
  fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 1, entries: [{ ...ENGEL, citekey: 'engel2007', raw: {} }] }, null, 2));
  const lib = await loadLibrary(root);
  assert.equal(lib.entries.length, 1);
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8')) as { $schemaVersion: number; entries: Array<Record<string, unknown>> };
  assert.equal(onDisk.$schemaVersion, CURRENT_LIBRARY_VERSION, 'the migrated file is written back (v1 → v2 → v3)');
  assert.ok(typeof onDisk.entries[0]!['addedAt'] === 'string');
  LibrarySchema.parse(onDisk);
});

// ---------------------------------------------------------------------------
// Dedup + merge.
// ---------------------------------------------------------------------------

test('BRDTH-01 dedup: a DOI in URL / doi: / upper-case form matches the stored entry; its citekey never changes', async () => {
  const root = project();
  await upsertSources(root, [ENGEL], { provenance: 'research' });
  for (const doi of ['https://doi.org/10.1038/NATURE05678', 'doi:10.1038/nature05678', '10.1038/Nature05678']) {
    const r = await upsertSources(root, [cand({ citekey: 'engel2007b', doi, title: 'x', authors: ['Other, A.'], year: 1999 })], { provenance: 'add' });
    assert.equal(r.outcomes[0]!.citekey, 'engel2007', `${doi} is the same work`);
    assert.notEqual(r.outcomes[0]!.status, 'added');
    assert.equal(r.outcomes[0]!.matchedBy, 'doi');
  }
  const lib = await loadLibrary(root);
  assert.equal(lib.entries.length, 1, 'no duplicate entry (RM-13: add used to create engel2009a)');
  assert.equal(lib.entries[0]!.title, ENGEL.title, 'an existing title is not replaced by a poorer record');
});

test('BRDTH-01 dedup: a chapter carries its book\'s ISBN but is a different work — never merged by ISBN', async () => {
  const root = project();
  await upsertSources(
    root,
    [
      cand({
        doi: '10.1093/0199242380.003.0011',
        type: 'chapter',
        isbn: '9780199291922',
        title: 'Reparations for historical injustice',
        authors: ['Colonomos, Ariel'],
        year: 2006,
        venue: 'The Handbook of Reparations',
      }),
    ],
    { provenance: 'research' },
  );
  const book = await upsertSources(
    root,
    [cand({ source: 'books', isbn: '9780199291922', type: 'book', title: 'The Handbook of Reparations', authors: ['De Greiff, Pablo'], year: 2006 })],
    { provenance: 'research' },
  );
  assert.equal(book.outcomes[0]!.status, 'added', 'the book is its own entry');
  const lib = await loadLibrary(root);
  assert.equal(lib.entries.length, 2);
  const chapter = lib.entries.find((e) => e.type === 'chapter')!;
  assert.equal(chapter.title, 'Reparations for historical injustice', 'the chapter keeps its own title');
  assert.deepEqual(chapter.provenance, ['research:crossref']);
  // The same book again merges with the book, not the chapter.
  const again = await upsertSources(root, [cand({ source: 'books', isbn: '978-0-19-929192-2', type: 'book', title: 'The Handbook of Reparations', authors: ['De Greiff, P.'], year: 2006 })], { provenance: 'add' });
  assert.deepEqual([again.outcomes[0]!.status === 'added', again.outcomes[0]!.matchedBy], [false, 'isbn']);
  assert.equal((await loadLibrary(root)).entries.length, 2);
});

test('BRDTH-01 dedup: arXiv id (abs URL, versioned, DataCite DOI), PMID and ISBN-10 vs ISBN-13', async () => {
  const root = project();
  const r1 = await upsertSources(
    root,
    [
      cand({ source: 'arxiv', id: '2103.00020v2', title: 'Learning Transferable Visual Models', authors: ['Radford, Alec'], year: 2021 }),
      cand({ source: 'pubmed', id: '34265844', title: 'AlphaFold', authors: ['Jumper, John'], year: 2021 }),
      cand({ isbn: '0-226-45808-3', title: 'The Structure of Scientific Revolutions', authors: ['Kuhn, Thomas'], year: 1962 }),
    ],
    { provenance: 'research' },
  );
  assert.deepEqual(r1.outcomes.map((o) => o.status), ['added', 'added', 'added']);
  const r2 = await upsertSources(
    root,
    [
      cand({ arxiv: 'https://arxiv.org/abs/2103.00020', title: 'CLIP', authors: ['Radford, A.'], year: 2021 }),
      cand({ doi: '10.48550/arXiv.2103.00020', title: 'CLIP again', authors: ['Radford, A.'], year: 2021 }),
      cand({ pmid: 'PMID:34265844', title: 'AF2', authors: ['Jumper, J.'], year: 2021 }),
      cand({ isbn: '978-0-226-45808-3', title: 'Structure', authors: ['Kuhn, T.'], year: 1962 }),
    ],
    { provenance: 'add' },
  );
  assert.deepEqual(r2.outcomes.map((o) => [o.status === 'added', o.matchedBy]), [
    [false, 'arxiv'],
    [false, 'arxiv'],
    [false, 'pmid'],
    [false, 'isbn'],
  ]);
  const lib = await loadLibrary(root);
  assert.equal(lib.entries.length, 3);
  const kuhn = lib.entries.find((e) => e.isbn !== null)!;
  assert.equal(kuhn.isbn, '9780226458083', 'ISBN-10 is stored as ISBN-13');
  const clip = lib.entries.find((e) => e.arxiv === '2103.00020')!;
  assert.equal(clip.doi, '10.48550/arxiv.2103.00020', 'the DataCite DOI fills the missing DOI');
});

test('BRDTH-01 merge: richer metadata wins, provenance is unioned, retracted is sticky, last_verified keeps the latest', async () => {
  const root = project();
  await upsertSources(root, [{ ...ENGEL, last_verified: '2026-03-01T00:00:00.000Z' }], { provenance: 'research' });
  const r = await upsertSources(
    root,
    [
      {
        ...ENGEL,
        source: 'openalex',
        abstract: 'Photosynthetic complexes are exquisitely tuned to capture solar light efficiently…',
        // The Unpaywall-confirmed PDF (open-access.ts): the only open-access
        // link the library stores (review round 2, GRND-14).
        oa_url: 'https://example.org/engel.pdf',
        authors: ['Engel, Gregory S.', 'Calhoun, Tessa R.', 'Read, Elizabeth L.'],
        venue: 'Nature',
        retracted: true,
        retraction_details: 'hypothetical flag for the merge test',
        last_verified: '2026-04-01T00:00:00.000Z',
      },
      { ...ENGEL, source: 'crossref', retracted: false, last_verified: '2025-01-01T00:00:00.000Z' },
    ],
    { provenance: 'add' },
  );
  assert.deepEqual(r.outcomes.map((o) => o.status), ['merged', 'merged']);
  const e = (await loadLibrary(root)).entries[0]!;
  assert.match(e.abstract ?? '', /Photosynthetic complexes/);
  assert.equal(e.oa_url, 'https://example.org/engel.pdf');
  assert.equal(e.authors.length, 3, 'the longer author list wins');
  // An adapter's own open-access link (OpenAlex's primary location) is not
  // what Pass 3 checks, so it never becomes oa_url (full-text.ts).
  const other = project();
  await upsertSources(other, [{ ...ENGEL, source: 'openalex', oa_pdf_url: 'https://example.org/adapter.pdf' }], { provenance: 'research' });
  assert.equal((await loadLibrary(other)).entries[0]!.oa_url, null);
  assert.equal(e.venue, 'Nature');
  assert.deepEqual(e.provenance, ['research:crossref', 'add:openalex', 'add:crossref']);
  assert.equal(e.retracted, true, 'a retraction is never un-set by a later record');
  assert.equal(e.last_verified, '2026-04-01T00:00:00.000Z', 'the latest verification time is kept');
  const again = await upsertSources(root, [{ ...ENGEL, source: 'openalex' }], { provenance: 'add' });
  assert.equal(again.outcomes[0]!.status, 'unchanged', 're-adding known metadata changes nothing');
});

// ---------------------------------------------------------------------------
// Preprint ↔ version of record.
// ---------------------------------------------------------------------------

const VOR = cand({
  citekey: 'smith2021',
  doi: '10.1016/j.jfineco.2021.05.001',
  title: 'Liquidity Risk and the Cross-Section of Expected Returns: New Evidence',
  authors: ['Smith, Jane', 'Doe, John'],
  year: 2021,
  venue: 'Journal of Financial Economics',
});
const SSRN = cand({
  source: 'semanticscholar',
  citekey: 'smith2020',
  doi: '10.2139/ssrn.3456789',
  title: 'Liquidity risk and the cross-section of expected returns — new evidence',
  authors: ['Smith, J.'],
  year: 2020,
  venue: 'SSRN Electronic Journal',
  abstract: 'We revisit liquidity risk using a new decomposition of trading costs across forty years of data.',
});

test('BRDTH-01 collapse: an SSRN preprint then its version of record → one entry, the record DOI primary, the SSRN DOI an alternate', async () => {
  const root = project();
  await upsertSources(root, [SSRN], { provenance: 'research' });
  const r = await upsertSources(root, [VOR], { provenance: 'add' });
  assert.equal(r.outcomes[0]!.status, 'merged');
  assert.equal(r.outcomes[0]!.matchedBy, 'version');
  assert.equal(r.outcomes[0]!.citekey, 'smith2020', 'the existing key is kept (drafts may cite it)');
  const lib = await loadLibrary(root);
  assert.equal(lib.entries.length, 1);
  const e = lib.entries[0]!;
  assert.equal(e.doi, '10.1016/j.jfineco.2021.05.001', 'the version of record wins the primary DOI');
  assert.deepEqual(e.alternate_dois, ['10.2139/ssrn.3456789'], 'the preprint DOI is kept as a candidate only');
  assert.equal(e.year, 2021, "the record's year");
  assert.equal(e.venue, 'Journal of Financial Economics', "the record's venue");
  assert.equal(e.title, VOR.title, "the record's title");
  assert.match(e.abstract ?? '', /forty years/, 'the richer abstract survives the collapse');
  assert.deepEqual(e.provenance, ['research:semanticscholar', 'add:crossref'], 'both provenance tags');
  // The rendered bib cites the version of record.
  const bib = fs.readFileSync(path.join(root, '.paper', 'CITATIONS.bib'), 'utf8');
  assert.match(bib, /10\.1016\/j\.jfineco\.2021\.05\.001/);
  assert.doesNotMatch(bib, /ssrn/i);
});

test('review round 1: an arXiv record carrying the journal DOI is stored as the preprint (arXiv id, the DOI an alternate); the version of record then merges in and wins', async () => {
  const root = project();
  // arXiv's record of Righi & Biondi: the preprint's author order, arxiv:doi = the journal's DOI.
  const preprint = cand({
    source: 'arxiv',
    id: 'http://arxiv.org/abs/1903.00001v2',
    arxiv: '1903.00001',
    doi: '10.1016/j.example.2019.07.001',
    citekey: 'righi2019',
    title: 'Measuring the Unmeasured: a preprint title',
    authors: ['Righi, Anna', 'Biondi, Bruno'],
    year: 2019,
    type: 'preprint',
    abstract: 'The preprint abstract, which is long enough to win the merge.',
  });
  await upsertSources(root, [preprint], { provenance: 'research' });
  let e = (await loadLibrary(root)).entries[0]!;
  assert.equal(e.doi, null, 'the journal DOI is not paired with the preprint metadata');
  assert.deepEqual(e.alternate_dois, ['10.1016/j.example.2019.07.001'], 'kept as a candidate only (VRFY-14)');
  assert.equal(e.arxiv, '1903.00001', 'identified by its arXiv id (Pass 1 re-fetches it at arXiv)');
  const bib1 = fs.readFileSync(path.join(root, '.paper', 'CITATIONS.bib'), 'utf8');
  assert.match(bib1, /eprint = \{1903\.00001\}/);
  assert.doesNotMatch(bib1, /doi = /, 'the bib cites the preprint, not the journal DOI');

  // The version of record arrives (Crossref, the published author order): one entry, its DOI and metadata win.
  const record = cand({
    source: 'crossref',
    id: '10.1016/j.example.2019.07.001',
    doi: '10.1016/j.example.2019.07.001',
    citekey: 'biondi2019',
    title: 'Measuring the unmeasured',
    authors: ['Biondi, Bruno', 'Righi, Anna'],
    year: 2019,
    venue: 'Journal of Examples',
    type: 'article-journal',
  });
  const r = await upsertSources(root, [record], { provenance: 'add' });
  assert.equal(r.outcomes[0]!.status, 'merged');
  assert.equal(r.outcomes[0]!.citekey, 'righi2019', 'the existing key is kept');
  const lib = await loadLibrary(root);
  assert.equal(lib.entries.length, 1);
  e = lib.entries[0]!;
  assert.equal(e.doi, '10.1016/j.example.2019.07.001', 'the version of record wins the primary DOI');
  assert.deepEqual(e.alternate_dois, []);
  assert.equal(e.title, 'Measuring the unmeasured', "the record's title");
  assert.deepEqual(e.authors, ['Biondi, Bruno', 'Righi, Anna'], "the record's author order");
  assert.equal(e.arxiv, '1903.00001', 'the arXiv id is kept');
});

test('BRDTH-01 collapse: version of record first, then Research Square / arXiv versions fold into it', async () => {
  const root = project();
  await upsertSources(root, [VOR], { provenance: 'research' });
  const r = await upsertSources(
    root,
    [
      { ...SSRN, doi: '10.21203/rs.3.rs-123456/v1', source: 'crossref' },
      cand({ source: 'arxiv', id: '2012.34567', title: VOR.title!, authors: ['Jane Smith'], year: 2020 }),
    ],
    { provenance: 'research' },
  );
  assert.deepEqual(r.outcomes.map((o) => o.citekey), ['smith2021', 'smith2021']);
  const e = (await loadLibrary(root)).entries;
  assert.equal(e.length, 1);
  assert.equal(e[0]!.doi, VOR.doi);
  assert.deepEqual(e[0]!.alternate_dois, ['10.21203/rs.3.rs-123456/v1']);
  assert.equal(e[0]!.arxiv, '2012.34567', 'the arXiv id is recorded on the one entry');
  assert.equal(e[0]!.year, 2021);
});

test('BRDTH-01 collapse boundaries: distinct version-of-record DOIs, another first author, or years 2 apart stay separate', async () => {
  const root = project();
  const editorial = (doi: string, year: number): LibraryCandidate =>
    cand({ doi, title: 'Editorial: The Year in Review', authors: ['Editor, Chief'], year });
  const r = await upsertSources(
    root,
    [
      editorial('10.1111/jae.2020.001', 2020),
      editorial('10.1111/jae.2021.001', 2021), // both versions of record → distinct works
      { ...SSRN, authors: ['Jones, Mary'], doi: '10.2139/ssrn.1111111' }, // same title, another first author
      { ...SSRN, year: 2018, doi: '10.2139/ssrn.2222222' }, // years 3 apart from the record below
      VOR,
    ],
    { provenance: 'research' },
  );
  assert.deepEqual(r.outcomes.map((o) => o.status), ['added', 'added', 'added', 'added', 'added']);
  assert.equal(new Set(r.outcomes.map((o) => o.citekey)).size, 5, 'five distinct keys');
});

test('BRDTH-01: the preprint-server DOI table (SSRN, Research Square, arXiv, bioRxiv — not CSHL journals)', () => {
  assert.equal(isPreprintDoi('10.2139/ssrn.3456789'), true);
  assert.equal(isPreprintDoi('10.21203/rs.3.rs-123456/v1'), true);
  assert.equal(isPreprintDoi('10.48550/arxiv.1706.03762'), true);
  assert.equal(isPreprintDoi('10.1101/2020.03.21.001234'), true);
  assert.equal(isPreprintDoi('10.1101/gad.123456.115'), false, 'Genes & Development shares the 10.1101 registrant');
  assert.equal(isPreprintDoi('10.1038/nature05678'), false);
  assert.equal(isPreprintDoi(null), false);
});

// ---------------------------------------------------------------------------
// Citekeys and the rendered files.
// ---------------------------------------------------------------------------

test('BRDTH-01 citekeys: a different work with a colliding base key gets a unique suffixed key', async () => {
  const root = project();
  await upsertSources(root, [ENGEL], { provenance: 'research' });
  const other = cand({ citekey: 'engel2007', doi: '10.1063/1.2800560', title: 'A completely different 2007 paper', authors: ['Engel, Gregory S.'] });
  const r = await upsertSources(root, [other], { provenance: 'research' });
  assert.equal(r.outcomes[0]!.status, 'added');
  assert.equal(r.outcomes[0]!.citekey, 'engel2007a');
  const keys = (await loadLibrary(root)).entries.map((e) => e.citekey);
  assert.deepEqual(keys, ['engel2007', 'engel2007a']);
});

test('BRDTH-01: CITATIONS.bib and CITATIONS.ris are rendered from LIBRARY.json (same keys, same identifiers)', async () => {
  const root = project();
  await upsertSources(root, [ENGEL, VOR, cand({ source: 'openalex', id: 'W123', title: 'No identifier at all' })], { provenance: 'research' });
  const lib = await loadLibrary(root);
  assert.equal(lib.entries.length, 3, 'an identifier-less source stays in LIBRARY.json');
  const bibText = fs.readFileSync(path.join(root, '.paper', 'CITATIONS.bib'), 'utf8');
  const bib = await parseBib(bibText);
  const bibKeys = bib.map((e) => String(e['id'])).sort();
  assert.deepEqual(bibKeys, ['engel2007', 'smith2021'], 'the bib holds every citable (identified) library entry');
  const ris = fs.readFileSync(path.join(root, '.paper', 'CITATIONS.ris'), 'utf8');
  assert.equal((ris.match(/^TY {2}- /gm) ?? []).length, 2);
  assert.match(ris, /10\.1038\/nature05678/);
});

test('BRDTH-01: a bib-only key (pre-BRDTH-01 add, or a hand edit) is imported, never dropped — even a legacy duplicate', async () => {
  const root = project();
  await upsertSources(root, [ENGEL], { provenance: 'research' });
  const bibPath = path.join(root, '.paper', 'CITATIONS.bib');
  const rendered = fs.readFileSync(bibPath, 'utf8');
  fs.writeFileSync(
    bibPath,
    rendered +
      '\n@article{engel2007a,\n  title = {Evidence for wavelike energy transfer through quantum coherence in photosynthetic systems},\n  author = {Engel, Gregory S.},\n  year = {2007},\n  doi = {10.1038/nature05678}\n}\n' +
      '\n@book{Kuhn1962,\n  title = {The Structure of Scientific Revolutions},\n  author = {Kuhn, Thomas},\n  year = {1962},\n  isbn = {9780226458083}\n}\n',
  );
  const r = await upsertSources(root, [], { provenance: 'research' });
  assert.deepEqual(r.imported.sort(), ['Kuhn1962', 'engel2007a']);
  const lib = await loadLibrary(root);
  const kuhn = lib.entries.find((e) => e.citekey === 'Kuhn1962')!;
  assert.deepEqual(kuhn.provenance, ['bib-import'], 'a hand-made key keeps its spelling');
  assert.equal(kuhn.isbn, '9780226458083');
  const keys = (await parseBib(fs.readFileSync(bibPath, 'utf8'))).map((e) => String(e['id'])).sort();
  assert.deepEqual(keys, ['Kuhn1962', 'engel2007', 'engel2007a'], 'every key a draft may cite is still in the bib');
});

test('BRDTH-01: an unparseable CITATIONS.bib is kept as a backup, then re-rendered from LIBRARY.json', async () => {
  const root = project();
  await upsertSources(root, [ENGEL], { provenance: 'research' });
  const bibPath = path.join(root, '.paper', 'CITATIONS.bib');
  fs.writeFileSync(bibPath, '@article{broken2020,\n  title = {Unclosed\n');
  await upsertSources(root, [VOR], { provenance: 'add' });
  const backups = fs.readdirSync(path.join(root, '.paper')).filter((f) => f.startsWith('CITATIONS.bib.unparsed-'));
  assert.equal(backups.length, 1, 'the unreadable bib is preserved');
  assert.match(fs.readFileSync(path.join(root, '.paper', backups[0]!), 'utf8'), /broken2020/);
  const keys = (await parseBib(fs.readFileSync(bibPath, 'utf8'))).map((e) => String(e['id'])).sort();
  assert.deepEqual(keys, ['engel2007', 'smith2021']);
});

test('BRDTH-01: Cyrillic, Greek, CJK and Arabic authors and titles render a CITATIONS.bib that parses back to the same names', async () => {
  const root = project();
  const names: Array<[string, string, string]> = [
    ['esenamanov2025', 'Эсенаманов, Байэл', 'Исследование квантовой когерентности'],
    ['papadopoulos2024', 'Παπαδόπουλος, Γιώργος', 'Κβαντική συνοχή στη φωτοσύνθεση'],
    ['tanaka2023', '田中, 太郎', '光合成における量子コヒーレンス'],
    ['li2022', '李, 明', '光合作用中的量子相干'],
    ['muhammad2021', 'محمد, علي', 'التماسك الكمومي في التمثيل الضوئي'],
    ['muller2020', 'Müller, Jürgen', 'Kohärenz & Energie: 50% {mehr} Effizienz'],
  ];
  const cands = names.map(([citekey, author, title], i) =>
    cand({ citekey, authors: [author], title, doi: `10.5555/nonlatin.${i}`, year: 2020 + i }),
  );
  await upsertSources(root, cands, { provenance: 'research' });
  const bibText = fs.readFileSync(path.join(root, '.paper', 'CITATIONS.bib'), 'utf8');
  const parsed = await parseBib(bibText);
  const byKey = new Map(parsed.map((e) => [String(e['id']), e as { title?: string; author?: Array<{ family?: string; given?: string }> }]));
  for (const [citekey, author, title] of names) {
    const e = byKey.get(citekey);
    assert.ok(e, `${citekey} is in the rendered bib`);
    const [family, given] = author.split(', ');
    assert.equal(e.author?.[0]?.family, family, `${citekey}: first-author family name survives (Pass 1 matches on it)`);
    assert.equal(e.author?.[0]?.given, given, `${citekey}: given name survives`);
    assert.equal(e.title, title, `${citekey}: title survives`);
  }
  // Latin-script entries keep the LaTeX-escaped form BibTeX users expect.
  assert.doesNotMatch(bibText, /author = \{, \}/, 'no empty author is ever rendered');
});

test('SRC-12: a bib-only entry is imported with its eprint, abstract, editors and bibliographic fields, then re-rendered whole', async () => {
  const root = project();
  await upsertSources(root, [ENGEL], { provenance: 'research' });
  const bibPath = path.join(root, '.paper', 'CITATIONS.bib');
  fs.appendFileSync(
    bibPath,
    [
      '',
      '@incollection{handmade2019,',
      '  author = {{van der Maaten}, Laurens and King, Jr., Martin Luther},',
      '  editor = {Editor, Eve},',
      '  title = {A hand-made chapter},',
      '  booktitle = {The Handbook},',
      '  publisher = {Pub House},',
      '  pages = {10--20},',
      '  year = {2019},',
      '  eprint = {1906.00001},',
      '  archivePrefix = {arXiv},',
      '  abstract = {An abstract \\& more.},',
      '}',
      '',
    ].join('\n'),
  );
  await upsertSources(root, [cand({ citekey: 'x2020', doi: '10.5555/lib.x', title: 'Trigger a render', year: 2020 })], { provenance: 'research' });
  const e = (await loadLibrary(root)).entries.find((x) => x.citekey === 'handmade2019')!;
  assert.deepEqual(e.provenance, ['bib-import']);
  assert.equal(e.arxiv, '1906.00001', 'the eprint is the arXiv id');
  assert.equal(e.abstract, 'An abstract & more.');
  assert.deepEqual(e.authors, ['van der Maaten, Laurens', 'King, Martin Luther, Jr.']);
  assert.deepEqual(e.editors, ['Editor, Eve']);
  assert.equal(e.type, 'chapter');
  assert.equal(e.venue, 'The Handbook');
  assert.equal(e.pages, '10-20');
  const rendered = fs.readFileSync(bibPath, 'utf8');
  assert.match(rendered, /@incollection\{handmade2019,[\s\S]*booktitle = \{The Handbook\}[\s\S]*eprint = \{1906\.00001\}[\s\S]*abstract = \{An abstract \\& more\.\}/);
});

test('BRDTH-01: verify on an unparseable CITATIONS.bib is one classified line (no stack hint), never "no citations"', () => {
  const root = project();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-libwriter-data-'));
  const sec = path.join(root, '.paper', 'sections', '01-intro');
  fs.mkdirSync(sec, { recursive: true });
  fs.writeFileSync(path.join(root, '.paper', 'STATE.json'), JSON.stringify({ $schemaVersion: 2, paperId: 'badbib', createdAt: new Date().toISOString(), sections: [{ n: 1, slug: 'intro' }] }));
  fs.writeFileSync(path.join(root, '.paper', 'CITATIONS.bib'), '@article{bad2025,\n\tauthor = {,{\\u  }},\n\tdoi = {10.1/x},\n}\n');
  fs.writeFileSync(path.join(sec, 'PLAN.md'), ['---', 'section: 1', 'slug: intro', 'title: Introduction', 'depends_on: []', 'assigned_sources: [bad2025]', 'status: written', '---', ''].join('\n'));
  fs.writeFileSync(path.join(sec, 'DRAFT.md'), '# Introduction\n\nA claim [@bad2025].\n');
  fs.writeFileSync(path.join(root, '.paper', 'OUTLINE.md'), ['# Outline', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |', '| 1 | intro | Introduction | | 300 | bad2025 |', ''].join('\n'));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  Object.assign(env, { XDG_DATA_HOME: data, LOCALAPPDATA: data, HOME: data, USERPROFILE: data, PENSMITH_OFFLINE: '1', PENSMITH_NO_LLM: '1' });
  delete env['PENSMITH_DEBUG'];
  const r = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path.join(REPO, 'bin', 'pensmith.ts'), 'verify', '1', '--yolo'], {
    cwd: root, env, encoding: 'utf8', timeout: 120_000,
  });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /CITATIONS\.bib is not valid BibTeX/);
  assert.doesNotMatch(r.stderr, /PENSMITH_DEBUG/, 'a bad bib is a classified error, not an internal one');
});

test('BRDTH-01: recordLastVerified keeps the latest time per citekey through the same writer', async () => {
  const root = project();
  await upsertSources(root, [ENGEL], { provenance: 'research' });
  const r = await recordLastVerified(root, { engel2007: '2026-09-01T12:00:00.000Z', nosuch2020: '2026-09-01T12:00:00.000Z' });
  assert.deepEqual(r, { updated: ['engel2007'], unknown: ['nosuch2020'] });
  const older = await recordLastVerified(root, { engel2007: '2020-01-01T00:00:00.000Z' });
  assert.deepEqual(older.updated, [], 'an older time never replaces a newer one');
  assert.equal((await loadLibrary(root)).entries[0]!.last_verified, '2026-09-01T12:00:00.000Z');
});

// ---------------------------------------------------------------------------
// Concurrency.
// ---------------------------------------------------------------------------

test('BRDTH-01: 5 concurrent upserts in one process lose no update (disjoint adds + a shared work)', async () => {
  const root = project();
  await upsertSources(root, [ENGEL], { provenance: 'research' });
  await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      upsertSources(
        root,
        [
          cand({ doi: `10.5555/concurrent.${i}`, title: `Concurrent work ${i}`, authors: [`Writer${String.fromCharCode(97 + i)}, A.`], year: 2010 + i }),
          { ...ENGEL, source: `worker${i}` },
        ],
        { provenance: `p${i}` },
      ),
    ),
  );
  const lib = await loadLibrary(root);
  assert.equal(lib.entries.length, 6);
  const engel = lib.entries.find((e) => e.citekey === 'engel2007')!;
  for (let i = 0; i < 5; i += 1) assert.ok(engel.provenance.includes(`p${i}:worker${i}`), `provenance of upsert ${i} kept`);
});

test('BRDTH-01: 5 concurrent upserts from 5 processes lose no update', async () => {
  const root = project();
  // Resolve the data dir BEFORE spawning, so a single-test run's per-process
  // test data dir (CI-09) is exported to the workers and all five share ONE
  // lock directory — without it each worker locks in a private dir of its own.
  void pensmithLockDir();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-libwriter-worker-'));
  const worker = path.join(dir, 'worker.mts');
  fs.writeFileSync(
    worker,
    [
      `import { upsertSources } from ${JSON.stringify(pathToFileURL(path.join(REPO, 'bin', 'lib', 'library.ts')).href)};`,
      `const i = Number(process.argv[2]);`,
      `const root = process.argv[3];`,
      `await upsertSources(root, [`,
      `  { source: 'crossref', doi: '10.5555/proc.' + i, title: 'Process work ' + i, authors: ['Proc' + String.fromCharCode(97 + i) + ', A.'], year: 2000 + i },`,
      `  { source: 'crossref', doi: '10.1038/nature05678', title: 'Shared', authors: ['Engel, G.'], year: 2007, abstract: 'abstract from process ' + i + ' '.repeat(i) },`,
      `], { provenance: 'proc' + i });`,
      `console.log('ok ' + i);`,
    ].join('\n'),
  );
  const runs = await Promise.all(
    Array.from(
      { length: 5 },
      (_, i) =>
        new Promise<{ code: number | null; out: string }>((resolve) => {
          const child = spawn(process.execPath, ['--import', 'tsx', worker, String(i), root], {
            cwd: REPO,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          let out = '';
          child.stdout.on('data', (d: Buffer) => (out += d.toString()));
          child.stderr.on('data', (d: Buffer) => (out += d.toString()));
          child.on('close', (code) => resolve({ code, out }));
        }),
    ),
  );
  for (const r of runs) assert.equal(r.code, 0, r.out);
  const lib = await loadLibrary(root);
  assert.equal(lib.entries.length, 6, `5 distinct works + 1 shared: ${lib.entries.map((e) => e.citekey).join(', ')}`);
  const shared = lib.entries.find((e) => e.doi === '10.1038/nature05678')!;
  assert.deepEqual([...shared.provenance].sort(), ['proc0:crossref', 'proc1:crossref', 'proc2:crossref', 'proc3:crossref', 'proc4:crossref']);
  LibrarySchema.parse(JSON.parse(fs.readFileSync(libraryPaths(root).library, 'utf8')));
});

test('BRDTH-01: an upsert from another process waits for the holder that created LIBRARY.json (paper folder reached through a symlink)', async () => {
  // CI run 62 (windows-latest) lost one of the five cross-process upserts
  // above: the temp dir is spelled C:\Users\RUNNER~1\… (an 8.3 short name,
  // macOS has /var → /private/var), and the lock on a LIBRARY.json that did
  // not exist yet was keyed on that spelling while a process arriving after
  // the file appeared keyed its realpath — two locks for one file. Here the
  // first upsert's critical section is played by this process on a symlinked
  // (junction on Windows) spelling, deterministically: it takes the lock
  // before LIBRARY.json exists, creates it, lets another process start its
  // upsert, and writes its own result last. The other process must wait.
  const real = project();
  const link = `${real}-link`;
  fs.symlinkSync(real, link, 'junction');
  // The two library states the holder writes, rendered by the one writer in a scratch paper.
  const scratch = project();
  await upsertSources(scratch, [ENGEL], { provenance: 'research' });
  const created = fs.readFileSync(libraryPaths(scratch).library, 'utf8');
  await upsertSources(scratch, [cand({ doi: '10.5555/holder.1', title: 'Holder work', authors: ['Holder, A.'], year: 2001 })], { provenance: 'holder' });
  const holderResult = fs.readFileSync(libraryPaths(scratch).library, 'utf8');
  const expected = (JSON.parse(holderResult) as { entries: Array<{ citekey: string }> }).entries.map((e) => e.citekey);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-libwriter-worker-'));
  const worker = path.join(dir, 'worker.mts');
  fs.writeFileSync(
    worker,
    [
      `import { upsertSources } from ${JSON.stringify(pathToFileURL(path.join(REPO, 'bin', 'lib', 'library.ts')).href)};`,
      `console.log('READY');`,
      `const r = await upsertSources(process.argv[2], [`,
      `  { source: 'crossref', doi: '10.5555/other.1', title: 'Other process work', authors: ['Other, B.'], year: 2002 },`,
      `], { provenance: 'other' });`,
      `console.log('ADDED ' + r.outcomes.map((o) => o.citekey).join(','));`,
    ].join('\n'),
  );

  const release = await tryAcquire(libraryPaths(link).library); // held before LIBRARY.json exists
  let done!: Promise<{ code: number | null; out: string }>;
  try {
    fs.writeFileSync(libraryPaths(link).library, created);
    const child = spawn(process.execPath, ['--import', 'tsx', worker, link], { cwd: REPO, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let ready!: () => void;
    const readySeen = new Promise<void>((resolve) => (ready = resolve));
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString();
      if (out.includes('READY')) ready();
    });
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    done = new Promise((resolve) => child.on('close', (code) => resolve({ code, out })));
    // Give the other process time to finish an upsert it should NOT be able to start.
    await Promise.race([done, readySeen.then(() => new Promise((r) => setTimeout(r, 1500)))]);
    fs.writeFileSync(libraryPaths(link).library, holderResult);
  } finally {
    await release();
  }
  const r = await done;
  assert.equal(r.code, 0, r.out);
  const added = /ADDED (\S+)/.exec(r.out)?.[1];
  assert.ok(added, r.out);
  const lib = await loadLibrary(real);
  assert.deepEqual(
    lib.entries.map((e) => e.citekey).sort(),
    [...expected, added].sort(),
    "the other process's upsert ran after the holder's write, not beside it",
  );
});

// ---------------------------------------------------------------------------
// The real user path: research (built CLI) → LIBRARY.json v2 → paper://library.
// ---------------------------------------------------------------------------

const DIST_CLI = path.join(REPO, 'dist', 'bin', 'pensmith.js');
const DIST_MCP = path.join(REPO, 'dist', 'mcp', 'server.js');

async function readPaperLibraryOverMcp(cwd: string): Promise<{ entries: Array<{ citekey: string }>; $schemaVersion: number }> {
  const env = { ...process.env };
  delete env['PENSMITH_PAPER_ROOT'];
  const child = spawn(process.execPath, [DIST_MCP], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  child.stdout.on('data', (d: Buffer) => (buf += d.toString()));
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
  const send = (msg: unknown): void => {
    child.stdin.write(JSON.stringify(msg) + '\n');
  };
  const waitFor = async (id: number): Promise<Record<string, unknown>> => {
    const t0 = Date.now();
    for (;;) {
      for (const line of buf.split('\n')) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line) as { id?: number };
        if (msg.id === id) return msg as Record<string, unknown>;
      }
      if (Date.now() - t0 > 30_000 || child.exitCode !== null) throw new Error(`no MCP response ${id}; stderr=${stderr}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  try {
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'libwriter-test', version: '0' } } });
    await waitFor(1);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'paper://library' } });
    const res = (await waitFor(2)) as { result?: { contents?: Array<{ text?: string }> }; error?: unknown };
    assert.ok(res.result, `paper://library must not error: ${JSON.stringify(res.error)}`);
    return JSON.parse(res.result.contents![0]!.text!) as { entries: Array<{ citekey: string }>; $schemaVersion: number };
  } finally {
    child.kill();
  }
}

test('BRDTH-01 user path: `research --yolo` writes a current-version LIBRARY.json that paper://library returns; a re-run adds no duplicate', async () => {
  assert.ok(fs.existsSync(DIST_CLI) && fs.existsSync(DIST_MCP), 'run `npm run build` first');
  const root = project();
  fs.writeFileSync(
    path.join(root, '.paper', 'INTAKE.md'),
    '---\ntopic: attention mechanisms in neural networks\ndiscipline: computer science\n---\n# Intake\n\nWrite a 1500-word literature review on attention mechanisms in neural networks.\n',
  );
  const run = (): ReturnType<typeof spawnSync> =>
    spawnSync(process.execPath, [DIST_CLI, 'research', '--yolo'], {
      cwd: root,
      env: { ...process.env, PENSMITH_NO_LLM: '1' },
      encoding: 'utf8',
      timeout: 180_000,
    });
  const first = run();
  assert.equal(first.status, 0, `research must succeed: ${String(first.stderr).slice(-1500)}`);
  const file = libraryPaths(root).library;
  const lib = LibrarySchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.ok(lib.entries.length >= 1, `the recorded fixtures yield sources (got ${lib.entries.length})`);
  for (const e of lib.entries) {
    assert.ok(e.provenance.some((p) => p.startsWith('research')), `${e.citekey} carries a research provenance tag`);
  }
  const served = await readPaperLibraryOverMcp(root);
  assert.equal(served.$schemaVersion, CURRENT_LIBRARY_VERSION);
  assert.deepEqual(served.entries.map((e) => e.citekey), lib.entries.map((e) => e.citekey), 'paper://library returns the entries');

  const second = run();
  assert.equal(second.status, 0, String(second.stderr).slice(-1500));
  const lib2 = LibrarySchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(lib2.entries.map((e) => e.citekey), lib.entries.map((e) => e.citekey), 'a re-run never duplicates a source');
  assert.match(String(second.stdout), /0 new/);
});

test('ROADMAP Phase 19 criterion 4 (review round 2): versioned DOIs of one posted work (base, .v1, .v2) are one entry; two version-of-record editorials stay two', async () => {
  const root = project();
  const post = (doi: string): LibraryCandidate =>
    cand({ citekey: 'hokby2025', id: doi, doi, type: 'preprint', title: 'Screen time effects on adolescent mental health', authors: ['Hökby, Sebastian'], year: 2025 });
  const r = await upsertSources(root, [post('10.69622/28750280.v2'), post('10.69622/28750280.v1'), post('10.69622/28750280')], { provenance: 'research' });
  assert.deepEqual(r.outcomes.map((o) => o.status), ['added', 'merged', 'merged']);
  const lib = await loadLibrary(root);
  assert.equal(lib.entries.length, 1, 'one entry per work');
  assert.equal(lib.entries[0]!.doi, '10.69622/28750280.v2');
  assert.deepEqual([...lib.entries[0]!.alternate_dois].sort(), ['10.69622/28750280', '10.69622/28750280.v1']);

  // The version family alone is not enough: a different title under a shared base stays apart.
  const other = project();
  await upsertSources(other, [post('10.69622/1.v1'), { ...post('10.69622/1.v2'), title: 'An unrelated dataset about rainfall' }], { provenance: 'research' });
  assert.equal((await loadLibrary(other)).entries.length, 2);

  // Posted content typed `preprint` with an ordinary DOI prefix takes the version rule.
  const posted = project();
  await upsertSources(
    posted,
    [
      cand({ id: '10.5555/posted.a', doi: '10.5555/posted.a', type: 'preprint', title: 'Measuring attention in classrooms', authors: ['Rao, Q.'], year: 2024 }),
      cand({ id: '10.5555/posted.b', doi: '10.5555/posted.b', type: 'preprint', title: 'Measuring Attention in Classrooms', authors: ['Rao, Q.'], year: 2024 }),
    ],
    { provenance: 'research' },
  );
  assert.equal((await loadLibrary(posted)).entries.length, 1);
  // …and its version of record, arriving later, becomes the primary DOI.
  await upsertSources(
    posted,
    [cand({ id: '10.1234/classrooms.2024', doi: '10.1234/classrooms.2024', type: 'article-journal', title: 'Measuring attention in classrooms', authors: ['Rao, Q.'], year: 2024, venue: 'Journal of Things' })],
    { provenance: 'research' },
  );
  const merged = (await loadLibrary(posted)).entries;
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.doi, '10.1234/classrooms.2024');
  assert.deepEqual([...merged[0]!.alternate_dois].sort(), ['10.5555/posted.a', '10.5555/posted.b']);
  assert.equal(merged[0]!.type, 'article-journal');

  // Two version-of-record DOIs (annual editorials: same title, author, year) never collapse.
  const editorials = project();
  await upsertSources(
    editorials,
    [
      cand({ id: '10.5555/ed.2020a', doi: '10.5555/ed.2020a', type: 'article-journal', title: 'Editorial', authors: ['Smith, A.'], year: 2020 }),
      cand({ id: '10.5555/ed.2020b', doi: '10.5555/ed.2020b', type: 'article-journal', title: 'Editorial', authors: ['Smith, A.'], year: 2020 }),
    ],
    { provenance: 'research' },
  );
  assert.equal((await loadLibrary(editorials)).entries.length, 2);
});

test('SRC-09 (review round 2): add, bring-your-own and Zotero entries get the tier their metadata decides at upsert; an undecidable one stays unevaluated', async () => {
  const root = project();
  const r = await upsertSources(
    root,
    [
      cand({ citekey: 'lecun2015', id: '10.1038/nature14539', doi: '10.1038/nature14539', type: 'article-journal', title: 'Deep learning', authors: ['LeCun, Yann'], year: 2015 }),
      cand({ citekey: 'kuhn1996', source: 'books', id: 'isbn:9780226458083', isbn: '9780226458083', type: 'book', title: 'The Structure of Scientific Revolutions', authors: ['Kuhn, Thomas S.'], year: 1996 }),
      cand({ citekey: 'untyped2020', id: '10.5555/untyped', doi: '10.5555/untyped', title: 'An untyped record', authors: ['Doe, Jane'], year: 2020 }),
    ],
    { provenance: 'add' },
  );
  assert.deepEqual(r.outcomes.map((o) => o.status), ['added', 'added', 'added']);
  const byKey = new Map((await loadLibrary(root)).entries.map((e) => [e.citekey, e]));
  assert.equal(byKey.get('lecun2015')!.tier, 'peer-reviewed');
  assert.equal(byKey.get('kuhn1996')!.tier, 'book');
  assert.equal(byKey.get('untyped2020')!.tier, null, 'the metadata cannot decide: the evaluator will');
  // A later merge keeps an evaluator's tier where the metadata cannot decide, and the metadata's where it can.
  await upsertSources(root, [{ ...cand({ id: '10.5555/untyped', doi: '10.5555/untyped', title: 'An untyped record', authors: ['Doe, Jane'], year: 2020 }), tier: 'gov-report' }], { provenance: 'research' });
  await upsertSources(root, [{ ...cand({ id: '10.1038/nature14539', doi: '10.1038/nature14539', title: 'Deep learning', authors: ['LeCun, Yann'], year: 2015 }), tier: 'other' }], { provenance: 'research' });
  const after = new Map((await loadLibrary(root)).entries.map((e) => [e.citekey, e]));
  assert.equal(after.get('untyped2020')!.tier, 'gov-report');
  assert.equal(after.get('lecun2015')!.tier, 'peer-reviewed', 'a model never overrides the registrar');
});
