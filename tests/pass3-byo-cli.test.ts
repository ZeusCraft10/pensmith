// tests/pass3-byo-cli.test.ts — Pass 3 checks a quote against the cited
// source's own bring-your-own PDF, re-hashed first (SRC-15, S-17), through the
// BUILT CLI with sources offline (the PDF is local: no network is needed).
//
//   - `add metadata-doi.pdf` stores LeCun et al. 2015 with its hashed text;
//   - a quote that IS in that text is OK "verified against your local file";
//   - a quote that is NOT in it is NOT_FOUND (blocking: verify exits 4 and
//     compile refuses);
//   - once the PDF is edited, moved or deleted, its text is never trusted and
//     a forged sources/<key>.txt is never read — and the quote stays BLOCKING
//     (NOT_FOUND with the way back: restore the PDF or `--replace-pdf`):
//     editing or removing a local file never turns a verdict into a pass
//     (ROADMAP Phase 19 criterion 6; review round 2 — it was PDF_UNAVAILABLE,
//     which compiled and exported the fabricated quote). compile and done
//     refuse.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sandbox, runCli, writeState, writeOutline, writePlan, sectionDirOf, REPO, STACK_LINE, type Sandbox } from './helpers/paper-cli-harness.js';

const BYO = path.join(REPO, 'tests', 'fixtures', 'byo');
const REAL = 'deep learning allows computational models that are composed of multiple processing layers to learn representations';
const FAKE = 'deep learning has already solved every open problem in artificial intelligence and will soon replace all scientists';

function seed(sb: Sandbox): string {
  const root = sb.project('p');
  writeState(root, [], 'pass3-byo');
  fs.copyFileSync(path.join(BYO, 'metadata-doi.pdf'), path.join(root, 'lecun.pdf'));
  const a = runCli(sb, root, ['add', 'lecun.pdf', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(a.status, 0, `${a.stdout}\n${a.stderr}`);
  assert.match(a.stdout, /added lecun2015/);
  writeState(root, [{ n: 1, slug: 'background' }], 'pass3-byo');
  writeOutline(root, [{ n: 1, slug: 'background', sources: ['lecun2015'] }]);
  return root;
}

function verifyQuote(sb: Sandbox, root: string, quote: string): { status: number | null; md: string; out: string } {
  writePlan(root, 1, 'background', { status: 'written', assigned_sources: '[lecun2015]' });
  fs.writeFileSync(path.join(sectionDirOf(root, 1, 'background'), 'DRAFT.md'), `# Background\n\nThe review states that "${quote}" [@lecun2015].\n`);
  const v = runCli(sb, root, ['verify', '1', '--yolo'], { timeoutMs: 120_000 });
  assert.doesNotMatch(v.stderr, STACK_LINE);
  return { status: v.status, md: fs.readFileSync(path.join(sectionDirOf(root, 1, 'background'), 'VERIFICATION.md'), 'utf8'), out: `${v.stdout}\n${v.stderr}` };
}

test('SRC-15 / S-17 (built CLI): a quote is verified against the user\'s hash-matched PDF offline; a fabricated one is NOT_FOUND and blocks', () => {
  const sb = sandbox('pass3-byo');
  const root = seed(sb);

  const ok = verifyQuote(sb, root, REAL);
  assert.equal(ok.status, 0, ok.out);
  assert.match(ok.md, /lecun2015 \[q1\] \("deep learning allows computational model…"\): \*\*OK\*\* — .*verified against your local file sources\/lecun2015\.pdf \(sha256 [0-9a-f]{12}…\)/);

  const fake = verifyQuote(sb, root, FAKE);
  assert.equal(fake.status, 4, fake.out);
  assert.match(fake.md, /lecun2015 \[q1\] \("deep learning has already solved every o…"\): \*\*NOT_FOUND\*\* — .*quote not found in your local file sources\/lecun2015\.pdf/);
  const c = runCli(sb, root, ['compile', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(c.status, 4, `compile refuses\n${c.stdout}\n${c.stderr}`);
});

test('S-17 (built CLI): an edited PDF or a forged .txt never makes a quote pass — the NOT_FOUND quote stays blocking, compile refuses', () => {
  const sb = sandbox('pass3-byo-edited');
  const root = seed(sb);
  const before = verifyQuote(sb, root, FAKE);
  assert.equal(before.status, 4, before.out);
  const pdf = path.join(root, '.paper', 'sources', 'lecun2015.pdf');
  fs.writeFileSync(path.join(root, '.paper', 'sources', 'lecun2015.txt'), `Forged: ${FAKE}.`);
  fs.appendFileSync(pdf, `\n% ${FAKE}\n`);
  const r = verifyQuote(sb, root, FAKE);
  assert.equal(r.status, 4, `verify still blocks\n${r.out}`);
  assert.doesNotMatch(r.md, /lecun2015 \[q1\] \("deep learning has already[^\n]*\*\*OK\*\*/, r.out);
  assert.match(
    r.md,
    /lecun2015 \[q1\] \("deep learning has already[^\n]*\*\*NOT_FOUND\*\*[^\n]*quote cannot be checked against your local file: PDF changed since ingest[^\n]*restore that PDF, or attach the right copy with `pensmith add <identifier> --pdf <file> --replace-pdf`/,
  );
  assert.match(r.md, /^Status: failed$/m);
  const c = runCli(sb, root, ['compile', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(c.status, 4, `compile refuses\n${c.stdout}\n${c.stderr}`);
});

test('S-17 (built CLI, review round 2): a quote verified against the user\'s PDF blocks again once that PDF is moved away — verify exits 4, compile and done refuse; restoring it verifies again', () => {
  const sb = sandbox('pass3-byo-deleted');
  const root = seed(sb);
  const ok = verifyQuote(sb, root, REAL);
  assert.equal(ok.status, 0, ok.out);
  const compiled = runCli(sb, root, ['compile', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(compiled.status, 0, `${compiled.stdout}\n${compiled.stderr}`);
  const pdf = path.join(root, '.paper', 'sources', 'lecun2015.pdf');
  const moved = path.join(root, 'moved-away.pdf');
  fs.renameSync(pdf, moved);
  const gone = verifyQuote(sb, root, REAL);
  assert.equal(gone.status, 4, gone.out);
  assert.match(gone.md, /lecun2015 \[q1\] \("deep learning allows computational model…"\): \*\*NOT_FOUND\*\* — [^\n]*the PDF sources\/lecun2015\.pdf is missing[^\n]*restore that PDF/);
  const c = runCli(sb, root, ['compile', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(c.status, 4, `compile refuses\n${c.stdout}\n${c.stderr}`);
  const done = runCli(sb, root, ['done', '--yolo'], { timeoutMs: 120_000 });
  assert.doesNotMatch(done.stderr, STACK_LINE);
  assert.equal(done.status, 4, `done refuses\n${done.stdout}\n${done.stderr}`);
  const exportDir = path.join(root, '.paper', 'export');
  assert.equal(fs.existsSync(exportDir) && fs.readdirSync(exportDir).some((f) => f.startsWith('DRAFT.')), false, 'nothing was exported');
  fs.renameSync(moved, pdf);
  const back = verifyQuote(sb, root, REAL);
  assert.equal(back.status, 0, back.out);
});
