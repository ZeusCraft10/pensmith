// tests/freshness-probe.test.ts — RSCH-10 source-freshness probe (D-10, WARN-only),
// updated for Phase 17 (RUN-01, RUN-03) and Phase 20 (carry-over 1, VRFY-15,
// VRFY-28; D-20-13, D-20-15).
//
// Locked WARN-only policy — and never an `ok` for a probe that was not sent:
//   - DOI HEAD 2xx / 3xx       → `ok` (the probe was sent and answered)
//   - DOI HEAD 4xx/5xx         → WARN row, advisory only (never blocking)
//   - DOI HEAD no answer       → `unavailable` row naming why (was: silent)
//   - retraction-watch hit     → WARN row; none → `ok`; no answer → `unavailable`
//   - a DOI another agency registered → `unknown` (no retraction data for it)
//   - a key with no DOI        → `no DOI — checked at <registrar> by Pass 1`
//   - a key not in the bib     → `not in CITATIONS.bib — see its Pass-1 row`
// Offline (PENSMITH_OFFLINE=1, --dry-run, the test runner) the DOI HEAD probe
// is "skipped (offline)" — it never replays a canned HEAD answer — and the
// agency / retraction lookups replay EXACT recorded fixtures or are skipped the
// same way. The live behaviour runs in the test lane against the V5 MockAgent.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeFreshness, renderFreshnessTable, type FreshnessSource } from '../bin/lib/verify/freshness.js';
import { runFreshnessForDraft } from '../bin/lib/verify/pass1.js';
import { upsertSources } from '../bin/lib/library.js';
import { liveLane, uniq } from './sources/three-way.js';

// A DOI whose (synthetic) Crossref record and Retraction Watch fixture say retracted.
const RETRACTED_DOI = '10.0000/gate03-retracted';
// A DOI with no fixture of any kind.
const NO_FIXTURE_DOI = '10.0000/no-fixture-at-all';

/** A live Crossref answer listing no retraction notice for the DOI. */
const NO_RETRACTION = {
  status: 'ok',
  'message-type': 'work-list',
  message: { facets: {}, 'total-results': 0, items: [], 'items-per-page': 20, query: { 'start-index': 0, 'search-terms': null } },
};

function work(doi: string): Record<string, unknown> {
  return {
    status: 'ok',
    'message-type': 'work',
    message: { DOI: doi, title: ['A Work'], author: [{ family: 'Doe', given: 'Jane' }], issued: { 'date-parts': [[2020]] }, type: 'journal-article' },
  };
}

const src = (citekey: string, doi: string | null, extra: Partial<FreshnessSource> = {}): FreshnessSource => ({
  citekey,
  inBib: true,
  doi,
  registrar: null,
  ...extra,
});

const JSON_HEADERS = { headers: { 'content-type': 'application/json' } } as const;

// ---------------------------------------------------------------------------
// Offline (the test runner default)
// ---------------------------------------------------------------------------

test('freshness: returns a FreshnessResult tagged with the citekey', async () => {
  const r = await probeFreshness(src('smith2020', '10.1038/nphys1170'));
  assert.equal(r.citekey, 'smith2020');
  assert.ok(Array.isArray(r.warnings), 'warnings must be an array');
});

test('RUN-03: offline, the DOI HEAD probe is "skipped (offline)" — never a replayed canned answer; the recorded retraction answer is `ok`', async () => {
  const r = await probeFreshness(src('aspelmeyer2009', '10.1038/nphys1170'));
  assert.equal(r.warnings.find((w) => w.probe === 'DOI HEAD'), undefined);
  assert.deepEqual(r.skipped?.find((s) => s.probe === 'DOI HEAD'), { probe: 'DOI HEAD', detail: 'skipped (offline)' });
  // 10.1038/nphys1170 has a recorded Crossref record (Crossref registered it)
  // and a RECORDED Retraction Watch answer, so that probe ran and answered clean.
  assert.equal(r.skipped?.find((s) => s.probe === 'retraction-watch'), undefined);
  assert.deepEqual(r.ok, [{ probe: 'retraction-watch', detail: 'no retraction notice' }]);
  const table = renderFreshnessTable([r]);
  assert.match(table, /\| aspelmeyer2009 \| DOI HEAD \| skipped \(offline\) \| not probed — re-run online \|/);
  assert.match(table, /\| aspelmeyer2009 \| retraction-watch \| ok \| no retraction notice \|/);
  assert.ok(!/\| aspelmeyer2009 \| DOI HEAD \| ok \|/.test(table), 'a skipped probe is never shown as ok');
});

test('freshness: an exact Retraction Watch fixture hit still produces a WARN row offline', async () => {
  const r = await probeFreshness(src('roe2018', RETRACTED_DOI));
  const rwWarn = r.warnings.find((w) => w.probe === 'retraction-watch');
  assert.ok(rwWarn, 'a retracted DOI must emit a retraction-watch WARN');
  assert.equal(rwWarn?.status, 'WARN');
});

test('RUN-03: offline, a DOI with no fixture is "skipped (offline)" for both probes, never "not retracted"', async () => {
  const r = await probeFreshness(src('ghost2099', NO_FIXTURE_DOI));
  assert.deepEqual(r.warnings, []);
  assert.equal(r.ok, undefined);
  assert.deepEqual(r.skipped, [
    { probe: 'DOI HEAD', detail: 'skipped (offline)' },
    { probe: 'retraction-watch', detail: 'skipped (offline)' },
  ]);
});

test('carry-over 1: a key with no DOI says where Pass 1 checked it — never a DOI HEAD `ok` row', async () => {
  const arxiv = await probeFreshness(src('vaswani2017', null, { registrar: 'arXiv' }));
  const none = await probeFreshness(src('nodoi2021', null));
  assert.deepEqual(arxiv.warnings, []);
  assert.equal(arxiv.skipped, undefined);
  const table = renderFreshnessTable([arxiv, none]);
  assert.match(table, /^\| vaswani2017 \| registrar \| no DOI \| no DOI — checked at arXiv by Pass 1 \|$/m);
  assert.match(table, /^\| nodoi2021 \| registrar \| no DOI \| no DOI, arXiv id, PMID or ISBN — see its Pass-1 row \|$/m);
  assert.doesNotMatch(table, /\| (vaswani2017|nodoi2021) \| DOI HEAD \| ok \|/);
});

test('carry-over 1: a key missing from CITATIONS.bib says so — never an `ok` row', async () => {
  const r = await probeFreshness({ citekey: 'ghost2099', inBib: false, doi: null, registrar: null });
  const table = renderFreshnessTable([r]);
  assert.match(table, /^\| ghost2099 \| CITATIONS\.bib \| missing \| not in CITATIONS\.bib — see its Pass-1 row \|$/m);
  assert.doesNotMatch(table, /\| ok \|/);
});

test('D-20-13: a DOI DataCite registered has no retraction data — `unknown`, never shown as clean', async () => {
  // Offline: Crossref's recorded 404 for the Zenodo DOI, then doi.org's recorded agency (DataCite).
  const r = await probeFreshness(src('spacy2023', '10.5281/zenodo.1212303'));
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.info, [{ probe: 'retraction-watch', status: 'unknown', detail: 'retraction status unknown (no retraction data for DataCite DOIs)' }]);
  const table = renderFreshnessTable([r]);
  assert.match(table, /^\| spacy2023 \| retraction-watch \| unknown \| retraction status unknown \(no retraction data for DataCite DOIs\) \|$/m);
  assert.doesNotMatch(table, /\| spacy2023 \| retraction-watch \| ok \|/);
  // An arXiv DataCite DOI is DataCite's without a lookup.
  const ax = await probeFreshness(src('vaswani2017', '10.48550/arXiv.1706.03762'));
  assert.equal(ax.info?.[0]?.status, 'unknown');
});

test('RUN-03: --dry-run reports "skipped (dry-run)"', async () => {
  const saved = process.env['PENSMITH_DRY_RUN'];
  process.env['PENSMITH_DRY_RUN'] = '1';
  try {
    const r = await probeFreshness(src('x2020', '10.1038/nphys1170'));
    assert.deepEqual(r.skipped, [
      { probe: 'DOI HEAD', detail: 'skipped (dry-run)' },
      { probe: 'retraction-watch', detail: 'skipped (dry-run)' },
    ]);
  } finally {
    if (saved === undefined) delete process.env['PENSMITH_DRY_RUN'];
    else process.env['PENSMITH_DRY_RUN'] = saved;
  }
});

test('runFreshnessForDraft: every cited key gets its rows — from the parsed entries given (bibEntries), not the file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-freshness-draft-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const bibPath = join(root, '.paper', 'CITATIONS.bib');
  writeFileSync(bibPath, 'this file is never read when bibEntries is given');
  const results = await runFreshnessForDraft('A [@aspelmeyer2009] B [@vaswani2017] C [@ghost2099].', bibPath, {
    bibEntries: [
      { id: 'aspelmeyer2009', DOI: '10.1038/nphys1170' },
      { id: 'vaswani2017', eprint: '1706.03762', archivePrefix: 'arXiv' },
    ],
  });
  assert.deepEqual(results.map((r) => r.citekey), ['aspelmeyer2009', 'vaswani2017', 'ghost2099']);
  const table = renderFreshnessTable(results);
  assert.match(table, /\| vaswani2017 \| registrar \| no DOI \| no DOI — checked at arXiv by Pass 1 \|/);
  assert.match(table, /\| ghost2099 \| CITATIONS\.bib \| missing \|/);
  assert.match(table, /\| aspelmeyer2009 \| retraction-watch \| ok \|/);
});

// ---------------------------------------------------------------------------
// Live (the test lane, MockAgent)
// ---------------------------------------------------------------------------

test('freshness (live): DOI HEAD 200 and a clean retraction lookup produce two `ok` rows, no warning', async () => {
  await liveLane(async (agent) => {
    const doi = `10.5555/${uniq('fresh-ok')}`;
    agent.get('https://doi.org').intercept({ path: `/${doi}`, method: 'HEAD' }).reply(200, '');
    const crossref = agent.get('https://api.crossref.org');
    crossref.intercept({ path: (p: string) => decodeURIComponent(p) === `/works/${doi}`, method: 'GET' }).reply(200, work(doi), JSON_HEADERS);
    crossref.intercept({ path: /^\/works\?filter=updates/, method: 'GET' }).reply(200, NO_RETRACTION, JSON_HEADERS);
    const r = await probeFreshness(src('jumper2021', doi));
    assert.deepEqual(r.warnings, []);
    assert.equal(r.skipped, undefined, 'live probes are never skipped');
    const table = renderFreshnessTable([r]);
    assert.match(table, /\| jumper2021 \| DOI HEAD \| ok \|/);
    assert.match(table, /\| jumper2021 \| retraction-watch \| ok \| no retraction notice \|/);
  });
});

test('freshness (live): doi.org\'s 302 is the answer — never followed to the content-negotiation endpoint (which answers HEAD with 405)', async () => {
  await liveLane(async (agent) => {
    const doi = `10.5555/${uniq('fresh-302')}`;
    agent
      .get('https://doi.org')
      .intercept({ path: `/${doi}`, method: 'HEAD' })
      .reply(302, '', { headers: { location: `https://api.crossref.org/v1/works/${encodeURIComponent(doi)}/transform` } });
    const followed: string[] = [];
    const crossref = agent.get('https://api.crossref.org');
    crossref
      .intercept({ path: (p: string) => { if (p.includes('/transform')) followed.push(p); return p.includes('/transform'); }, method: 'HEAD' })
      .reply(405, '')
      .persist();
    crossref.intercept({ path: (p: string) => decodeURIComponent(p) === `/works/${doi}`, method: 'GET' }).reply(200, work(doi), JSON_HEADERS);
    crossref.intercept({ path: /^\/works\?filter=updates/, method: 'GET' }).reply(200, NO_RETRACTION, JSON_HEADERS);
    const r = await probeFreshness(src('lecun2015', doi));
    assert.deepEqual(r.warnings, [], 'a resolving DOI is fresh');
    assert.deepEqual(followed, [], 'the redirect was not followed');
    assert.match(renderFreshnessTable([r]), /\| lecun2015 \| DOI HEAD \| ok \| doi\.org resolves it \(HTTP 302\) \|/);
  });
});

test('freshness (live): DOI HEAD 404 produces a WARN row (advisory, not blocking)', async () => {
  await liveLane(async (agent) => {
    const doi = `10.5555/${uniq('fresh-404')}`;
    agent.get('https://doi.org').intercept({ path: `/${doi}`, method: 'HEAD' }).reply(404, '');
    const crossref = agent.get('https://api.crossref.org');
    crossref.intercept({ path: (p: string) => decodeURIComponent(p) === `/works/${doi}`, method: 'GET' }).reply(200, work(doi), JSON_HEADERS);
    crossref.intercept({ path: /^\/works\?filter=updates/, method: 'GET' }).reply(200, NO_RETRACTION, JSON_HEADERS);
    const r = await probeFreshness(src('jones2019', doi));
    const doiWarn = r.warnings.find((w) => w.probe === 'DOI HEAD');
    assert.ok(doiWarn, 'a 404 DOI HEAD must emit a WARN');
    assert.equal(doiWarn?.status, 'WARN');
    assert.match(doiWarn?.detail ?? '', /DOI HEAD returned 404/);
  });
});

test('carry-over 1 (live): a DOI HEAD that got no answer is an `unavailable` row naming why — never an invented `ok`', async () => {
  await liveLane(async () => {
    // No interceptor: the V5 MockAgent refuses every connection (net connect disabled).
    const r = await probeFreshness(src('ghost2099', `10.5555/${uniq('transport-error')}`));
    assert.deepEqual(r.warnings, [], 'transport noise must NOT produce a WARN');
    const head = r.skipped?.find((s) => s.probe === 'DOI HEAD');
    assert.equal(head?.detail, 'unavailable');
    assert.match(head?.note ?? '', /no answer: .* — re-run verify/);
    // The agency (Crossref) lookup got no answer either: the retraction status is unknown, surfaced.
    const rw = r.skipped?.find((s) => s.probe === 'retraction-watch');
    assert.equal(rw?.detail, 'unavailable');
    const table = renderFreshnessTable([r]);
    assert.match(table, /\| ghost2099 \| DOI HEAD \| unavailable \| no answer:/);
    assert.doesNotMatch(table, /\| ok \|/);
  });
});

test('freshness (live): a 200 carrying an error body is an unknown retraction status, never "not retracted"', async () => {
  await liveLane(async (agent) => {
    const doi = `10.5555/${uniq('rw-inner')}`;
    agent.get('https://doi.org').intercept({ path: `/${doi}`, method: 'HEAD' }).reply(200, '');
    const crossref = agent.get('https://api.crossref.org');
    crossref.intercept({ path: (p: string) => decodeURIComponent(p) === `/works/${doi}`, method: 'GET' }).reply(200, work(doi), JSON_HEADERS);
    crossref
      .intercept({ path: /^\/works\?filter=updates/, method: 'GET' })
      .reply(200, { statusCode: '403', 'message-type': 'not-polite', body: 'Please add a mailto' }, JSON_HEADERS);
    const r = await probeFreshness(src('aspelmeyer2009', doi));
    const rw = r.skipped?.find((s) => s.probe === 'retraction-watch');
    assert.equal(rw?.detail, 'unavailable');
    assert.match(rw?.note ?? '', /retraction status unknown for /);
  });
});

test('freshness (D-19-05): an exhausted or open-breaker host is an "unavailable" row naming why — never "ok"', async () => {
  const { __setRegistrarSendForTest } = await import('../bin/lib/sources/registrar-response.js');
  const { RateLimitExhaustedError } = await import('../bin/lib/http.js');
  await liveLane(async (agent) => {
    const doi = `10.5555/${uniq('exhausted-rw')}`;
    agent.get('https://doi.org').intercept({ path: `/${doi}`, method: 'HEAD' }).reply(200, '');
    try {
      __setRegistrarSendForTest(async () => {
        throw new RateLimitExhaustedError('api.crossref.org', 3_600_000, 429);
      });
      const r = await probeFreshness(src('late2020', doi));
      const rw = r.skipped?.find((s) => s.probe === 'retraction-watch');
      assert.equal(rw?.detail, 'unavailable');
      assert.match(rw?.note ?? '', /rate limit exhausted \(retry after ~60 min\) — re-run verify/);
      assert.match(renderFreshnessTable([r]), /\| late2020 \| retraction-watch \| unavailable \| .*rate limit exhausted/);
    } finally {
      __setRegistrarSendForTest(null);
    }
  });
});

test('VRFY-15 (live): a retraction status LIBRARY.json holds as unknown is re-checked live — never from the HTTP cache — and the answer is recorded', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-freshness-recheck-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const doi = `10.5555/${uniq('recheck')}`;
  await upsertSources(
    root,
    [{ source: 'openalex', id: doi, doi, title: 'A Work', authors: ['Doe, Jane'], year: 2020, retraction_status: 'unknown', last_verified: new Date().toISOString(), citekey: 'doe2020', raw: {} }],
    { provenance: 'research' },
  );
  await liveLane(async (agent) => {
    agent.get('https://doi.org').intercept({ path: `/${doi}`, method: 'HEAD' }).reply(200, '').persist();
    const crossref = agent.get('https://api.crossref.org');
    crossref.intercept({ path: (p: string) => decodeURIComponent(p) === `/works/${doi}`, method: 'GET' }).reply(200, work(doi), JSON_HEADERS).persist();
    let retractionAsks = 0;
    crossref
      .intercept({ path: /^\/works\?filter=updates/, method: 'GET' })
      .reply(() => {
        retractionAsks += 1;
        return { statusCode: 200, data: NO_RETRACTION, responseOptions: JSON_HEADERS };
      })
      .persist();
    const bibPath = join(root, '.paper', 'CITATIONS.bib');
    const first = await runFreshnessForDraft('A claim [@doe2020].', bibPath, { root });
    assert.match(first[0]?.ok?.find((o) => o.probe === 'retraction-watch')?.detail ?? '', /re-checked: LIBRARY\.json had it unknown/);
    const lib = JSON.parse(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8')) as { entries: Array<{ citekey: string; retraction_status: string }> };
    assert.equal(lib.entries.find((e) => e.citekey === 'doe2020')?.retraction_status, 'clear', 'the decided status is recorded through the library writer');
    // Decided now: a second probe is an ordinary one, served from the cache (no second request).
    await runFreshnessForDraft('A claim [@doe2020].', bibPath, { root });
    assert.equal(retractionAsks, 1);
  });
});

test('D-20-13: runFreshnessForDraft with onlyRecheck probes only the cited keys whose LIBRARY.json status is unknown (done\'s re-check: no DOI HEAD)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-freshness-only-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const unknownDoi = `10.5555/${uniq('only-unknown')}`;
  const clearDoi = `10.5555/${uniq('only-clear')}`;
  await upsertSources(
    root,
    [
      { source: 'openalex', id: unknownDoi, doi: unknownDoi, title: 'A Work', authors: ['Doe, Jane'], year: 2020, retraction_status: 'unknown', last_verified: new Date().toISOString(), citekey: 'doe2020', raw: {} },
      { source: 'crossref', id: clearDoi, doi: clearDoi, title: 'Another Work', authors: ['Roe, Rick'], year: 2021, retraction_status: 'clear', last_verified: new Date().toISOString(), citekey: 'roe2021', raw: {} },
    ],
    { provenance: 'research' },
  );
  let heads = 0;
  let works = 0;
  await liveLane(async (agent) => {
    agent.get('https://doi.org').intercept({ path: `/${unknownDoi}`, method: 'HEAD' }).reply(() => {
      heads += 1;
      return { statusCode: 200, data: '' };
    }).persist();
    const crossref = agent.get('https://api.crossref.org');
    crossref.intercept({ path: (p: string) => decodeURIComponent(p) === `/works/${unknownDoi}`, method: 'GET' }).reply(() => {
      works += 1;
      return { statusCode: 200, data: work(unknownDoi), responseOptions: JSON_HEADERS };
    }).persist();
    crossref.intercept({ path: /^\/works\?filter=updates/, method: 'GET' }).reply(200, NO_RETRACTION, JSON_HEADERS).persist();
    const results = await runFreshnessForDraft('Claims [@doe2020] and [@roe2021].', join(root, '.paper', 'CITATIONS.bib'), { root, onlyRecheck: true });
    assert.deepEqual(results.map((r) => r.citekey), ['doe2020'], 'the decided source is not probed');
    assert.equal(heads, 0, 'done\'s re-check sends no DOI HEAD (its answer is not used there)');
    assert.equal(works, 1, 'Crossref\'s record of the DOI names its agency');
    const lib = JSON.parse(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8')) as { entries: Array<{ citekey: string; retraction_status: string }> };
    assert.equal(lib.entries.find((e) => e.citekey === 'doe2020')?.retraction_status, 'clear');
  });
});
