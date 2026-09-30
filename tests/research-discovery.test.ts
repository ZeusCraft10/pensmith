// tests/research-discovery.test.ts — the research pass's discovery half
// (GEN-03, D-17-10, SRC-07; bin/lib/research-orchestrator.ts).
//
// runResearchPassWithLog(queries, opts) (tests/helpers/research-pass.ts) runs
// one research pass (adapters → dedup → tiers → policy → evaluator) plus its
// log in .paper/RESEARCH.md from the same exported pieces `pensmith research`
// runs, without the library write the verb owns. These cases run
// it against the recorded source cassettes (the test runner is sources-offline,
// RUN-01: exact fixtures or a fail-closed miss) and against injected fake
// adapters.
//
// Offline (T-12-W0-02): PENSMITH_NO_LLM=1 is set before any import, so the
// source-evaluator is the deterministic stub (it keeps every candidate). The
// topic 'attention mechanisms in neural networks' is the query
// scripts/refresh-cassettes.mjs records; any other query is an offline miss.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env['PENSMITH_NO_LLM'] = '1';

function repoPath(rel: string): string {
  return fileURLToPath(new URL('../' + rel, import.meta.url));
}

const orchestratorSrcPath = repoPath('bin/lib/research-orchestrator.ts');
const researchSrcPath = repoPath('bin/cli/research.ts');

function mkPaperRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-discovery-'));
  fs.mkdirSync(path.join(tmp, '.paper'), { recursive: true });
  return tmp;
}

const SEARCHABLE = 'attention mechanisms in neural networks';
const orch = await import('../bin/lib/research-orchestrator.js');
const { runResearchPassWithLog } = await import('./helpers/research-pass.js');
const { RESEARCH_LOG_END } = await import('../bin/lib/research-md.js');

async function captureStderr<T>(fn: () => Promise<T>): Promise<{ value: T; stderr: string }> {
  const lines: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    lines.push(String(s));
    return true;
  };
  try {
    return { value: await fn(), stderr: lines.join('') };
  } finally {
    (process.stderr as unknown as { write: typeof orig }).write = orig;
  }
}

test('research-discovery: the recorded fan-out returns deduped, validated candidates and logs every adapter per query (GEN-03, SRC-07)', async () => {
  const root = mkPaperRoot();
  const { value: candidates } = await captureStderr(() =>
    runResearchPassWithLog([SEARCHABLE], { topic: SEARCHABLE, discipline: 'cs', paperRoot: root }),
  );
  assert.ok(candidates.length >= 1, `>=1 candidate from the cassettes (got ${candidates.length})`);
  for (const c of candidates) {
    assert.ok(c.id.length > 0 && c.title.length > 0 && c.authors.length > 0, JSON.stringify(c).slice(0, 200));
    assert.match(c.citekey, /^[a-z][a-z0-9_-]*$/);
  }
  assert.equal(new Set(candidates.map((c) => c.citekey)).size, candidates.length, 'citekeys are unique');

  // D-17-10 / §3.4: the research log, marker first.
  const researchMd = fs.readFileSync(path.join(root, '.paper', 'RESEARCH.md'), 'utf8');
  const lines = researchMd.split(/\r?\n/);
  assert.equal(lines[0], '> OFFLINE MODE (test runner) — recorded fixtures, not live results.');
  assert.ok(lines.includes('# Research log'));
  assert.ok(lines.includes('Scope: auto'));
  assert.ok(lines.includes(`1. ${SEARCHABLE}`), 'the query is listed');
  assert.ok(lines.includes('| Adapter | Results | Status |'), 'the per-adapter table');
  assert.match(researchMd, new RegExp(`\\| ${SEARCHABLE} \\| crossref \\| [1-9]\\d* \\| ok \\|`), 'per-query count');
  assert.match(researchMd, new RegExp(`\\| ${SEARCHABLE} \\| openalex \\| 0 \\| offline: no recorded fixture \\|`), 'an offline miss is reported per adapter');
  // SRC-10: a computer-science paper queries the preset's adapters first.
  const adapterRows = lines.filter((l) => /^\| [a-z]+ \| \d+ \| /.test(l)).map((l) => l.split('|')[1]!.trim());
  assert.deepEqual(adapterRows.slice(0, 3), ['arxiv', 'semanticscholar', 'openalex'], `preset order first: ${adapterRows.join(', ')}`);
  assert.match(researchMd, new RegExp(`## Sources \\(${candidates.length}\\)`));
  for (const c of candidates) assert.ok(researchMd.includes(`[@${c.citekey}]`), `candidate ${c.citekey} is listed`);
  assert.ok(researchMd.includes(RESEARCH_LOG_END));
});

test('RUN-03 / D-17-10: an unrecorded query offline prints "offline: no recorded results for this query" and yields 0 candidates', async () => {
  const root = mkPaperRoot();
  const { value: candidates, stderr } = await captureStderr(() =>
    runResearchPassWithLog(['medieval Icelandic sagas'], { topic: 'medieval Icelandic sagas', discipline: 'history', paperRoot: root }),
  );
  assert.equal(candidates.length, 0, 'no fixture is ever substituted for another query');
  assert.match(stderr, /offline: no recorded results for this query \("medieval Icelandic sagas"\)/);
  const researchMd = fs.readFileSync(path.join(root, '.paper', 'RESEARCH.md'), 'utf8');
  assert.match(researchMd, /^> OFFLINE MODE \(test runner\)/);
  assert.match(researchMd, /\| openalex \| 0 \| offline: no recorded fixture \|/);
  assert.match(researchMd, /## Sources \(0\)/);
});

test('D-17-10: a research re-run rewrites only the generated log — notes below the end line are kept', async () => {
  const root = mkPaperRoot();
  const rPath = path.join(root, '.paper', 'RESEARCH.md');
  // A pre-existing notes file (no research log yet) is kept below the new log.
  const notes = '### vaswani2017\nsupports: attention alone suffices for translation\n';
  fs.writeFileSync(rPath, notes);
  const run = (topic: string): Promise<unknown> =>
    captureStderr(() => runResearchPassWithLog([topic], { topic, discipline: 'history', paperRoot: root }));
  await run('medieval Icelandic sagas');
  const first = fs.readFileSync(rPath, 'utf8');
  assert.match(first, /^> OFFLINE MODE \(test runner\)/, 'the marker stays the first line');
  assert.ok(first.includes(RESEARCH_LOG_END));
  assert.ok(first.endsWith(notes), 'the existing notes are kept verbatim below the log');
  fs.appendFileSync(rPath, '\n### appended2020\nsupports: an appended finding\n');
  await run('norse skaldic poetry');
  const second = fs.readFileSync(rPath, 'utf8');
  assert.equal(second.split(RESEARCH_LOG_END).length, 2, 'exactly one end line');
  const [log, kept] = second.split(RESEARCH_LOG_END) as [string, string];
  assert.match(log, /1\. norse skaldic poetry/);
  assert.ok(!log.includes('medieval Icelandic sagas'), 'the previous log is replaced, not stacked');
  assert.ok(kept.includes(notes) && kept.includes('### appended2020'), 'every note below the end line is kept');
});

test('research-discovery: two candidates with the same DOI collapse to one, keeping both adapters and the best rank', async () => {
  const now = new Date().toISOString();
  const base = { title: 'Attention Is All You Need', authors: ['Vaswani, Ashish'], year: 2017, retracted: false, last_verified: now, citekey: 'vaswani2017', raw: {} };
  const registry = {
    crossref: { search: async () => [{ ...base, source: 'crossref' as const, id: '10.48550/arXiv.1706.03762', doi: '10.48550/arXiv.1706.03762' }] },
    arxiv: { search: async () => [{ ...base, source: 'arxiv' as const, id: '1706.03762', doi: 'https://doi.org/10.48550/ARXIV.1706.03762', abstract: 'The dominant sequence transduction models…' }] },
  };
  const plan = orch.researchAdapterPlan({ registry, byPreference: false, discipline: 'other' });
  const d = await orch.discoverCandidates({ queries: ['q'], plan, registry, warn: () => undefined });
  assert.equal(d.found, 2);
  assert.equal(d.candidates.length, 1, 'normalizeDoi dedup');
  assert.deepEqual([...d.candidates[0]!.foundBy], ['crossref', 'arxiv']);
  assert.equal(d.candidates[0]!.rank, 0, 'the best preference rank');
  assert.ok(d.candidates[0]!.candidate.abstract, 'the record with an abstract wins');
});

test('review round 1: an arXiv hit and a registrar hit of one DOI → the registrar\'s record (the version of record) is kept, with the arXiv id and abstract', async () => {
  const now = new Date().toISOString();
  const common = { retracted: false, last_verified: now, raw: {}, year: 2019 };
  const registry = {
    arxiv: {
      search: async () => [{
        ...common, source: 'arxiv' as const, id: 'http://arxiv.org/abs/1903.00001v2', arxiv: '1903.00001', doi: '10.1016/j.example.2019.07.001',
        title: 'Measuring the Unmeasured: a preprint title', authors: ['Righi, Anna', 'Biondi, Bruno'], citekey: 'righi2019', type: 'preprint' as const,
        abstract: 'The preprint abstract.',
      }],
    },
    crossref: {
      search: async () => [{
        ...common, source: 'crossref' as const, id: '10.1016/j.example.2019.07.001', doi: '10.1016/j.example.2019.07.001',
        title: 'Measuring the unmeasured', authors: ['Biondi, Bruno', 'Righi, Anna'], citekey: 'biondi2019', type: 'article-journal' as const,
      }],
    },
  };
  const plan = orch.researchAdapterPlan({ registry, byPreference: false, discipline: 'other' });
  const d = await orch.discoverCandidates({ queries: ['q'], plan, registry, warn: () => undefined });
  assert.equal(d.candidates.length, 1, 'one work');
  const c = d.candidates[0]!.candidate;
  assert.equal(c.source, 'crossref', "the version of record's record, not arXiv's preprint metadata under the journal DOI");
  assert.equal(c.title, 'Measuring the unmeasured');
  assert.deepEqual(c.authors, ['Biondi, Bruno', 'Righi, Anna']);
  assert.equal(c.arxiv, '1903.00001', "the preprint's arXiv id is carried over");
  assert.equal(c.abstract, 'The preprint abstract.', "and its abstract, which the record lacks");
});

test('research-discovery: crossCheckRetractions runs BEFORE the library write (D-15 LOCKED ordering)', () => {
  const researchSrc = fs.readFileSync(researchSrcPath, 'utf8');
  const crossCheckIdx = researchSrc.indexOf('crossCheckRetractions(');
  const upsertIdx = researchSrc.indexOf('upsertSources(');
  assert.ok(crossCheckIdx !== -1, 'research.ts must still call crossCheckRetractions (D-15 LOCKED)');
  assert.ok(upsertIdx !== -1, 'research.ts must write the library through upsertSources (BRDTH-01)');
  assert.ok(crossCheckIdx < upsertIdx, `D-15: crossCheckRetractions (char ${crossCheckIdx}) must come before upsertSources (char ${upsertIdx})`);
  assert.ok(!researchSrc.includes('writeBibtex(') && !researchSrc.includes('writeRis('), 'research.ts never renders CITATIONS.bib/.ris itself');
  const orchSrc = fs.readFileSync(orchestratorSrcPath, 'utf8');
  assert.ok(!orchSrc.includes('writeBibtex(') && !orchSrc.includes('upsertSources('), 'the orchestrator never writes the library');
  // SRC-07: the keep-all fallback is gone.
  assert.doesNotMatch(orchSrc, /keeping all \$\{candidates\.length\}|defensive fallback to avoid empty result/, 'no keep-all fallback');
});

test('D-17-10: an adapter whose request failed (HTTP 429 after retries) is `failed (…)` in RESEARCH.md — never `no results` — with one stderr line', async () => {
  const root = mkPaperRoot();
  const { httpFailureReason } = await import('../bin/lib/sources/search-failure.js');
  const registry = {
    'rate-limited': {
      async search(_q: string, opts: { onFailure?: (r: string) => void } = {}) {
        opts.onFailure?.(httpFailureReason(429));
        return [];
      },
    },
    empty: { async search() { return []; } },
  };
  const { stderr } = await captureStderr(() =>
    runResearchPassWithLog(['query one', 'query two'], { topic: 'attention', discipline: 'other', paperRoot: root, registry }),
  );
  const md = fs.readFileSync(path.join(root, '.paper', 'RESEARCH.md'), 'utf8');
  assert.match(md, /\| query one \| rate-limited \| 0 \| failed \(HTTP 429 after retries\) \|/);
  assert.match(md, /\| query two \| rate-limited \| 0 \| failed \(HTTP 429 after retries\) \|/);
  assert.match(md, /\| query one \| empty \| 0 \| no results \|/, 'an empty answer is still `no results`');
  assert.match(md, /\| rate-limited \| 0 \| failed \(HTTP 429 after retries\) \|/, 'the aggregated adapter row');
  const warns = stderr.split('\n').filter((l) => l.includes('rate-limited failed'));
  assert.deepEqual(warns, ['pensmith research: WARN — rate-limited failed (HTTP 429 after retries) for 2 of 2 queries; its results are missing from this run (see RESEARCH.md)']);
});

test('D-17-10: a source adapter reports its failed search request through onFailure (HTTP status, then a transport error) and still returns []', async () => {
  const saved = process.env['PENSMITH_NETWORK_TESTS'];
  process.env['PENSMITH_NETWORK_TESTS'] = '1';
  const { installMockAgent } = await import('./helpers/local-servers/mock-agent.js');
  const http = await import('../bin/lib/http.js');
  const openalex = await import('../bin/lib/sources/openalex.js');
  const mock = installMockAgent();
  http.__setHttpTestSeams({ resolve: async () => [{ address: '203.0.113.9', family: 4 }] });
  try {
    mock.agent.get('https://api.openalex.org').intercept({ path: /\/works\?/, method: 'GET' }).reply(404, '{}');
    const reasons: string[] = [];
    const hits = await openalex.search('pensmith onfailure probe', { limit: 3, onFailure: (r) => reasons.push(r) });
    assert.deepEqual(hits, []);
    assert.deepEqual(reasons, ['HTTP 404']);
    mock.agent.get('https://api.openalex.org').intercept({ path: /\/works\?/, method: 'GET' }).reply(200, 'not json');
    const again: string[] = [];
    assert.deepEqual(await openalex.search('pensmith onfailure probe two', { onFailure: (r) => again.push(r) }), []);
    assert.equal(again.length, 1);
    // SRC-17 / D-19-05: a 200 whose body is not the service's answer is a named failure (and never cached).
    assert.equal(again[0]!, 'response is not an OpenAlex answer (unreadable JSON)');
    // A retryable status fetch() gave up on arrives as a thrown error carrying it.
    const { errorFailureReason } = await import('../bin/lib/sources/search-failure.js');
    assert.equal(errorFailureReason(Object.assign(new Error('HTTP 503'), { status: 503 })), 'HTTP 503 after retries');
    assert.equal(errorFailureReason(Object.assign(new Error('boom'), { code: 'ECONNRESET' })), 'boom');
  } finally {
    http.__setHttpTestSeams(null);
    await mock.restore();
    if (saved === undefined) delete process.env['PENSMITH_NETWORK_TESTS'];
    else process.env['PENSMITH_NETWORK_TESTS'] = saved;
  }
});
