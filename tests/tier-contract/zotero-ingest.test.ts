// tests/tier-contract/zotero-ingest.test.ts — SRC-16 tier parity (D-19-24).
//
// The same Zotero items reach a paper two ways:
//   Tier 2 — the CLI's Zotero client pulls them from the Zotero Web API
//            (bin/lib/sources/zotero.ts through the http.ts egress gate; the
//            API answered by MockAgent) and ingests them
//            (bin/lib/zotero-ingest.ts pullZoteroIntoLibrary);
//   Tier 1 — Claude reads them from the user's Zotero MCP server and submits
//            them to the BUILT MCP server's paper_ingest_zotero_items tool.
// Both tiers must produce the same LIBRARY.json entries (timestamps aside) and
// the same RESEARCH.md sources block. If they diverge, fix the shipped code in
// one tier — never normalize here (CONTRIBUTING.md "Tier contract").
//
// Run `npm run build` first (Tier 1 is dist/mcp/server.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { installMockAgent } from '../helpers/local-servers/mock-agent.js';
import { MCP_BIN, sandbox } from '../helpers/paper-cli-harness.js';
import { pullZoteroIntoLibrary } from '../../bin/lib/zotero-ingest.js';
import { _resetHostStateForTest } from '../../bin/lib/http.js';
import { SOURCES_START, SOURCES_END } from '../../bin/lib/research-md.js';
import { EXIT_APPROVAL } from '../../bin/lib/exit-codes.js';

/** What the Zotero Web API (and a Zotero MCP server's format="json") returns for the user's items. */
const API_ITEMS = [
  {
    key: 'VASWANI1',
    version: 12,
    library: { type: 'user', id: 4242 },
    data: {
      key: 'VASWANI1',
      itemType: 'conferencePaper',
      title: 'Attention Is All You Need',
      creators: [
        { creatorType: 'author', firstName: 'Ashish', lastName: 'Vaswani' },
        { creatorType: 'author', firstName: 'Noam', lastName: 'Shazeer' },
      ],
      proceedingsTitle: 'Advances in Neural Information Processing Systems',
      volume: '30',
      date: '2017',
      extra: 'arXiv: 1706.03762',
      abstractNote: 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.',
    },
  },
  {
    key: 'ENCODE12',
    version: 3,
    library: { type: 'user', id: 4242 },
    data: {
      key: 'ENCODE12',
      itemType: 'journalArticle',
      title: 'An integrated encyclopedia of DNA elements in the human genome',
      creators: [{ creatorType: 'author', name: 'ENCODE Project Consortium' }],
      publicationTitle: 'Nature',
      volume: '489',
      issue: '7414',
      pages: '57-74',
      date: '2012-09',
      DOI: '10.1038/nature11247',
    },
  },
  { key: 'NOTE0001', version: 1, library: { type: 'user', id: 4242 }, data: { key: 'NOTE0001', itemType: 'note', note: '<p>remember</p>' } },
];

function libraryEntries(root: string): Array<Record<string, unknown>> {
  const lib = JSON.parse(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8')) as { entries: Array<Record<string, unknown>> };
  // addedAt / updatedAt are the ingest times of two separate runs.
  return lib.entries.map((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'addedAt' && k !== 'updatedAt')));
}

function sourcesBlock(root: string): string {
  const md = readFileSync(join(root, '.paper', 'RESEARCH.md'), 'utf8');
  return md.slice(md.indexOf(SOURCES_START), md.indexOf(SOURCES_END) + SOURCES_END.length);
}

test('tier-contract (SRC-16): Zotero items give identical LIBRARY entries and RESEARCH.md sources from both tiers', async () => {
  const sb = sandbox('tier-zotero');
  const tier2 = sb.project('tier2');
  const tier1 = sb.project('tier1');
  mkdirSync(join(tier2, '.paper'), { recursive: true });
  mkdirSync(join(tier1, '.paper'), { recursive: true });

  // ---- Tier 2: the CLI's client, through http.ts (MockAgent answers the API) ----
  const vars: Record<string, string | undefined> = {
    PENSMITH_NETWORK_TESTS: '1',
    PENSMITH_OFFLINE: undefined,
    ZOTERO_API_KEY: 'zk-tier-contract-key',
    ZOTERO_GROUP_ID: undefined,
    PENSMITH_ZOTERO_LOCAL: undefined,
    XDG_DATA_HOME: sb.data,
    LOCALAPPDATA: sb.data,
    HOME: sb.data,
  };
  const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetHostStateForTest();
  const { agent, restore } = installMockAgent();
  try {
    const pool = agent.get('https://api.zotero.org');
    const json = { headers: { 'content-type': 'application/json' } };
    pool.intercept({ path: '/keys/current', method: 'GET' }).reply(200, { userID: 4242, access: { user: { library: true } } }, json);
    pool.intercept({ path: '/users/4242/items/top?format=json&limit=100&start=0', method: 'GET' }).reply(200, API_ITEMS, { headers: { 'content-type': 'application/json', 'total-results': '3' } });
    const pulled = await pullZoteroIntoLibrary(tier2, { collection: null });
    assert.deepEqual(pulled.added, ['vaswani2017', 'encode2012']);
    assert.equal(pulled.skipped.length, 1, 'the note is skipped');
  } finally {
    await restore();
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  // ---- Tier 1: the built MCP server's tool, with the same items ----
  const transport = new StdioClientTransport({ command: process.execPath, args: [MCP_BIN], env: sb.env({ PENSMITH_PAPER_ROOT: tier1 }), cwd: tier1, stderr: 'ignore' });
  const client = new Client({ name: 'tier-contract-zotero', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  try {
    const res = await client.callTool({ name: 'paper_ingest_zotero_items', arguments: { paperRoot: tier1, items: API_ITEMS } });
    assert.notEqual(res.isError, true, JSON.stringify(res.content));
    const body = JSON.parse((res.content as Array<{ text: string }>)[0]?.text ?? '{}') as { added: string[]; skipped: unknown[] };
    assert.deepEqual(body.added, ['vaswani2017', 'encode2012']);
    assert.equal(body.skipped.length, 1);
  } finally {
    await client.close();
  }

  // ---- Parity ----
  const t2 = libraryEntries(tier2);
  const t1 = libraryEntries(tier1);
  assert.equal(t2.length, 2);
  assert.deepEqual(t1, t2, 'identical LIBRARY.json entries from both tiers');
  const encode = t2.find((e) => e['citekey'] === 'encode2012');
  assert.deepEqual(encode?.['authors'], ['{ENCODE Project Consortium}']);
  assert.deepEqual(encode?.['zotero'], { library: 'users/4242', key: 'ENCODE12' });
  assert.equal(sourcesBlock(tier1), sourcesBlock(tier2), 'identical RESEARCH.md sources blocks');
});

test('tier-contract (SRC-16, review round 2): items of a `[sources] zotero_collection` the user has not approved are refused by both tiers (exit 3, nothing written); Tier 1 records the approval only with approveCollection', async () => {
  const sb = sandbox('tier-zotero-approval');
  const tier2 = sb.project('tier2');
  const tier1 = sb.project('tier1');
  const config = 'schema_version = 1\n[sources]\nzotero_collection = "Therapy notes"\n';
  for (const root of [tier2, tier1]) {
    mkdirSync(join(root, '.paper'), { recursive: true });
    writeFileSync(join(root, '.paper', 'config.toml'), config);
  }

  // ---- Tier 2: refused before any request (no interceptor: a request would fail differently) ----
  const vars: Record<string, string | undefined> = {
    PENSMITH_NETWORK_TESTS: '1',
    PENSMITH_OFFLINE: undefined,
    ZOTERO_API_KEY: 'zk-tier-contract-key',
    ZOTERO_GROUP_ID: undefined,
    PENSMITH_ZOTERO_LOCAL: undefined,
    XDG_DATA_HOME: sb.data,
    LOCALAPPDATA: sb.data,
    HOME: sb.data,
  };
  const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetHostStateForTest();
  const { agent, restore } = installMockAgent();
  let tier2Message = '';
  try {
    await assert.rejects(
      () => pullZoteroIntoLibrary(tier2),
      (e: unknown) => {
        tier2Message = (e as Error).message;
        return (e as { exitCode?: number }).exitCode === EXIT_APPROVAL;
      },
    );
    assert.deepEqual(agent.pendingInterceptors(), []);
  } finally {
    await restore();
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  assert.match(tier2Message, /\[sources\] zotero_collection "Therapy notes" has not been approved for this paper; nothing was added/);
  assert.equal(existsSync(join(tier2, '.paper', 'LIBRARY.json')), false);

  // ---- Tier 1: the same refusal from the built MCP server's tool ----
  const transport = new StdioClientTransport({ command: process.execPath, args: [MCP_BIN], env: sb.env({ PENSMITH_PAPER_ROOT: tier1 }), cwd: tier1, stderr: 'ignore' });
  const client = new Client({ name: 'tier-contract-zotero-approval', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  try {
    const refused = await client.callTool({ name: 'paper_ingest_zotero_items', arguments: { paperRoot: tier1, items: API_ITEMS, collection: 'Therapy notes' } });
    assert.equal(refused.isError, true);
    const body = JSON.parse((refused.content as Array<{ text: string }>)[0]?.text ?? '{}') as { exit_code: number; message: string };
    assert.equal(body.exit_code, EXIT_APPROVAL);
    assert.match(body.message, /\[sources\] zotero_collection "Therapy notes" has not been approved for this paper; nothing was added/);
    assert.equal(existsSync(join(tier1, '.paper', 'LIBRARY.json')), false, 'Tier 1 wrote nothing either');

    // The user said yes (AskUserQuestion): the approval is recorded, and the items are added.
    const approved = await client.callTool({
      name: 'paper_ingest_zotero_items',
      arguments: { paperRoot: tier1, items: API_ITEMS, collection: 'Therapy notes', approveCollection: true },
    });
    assert.notEqual(approved.isError, true, JSON.stringify(approved.content));
    const again = await client.callTool({ name: 'paper_ingest_zotero_items', arguments: { paperRoot: tier1, items: API_ITEMS, collection: 'Therapy notes' } });
    assert.notEqual(again.isError, true, 'approved once, the collection stays approved for this paper');
  } finally {
    await client.close();
  }
});
