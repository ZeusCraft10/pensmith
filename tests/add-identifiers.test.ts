// tests/add-identifiers.test.ts — SRC-13 / SRC-14 / SRC-15 (D-19-20): `add`
// resolves every identifier form through its registrar, reports a failed
// lookup as a failure (never "not found"), fetches URLs through the transport
// (checking that a PDF is a PDF, refusing SSRF targets), refuses a PDF it
// cannot identify without changing anything, attaches `--pdf` copies, ingests
// folders, and prints the REAL (suffixed) citekey.
//
// Offline answers come from the recorded cassettes (arXiv 1706.03762, Crossref
// 10.1038/nphys1170); live-lane cases use the V5 MockAgent.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addCommand, UNIDENTIFIED_PDF_MESSAGE } from '../bin/cli/add.js';
import { loadLibrary, upsertSources } from '../bin/lib/library.js';
import { sources } from '../bin/lib/sources/index.js';
import { lookupFailed, lookupNotFound } from '../bin/lib/sources/lookup.js';
import { installMockAgent } from './helpers/local-servers/mock-agent.js';
import { withLlmSandbox } from './helpers/llm-sandbox.js';

const BYO = fileURLToPath(new URL('./fixtures/byo/', import.meta.url));

function paper(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-addids-'));
  fs.mkdirSync(path.join(root, '.paper'), { recursive: true });
  return root;
}

interface Captured {
  result: Record<string, unknown>;
  stdout: string;
  stderr: string;
}

/** Run `add` in-process from `cwd`, capturing its stdout/stderr lines. */
async function runAdd(cwd: string, args: Record<string, unknown>): Promise<Captured> {
  const prevCwd = process.cwd();
  const prevExit = process.exitCode;
  const out: string[] = [];
  const err: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  // Capture the verb's own lines (they all start with "pensmith"); anything
  // else — the test runner's TAP stream — passes through untouched.
  const tap = (sink: string[], orig: (c: string | Uint8Array) => boolean) =>
    ((chunk: string | Uint8Array) => {
      const s = String(chunk);
      if (/^pensmith/.test(s)) {
        sink.push(s);
        return true;
      }
      return orig(chunk);
    }) as typeof process.stdout.write;
  process.stdout.write = tap(out, origOut);
  process.stderr.write = tap(err, origErr);
  process.chdir(cwd);
  try {
    const result = (await addCommand.run!({ args: { yolo: true, remap: false, ...args } } as never)) as Record<string, unknown>;
    return { result, stdout: out.join(''), stderr: err.join('') };
  } finally {
    process.chdir(prevCwd);
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    process.exitCode = prevExit;
  }
}

function bibOf(root: string): string {
  return fs.readFileSync(path.join(root, '.paper', 'CITATIONS.bib'), 'utf8');
}

function httpRecords(root: string): string[] {
  const log = path.join(root, '.paper', 'SESSION.log');
  if (!fs.existsSync(log)) return [];
  return fs
    .readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { kind: string; url?: string })
    .filter((r) => r.kind === 'http')
    .map((r) => r.url ?? '');
}

// ---------------------------------------------------------------------------
// Identifiers (offline, recorded answers).
// ---------------------------------------------------------------------------

for (const input of ['arXiv:1706.03762', '1706.03762', 'arXiv:1706.03762v7.', 'https://arxiv.org/abs/1706.03762', 'https://arxiv.org/pdf/1706.03762v7.pdf', '10.48550/arXiv.1706.03762']) {
  test(`SRC-13: \`add ${input}\` adds Vaswani 2017 with eprint = {1706.03762} and archivePrefix = {arXiv}`, async () => {
    const root = paper();
    const r = await runAdd(root, { source: input });
    assert.equal(r.result['ok'], true, r.stderr);
    assert.equal(r.result['citekey'], 'vaswani2017');
    assert.match(r.stdout, /^pensmith add: added vaswani2017\.\npensmith add: vaswani2017 — Attention Is All You Need \(2017\)$/m);
    assert.match(bibOf(root), /@misc\{vaswani2017,[\s\S]*eprint = \{1706\.03762\},\n {2}archivePrefix = \{arXiv\},/);
    assert.deepEqual(httpRecords(root), ['https://export.arxiv.org/api/query?id_list=1706.03762'], 'an arXiv URL is an identifier: nothing is downloaded');
    const research = fs.readFileSync(path.join(root, '.paper', 'RESEARCH.md'), 'utf8');
    assert.match(research, /\[@vaswani2017\]/, 'RESEARCH.md lists the new source');
  });
}

test('SRC-14: a known work keeps its key; a colliding new work gets the suffixed key everywhere', async () => {
  const root = paper();
  await upsertSources(root, [{ citekey: 'aspelmeyer2009', doi: '10.5555/other.work', title: 'Another paper by the same author', authors: ['Aspelmeyer, Markus'], year: 2009 }], { provenance: 'research' });
  const first = await runAdd(root, { source: '10.1038/nphys1170' });
  assert.equal(first.result['citekey'], 'aspelmeyer2009a');
  assert.match(first.stdout, /^pensmith add: added aspelmeyer2009a\.\npensmith add: aspelmeyer2009a — Measured measurement \(2009\)$/m);
  assert.match(bibOf(root), /@article\{aspelmeyer2009a,/);
  const again = await runAdd(root, { source: 'https://doi.org/10.1038%2Fnphys1170' });
  assert.equal(again.result['citekey'], 'aspelmeyer2009a');
  assert.match(again.stdout, /already in library as aspelmeyer2009a/);
  assert.equal((await loadLibrary(root)).entries.length, 2);
});

test('SRC-13: `add <doi> --pdf <file>` attaches the PDF as the work\'s bring-your-own copy', async () => {
  const root = paper();
  const r = await runAdd(root, { source: 'DOI: 10.1038/nphys1170', pdf: path.join(BYO, 'doi-footer.pdf') });
  assert.equal(r.result['ok'], true, r.stderr);
  const e = (await loadLibrary(root)).entries[0]!;
  assert.equal(e.citekey, 'aspelmeyer2009');
  assert.equal(e.byo?.file, 'sources/aspelmeyer2009.pdf');
  assert.ok(fs.existsSync(path.join(root, '.paper', 'sources', 'aspelmeyer2009.pdf')));
  assert.match(r.stdout, /attached doi-footer\.pdf to aspelmeyer2009/);
  // a PDF that does not mention the work is attached with a warning
  const other = paper();
  const w = await runAdd(other, { source: '10.1038/nphys1170', pdf: path.join(BYO, 'no-match.pdf') });
  assert.equal(w.result['ok'], true);
  assert.match(w.stderr, /WARN — the PDF's first pages do not mention "Measured measurement"/);
});

test('SRC-13: an unclassifiable argument, and --pdf without an identifier, are usage errors (exit 2) before any request', async () => {
  const root = paper();
  await assert.rejects(runAdd(root, { source: 'not a source at all' }), (e: Error & { exitCode?: number }) => e.exitCode === 2);
  await assert.rejects(runAdd(root, { source: '31978945' }), (e: Error & { exitCode?: number }) => e.exitCode === 2 && /PMID:31978945/.test(e.message));
  await assert.rejects(
    runAdd(root, { source: 'https://example.org/x', pdf: path.join(BYO, 'doi-footer.pdf') }),
    (e: Error & { exitCode?: number }) => e.exitCode === 2 && /--pdf goes with an identifier/.test(e.message),
  );
  assert.deepEqual(httpRecords(root), []);
});

// ---------------------------------------------------------------------------
// Lookup outcomes: failed is never "not found".
// ---------------------------------------------------------------------------

async function withCrossref<T>(fake: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const reg = sources as unknown as Record<string, unknown>;
  const saved = reg['crossref'];
  reg['crossref'] = fake;
  try {
    return await fn();
  } finally {
    reg['crossref'] = saved;
  }
}

test('SRC-13: a failed lookup reports `lookup failed (<reason>)`, exit 1, nothing added; not-found says so', async () => {
  const root = paper();
  const failed = await withCrossref({ lookupById: async () => lookupFailed('HTTP 503 after retries') }, () => runAdd(root, { source: '10.1038/nature14539' }));
  assert.equal(failed.result['exitCode'], 1);
  assert.match(failed.stderr, /pensmith add: DOI 10\.1038\/nature14539: lookup failed \(HTTP 503 after retries\) — nothing added\./);
  const missing = await withCrossref({ lookupById: async () => lookupNotFound('HTTP 404') }, () => runAdd(root, { source: '10.1038/nature14539' }));
  assert.equal(missing.result['exitCode'], 1);
  assert.match(missing.stderr, /DOI 10\.1038\/nature14539: not found \(HTTP 404\) — nothing added/);
  assert.equal(fs.existsSync(path.join(root, '.paper', 'LIBRARY.json')), false);
});

test('SRC-11/SRC-13: `add isbn:<ISBN>` goes to the books adapter by registry name', async () => {
  const root = paper();
  const hasBooks = 'books' in (sources as unknown as Record<string, unknown>);
  const r = await runAdd(root, { source: 'isbn:9780226458083' });
  if (!hasBooks) {
    assert.equal(r.result['exitCode'], 1);
    assert.match(r.stderr, /ISBN 9780226458083: lookup failed \(no book \(ISBN\) lookup is available in this build\)/);
  } else {
    // with the books adapter: the recorded answer (or the named offline
    // refusal) — never a failure read as "not found"
    assert.doesNotMatch(r.stderr, /lookup failed \(no book/);
  }
});

// ---------------------------------------------------------------------------
// PDFs and folders.
// ---------------------------------------------------------------------------

test('SRC-15: an image-only PDF is refused ("no extractable text"), nothing changes', async () => {
  const root = paper();
  const r = await runAdd(root, { source: path.join(BYO, 'image-only.pdf') });
  assert.equal(r.result['exitCode'], 1);
  assert.match(r.stderr, /image-only\.pdf: no extractable text \(an image-only or scanned PDF\) — pass its DOI: pensmith add <doi> --pdf <file>/);
  assert.equal(fs.existsSync(path.join(root, '.paper', 'LIBRARY.json')), false);
});

test('SRC-15: `add <dir>` ingests every PDF in the folder (bring-your-own)', async () => {
  const root = paper();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-adddir-'));
  for (const n of ['attention-arxiv-layout.pdf', 'doi-footer.pdf']) fs.copyFileSync(path.join(BYO, n), path.join(dir, n));
  const r = await runAdd(root, { source: dir });
  assert.equal(r.result['ok'], true, r.stderr);
  assert.deepEqual(r.result['citekeys'], ['vaswani2017', 'aspelmeyer2009']);
  assert.match(r.stdout, /bring-your-own: doi-footer\.pdf added as aspelmeyer2009 \(identified by 10\.1038\/nphys1170\)/);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-addempty-'));
  const none = await runAdd(root, { source: empty });
  assert.equal(none.result['exitCode'], 1);
  assert.match(none.stderr, /no PDF files in this folder/);
});

// ---------------------------------------------------------------------------
// Live lane (MockAgent): URLs, SSRF, the unidentified PDF.
// ---------------------------------------------------------------------------

/**
 * One live-lane case in a private data dir (tests/helpers/llm-sandbox.ts), so
 * it sees only its own MockAgent answers: the runner's data dir — and so its
 * HTTP cache — is shared by every test file of a run.
 */
async function liveLane<T>(fn: (agent: ReturnType<typeof installMockAgent>['agent']) => Promise<T>): Promise<T> {
  return withLlmSandbox({ paper: false, env: { PENSMITH_NETWORK_TESTS: '1' } }, async () => {
    const { agent, restore } = installMockAgent();
    try {
      return await fn(agent);
    } finally {
      await restore();
    }
  });
}

test('SRC-01/SRC-13 (MockAgent): a .pdf URL answering text/html prints "not a PDF (got text/html)" — no pdf-parse output, exit 1', async () => {
  const root = paper();
  await liveLane(async (agent) => {
    agent.get('https://example.org').intercept({ path: '/paper.pdf', method: 'GET' }).reply(200, '<html><body>Sign in to read this article</body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    const r = await runAdd(root, { source: 'https://example.org/paper.pdf' });
    assert.equal(r.result['exitCode'], 1);
    assert.match(r.stderr, /pensmith add: https:\/\/example\.org\/paper\.pdf: not a PDF \(got text\/html\) — nothing added\./);
    assert.doesNotMatch(r.stdout + r.stderr, /Invalid PDF|FormatError|Warning:/, 'the page never reached the PDF parser');
  });
});

test('SRC-01 (MockAgent): an SSRF target is refused with its reason, exit 1, and receives no request', async () => {
  const root = paper();
  await liveLane(async () => {
    const r = await runAdd(root, { source: 'http://127.0.0.1:9/x.pdf' });
    assert.equal(r.result['exitCode'], 1);
    assert.match(r.stderr, /pensmith add: http:\/\/127\.0\.0\.1:9\/x\.pdf: refused — .*(?:loopback|private|blocked|not allowed)/i);
  });
});

test('SRC-13 (MockAgent): an HTML landing page is added by the DOI in its own <meta> tags', async () => {
  const root = paper();
  await liveLane(async (agent) => {
    agent.get('https://publisher.example').intercept({ path: '/article/42', method: 'GET' }).reply(
      200,
      '<html><head><meta name="citation_doi" content="10.1038/nphys1170"><meta name="citation_title" content="Measured measurement"></head><body>cited: doi:10.1000/other</body></html>',
      { headers: { 'content-type': 'text/html' } },
    );
    agent.get('https://api.crossref.org').intercept({ path: '/works/10.1038%2Fnphys1170', method: 'GET' }).reply(
      200,
      { status: 'ok', 'message-type': 'work', message: { DOI: '10.1038/nphys1170', title: ['Measured measurement'], author: [{ family: 'Aspelmeyer', given: 'Markus' }], issued: { 'date-parts': [[2009]] } } },
      { headers: { 'content-type': 'application/json' } },
    );
    const r = await runAdd(root, { source: 'https://publisher.example/article/42' });
    assert.equal(r.result['ok'], true, r.stderr);
    assert.match(r.stdout, /declares DOI 10\.1038\/nphys1170/);
    assert.equal(r.result['citekey'], 'aspelmeyer2009');
  });
});

test('SRC-13 (MockAgent): a PDF with no confident match exits 1 with the refusal and CITATIONS.bib byte-identical', async () => {
  const root = paper();
  await runAdd(root, { source: '10.1038/nphys1170' }); // an existing bib to protect
  const before = bibOf(root);
  const libBefore = fs.readFileSync(path.join(root, '.paper', 'LIBRARY.json'), 'utf8');
  await liveLane(async (agent) => {
    const empty = { status: 'ok', 'message-type': 'work-list', message: { items: [], 'total-results': 0 } };
    agent.get('https://api.crossref.org').intercept({ path: /^\/works\?/, method: 'GET' }).reply(200, empty, { headers: { 'content-type': 'application/json' } });
    agent.get('https://api.openalex.org').intercept({ path: /.*/, method: 'GET' }).reply(200, { meta: { count: 0 }, results: [] }, { headers: { 'content-type': 'application/json' } });
    const r = await runAdd(root, { source: path.join(BYO, 'no-match.pdf') });
    assert.equal(r.result['exitCode'], 1);
    assert.ok(r.stderr.includes(`pensmith add: ${UNIDENTIFIED_PDF_MESSAGE}\n`), r.stderr);
    assert.equal(UNIDENTIFIED_PDF_MESSAGE, 'could not confidently identify this PDF — pass its DOI: pensmith add <doi> --pdf <file>');
  });
  assert.equal(bibOf(root), before, 'CITATIONS.bib is byte-identical');
  assert.equal(fs.readFileSync(path.join(root, '.paper', 'LIBRARY.json'), 'utf8'), libBefore);
  assert.equal(fs.existsSync(path.join(root, '.paper', 'sources', 'quillfeathernoyear.pdf')), false);
});
