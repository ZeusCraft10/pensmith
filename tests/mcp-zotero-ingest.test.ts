// tests/mcp-zotero-ingest.test.ts — the Tier 1 Zotero tool on the BUILT MCP
// server (SRC-16, D-19-24): paper_ingest_zotero_items.
//
//   - two items a Zotero MCP server returned (a full API item and a bare data
//     object) are added to LIBRARY.json through bin/lib (tagged zotero) and
//     listed in RESEARCH.md;
//   - a malformed item is rejected with its schema error (isError, exit 2,
//     nothing written);
//   - a root without a paper is a structured refusal.
//
// Run `npm run build` first — this spawns dist/mcp/server.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCP_BIN, sandbox, type Sandbox } from './helpers/paper-cli-harness.js';
import { EXIT_USAGE } from '../bin/lib/exit-codes.js';

interface Outcome {
  isError: boolean;
  body: Record<string, unknown>;
}

async function ingest(sb: Sandbox, root: string, items: unknown[]): Promise<Outcome> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [MCP_BIN], env: sb.env({ PENSMITH_PAPER_ROOT: root }), cwd: root, stderr: 'ignore' });
  const client = new Client({ name: 'zotero-ingest-test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  try {
    const res = await client.callTool({ name: 'paper_ingest_zotero_items', arguments: { paperRoot: root, items } });
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? 'null';
    return { isError: res.isError === true, body: (JSON.parse(text) ?? {}) as Record<string, unknown> };
  } finally {
    await client.close();
  }
}

/** As `zotero_get_item_metadata(format="json")` returns it: the complete raw Zotero item. */
const FULL_ITEM = {
  key: 'VASWANI1',
  version: 12,
  library: { type: 'user', id: 4242, name: 'ada' },
  data: {
    key: 'VASWANI1',
    version: 12,
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
  },
};
/** A bare `data` object (some servers return only that). */
const DATA_ONLY = {
  key: 'LECUN015',
  itemType: 'journalArticle',
  title: 'Deep learning',
  creators: [{ creatorType: 'author', firstName: 'Yann', lastName: 'LeCun' }],
  publicationTitle: 'Nature',
  volume: '521',
  issue: '7553',
  pages: '436-444',
  date: '2015-05-28',
  DOI: '10.1038/nature14539',
};

test('SRC-16: build artifact exists (run `npm run build` first)', () => {
  assert.ok(existsSync(MCP_BIN), `missing ${MCP_BIN}`);
});

test('SRC-16: paper_ingest_zotero_items adds two items through bin/lib — LIBRARY.json tagged zotero, RESEARCH.md lists them', async () => {
  const sb = sandbox('mcp-zotero');
  const root = sb.project('paper');
  mkdirSync(join(root, '.paper'), { recursive: true });
  const out = await ingest(sb, root, [FULL_ITEM, DATA_ONLY]);
  assert.equal(out.isError, false, JSON.stringify(out.body));
  assert.deepEqual(out.body['added'], ['vaswani2017', 'lecun2015']);
  assert.deepEqual(out.body['skipped'], []);
  const lib = JSON.parse(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8')) as { $schemaVersion: number; entries: Array<Record<string, unknown>> };
  assert.equal(lib.$schemaVersion, 3);
  const vaswani = lib.entries.find((e) => e['citekey'] === 'vaswani2017');
  assert.deepEqual(vaswani?.['zotero'], { library: 'users/4242', key: 'VASWANI1' });
  assert.equal(vaswani?.['arxiv'], '1706.03762');
  assert.equal(vaswani?.['type'], 'paper-conference');
  assert.deepEqual(vaswani?.['provenance'], ['zotero:zotero']);
  const lecun = lib.entries.find((e) => e['citekey'] === 'lecun2015');
  assert.deepEqual(lecun?.['zotero'], { library: 'local', key: 'LECUN015' });
  assert.equal(lecun?.['doi'], '10.1038/nature14539');
  const md = readFileSync(join(root, '.paper', 'RESEARCH.md'), 'utf8');
  assert.match(md, /\[@vaswani2017\]/);
  assert.match(md, /\[@lecun2015\][^\n]*\n\s+- [^\n]*Tags: zotero/);
  const bib = readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8');
  assert.match(bib, /vaswani2017/);
});

test('SRC-16: a malformed item is rejected with its schema error (isError, exit 2) and nothing is written', async () => {
  const sb = sandbox('mcp-zotero-bad');
  const root = sb.project('paper');
  mkdirSync(join(root, '.paper'), { recursive: true });
  const out = await ingest(sb, root, [DATA_ONLY, { key: 'nope', itemType: 'book', title: 'Bad key' }]);
  assert.equal(out.isError, true);
  assert.equal(out.body['exit_code'], EXIT_USAGE);
  assert.match(String(out.body['message']), /^rejected 1 malformed Zotero item\(s\); nothing was added: items\[1\]\.key: a Zotero item key is 8 characters/);
  assert.equal(existsSync(join(root, '.paper', 'LIBRARY.json')), false, 'nothing was written');
});

test('SRC-16: no paper at paperRoot is a structured refusal and creates nothing', async () => {
  const sb = sandbox('mcp-zotero-nopaper');
  const root = sb.project('empty');
  const out = await ingest(sb, root, [DATA_ONLY]);
  assert.equal(out.isError, true);
  assert.match(String(out.body['message']), /no paper at/);
  assert.equal(existsSync(join(root, '.paper', 'LIBRARY.json')), false);
});
