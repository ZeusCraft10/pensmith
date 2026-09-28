// tests/byo-ingest.test.ts — SRC-15 (D-19-21): bring-your-own PDFs enter
// LIBRARY.json through the one library writer, tagged bring-your-own, with
// the PDF kept at .paper/sources/<citekey>.pdf and its hashes recorded; a PDF
// no registrar identifies is kept unhydrated with a warning (never as a
// search hit); re-ingest is idempotent; a later search hit for the same work
// merges into the BYO entry.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ingestByoPdf,
  ingestByoPdfs,
  listPdfsInDir,
  upsertWithPdf,
  describeByoOutcome,
  recordByoPdfDir,
  resolveByoDirArg,
} from '../bin/lib/byo-ingest.js';
import { loadLibrary, upsertSources } from '../bin/lib/library.js';
import { provenanceTags } from '../bin/lib/research-md.js';
import { sha256Hex } from '../bin/lib/byo-text.js';
import { readPaperConfigSync } from '../bin/lib/config.js';
import { installMockAgent } from './helpers/local-servers/mock-agent.js';
import { withLlmSandbox } from './helpers/llm-sandbox.js';

const BYO = fileURLToPath(new URL('./fixtures/byo/', import.meta.url));

function paper(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-byoingest-'));
  fs.mkdirSync(path.join(root, '.paper'), { recursive: true });
  return root;
}

function folderWith(...names: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-byodir-'));
  for (const n of names) fs.copyFileSync(path.join(BYO, n), path.join(dir, n));
  return dir;
}

test('SRC-15: two PDFs → two entries tagged bring-your-own, copied under .paper/sources/, hashed, listed in RESEARCH.md', async () => {
  const root = paper();
  const dir = folderWith('attention-arxiv-layout.pdf', 'doi-footer.pdf');
  const files = await listPdfsInDir(dir);
  assert.equal(files.length, 2);
  const outcomes = await ingestByoPdfs(root, files);
  assert.deepEqual(outcomes.map((o) => [path.basename(o.file), o.status, 'citekey' in o ? o.citekey : null]), [
    ['attention-arxiv-layout.pdf', 'added', 'vaswani2017'],
    ['doi-footer.pdf', 'added', 'aspelmeyer2009'],
  ]);
  const lib = await loadLibrary(root);
  for (const e of lib.entries) {
    assert.deepEqual(provenanceTags(e), ['bring-your-own'], e.citekey);
    assert.equal(e.hydrated, true);
    assert.equal(e.byo!.file, `sources/${e.citekey}.pdf`);
    const stored = fs.readFileSync(path.join(root, '.paper', 'sources', `${e.citekey}.pdf`));
    assert.equal(e.byo!.sha256, sha256Hex(stored));
    assert.match(e.byo!.text_sha256 ?? '', /^[0-9a-f]{64}$/);
  }
  const research = fs.readFileSync(path.join(root, '.paper', 'RESEARCH.md'), 'utf8');
  assert.match(research, /\[@vaswani2017\][^\n]*\n {2}- Tier: not evaluated · Tags: bring-your-own/);
  assert.match(research, /\[@aspelmeyer2009\][^\n]*\n {2}- Tier: not evaluated · Tags: bring-your-own/);
  const bib = fs.readFileSync(path.join(root, '.paper', 'CITATIONS.bib'), 'utf8');
  assert.match(bib, /@misc\{vaswani2017,[\s\S]*eprint = \{1706\.03762\}/);
  assert.match(bib, /@article\{aspelmeyer2009,[\s\S]*doi = \{10\.1038\/nphys1170\}/);
  assert.match(describeByoOutcome(outcomes[0]!, 'pensmith add').line, /attention-arxiv-layout\.pdf added as vaswani2017 \(identified by arXiv:1706\.03762\)/);
});

test('SRC-15: re-ingest is idempotent by sha256 (nothing rewritten)', async () => {
  const root = paper();
  const file = path.join(BYO, 'doi-footer.pdf');
  await ingestByoPdf(root, file);
  const libBefore = fs.readFileSync(path.join(root, '.paper', 'LIBRARY.json'), 'utf8');
  const again = await ingestByoPdf(root, file);
  assert.equal(again.status, 'already-ingested');
  assert.equal('citekey' in again && again.citekey, 'aspelmeyer2009');
  assert.equal(fs.readFileSync(path.join(root, '.paper', 'LIBRARY.json'), 'utf8'), libBefore);
});

test('SRC-15: a later search hit with the same DOI merges into the BYO entry — one entry, both tags', async () => {
  const root = paper();
  await ingestByoPdf(root, path.join(BYO, 'doi-footer.pdf'));
  const r = await upsertSources(
    root,
    [{ source: 'crossref', doi: '10.1038/NPHYS1170', title: 'Measured measurement', authors: ['Aspelmeyer, Markus'], year: 2009, abstract: 'A longer abstract from the search hit.' }],
    { provenance: 'research' },
  );
  assert.equal(r.outcomes[0]!.citekey, 'aspelmeyer2009');
  assert.equal(r.outcomes[0]!.status, 'merged');
  const lib = await loadLibrary(root);
  assert.equal(lib.entries.length, 1);
  assert.deepEqual(provenanceTags(lib.entries[0]!), ['bring-your-own', 'search']);
  assert.ok(lib.entries[0]!.byo, 'the PDF record survives the merge');
});

test('SRC-15: offline, a PDF that needs a title search is skipped with a reason (never added unidentified)', async () => {
  const root = paper();
  const o = await ingestByoPdf(root, path.join(BYO, 'no-match.pdf'));
  assert.equal(o.status, 'skipped');
  assert.match('reason' in o ? o.reason : '', /identifying it needs the network \(offline\)/);
  assert.equal(fs.existsSync(path.join(root, '.paper', 'LIBRARY.json')), false);
});

test('SRC-15: a non-PDF, a missing file and an unusable folder argument are reported, not ingested', async () => {
  const root = paper();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-byobad-'));
  fs.writeFileSync(path.join(dir, 'fake.pdf'), 'this is not a PDF');
  const o = await ingestByoPdf(root, path.join(dir, 'fake.pdf'));
  assert.deepEqual({ status: o.status, reason: 'reason' in o ? o.reason : '' }, { status: 'skipped', reason: 'not a PDF (no %PDF- header)' });
  const strict = await ingestByoPdf(root, path.join(dir, 'missing.pdf'), { strict: true });
  assert.equal(strict.status, 'refused');
  assert.throws(() => resolveByoDirArg(path.join(dir, 'nope')), /--pdfs .*: no such folder/);
  assert.equal(resolveByoDirArg(dir), dir);
});

test('SRC-15: new --pdfs records [sources] byo_pdf_dir relative to the project when inside it', async () => {
  const root = paper();
  const inside = path.join(root, 'my pdfs');
  fs.mkdirSync(inside);
  assert.equal(await recordByoPdfDir(root, inside), 'my pdfs');
  assert.equal(readPaperConfigSync(root).config?.sources?.byo_pdf_dir, 'my pdfs');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-byoout-'));
  assert.equal(await recordByoPdfDir(root, outside), outside);
});

// ---------------------------------------------------------------------------
// Live lane (MockAgent): unhydrated entries, re-identification, what leaves.
// ---------------------------------------------------------------------------

/**
 * One live-lane case in a private data dir (tests/helpers/llm-sandbox.ts), so
 * it sees only its own MockAgent answers: the runner's data dir — and so its
 * HTTP cache — is shared by every test file of a run.
 */
async function liveLane<T>(fn: (agent: ReturnType<typeof installMockAgent>['agent'], seen: string[]) => Promise<T>): Promise<T> {
  return withLlmSandbox({ paper: false, env: { PENSMITH_NETWORK_TESTS: '1' } }, async () => {
    const { agent, restore } = installMockAgent();
    try {
      return await fn(agent, []);
    } finally {
      await restore();
    }
  });
}

function reply(seen: string[], body: unknown): (opts: { path: string }) => { statusCode: number; data: string; responseOptions: { headers: Record<string, string> } } {
  return (opts) => {
    seen.push(opts.path);
    return { statusCode: 200, data: JSON.stringify(body), responseOptions: { headers: { 'content-type': 'application/json' } } };
  };
}

const EMPTY_CROSSREF = { status: 'ok', 'message-type': 'work-list', message: { items: [], 'total-results': 0, 'items-per-page': 5, query: { 'start-index': 0, 'search-terms': 'x' } } };
const EMPTY_OPENALEX = { meta: { count: 0 }, results: [] };

test('SRC-15 (MockAgent): a no-match PDF is added unhydrated with a warning and its local metadata; only the title left', async () => {
  const root = paper();
  await liveLane(async (agent, seen) => {
    agent.get('https://api.crossref.org').intercept({ path: /.*/, method: 'GET' }).reply(reply(seen, EMPTY_CROSSREF));
    agent.get('https://api.openalex.org').intercept({ path: /.*/, method: 'GET' }).reply(reply(seen, EMPTY_OPENALEX));
    const [o] = await ingestByoPdfs(root, [path.join(BYO, 'no-match.pdf')]);
    assert.ok(o);
    assert.equal(o.status, 'added');
    assert.equal('hydrated' in o && o.hydrated, false);
    assert.match('warning' in o ? o.warning ?? '' : '', /not identified .* kept with the PDF's own metadata; check it before citing/);
    assert.equal(seen.length, 2);
    for (const p of seen) assert.match(decodeURIComponent(p.replace(/\+/g, ' ')), /Field Notes on Moss Growth Beside the Old Mill Stream/);
    for (const p of seen) assert.doesNotMatch(p, /Quillfeather|observations/);
  });
  const e = (await loadLibrary(root)).entries[0]!;
  assert.equal(e.hydrated, false);
  assert.equal(e.title, 'Field Notes on Moss Growth Beside the Old Mill Stream');
  assert.deepEqual(e.authors, ['Harriet Quillfeather']);
  assert.equal(e.doi, null, 'never a search hit');
  assert.deepEqual(provenanceTags(e), ['bring-your-own']);
  assert.match(fs.readFileSync(path.join(root, '.paper', 'RESEARCH.md'), 'utf8'), /Metadata: local only — no registrar record matched this PDF confidently/);
  assert.match(fs.readFileSync(path.join(root, '.paper', 'CITATIONS.bib'), 'utf8'), /@misc\{quillfeathernoyear,/, 'an identifier-less BYO source can still be cited');
});

test('SRC-15 (MockAgent): re-ingesting an unhydrated PDF that can now be identified hydrates the SAME entry', async () => {
  const root = paper();
  await liveLane(async (agent, seen) => {
    agent.get('https://api.crossref.org').intercept({ path: /.*/, method: 'GET' }).reply(reply(seen, EMPTY_CROSSREF));
    agent.get('https://api.openalex.org').intercept({ path: /.*/, method: 'GET' }).reply(reply(seen, EMPTY_OPENALEX));
    await ingestByoPdf(root, path.join(BYO, 'no-match.pdf'));
  });
  await liveLane(async (agent, seen) => {
    const item = { DOI: '10.5555/moss.2024', title: ['Field Notes on Moss Growth Beside the Old Mill Stream'], author: [{ family: 'Quillfeather', given: 'Harriet' }], issued: { 'date-parts': [[2024]] } };
    agent.get('https://api.crossref.org').intercept({ path: /.*/, method: 'GET' }).reply(reply(seen, { ...EMPTY_CROSSREF, message: { ...EMPTY_CROSSREF.message, items: [item] } }));
    const o = await ingestByoPdf(root, path.join(BYO, 'no-match.pdf'));
    assert.equal(o.status, 'merged', JSON.stringify(o));
    assert.equal('citekey' in o && o.citekey, 'quillfeathernoyear', 'the citekey drafts may cite is kept');
  });
  const lib = await loadLibrary(root);
  assert.equal(lib.entries.length, 1);
  assert.equal(lib.entries[0]!.hydrated, true);
  assert.equal(lib.entries[0]!.doi, '10.5555/moss.2024');
  assert.equal(lib.entries[0]!.year, 2024);
});

test('SRC-15: `add <id> --pdf <file>` for a PDF ingested unhydrated hydrates that entry instead of duplicating the work', async () => {
  const root = paper();
  await liveLane(async (agent, seen) => {
    agent.get('https://api.crossref.org').intercept({ path: /.*/, method: 'GET' }).reply(reply(seen, EMPTY_CROSSREF));
    agent.get('https://api.openalex.org').intercept({ path: /.*/, method: 'GET' }).reply(reply(seen, EMPTY_OPENALEX));
    await ingestByoPdf(root, path.join(BYO, 'no-match.pdf'));
  });
  const r = await upsertWithPdf(
    root,
    { source: 'crossref', doi: '10.5555/moss.2024', title: 'Field Notes on Moss Growth Beside the Old Mill Stream', authors: ['Quillfeather, Harriet'], year: 2024 },
    path.join(BYO, 'no-match.pdf'),
    'add',
  );
  assert.deepEqual({ citekey: r.citekey, status: r.status }, { citekey: 'quillfeathernoyear', status: 'merged' });
  const lib = await loadLibrary(root);
  assert.equal(lib.entries.length, 1);
  assert.equal(lib.entries[0]!.doi, '10.5555/moss.2024');
});
