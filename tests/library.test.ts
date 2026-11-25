// tests/library.test.ts — .paper/LIBRARY.json, the canonical bibliographic
// store (bin/lib/library.ts).
//
// LIBRARY.json v2 holds CSL-JSON items. Works are merged by identifier, so a
// work found again keeps its citekey; a new work gets a key no other work has.
// Writes take one lock, so concurrent adds all land. A v1 file (research
// candidates as the adapters returned them) is migrated.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { addToLibrary, loadLibrary, mergeCandidates, readLibrarySync } from '../bin/lib/library.js';
import { ForwardIncompatError } from '../bin/lib/migrations/loader.js';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';
import type { Library } from '../bin/lib/schemas/library.js';

function mkRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-library-'));
  // The session log resolves its folder from these at first use.
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  fs.mkdirSync(path.join(tmp, '.paper'), { recursive: true });
  return tmp;
}

const AT = '2026-11-25T00:00:00.000Z';

function emptyLibrary(): Library {
  return { $schemaVersion: 2, entries: [], bibtex_preamble: [] };
}

function cand(over: Partial<SourceCandidate> & { title: string }): SourceCandidate {
  return {
    source: 'crossref',
    id: over.doi ?? over.arxiv ?? over.title,
    authors: ['Wu, Yuxin'],
    year: 2017,
    retracted: false,
    last_verified: AT,
    citekey: 'wu2017',
    raw: null,
    ...over,
  } as SourceCandidate;
}

test('a project with no LIBRARY.json has an empty library', async () => {
  const root = mkRoot();
  const lib = await loadLibrary(root);
  assert.equal(lib.$schemaVersion, 2);
  assert.deepEqual(lib.entries, []);
});

test('items are CSL-JSON: structured names, identifiers, and the citekey as id', async () => {
  const root = mkRoot();
  const r = await addToLibrary(root, [cand({
    title: 'Group Normalization', doi: '10.1007/S11263-019-01198-W', names: [{ family: 'Wu', given: 'Yuxin' }],
    container_title: 'International Journal of Computer Vision', volume: '128', page: '742-755', csl_type: 'article-journal',
  })]);
  assert.deepEqual(r.works.map((w) => [w.citekey, w.status]), [['wu2017', 'added']]);
  const lib = JSON.parse(fs.readFileSync(path.join(root, '.paper', 'LIBRARY.json'), 'utf8'));
  assert.equal(lib.$schemaVersion, 2);
  const item = lib.entries[0];
  assert.equal(item.id, 'wu2017');
  assert.equal(item.type, 'article-journal');
  assert.deepEqual(item.author, [{ family: 'Wu', given: 'Yuxin' }]);
  assert.deepEqual(item.issued, { 'date-parts': [[2017]] });
  assert.equal(item.DOI, '10.1007/s11263-019-01198-w', 'one spelling of the DOI');
  assert.equal(item['container-title'], 'International Journal of Computer Vision');
  assert.deepEqual(item.custom.identities, ['doi:10.1007/s11263-019-01198-w']);
  assert.equal(item.custom.provenance[0].source, 'crossref');
});

test('a work added again, under any spelling of its DOI, keeps its key and is not added twice', async () => {
  const root = mkRoot();
  await addToLibrary(root, [cand({ title: 'Group Normalization', doi: '10.1007/s11263-019-01198-w' })]);
  const again = await addToLibrary(root, [cand({ title: 'Group Normalization', doi: 'https://doi.org/10.1007/S11263-019-01198-W', citekey: 'wu2017a' })]);
  assert.deepEqual(again.works.map((w) => [w.citekey, w.status]), [['wu2017', 'existing']]);
  assert.equal((await loadLibrary(root)).entries.length, 1);
});

test('records of one work from several sources are one item, its metadata from the preferred source', () => {
  const lib = emptyLibrary();
  const fromArxiv = cand({ source: 'arxiv', title: 'Attention Is All You Need', arxiv: '1706.03762', authors: ['Vaswani, Ashish'], citekey: 'vaswani2017' });
  const fromS2 = cand({ source: 'semanticscholar', title: 'Attention is All you Need', doi: '10.48550/arXiv.1706.03762', abstract: 'We propose the Transformer.', authors: ['Vaswani, A.'], citekey: 'vaswani2017a' });
  const r = mergeCandidates(lib, [fromS2, fromArxiv], AT, { preference: ['arxiv', 'semanticscholar'] });
  assert.equal(r.works.length, 1, 'the arXiv DOI and the arXiv ID name one work');
  assert.equal(lib.entries.length, 1);
  const item = lib.entries[0]!;
  assert.equal(item.title, 'Attention Is All You Need', 'the preferred (arXiv) record');
  assert.equal(item.DOI, undefined, 'only the preferred record\'s own identifiers are printed');
  assert.equal(item.custom.arxiv, '1706.03762');
  assert.equal(item.abstract, 'We propose the Transformer.', 'an abstract another record has is kept');
  assert.ok(item.custom.identities.includes('doi:10.48550/arxiv.1706.03762'), 'the DOI still finds the work');
  assert.deepEqual(item.custom.provenance.map((p) => p.source).sort(), ['arxiv', 'semanticscholar']);
});

test('a work any record reports retracted is stored retracted', () => {
  const lib = emptyLibrary();
  mergeCandidates(lib, [
    cand({ source: 'openalex', title: 'A Study', doi: '10.1000/x' }),
    cand({ source: 'pubmed', title: 'A Study', doi: '10.1000/x', pmid: '123', retracted: true, retraction_details: 'PubMed: Retracted Publication' }),
  ], AT);
  assert.equal(lib.entries[0]!.custom.retracted, true);
  assert.equal(lib.entries[0]!.custom.retraction_details, 'PubMed: Retracted Publication');
});

test('a candidate with no DOI, arXiv ID, PMID or ISBN is not stored', () => {
  const lib = emptyLibrary();
  const r = mergeCandidates(lib, [cand({ title: 'Untraceable', citekey: 'anon2017' })], AT);
  assert.equal(r.skipped.length, 1);
  assert.deepEqual(lib.entries, []);
});

test('new works are keyed in a fixed order, whatever order the sources answered in', () => {
  const a = cand({ title: 'Paper A', doi: '10.1000/a' });
  const b = cand({ title: 'Paper B', doi: '10.1000/b' });
  const one = emptyLibrary();
  const two = emptyLibrary();
  mergeCandidates(one, [a, b], AT);
  mergeCandidates(two, [b, a], AT);
  const keys = (l: Library): string[] => l.entries.map((e) => `${e.id}=${e.DOI}`).sort();
  assert.deepEqual(keys(one), keys(two));
});

test('10 concurrent adds of different works all land, each under its own key', async () => {
  const root = mkRoot();
  await Promise.all(Array.from({ length: 10 }, (_, i) => addToLibrary(root, [cand({ title: `Paper ${i}`, doi: `10.1000/p${i}` })])));
  const lib = await loadLibrary(root);
  assert.equal(lib.entries.length, 10);
  assert.equal(new Set(lib.entries.map((e) => e.id)).size, 10, 'no key is shared');
  assert.deepEqual(lib.entries.map((e) => e.DOI).sort(), Array.from({ length: 10 }, (_, i) => `10.1000/p${i}`).sort());
});

test('a v1 LIBRARY.json (research candidates) migrates to v2 items under the same keys', async () => {
  const root = mkRoot();
  const v1 = {
    $schemaVersion: 1,
    entries: [
      { source: 'openalex', id: 'https://openalex.org/W1', title: 'Attention Is All You Need', authors: ['Ashish Vaswani', 'Noam Shazeer'], year: 2017, doi: '10.48550/arxiv.1706.03762', retracted: false, last_verified: AT, citekey: 'vaswani2017', raw: { big: true } },
      { source: 'pubmed', id: '9500320', title: 'Ileal-lymphoid-nodular hyperplasia', authors: ['Wakefield AJ'], year: 1998, retracted: true, last_verified: AT, citekey: 'aj1998', raw: null },
    ],
  };
  fs.writeFileSync(path.join(root, '.paper', 'LIBRARY.json'), JSON.stringify(v1));
  const lib = await loadLibrary(root);
  assert.equal(lib.$schemaVersion, 2);
  assert.deepEqual(lib.entries.map((e) => e.id), ['vaswani2017', 'aj1998'], 'citekeys a draft may cite are kept');
  assert.deepEqual(lib.entries[0]!.author, [{ family: 'Vaswani', given: 'Ashish' }, { family: 'Shazeer', given: 'Noam' }]);
  assert.deepEqual(lib.entries[1]!.author, [{ family: 'Wakefield', given: 'A. J.' }]);
  assert.equal(lib.entries[1]!.custom.retracted, true);
  assert.equal((lib.entries[0] as Record<string, unknown>)['raw'], undefined, 'the adapter payload is not stored');
  assert.deepEqual(readLibrarySync(root)?.entries.map((e) => e.id), ['vaswani2017', 'aj1998']);
});

test('a newer LIBRARY.json than this build supports is refused, not misread', async () => {
  const root = mkRoot();
  fs.writeFileSync(path.join(root, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 999, entries: [] }));
  await assert.rejects(() => loadLibrary(root), (e: unknown) => e instanceof ForwardIncompatError);
  await assert.rejects(() => addToLibrary(root, [cand({ title: 'X', doi: '10.1000/x' })]), (e: unknown) => e instanceof ForwardIncompatError);
});
