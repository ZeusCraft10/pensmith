// tests/zotero-research.test.ts — research reaches the user's Zotero library
// (19-PLAN §7.2 "research ← net", §7.4; SRC-16, D-19-24).
//
//   - With ZOTERO_API_KEY and `[sources] zotero_collection = "Thesis"`,
//     `pensmith research` pulls that whole collection (Zotero Web API through
//     the one transport; MockAgent answers api.zotero.org) into LIBRARY.json
//     tagged zotero — only that collection's items — before the search, and
//     reports it as the `zotero` row of the per-adapter table (stdout and
//     RESEARCH.md). An item whose DOI is already in the library merges into
//     that entry (its citekey kept, both tags). The collection is not searched
//     per query.
//   - With Zotero configured but no collection, the `zotero` adapter is
//     searched per query like every other adapter, and its hits are tagged
//     zotero.
//
// The research verb runs in-process (PENSMITH_NO_LLM: the stubbed
// disambiguator and evaluator) with fake scholarly adapters injected through
// the research registry seam; only api.zotero.org is intercepted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox, type LlmSandbox } from './helpers/llm-sandbox.js';
import { installMockAgent } from './helpers/local-servers/mock-agent.js';
import { runResearch } from '../bin/cli/research.js';
import { __setResearchRegistryForTest, type AdapterRegistry } from '../bin/lib/research-orchestrator.js';
import { upsertSources, loadLibrary } from '../bin/lib/library.js';
import { renderIntakeDocument } from '../bin/lib/intake-brief.js';
import { _resetHostStateForTest } from '../bin/lib/http.js';
import { provenanceTags } from '../bin/lib/research-md.js';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';

const WOOD = {
  key: 'XMT4Q4FT',
  library: { type: 'user', id: 777 },
  data: {
    key: 'XMT4Q4FT',
    itemType: 'journalArticle',
    title: 'The art of doing (geographies of) music',
    creators: [
      { creatorType: 'author', firstName: 'Nichola', lastName: 'Wood' },
      { creatorType: 'author', firstName: 'Michelle', lastName: 'Duffy' },
    ],
    publicationTitle: 'Environment and Planning D: Society and Space',
    date: '2007',
    DOI: '10.1068/d416t',
  },
};
const KUHN = {
  key: 'KUHN1962',
  library: { type: 'user', id: 777 },
  data: {
    key: 'KUHN1962',
    itemType: 'book',
    title: 'The Structure of Scientific Revolutions',
    creators: [{ creatorType: 'author', firstName: 'Thomas S.', lastName: 'Kuhn' }],
    publisher: 'University of Chicago Press',
    ISBN: '9780226458083',
    date: '1962',
  },
};

function hit(n: number): SourceCandidate {
  return {
    source: 'crossref',
    id: `10.5555/music.${n}`,
    doi: `10.5555/music.${n}`,
    title: `Geographies of music and place, study ${n}`,
    authors: [`Author${n}, Ann`],
    year: 2018,
    abstract: 'We study music and place.',
    retracted: false,
    last_verified: '2026-09-28T00:00:00.000Z',
    citekey: `author${n}2018`,
    raw: {},
    type: 'article-journal',
    venue: 'Cultural Geographies',
  } as SourceCandidate;
}

interface Io {
  out: string;
  err: string;
}

async function research(sb: LlmSandbox): Promise<{ error: unknown; io: Io }> {
  const io: Io = { out: '', err: '' };
  const e = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    io.err += String(s);
    return true;
  };
  try {
    await runResearch({ root: sb.root, yolo: true, io: { out: (l) => void (io.out += `${l}\n`), err: (l) => void (io.err += `${l}\n`) } });
    return { error: null, io };
  } catch (error) {
    return { error, io };
  } finally {
    (process.stderr as unknown as { write: typeof e }).write = e;
  }
}

function fakes(zoteroCalls: string[]): AdapterRegistry {
  const reg: AdapterRegistry = { 'retraction-watch': { fetchById: async () => null } };
  for (const name of ['crossref', 'openalex', 'semanticscholar', 'arxiv', 'pubmed']) {
    reg[name] = { search: async () => (name === 'crossref' ? [hit(1)] : []) };
  }
  reg['zotero'] = {
    async search(query: string): Promise<SourceCandidate[]> {
      zoteroCalls.push(query);
      return [{ ...hit(9), source: 'zotero', title: `A Zotero item about ${query}`, citekey: 'zot92018', doi: '10.5555/zotero.9', id: 'zotero:users/777/ZOT00009' } as SourceCandidate];
    },
  };
  return reg;
}

function seed(sb: LlmSandbox, config: string): void {
  fs.writeFileSync(
    path.join(sb.paper, 'INTAKE.md'),
    renderIntakeDocument({ topic: 'geographies of music', discipline: 'other' }, 'Write about music and place.', []),
  );
  sb.writePaperConfig(`schema_version = 1\n\n[sources]\n${config}`);
}

const ZOTERO_ENV = {
  PENSMITH_NO_LLM: '1',
  PENSMITH_NETWORK_TESTS: '1',
  ZOTERO_API_KEY: 'zk-test-key-123456',
  ZOTERO_GROUP_ID: undefined,
  PENSMITH_ZOTERO_LOCAL: undefined,
};

test('SRC-16: research pulls the whole `zotero_collection = "Thesis"` into LIBRARY.json tagged zotero — only that collection — and an item whose DOI exists merges', async () => {
  await withLlmSandbox({ env: ZOTERO_ENV }, async (sb) => {
    seed(sb, 'zotero_collection = "Thesis"\n');
    // The user already added Wood & Duffy by its DOI.
    await upsertSources(sb.root, [{ source: 'crossref', doi: '10.1068/D416T', title: 'The art of doing (geographies of) music', authors: ['Wood, Nichola'], year: 2007 }], { provenance: 'add' });
    const zoteroCalls: string[] = [];
    __setResearchRegistryForTest(fakes(zoteroCalls));
    _resetHostStateForTest();
    const { agent, restore } = installMockAgent();
    try {
      const pool = agent.get('https://api.zotero.org');
      const json = { headers: { 'content-type': 'application/json' } };
      pool.intercept({ path: '/keys/current', method: 'GET' }).reply(200, { userID: 777, access: { user: { library: true } } }, json);
      pool.intercept({ path: '/users/777/collections?format=json&limit=100&start=0', method: 'GET' }).reply(200, [
        { key: 'THESIS01', data: { name: 'Thesis' } },
        { key: 'OTHER001', data: { name: 'Side project' } },
      ], json);
      pool.intercept({ path: '/users/777/collections/THESIS01/items/top?format=json&limit=100&start=0', method: 'GET' })
        .reply(200, [WOOD, KUHN], { headers: { 'content-type': 'application/json', 'total-results': '2' } });

      const r = await research(sb);
      assert.equal(r.error, null, `${String(r.error)}\n${r.io.err}`);
      assert.deepEqual(agent.pendingInterceptors(), [], 'the key check, the collection list and the Thesis items were read');
    } finally {
      await restore();
      __setResearchRegistryForTest(null);
    }

    const lib = await loadLibrary(sb.root);
    const zoteroEntries = lib.entries.filter((e) => provenanceTags(e).includes('zotero'));
    assert.deepEqual(zoteroEntries.map((e) => e.title).sort(), ['The Structure of Scientific Revolutions', 'The art of doing (geographies of) music']);
    const wood = lib.entries.find((e) => e.doi === '10.1068/d416t')!;
    assert.equal(wood.citekey, 'wood2007', 'the existing entry kept its citekey');
    assert.deepEqual(wood.provenance, ['add:crossref', 'zotero:zotero'], 'merged: both tags');
    assert.deepEqual(wood.zotero, { library: 'users/777', key: 'XMT4Q4FT' });
    const kuhn = lib.entries.find((e) => e.isbn === '9780226458083')!;
    assert.deepEqual([kuhn.type, kuhn.publisher], ['book', 'University of Chicago Press']);
    assert.equal(lib.entries.length, 3, 'Wood, Kuhn and the one search hit — nothing from the other collection');
    assert.deepEqual(zoteroCalls, [], 'a configured collection is pulled once, not searched per query');

    const md = fs.readFileSync(path.join(sb.paper, 'RESEARCH.md'), 'utf8');
    assert.match(md, /^\| zotero \| 2 \| ok \(collection "Thesis": 1 new, 1 already in library\) \|$/m);
    assert.match(md, /\[@kuhn1962\][^\n]*\n {2}- [^\n]*Tags: zotero/);
  });
});

test('SRC-16: research reports the zotero row on stdout, and a Zotero failure is a row with its reason — the research still completes', async () => {
  await withLlmSandbox({ env: ZOTERO_ENV }, async (sb) => {
    seed(sb, 'zotero_collection = "Thesis"\n');
    __setResearchRegistryForTest(fakes([]));
    _resetHostStateForTest();
    const { agent, restore } = installMockAgent();
    let r: Awaited<ReturnType<typeof research>>;
    try {
      agent.get('https://api.zotero.org').intercept({ path: '/keys/current', method: 'GET' }).reply(403, 'Forbidden', { headers: { 'content-type': 'text/plain' } });
      r = await research(sb);
    } finally {
      await restore();
      __setResearchRegistryForTest(null);
    }
    assert.equal(r.error, null, `${String(r.error)}\n${r.io.err}`);
    assert.match(r.io.out, /^ {2}zotero +0 {2}failed \(Zotero rejected ZOTERO_API_KEY \(HTTP 403\) — check the key at https:\/\/www\.zotero\.org\/settings\/keys\)$/m);
    assert.match(r.io.err, /Zotero collection "Thesis" was not read: failed \(Zotero rejected ZOTERO_API_KEY/);
    const lib = await loadLibrary(sb.root);
    assert.deepEqual(lib.entries.map((e) => e.doi), ['10.5555/music.1'], 'the scholarly search still built the library');
  });
});

test('SRC-16: with Zotero configured and no collection, the zotero adapter is searched per query and its hits are tagged zotero', async () => {
  await withLlmSandbox({ env: ZOTERO_ENV }, async (sb) => {
    seed(sb, '');
    const zoteroCalls: string[] = [];
    __setResearchRegistryForTest(fakes(zoteroCalls));
    try {
      const r = await research(sb);
      assert.equal(r.error, null, `${String(r.error)}\n${r.io.err}`);
      assert.ok(zoteroCalls.length >= 5, `every query reached Zotero (${zoteroCalls.length})`);
      assert.match(r.io.out, /^ {2}zotero +\d+ {2}ok$/m);
    } finally {
      __setResearchRegistryForTest(null);
    }
    const lib = await loadLibrary(sb.root);
    const z = lib.entries.find((e) => e.doi === '10.5555/zotero.9');
    assert.ok(z, 'the Zotero hit is in the library');
    assert.deepEqual(provenanceTags(z), ['zotero']);
  });
});
