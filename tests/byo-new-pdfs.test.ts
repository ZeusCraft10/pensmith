// tests/byo-new-pdfs.test.ts — SRC-15 (D-19-21): `pensmith new --from a.txt
// --pdfs <dir>` ingests the folder's PDFs as bring-your-own sources, records
// the folder as `[sources] byo_pdf_dir`, and the only requests it makes for
// them are identifier lookups. An unusable --pdfs folder is a usage error
// before anything is written. Spawns the BUILT CLI (run `npm run build`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CLI = path.join(REPO, 'dist', 'bin', 'pensmith.js');
const BYO = path.join(REPO, 'tests', 'fixtures', 'byo');

function run(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  assert.ok(fs.existsSync(CLI), 'dist/ is missing — run `npm run build` first');
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  Object.assign(env, { PENSMITH_TEST: '1', PENSMITH_NO_LLM: '1' });
  delete env['PENSMITH_NETWORK_TESTS'];
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8', timeout: 180_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-newpdfs-'));
  fs.copyFileSync(path.join(REPO, 'tests', 'fixtures', 'assignment.txt'), path.join(root, 'a.txt'));
  fs.mkdirSync(path.join(root, 'pdfs'));
  for (const n of ['attention-arxiv-layout.pdf', 'doi-footer.pdf']) fs.copyFileSync(path.join(BYO, n), path.join(root, 'pdfs', n));
  return root;
}

test('SRC-15: `new --from a.txt --pdfs pdfs --yolo` ingests both PDFs tagged bring-your-own; only identifiers leave', () => {
  const root = project();
  const r = run(root, ['new', '--from', 'a.txt', '--pdfs', 'pdfs', '--yolo']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /pensmith new: bring-your-own: 2 PDF\(s\) in pdfs \(recorded as \[sources\] byo_pdf_dir\)/);
  assert.match(r.stdout, /attention-arxiv-layout\.pdf added as vaswani2017 \(identified by arXiv:1706\.03762\)/);
  assert.match(r.stdout, /doi-footer\.pdf added as aspelmeyer2009 \(identified by 10\.1038\/nphys1170\)/);

  const lib = JSON.parse(fs.readFileSync(path.join(root, '.paper', 'LIBRARY.json'), 'utf8')) as { entries: Array<{ citekey: string; provenance: string[]; byo: { file: string } | null }> };
  assert.deepEqual(lib.entries.map((e) => [e.citekey, e.byo?.file]).sort(), [
    ['aspelmeyer2009', 'sources/aspelmeyer2009.pdf'],
    ['vaswani2017', 'sources/vaswani2017.pdf'],
  ]);
  const research = fs.readFileSync(path.join(root, '.paper', 'RESEARCH.md'), 'utf8');
  assert.equal((research.match(/Tags: bring-your-own/g) ?? []).length, 2);
  assert.match(fs.readFileSync(path.join(root, '.paper', 'config.toml'), 'utf8'), /\[sources\]\nbyo_pdf_dir = "pdfs"/);

  const http = fs
    .readFileSync(path.join(root, '.paper', 'SESSION.log'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { kind: string; url?: string; method?: string })
    .filter((x) => x.kind === 'http');
  assert.deepEqual(
    http.map((x) => `${x.method} ${x.url}`),
    ['GET https://export.arxiv.org/api/query?id_list=1706.03762', 'GET https://api.crossref.org/works/10.1038%2Fnphys1170'],
    'one identifier lookup per PDF; no PDF text in any request',
  );

  // PRD §7.1 / §7.2: `new` routes to research — the user's own PDFs are ingested
  // first, the discovery search still runs (never an outline built on two PDFs).
  const next = run(root, ['next']);
  assert.match(`${next.stdout}\n${next.stderr}`, /pensmith next: → research/);
  const status = run(root, ['status']);
  assert.match(status.stdout, /next: research/, status.stdout);
});

test('SRC-15: an unusable --pdfs folder is a usage error before anything is written', () => {
  const root = project();
  const r = run(root, ['new', '--from', 'a.txt', '--pdfs', 'no-such-folder', '--yolo']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /--pdfs no-such-folder: no such folder/);
  assert.equal(fs.existsSync(path.join(root, '.paper')), false, 'nothing was written');
});
