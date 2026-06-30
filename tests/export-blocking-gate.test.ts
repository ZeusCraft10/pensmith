// tests/export-blocking-gate.test.ts — audit #3/#14 regression.
//
// `pensmith done`/export must re-assert the FABRICATED/MIS-CITED/NOT_FOUND
// blocking gate, not trust that compile already gated. Before the fix, done
// re-read DRAFT.md and exported it without re-verifying — so `done --raw`, a
// bare `/pensmith` dispatch, or a section that became unclean after compile
// could export a fabricated citation. runExportBlockingGate is the unconditional
// gate (neither --raw nor --yolo bypasses it).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runExportBlockingGate } from '../bin/cli/done.js';

function seed(sections: Array<{ name: string; verification: string | null }>): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-exportgate-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, '.paper', 'DRAFT.md'), '# Paper\n\nClaim [@smith2020].\n');
  for (const s of sections) {
    const dir = join(root, '.paper', 'sections', s.name);
    mkdirSync(dir, { recursive: true });
    if (s.verification !== null) {
      writeFileSync(join(dir, 'VERIFICATION.md'), s.verification);
    }
  }
  return root;
}

const CLEAN = [
  'Status: verified',
  '',
  '## Pass-1',
  '- smith2020: **OK** — titleJW=1.00, authorJW=1.00 — D-11 AND-gate passed',
  '',
].join('\n');

const FABRICATED = [
  'Status: failed',
  '',
  '## Pass-1',
  '- fakeauthor2099: **FABRICATED** — titleJW=0.00, authorJW=0.00 — citekey not in bib',
  '',
].join('\n');

test('export gate: a clean verified section does NOT block', () => {
  const root = seed([{ name: '01-intro', verification: CLEAN }]);
  const r = runExportBlockingGate(root);
  assert.equal(r.blocked, false, `expected no block; reasons: ${r.reasons.join('; ')}`);
});

test('export gate (audit #3): a section with a FABRICATED row BLOCKS export', () => {
  const root = seed([
    { name: '01-intro', verification: CLEAN },
    { name: '02-body', verification: FABRICATED },
  ]);
  const r = runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(
    r.reasons.some((x) => /fakeauthor2099/.test(x) && /blocking verdict/.test(x)),
    `expected a blocking-verdict reason; got: ${r.reasons.join('; ')}`,
  );
});

test('export gate (audit #14): a section with no Status line BLOCKS (never verified)', () => {
  const noStatus = '## Pass-2\n\n| Citekey | Claim | Verdict | Rationale |\n| a | b | **UNSUPPORTED** | c |\n';
  const root = seed([{ name: '01-intro', verification: noStatus }]);
  const r = runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => /no Status line/.test(x)));
});

test('export gate (audit #14): a DRAFT.md with NO section VERIFICATION.md BLOCKS', () => {
  const root = seed([]); // DRAFT.md present, but zero sections
  const r = runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => /no verified sections/.test(x)));
});

test('export gate: UNSUPPORTED (advisory Pass-2 pipe row) does NOT block', () => {
  const advisory = [
    'Status: verified',
    '',
    '## Pass-2',
    '| Citekey | Claim Sentence | Verdict | Rationale |',
    '| smith2020 | x | **UNSUPPORTED** | y |',
    '',
  ].join('\n');
  const root = seed([{ name: '01-intro', verification: advisory }]);
  const r = runExportBlockingGate(root);
  assert.equal(r.blocked, false, `UNSUPPORTED is advisory, must not block; reasons: ${r.reasons.join('; ')}`);
});
