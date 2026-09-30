// tests/compile-done-gate-parity.test.ts — review round 1 (PRD §14: the
// verifier blocks compile AND export). compile and done refuse on the same
// local records (verification-md.ts verificationRecordReasons: `Status: failed`
// blocks even when no verdict row parses, a missing Status line, a --dry-run
// verification) and — since Phase 20 (VRFY-25, VRFY-26) — both recompute the
// verdicts through the one gate core, so a blocking citation is named whatever
// its key's shape: dotted, colon or Unicode keys, which LIBRARY.json v2 accepts
// (CITEKEY_GRAMMAR). The verdict-row reader still names every key shape, and a
// blocking row whose key cannot be read still blocks (fail closed).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_BLOCKED } from '../bin/lib/exit-codes.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';
import {
  parseBlockingVerdictRows,
  sectionVerificationReasons,
  UNREADABLE_CITEKEY,
} from '../bin/lib/verify/verdict-rows.js';
import { runExportBlockingGate } from '../bin/cli/done.js';
import { sandbox, runCli, seedFabricatedSection, sectionDirOf } from './helpers/paper-cli-harness.js';

test('verdict rows: every CITEKEY_GRAMMAR key shape is named; an unreadable blocking row still blocks', () => {
  const md = [
    'Status: failed',
    '- ghost.2099: **FABRICATED** — titleJW=0.00, authorJW=0.00 — not in bib',
    '- müller2020: **MIS-CITED** — titleJW=0.10, authorJW=0.00 — wrong paper',
    '- doe:2020/x: **FABRICATED** — titleJW=0.00, authorJW=0.00 — not in bib',
    '- smith#1 ("a quoted passage…"): **NOT_FOUND** — lev=0.900 — not in the text',
    '- **FABRICATED** — a row with no key at all',
    '| ghost.2099 | **FABRICATED** | a table row is never a verdict row |',
  ].join('\n');
  assert.deepEqual(parseBlockingVerdictRows(md), [
    { citekey: 'ghost.2099', verdict: 'FABRICATED', reason: 'not in bib' },
    { citekey: 'müller2020', verdict: 'MIS-CITED', reason: 'wrong paper' },
    { citekey: 'doe:2020/x', verdict: 'FABRICATED', reason: 'not in bib' },
    { citekey: 'smith#1', verdict: 'NOT_FOUND', reason: 'not in the text' },
    { citekey: UNREADABLE_CITEKEY, verdict: 'FABRICATED', reason: 'a row with no key at all' },
  ]);
  // `Status: failed` alone blocks, with or without a parseable row.
  assert.deepEqual(sectionVerificationReasons('Status: failed\n\n- ???\n', false), ["VERIFICATION.md Status is 'failed'"]);
  assert.deepEqual(sectionVerificationReasons('Status: verified\n', false), []);
  assert.deepEqual(sectionVerificationReasons('Status: unverifiable\n', false), [], 'Pitfall 3: unverifiable with no blocking row passes');
  assert.match(sectionVerificationReasons('no status here', false)[0] ?? '', /no verifiable VERIFICATION\.md/);
});

test('compile and done both refuse a section whose verifier FAILED on a dotted citekey (`[@ghost.2099]`)', () => {
  const sb = sandbox('gate-parity-dotted');
  const root = sb.project('p');
  seedFabricatedSection(root);
  const draft = join(sectionDirOf(root, 1, 'intro'), 'DRAFT.md');
  writeFileSync(draft, '# intro\n\nA claim that cites a source nobody wrote [@ghost.2099].\n');
  const v = runCli(sb, root, ['verify', '1']);
  assert.equal(v.status, EXIT_BLOCKED, `verify: ${v.stdout}\n${v.stderr}`);
  const verification = readFileSync(join(sectionDirOf(root, 1, 'intro'), 'VERIFICATION.md'), 'utf8');
  assert.match(verification, /^Status: failed$/m);
  assert.match(verification, /^- ghost\.2099: \*\*FABRICATED\*\*/m);

  const c = runCli(sb, root, ['compile', '--yolo']);
  assert.equal(c.status, EXIT_BLOCKED, `compile must refuse: ${c.stdout}\n${c.stderr}`);
  assert.match(c.stdout + c.stderr, /REFUSE: section 1 \(intro\): VERIFICATION\.md Status is 'failed'/);
  // VRFY-25: compile names the recomputed verdict (the gate core), not a row it read.
  assert.match(c.stdout + c.stderr, /REFUSE: section 1 \(intro\): citation \[@ghost\.2099\] is FABRICATED/);
  assert.ok(!existsSync(join(root, '.paper', 'DRAFT.md')), 'no compiled DRAFT.md');

  // done's re-check agrees (it never had a DRAFT.md to export): its record gate refuses the failed section,
  // and the done command exits 4 naming it.
  const gate = runExportBlockingGate(root);
  assert.equal(gate.blocked, true);
  assert.ok(gate.reasons.some((r) => /section 1 \(intro\): VERIFICATION\.md Status is 'failed'/.test(r)), JSON.stringify(gate.reasons));
  const d = runCli(sb, root, ['done', '--yolo', '--format', 'md']);
  assert.equal(d.status, EXIT_BLOCKED, `done: ${d.stdout}\n${d.stderr}`);
  assert.match(d.stdout, /compile refuses these sections:\n  - section 1 \(intro\): VERIFICATION\.md Status is 'failed'/);
});

test('compile refuses a Unicode-keyed FABRICATED row and a `Status: failed` section with no parseable row', () => {
  for (const [name, body] of [
    ['unicode', '# VERIFICATION (Section 1, intro)\n\nStatus: failed\n\n- müller2020: **FABRICATED** — titleJW=0.00, authorJW=0.00 — not in bib\n'],
    ['unparsed', '# VERIFICATION (Section 1, intro)\n\nStatus: failed\n\n(the verifier wrote rows this build cannot read)\n'],
  ] as const) {
    const sb = sandbox(`gate-parity-${name}`);
    const root = sb.project('p');
    seedFabricatedSection(root);
    writeFileSync(join(sectionDirOf(root, 1, 'intro'), 'VERIFICATION.md'), body);
    // The verification is of THIS draft (PLAN.md's hash is current), so compile reads its record — a stale
    // section would be re-verified instead, rewriting the file (D-20-23).
    const plan = join(sectionDirOf(root, 1, 'intro'), 'PLAN.md');
    const hash = computeDraftHash(readFileSync(join(sectionDirOf(root, 1, 'intro'), 'DRAFT.md')), []);
    writeFileSync(plan, readFileSync(plan, 'utf8').replace(/^verified_against_draft_hash: .*$/m, `verified_against_draft_hash: '${hash}'`));
    const c = runCli(sb, root, ['compile', '--yolo']);
    assert.equal(c.status, EXIT_BLOCKED, `${name}: ${c.stdout}\n${c.stderr}`);
    assert.match(c.stdout + c.stderr, /Status is 'failed'/, name);
    assert.ok(!existsSync(join(root, '.paper', 'DRAFT.md')), `${name}: no compiled DRAFT.md`);
    writeFileSync(join(root, '.paper', 'DRAFT.md'), '# hand-placed draft\n');
    const d = runCli(sb, root, ['done', '--yolo', '--format', 'md']);
    assert.equal(d.status, EXIT_BLOCKED, `${name} done: ${d.stdout}\n${d.stderr}`);
    assert.ok(!existsSync(join(root, '.paper', 'export', 'DRAFT.md')), `${name}: nothing exported`);
  }
});
