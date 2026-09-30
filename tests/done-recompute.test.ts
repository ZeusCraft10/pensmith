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
//   - answered at the gate (the numbered prompt channel a terminal uses): each
//     claim is listed with its evidence first; yes exports and records
//     `Confirmed by user <ISO>`, no exports nothing (exit 3).
//   - a section compile re-verified after an edit (advisory passes off) has
//     no claim-support judgment: done names it with `pensmith verify N`,
//     never an invented `<unparseable>` claim or decision.
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
import { STACK_LINE, runCli } from './helpers/paper-cli-harness.js';

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

test('VRFY-22 (built CLI): answering the unsupported-claims gate — each claim is listed with its evidence first; yes exports and records `Confirmed by user <ISO>`; no exports nothing (exit 3)', () => {
  const unsupported = (paper: GatePaper): void => {
    const verif = join(paper.sectionDir(1, 'intro'), 'VERIFICATION.md');
    const md = readFileSync(verif, 'utf8');
    const at = md.indexOf('## Pass-2');
    // A model's verdict with the evidence it quoted from the abstract (VRFY-22).
    const row = /^\| lecun2015 \| ([^|]+) \| \*\*UNCLEAR\*\* \| [^|]* \| [^|]* \|$/m.exec(md.slice(at));
    assert.ok(row, md.slice(at));
    writeFileSync(
      verif,
      md.slice(0, at) +
        md.slice(at).replace(row[0], `| lecun2015 | ${row[1]} | **UNSUPPORTED** | The abstract describes the method, not this finding. | deep learning allows computational models |`).replace('| Pass-2 | UNCLEAR |', '| Pass-2 | UNSUPPORTED |'),
    );
  };
  // An answer read from stdin, as a terminal user would type it (the numbered prompt channel).
  const answer = (p: GatePaper, input: string): ReturnType<typeof runCliWithInput> => runCliWithInput(p, ['done', '--format', 'md'], input);

  const declined = compiledPaper('done-unsupported-no', unsupported);
  const no = answer(declined, 'n\n');
  assert.equal(no.status, EXIT_APPROVAL, `${no.stdout}\n${no.stderr}`);
  assert.match(no.stdout, /1 claim\(s\) Pass 2 judged UNSUPPORTED by the cited source \(VRFY-22\):\n {2}- §1 \[@lecun2015\] "[^"]+" — The abstract describes the method, not this finding\.\n {6}evidence: "deep learning allows computational models"/);
  assert.ok(!existsSync(join(declined.root, '.paper', 'export')), 'a "no" exports nothing');

  const p = compiledPaper('done-unsupported-yes', unsupported);
  const sectionsBefore = mtimes(join(p.root, '.paper', 'sections'));
  const yes = answer(p, 'y\n');
  assert.equal(yes.status, EXIT_OK, `${yes.stdout}\n${yes.stderr}`);
  assert.match(yes.stderr, /Export the paper with these UNSUPPORTED claims\?/);
  assert.ok(readdirSync(join(p.root, '.paper', 'export')).some((f) => f.startsWith('DRAFT.')), 'exported');
  assert.match(
    readFileSync(join(p.root, '.paper', 'VERIFICATION.md'), 'utf8'),
    /^\| §1 \(intro\) \| Pass-2 row 1 \[@lecun2015\] \| [^|]+ \| Confirmed by user \d{4}-\d{2}-\d{2}T[^|]+ \|$/m,
  );
  assert.deepEqual(mtimes(join(p.root, '.paper', 'sections')), sectionsBefore, 'done never writes under sections/');
});

test('VRFY-22 / D-08 (built CLI): a section compile re-verified after an edit has no claim-support judgment — done names it and the remedy, invents no UNSUPPORTED claim and records no decision', () => {
  const p = compiledPaper('done-stale-reverify');
  // A hand edit of §1 after its verification: compile re-verifies it with the advisory passes off.
  writeFileSync(join(p.sectionDir(1, 'intro'), 'DRAFT.md'), '# Introduction\n\nLayered representations of input data are what deep networks learn [@lecun2015].\n');
  const c = p.cli(['compile', '--yolo']);
  assert.equal(c.status, EXIT_OK, `${c.stdout}\n${c.stderr}`);
  assert.match(c.stderr, /section 1 \(intro\) stale — re-verifying/);

  // No terminal, no --yolo: the plain export confirmation needs an answer — not the unsupported-claims gate.
  const refused = p.cli(['done', '--format', 'md']);
  assert.equal(refused.status, EXIT_APPROVAL, `${refused.stdout}\n${refused.stderr}`);
  assert.doesNotMatch(refused.stdout, /UNSUPPORTED|<unparseable>/);
  assert.doesNotMatch(refused.stderr, /UNSUPPORTED claims/);
  assert.match(refused.stdout, /§1 \(intro\): claim support \(Pass 2, advisory\) was not run on the current draft — compile re-verified it after an edit; run `pensmith verify 1` to judge it/);

  const done = p.cli(['done', '--yolo', '--format', 'md']);
  assert.equal(done.status, EXIT_OK, `${done.stdout}\n${done.stderr}`);
  assert.doesNotMatch(done.stdout, /<unparseable>/);
  const report = readFileSync(join(p.root, '.paper', 'VERIFICATION.md'), 'utf8');
  assert.match(report, /^_\(no UNSUPPORTED claims to decide\)_$/m, 'no decision is recorded');
  assert.doesNotMatch(report, /<unparseable>|Auto-accepted/);
  assert.match(report, /^- §1 \(intro\): claim support \(Pass 2, advisory\) was not run on the current draft/m);
});

function runCliWithInput(p: GatePaper, args: readonly string[], input: string): { status: number | null; stdout: string; stderr: string } {
  const r = runCli(p.sb, p.root, args, { env: { PENSMITH_PROMPT_MODE: 'numbered' }, input, timeoutMs: 120_000 });
  assert.doesNotMatch(r.stderr, STACK_LINE, r.stderr);
  return r;
}
