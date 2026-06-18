// tests/export-gate.test.ts — Phase 6 Wave 0 RED scaffold for DONE-09 + DONE-01.
//
// Mirrors tests/known-bad-pass2.test.ts RED-by-skip stance: behavioral tests
// SKIP-guard on the not-yet-created bin/cli/done.ts so the suite reports skips
// with ZERO failures. Plan 06-02 lands done.ts (exporting runDoneGate) and these
// turn GREEN.
//
// Pins the gate-LOGIC contract (PRD §7.9):
//   (1) UNSUPPORTED Pass2Result + orphanCount>0 Pass4Result + a plagiarism hit,
//       with injected approve:()=>false → { exported:false } and the approver WAS
//       called (gate fired with a per-issue summary).
//   (2) yolo:true → { gateSkipped:true } and the approver is NEVER called.
//   (3) zero issues + approve:()=>true → the generic confirm STILL runs (approver
//       called once) and { exported:true } — the generic gate fires even on a
//       clean paper.
//
// NOTE: the disk→gate feed (readSectionUnsupported over the section VERIFICATION.md
// fixture) + the non-yolo on-disk integration test are added in Plan 06-05 (HIGH-3).
// This file pins the gate-LOGIC contract; 06-05 pins the disk-feed contract.
//
// Pass2Result / Pass4Result TYPES are imported from the existing verify modules —
// NEVER redefined here (the gate consumes the exact shapes pass2/pass4 emit).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pass2Result } from '../bin/lib/verify/pass2.js';
import type { Pass4Result } from '../bin/lib/verify/pass4.js';

const doneSrcPath = fileURLToPath(new URL('../bin/cli/done.ts', import.meta.url));
const doneModUrl = new URL('../bin/cli/done.js', import.meta.url);

interface GateInput {
  pass2Results: Pass2Result[];
  pass4Results: Pass4Result[];
  plagiarismResults: Array<{ phrase: string; matches: string[] }>;
  yolo: boolean;
  approve: () => Promise<boolean>;
}
interface GateResult { exported?: boolean; gateSkipped?: boolean }
type RunDoneGate = (input: GateInput) => Promise<GateResult>;

const UNSUPPORTED: Pass2Result = {
  citekey: 'smith2020',
  claimSentence: 'The effect persists across all populations.',
  verdict: 'UNSUPPORTED',
  rationale: 'Source reports a single cohort only.',
  evidence: '',
};
const ORPHAN: Pass4Result = {
  paragraphIndex: 0,
  totalSentences: 3,
  claimsDetected: 1,
  orphanCount: 1,
  claims: [],
};

// RED-by-skip module-presence consistency (mirrors known-bad-pass2).
test('export-gate: done module presence is consistent with Wave-0 RED state (DONE-09)', () => {
  if (existsSync(doneSrcPath)) {
    assert.ok(true, 'bin/cli/done.ts present — behavioral tests active');
  } else {
    assert.ok(!existsSync(doneSrcPath), 'Wave-0: bin/cli/done.ts absent (RED-by-skip)');
  }
});

test('export-gate: issues present + approve=false → { exported:false }, approver WAS called (DONE-09)',
  { skip: !existsSync(doneSrcPath) },
  async () => {
    const mod = await import(doneModUrl.href) as { runDoneGate: RunDoneGate };
    let called = 0;
    const result = await mod.runDoneGate({
      pass2Results: [UNSUPPORTED],
      pass4Results: [ORPHAN],
      plagiarismResults: [{ phrase: 'attention mechanisms', matches: ['https://example.com/a'] }],
      yolo: false,
      approve: async () => { called++; return false; },
    });
    assert.equal(result.exported, false, 'rejected approval must yield exported:false');
    assert.equal(called, 1, 'the gate must fire its approver exactly once when issues exist');
  },
);

test('export-gate: yolo=true → { gateSkipped:true }, approver NEVER called (DONE-09)',
  { skip: !existsSync(doneSrcPath) },
  async () => {
    const mod = await import(doneModUrl.href) as { runDoneGate: RunDoneGate };
    const result = await mod.runDoneGate({
      pass2Results: [UNSUPPORTED],
      pass4Results: [ORPHAN],
      plagiarismResults: [],
      yolo: true,
      approve: async () => { throw new Error('approver must NOT be called under --yolo'); },
    });
    assert.equal(result.gateSkipped, true, '--yolo must skip the gate');
  },
);

test('export-gate: zero issues + approve=true → generic confirm STILL runs, { exported:true } (PRD §7.9)',
  { skip: !existsSync(doneSrcPath) },
  async () => {
    const mod = await import(doneModUrl.href) as { runDoneGate: RunDoneGate };
    let called = 0;
    const result = await mod.runDoneGate({
      pass2Results: [],
      pass4Results: [],
      plagiarismResults: [],
      yolo: false,
      approve: async () => { called++; return true; },
    });
    assert.equal(called, 1, 'the generic gate must fire even on a clean paper (PRD §7.9)');
    assert.equal(result.exported, true, 'confirmed clean paper must yield exported:true');
  },
);
