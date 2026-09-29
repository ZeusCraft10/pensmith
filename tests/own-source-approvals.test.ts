// tests/own-source-approvals.test.ts — a paper's config.toml can NAME the
// reader's own sources, only the reader can APPROVE reading them (SRC-15,
// SRC-16; Phase 19 review round 1).
//
// `.paper/` travels (sync folders, shared papers). A config.toml whose
// `[sources] byo_pdf_dir` names a folder outside the project would have made
// `research` copy that folder's PDFs into the shared paper. Now:
//   - a folder inside the project needs no approval;
//   - a folder outside it is read only after this user approved it for this
//     paper — `new --pdfs <dir>` (typed on the command line) or the
//     `byo-folder` gate (never skipped by --yolo); without a terminal the
//     folder is skipped with a WARN, and nothing is copied;
//   - approvals live in the data dir, keyed by the project's real path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sandbox, runCli, ASSIGNMENT_FIXTURE, REPO, STACK_LINE } from './helpers/paper-cli-harness.js';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import {
  isInsideProject,
  isByoFolderApproved,
  isByoFolderExplicitlyApproved,
  approveByoFolder,
  isZoteroCollectionApproved,
  approveZoteroCollection,
} from '../bin/lib/own-source-approvals.js';
import { pensmithOwnSourceApprovalsPath } from '../bin/lib/paths.js';
import { listPdfsInDir } from '../bin/lib/byo-ingest.js';

const BYO = path.join(REPO, 'tests', 'fixtures', 'byo');

test('own-source approvals: inside the project needs none; outside needs this user\'s approval, recorded in the data dir per paper', async () => {
  await withLlmSandbox({ paper: false }, async (sb) => {
    const root = path.join(sb.root, 'paper');
    const other = path.join(sb.root, 'other-paper');
    const inside = path.join(root, 'pdfs');
    const outside = path.join(sb.root, 'private');
    for (const d of [root, other, inside, outside]) fs.mkdirSync(d, { recursive: true });

    assert.equal(isInsideProject(root, inside), true);
    assert.equal(isInsideProject(root, outside), false);
    assert.equal(isInsideProject(root, path.join(root, '..', 'private')), false, 'a ../ path is outside');
    assert.equal(isByoFolderApproved(root, inside), true, 'the paper\'s own folder');
    assert.equal(isByoFolderApproved(root, outside), false, 'not approved yet');

    await approveByoFolder(root, outside);
    assert.equal(isByoFolderApproved(root, outside), true);
    assert.equal(isByoFolderApproved(other, outside), false, 'an approval is for one paper only');

    assert.equal(isZoteroCollectionApproved(root, 'Thesis'), false);
    await approveZoteroCollection(root, 'Thesis');
    assert.equal(isZoteroCollectionApproved(root, 'Thesis'), true);
    assert.equal(isZoteroCollectionApproved(root, 'thesis'), false, 'the exact name');

    const file = pensmithOwnSourceApprovalsPath();
    assert.ok(!path.relative(root, file).split(path.sep).includes('.paper'), 'never inside a paper');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as { $schemaVersion: number };
    assert.equal(stored.$schemaVersion, 1);

    // A corrupt approvals file approves nothing (fail closed).
    fs.writeFileSync(file, '{not json');
    assert.equal(isByoFolderApproved(root, outside), false);
    assert.equal(isZoteroCollectionApproved(root, 'Thesis'), false);
  });
});

test('SRC-15 (built CLI): a config.toml byo_pdf_dir outside the paper is not read by `research --yolo` without a terminal; approved at the gate it is', () => {
  const sb = sandbox('own-source-byo');
  const root = sb.project('paper');
  const privateDir = path.join(sb.base, 'reader-private');
  fs.mkdirSync(privateDir);
  fs.copyFileSync(path.join(BYO, 'doi-footer.pdf'), path.join(privateDir, 'secret-notes.pdf'));
  fs.copyFileSync(ASSIGNMENT_FIXTURE, path.join(root, 'a.txt'));
  const n = runCli(sb, root, ['new', '--from', 'a.txt', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(n.status, 0, `${n.stdout}\n${n.stderr}`);
  // What a shared paper's config could carry.
  fs.appendFileSync(path.join(root, '.paper', 'config.toml'), `\n[sources]\nbyo_pdf_dir = ${JSON.stringify(privateDir)}\n`);

  const r1 = runCli(sb, root, ['research', '--yolo'], { timeoutMs: 120_000 });
  assert.doesNotMatch(r1.stderr, STACK_LINE);
  assert.match(r1.stderr, /WARN — \[sources\] byo_pdf_dir points outside the paper folder and you have not approved it for this paper; no PDFs were read/);
  assert.match(r1.stdout, /bring-your-own +0 {2}skipped \(\[sources\] byo_pdf_dir is outside the paper folder and not approved\)/);
  assert.equal(fs.existsSync(path.join(root, '.paper', 'sources')), false, 'nothing was copied into the paper');
  assert.doesNotMatch(fs.readFileSync(path.join(root, '.paper', 'RESEARCH.md'), 'utf8'), /secret-notes/);

  // The user approves it at the gate (scripted answer; --yolo does not answer it).
  const r2 = runCli(sb, root, ['research', '--yolo'], { timeoutMs: 120_000, input: 'y\n', env: { PENSMITH_PROMPT_MODE: 'numbered' } });
  assert.doesNotMatch(r2.stderr, STACK_LINE);
  assert.match(r2.stderr, /Read the PDFs in it \(outside the paper folder\), copy them into \.paper\/sources\/ and look up their titles\?/);
  assert.match(r2.stdout, /bring-your-own: secret-notes\.pdf added as aspelmeyer2009/);
  assert.ok(fs.existsSync(path.join(root, '.paper', 'sources', 'aspelmeyer2009.pdf')));

  // Approved once for this paper: the next run reads it without asking.
  const r3 = runCli(sb, root, ['research', '--yolo'], { timeoutMs: 120_000 });
  assert.doesNotMatch(r3.stderr, /not approved/);
  assert.match(r3.stdout, /bring-your-own +1 {2}ok \(.*: 0 new, 1 already in library\)/);
});

test('SRC-15 (built CLI): `new --pdfs <folder outside the paper>` is the user\'s approval — research re-reads that folder without asking', () => {
  const sb = sandbox('own-source-new-pdfs');
  const root = sb.project('paper');
  const pdfs = path.join(sb.base, 'my-pdfs');
  fs.mkdirSync(pdfs);
  fs.copyFileSync(path.join(BYO, 'doi-footer.pdf'), path.join(pdfs, 'measured.pdf'));
  fs.copyFileSync(ASSIGNMENT_FIXTURE, path.join(root, 'a.txt'));
  const n = runCli(sb, root, ['new', '--from', 'a.txt', '--pdfs', pdfs, '--yolo'], { timeoutMs: 120_000 });
  assert.equal(n.status, 0, `${n.stdout}\n${n.stderr}`);
  assert.match(n.stdout, /bring-your-own: measured\.pdf added as aspelmeyer2009/);
  const r = runCli(sb, root, ['research', '--yolo'], { timeoutMs: 120_000 });
  assert.doesNotMatch(r.stderr, /not approved/);
  assert.match(r.stdout, /bring-your-own +1 {2}ok \(.*: 0 new, 1 already in library\)/);
});

/**
 * Link `link` to `target` (a file): a symlink, or — where file symlinks need a
 * privilege the process lacks (Windows without Developer Mode) — a junction to
 * the target's folder, placed so the PDF sits one level below the link. Returns
 * the path research would find the PDF at.
 */
function linkOutside(target: string, linkDir: string, name: string): string {
  const link = path.join(linkDir, name);
  try {
    fs.symlinkSync(target, link, 'file');
    return link;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e;
    const junction = path.join(linkDir, 'linked');
    fs.symlinkSync(path.dirname(target), junction, 'junction');
    return path.join(junction, path.basename(target));
  }
}

test('SRC-15 (review round 2, built CLI): a link in the paper\'s own PDF folder to a file outside the paper is not followed without the user\'s approval', () => {
  const sb = sandbox('own-source-byo-symlink');
  const root = sb.project('paper');
  const outside = path.join(sb.base, 'reader-home');
  fs.mkdirSync(outside);
  fs.copyFileSync(path.join(BYO, 'doi-footer.pdf'), path.join(outside, 'private-notes.pdf'));
  fs.copyFileSync(ASSIGNMENT_FIXTURE, path.join(root, 'a.txt'));
  const n = runCli(sb, root, ['new', '--from', 'a.txt', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(n.status, 0, `${n.stdout}\n${n.stderr}`);
  // What a cloned repo or an unpacked archive can carry: the paper's own
  // folder (no approval needed), holding a link to the reader's file.
  const pdfs = path.join(root, 'pdfs');
  fs.mkdirSync(pdfs);
  linkOutside(path.join(outside, 'private-notes.pdf'), pdfs, 'shared.pdf');
  fs.appendFileSync(path.join(root, '.paper', 'config.toml'), '\n[sources]\nbyo_pdf_dir = "pdfs"\n');

  const r = runCli(sb, root, ['research', '--yolo'], { timeoutMs: 120_000 });
  assert.doesNotMatch(r.stderr, STACK_LINE);
  assert.equal(fs.existsSync(path.join(root, '.paper', 'sources')), false, 'the linked file was not copied into the paper');
  assert.doesNotMatch(fs.readFileSync(path.join(root, '.paper', 'RESEARCH.md'), 'utf8'), /aspelmeyer2009|private-notes|Measured measurement/);
  const lib = path.join(root, '.paper', 'LIBRARY.json');
  if (fs.existsSync(lib)) assert.doesNotMatch(fs.readFileSync(lib, 'utf8'), /nphys1170/);
  // A symlinked file is named and skipped; a junction (a linked folder) is never walked.
  if (fs.lstatSync(path.join(pdfs, fs.readdirSync(pdfs)[0]!)).isSymbolicLink() && fs.existsSync(path.join(pdfs, 'shared.pdf'))) {
    assert.match(r.stderr, /bring-your-own: shared\.pdf skipped: it links to a file outside the paper folder/);
  }
});

test('SRC-15 (review round 2): listPdfsInDir confined to the project skips a linked file outside it and reports it; unconfined (the user approved the folder) it follows the link', async () => {
  await withLlmSandbox({ paper: false }, async (sb) => {
    const root = path.join(sb.root, 'paper');
    const pdfs = path.join(root, 'pdfs');
    const outside = path.join(sb.root, 'elsewhere');
    fs.mkdirSync(pdfs, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.copyFileSync(path.join(BYO, 'doi-footer.pdf'), path.join(outside, 'private.pdf'));
    fs.copyFileSync(path.join(BYO, 'no-match.pdf'), path.join(pdfs, 'own.pdf'));
    const linked = linkOutside(path.join(outside, 'private.pdf'), pdfs, 'shared.pdf');
    const skipped: string[] = [];
    const confined = await listPdfsInDir(pdfs, { confineTo: root, onSkip: (f) => skipped.push(path.basename(f)) });
    assert.deepEqual(confined.map((f) => path.basename(f)), ['own.pdf'], 'only the file that is really inside the paper');
    const unconfined = await listPdfsInDir(pdfs);
    if (path.basename(linked) === 'shared.pdf') {
      // A file symlink: named when confined, followed when the user approved the folder.
      assert.deepEqual(skipped, ['shared.pdf']);
      assert.deepEqual(unconfined.map((f) => path.basename(f)).sort(), ['own.pdf', 'shared.pdf']);
    } else {
      // A junction (Windows without symlink privilege): a linked folder is never walked.
      assert.deepEqual(unconfined.map((f) => path.basename(f)), ['own.pdf']);
    }
    assert.equal(isByoFolderApproved(root, pdfs), true, 'the paper\'s own folder is readable…');
    assert.equal(isByoFolderExplicitlyApproved(root, pdfs), false, '…but not approved by the user, so it is confined');
    await approveByoFolder(root, pdfs);
    assert.equal(isByoFolderExplicitlyApproved(root, pdfs), true);
  });
});
