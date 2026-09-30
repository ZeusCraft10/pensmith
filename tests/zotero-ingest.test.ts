// tests/zotero-ingest.test.ts — bin/lib/zotero-ingest.ts (SRC-16, D-19-24).
//
//   - ingestZoteroItems (Tier 1 data path): valid items → LIBRARY.json entries
//     with provenance `zotero`, a `zotero` ref, the normalized fields, tagged
//     zotero in RESEARCH.md's sources block (user notes kept);
//   - an item whose DOI is already in the library merges into that entry;
//   - one malformed item rejects the batch with its schema error (exit 2) and
//     LIBRARY.json is untouched; notes / attachments are skipped with a reason;
//   - no paper → a usage error, nothing created;
//   - pullZoteroIntoLibrary (Tier 2): `[sources] zotero_collection = "Thesis"`
//     puts only that collection's items into LIBRARY.json (MockAgent).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installMockAgent } from './helpers/local-servers/mock-agent.js';
import { ingestZoteroItems, pullZoteroIntoLibrary, ZoteroItemsInvalidError, ZoteroCollectionNotApprovedError } from '../bin/lib/zotero-ingest.js';
import { approveZoteroCollection } from '../bin/lib/own-source-approvals.js';
import { upsertSources, loadLibrary } from '../bin/lib/library.js';
import { _resetHostStateForTest } from '../bin/lib/http.js';
import { CURRENT_CONFIG_VERSION } from '../bin/lib/config.js';
import { atomicWriteFile } from '../bin/lib/atomic-write.js';
import { RESEARCH_LOG_END } from '../bin/lib/research-md.js';
import { EXIT_USAGE, EXIT_APPROVAL } from '../bin/lib/exit-codes.js';

function paper(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-zotero-ingest-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  return root;
}

const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

const ITEMS = [
  {
    key: 'XMT4Q4FT',
    library: { type: 'group', id: 100 },
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
      volume: '25',
      issue: '5',
      pages: '867-889',
      DOI: '10.1068/d416t',
      abstractNote: 'Music has its geographies too.',
    },
  },
  {
    key: 'KUHN1962',
    itemType: 'book',
    title: 'The Structure of Scientific Revolutions',
    creators: [{ creatorType: 'author', firstName: 'Thomas S.', lastName: 'Kuhn' }],
    publisher: 'University of Chicago Press',
    ISBN: '9780226458083',
    date: '1962',
  },
];

test('SRC-16: two Zotero items land in LIBRARY.json tagged zotero, with refs and fields, and in RESEARCH.md', async () => {
  const root = paper();
  try {
    await atomicWriteFile(join(root, '.paper', 'RESEARCH.md'), `# Research log\n${RESEARCH_LOG_END}\nMy own notes stay.\n`);
    const r = await ingestZoteroItems(root, ITEMS);
    assert.deepEqual(r.added, ['wood2007', 'kuhn1962']);
    assert.deepEqual([r.merged, r.unchanged, r.skipped], [[], [], []]);
    assert.equal(r.entries, 2);
    assert.equal(r.researchMdChanged, true);
    const lib = await loadLibrary(root);
    const wood = lib.entries.find((e) => e.citekey === 'wood2007');
    assert.ok(wood);
    assert.deepEqual(wood.zotero, { library: 'groups/100', key: 'XMT4Q4FT' });
    assert.deepEqual(wood.provenance, ['zotero:zotero']);
    assert.equal(wood.doi, '10.1068/d416t');
    assert.equal(wood.venue, 'Environment and Planning D: Society and Space');
    assert.deepEqual([wood.volume, wood.issue, wood.pages, wood.type], ['25', '5', '867-889', 'article-journal']);
    const kuhn = lib.entries.find((e) => e.citekey === 'kuhn1962');
    assert.deepEqual(kuhn?.zotero, { library: 'local', key: 'KUHN1962' }, 'a bare data object takes the fallback library');
    assert.deepEqual([kuhn?.type, kuhn?.isbn, kuhn?.publisher], ['book', '9780226458083', 'University of Chicago Press']);
    const md = readFileSync(join(root, '.paper', 'RESEARCH.md'), 'utf8');
    assert.match(md, /\[@wood2007\][^\n]*\n\s+- [^\n]*Tags: zotero/);
    assert.match(md, /\[@kuhn1962\]/);
    assert.match(md, /My own notes stay\./);
    assert.ok(existsSync(join(root, '.paper', 'CITATIONS.bib')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SRC-16: an item whose DOI is already in the library merges into that entry (both tags)', async () => {
  const root = paper();
  try {
    await upsertSources(root, [{ source: 'crossref', citekey: 'wood2007art', doi: '10.1068/D416T', title: 'The art of doing (geographies of) music', authors: ['Wood, Nichola'], year: 2007 }], { provenance: 'research' });
    const r = await ingestZoteroItems(root, [ITEMS[0]]);
    assert.deepEqual(r.added, []);
    assert.deepEqual(r.merged, ['wood2007art'], 'the existing citekey is kept');
    const lib = await loadLibrary(root);
    assert.equal(lib.entries.length, 1);
    assert.deepEqual(lib.entries[0]?.provenance, ['research:crossref', 'zotero:zotero']);
    assert.deepEqual(lib.entries[0]?.zotero, { library: 'groups/100', key: 'XMT4Q4FT' });
    // Re-ingesting the same item is idempotent.
    const again = await ingestZoteroItems(root, [ITEMS[0]]);
    assert.deepEqual([again.added, again.merged, again.unchanged], [[], [], ['wood2007art']]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SRC-16: one malformed item rejects the batch with its schema error (exit 2) and writes nothing', async () => {
  const root = paper();
  try {
    await ingestZoteroItems(root, [ITEMS[1]]);
    const before = sha(join(root, '.paper', 'LIBRARY.json'));
    await assert.rejects(
      () => ingestZoteroItems(root, [ITEMS[0], { key: 'ABCD2345', data: { key: 'ABCD2345', title: 'No item type' } }]),
      (e: unknown) => {
        assert.ok(e instanceof ZoteroItemsInvalidError);
        assert.equal(e.exitCode, EXIT_USAGE);
        assert.match(e.message, /^rejected 1 malformed Zotero item\(s\); nothing was added: items\[1\]\.data\.itemType: Required/);
        return true;
      },
    );
    assert.equal(sha(join(root, '.paper', 'LIBRARY.json')), before, 'LIBRARY.json untouched');
    await assert.rejects(() => ingestZoteroItems(root, []), ZoteroItemsInvalidError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SRC-16: notes and attachments are skipped with a reason, never silently', async () => {
  const root = paper();
  try {
    const r = await ingestZoteroItems(root, [{ key: 'NOTE0001', itemType: 'note', note: '<p>hi</p>' }, ITEMS[1], { key: 'ATTACH01', itemType: 'attachment', title: 'Full Text PDF' }]);
    assert.deepEqual(r.added, ['kuhn1962']);
    assert.deepEqual(r.skipped, [
      { index: 0, key: 'NOTE0001', reason: 'a Zotero note, not a citable work' },
      { index: 2, key: 'ATTACH01', reason: 'a Zotero attachment, not a citable work' },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SRC-16: no paper at the root → a usage error, and no .paper/ is created', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-zotero-nopaper-'));
  try {
    await assert.rejects(() => ingestZoteroItems(root, ITEMS), /no paper at .* \(no \.paper\/ folder\)/);
    assert.equal(existsSync(join(root, '.paper')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SRC-16: Tier 2 — ZOTERO_API_KEY + zotero_collection = "Thesis" puts only that collection\'s items in LIBRARY.json, tagged zotero', async () => {
  const root = paper();
  await atomicWriteFile(join(root, '.paper', 'config.toml'), `schema_version = ${CURRENT_CONFIG_VERSION}\n[sources]\nzotero_collection = "Thesis"\n`);
  const data = mkdtempSync(join(tmpdir(), 'pensmith-zotero-ingest-data-'));
  const vars: Record<string, string | undefined> = { PENSMITH_NETWORK_TESTS: '1', PENSMITH_OFFLINE: undefined, ZOTERO_API_KEY: 'zk-test-key-123456', ZOTERO_GROUP_ID: undefined, PENSMITH_ZOTERO_LOCAL: undefined, LOCALAPPDATA: data, XDG_DATA_HOME: data, HOME: data };
  const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetHostStateForTest();
  const { agent, restore } = installMockAgent();
  try {
    // Review round 2: the collection the paper names is the reader's own
    // material — refused (exit 3, no request, nothing written) until approved.
    await assert.rejects(
      () => pullZoteroIntoLibrary(root),
      (e: unknown) => e instanceof ZoteroCollectionNotApprovedError && e.exitCode === EXIT_APPROVAL && /"Thesis" has not been approved for this paper/.test(e.message),
    );
    assert.equal(existsSync(join(root, '.paper', 'LIBRARY.json')), false);
    await approveZoteroCollection(root, 'Thesis');
    const pool = agent.get('https://api.zotero.org');
    const json = { headers: { 'content-type': 'application/json' } };
    pool.intercept({ path: '/keys/current', method: 'GET' }).reply(200, { userID: 777, access: { user: { library: true } } }, json);
    pool.intercept({ path: '/users/777/collections?format=json&limit=100&start=0', method: 'GET' }).reply(200, [
      { key: 'THESIS01', data: { name: 'Thesis' } },
      { key: 'OTHER001', data: { name: 'Side project' } },
    ], json);
    pool.intercept({ path: '/users/777/collections/THESIS01/items/top?format=json&limit=100&start=0', method: 'GET' }).reply(200, [
      { ...ITEMS[0], library: { type: 'user', id: 777 } },
      { key: 'KUHN1962', library: { type: 'user', id: 777 }, data: ITEMS[1] },
    ], { headers: { 'content-type': 'application/json', 'total-results': '2' } });
    const r = await pullZoteroIntoLibrary(root);
    assert.equal(r.collection, 'Thesis');
    assert.equal(r.library, 'users/777');
    assert.deepEqual(r.added.sort(), ['kuhn1962', 'wood2007']);
    const lib = await loadLibrary(root);
    assert.equal(lib.entries.length, 2, 'only the Thesis collection');
    for (const e of lib.entries) {
      assert.ok(e.provenance.includes('zotero:zotero'));
      assert.equal(e.zotero?.library, 'users/777');
    }
    assert.deepEqual(agent.pendingInterceptors(), []);
  } finally {
    await restore();
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
});
