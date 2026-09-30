// tests/add-identifiers-cli.test.ts — `pensmith add` through the BUILT CLI on
// recorded answers (19-PLAN §7.4; SRC-01, SRC-11, SRC-13).
//
// The built CLI runs in a sandboxed paper under the test runner (sources
// offline: every request is answered by a real recording under
// tests/fixtures/cassettes/ or refused), stdin never a terminal.
//
//   SRC-11: `add isbn:9780226458083` → Kuhn's The Structure of Scientific
//           Revolutions as @book with publisher and year (the books adapter,
//           Open Library).
//   SRC-13: every arXiv / DOI / PMID spelling a user pastes normalizes to one
//           identifier and one library entry: arXiv:, bare, abs and pdf URLs,
//           a version suffix, an old-style id with an upper-case archive;
//           `DOI: ` with a space, a %2F doi.org URL, a trailing period;
//           PMID: / pmid:. arXiv works carry eprint / archivePrefix.
//   SRC-01: `add https://arxiv.org/pdf/1706.03762.pdf --yolo` adds vaswani2017;
//           the recorded http→https 301 to a real PDF (w3 dummy.pdf) is
//           followed and the PDF — which names no work — is refused as
//           unidentifiable, nothing added; a `.pdf` URL answering an HTML page
//           is "not a PDF (got text/html)" with no PDF-parser output; a
//           loopback URL is refused with the SSRF reason and the listener gets
//           no request.
//   Review round 2 of the Phase 20 + 23a merge: `add PMID:40121571` — a
//           Hungarian article whose PubMed title is the bracketed English
//           translation — stores the title Crossref (its DOI's registrar)
//           holds, so `verify` passes it instead of blocking it as MIS-CITED.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, writeState, CLI_BIN, STACK_LINE, type Sandbox } from './helpers/paper-cli-harness.js';
import { seedGatePaper } from './helpers/gate-paper.js';
import { startHttpServer } from './helpers/local-servers/transport.js';

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** The built CLI, spawned asynchronously (an in-process listener can answer — or prove it was never asked). */
function add(sb: Sandbox, root: string, args: readonly string[], env: Record<string, string | undefined> = {}): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_BIN, 'add', ...args], { cwd: root, env: sb.env(env), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.stdout.setEncoding('utf8').on('data', (d: string) => void (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => void (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

function freshPaper(sb: Sandbox, name: string): string {
  const root = sb.project(name);
  writeState(root, [], `add-cli-${name}`);
  return root;
}

function bib(root: string): string {
  return readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8');
}

function libraryKeys(root: string): string[] {
  const lib = JSON.parse(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8')) as { entries: Array<{ citekey: string }> };
  return lib.entries.map((e) => e.citekey);
}

test('SRC-11 (built CLI): `add isbn:9780226458083` adds Kuhn\'s The Structure of Scientific Revolutions as @book with publisher and year', async () => {
  const sb = sandbox('add-cli-isbn');
  const root = freshPaper(sb, 'kuhn');
  const r = await add(sb, root, ['isbn:9780226458083', '--yolo']);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /^pensmith add: added kuhn1996\.$/m);
  assert.match(r.stdout, /^pensmith add: kuhn1996 — The Structure of Scientific Revolutions \(1996\)$/m);
  const b = bib(root);
  assert.match(b, /^@book\{kuhn1996,$/m);
  assert.match(b, /^ {2}publisher = \{University of Chicago Press\},$/m);
  assert.match(b, /^ {2}year = \{1996\},$/m);
  assert.match(b, /^ {2}isbn = \{9780226458083\},$/m);
  // RESEARCH.md's sources block lists it (Open Library's display names, as arXiv's and OpenAlex's).
  assert.match(readFileSync(join(root, '.paper', 'RESEARCH.md'), 'utf8'), /^- \[@kuhn1996\] Thomas S\. Kuhn[^\n]*\(1996\)\. The Structure of Scientific Revolutions\. University of Chicago Press\. ISBN 9780226458083$/m);
});

test('SRC-13 / SRC-01 (built CLI): every arXiv spelling adds Vaswani et al. 2017 once, with eprint and archivePrefix', async () => {
  const sb = sandbox('add-cli-arxiv');
  for (const [i, form] of ['arXiv:1706.03762', '1706.03762', 'https://arxiv.org/abs/1706.03762', 'https://arxiv.org/pdf/1706.03762.pdf', 'arxiv:1706.03762v5'].entries()) {
    const root = freshPaper(sb, `arxiv-${i}`);
    const r = await add(sb, root, [form, '--yolo']);
    assert.equal(r.status, 0, `${form}: ${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /^pensmith add: added vaswani2017\.$/m, form);
    assert.match(r.stdout, /^pensmith add: vaswani2017 — Attention Is All You Need \(2017\)$/m, form);
    const b = bib(root);
    assert.match(b, /^ {2}eprint = \{1706\.03762\},$/m, form);
    assert.match(b, /^ {2}archivePrefix = \{arXiv\},$/m, form);
    assert.deepEqual(libraryKeys(root), ['vaswani2017'], form);
  }
  // In one paper, a second spelling is the same work.
  const root = freshPaper(sb, 'arxiv-same');
  assert.equal((await add(sb, root, ['arXiv:1706.03762', '--yolo'])).status, 0);
  const again = await add(sb, root, ['https://arxiv.org/pdf/1706.03762v7.pdf', '--yolo']);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /^pensmith add: already in library as vaswani2017/m);
  assert.deepEqual(libraryKeys(root), ['vaswani2017']);
});

test('SRC-13 (built CLI): an old-style arXiv id normalizes with its version and an upper-case archive', async () => {
  const sb = sandbox('add-cli-oldarxiv');
  const keys = new Set<string>();
  for (const [i, form] of ['hep-th/9901001v2', 'HEP-TH/9901001', 'arXiv:hep-th/9901001'].entries()) {
    const root = freshPaper(sb, `old-${i}`);
    const r = await add(sb, root, [form, '--yolo']);
    assert.equal(r.status, 0, `${form}: ${r.stdout}\n${r.stderr}`);
    assert.match(bib(root), /^ {2}eprint = \{hep-th\/9901001\},$/m, form);
    for (const k of libraryKeys(root)) keys.add(k);
  }
  assert.equal(keys.size, 1, `one work: ${[...keys].join(', ')}`);
});

test('SRC-13 (built CLI): DOI spellings (a `DOI: ` prefix, a %2F doi.org URL, a trailing period, upper case) are one work', async () => {
  const sb = sandbox('add-cli-doi');
  const root = freshPaper(sb, 'lecun');
  const first = await add(sb, root, ['DOI: 10.1038/nature14539', '--yolo']);
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  assert.match(first.stdout, /^pensmith add: added lecun2015\.$/m);
  for (const form of ['https://doi.org/10.1038%2Fnature14539', '10.1038/nature14539.', 'doi:10.1038/NATURE14539']) {
    const r = await add(sb, root, [form, '--yolo']);
    assert.equal(r.status, 0, `${form}: ${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /^pensmith add: already in library as lecun2015/m, form);
  }
  assert.deepEqual(libraryKeys(root), ['lecun2015']);
  const b = bib(root);
  assert.match(b, /^ {2}journal = \{Nature\},$/m);
  assert.match(b, /^ {2}volume = \{521\},$/m);
  assert.match(b, /^ {2}pages = \{436--444\},$/m);
});

test('SRC-13 (built CLI): PMID:31978945 and pmid:31978945 are the same PubMed record', async () => {
  const sb = sandbox('add-cli-pmid');
  const root = freshPaper(sb, 'pmid');
  const a = await add(sb, root, ['PMID:31978945', '--yolo']);
  assert.equal(a.status, 0, `${a.stdout}\n${a.stderr}`);
  assert.match(a.stdout, /^pensmith add: added \S+\.$/m);
  const b = await add(sb, root, ['pmid:31978945', '--yolo']);
  assert.equal(b.status, 0, b.stderr);
  assert.match(b.stdout, /^pensmith add: already in library as /m);
  assert.equal(libraryKeys(root).length, 1);
  assert.match(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8'), /"pmid": "31978945"/);
});

test('review round 2 (built CLI): `add PMID:40121571` stores the title Crossref holds for a translated PubMed title, and `verify` passes it', () => {
  const p = seedGatePaper('add-cli-pmid-translated', [{ n: 1, slug: 'intro', assigned: [], draft: null }], null);
  const added = p.cli(['add', 'PMID:40121571', '--section', '1']);
  assert.equal(added.status, 0, `${added.stdout}\n${added.stderr}`);
  const lib = JSON.parse(readFileSync(join(p.root, '.paper', 'LIBRARY.json'), 'utf8')) as {
    entries: Array<{ citekey: string; title: string; pmid?: string; doi?: string; authors?: string[] }>;
  };
  assert.equal(lib.entries.length, 1);
  const e = lib.entries[0]!;
  // PubMed's esummary title is "[How much do medical students forget?]."; Crossref's is the printed one.
  assert.equal(e.title, 'Mennyit felejtenek az orvostanhallgatók?', 'the title the DOI\'s registrar holds');
  assert.equal(e.authors?.[0], 'Csaba, Gergely József', "Crossref's author names");
  assert.equal(e.pmid, '40121571', 'the PMID stays');
  assert.equal(e.doi, '10.1556/650.2025.33246');
  const b = bib(p.root);
  assert.match(b, /^ {2}title = \{Mennyit felejtenek az orvostanhallgatók\?/m);
  assert.doesNotMatch(b, /How much do medical students forget/);
  assert.match(added.stdout, new RegExp(`^pensmith add: ${e.citekey} mapped to §1 \\(assigned_sources only\\)\\.$`, 'm'));

  // The section cites it; Pass 1 re-fetches the DOI at Crossref and finds the same title.
  writeFileSync(join(p.sectionDir(1, 'intro'), 'DRAFT.md'), `# Intro\n\nMedical students forget much of what they learn [@${e.citekey}].\n`);
  const v = p.cli(['verify', '1', '--yolo']);
  assert.equal(v.status, 0, `${v.stdout}\n${v.stderr}`);
  const verification = readFileSync(join(p.sectionDir(1, 'intro'), 'VERIFICATION.md'), 'utf8');
  assert.match(verification, new RegExp(`^- ${e.citekey}: \\*\\*OK\\*\\*`, 'm'));
  assert.doesNotMatch(verification, /MIS-CITED/);
});

test('SRC-01 (built CLI): the recorded 301 to a real PDF is followed hop by hop; a PDF that names no work is refused and nothing is added', async () => {
  const sb = sandbox('add-cli-redirect');
  const root = freshPaper(sb, 'dummy');
  const r = await add(sb, root, ['http://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', '--yolo']);
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  // The W3C test PDF reached the extractor through both hops; its only text is
  // "Dummy PDF file" (12 characters, under pdf-text.ts's image-only threshold),
  // so there is nothing to identify it by — refused, with the DOI hint.
  assert.match(r.stderr, /^pensmith add: http:\/\/www\.w3\.org\/WAI\/ER\/tests\/xhtml\/testfiles\/resources\/pdf\/dummy\.pdf: no extractable text \(an image-only or scanned PDF\) — pass its DOI: pensmith add <doi> --pdf <file>$/m);
  assert.doesNotMatch(r.stderr, STACK_LINE);
  assert.ok(!existsSync(join(root, '.paper', 'LIBRARY.json')), 'nothing added');
  assert.ok(!existsSync(join(root, '.paper', 'CITATIONS.bib')));
  // Both hops were requests of the one transport (the SESSION.log http records).
  const log = readFileSync(join(root, '.paper', 'SESSION.log'), 'utf8');
  assert.match(log, /"url":"https:\/\/www\.w3\.org\/WAI\/ER\/tests\/xhtml\/testfiles\/resources\/pdf\/dummy\.pdf"/, 'the https hop');
});

test('SRC-01 (built CLI): a .pdf URL answering an HTML page is "not a PDF (got text/html)", with no PDF-parser output, exit 1', async () => {
  const sb = sandbox('add-cli-html');
  const root = freshPaper(sb, 'html');
  const r = await add(sb, root, ['https://duckduckgo.com/paper.pdf', '--yolo']);
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /^pensmith add: https:\/\/duckduckgo\.com\/paper\.pdf: not a PDF \(got text\/html\) — nothing added\.$/m);
  assert.doesNotMatch(r.stderr, /Warning:|Invalid PDF|pdf\.js|InvalidPDFException|FormatError/i, 'the page never reached the PDF parser');
  assert.ok(!existsSync(join(root, '.paper', 'LIBRARY.json')));
});

test('SRC-01 (built CLI): a loopback URL is refused with the SSRF reason, exit 1, and the listener receives no request', async () => {
  let hits = 0;
  const server = await startHttpServer((_req, res) => {
    hits += 1;
    res.writeHead(200, { 'content-type': 'application/pdf' });
    res.end('%PDF-1.4\n');
  });
  try {
    const sb = sandbox('add-cli-ssrf');
    const root = freshPaper(sb, 'ssrf');
    // The live lane (PENSMITH_NETWORK_TESTS=1): offline, the fetch would be refused as
    // offline before the SSRF check; live, the SSRF guard refuses it before any socket.
    const r = await add(sb, root, [`http://127.0.0.1:${server.port}/x.pdf`, '--yolo'], { PENSMITH_NETWORK_TESTS: '1' });
    assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, new RegExp(`^pensmith add: http://127\\.0\\.0\\.1:${server.port}/x\\.pdf: refused — .*(?:loopback|private|SSRF|not allowed)`, 'mi'));
    assert.doesNotMatch(r.stderr, STACK_LINE);
    assert.equal(hits, 0, 'the listener was never asked');
    assert.ok(!existsSync(join(root, '.paper', 'LIBRARY.json')));
  } finally {
    await server.close();
  }
});
