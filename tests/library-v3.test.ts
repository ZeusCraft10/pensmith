// tests/library-v3.test.ts — LIBRARY.json v3 (Phase 19 seam S-B).
//
// Covers the v2 → v3 migration (defaults, retraction status, idempotence, fail
// closed on a hand-edited retraction), the v3 entry invariants, the shaping of
// the new candidate fields (invalid values dropped, not stored), and the merge
// rules the library writer applies to them: the latest evaluation wins, a
// registrar-hydrated record replaces an unhydrated BYO entry's local metadata,
// `retracted` stays sticky while other retraction outcomes follow the newest
// lookup, and a re-pulled Zotero item merges by its item key.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  upsertSources,
  loadLibrary,
  libraryPaths,
  LIBRARY_MIGRATIONS,
  type LibraryCandidate,
} from '../bin/lib/library.js';
import { Schema as LibrarySchema, LibraryEntrySchema, CURRENT_LIBRARY_VERSION } from '../bin/lib/schemas/library.js';
import { migrate as v2ToV3 } from '../bin/lib/migrations/library/v2_to_v3.js';
import { candidateToEntry } from '../bin/lib/migrations/library/shape.js';

const NOW = '2026-09-28T00:00:00.000Z';

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-libv3-'));
  fs.mkdirSync(path.join(root, '.paper'), { recursive: true });
  return root;
}

function v2Entry(over: Record<string, unknown>): Record<string, unknown> {
  return {
    citekey: 'engel2007',
    doi: '10.1038/nature05678',
    arxiv: null,
    pmid: null,
    pmcid: null,
    isbn: null,
    title: 'Evidence for wavelike energy transfer',
    authors: ['Engel, Gregory S.'],
    year: 2007,
    venue: 'Nature',
    abstract: null,
    oa_url: null,
    alternate_dois: [],
    provenance: ['research:crossref'],
    retracted: false,
    retraction_details: null,
    synthetic: false,
    last_verified: NOW,
    byo: null,
    addedAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

test('seam S-B: the library is version 3 and registers the v2 → v3 migration', () => {
  assert.equal(CURRENT_LIBRARY_VERSION, 3);
  assert.equal(typeof LIBRARY_MIGRATIONS[1], 'function');
  assert.equal(typeof LIBRARY_MIGRATIONS[2], 'function');
});

test('seam S-B: v2 → v3 keeps every v2 value and adds the v3 defaults', () => {
  const out = v2ToV3({
    $schemaVersion: 2,
    entries: [v2Entry({}), v2Entry({ citekey: 'wakefield1998', doi: '10.1016/s0140-6736(97)11096-0', retracted: true, retraction_details: 'Retraction' })],
  }) as { $schemaVersion: number; entries: Array<Record<string, unknown>> };
  assert.equal(out.$schemaVersion, 3);
  const [engel, wakefield] = out.entries as [Record<string, unknown>, Record<string, unknown>];
  assert.equal(engel['venue'], 'Nature');
  for (const k of ['type', 'publisher', 'volume', 'issue', 'pages', 'tier', 'relevance', 'why_relevant', 'zotero']) {
    assert.equal(engel[k], null, `${k} defaults to null`);
  }
  assert.deepEqual(engel['editors'], []);
  assert.equal(engel['hydrated'], true);
  assert.equal(engel['retraction_status'], 'unchecked', 'a v2 entry never claims a clean lookup');
  assert.equal(wakefield['retraction_status'], 'retracted');
  const parsed = LibrarySchema.parse(out);
  assert.equal(parsed.entries.length, 2);
});

test('seam S-B: v2 → v3 is idempotent and fails closed on a hand-edited retraction', () => {
  const v3 = v2ToV3({ $schemaVersion: 2, entries: [v2Entry({})] });
  assert.deepEqual(v2ToV3(v3), v3, 'v3 input is returned unchanged');
  const edited = v2ToV3({ $schemaVersion: 2, entries: [v2Entry({ retraction_status: 'retracted', retracted: false })] }) as {
    entries: Array<Record<string, unknown>>;
  };
  assert.equal(edited.entries[0]!['retracted'], true, 'a retraction recorded either way is recorded both ways');
  assert.equal(edited.entries[0]!['retraction_status'], 'retracted');
});

test('seam S-B: a v3 entry never has retracted and retraction_status disagreeing', () => {
  const base = v2ToV3({ $schemaVersion: 2, entries: [v2Entry({})] }) as { entries: Array<Record<string, unknown>> };
  const e = base.entries[0]!;
  assert.equal(LibraryEntrySchema.safeParse(e).success, true);
  assert.equal(LibraryEntrySchema.safeParse({ ...e, retracted: true }).success, false);
  assert.equal(LibraryEntrySchema.safeParse({ ...e, retraction_status: 'retracted' }).success, false);
  assert.equal(LibraryEntrySchema.safeParse({ ...e, retracted: true, retraction_status: 'retracted' }).success, true);
  assert.equal(LibraryEntrySchema.safeParse({ ...e, relevance: 1.5 }).success, false);
  assert.equal(LibraryEntrySchema.safeParse({ ...e, tier: 'blog' }).success, false);
  assert.equal(LibraryEntrySchema.safeParse({ ...e, zotero: { library: 'users/12', key: 'ABCD2345' } }).success, true);
  assert.equal(LibraryEntrySchema.safeParse({ ...e, zotero: { library: 'users/12', key: 'short' } }).success, false);
});

test('seam S-B: loadLibrary migrates a v2 file on disk to v3', async () => {
  const root = project();
  const file = libraryPaths(root).library;
  fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 2, entries: [v2Entry({})] }, null, 2));
  const lib = await loadLibrary(root);
  assert.equal(lib.$schemaVersion, 3);
  assert.equal(lib.entries[0]!.retraction_status, 'unchecked');
  assert.equal(lib.entries[0]!.hydrated, true);
});

test('seam S-B: candidateToEntry shapes the v3 fields and drops invalid values', () => {
  const c: LibraryCandidate = {
    citekey: 'lecun2015',
    source: 'crossref',
    doi: '10.1038/nature14539',
    title: 'Deep learning',
    authors: ['LeCun, Yann'],
    year: 2015,
    venue: 'Nature',
    type: 'article-journal',
    volume: 521,
    issue: '7553',
    pages: '436-444',
    publisher: 'Springer Science and Business Media LLC',
    editors: [' ', 'Doe, Jane'],
    tier: 'peer-reviewed',
    relevance: 0.9,
    why_relevant: 'Defines the deep-learning family the paper builds on.',
    retraction_status: 'clear',
    zotero: { library: 'groups/4711', key: 'ZXCV1234' },
    byo: { file: 'sources/lecun2015.pdf', sha256: 'a'.repeat(64), text_sha256: 'b'.repeat(64) },
  };
  const e = candidateToEntry(c, ['add:crossref'], NOW);
  assert.equal(e.type, 'article-journal');
  assert.equal(e.volume, '521', 'a numeric volume becomes its text');
  assert.equal(e.issue, '7553');
  assert.deepEqual(e.editors, ['Doe, Jane']);
  assert.equal(e.tier, 'peer-reviewed');
  assert.equal(e.relevance, 0.9);
  assert.equal(e.retraction_status, 'clear');
  assert.equal(e.retracted, false);
  assert.deepEqual(e.zotero, { library: 'groups/4711', key: 'ZXCV1234' });
  assert.equal(e.byo?.file, 'sources/lecun2015.pdf');
  assert.equal(e.hydrated, true);
  LibraryEntrySchema.parse(e);

  const bad = candidateToEntry(
    { title: 'x', authors: ['A, B'], type: 'blogpost', tier: 'blog', relevance: 7, retraction_status: 'maybe', zotero: { library: 'x', key: 'y' } as never, byo: { file: '', sha256: 'nope' } as never },
    ['add'],
    NOW,
  );
  assert.equal(bad.type, null);
  assert.equal(bad.tier, null);
  assert.equal(bad.relevance, null);
  assert.equal(bad.retraction_status, 'unchecked');
  assert.equal(bad.zotero, null);
  assert.equal(bad.byo, null);

  const retracted = candidateToEntry({ title: 'y', authors: ['A, B'], retraction_status: 'retracted' }, ['add'], NOW);
  assert.equal(retracted.retracted, true, 'a retracted status sets the flag (fail closed)');
});

test('seam S-B: the latest evaluation wins and a non-evaluating ingest never erases it', async () => {
  const root = project();
  const base: LibraryCandidate = { citekey: 'lecun2015', source: 'crossref', doi: '10.1038/nature14539', title: 'Deep learning', authors: ['LeCun, Yann'], year: 2015 };
  await upsertSources(root, [{ ...base, tier: 'peer-reviewed', relevance: 0.4, why_relevant: 'first look' }], { provenance: 'research' });
  await upsertSources(root, [{ ...base, relevance: 0.8, why_relevant: 'central to section 2' }], { provenance: 'plan-research:§2' });
  await upsertSources(root, [{ ...base }], { provenance: 'add' });
  const [e] = (await loadLibrary(root)).entries;
  assert.equal(e!.tier, 'peer-reviewed');
  assert.equal(e!.relevance, 0.8);
  assert.equal(e!.why_relevant, 'central to section 2');
});

test('seam S-B: a hydrated record replaces an unhydrated BYO entry\'s local metadata', async () => {
  const root = project();
  const byo = { file: 'sources/vaswani2017.pdf', sha256: 'c'.repeat(64), text_sha256: 'd'.repeat(64) };
  await upsertSources(
    root,
    [{ citekey: 'vaswani2017', title: 'Attention is all you need (local copy)', authors: ['Vaswani'], year: 2017, arxiv: '1706.03762', hydrated: false, byo }],
    { provenance: 'byo' },
  );
  const out = await upsertSources(
    root,
    [{ source: 'arxiv', arxiv: '1706.03762', title: 'Attention Is All You Need', authors: ['Ashish Vaswani', 'Noam Shazeer'], year: 2017, type: 'preprint' }],
    { provenance: 'research' },
  );
  assert.equal(out.outcomes[0]!.matchedBy, 'arxiv');
  const [e] = (await loadLibrary(root)).entries;
  assert.equal(e!.citekey, 'vaswani2017', 'the citekey never changes');
  assert.equal(e!.hydrated, true);
  assert.equal(e!.title, 'Attention Is All You Need');
  assert.deepEqual(e!.authors, ['Ashish Vaswani', 'Noam Shazeer']);
  assert.equal(e!.type, 'preprint');
  assert.deepEqual(e!.byo, byo, 'the BYO record is kept');
});

test('seam S-B: retraction status — retracted is sticky, otherwise the newest lookup wins', async () => {
  const root = project();
  const base: LibraryCandidate = { citekey: 'smith2020', source: 'crossref', doi: '10.5555/example.1', title: 'A study', authors: ['Smith, A'], year: 2020 };
  await upsertSources(root, [{ ...base, retraction_status: 'clear' }], { provenance: 'research' });
  await upsertSources(root, [{ ...base, retraction_status: 'unknown' }], { provenance: 'research' });
  assert.equal((await loadLibrary(root)).entries[0]!.retraction_status, 'unknown');
  await upsertSources(root, [{ ...base }], { provenance: 'add' });
  assert.equal((await loadLibrary(root)).entries[0]!.retraction_status, 'unknown', 'an unchecked record never overrides an outcome');
  await upsertSources(root, [{ ...base, retracted: true, retraction_details: 'Retraction notice' }], { provenance: 'research' });
  await upsertSources(root, [{ ...base, retraction_status: 'clear' }], { provenance: 'research' });
  const e = (await loadLibrary(root)).entries[0]!;
  assert.equal(e.retracted, true);
  assert.equal(e.retraction_status, 'retracted');
});

test('seam S-B: a re-pulled identifier-less Zotero item merges by its item key', async () => {
  const root = project();
  const item: LibraryCandidate = {
    source: 'zotero',
    title: 'Field notes from the archive',
    authors: ['Jones, Mary'],
    year: 1999,
    zotero: { library: 'users/12345', key: 'QWER5678' },
  };
  const first = await upsertSources(root, [item], { provenance: 'zotero' });
  const second = await upsertSources(root, [{ ...item, title: 'Field Notes from the Archive', year: 2001 }], { provenance: 'zotero' });
  assert.equal(second.outcomes[0]!.matchedBy, 'zotero');
  assert.equal(second.outcomes[0]!.citekey, first.outcomes[0]!.citekey);
  assert.equal((await loadLibrary(root)).entries.length, 1);
});
