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
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pass2Result } from '../bin/lib/verify/pass2.js';
import type { Pass4Result } from '../bin/lib/verify/pass4.js';

const doneSrcPath = fileURLToPath(new URL('../bin/cli/done.ts', import.meta.url));
const doneModUrl = new URL('../bin/cli/done.js', import.meta.url);

// The committed renderPass2Section-shaped fixture (06-01): one **UNSUPPORTED**
// row + one **SUPPORTED** row. The HIGH-3 disk→gate feed tests consume it.
const PASS2_FIXTURE = fileURLToPath(
  new URL('./fixtures/section-pass2-unsupported/VERIFICATION.md', import.meta.url),
);

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

// ============================================================================
// HIGH-3 — the disk→gate feed (readSectionUnsupported over real on-disk
// section VERIFICATION.md) + the fail-safe + the non-yolo on-disk integration.
// These are the tests Plan 06-05 adds (the Wave-0 file pinned the gate LOGIC;
// these pin the DISK-FEED contract that the gate logic actually consumes).
// ============================================================================

type ReadSectionUnsupported = (paperRoot: string) => Pass2Result[];
type CollectGateIssues = (input: {
  pass2Results: Pass2Result[];
  pass4Results: Pass4Result[];
  plagiarismResults: Array<{ phrase: string; matches: string[] }>;
}) => { unsupported: Pass2Result[]; hasIssues: boolean };

/** Seed an mkdtemp paper root with one section VERIFICATION.md. */
function seedSection(verificationMd: string, sectionDir = '01-intro'): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-export-gate-'));
  const dir = join(root, '.paper', 'sections', sectionDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'VERIFICATION.md'), verificationMd);
  return root;
}

test('export-gate HIGH-3: readSectionUnsupported parses the renderPass2Section UNSUPPORTED row, filters SUPPORTED',
  { skip: !existsSync(doneSrcPath) },
  async () => {
    const mod = await import(doneModUrl.href) as { readSectionUnsupported: ReadSectionUnsupported };
    const fixture = readFileSync(PASS2_FIXTURE, 'utf8');
    const root = seedSection(fixture);
    const rows = mod.readSectionUnsupported(root);
    // The fixture has smith2020 **UNSUPPORTED** + vaswani2017 **SUPPORTED**.
    assert.ok(rows.length >= 1, 'at least one UNSUPPORTED row must be detected');
    assert.ok(
      rows.every((r) => r.verdict === 'UNSUPPORTED'),
      'only UNSUPPORTED rows are returned (SUPPORTED must be filtered out)',
    );
    assert.ok(
      rows.some((r) => r.citekey === 'smith2020'),
      'the fixture UNSUPPORTED citekey smith2020 must be present',
    );
    assert.ok(
      !rows.some((r) => r.citekey === 'vaswani2017'),
      'the SUPPORTED citekey vaswani2017 must NOT be returned (verdict-cell filter, not row count)',
    );
  },
);

test('export-gate HIGH-3: readSectionUnsupported FAILS SAFE on a present-but-unparseable Pass-2 table; absent heading is clean',
  { skip: !existsSync(doneSrcPath) },
  async () => {
    const mod = await import(doneModUrl.href) as { readSectionUnsupported: ReadSectionUnsupported };

    // (a) present ## Pass-2 heading but a DELIBERATELY MALFORMED (3-column) table.
    const malformed = [
      '# Section Verification — 02-x',
      '',
      '## Pass-2 (claim support, advisory — LLM-judged)',
      '',
      '| Citekey | Verdict | Rationale |',
      '|---------|---------|-----------|',
      '| smith2020 | **UNSUPPORTED** | desynced table |',
      '',
    ].join('\n');
    const malRoot = seedSection(malformed, '02-x');
    const malRows = mod.readSectionUnsupported(malRoot);
    assert.ok(
      malRows.length >= 1,
      'an unparseable-but-present Pass-2 table must yield a NON-empty result (fail safe)',
    );
    assert.ok(
      malRows.some((r) => r.citekey === '<unparseable>' && r.verdict === 'UNSUPPORTED'),
      'the fail-safe synthetic <unparseable> UNSUPPORTED sentinel must be present (never a silent clean)',
    );

    // (b) a VERIFICATION.md with NO ## Pass-2 heading → contributes nothing (clean).
    const noPass2 = [
      '# Section Verification — 03-clean',
      '',
      '## Pass-1 (citation integrity, blocking)',
      '',
      'Status: PASS.',
      '',
    ].join('\n');
    const cleanRoot = seedSection(noPass2, '03-clean');
    assert.deepEqual(
      mod.readSectionUnsupported(cleanRoot),
      [],
      'a section with no ## Pass-2 heading must contribute nothing (absent = clean)',
    );
  },
);

test('export-gate HIGH-3: NON-yolo on-disk gate integration — gate fires from real Pass-2 data, does NOT auto-proceed',
  { skip: !existsSync(doneSrcPath) },
  async () => {
    const mod = await import(doneModUrl.href) as {
      readSectionUnsupported: ReadSectionUnsupported;
      collectGateIssues: CollectGateIssues;
      runDoneGate: RunDoneGate;
    };
    const fixture = readFileSync(PASS2_FIXTURE, 'utf8');
    const root = seedSection(fixture);

    // Drive the gate from the ON-DISK Pass-2 data (the load-bearing feed).
    const pass2Results = mod.readSectionUnsupported(root);
    const issues = mod.collectGateIssues({
      pass2Results,
      pass4Results: [],
      plagiarismResults: [],
    });
    assert.equal(issues.hasIssues, true, 'on-disk UNSUPPORTED row must make hasIssues true');

    // Capture stdout so we can assert the per-issue summary precedes the approver.
    const stdoutLines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      stdoutLines.push(s);
      return true;
    };
    let approverCalled = 0;
    let summaryAtCallTime = '';
    let result: GateResult;
    try {
      result = await mod.runDoneGate({
        pass2Results,
        pass4Results: [],
        plagiarismResults: [],
        yolo: false,
        approve: async () => {
          approverCalled++;
          summaryAtCallTime = stdoutLines.join('');
          return false; // user declines export
        },
      });
    } finally {
      (process.stdout as unknown as { write: typeof origWrite }).write = origWrite;
    }

    // (a) the gate did NOT auto-proceed — the approver WAS called.
    assert.equal(approverCalled, 1, 'non-yolo gate must call the approver (no auto-proceed)');
    // (b) a per-issue summary mentioning the UNSUPPORTED citekey printed BEFORE approve().
    assert.ok(
      /smith2020/.test(summaryAtCallTime),
      'the per-issue summary (mentioning smith2020) must print BEFORE the approver is called',
    );
    // (c) declining yields exported:false.
    assert.equal(result.exported, false, 'declined non-yolo gate must yield exported:false');
  },
);
