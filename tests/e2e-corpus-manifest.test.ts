// tests/e2e-corpus-manifest.test.ts — GRND-18 (D-18-31): the recorded e2e
// corpus is complete, safe to commit, and replays OFFLINE through the real
// modules under the test runner.
//
// The corpus (`npm run cassettes:refresh -- --corpus e2e`) is:
//   tests/fixtures/e2e-corpus/MANIFEST.json      what was recorded and what to expect
//   tests/fixtures/e2e-corpus/mock-script.json   scripted intake-clarifier, topic-disambiguator
//                                                and source-evaluator (keep-list) replies
//   tests/fixtures/cassettes/e2e/<adapter>/      the recordings
// This test checks the manifest against the files (every listed cassette
// exists, is ≤ 51200 bytes, carries recorder provenance for its adapter, holds
// no secret header or contact email, and no stray file sits in the root), the
// scripted replies against their contracts and the manifest, and then REPLAYS
// the chain's source requests offline: research's discovery over the scripted
// queries finds every kept source with its DOI, the expected misses are misses,
// and every kept source's retraction cross-check and Pass 1 are OK — exactly
// what the chain (tests/helpers/e2e-chain.ts) will request.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { REPO, loadE2eManifest, loadE2eMockScript, type E2eManifest } from './helpers/e2e-chain.js';
import { SENSITIVE_HEADERS, SCRUBBED_QUERY_PARAMS, networkMode, lookupFixture, type Cassette } from '../bin/lib/http-mock.js';
import { contractFor } from '../bin/lib/llm-contracts.js';
import { discoverCandidates, researchAdapterPlan, researchRegistry } from '../bin/lib/research-orchestrator.js';
import { crossCheckRetractions } from '../bin/lib/sources/retraction-cross-check.js';
import { upsertSources } from '../bin/lib/library.js';
import { runPass1 } from '../bin/lib/verify/pass1.js';
import { sources } from '../bin/lib/sources/index.js';
import { isOfflineEgressError } from '../bin/lib/http.js';
import { normalizeDoi } from '../bin/lib/doi.js';

process.env['PENSMITH_NO_LLM'] = '1'; // the replayed research's evaluator runs as its contract stub

const MAX_CASSETTE_BYTES = 51200;
const RECORDER = 'scripts/refresh-cassettes.mjs';
const manifest: E2eManifest = loadE2eManifest();
const cassetteRoot = join(REPO, ...manifest.cassetteRoot.split('/'));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function repoRel(p: string): string {
  return relative(REPO, p).split(sep).join('/');
}

test('D-18-31: the manifest names the PRD §15 assignment (hash-pinned), the mock script, the cassette root and a run bound of 5 + N', () => {
  assert.equal(manifest.$schemaVersion, 1);
  assert.equal(manifest.assignment, 'tests/fixtures/assignment.txt');
  const assignment = readFileSync(join(REPO, ...manifest.assignment.split('/')));
  assert.equal(createHash('sha256').update(assignment).digest('hex'), manifest.assignmentSha256, 'the corpus was recorded for this assignment');
  assert.equal(manifest.mockScript, 'tests/fixtures/e2e-corpus/mock-script.json');
  assert.equal(manifest.cassetteRoot, 'tests/fixtures/cassettes/e2e');
  assert.ok(manifest.queries.length >= 1 && manifest.queries.every((q) => q.trim().length > 0));
  assert.ok(manifest.keptSources.length >= 1 && manifest.keptSources.length <= 6, `1..6 kept sources, got ${manifest.keptSources.length}`);
  for (const k of manifest.keptSources) assert.ok(normalizeDoi(k.doi) !== null, `${k.citekey} carries a DOI (${k.doi})`);
  assert.ok(Number.isInteger(manifest.expectedSections) && manifest.expectedSections >= 3);
  assert.equal(manifest.runBound, 5 + manifest.expectedSections, 'new, research, outline, one step per section, compile, done');
  assert.ok(!Number.isNaN(Date.parse(manifest.recordedAt)));
  assert.equal(manifest.recorder, `${RECORDER} --corpus e2e`);
  for (const miss of manifest.adapters.expectedMiss) {
    assert.ok(manifest.queries.includes(miss.query), `an expected miss names a recorded query: ${miss.query}`);
    assert.ok(miss.why.length > 0, 'every expected miss says why');
  }
});

test('D-18-31: every cassette the manifest lists exists, is ≤ 51200 bytes, carries recorder provenance and no secret — and none is unlisted', () => {
  assert.ok(existsSync(cassetteRoot), `${manifest.cassetteRoot} exists`);
  const onDisk = walk(cassetteRoot).map(repoRel).sort();
  assert.deepEqual(onDisk, [...manifest.cassettes].sort(), 'the manifest lists exactly the files under the cassette root');
  const recordedAdapters = new Set<string>();
  for (const rel of manifest.cassettes) {
    const file = join(REPO, ...rel.split('/'));
    const adapter = rel.slice(manifest.cassetteRoot.length + 1).split('/')[0] ?? '';
    recordedAdapters.add(adapter);
    const text = readFileSync(file, 'utf8');
    assert.ok(Buffer.byteLength(text, 'utf8') <= MAX_CASSETTE_BYTES, `${rel} is ≤ ${MAX_CASSETTE_BYTES} bytes`);
    assert.ok(!text.includes('pensmith-dev@example.org'), `${rel}: the recording contact address is redacted`);
    const entries = JSON.parse(text) as Cassette[];
    assert.ok(Array.isArray(entries) && entries.length > 0, `${rel} is a non-empty Cassette[]`);
    for (const e of entries) {
      assert.equal(e.provenance?.recorder, RECORDER, `${rel}: recorded by ${RECORDER}`);
      assert.equal(e.provenance?.adapter, adapter, `${rel}: provenance.adapter is its directory`);
      assert.match(e.scope, /^https:\/\//, `${rel}: https only`);
      assert.equal(e.status, 200, `${rel}: only successful answers are recorded`);
      for (const h of Object.keys(e.responseHeaders ?? {})) assert.ok(!SENSITIVE_HEADERS.has(h.toLowerCase()), `${rel}: no ${h} header`);
      for (const k of new URL(`${e.scope}${e.path}`).searchParams.keys()) {
        assert.ok(!SCRUBBED_QUERY_PARAMS.has(k.toLowerCase()), `${rel}: scrubbed param "${k}" is not committed`);
      }
    }
  }
  assert.deepEqual([...recordedAdapters].sort(), [...manifest.adapters.recorded].sort(), 'adapters.recorded names the recorded directories');
});

test('D-18-31: the scripted replies satisfy their contracts and agree with the manifest', () => {
  const script = loadE2eMockScript(manifest);
  assert.deepEqual(Object.keys(script).sort(), ['intake-clarifier', 'source-evaluator', 'topic-disambiguator']);
  for (const [slug, replies] of Object.entries(script)) {
    const contract = contractFor(slug);
    assert.ok(contract, `${slug} is a structured slug`);
    assert.equal(replies.length, 1, `${slug}: one scripted reply`);
    const parsed = contract.schema.safeParse(replies[0]?.data);
    assert.ok(parsed.success, `${slug}: the scripted reply satisfies its contract: ${parsed.success ? '' : parsed.error.message}`);
  }
  const intake = script['intake-clarifier']?.[0]?.data as { topic: string; discipline: string; length_target_words: number };
  assert.equal(intake.topic, manifest.topic);
  assert.equal(intake.discipline, manifest.discipline);
  assert.equal(intake.length_target_words, 1500, 'the assignment asks for 1500 words');
  const scopes = (script['topic-disambiguator']?.[0]?.data as { scopes: Array<{ queries: string[] }> }).scopes;
  assert.equal(scopes.length, 1, 'one scope: research asks no scope question');
  assert.deepEqual(scopes[0]?.queries, [...manifest.queries], 'the scripted queries are the recorded ones');
  const verdicts = (script['source-evaluator']?.[0]?.data as { verdicts: Array<{ citekey: string; keep: boolean }> }).verdicts;
  assert.deepEqual(
    verdicts.filter((v) => v.keep).map((v) => v.citekey).sort(),
    manifest.keptSources.map((k) => k.citekey).sort(),
    'the evaluator keeps exactly the kept sources',
  );
});

test('D-18-31: offline under the test runner, the corpus answers the chain — research finds every kept source, and each passes the retraction check and Pass 1', async () => {
  const mode = networkMode();
  assert.equal(mode.sourcesOffline, true, 'sources are offline under the test runner');
  assert.equal(mode.dryRun, false);
  const root = mkdtempSync(join(tmpdir(), 'pensmith-e2e-corpus-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  // The discovery `pensmith research` runs (bin/cli/research.ts): the preset's
  // adapter plan, every query to every planned adapter, dedup and citekeys.
  const registry = researchRegistry();
  const plan = researchAdapterPlan({ registry, byPreference: true, discipline: manifest.discipline, configDiscipline: undefined, allowed: undefined });
  const { candidates } = await discoverCandidates({ queries: [...manifest.queries], plan, registry, warn: () => undefined });
  const byKey = new Map(candidates.map((d) => [d.candidate.citekey, d.candidate]));
  const kept = manifest.keptSources.map((k) => {
    const c = byKey.get(k.citekey);
    assert.ok(c, `the replayed research finds kept source ${k.citekey}`);
    assert.equal(c.doi, k.doi, `${k.citekey} keeps its DOI`);
    return c;
  });
  // An expected miss is a miss: the adapter's own request for that query has no recorded fixture.
  for (const miss of manifest.adapters.expectedMiss) {
    const adapter = (sources as unknown as Record<string, { search?: (q: string, o: { limit: number }) => Promise<unknown> }>)[miss.adapter];
    assert.ok(adapter?.search, `${miss.adapter} is a search adapter`);
    await assert.rejects(
      () => adapter.search!(miss.query, { limit: 10 }),
      (e: unknown) => isOfflineEgressError(e),
      `${miss.adapter} "${miss.query}" misses offline (${miss.why})`,
    );
  }
  await crossCheckRetractions(kept);
  assert.ok(kept.every((c) => c.retracted !== true), 'no kept source is retracted');
  await upsertSources(root, kept, { provenance: 'research' });
  const draft = `# Section\n\n${kept.map((c) => `A claim [@${c.citekey}].`).join(' ')}\n`;
  const verdicts = await runPass1(draft, join(root, '.paper', 'CITATIONS.bib'));
  assert.equal(verdicts.length, kept.length);
  for (const v of verdicts) assert.equal(v.verdict, 'OK', `offline Pass 1 of ${v.citekey}: ${v.reason}`);
});

test('D-18-31: every recorded search is answered from its own cassette file by the exact-match store', () => {
  for (const rel of manifest.cassettes) {
    for (const e of JSON.parse(readFileSync(join(REPO, ...rel.split('/')), 'utf8')) as Cassette[]) {
      const hit = lookupFixture(e.method, `${e.scope}${e.path}`);
      assert.ok(hit, `${rel}: ${e.method} ${e.scope}${e.path} replays`);
      assert.equal(repoRel(hit.file), rel, 'answered by its own file');
    }
  }
});
