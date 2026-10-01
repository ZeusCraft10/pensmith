// tests/compile-recompute.test.ts — VRFY-25, VRFY-27 (D-20-23): compile
// recomputes every section with the gate core over the exact bytes it
// concatenates, and its only section writes are a stale section's re-verify.
//
//   - A section whose draft changed since its verification is re-verified
//     with the advisory passes off: it rewrites THAT section's VERIFICATION.md
//     (Pass 2 / Pass 4 marked `not run — compile staleness re-verify`) and
//     PLAN.md hash, never a DRAFT.md, never another section's files, never
//     CITATIONS.bib; COMPILE-REPORT.md records it; COMPILE-INPUTS.json v2
//     records the compiled draft's sha256 and each section's verified hash.
//   - An unreadable bibliography is a REFUSED reason naming why, never a stack.
//   - The recomputation over the concatenated bytes names each blocking row
//     per section, alongside the record refusals of other sections.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_BLOCKED, EXIT_OK } from '../bin/lib/exit-codes.js';
import { headingsSha256, readCompileInputs } from '../bin/lib/compile-inputs.js';
import { summaryMismatches } from '../bin/lib/verify/verification-md.js';
import { seedGatePaper, sectionDraftHash, mtimes, fileSha, RECORDED_BIB } from './helpers/gate-paper.js';
import { STACK_LINE } from './helpers/paper-cli-harness.js';

const SECTIONS = [
  { n: 1, slug: 'intro', assigned: ['lecun2015'], draft: '# Introduction\n\nDeep networks learn layered representations of their input data [@lecun2015].\n' },
  { n: 2, slug: 'measurement', assigned: ['aspelmeyer2009'], draft: '# Measurement\n\nMeasurement in quantum physics shapes what an observer can record [@aspelmeyer2009].\n' },
];

const planHash = (plan: string): string | null => /^verified_against_draft_hash:\s*'?([0-9a-f]{64})'?\s*$/m.exec(plan)?.[1] ?? null;

test('VRFY-25 / D-08 (built CLI): a stale section is re-verified with the advisory passes off — only its VERIFICATION.md and PLAN.md change; COMPILE-INPUTS v3 records the compiled draft, its headings and every verified hash', () => {
  const p = seedGatePaper('recompute-stale', SECTIONS, RECORDED_BIB);
  for (const s of SECTIONS) assert.equal(p.cli(['verify', String(s.n)]).status, EXIT_OK);
  const s2 = p.sectionDir(2, 'measurement');
  const newDraft = '# Measurement\n\nWhat an observer can record depends on how the measurement is made [@aspelmeyer2009].\n';
  writeFileSync(join(s2, 'DRAFT.md'), newDraft);
  const s1Before = mtimes(p.sectionDir(1, 'intro'));
  const bibBefore = fileSha(join(p.root, '.paper', 'CITATIONS.bib'));

  const c = p.cli(['compile', '--yolo']);
  assert.equal(c.status, EXIT_OK, `${c.stdout}\n${c.stderr}`);
  assert.match(c.stderr, /WARN: section 2 \(measurement\) stale — re-verifying \(Pass 1\+3\)/);
  assert.doesNotMatch(c.stderr, /section 1 \(intro\) stale/);

  // Only §2's record was rewritten; no DRAFT.md, no other section, no bibliography.
  assert.deepEqual(mtimes(p.sectionDir(1, 'intro')), s1Before, '§1 untouched');
  assert.equal(readFileSync(join(s2, 'DRAFT.md'), 'utf8'), newDraft, 'compile never writes a section DRAFT.md');
  assert.equal(fileSha(join(p.root, '.paper', 'CITATIONS.bib')), bibBefore, 'compile never writes CITATIONS.bib');
  assert.ok(!existsSync(join(p.root, '.paper', 'LIBRARY.json')), 'compile writes no LIBRARY.json');
  const verif = readFileSync(join(s2, 'VERIFICATION.md'), 'utf8');
  assert.match(verif, /^Status: verified$/m);
  assert.match(verif, /^## Pass-2 \(claim support, advisory\)\n\n_\(not run — compile staleness re-verify; run `pensmith verify 2`\)_$/m);
  assert.match(verif, /^## Pass-4 \(orphan claims, advisory\)\n\n_\(not run — compile staleness re-verify; run `pensmith verify 2`\)_$/m);
  const fresh = sectionDraftHash(p.root, 2, 'measurement', ['aspelmeyer2009']);
  assert.equal(planHash(readFileSync(join(s2, 'PLAN.md'), 'utf8')), fresh, 'PLAN.md records the re-verified draft');
  assert.match(verif, new RegExp(`^Draft: sha256 ${fresh}$`, 'm'));

  const report = readFileSync(join(p.root, '.paper', 'COMPILE-REPORT.md'), 'utf8');
  assert.match(report, /stale_resolved_count: 1/);
  assert.match(report, /2 \(measurement\)/);

  const record = readCompileInputs(p.root);
  assert.equal(record?.$schemaVersion, 3);
  // EXP-05 (D-21-13): the compiled DRAFT.md carries the title and the section headings, recorded in v3.
  const compiled = readFileSync(join(p.root, '.paper', 'DRAFT.md'), 'utf8');
  assert.ok(compiled.startsWith('# Outline\n\n## intro\n\n'), compiled.slice(0, 80));
  assert.match(compiled, /\n## measurement\n\n/);
  assert.equal(record?.headings_sha256, headingsSha256({ title: 'Outline', sections: [{ id: '1', title: 'intro' }, { id: '2', title: 'measurement' }] }));
  assert.equal(record?.compiled_draft_sha256, createHash('sha256').update(readFileSync(join(p.root, '.paper', 'DRAFT.md'))).digest('hex'));
  assert.deepEqual(
    record?.sections.map((s) => [s.id, s.verified_against_draft_hash]),
    [['1', planHash(readFileSync(join(p.sectionDir(1, 'intro'), 'PLAN.md'), 'utf8'))], ['2', fresh]],
  );
});

test('S-13 / VRFY-26 (built CLI): a section whose record says unverifiable (an earlier offline run) is re-verified by compile — once the gate passes, its VERIFICATION.md and PLAN.md say verified, and status is clean after done', () => {
  const p = seedGatePaper('recompute-unverifiable', SECTIONS, RECORDED_BIB);
  for (const s of SECTIONS) assert.equal(p.cli(['verify', String(s.n)]).status, EXIT_OK);
  // The record an offline verify left: Status unverifiable, PLAN.md unverifiable.
  const s1 = p.sectionDir(1, 'intro');
  const verif = join(s1, 'VERIFICATION.md');
  writeFileSync(verif, readFileSync(verif, 'utf8').replace(/^Status: verified$/m, 'Status: unverifiable'));
  writeFileSync(join(s1, 'PLAN.md'), readFileSync(join(s1, 'PLAN.md'), 'utf8').replace(/^status: verified$/m, 'status: unverifiable'));
  const s2Before = mtimes(p.sectionDir(2, 'measurement'));

  const c = p.cli(['compile', '--yolo']);
  assert.equal(c.status, EXIT_OK, `${c.stdout}\n${c.stderr}`);
  assert.match(c.stderr, /WARN: section 1 \(intro\) is unverifiable — re-verifying \(Pass 1\+3; its claim-support and orphan results for this unchanged draft are kept\)/);
  assert.match(readFileSync(verif, 'utf8'), /^Status: verified$/m);
  assert.match(readFileSync(join(s1, 'PLAN.md'), 'utf8'), /^status: verified$/m);
  assert.deepEqual(mtimes(p.sectionDir(2, 'measurement')), s2Before, '§2 untouched');

  const d = p.cli(['done', '--yolo', '--format', 'md']);
  assert.equal(d.status, EXIT_OK, `${d.stdout}\n${d.stderr}`);
  const st = p.cli(['status']);
  assert.doesNotMatch(st.stdout, /unverifiable/, st.stdout);
});

test('VRFY-22 (built CLI, review round 2): compile\'s re-verify of an unverifiable, UNCHANGED section keeps its Pass-2 judgments — done still asks about the UNSUPPORTED claim and records the decision', () => {
  const p = seedGatePaper('recompute-keep-pass2', SECTIONS, RECORDED_BIB);
  for (const s of SECTIONS) assert.equal(p.cli(['verify', String(s.n)]).status, EXIT_OK);
  const s1 = p.sectionDir(1, 'intro');
  const verif = join(s1, 'VERIFICATION.md');
  // The judge's verdict on THIS draft, and a record an offline run left `unverifiable`.
  const judged = readFileSync(verif, 'utf8')
    .replace(/^Status: verified$/m, 'Status: unverifiable')
    .replace(/\| \*\*UNCLEAR\*\* \| [^|\n]* \|/, '| **UNSUPPORTED** | The source says nothing about this. |');
  assert.match(judged, /\*\*UNSUPPORTED\*\*/, 'a Pass-2 row to plant the judgment in');
  writeFileSync(verif, judged);
  writeFileSync(join(s1, 'PLAN.md'), readFileSync(join(s1, 'PLAN.md'), 'utf8').replace(/^status: verified$/m, 'status: unverifiable'));

  const c = p.cli(['compile', '--yolo']);
  assert.equal(c.status, EXIT_OK, `${c.stdout}\n${c.stderr}`);
  assert.match(c.stderr, /WARN: section 1 \(intro\) is unverifiable — re-verifying \(Pass 1\+3; its claim-support and orphan results for this unchanged draft are kept\)/);
  const after = readFileSync(verif, 'utf8');
  assert.match(after, /^Status: verified$/m);
  assert.match(after, /\*\*UNSUPPORTED\*\*/, 'the Pass-2 judgment of the unchanged draft is kept');
  assert.doesNotMatch(after, /not run — compile staleness re-verify/, 'no "not run" marker for an unchanged draft');
  assert.match(after, /^\| Pass-2 \| UNSUPPORTED \| 1 \|$/m, 'the Summary counts the kept Pass-2 rows');
  assert.deepEqual(summaryMismatches(after), [], 'the Summary equals the rows');

  const d = p.cli(['done', '--yolo', '--format', 'md']);
  assert.equal(d.status, EXIT_OK, `${d.stdout}\n${d.stderr}`);
  assert.match(d.stdout, /claim\(s\) Pass 2 judged UNSUPPORTED/);
  assert.doesNotMatch(d.stdout, /was not run on the current draft/);
  assert.match(readFileSync(join(p.root, '.paper', 'VERIFICATION.md'), 'utf8'), /Auto-accepted under --yolo \d{4}-/);
});

test('VRFY-22 (built CLI): a section edited after verify is re-verified by compile with Pass 2 marked not run — the old judgment was of another draft', () => {
  const p = seedGatePaper('recompute-edited-pass2', SECTIONS, RECORDED_BIB);
  for (const s of SECTIONS) assert.equal(p.cli(['verify', String(s.n)]).status, EXIT_OK);
  const s1 = p.sectionDir(1, 'intro');
  writeFileSync(join(s1, 'DRAFT.md'), `${readFileSync(join(s1, 'DRAFT.md'), 'utf8')}\nOne more sentence of prose.\n`);
  const c = p.cli(['compile', '--yolo']);
  assert.equal(c.status, EXIT_OK, `${c.stdout}\n${c.stderr}`);
  assert.match(readFileSync(join(s1, 'VERIFICATION.md'), 'utf8'), /not run — compile staleness re-verify/);
  const d = p.cli(['done', '--yolo', '--format', 'md']);
  assert.equal(d.status, EXIT_OK, `${d.stdout}\n${d.stderr}`);
  assert.match(d.stdout, /claim support \(Pass 2, advisory\) was not run on the current draft — compile re-verified it after the draft was edited; run `pensmith verify 1`/);
});

test('VRFY-25 (built CLI): an unreadable CITATIONS.bib is a REFUSED reason naming why — never a stack, never a DRAFT.md', () => {
  const p = seedGatePaper('recompute-unreadable', SECTIONS, RECORDED_BIB);
  for (const s of SECTIONS) assert.equal(p.cli(['verify', String(s.n)]).status, EXIT_OK);
  const bib = join(p.root, '.paper', 'CITATIONS.bib');
  rmSync(bib);
  mkdirSync(bib); // a directory where the file should be: exists, cannot be read (any OS, any user)
  const c = p.cli(['compile', '--yolo']);
  assert.equal(c.status, EXIT_BLOCKED, `${c.stdout}\n${c.stderr}`);
  assert.match(c.stdout, /section 1 \(intro\): citation \[@lecun2015\] is FABRICATED — \.paper\/CITATIONS\.bib could not be read \(EISDIR\)/);
  assert.match(c.stdout, /section 2 \(measurement\): citation \[@aspelmeyer2009\] is FABRICATED — \.paper\/CITATIONS\.bib could not be read/);
  assert.doesNotMatch(`${c.stdout}\n${c.stderr}`, STACK_LINE);
  assert.ok(!existsSync(join(p.root, '.paper', 'DRAFT.md')));
});

test('VRFY-25 (built CLI): every section is recomputed — one section\'s record refusal and another\'s recomputed row are listed together', () => {
  const p = seedGatePaper('recompute-all', SECTIONS, RECORDED_BIB);
  assert.equal(p.cli(['verify', '1']).status, EXIT_OK);
  // §2 never verified, and its draft cites a key in no bibliography.
  writeFileSync(join(p.sectionDir(2, 'measurement'), 'DRAFT.md'), '# Measurement\n\nAs shown before [@ghost2099] and [@aspelmeyer2009].\n');
  const c = p.cli(['compile', '--yolo']);
  assert.equal(c.status, EXIT_BLOCKED, `${c.stdout}\n${c.stderr}`);
  assert.match(c.stdout, /section 2 \(measurement\): no verifiable VERIFICATION\.md \(missing VERIFICATION\.md: the section was never verified\) — run `pensmith verify 2`/);
  assert.match(c.stdout, /section 2 \(measurement\): citation \[@ghost2099\] is FABRICATED/);
  assert.match(c.stdout, /section 2 \(measurement\): citation \[@ghost2099\] is UNASSIGNED/);
  assert.doesNotMatch(c.stdout, /section 1 \(intro\):/, '§1 is clean');
  assert.ok(!existsSync(join(p.root, '.paper', 'DRAFT.md')));
});
