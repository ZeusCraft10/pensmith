// tests/verify-unassigned.test.ts — VRFY-17 (D-20-21): verify blocks a
// citation outside the section's PLAN.md assigned_sources (UNASSIGNED, its own
// row next to the key's registrar row, with the remedy), and compile's
// recomputation catches a hand edit that adds one after a clean verify.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_BLOCKED, EXIT_OK } from '../bin/lib/exit-codes.js';
import { seedGatePaper } from './helpers/gate-paper.js';
import { STACK_LINE } from './helpers/paper-cli-harness.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';

test('VRFY-17 (built CLI): [@lecun2015] in §1 — in CITATIONS.bib, not in §1\'s assigned_sources — is UNASSIGNED; Status failed, exit 4, compile refuses', () => {
  const p = seedGatePaper('unassigned', [{ n: 1, slug: 'intro', assigned: ['aspelmeyer2009'], draft: '# Intro\n\nMeasurement matters [@aspelmeyer2009]. Deep learning too [@lecun2015].\n' }]);
  const v = p.cli(['verify', '1']);
  assert.equal(v.status, EXIT_BLOCKED, `${v.stdout}\n${v.stderr}`);
  const md = readFileSync(join(p.sectionDir(1, 'intro'), 'VERIFICATION.md'), 'utf8');
  assert.match(md, /^Status: failed$/m);
  // Its own row, right after the key's registrar row, with the remedy.
  assert.match(
    md,
    /^- lecun2015: \*\*OK\*\* — .*\n- lecun2015: \*\*UNASSIGNED\*\* — titleJW=n\/a, authorJW=n\/a — not in section 1's assigned_sources — .*`pensmith plan 1 --revise`.*`pensmith add --remap lecun2015 --section 1`$/m,
  );
  assert.doesNotMatch(md, /aspelmeyer2009: \*\*UNASSIGNED\*\*/);
  const c = p.cli(['compile', '--yolo']);
  assert.equal(c.status, EXIT_BLOCKED, `${c.stdout}\n${c.stderr}`);
  assert.match(c.stdout, /\[@lecun2015\] is UNASSIGNED/);
  assert.doesNotMatch(c.stderr, STACK_LINE);
  assert.ok(!existsSync(join(p.root, '.paper', 'DRAFT.md')));
});

test('VRFY-17 (built CLI): a hand edit adding an unassigned key after a clean verify is caught by compile\'s recomputation', () => {
  const p = seedGatePaper('unassigned-edit', [{ n: 1, slug: 'intro', assigned: ['aspelmeyer2009'], draft: '# Intro\n\nMeasurement matters [@aspelmeyer2009].\n' }]);
  assert.equal(p.cli(['verify', '1']).status, EXIT_OK);
  assert.equal(p.cli(['compile', '--yolo']).status, EXIT_OK);
  // The edit: an unassigned key, and PLAN.md's hash forged to match so the section does not even look stale.
  const draft = join(p.sectionDir(1, 'intro'), 'DRAFT.md');
  writeFileSync(draft, '# Intro\n\nMeasurement matters [@aspelmeyer2009]. And [@lecun2015].\n');
  const plan = join(p.sectionDir(1, 'intro'), 'PLAN.md');
  writeFileSync(plan, readFileSync(plan, 'utf8').replace(/verified_against_draft_hash: \S+/, `verified_against_draft_hash: ${computeDraftHash(readFileSync(draft), ['aspelmeyer2009'])}`));
  const c = p.cli(['compile', '--yolo']);
  assert.equal(c.status, EXIT_BLOCKED, `${c.stdout}\n${c.stderr}`);
  assert.match(c.stdout, /section 1 \(intro\): citation \[@lecun2015\] is UNASSIGNED/);
});
