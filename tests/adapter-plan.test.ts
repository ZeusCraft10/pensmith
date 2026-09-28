// tests/adapter-plan.test.ts — which adapters research queries, in which order
// (SRC-10, D-19-16; PRD §8, §10; bin/lib/adapter-plan.ts).
//
// Unit: the preset preference first, then PRD §10's default five; exactly
// `[sources] allowed_databases` when set; the nber / jstor / psycnet /
// philpapers mappings; Zotero; every left-out default reported as skipped.
// MockAgent: a computer-science paper's research reaches arXiv, Semantic
// Scholar and OpenAlex (then Crossref and PubMed), and with
// allowed_databases = ["openalex"] only OpenAlex is requested.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planAdapters,
  targetsFor,
  zoteroConfigured,
  DEFAULT_DATABASES,
  NBER_DOI_PREFIX,
  evaluatorCallsFor,
  estimatedResearchCandidates,
  EVALUATOR_BATCH,
  PLANNABLE_ADAPTERS,
} from '../bin/lib/adapter-plan.js';
import { resolveDiscipline } from '../bin/lib/disciplines.js';
import { SOURCE_DATABASES } from '../bin/lib/schemas/config.js';

const ALL = ['crossref', 'openalex', 'arxiv', 'pubmed', 'semanticscholar', 'books', 'zotero'];
const pref = (slug: string): readonly string[] => resolveDiscipline({ discipline: { intake: slug } }).sourcePreference;
const ids = (p: ReturnType<typeof planAdapters>): string[] => p.entries.map((e) => e.id);
const skip = (p: ReturnType<typeof planAdapters>): Record<string, string> => Object.fromEntries(p.skipped.map((s) => [s.id, s.status]));

test('SRC-10: a computer-science paper queries arXiv, Semantic Scholar, OpenAlex first, then the rest of the default five', () => {
  const p = planAdapters({ preference: pref('computer-science'), zoteroConfigured: false, available: ALL });
  assert.deepEqual(ids(p), ['arxiv', 'semanticscholar', 'openalex', 'crossref', 'pubmed']);
  assert.deepEqual(p.entries.map((e) => e.rank), [0, 1, 2, 3, 4], 'the preference rank');
  assert.deepEqual(skip(p), { zotero: 'skipped (not configured)' });
});

test('SRC-10: the biology, history and psychology presets map their preferences (books; jstor and psycnet substitutes)', () => {
  assert.deepEqual(ids(planAdapters({ preference: pref('biology'), zoteroConfigured: false, available: ALL })), ['pubmed', 'openalex', 'crossref', 'semanticscholar', 'arxiv']);
  const history = planAdapters({ preference: pref('history'), zoteroConfigured: false, available: ALL });
  assert.deepEqual(ids(history), ['openalex', 'crossref', 'books', 'semanticscholar', 'arxiv', 'pubmed'], 'jstor → openalex + crossref; books kept');
  assert.equal(history.entries.find((e) => e.id === 'crossref')?.via, 'jstor');
  assert.deepEqual(ids(planAdapters({ preference: pref('psychology'), zoteroConfigured: false, available: ALL })), ['pubmed', 'openalex', 'semanticscholar', 'crossref', 'arxiv']);
  assert.deepEqual(ids(planAdapters({ preference: pref('philosophy'), zoteroConfigured: false, available: ALL })).slice(0, 2), ['openalex', 'books']);
});

test('SRC-11 / SRC-10: nber is Crossref restricted to NBER\'s DOI prefix, listed as its own entry', () => {
  const p = planAdapters({ preference: pref('economics'), zoteroConfigured: false, available: ALL });
  assert.deepEqual(ids(p), ['nber', 'openalex', 'crossref', 'semanticscholar', 'arxiv', 'pubmed']);
  const nber = p.entries[0]!;
  assert.equal(nber.adapter, 'crossref');
  assert.equal(nber.options.doiPrefix, NBER_DOI_PREFIX);
  assert.equal(NBER_DOI_PREFIX, '10.3386');
  assert.deepEqual(p.entries.find((e) => e.id === 'crossref')?.options, {}, 'plain Crossref is unfiltered');
  assert.deepEqual(targetsFor('philpapers').map((t) => t.adapter), ['openalex']);
  assert.deepEqual(targetsFor('psycnet').map((t) => t.adapter), ['pubmed', 'openalex']);
});

test('SRC-10: allowed_databases is exactly those databases, the preferred ones first; the rest are reported skipped', () => {
  const only = planAdapters({ preference: pref('computer-science'), allowed: ['openalex'], zoteroConfigured: false, available: ALL });
  assert.deepEqual(ids(only), ['openalex']);
  assert.deepEqual(skip(only), {
    arxiv: 'skipped (not in allowed_databases)',
    semanticscholar: 'skipped (not in allowed_databases)',
    crossref: 'skipped (not in allowed_databases)',
    pubmed: 'skipped (not in allowed_databases)',
    zotero: 'skipped (not configured)',
  }, 'every default database is still accounted for (SRC-07)');
  const two = planAdapters({ preference: pref('computer-science'), allowed: ['crossref', 'arxiv', 'nber'], zoteroConfigured: false, available: ALL });
  assert.deepEqual(ids(two), ['arxiv', 'crossref', 'nber'], 'the preferred allowed database first, then the list order');
});

test('Zotero joins when configured (last); allowed_databases can leave it out; a planned adapter the registry lacks is skipped (no adapter)', () => {
  assert.deepEqual(ids(planAdapters({ preference: pref('other'), zoteroConfigured: true, available: ALL })).at(-1), 'zotero');
  const notAllowed = planAdapters({ preference: pref('other'), allowed: ['openalex'], zoteroConfigured: true, available: ALL });
  assert.equal(skip(notAllowed)['zotero'], 'skipped (not in allowed_databases)');
  const unconfigured = planAdapters({ preference: pref('other'), allowed: ['zotero', 'openalex'], zoteroConfigured: false, available: ALL });
  assert.equal(skip(unconfigured)['zotero'], 'skipped (not configured)');
  const noBooks = planAdapters({ preference: pref('history'), zoteroConfigured: false, available: ['openalex', 'crossref'] });
  assert.equal(skip(noBooks)['books'], 'skipped (no adapter)');
  assert.equal(zoteroConfigured({ ZOTERO_API_KEY: 'k' }), true);
  assert.equal(zoteroConfigured({ PENSMITH_ZOTERO_LOCAL: '1' }), true);
  assert.equal(zoteroConfigured({}), false);
  assert.equal(zoteroConfigured({ ZOTERO_GROUP_ID: '100' }), true, 'a public group library needs no key (sources/zotero.ts isZoteroConfigured)');
  assert.equal(zoteroConfigured({ ZOTERO_API_KEY: '  ' }), false);
});

test('config: [sources] allowed_databases accepts every plannable database, including books and nber', () => {
  for (const db of [...DEFAULT_DATABASES, 'zotero', 'books', 'nber']) assert.ok((SOURCE_DATABASES as readonly string[]).includes(db), db);
  for (const a of PLANNABLE_ADAPTERS) assert.ok((SOURCE_DATABASES as readonly string[]).includes(a), a);
});

test('the research call budget: ceil(candidates / 150) evaluator calls', () => {
  assert.equal(EVALUATOR_BATCH, 150);
  assert.equal(evaluatorCallsFor(0), 0);
  assert.equal(evaluatorCallsFor(1), 1);
  assert.equal(evaluatorCallsFor(150), 1);
  assert.equal(evaluatorCallsFor(151), 2);
  assert.equal(estimatedResearchCandidates(10, 5), 250);
  assert.equal(evaluatorCallsFor(estimatedResearchCandidates(10, 5)), 2);
  assert.equal(evaluatorCallsFor(estimatedResearchCandidates(10, 1)), 1);
});

// --- MockAgent: the real adapters, the real registry -------------------------

const EMPTY_ANSWERS: Record<string, { path: RegExp; body: string; type: string }> = {
  'https://export.arxiv.org': { path: /^\/api\/query/, body: '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>', type: 'application/atom+xml' },
  'https://api.semanticscholar.org': { path: /^\/graph\/v1\/paper\/search/, body: '{"total":0,"data":[]}', type: 'application/json' },
  'https://api.openalex.org': { path: /^\/works/, body: '{"meta":{"count":0},"results":[]}', type: 'application/json' },
  'https://api.crossref.org': { path: /^\/works/, body: '{"status":"ok","message-type":"work-list","message":{"items":[]}}', type: 'application/json' },
  'https://eutils.ncbi.nlm.nih.gov': { path: /^\/entrez\/eutils\/esearch/, body: '{"esearchresult":{"count":"0","idlist":[]}}', type: 'application/json' },
};

async function hostsRequested(allowed: readonly string[] | undefined, query: string): Promise<{ hosts: string[]; table: string[] }> {
  const saved = process.env['PENSMITH_NETWORK_TESTS'];
  process.env['PENSMITH_NETWORK_TESTS'] = '1';
  const { installMockAgent } = await import('./helpers/local-servers/mock-agent.js');
  const http = await import('../bin/lib/http.js');
  const orch = await import('../bin/lib/research-orchestrator.js');
  const { sources } = await import('../bin/lib/sources/index.js');
  const mock = installMockAgent();
  http.__setHttpTestSeams({ resolve: async () => [{ address: '203.0.113.9', family: 4 }] });
  const hosts: string[] = [];
  try {
    for (const [origin, a] of Object.entries(EMPTY_ANSWERS)) {
      mock.agent.get(origin).intercept({ path: a.path, method: 'GET' }).reply(() => {
        hosts.push(new URL(origin).host);
        return { statusCode: 200, data: a.body, responseOptions: { headers: { 'content-type': a.type } } };
      }).persist();
    }
    const registry = sources as Parameters<typeof orch.discoverCandidates>[0]['registry'];
    const plan = orch.researchAdapterPlan({ registry, byPreference: true, discipline: 'computer-science', allowed, env: {} });
    const d = await orch.discoverCandidates({ queries: [query], plan, registry, warn: () => undefined });
    return { hosts, table: d.adapters.map((a) => `${a.adapter}:${a.status}`) };
  } finally {
    http.__setHttpTestSeams(null);
    await mock.restore();
    if (saved === undefined) delete process.env['PENSMITH_NETWORK_TESTS'];
    else process.env['PENSMITH_NETWORK_TESTS'] = saved;
  }
}

test('SRC-10 (MockAgent): a computer-science paper queries the preset adapters, in plan order, and reports each', async () => {
  const { hosts, table } = await hostsRequested(undefined, 'pensmith adapter plan probe preset');
  assert.deepEqual([...new Set(hosts)].sort(), ['api.crossref.org', 'api.openalex.org', 'api.semanticscholar.org', 'eutils.ncbi.nlm.nih.gov', 'export.arxiv.org']);
  assert.deepEqual(table.slice(0, 5).map((t) => t.split(':')[0]), ['arxiv', 'semanticscholar', 'openalex', 'crossref', 'pubmed'], 'the per-adapter table follows the plan');
});

test('SRC-10 (MockAgent): allowed_databases = ["openalex"] → only OpenAlex is requested', async () => {
  const { hosts, table } = await hostsRequested(['openalex'], 'pensmith adapter plan probe allowed');
  assert.deepEqual([...new Set(hosts)], ['api.openalex.org']);
  assert.ok(table.includes('arxiv:skipped (not in allowed_databases)'), table.join(', '));
});
