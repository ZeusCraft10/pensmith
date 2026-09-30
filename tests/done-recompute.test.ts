// tests/done-recompute.test.ts — VRFY-26, VRFY-27, VRFY-22, VRFY-23 (D-20-24,
// D-20-25, D-20-26): done recomputes the gate over the exact text it exports.
//
//   - A citation appended to the compiled .paper/DRAFT.md by hand is stale
//     (VRFY-27) AND done names the recomputed rows over the edited bytes
//     (D-20-25): BLOCKED listing both, nothing exported, nothing under
//     sections/ touched.
//   - UNSUPPORTED claims (Pass 2, advisory) are decided at the
//     `unsupported-claims` gate: without a terminal done refuses (exit 3)
//     before exporting; --yolo exports and records each claim as
//     `Auto-accepted under --yolo <ISO>` in the paper-level
//     .paper/VERIFICATION.md (`## Decisions`), next to the gate summary of the
//     exported text and the whole-paper Pass-4 table (VRFY-23).
//   - done never writes under sections/.
//
// Built CLI, sources offline (the cited works are recorded), model stubbed
// (Pass 2's stub says UNCLEAR; the test turns one row into UNSUPPORTED before
// compiling, as a model's verdict would be).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_APPROVAL, EXIT_BLOCKED, EXIT_OK } from '../bin/lib/exit-codes.js';
import { seedGatePaper, mtimes, RECORDED_BIB, type GatePaper } from './helpers/gate-paper.js';
import { STACK_LINE } from './helpers/paper-cli-harness.js';

const SECTIONS = [
  { n: 1, slug: 'intro', assigned: ['lecun2015'], draft: '# Introduction\n\nDeep networks learn layered representations of their input data [@lecun2015].\n' },
  { n: 2, slug: 'measurement', assigned: ['aspelmeyer2009'], draft: '# Measurement\n\nMeasurement in quantum physics shapes what an observer can record [@aspelmeyer2009].\n' },
];

/** A two-section paper, verified and compiled through the built CLI. */
function compiledPaper(prefix: string, beforeCompile?: (p: GatePaper) => void): GatePaper {
  const p = seedGatePaper(prefix, SECTIONS, RECORDED_BIB);
  for (const s of SECTIONS) {
    const v = p.cli(['verify', String(s.n)]);
    assert.equal(v.status, EXIT_OK, `verify ${s.n}\n${v.stdout}\n${v.stderr}`);
  }
  beforeCompile?.(p);
  const c = p.cli(['compile', '--yolo']);
  assert.equal(c.status, EXIT_OK, `compile\n${c.stdout}\n${c.stderr}`);
  return p;
}

test('VRFY-27 / D-20-25 (built CLI): a citation appended to the compiled DRAFT.md by hand — done is BLOCKED naming the staleness and the recomputed rows; nothing exported; sections/ untouched', () => {
  const p = compiledPaper('done-handedit');
  appendFileSync(join(p.root, '.paper', 'DRAFT.md'), '\nA further result settles the question [@smith2099fake].\n');
  const sectionsBefore = mtimes(join(p.root, '.paper', 'sections'));
  const d = p.cli(['done', '--yolo', '--format', 'md']);
  assert.equal(d.status, EXIT_BLOCKED, `${d.stdout}\n${d.stderr}`);
  assert.match(d.stdout, /pensmith done: BLOCKED/);
  assert.match(d.stdout, /stale: \.paper\/DRAFT\.md changed since compile — make the edit in the section drafts/);
  assert.match(d.stdout, /\.paper\/DRAFT\.md: citation \[@smith2099fake\] is FABRICATED/);
  assert.match(d.stdout, /\.paper\/DRAFT\.md: citation \[@smith2099fake\] is UNASSIGNED — not in the assigned_sources of any section of the paper/);
  assert.doesNotMatch(d.stdout, /citation \[@(lecun2015|aspelmeyer2009)\] is/, 'the recorded works still pass');
  assert.doesNotMatch(d.stderr, STACK_LINE);
  assert.ok(!existsSync(join(p.root, '.paper', 'export')), 'nothing under export/');
  assert.ok(!existsSync(join(p.root, '.paper', 'FINAL.md')));
  assert.deepEqual(mtimes(join(p.root, '.paper', 'sections')), sectionsBefore, 'done never writes under sections/');

  // The router names the hand edit instead of recompiling over it.
  const s = p.cli(['status']);
  assert.match(s.stdout, /\.paper\/DRAFT\.md was edited after compile — make the edit in the section drafts/);
});

test('VRFY-22 / VRFY-23 (built CLI): UNSUPPORTED claims — without a terminal done refuses before exporting; --yolo exports and records the decision, the gate summary and the whole-paper Pass 4 in .paper/VERIFICATION.md', () => {
  const p = compiledPaper('done-unsupported', (paper) => {
    // A model's Pass-2 verdict for §1's claim (the stub says UNCLEAR).
    const verif = join(paper.sectionDir(1, 'intro'), 'VERIFICATION.md');
    const md = readFileSync(verif, 'utf8');
    const at = md.indexOf('## Pass-2');
    assert.ok(at >= 0 && md.indexOf('**UNCLEAR**', at) > at, md);
    writeFileSync(verif, md.slice(0, at) + md.slice(at).replace('**UNCLEAR**', '**UNSUPPORTED**').replace('| Pass-2 | UNCLEAR |', '| Pass-2 | UNSUPPORTED |'));
  });
  const sectionsBefore = mtimes(join(p.root, '.paper', 'sections'));

  const refused = p.cli(['done', '--format', 'md']);
  assert.equal(refused.status, EXIT_APPROVAL, `${refused.stdout}\n${refused.stderr}`);
  assert.match(refused.stdout, /1 claim\(s\) Pass 2 judged UNSUPPORTED by the cited source \(VRFY-22\):\n {2}- §1 \[@lecun2015\] "/);
  assert.match(refused.stderr, /Export the paper with these UNSUPPORTED claims\? \(nothing was exported\) needs an answer: re-run in a terminal, or pass --yolo to export and record them as auto-accepted/);
  assert.ok(!existsSync(join(p.root, '.paper', 'export')), 'refused before exporting');

  const done = p.cli(['done', '--yolo', '--format', 'md']);
  assert.equal(done.status, EXIT_OK, `${done.stdout}\n${done.stderr}`);
  assert.ok(readdirSync(join(p.root, '.paper', 'export')).some((f) => f.startsWith('DRAFT.')), 'exported');
  const report = readFileSync(join(p.root, '.paper', 'VERIFICATION.md'), 'utf8');
  assert.match(report, /^# Paper Verification \(done\)$/m);
  assert.match(report, /^Text checked: \.paper\/(DRAFT|FINAL)\.md \(sha256 [0-9a-f]{64}\)$/m);
  assert.match(report, /^\| Pass-1 \| OK \| 2 \|$/m, 'the gate summary of the exported text');
  assert.match(report, /^\| §1 \(intro\) \| Pass-2 row 1 \[@lecun2015\] \| [^|]+ \| Auto-accepted under --yolo \d{4}-\d{2}-\d{2}T[^|]+ \|$/m);
  assert.match(report, /^## Pass-4/m, 'the whole-paper Pass 4 over the exported text');
  assert.deepEqual(mtimes(join(p.root, '.paper', 'sections')), sectionsBefore, 'done never writes under sections/');
});
