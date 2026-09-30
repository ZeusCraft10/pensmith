// tests/pass1-lookup.test.ts — Pass 1 on the three-way Crossref lookup
// (D-19-05, SRC-04, SRC-05; Phase 19 stream adapters).
//
//   - a Crossref re-fetch that could not be answered (a 503 after retries, a
//     200 carrying an error document, an exhausted host) is UNVERIFIABLE-NETWORK
//     with the reason (Phase 20, VRFY-12, D-20-03) — blocking, never "did not
//     resolve" (FABRICATED), never OK;
//   - Crossref's definitive 404 is still FABRICATED — but a DataCite arXiv DOI
//     (10.48550/arXiv.<id>) is re-fetched at arXiv (review round 2);
//   - the Crossref record's own retraction notice blocks (RETRACTED, VRFY-15, naming it);
//   - a corporate author and a particle surname pass the AND-gate against the
//     recorded records; DOI case never makes a work look redirected.
// Offline cases replay the REAL recordings (Crossref works + the retraction
// re-query); the failure cases use the MockAgent test lane or the synthetic
// inner-403 fixture.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPass1 } from '../bin/lib/verify/pass1.js';
import { RateLimitExhaustedError, type HttpResponse } from '../bin/lib/http.js';
import { __setRegistrarSendForTest } from '../bin/lib/sources/registrar-response.js';
import { liveLane, uniq } from './sources/three-way.js';

interface BibFields {
  citekey: string;
  title: string;
  author: string;
  doi: string;
  year?: number;
}

function bibFile(entries: BibFields[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-pass1-lookup-'));
  mkdirSync(join(dir, '.paper'), { recursive: true });
  const text = entries
    .map((e) => [
      `@article{${e.citekey},`,
      `  author = {${e.author}},`,
      `  title = {${e.title}},`,
      `  doi = {${e.doi}},`,
      `  year = {${e.year ?? 2000}},`,
      '}',
      '',
    ].join('\n'))
    .join('\n');
  const p = join(dir, '.paper', 'CITATIONS.bib');
  writeFileSync(p, text);
  return p;
}

async function verdict(entry: BibFields): Promise<{ verdict: string; reason: string }> {
  const bib = bibFile([entry]);
  const [r] = await runPass1(`A claim [@${entry.citekey}].\n`, bib);
  assert.ok(r, 'one verdict');
  return r;
}

test('SRC-05: the ENCODE consortium (a corporate author, braced) passes the AND-gate against the recorded record', async () => {
  const r = await verdict({
    citekey: 'encode2012',
    title: 'An integrated encyclopedia of DNA elements in the human genome',
    author: '{The ENCODE Project Consortium}',
    doi: '10.1038/nature11247',
    year: 2012,
  });
  assert.equal(r.verdict, 'OK', r.reason);
});

test('SRC-05: nature14539 and a particle surname (van der Maaten) verify OK offline', async () => {
  const deep = await verdict({ citekey: 'lecun2015', title: 'Deep learning', author: 'LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey', doi: '10.1038/nature14539', year: 2015 });
  assert.equal(deep.verdict, 'OK', deep.reason);
  const beech = await verdict({
    citekey: 'vandermaaten2013',
    title: 'Thinning prolongs growth duration of European beech (Fagus sylvatica L.) across a valley in southwestern Germany',
    author: 'van der Maaten, Ernst',
    doi: '10.1016/j.foreco.2013.06.030',
    year: 2013,
  });
  assert.equal(beech.verdict, 'OK', beech.reason);
});

test('DOIs are case-insensitive: an upper-case DOI in the bib is the same work, not a redirect', async () => {
  const r = await verdict({ citekey: 'aspelmeyer2009', title: 'Measured measurement', author: 'Aspelmeyer, Markus', doi: '10.1038/NPHYS1170', year: 2009 });
  assert.equal(r.verdict, 'OK', r.reason);
  // VRFY-13: the year is part of the match (within ±1) and the OK row says so.
  assert.equal(r.reason, 'D-11 AND-gate passed (year 2009)');
});

test('SRC-04 / VRFY-15: the Crossref record of Wakefield 1998 carries its retraction → RETRACTED naming the notice (blocking)', async () => {
  const r = await verdict({
    citekey: 'wakefield1998',
    title: 'Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children',
    author: 'Wakefield, AJ',
    doi: '10.1016/S0140-6736(97)11096-0',
    year: 1998,
  });
  assert.equal(r.verdict, 'RETRACTED');
  assert.match(
    r.reason,
    /^cited work is retracted \(Crossref's record of 10\.1016\/S0140-6736\(97\)11096-0 at verify time: 2010-02-06: Retraction \(notice 10\.1016\/s0140-6736\(10\)60175-4; Retraction Watch record 4036\)\)$/,
  );
  // Review round 2: the row carries the real similarity scores (the metadata matches), never a false 0.00.
  const full = await runPass1(`A claim [@wakefield1998].\n`, bibFile([{
    citekey: 'wakefield1998',
    title: 'Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children',
    author: 'Wakefield, AJ',
    doi: '10.1016/S0140-6736(97)11096-0',
    year: 1998,
  }]));
  // (Crossref's record title is prefixed `RETRACTED:`, so the title score is its real value, below 1.)
  assert.ok(full[0]!.titleJW > 0.5 && full[0]!.authorJW === 1, JSON.stringify(full[0]));
  assert.equal(full[0]!.retraction, true);
});

test('Crossref\'s definitive 404 for a DOI no registrar minted is still FABRICATED (did not resolve)', async () => {
  const r = await verdict({ citekey: 'nobody2017', title: 'A Work That Was Never Published', author: 'Nobody, Ann', doi: '10.5555/pensmith-no-such-work-2017', year: 2017 });
  assert.equal(r.verdict, 'FABRICATED');
  assert.match(r.reason, /did not resolve via Crossref/);
});

test('review round 1 (merge): a Crossref 404 for a DOI another agency registered is never FABRICATED — the PMID is checked at PubMed, else UNVERIFIABLE naming the agency', async () => {
  // The live-chain case: a PubMed hit whose DOI ISTIC registered (doi.org/ra/10.3760 → ISTIC).
  const title = '[Application of transformer in intelligent diagnosis and treatment of peritoneal metastasis: current status and prospects].';
  const bib = bibFile([{ citekey: 'zou2026', title, author: 'Zou, PR', doi: '10.3760/cma.j.cn441530-20260508-00189-1', year: 2026 }]);
  writeFileSync(bib, readFileSync(bib, 'utf8').replace('  year = {2026},', '  year = {2026},\n  pmid = {42706103},'));
  const [withPmid] = await runPass1('A claim [@zou2026].\n', bib);
  assert.equal(withPmid!.verdict, 'OK', withPmid!.reason);
  assert.match(
    withPmid!.reason,
    /^DOI 10\.3760\/cma\.j\.cn441530-20260508-00189-1 is registered with ISTIC, not Crossref, which serves no record the verifier can read; PMID 42706103 re-fetched from PubMed; D-11 AND-gate passed \(year 2026\)$/,
  );
  // Without the PMID there is nothing the verifier can query: blocking, but never "invented".
  // (ISTIC serves no content-negotiation record: doi.org is not even asked, D-20-10.)
  const bare = await verdict({ citekey: 'zou2026', title, author: 'Zou, PR', doi: '10.3760/cma.j.cn441530-20260508-00189-1', year: 2026 });
  assert.equal(bare.verdict, 'UNVERIFIABLE');
  assert.match(bare.reason, /is registered with ISTIC, not Crossref, which serves no record the verifier can read — give the work's arXiv id, PMID or ISBN/);
  // A PMID that names another work is still a mismatch (MIS-CITED), not a pass.
  writeFileSync(bib, readFileSync(bib, 'utf8').replace('pmid = {42706103}', 'pmid = {31978945}'));
  const [wrongPmid] = await runPass1('A claim [@zou2026].\n', bib);
  assert.equal(wrongPmid!.verdict, 'MIS-CITED', wrongPmid!.reason);
  assert.match(wrongPmid!.reason, /registered with ISTIC.*PMID 31978945 re-fetched from PubMed: mismatch: title \(/);
});

test('review round 2: a DataCite arXiv DOI (research writes it from Semantic Scholar / OpenAlex) is re-fetched at arXiv — OK, never FABRICATED by Crossref\'s 404', async () => {
  const r = await verdict({ citekey: 'vaswani2017', title: 'Attention Is All You Need', author: 'Vaswani, Ashish', doi: '10.48550/arXiv.1706.03762', year: 2017 });
  assert.equal(r.verdict, 'OK', r.reason);
  assert.match(r.reason, /arXiv/);
  // The same entry as the library writer renders it (doi + eprint): OK too.
  const bib = bibFile([{ citekey: 'vaswani2017', title: 'Attention Is All You Need', author: 'Vaswani, Ashish', doi: '10.48550/arxiv.1706.03762', year: 2017 }]);
  writeFileSync(bib, readFileSync(bib, 'utf8').replace('  year = {2017},', '  year = {2017},\n  eprint = {1706.03762},\n  archivePrefix = {arXiv},'));
  const [withEprint] = await runPass1('A claim [@vaswani2017].\n', bib);
  assert.equal(withEprint!.verdict, 'OK', withEprint!.reason);
  // A DOI naming one arXiv id and an eprint naming another is MIS-CITED (never checked against the wrong work).
  writeFileSync(bib, readFileSync(bib, 'utf8').replace('eprint = {1706.03762}', 'eprint = {2102.05095}'));
  const [mismatch] = await runPass1('A claim [@vaswani2017].\n', bib);
  assert.equal(mismatch!.verdict, 'MIS-CITED');
  assert.match(mismatch!.reason, /names arXiv:1706\.03762, but the entry's eprint is 2102\.05095/);
});

test('D-19-05 / VRFY-12: a 200 carrying an error document (synthetic inner 403) is UNVERIFIABLE-NETWORK with the reason — not FABRICATED', async () => {
  const r = await verdict({ citekey: 'inner2020', title: 'Some Work', author: 'Doe, Jane', doi: '10.5555/inner-403', year: 2020 });
  assert.equal(r.verdict, 'UNVERIFIABLE-NETWORK');
  assert.equal(
    r.reason,
    'Crossref re-fetch of 10.5555/inner-403 failed: response is not a Crossref answer (an error document: an inner statusCode 403) — re-run verify once the lookup answers',
  );
});

test('SRC-04 / VRFY-15: a retraction re-query answered by a 200 with an inner 403 is "retraction status unknown" → UNVERIFIABLE-NETWORK (VERIFICATION.md path)', async () => {
  const r = await verdict({
    citekey: 'gap2019',
    title: 'A Work Whose Retraction Lookup Answers With An Error Document',
    author: 'Gap, Rita',
    doi: '10.5555/rw-inner-403',
    year: 2019,
  });
  assert.equal(r.verdict, 'UNVERIFIABLE-NETWORK');
  assert.equal(
    r.reason,
    'retraction status unknown for 10.5555/rw-inner-403: the Crossref lookup failed (response is not a Crossref answer ' +
      '(an error document: an inner statusCode 403)) (Retraction Watch re-query) — re-run verify once the lookup answers',
  );
});

test('D-19-05 / VRFY-12: an exhausted Crossref host is UNVERIFIABLE-NETWORK (blocking), naming the wait', async () => {
  try {
    __setRegistrarSendForTest(async (): Promise<HttpResponse> => {
      throw new RateLimitExhaustedError('api.crossref.org', 22_400_000, 429);
    });
    const r = await verdict({ citekey: 'late2020', title: 'Some Work', author: 'Doe, Jane', doi: '10.5555/exhausted-host', year: 2020 });
    assert.equal(r.verdict, 'UNVERIFIABLE-NETWORK');
    assert.match(r.reason, /^Crossref re-fetch of 10\.5555\/exhausted-host failed: rate limit exhausted \(retry after ~6 h\) — re-run verify/);
  } finally {
    __setRegistrarSendForTest(null);
  }
});

test('D-19-05 / VRFY-12 (MockAgent): Crossref 503 after the transport\'s retries is UNVERIFIABLE-NETWORK — never FABRICATED', async () => {
  await liveLane(async (agent) => {
    const doi = `10.5555/${uniq('p1-503')}`;
    agent
      .get('https://api.crossref.org')
      .intercept({ path: (p: string) => decodeURIComponent(p).startsWith(`/works/${doi}`), method: 'GET' })
      .reply(503, 'Service Unavailable', { headers: { 'content-type': 'text/plain' } })
      .persist();
    const r = await verdict({ citekey: 'down2020', title: 'Some Work', author: 'Doe, Jane', doi, year: 2020 });
    assert.equal(r.verdict, 'UNVERIFIABLE-NETWORK');
    assert.match(r.reason, new RegExp(`^Crossref re-fetch of ${doi.replace(/[.]/g, '\\.')} failed: .*503`));
  });
});
