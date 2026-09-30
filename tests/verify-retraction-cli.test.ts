// tests/verify-retraction-cli.test.ts — SRC-04 through the real CLI (Phase 19
// stream adapters): a section citing the retracted Wakefield et al. 1998 paper
// (10.1016/S0140-6736(97)11096-0) is BLOCKED.
//
// The built CLI runs in a sandboxed paper under the test runner, so sources are
// offline and every request is answered by the REAL recordings: the Crossref
// record of the work (whose `updated-by` carries the Retraction Watch notice)
// and the retraction re-query. `verify 1` records a blocking RETRACTED verdict
// that names the retraction (Phase 20, VRFY-15) and echoes it on stderr as a
// hard warning, the section's status is `failed`, and `compile --yolo` and
// `done --yolo` refuse with EXIT_BLOCKED (4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  sandbox,
  runCli,
  writeState,
  writeOutline,
  writePlan,
  sectionDirOf,
  STACK_LINE,
} from './helpers/paper-cli-harness.js';

const WAKEFIELD_DOI = '10.1016/S0140-6736(97)11096-0';

function seedWakefieldPaper(root: string): string {
  writeState(root, [{ n: 1, slug: 'background' }], 'retraction-cli');
  writeOutline(root, [{ n: 1, slug: 'background', sources: ['wakefield1998'] }]);
  writeFileSync(
    join(root, '.paper', 'CITATIONS.bib'),
    [
      '@article{wakefield1998,',
      '  author = {Wakefield, AJ and Murch, SH and Anthony, A},',
      '  title = {Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children},',
      '  journal = {The Lancet},',
      '  volume = {351},',
      '  number = {9103},',
      '  pages = {637--641},',
      `  doi = {${WAKEFIELD_DOI}},`,
      '  year = {1998},',
      '}',
      '',
    ].join('\n'),
  );
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 1, entries: [] }));
  writeFileSync(join(root, '.paper', 'RESEARCH.md'), '# Research\n');
  writePlan(root, 1, 'background', { status: 'written', assigned_sources: '[wakefield1998]' });
  const dir = sectionDirOf(root, 1, 'background');
  writeFileSync(
    join(dir, 'DRAFT.md'),
    '# Background\n\nAn early case series proposed a link between vaccination and developmental disorders [@wakefield1998].\n',
  );
  return dir;
}

test('SRC-04 / VRFY-15: `verify 1` citing the retracted Wakefield paper records a blocking RETRACTED verdict naming the retraction, warns on stderr; compile and done exit 4', () => {
  const sb = sandbox('retraction-cli');
  const root = sb.project('paper');
  const dir = seedWakefieldPaper(root);

  const v = runCli(sb, root, ['verify', '1', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(v.status, 4, `verify exits EXIT_BLOCKED (4)\nstdout=${v.stdout}\nstderr=${v.stderr}`);
  assert.doesNotMatch(v.stderr, STACK_LINE, 'no stack trace');

  const md = readFileSync(join(dir, 'VERIFICATION.md'), 'utf8');
  assert.match(md, /^Status: failed$/m);
  // The blocking Pass 1 verdict names the retraction notice (Crossref record + Retraction Watch).
  assert.match(
    md,
    /- wakefield1998: \*\*RETRACTED\*\* .*retracted.*2010-02-06: Retraction \(notice 10\.1016\/s0140-6736\(10\)60175-4; Retraction Watch record 4036\)/,
  );
  // VRFY-15: a hard warning on stderr, naming the key and the notice.
  assert.match(v.stderr, /^pensmith verify: RETRACTED — wakefield1998: .*2010-02-06: Retraction \(notice 10\.1016\/s0140-6736\(10\)60175-4; Retraction Watch record 4036\)/m);
  assert.ok(!/- wakefield1998: \*\*OK\*\*/.test(md), 'never OK');
  assert.match(readFileSync(join(dir, 'PLAN.md'), 'utf8'), /^status: failed$/m);

  const c = runCli(sb, root, ['compile', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(c.status, 4, `compile refuses with EXIT_BLOCKED (4)\nstdout=${c.stdout}\nstderr=${c.stderr}`);
  assert.match(c.stdout + c.stderr, /wakefield1998/);
  assert.ok(!existsSync(join(root, '.paper', 'DRAFT.md')), 'compile writes no DRAFT.md');

  const d = runCli(sb, root, ['done', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(d.status, 4, `done refuses with EXIT_BLOCKED (4)\nstdout=${d.stdout}\nstderr=${d.stderr}`);
  const exportDir = join(root, '.paper', 'export');
  const exported = existsSync(exportDir) ? readdirSync(exportDir).filter((f) => /\.(docx|pdf|md|tex|html)$/i.test(f)) : [];
  assert.deepEqual(exported, [], 'nothing is exported');
});

test('SRC-04 (review round 2): `add` of a retracted DOI says so; verify names the retraction with the real scores; compile names it too', () => {
  const sb = sandbox('retraction-add-cli');
  const root = sb.project('paper');
  writeState(root, [], 'retraction-add');
  const a = runCli(sb, root, ['add', WAKEFIELD_DOI, '--yolo'], { timeoutMs: 120_000 });
  assert.equal(a.status, 0, `${a.stdout}\n${a.stderr}`);
  assert.match(a.stdout, /added wakefield1998/);
  assert.match(a.stderr, /WARN — wakefield1998 is RETRACTED \(2010-02-06: Retraction \(notice 10\.1016\/s0140-6736\(10\)60175-4; Retraction Watch record 4036\)\): it fails Pass 1 \(blocking\) if cited\./);

  writeState(root, [{ n: 1, slug: 'background' }], 'retraction-add');
  writeOutline(root, [{ n: 1, slug: 'background', sources: ['wakefield1998'] }]);
  writePlan(root, 1, 'background', { status: 'written', assigned_sources: '[wakefield1998]' });
  const dir = sectionDirOf(root, 1, 'background');
  writeFileSync(join(dir, 'DRAFT.md'), '# Background\n\nAn early case series proposed a link [@wakefield1998].\n');
  const v = runCli(sb, root, ['verify', '1', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(v.status, 4, `${v.stdout}\n${v.stderr}`);
  const row = readFileSync(join(dir, 'VERIFICATION.md'), 'utf8').split('\n').find((l) => l.startsWith('- wakefield1998:')) ?? '';
  assert.match(row, /\*\*RETRACTED\*\* — titleJW=1\.00, authorJW=1\.00 — cited work is retracted/, "the stored record is Crossref's own: the metadata matches exactly");
  assert.doesNotMatch(row, /titleJW=0\.00, authorJW=0\.00/, 'real scores, never a false 0.00');
  assert.doesNotMatch(row, /Retraction Watch cross-check at research time/, 'the flag says where it came from');
  const c = runCli(sb, root, ['compile', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(c.status, 4);
  // D-20-23: compile recomputes the row (it never reads VERIFICATION.md's verdicts).
  assert.match(c.stdout + c.stderr, /citation \[@wakefield1998\] .*\bRETRACTED\b.*retracted/, 'compile names the key and the RETRACTED verdict');
});
