// tests/done-recheck.test.ts — GATE-04 (Phase 14), as Phase 20 ships it
// (VRFY-26, D-20-24): a humanized FINAL.md is gated before export by
//   (a) done.ts citedKeySetChange — the humanizer only improves prose, so the
//       cited key set (the broad Pandoc grammar) must equal the compiled
//       draft's; an added, dropped or swapped key is named;
//   (b) the ONE gate core over FINAL.md's own bytes (recomputeExportGate) —
//       a key the bibliography lacks is FABRICATED, an entry that does not
//       parse is UNPARSEABLE naming key and line (fail closed, never
//       "nothing to check"), and every blocking row is a refusal.
// Neither takes a --yolo argument: done calls both unconditionally (the
// end-to-end refusal is tests/done-final-gate.test.ts). Offline and
// deterministic (recorded fixtures only).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { citedKeySetChange, recomputeExportGate } from '../bin/cli/done.js';
import { writeState, writeOutline, writePlan } from './helpers/paper-cli-harness.js';
import { LECUN_BIB } from './helpers/gate-paper.js';

/** A one-section paper assigning `assigned`, with `bib` as CITATIONS.bib. */
function paper(bib: string, assigned: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-gate04-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeState(root, [{ n: 1, slug: 'intro' }]);
  writeOutline(root, [{ n: 1, slug: 'intro', sources: [...assigned] }]);
  writePlan(root, 1, 'intro', { status: 'verified', assigned_sources: `[${assigned.join(', ')}]` });
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), bib);
  return root;
}

test('GATE-04: matching cited key sets (any Pandoc form, order and locators aside) → no change', () => {
  assert.equal(citedKeySetChange('A claim [@smith2020] and another [@jones2019].', 'A claim [@smith2020] and another [@jones2019].'), null);
  assert.equal(citedKeySetChange('As @jones2019 notes, it holds [@smith2020, p. 4].', 'It holds [@smith2020; @jones2019].'), null);
});

test('GATE-04: an added, dropped or swapped citekey in FINAL.md is named', () => {
  assert.match(citedKeySetChange('A claim [@smith2020] and a new one [@fabricated2099].', 'A claim [@smith2020].') ?? '', /^citekey-set mismatch after humanization — added: \[fabricated2099\]$/);
  assert.match(citedKeySetChange('A claim [@smith2020].', 'A claim [@smith2020] and another [@jones2019].') ?? '', /dropped: \[jones2019\]/);
  const swapped = citedKeySetChange('A claim [@jones2019].', 'A claim [@smith2020].') ?? '';
  assert.match(swapped, /added: \[jones2019\]/);
  assert.match(swapped, /dropped: \[smith2020\]/);
  assert.match(citedKeySetChange('A claim [-@fabricated2099].', 'A claim.') ?? '', /added: \[fabricated2099\]/, 'an author-suppressed key is a citation too');
});

test('GATE-04 / VRFY-26: the gate core over FINAL.md\'s bytes refuses a key the bibliography lacks (FABRICATED) — whatever the key-set diff says', async () => {
  const root = paper(LECUN_BIB, ['lecun2015']);
  const clean = await recomputeExportGate(root, 'Deep learning reshaped vision [@lecun2015].\n');
  assert.deepEqual(clean.refusals, [], 'a recorded work passes (offline replay)');
  const forged = await recomputeExportGate(root, 'Deep learning reshaped vision [@lecun2015]. A survey agrees [@fabricated2099].\n');
  assert.ok(forged.refusals.some((r) => /^citation \[@fabricated2099\] is FABRICATED — /.test(r)), JSON.stringify(forged.refusals));
  assert.ok(forged.refusals.some((r) => /^citation \[@fabricated2099\] is UNASSIGNED — /.test(r)), 'a key outside every section\'s assigned sources');
});

test('GATE-04 / VRFY-16: a cited entry of CITATIONS.bib that does not parse is UNPARSEABLE naming key and line (fail closed, never "nothing to check")', async () => {
  const root = paper(`${LECUN_BIB}@article{bad2025,\n\tauthor = {,{\\u  }},\n\tdoi = {10.1/x},\n}\n`, ['lecun2015', 'bad2025']);
  const r = await recomputeExportGate(root, 'A claim "a quoted phrase long enough to count" [@bad2025]. Deep learning [@lecun2015].\n');
  assert.ok(r.refusals.some((x) => /^citation \[@bad2025\] is UNPARSEABLE — its \.paper\/CITATIONS\.bib entry \(line \d+\) does not parse/.test(x)), JSON.stringify(r.refusals));
  assert.ok(!r.refusals.some((x) => /lecun2015/.test(x)), 'the entries that parse are still checked (and pass)');
});
