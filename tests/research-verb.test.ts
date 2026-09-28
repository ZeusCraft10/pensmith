// tests/research-verb.test.ts — `pensmith research` end to end in-process
// (SRC-07, SRC-08, SRC-09, SRC-10; D-19-15, D-19-16, D-19-17).
//
// The REAL verb (bin/cli/research.ts runResearch) runs against the RUN-21 mock
// LLM (scripted topic-disambiguator / source-evaluator replies, requests
// captured) and fake source adapters injected through the research registry
// seam (__setResearchRegistryForTest — honoured only in a test context). The
// adapters are named like the real ones, so the real adapter plan (the
// preset's preference, [sources] allowed_databases) decides which are queried.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox, type LlmSandbox } from './helpers/llm-sandbox.js';
import { runResearch } from '../bin/cli/research.js';
import { __setResearchRegistryForTest, EVALUATOR_BATCH, upsertCounts, type AdapterRegistry } from '../bin/lib/research-orchestrator.js';
import { upsertSources } from '../bin/lib/library.js';
import { renderIntakeDocument } from '../bin/lib/intake-brief.js';
import { Schema as LibrarySchema } from '../bin/lib/schemas/library.js';
import { parsePromptBlocks } from '../bin/lib/prompt-request.js';
import { EXIT_APPROVAL, EXIT_ERROR, EXIT_USAGE, isPensmithError } from '../bin/lib/exit-codes.js';
import { RESEARCH_LOG_END, SOURCES_START } from '../bin/lib/research-md.js';
import { isResearchDone } from '../bin/lib/research-sentinel.js';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';
import type { SearchOptions } from '../bin/lib/sources/search-failure.js';

const KEY = 'sk-test-research-verb-0001';
const NOW = '2026-09-28T00:00:00.000Z';

type Src = SourceCandidate['source'];

function cand(source: Src, n: number, extra: Partial<SourceCandidate> = {}): SourceCandidate {
  return {
    source,
    id: `10.5555/${source}.${n}`,
    doi: `10.5555/${source}.${n}`,
    title: `Attention mechanisms in neural networks, study ${source} ${n}`,
    authors: [`Author${n}, Ann`, 'Second, Sam'],
    year: 2020,
    abstract: `We study attention mechanisms (${source} ${n}).`,
    retracted: false,
    last_verified: NOW,
    citekey: `author${n}2020`,
    raw: {},
    type: 'article-journal',
    venue: 'Neural Computation',
    ...extra,
  } as SourceCandidate;
}

interface Call {
  adapter: string;
  query: string;
  opts: SearchOptions | undefined;
}

/**
 * A retraction lookup that finds no notice for any DOI. The fake works' DOIs
 * (10.5555/…) have no recorded Crossref answer, so the real lookup would leave
 * them `unknown` offline (SRC-04: a failed lookup is never "clear"); a test
 * that is not about retractions injects this instead.
 */
const NO_RETRACTIONS = { fetchById: async (): Promise<SourceCandidate | null> => null };

/** Fake adapters named like the real registry keys; each returns `results[adapter]` for every query. */
function fakeRegistry(results: Partial<Record<string, SourceCandidate[] | ((q: string) => SourceCandidate[])>>, extra: AdapterRegistry = {}): { calls: Call[]; registry: AdapterRegistry } {
  const calls: Call[] = [];
  const registry: AdapterRegistry = { 'retraction-watch': NO_RETRACTIONS, ...extra };
  for (const name of ['arxiv', 'semanticscholar', 'openalex', 'crossref', 'pubmed', 'books']) {
    registry[name] = {
      async search(query: string, opts?: SearchOptions): Promise<SourceCandidate[]> {
        calls.push({ adapter: name, query, opts });
        const r = results[name];
        return typeof r === 'function' ? r(query) : (r ?? []);
      },
    };
  }
  return { calls, registry };
}

function writeBrief(sb: LlmSandbox, topic = 'attention mechanisms in neural networks', discipline = 'computer-science'): void {
  fs.writeFileSync(
    path.join(sb.paper, 'INTAKE.md'),
    renderIntakeDocument({ topic, discipline, paper_type: 'literature-review' }, `Write a 2000-word literature review on ${topic}.`, []),
  );
}

/**
 * Run the research verb with its stdout/stderr captured through the verb's io
 * sink (the test runner's own stdout carries its protocol and is never
 * patched); other stderr writes (mode banners, runtime warnings) are captured too.
 */
async function research(opts: Omit<Parameters<typeof runResearch>[0], 'io'>): Promise<{ value: unknown; error: unknown; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const e = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => { err.push(String(s)); return true; };
  try {
    const value = await runResearch({ ...opts, io: { out: (l) => out.push(`${l}\n`), err: (l) => err.push(`${l}\n`) } });
    return { value, error: null, stdout: out.join(''), stderr: err.join('') };
  } catch (error) {
    return { value: null, error, stdout: out.join(''), stderr: err.join('') };
  } finally {
    (process.stderr as unknown as { write: typeof e }).write = e;
  }
}

async function withResearch(
  opts: { env?: Record<string, string | undefined> },
  fn: (sb: LlmSandbox) => Promise<void>,
): Promise<void> {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY, PENSMITH_NO_LLM: undefined, ...(opts.env ?? {}) } }, async (sb) => {
    try {
      await fn(sb);
    } finally {
      __setResearchRegistryForTest(null);
    }
  });
}

const TWO_SCOPES = {
  ambiguous: true,
  scopes: [
    { label: 'transformer-architecture', description: 'Self-attention in transformer language models.', queries: ['transformer self-attention', 'multi-head attention', 'attention head ablation', 'positional encoding', 'efficient attention'] },
    { label: 'power-transformers', description: 'Electrical power transformers and their faults.', queries: ['power transformer fault', 'winding insulation ageing', 'dissolved gas analysis', 'transformer core loss', 'transformer thermal model', 'grid transformer monitoring'] },
  ],
};

function candidatesSent(sb: LlmSandbox): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const body of sb.mock!.bodiesFor('source-evaluator')) {
    const msgs = body['messages'] as Array<{ content: string }>;
    const block = parsePromptBlocks(msgs[msgs.length - 1]!.content).get('candidates');
    out.push(...(JSON.parse(block ?? '[]') as Array<Record<string, unknown>>));
  }
  return out;
}

test('SRC-08: an ambiguous topic without a terminal, --yolo or --scope exits 3 before any model request or write', async () => {
  await withResearch({}, async (sb) => {
    writeBrief(sb);
    sb.mock!.script('topic-disambiguator', { data: TWO_SCOPES });
    const { registry, calls } = fakeRegistry({ crossref: [cand('crossref', 1)] });
    __setResearchRegistryForTest(registry);
    const before = fs.readdirSync(sb.paper).sort();
    const r = await research({ root: sb.root, yolo: false });
    assert.ok(isPensmithError(r.error) && r.error.exitCode === EXIT_APPROVAL, String(r.error));
    assert.match(String((r.error as Error).message), /nothing was searched, sent or written/);
    assert.equal(sb.mock!.callCount(), 0, 'no model request');
    assert.equal(calls.length, 0, 'no search');
    assert.deepEqual(fs.readdirSync(sb.paper).sort(), before, 'nothing written');
    // --scope answers the scope question, but the pruning question still needs a terminal.
    const s = await research({ root: sb.root, yolo: false, scope: '2' });
    assert.ok(isPensmithError(s.error) && s.error.exitCode === EXIT_APPROVAL);
    assert.equal(sb.mock!.callCount(), 0);
  });
});

test('SRC-08: --scope 2 --yolo searches scope 2\'s queries on every planned adapter; --yolo alone takes scope 1 and says so', async () => {
  await withResearch({}, async (sb) => {
    writeBrief(sb);
    const { registry, calls } = fakeRegistry({ crossref: (q) => [cand('crossref', q.length)] });
    __setResearchRegistryForTest(registry);
    sb.mock!.script('topic-disambiguator', { data: TWO_SCOPES });
    const r = await research({ root: sb.root, yolo: true, scope: '2' });
    assert.equal(r.error, null, String(r.error));
    const queried = [...new Set(calls.map((c) => c.query))];
    assert.deepEqual(queried, TWO_SCOPES.scopes[1]!.queries, 'exactly scope 2\'s 6 queries');
    for (const q of queried) assert.equal(calls.filter((c) => c.query === q).length, 5, `${q}: every default-five adapter (books is not planned for computer science)`);
    assert.match(r.stdout, /^pensmith research: scope "power-transformers" — 6 queries$/m);
    assert.doesNotMatch(r.stdout, /--yolo: using scope 1/);

    calls.length = 0;
    sb.mock!.script('topic-disambiguator', { data: TWO_SCOPES });
    const y = await research({ root: sb.root, yolo: true });
    assert.equal(y.error, null, String(y.error));
    assert.match(y.stdout, /^pensmith research: --yolo: using scope 1 of 2 — "transformer-architecture": Self-attention in transformer language models\.$/m);
    assert.deepEqual([...new Set(calls.map((c) => c.query))], TWO_SCOPES.scopes[0]!.queries);

    // --scope as text: a label or description match.
    calls.length = 0;
    sb.mock!.script('topic-disambiguator', { data: TWO_SCOPES });
    const t = await research({ root: sb.root, yolo: true, scope: 'electrical' });
    assert.equal(t.error, null, String(t.error));
    assert.equal(calls[0]!.query, 'power transformer fault');
  });
});

test('SRC-08: a --scope that names no proposed scope is EXIT_USAGE listing them; a bad --queries is EXIT_USAGE before any request', async () => {
  await withResearch({}, async (sb) => {
    writeBrief(sb);
    const { registry, calls } = fakeRegistry({});
    __setResearchRegistryForTest(registry);
    for (const scope of ['4', 'nonexistent words', 'transformer']) {
      sb.mock!.script('topic-disambiguator', { data: TWO_SCOPES });
      const r = await research({ root: sb.root, yolo: true, scope });
      assert.ok(isPensmithError(r.error) && r.error.exitCode === EXIT_USAGE, `${scope}: ${String(r.error)}`);
      assert.match((r.error as Error).message, /1\) transformer-architecture — Self-attention.*2\) power-transformers — Electrical/, 'lists the scopes');
    }
    assert.equal(calls.length, 0, 'nothing searched');
    const before = sb.mock!.callCount();
    for (const q of ['11', '4', 'seven', '0']) {
      const r = await research({ root: sb.root, yolo: true, queries: q });
      assert.ok(isPensmithError(r.error) && r.error.exitCode === EXIT_USAGE, `--queries ${q}`);
      assert.match((r.error as Error).message, /--queries must be a whole number from 5 to 10/);
    }
    assert.equal(sb.mock!.callCount(), before, 'refused before any model request');
    const empty = await research({ root: sb.root, yolo: true, scope: '  ' });
    assert.ok(isPensmithError(empty.error) && empty.error.exitCode === EXIT_USAGE);
  });
});

test('SRC-08: a 12-query scope issues 10, a 3-query scope is padded to 5 from the topic expansion, --queries 7 caps at 7', async () => {
  await withResearch({}, async (sb) => {
    writeBrief(sb);
    const { registry, calls } = fakeRegistry({ crossref: [cand('crossref', 1)] });
    __setResearchRegistryForTest(registry);
    const scope = (queries: string[]): unknown => ({ ambiguous: false, scopes: [{ label: 'attention', description: 'Attention in neural networks.', queries }] });
    const twelve = Array.from({ length: 12 }, (_, i) => `attention query ${i + 1}`);

    sb.mock!.script('topic-disambiguator', { data: scope(twelve) });
    const a = await research({ root: sb.root, yolo: true });
    assert.equal(a.error, null, String(a.error));
    assert.deepEqual([...new Set(calls.map((c) => c.query))], twelve.slice(0, 10), 'the first 10');
    assert.match(a.stdout, /10 queries \(the scope proposed 12 queries; the first 10 are used\)/);

    calls.length = 0;
    sb.mock!.script('topic-disambiguator', { data: scope(['attention heads', 'self attention', 'attention heads']) });
    const b = await research({ root: sb.root, yolo: true });
    assert.equal(b.error, null, String(b.error));
    const padded = [...new Set(calls.map((c) => c.query))];
    assert.equal(padded.length, 5, padded.join(' | '));
    assert.deepEqual(padded.slice(0, 2), ['attention heads', 'self attention']);
    assert.equal(padded[2], 'attention mechanisms in neural networks', 'padded from the deterministic expansion of the brief topic');
    const md = fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8');
    assert.match(md, /\(the scope proposed 2; 3 added from the deterministic expansion of the intake topic\)/);

    calls.length = 0;
    sb.mock!.script('topic-disambiguator', { data: scope(twelve) });
    const c = await research({ root: sb.root, yolo: true, queries: '7' });
    assert.equal(c.error, null, String(c.error));
    assert.equal(new Set(calls.map((x) => x.query)).size, 7);
  });
});

test('SRC-08: under PENSMITH_NO_LLM the queries are the disclosed deterministic expansion of the intake topic', async () => {
  await withResearch({ env: { PENSMITH_NO_LLM: '1' } }, async (sb) => {
    writeBrief(sb);
    const { registry, calls } = fakeRegistry({ openalex: [cand('openalex', 1)] });
    __setResearchRegistryForTest(registry);
    const r = await research({ root: sb.root, yolo: true });
    assert.equal(r.error, null, String(r.error));
    assert.match(r.stdout, /— 10 queries \(deterministic expansion of the intake topic — LLM stubbed\)/);
    assert.equal(calls[0]!.query, 'attention mechanisms in neural networks');
    const md = fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8');
    assert.match(md, /^\(deterministic expansion of the intake topic — LLM stubbed\)$/m);
    assert.equal(sb.mock!.callCount(), 0, 'no provider is contacted');
  });
});

test('SRC-09 / SRC-07: tiers, relevance and the evaluator reason persist; RESEARCH.md lists every kept source (§3.4) and the stdout table (§3.5)', async () => {
  await withResearch({}, async (sb) => {
    writeBrief(sb);
    const { registry } = fakeRegistry({
      arxiv: [cand('arxiv', 3, { id: '2001.00003', doi: undefined, arxiv: '2001.00003', type: 'preprint', venue: undefined })],
      crossref: [cand('crossref', 1), cand('crossref', 2, { type: undefined, venue: undefined })],
      semanticscholar: () => [],
      pubmed: [],
    }, {});
    // openalex fails with a complete, hinted reason.
    registry['openalex'] = {
      async search(_q: string, opts?: SearchOptions) {
        opts?.onFailure?.('keyless daily budget exhausted — set OPENALEX_API_KEY (free)');
        return [];
      },
    };
    __setResearchRegistryForTest(registry);
    sb.mock!.script('topic-disambiguator', { data: { ambiguous: false, scopes: [{ label: 'attention', description: 'Attention in neural networks.', queries: ['q one', 'q two', 'q three', 'q four', 'q five'] }] } });
    sb.mock!.script('source-evaluator', {
      data: {
        verdicts: [
          { citekey: 'author12020', keep: true, reason: 'The review the background summarizes.', relevance: 0.92, tier: 'other' },
          { citekey: 'author22020', keep: true, reason: 'An empirical test of attention heads.', relevance: 0.71, tier: 'gov-report' },
          { citekey: 'author32020', keep: true, reason: 'The original preprint.', relevance: 0.66, tier: 'peer-reviewed' },
        ],
      },
    });
    const r = await research({ root: sb.root, yolo: true });
    assert.equal(r.error, null, `${String(r.error)}\n${r.stderr}`);
    // §3.5 stdout.
    assert.match(r.stdout, /^pensmith research: sources by adapter$/m);
    assert.match(r.stdout, /^ {2}openalex +0 {2}failed \(keyless daily budget exhausted — set OPENALEX_API_KEY \(free\)\)$/m);
    assert.match(r.stdout, /^ {2}crossref +10 {2}ok$/m, 'results summed over the 5 queries (before dedup)');
    assert.match(r.stdout, /^ {2}arxiv +5 {2}ok$/m);
    assert.match(r.stdout, /^ {2}semanticscholar +0 {2}no results$/m);
    assert.match(r.stdout, /^pensmith research: 3 kept \(peer-reviewed 1, preprint 1, gov-report 1\); 0 excluded by \[sources\] policy; 0 rejected by the evaluator$/m);
    assert.match(r.stdout, /^pensmith research: wrote LIBRARY\.json \(3 source\(s\); 3 new\), RESEARCH\.md, CITATIONS\.bib and CITATIONS\.ris$/m);

    const lib = LibrarySchema.parse(JSON.parse(fs.readFileSync(path.join(sb.paper, 'LIBRARY.json'), 'utf8')));
    const byKey = new Map(lib.entries.map((e) => [e.citekey, e]));
    assert.equal(byKey.get('author12020')?.tier, 'peer-reviewed', 'the deterministic tier (article-journal) beats the model');
    assert.equal(byKey.get('author12020')?.relevance, 0.92);
    assert.equal(byKey.get('author12020')?.why_relevant, 'The review the background summarizes.');
    assert.equal(byKey.get('author22020')?.tier, 'gov-report', 'no metadata tier → the evaluator\'s');
    assert.equal(byKey.get('author32020')?.tier, 'preprint', 'arXiv-only → preprint whatever the model says');
    assert.equal(byKey.get('author12020')?.type, 'article-journal');
    assert.ok(byKey.get('author12020')?.provenance.includes('research:crossref'));

    const md = fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8');
    const heads = md.split('\n').filter((l) => /^#{1,2} /.test(l));
    assert.deepEqual(heads, ['# Research log', '## Queries', '## Adapters', '## Per query', '## Excluded (0)', '## Sources (3)'], '§3.4 layout');
    assert.match(md, /^Scope: attention — Attention in neural networks\.$/m);
    assert.match(md, /^Topic: attention mechanisms in neural networks$/m);
    assert.match(md, /^Discipline: computer-science$/m);
    assert.match(md, /^\| openalex \| 0 \| failed \(keyless daily budget exhausted — set OPENALEX_API_KEY \(free\)\) \|$/m);
    assert.match(md, /^\| zotero \| 0 \| skipped \(not configured\) \|$/m);
    const block = md.slice(md.indexOf(SOURCES_START));
    assert.match(block, /^- \[@author12020\] Author1, Ann; Second, Sam \(2020\)\. Attention mechanisms in neural networks, study crossref 1\. Neural Computation\. https:\/\/doi\.org\/10\.5555\/crossref\.1$/m);
    assert.match(block, /^ {2}- Tier: peer-reviewed · Relevance: 0\.92 · Tags: search$/m);
    assert.match(block, /^ {2}- Why relevant: The review the background summarizes\.$/m, 'why-relevant = the evaluator reason');
    assert.match(block, /^ {2}- Abstract: We study attention mechanisms \(crossref 1\)\.$/m);
    assert.ok(md.indexOf(SOURCES_START) < md.indexOf(RESEARCH_LOG_END), 'the sources block is part of the generated log');
    // The evaluator saw each candidate once, with its tier hint.
    const sent = candidatesSent(sb);
    assert.deepEqual(sent.map((c) => c['citekey']).sort(), ['author12020', 'author22020', 'author32020']);
    assert.deepEqual(Object.keys(sent[0]!), ['citekey', 'title', 'authors', 'year', 'venue', 'type', 'doi', 'tier_hint', 'abstract'], 'the payload fields, in order');
    assert.equal(sent.find((c) => c['citekey'] === 'author12020')?.['tier_hint'], 'peer-reviewed');
    assert.equal(sent.find((c) => c['citekey'] === 'author22020')?.['tier_hint'], null);
  });
});

test('SRC-07: the LIBRARY.json count line tells works new to the library from works it already had and from duplicates merged within the run', async () => {
  await withResearch({}, async (sb) => {
    writeBrief(sb);
    // A work the library already holds before the run.
    await upsertSources(sb.root, [cand('crossref', 2)], { provenance: 'add' });
    const { registry } = fakeRegistry({
      // The version of record carries its preprint's arXiv id; the preprint's
      // title differs, so discovery keeps both and the library merges them.
      crossref: [cand('crossref', 1, { arxiv: '2001.00009' }), cand('crossref', 2)],
      arxiv: [cand('arxiv', 9, { id: '2001.00009', doi: undefined, arxiv: '2001.00009', type: 'preprint', venue: undefined, title: 'A preprint on sparse transformer heads' })],
    });
    __setResearchRegistryForTest(registry);
    sb.mock!.script('topic-disambiguator', { data: { ambiguous: false, scopes: [{ label: 'attention', description: 'Attention in neural networks.', queries: ['q one', 'q two', 'q three', 'q four', 'q five'] }] } });
    sb.mock!.script('source-evaluator', {
      data: {
        verdicts: [
          { citekey: 'author12020', keep: true, reason: 'The published study.', relevance: 0.9, tier: 'peer-reviewed' },
          { citekey: 'author22020', keep: true, reason: 'Already cited background.', relevance: 0.8, tier: 'peer-reviewed' },
          { citekey: 'author92020', keep: true, reason: 'The preprint of the published study.', relevance: 0.7, tier: 'preprint' },
        ],
      },
    });
    const r = await research({ root: sb.root, yolo: true });
    assert.equal(r.error, null, `${String(r.error)}\n${r.stderr}`);
    assert.match(r.stdout, /^pensmith research: 3 kept \(peer-reviewed 2, preprint 1\);/m);
    assert.match(
      r.stdout,
      /^pensmith research: wrote LIBRARY\.json \(2 source\(s\); 1 new, 1 already in library, 1 duplicate\(s\) merged\), RESEARCH\.md, CITATIONS\.bib and CITATIONS\.ris$/m,
    );
    const lib = LibrarySchema.parse(JSON.parse(fs.readFileSync(path.join(sb.paper, 'LIBRARY.json'), 'utf8')));
    assert.deepEqual(lib.entries.map((e) => e.citekey).sort(), ['author12020', 'author22020']);
  });
});

test('upsertCounts: a fresh library never reports sources "already in library"; repeated hits on one known work count once', () => {
  assert.deepEqual(
    upsertCounts([
      { citekey: 'a2020', status: 'added' },
      { citekey: 'a2020', status: 'merged' },
      { citekey: 'b2020', status: 'added' },
      { citekey: 'b2020', status: 'unchanged' },
    ]),
    { added: ['a2020', 'b2020'], known: [], duplicates: 2 },
  );
  assert.deepEqual(
    upsertCounts([
      { citekey: 'k2019', status: 'unchanged' },
      { citekey: 'k2019', status: 'merged' },
      { citekey: 'n2021', status: 'added' },
    ]),
    { added: ['n2021'], known: ['k2019'], duplicates: 1 },
  );
  assert.deepEqual(upsertCounts([]), { added: [], known: [], duplicates: 0 });
});

test('SRC-07: an evaluator that rejects every candidate → "no relevant sources" + guidance, exit 1, LIBRARY.json byte-identical, the log written', async () => {
  await withResearch({}, async (sb) => {
    writeBrief(sb);
    const first = fakeRegistry({ crossref: [cand('crossref', 1)] });
    __setResearchRegistryForTest(first.registry);
    const ok = await research({ root: sb.root, yolo: true });
    assert.equal(ok.error, null, String(ok.error));
    const libPath = path.join(sb.paper, 'LIBRARY.json');
    const libBefore = fs.readFileSync(libPath);
    const bibBefore = fs.readFileSync(path.join(sb.paper, 'CITATIONS.bib'));
    fs.appendFileSync(path.join(sb.paper, 'RESEARCH.md'), '\nMy own note about scope.\n');

    const second = fakeRegistry({ crossref: [cand('crossref', 7), cand('crossref', 8)] });
    __setResearchRegistryForTest(second.registry);
    sb.mock!.script('source-evaluator', {
      data: { verdicts: [
        { citekey: 'author72020', keep: false, reason: 'Off-scope: attention in animal cognition.', relevance: 0.05, tier: 'peer-reviewed' },
        { citekey: 'author82020', keep: false, reason: 'An erratum with no findings.', relevance: 0.1, tier: 'other' },
      ] },
    });
    const r = await research({ root: sb.root, yolo: true });
    assert.ok(isPensmithError(r.error) && r.error.exitCode === EXIT_ERROR, String(r.error));
    assert.match((r.error as Error).message, /^pensmith research: no relevant sources — the evaluator rejected all 2 candidate\(s\) for scope ".+"; refine the topic \(pensmith new\), choose another scope \(--scope\), or add sources you know \(pensmith add <doi>\); LIBRARY\.json is unchanged/);
    assert.deepEqual(fs.readFileSync(libPath), libBefore, 'LIBRARY.json byte-identical');
    assert.deepEqual(fs.readFileSync(path.join(sb.paper, 'CITATIONS.bib')), bibBefore, 'CITATIONS.bib byte-identical');
    const md = fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8');
    assert.match(md, /^Result: no relevant sources$/m);
    assert.match(md, /^- \[@author72020\] .* — evaluator: Off-scope: attention in animal cognition\.$/m);
    assert.match(md, /^- \[@author82020\] .* — evaluator: An erratum with no findings\.$/m);
    assert.match(md, /## Sources \(1\)/, 'the sources block still shows the library as it is');
    assert.ok(md.endsWith('My own note about scope.\n'), 'notes below the end line are kept');
  });
});

test('SRC-07: an evaluator that fails (after its corrective retry) or omits a candidate leaves it "not evaluated", kept with a disclosure — never silently', async () => {
  await withResearch({}, async (sb) => {
    writeBrief(sb);
    const { registry } = fakeRegistry({ crossref: [cand('crossref', 1), cand('crossref', 2)] });
    __setResearchRegistryForTest(registry);
    sb.mock!.script('source-evaluator', { text: 'I cannot judge these.' }, { text: 'Still no JSON.' });
    const r = await research({ root: sb.root, yolo: true });
    assert.equal(r.error, null, String(r.error));
    assert.match(r.stderr, /pensmith research: WARN — 2 source\(s\) were not evaluated/);
    assert.match(r.stderr, /the source evaluator failed for 2 candidate\(s\): source-evaluator: the reply .* did not match the required schema after one corrective retry/);
    const md = fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8');
    assert.match(md, /^Note: 2 source\(s\) were not evaluated/m);
    const lib = LibrarySchema.parse(JSON.parse(fs.readFileSync(path.join(sb.paper, 'LIBRARY.json'), 'utf8')));
    assert.equal(lib.entries.length, 2, 'kept, not dropped');
    assert.ok(lib.entries.every((e) => e.relevance === null && e.why_relevant === null && e.tier === 'peer-reviewed'), 'no invented evaluation; the metadata tier stays');

    // An omitted candidate: the other one's verdict applies, the omitted one is not evaluated.
    const again = fakeRegistry({ openalex: [cand('openalex', 5), cand('openalex', 6)] });
    __setResearchRegistryForTest(again.registry);
    sb.mock!.script('source-evaluator', { data: { verdicts: [{ citekey: 'author52020', keep: true, reason: 'Central.', relevance: 0.9, tier: 'peer-reviewed' }] } });
    const o = await research({ root: sb.root, yolo: true });
    assert.equal(o.error, null, String(o.error));
    assert.match(o.stderr, /1 source\(s\) were not evaluated/);
    const lib2 = LibrarySchema.parse(JSON.parse(fs.readFileSync(path.join(sb.paper, 'LIBRARY.json'), 'utf8')));
    assert.equal(lib2.entries.find((e) => e.citekey === 'author52020')?.why_relevant, 'Central.');
    assert.equal(lib2.entries.find((e) => e.citekey === 'author62020')?.relevance, null);
  });
});

test('SRC-09 / SRC-10: the [sources] policy — min_year 2015, allow_preprints false, peer_reviewed_only — is enforced and listed with its rule; fromYear reaches the adapters', async () => {
  await withResearch({}, async (sb) => {
    writeBrief(sb);
    sb.writePaperConfig('schema_version = 1\n\n[sources]\nmin_year = 2015\nallow_preprints = false\n');
    const { registry, calls } = fakeRegistry({
      crossref: [cand('crossref', 1), cand('crossref', 2, { year: 2009 }), cand('crossref', 4, { type: 'article-newspaper' })],
      arxiv: [cand('arxiv', 3, { id: '2001.00003', doi: undefined, arxiv: '2001.00003', type: 'preprint' })],
    });
    __setResearchRegistryForTest(registry);
    const r = await research({ root: sb.root, yolo: true });
    assert.equal(r.error, null, String(r.error));
    assert.ok(calls.every((c) => c.opts?.fromYear === 2015), 'min_year pushed down as fromYear');
    assert.match(r.stdout, /1 kept \(peer-reviewed 1\); 3 excluded by \[sources\] policy/);
    const lib = LibrarySchema.parse(JSON.parse(fs.readFileSync(path.join(sb.paper, 'LIBRARY.json'), 'utf8')));
    assert.deepEqual(lib.entries.map((e) => e.citekey), ['author12020']);
    const md = fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8');
    assert.match(md, /^- \[@author22020\] .* — policy: min_year = 2015 \(published 2009\)$/m);
    assert.match(md, /^- \[@author32020\] .* — policy: allow_preprints = false \(a preprint\)$/m);
    assert.match(md, /^- \[@author42020\] .* — policy: allow_news = false \(a newspaper article\)$/m);
    assert.equal(candidatesSent(sb).length, 1, 'the evaluator never judges a candidate the policy already dropped');

    // peer_reviewed_only: a candidate the evaluator calls "other" is excluded after the evaluator.
    sb.writePaperConfig('schema_version = 1\n\n[sources]\npeer_reviewed_only = true\n');
    const pr = fakeRegistry({ openalex: [cand('openalex', 5, { type: undefined, venue: undefined }), cand('openalex', 6)] });
    __setResearchRegistryForTest(pr.registry);
    sb.mock!.script('source-evaluator', { data: { verdicts: [
      { citekey: 'author52020', keep: true, reason: 'A blog-like essay.', relevance: 0.6, tier: 'other' },
      { citekey: 'author62020', keep: true, reason: 'Core study.', relevance: 0.8, tier: 'other' },
    ] } });
    const p = await research({ root: sb.root, yolo: true });
    assert.equal(p.error, null, String(p.error));
    const md2 = fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8');
    assert.match(md2, /^- \[@author52020\] .* — policy: peer_reviewed_only = true \(tier: other\)$/m);
    const lib2 = LibrarySchema.parse(JSON.parse(fs.readFileSync(path.join(sb.paper, 'LIBRARY.json'), 'utf8')));
    assert.ok(lib2.entries.some((e) => e.citekey === 'author62020'), 'the metadata says peer-reviewed');
    assert.ok(!lib2.entries.some((e) => e.citekey === 'author52020'));
  });
});

test('SRC-10: allowed_databases = ["openalex"] queries only OpenAlex; an economics paper searches NBER through Crossref\'s 10.3386 prefix', async () => {
  await withResearch({}, async (sb) => {
    writeBrief(sb);
    sb.writePaperConfig('schema_version = 1\n\n[sources]\nallowed_databases = ["openalex"]\n');
    const { registry, calls } = fakeRegistry({ openalex: [cand('openalex', 1)] });
    __setResearchRegistryForTest(registry);
    const r = await research({ root: sb.root, yolo: true });
    assert.equal(r.error, null, String(r.error));
    assert.deepEqual([...new Set(calls.map((c) => c.adapter))], ['openalex']);
    assert.match(r.stdout, /^ {2}arxiv +0 {2}skipped \(not in allowed_databases\)$/m);

    sb.writePaperConfig('schema_version = 1\n');
    writeBrief(sb, 'minimum wage employment effects', 'economics');
    const econ = fakeRegistry({ crossref: [cand('crossref', 9)] });
    __setResearchRegistryForTest(econ.registry);
    const e = await research({ root: sb.root, yolo: true });
    assert.equal(e.error, null, String(e.error));
    const first = econ.calls[0]!;
    assert.equal(first.adapter, 'crossref', 'nber first (the economics preference)');
    assert.equal(first.opts?.doiPrefix, '10.3386');
    assert.ok(econ.calls.some((c) => c.adapter === 'crossref' && c.opts?.doiPrefix === undefined), 'plain Crossref too');
    assert.match(e.stdout, /^ {2}nber +\d+ {2}ok$/m);
  });
});

test('D-15 / SRC-04: the retraction cross-check runs before the library write; retracted and unknown statuses are reported', async () => {
  await withResearch({}, async (sb) => {
    writeBrief(sb);
    const retractedDoi = '10.5555/crossref.1';
    // A lookup that fails (here an HTTP 503 after retries) leaves the status
    // `unknown` with its reason (SRC-04, D-19-11) — never "clear".
    const { registry } = fakeRegistry({ crossref: [cand('crossref', 1), cand('crossref', 2)] }, {
      'retraction-watch': {
        fetchById: async (doi: string) => {
          if (doi === '10.5555/crossref.2') throw new Error('lookup failed: HTTP 503 after retries');
          return doi === retractedDoi ? { ...cand('crossref', 1), retracted: true, retraction_details: 'Retraction notice 2010' } : null;
        },
      },
    });
    __setResearchRegistryForTest(registry);
    const r = await research({ root: sb.root, yolo: true });
    assert.equal(r.error, null, String(r.error));
    assert.match(r.stderr, /^WARN: 1 retracted source\(s\) found in LIBRARY\.json: author12020\. These will FAIL Pass-1 if cited\.$/m);
    assert.match(r.stderr, /^WARN: retraction status unknown for 1 source\(s\): author22020/m);
    const md = fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8');
    assert.match(md, /^## Retractions$/m);
    assert.match(md, /^- RETRACTED: \[@author12020\] — Retraction notice 2010 \(fails Pass 1 if cited\)$/m);
    assert.match(md, /^- retraction status unknown: \[@author22020\] — lookup failed: HTTP 503/m);
    const lib = LibrarySchema.parse(JSON.parse(fs.readFileSync(path.join(sb.paper, 'LIBRARY.json'), 'utf8')));
    const e1 = lib.entries.find((e) => e.citekey === 'author12020')!;
    assert.equal(e1.retracted, true);
    assert.equal(e1.retraction_status, 'retracted');
    assert.equal(lib.entries.find((e) => e.citekey === 'author22020')?.retraction_status, 'unknown');
  });
});

test('SRC-09: more than EVALUATOR_BATCH candidates → ceil(n / 150) evaluator calls, each candidate sent exactly once', async () => {
  await withResearch({}, async (sb) => {
    writeBrief(sb);
    const many = Array.from({ length: 160 }, (_, i) => cand('crossref', 100 + i));
    const { registry } = fakeRegistry({ crossref: many });
    __setResearchRegistryForTest(registry);
    const r = await research({ root: sb.root, yolo: true });
    assert.equal(r.error, null, String(r.error));
    assert.equal(sb.mock!.callCount('source-evaluator'), Math.ceil(160 / EVALUATOR_BATCH));
    const sent = candidatesSent(sb).map((c) => c['citekey'] as string);
    assert.equal(sent.length, 160);
    assert.equal(new Set(sent).size, 160, 'no candidate sent twice');
  });
});

test('SRC-07: no source found, or every candidate excluded by policy → exit 1 naming why; no INTAKE.md → a one-line refusal before any model call', async () => {
  await withResearch({}, async (sb) => {
    writeBrief(sb);
    const { registry } = fakeRegistry({});
    registry['semanticscholar'] = {
      async search(_q: string, o?: SearchOptions): Promise<SourceCandidate[]> {
        o?.onFailure?.('HTTP 429 — rate limited; set PENSMITH_S2_API_KEY');
        return [];
      },
    };
    __setResearchRegistryForTest(registry);
    const r = await research({ root: sb.root, yolo: true });
    assert.ok(isPensmithError(r.error) && r.error.exitCode === EXIT_ERROR);
    assert.match((r.error as Error).message, /^pensmith research: no sources found — arxiv 0 \(no results\), semanticscholar 0 \(failed \(HTTP 429 — rate limited; set PENSMITH_S2_API_KEY\)\)/);
    assert.ok(!fs.existsSync(path.join(sb.paper, 'LIBRARY.json')), 'no library');
    assert.match(fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8'), /^Result: no sources found$/m, 'the log is written');
    // D-19-16: the failed run's log is not a library — bare `pensmith` / next routes back to research.
    assert.equal(isResearchDone(sb.paper), false, 'a failed research run leaves the paper at the research stage');

    sb.writePaperConfig('schema_version = 1\n\n[sources]\nmin_year = 2030\n');
    __setResearchRegistryForTest(fakeRegistry({ crossref: [cand('crossref', 1)] }).registry);
    const p = await research({ root: sb.root, yolo: true });
    assert.ok(isPensmithError(p.error) && p.error.exitCode === EXIT_ERROR);
    assert.match((p.error as Error).message, /no usable sources — all 1 candidate\(s\) were excluded by the \[sources\] policy \(min_year 1\); relax \[sources\]/);
    assert.equal(isResearchDone(sb.paper), false, 'an all-excluded run is not research output either');

    fs.rmSync(path.join(sb.paper, 'INTAKE.md'));
    const before = sb.mock!.callCount();
    const n = await research({ root: sb.root, yolo: true });
    assert.ok(isPensmithError(n.error) && n.error.exitCode === EXIT_ERROR);
    assert.match((n.error as Error).message, /no \.paper\/INTAKE\.md — research seeds its queries from the paper's brief; run pensmith new first/);
    assert.equal(sb.mock!.callCount(), before);
  });
});

test('D-19-03: a pre-Phase-18 INTAKE.md (Topic: / Discipline: lines) is migrated in memory and seeds the run', async () => {
  await withResearch({ env: { PENSMITH_NO_LLM: '1' } }, async (sb) => {
    fs.writeFileSync(path.join(sb.paper, 'INTAKE.md'), 'Topic: social media use and adolescent depression\nDiscipline: psychology\n\n## Assignment\n\nWrite about it.\n');
    const { registry, calls } = fakeRegistry({ pubmed: [cand('pubmed', 1, { id: '31978945', pmid: '31978945', doi: undefined })] });
    __setResearchRegistryForTest(registry);
    const r = await research({ root: sb.root, yolo: true });
    assert.equal(r.error, null, String(r.error));
    assert.equal(calls[0]!.query, 'social media use and adolescent depression');
    assert.equal(calls[0]!.adapter, 'pubmed', 'the psychology preset prefers PubMed');
    assert.ok(fs.readFileSync(path.join(sb.paper, 'INTAKE.md'), 'utf8').startsWith('Topic:'), 'never rewritten here');
  });
});
