// tests/research-cli-lane.test.ts — research through the BUILT CLI on recorded
// sources (19-PLAN §7.4; SRC-07, SRC-09, SRC-10).
//
// The fixture lane: `node dist/bin/pensmith.js research …` in a sandboxed
// paper under the test runner, so every source request is answered by a real
// recording (tests/fixtures/cassettes/**) or refused as `offline: no recorded
// fixture`, and the model is the in-process RUN-21 mock with scripted replies.
// The topic disambiguator's scope has the one recorded research query
// ("attention mechanisms in neural networks") and four unrecorded ones. The
// candidates the recordings yield are computed in-process with the same
// research pass (discoverCandidates on the same plan and queries) so the
// scripted evaluator can keep and reject real citekeys.
//
//   SRC-07: stdout and RESEARCH.md carry the per-adapter table naming crossref,
//           openalex, pubmed, arxiv and semanticscholar with a count or a
//           reason; an evaluator that rejects every candidate → "no relevant
//           sources", exit 1, no LIBRARY.json.
//   SRC-09: every kept source is listed in RESEARCH.md with its tier, its
//           abstract (when it has one) and why-relevant = the evaluator's
//           reason; LIBRARY.json entries carry tier / relevance / why_relevant
//           and validate against schema v3; the numbered prune question shows
//           tiers, excerpts and the rejections with their reason, and accepts
//           a DOI to add before the library is written.
//   SRC-10: `min_year = 2015` + `allow_preprints = false` → no pre-2015 work
//           and no arXiv-only preprint in LIBRARY.json; the exclusions are
//           listed with their rule; the date-filtered requests are the ones
//           made.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox, readJsonl, type LlmSandbox } from './helpers/llm-sandbox.js';
import { runBuilt } from './helpers/built-cli.js';
import { renderIntakeDocument } from '../bin/lib/intake-brief.js';
import { Schema as LibrarySchema, CURRENT_LIBRARY_VERSION } from '../bin/lib/schemas/library.js';
import { discoverCandidates, researchAdapterPlan, type AdapterRegistry, type DiscoveredCandidate } from '../bin/lib/research-orchestrator.js';
import { sources } from '../bin/lib/sources/index.js';
import { SOURCES_START } from '../bin/lib/research-md.js';
import { isResearchDone } from '../bin/lib/research-sentinel.js';

const KEY = 'sk-test-research-cli-lane-0001';
const RECORDED_QUERY = 'attention mechanisms in neural networks';
const QUERIES = [RECORDED_QUERY, 'self attention layers', 'transformer attention heads', 'attention interpretability', 'sparse attention models'];
const DB_ADAPTERS = ['arxiv', 'semanticscholar', 'openalex', 'crossref', 'pubmed'];

function seedBrief(sb: LlmSandbox): void {
  fs.writeFileSync(
    path.join(sb.paper, 'INTAKE.md'),
    renderIntakeDocument(
      { topic: RECORDED_QUERY, discipline: 'computer-science', paper_type: 'literature-review' },
      `Write a 3000-word literature review on ${RECORDED_QUERY}.`,
      [],
    ),
  );
}

function scriptScope(sb: LlmSandbox): void {
  sb.mock!.script('topic-disambiguator', {
    data: { ambiguous: false, scopes: [{ label: 'attention-mechanisms', description: 'Attention mechanisms in neural networks.', queries: QUERIES }] },
  });
}

/** The candidates the recordings yield for QUERIES — the research pass the CLI will run. */
async function recordedCandidates(fromYear?: number): Promise<DiscoveredCandidate[]> {
  const registry = sources as unknown as AdapterRegistry;
  const plan = researchAdapterPlan({ registry, byPreference: true, discipline: 'computer-science', env: {} });
  const d = await discoverCandidates({ queries: QUERIES, plan, registry, fromYear, warn: () => undefined });
  return d.candidates;
}

/** Evaluator verdicts for `cands`: the first `reject` are rejected with a reason, the rest kept. */
function verdictsFor(cands: readonly DiscoveredCandidate[], reject: number): Array<Record<string, unknown>> {
  return cands.map((c, i) => {
    const key = c.candidate.citekey;
    return i < reject
      ? { citekey: key, keep: false, reason: `Off-scope for this review (${key}).`, relevance: 0.05, tier: 'other' }
      : { citekey: key, keep: true, reason: `Evidence on attention for the review (${key}).`, relevance: Number((0.95 - i * 0.01).toFixed(2)), tier: 'other' };
  });
}

function library(sb: LlmSandbox): ReturnType<typeof LibrarySchema.parse> {
  const raw = JSON.parse(fs.readFileSync(path.join(sb.paper, 'LIBRARY.json'), 'utf8')) as { $schemaVersion: number };
  assert.equal(raw.$schemaVersion, CURRENT_LIBRARY_VERSION, 'LIBRARY.json is written at the current schema version (v3)');
  return LibrarySchema.parse(raw);
}

function env(): Record<string, string | undefined> {
  return { ANTHROPIC_API_KEY: KEY, PENSMITH_NO_LLM: undefined };
}

test('SRC-07 / SRC-09 (built CLI, recorded sources): the per-adapter table, and every kept source with its tier, abstract and the evaluator\'s reason', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: env() }, async (sb) => {
    seedBrief(sb);
    const cands = await recordedCandidates();
    assert.ok(cands.length >= 20, `the recordings yield candidates (${cands.length})`);
    scriptScope(sb);
    sb.mock!.script('source-evaluator', { data: { verdicts: verdictsFor(cands, 2) } });

    const r = await runBuilt(sb, ['research', '--yolo']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);

    // §3.5 stdout: the per-adapter table names every default database with a count or a reason.
    assert.match(r.stdout, /^pensmith research: sources by adapter$/m);
    for (const a of DB_ADAPTERS) {
      assert.match(r.stdout, new RegExp(`^ {2}${a} +\\d+ {2}(?:ok|no results|offline: no recorded fixture|failed \\(.+\\))`, 'm'), `stdout row for ${a}`);
    }
    assert.match(r.stdout, /^ {2}crossref +10 {2}ok; no recorded fixture for 4 of 5 queries$/m, 'counts and the offline reason, per adapter');
    assert.match(r.stdout, /^ {2}openalex +0 {2}offline: no recorded fixture$/m);

    // RESEARCH.md: the same table, then every kept source.
    const md = fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8');
    for (const a of DB_ADAPTERS) assert.match(md, new RegExp(`^\\| ${a} \\| \\d+ \\| .+ \\|$`, 'm'), `RESEARCH.md row for ${a}`);
    assert.match(md, /^\| zotero \| 0 \| skipped \(not configured\) \|$/m);
    assert.match(md, /^Result: \d+ kept \(.+\); \d+ excluded by \[sources\] policy; 2 rejected by the evaluator$/m);

    const lib = library(sb);
    const kept = new Set(lib.entries.map((e) => e.citekey));
    const rejected = cands.slice(0, 2).map((c) => c.candidate.citekey);
    for (const k of rejected) {
      assert.ok(!kept.has(k), `the evaluator's rejection ${k} is not in the library`);
      assert.match(md, new RegExp(`^- \\[@${k}\\] .* — evaluator: Off-scope for this review \\(${k}\\)\\.$`, 'm'));
    }
    assert.ok(lib.entries.length >= 10, `kept sources in the library (${lib.entries.length})`);
    const block = md.slice(md.indexOf(SOURCES_START));
    for (const e of lib.entries) {
      assert.ok(e.tier !== null, `${e.citekey} has a tier`);
      assert.equal(typeof e.relevance, 'number', `${e.citekey} has a relevance`);
      assert.equal(e.why_relevant, `Evidence on attention for the review (${e.citekey}).`, 'why-relevant is the evaluator\'s reason');
      assert.ok(e.provenance.some((p) => p.startsWith('research:')), `${e.citekey} is tagged by the research path`);
      const item = new RegExp(`^- \\[@${e.citekey}\\] .*\\n {2}- Tier: ${e.tier} · Relevance: ${e.relevance!.toFixed(2)} · Tags: search\\n {2}- Why relevant: Evidence on attention for the review \\(${e.citekey}\\)\\.`, 'm');
      assert.match(block, item, `RESEARCH.md lists ${e.citekey} with its tier and why-relevant`);
      if (e.abstract) assert.match(block, new RegExp(`\\(${e.citekey}\\)\\.\\n {2}- Abstract: \\S`), `${e.citekey}'s abstract is shown`);
    }
    // The evaluator saw each candidate once (one call, ≤ 150 candidates).
    assert.equal(sb.mock!.callCount('source-evaluator'), 1);
  });
});

test('SRC-07 (built CLI): an evaluator that rejects every candidate → "no relevant sources", exit 1, no library written', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: env() }, async (sb) => {
    seedBrief(sb);
    const cands = await recordedCandidates();
    scriptScope(sb);
    sb.mock!.script('source-evaluator', { data: { verdicts: verdictsFor(cands, cands.length) } });
    const r = await runBuilt(sb, ['research', '--yolo']);
    assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /^pensmith research: no relevant sources — the evaluator rejected all \d+ candidate\(s\) for scope "attention-mechanisms"; refine the topic/m);
    assert.ok(!fs.existsSync(path.join(sb.paper, 'LIBRARY.json')), 'LIBRARY.json is not written');
    assert.ok(!fs.existsSync(path.join(sb.paper, 'CITATIONS.bib')));
    assert.match(fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8'), /^Result: no relevant sources$/m, 'the log says why');
    // …so the paper stays at the research stage (D-19-16; tests/research-sentinel.test.ts).
    assert.equal(isResearchDone(sb.paper), false);
  });
});

test('SRC-10 (built CLI): min_year = 2015 and allow_preprints = false → no pre-2015 work and no arXiv-only preprint in LIBRARY.json', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: env() }, async (sb) => {
    seedBrief(sb);
    sb.writePaperConfig('schema_version = 1\n\n[sources]\nmin_year = 2015\nallow_preprints = false\n');
    const cands = await recordedCandidates(2015);
    scriptScope(sb);
    sb.mock!.script('source-evaluator', { data: { verdicts: verdictsFor(cands, 0) } });
    const r = await runBuilt(sb, ['research', '--yolo']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);

    const lib = library(sb);
    assert.ok(lib.entries.length > 0, 'some sources pass the policy');
    for (const e of lib.entries) {
      assert.ok(e.year === null || e.year >= 2015, `${e.citekey} (${e.year}) is not older than min_year`);
      assert.notEqual(e.tier, 'preprint', `${e.citekey} is not a preprint`);
      const arxivOnly = e.arxiv !== null && e.doi === null;
      assert.ok(!arxivOnly, `${e.citekey} is not an arXiv-only preprint`);
    }
    // The preprints the recordings carry (arXiv results, SSRN / Research Square) are listed with their rule.
    const md = fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8');
    const excluded = md.slice(md.indexOf('## Excluded'), md.indexOf(SOURCES_START));
    assert.match(excluded, /— policy: .*allow_preprints/, 'preprint exclusions name allow_preprints');
    const grabec = cands.find((c) => c.candidate.source === 'arxiv' && !c.candidate.doi);
    assert.ok(grabec, 'the recordings include an arXiv-only preprint');
    assert.match(excluded, new RegExp(`^- \\[@${grabec.candidate.citekey}\\] `, 'm'), 'the arXiv-only preprint is excluded, and says so');
    // The requests carried the date filter (Crossref `from-pub-date`, PubMed `mindate`).
    const urls = readJsonl(path.join(sb.paper, 'SESSION.log')).filter((x) => x['kind'] === 'http').map((x) => String(x['url']));
    assert.ok(urls.some((u) => u.includes('api.crossref.org') && u.includes('from-pub-date%3A2015') || u.includes('from-pub-date:2015')), 'Crossref was asked from 2015');
    assert.ok(urls.some((u) => u.includes('esearch.fcgi') && u.includes('mindate=2015')), 'PubMed was asked from 2015');
  });
});

test('SRC-09 (built CLI, numbered prompts): the prune question shows tiers, excerpts and the rejections with their reason, and accepts a DOI to add', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: env() }, async (sb) => {
    seedBrief(sb);
    const cands = await recordedCandidates();
    scriptScope(sb);
    sb.mock!.script('source-evaluator', { data: { verdicts: verdictsFor(cands, 1) } });
    const rejectedKey = cands[0]!.candidate.citekey;
    // Keep options 1 and 2 (the two most relevant picks), then add a DOI the user knows.
    const r = await runBuilt(sb, ['research'], { env: { PENSMITH_PROMPT_MODE: 'numbered' }, input: '1,2\n10.1038/nature14539\n' });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /Select candidates to keep \(\d+ found\): the evaluator's picks are preselected; its rejections are listed unselected with the reason/);
    assert.match(r.stderr, /^ {2}1\) \S+ {2}— \[(?:peer-reviewed|preprint|book|gov-report|other)\] .+ \(\d{4}\)$/m, 'each option shows its tier, title and year');
    assert.match(r.stderr, new RegExp(`\\) ${rejectedKey} {2}— \\[[a-z-]+\\] .+\\n\\s+rejected by the evaluator: Off-scope for this review \\(${rejectedKey}\\)\\.`), 'the rejection is listed with its reason');
    assert.match(r.stderr, /Evidence on attention for the review \(\S+\)\. — \S/, 'a kept option shows the reason and an abstract excerpt');
    assert.match(r.stderr, /Add a source you know — a DOI, arXiv id, PMID:<id>, isbn:<ISBN> or URL/);

    const lib = library(sb);
    assert.equal(lib.entries.length, 3, lib.entries.map((e) => e.citekey).join(', '));
    const lecun = lib.entries.find((e) => e.doi === '10.1038/nature14539');
    assert.ok(lecun, 'the DOI typed at the question was identified and added');
    assert.equal(lecun.title, 'Deep learning');
    assert.deepEqual(lecun.provenance, ['add:crossref']);
    assert.ok(!lib.entries.some((e) => e.citekey === rejectedKey), 'the rejection was not selected');
    assert.match(fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8'), /; 1 added at the approval gate$/m);
  });
});

test('SRC-06 (built CLI): OpenAlex\'s keyless 429 "Insufficient budget" is reported with the key hint, and research completes from the other adapters', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: env() }, async (sb) => {
    seedBrief(sb);
    // tests/fixtures/cassettes/synthetic/openalex/keyless-429-insufficient-budget.json answers this query.
    const queries = ['insufficient budget probe', ...QUERIES.slice(0, 4)];
    const registry = sources as unknown as AdapterRegistry;
    const plan = researchAdapterPlan({ registry, byPreference: true, discipline: 'computer-science', env: {} });
    const found = await discoverCandidates({ queries, plan, registry, warn: () => undefined });
    sb.mock!.script('topic-disambiguator', { data: { ambiguous: false, scopes: [{ label: 'attention-mechanisms', description: 'Attention mechanisms.', queries }] } });
    sb.mock!.script('source-evaluator', { data: { verdicts: verdictsFor(found.candidates, 0) } });
    const r = await runBuilt(sb, ['research', '--yolo']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /^ {2}openalex +0 {2}.*failed \(keyless daily budget exhausted — set OPENALEX_API_KEY \(free\)\)/m);
    assert.match(r.stderr, /openalex failed \(keyless daily budget exhausted — set OPENALEX_API_KEY \(free\)\)/);
    assert.match(fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8'), /^\| insufficient budget probe \| openalex \| 0 \| failed \(keyless daily budget exhausted — set OPENALEX_API_KEY \(free\)\) \|$/m);
    assert.ok(library(sb).entries.length > 0, 'the other adapters built the library');
  });
});
