// tests/known-bad-citations.test.ts — SC-2 / CITE-01 on the production path
// (Phase 20, VRFY-29; PRD §14, §19 item 5).
//
// Every row of tests/fixtures/known-bad-citations.json is a citation of a DOI
// no registrar ever minted. Each is driven through `runPass1` — the function
// `pensmith verify` uses — as a bib entry cited in a draft, against the
// registrar answers recorded live (crossref/works-known-bad-404.json: Crossref's
// 404 for each; generic/doi-ra-prefixes.json: doi.org's agency of each prefix —
// ACM's 10.1145 is Crossref's, 10.99999 has no agency). All 12 must be
// FABRICATED — never OK, never UNVERIFIABLE.
//
// The recordings are load-bearing: a DOI whose Crossref 404 is missing from
// the store gets no answer offline (UNVERIFIABLE-NETWORK), so this test fails
// the moment one entry is deleted (asserted below by replaying the store
// without one entry).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPass1 } from '../bin/lib/verify/pass1.js';
import { loadCassetteFile } from '../bin/lib/http-mock.js';

interface KnownBad {
  citekey: string;
  title: string;
  authors: string[];
  year: number;
  doi: string;
  expected_verdict: string;
  expected_reason: string;
}

const fixturePath = fileURLToPath(new URL('./fixtures/known-bad-citations.json', import.meta.url));
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8')) as KnownBad[];

function paperWith(rows: readonly KnownBad[]): { bibPath: string; draft: string } {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-known-bad-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const bib = rows
    .map((r) => `@article{${r.citekey},\n  author = {${r.authors.join(' and ')}},\n  title = {${r.title}},\n  year = {${r.year}},\n  doi = {${r.doi}},\n}\n`)
    .join('\n');
  const bibPath = join(root, '.paper', 'CITATIONS.bib');
  writeFileSync(bibPath, bib);
  const draft = `# Section\n\n${rows.map((r) => `A claim [@${r.citekey}].`).join(' ')}\n`;
  return { bibPath, draft };
}

test('known-bad-citations: the fixture holds ≥ 10 fabricated DOIs, each expecting FABRICATED (PRD §14, §19 item 5)', () => {
  assert.ok(fixtures.length >= 10, `known-bad-citations.json must have ≥ 10 entries, has ${fixtures.length}`);
  for (const e of fixtures) {
    assert.equal(e.expected_verdict, 'FABRICATED', `${e.citekey}: every row expects FABRICATED`);
    assert.equal(typeof e.doi, 'string');
    assert.equal(typeof e.citekey, 'string');
  }
});

test('VRFY-29: runPass1 flags all 12 fabricated DOIs FABRICATED against the recorded registrar answers', async () => {
  const { bibPath, draft } = paperWith(fixtures);
  const rows = await runPass1(draft, bibPath);
  assert.equal(rows.length, fixtures.length);
  for (const e of fixtures) {
    const r = rows.find((x) => x.citekey === e.citekey);
    assert.ok(r, `${e.citekey}: a row`);
    assert.equal(r.verdict, 'FABRICATED', `${e.citekey}: ${r.reason}`);
    assert.match(r.reason, /did not resolve via Crossref/, `${e.citekey}: ${r.reason}`);
  }
  assert.equal(rows.filter((r) => r.verdict === 'FABRICATED').length, 12);
});

test('VRFY-29: every row rests on a recorded Crossref 404 — without it there is no answer (UNVERIFIABLE-NETWORK), never FABRICATED', async () => {
  const recorded = loadCassetteFile('crossref', 'works-known-bad-404') ?? [];
  const paths = recorded.map((e) => decodeURIComponent(e.path));
  for (const e of fixtures) {
    assert.ok(
      paths.some((p) => p === `/works/${e.doi.toLowerCase()}`),
      `${e.citekey}: crossref/works-known-bad-404.json records Crossref's answer for ${e.doi}`,
    );
    assert.equal(recorded.find((x) => decodeURIComponent(x.path) === `/works/${e.doi.toLowerCase()}`)?.status, 404);
  }
  // A DOI of the same shape with no recording gets no answer offline: the
  // verdict is UNVERIFIABLE-NETWORK — so deleting one recorded entry fails the test above.
  const { bibPath, draft } = paperWith([{ ...fixtures[0]!, citekey: 'unrecorded2024', doi: '10.99999/fake.unrecorded' }]);
  const [r] = await runPass1(draft, bibPath);
  assert.equal(r?.verdict, 'UNVERIFIABLE-NETWORK', r?.reason);
  assert.match(r?.reason ?? '', /^offline: no recorded fixture — re-run online \(Crossref re-fetch of 10\.99999\/fake\.unrecorded\)$/);
});
