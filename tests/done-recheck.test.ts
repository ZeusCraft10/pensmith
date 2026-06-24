// tests/done-recheck.test.ts — GATE-04 reCheckFinalMd scaffold (Phase 14, Plan 01).
//
// Contract under test:
//   bin/cli/done.ts (Wave-1, Plan 04) — exported helper:
//     reCheckFinalMd(finalMd, draftMd, bibPath): Promise<{ passed: boolean; reason: string }>
//
//   Semantics:
//   (a) Citekey-set diff: [@key] tokens in finalMd must equal the set in draftMd.
//       Added, dropped, or swapped citekey → { passed: false, reason: "citekey-set mismatch ..." }
//   (b) Pass-3 quote re-check: absent bib → { passed: true } (skip-clean, no quotes to check).
//       A quote NOT_FOUND in FINAL.md → { passed: false }.
//
// RED-by-skip (Wave-0 scaffold): behavioral assertions SKIP until done.ts exports
// reCheckFinalMd. Feature-detect via dynamic import + typeof check.
//
// Deterministic + offline: all test cases use inline strings (PENSMITH_NO_LLM safe).
// Tests that need a real bib path use mkdtempSync 'pensmith-gate04-' + .paper dir
// (the compile-refuse.test.ts tmpdir paper-seed pattern).
//
// Path resolution: fileURLToPath(import.meta.url) / new URL(...).href —
// spaced-path safe (OneDrive dev folder; Phase-11 %20 lesson).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve done module paths using URL semantics — safe for spaced paths.
// Check for .ts source (which tsx will resolve), import via .js (tsx loader maps it).
const doneTsUrl = new URL('../bin/cli/done.ts', import.meta.url);
const doneJsUrl = new URL('../bin/cli/done.js', import.meta.url);
const doneTsPath = fileURLToPath(doneTsUrl);

// Feature-detect: does done.ts exist AND export reCheckFinalMd?
let reCheckFinalMd: ((finalMd: string, draftMd: string, bibPath: string) => Promise<{ passed: boolean; reason: string }>) | undefined;
let moduleLoaded = false;
let skipReason = '';

if (existsSync(doneTsPath)) {
  try {
    // Import via .js — tsx loader resolves to the .ts source.
    const mod = await import(doneJsUrl.href) as Record<string, unknown>;
    if (typeof mod['reCheckFinalMd'] === 'function') {
      reCheckFinalMd = mod['reCheckFinalMd'] as typeof reCheckFinalMd;
      moduleLoaded = true;
    } else {
      skipReason = 'done.ts exists but does not yet export reCheckFinalMd — not yet wired (Wave-1, Plan 04)';
    }
  } catch {
    skipReason = 'done.ts import failed — not yet wired (Wave-1, Plan 04)';
  }
} else {
  skipReason = 'bin/cli/done.ts not found — not yet created (Wave-1, Plan 04)';
}

// ---------------------------------------------------------------------------
// Helper: create a minimal paper root with an optional CITATIONS.bib content.
// ---------------------------------------------------------------------------
function makePaperRoot(bibContent?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-gate04-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  if (bibContent !== undefined) {
    writeFileSync(join(root, '.paper', 'CITATIONS.bib'), bibContent);
  }
  return root;
}

// ---------------------------------------------------------------------------
// Test 1: Matching citekey sets + no bib (absent bib → skip-clean → passed)
// ---------------------------------------------------------------------------
test('GATE-04: matching citekey sets + absent bib → { passed: true } (skip-clean)', {
  skip: !moduleLoaded ? skipReason : false,
}, async () => {
  const root = makePaperRoot(); // No bib file written.
  const bibPath = join(root, '.paper', 'CITATIONS.bib');

  const draftMd = 'A claim [@smith2020] and another [@jones2019].';
  const finalMd = 'A claim [@smith2020] and another [@jones2019].';

  const result = await reCheckFinalMd!(finalMd, draftMd, bibPath);
  assert.equal(result.passed, true, 'Matching citekey sets + absent bib must pass');
});

// ---------------------------------------------------------------------------
// Test 2: Added citekey in FINAL.md not in draftMd → { passed: false }
// ---------------------------------------------------------------------------
test('GATE-04: added citekey in FINAL.md → { passed: false } naming the added key', {
  skip: !moduleLoaded ? skipReason : false,
}, async () => {
  const root = makePaperRoot(''); // Empty bib.
  const bibPath = join(root, '.paper', 'CITATIONS.bib');

  const draftMd = 'A claim [@smith2020].';
  // Humanizer added a new citation that was not in the draft.
  const finalMd = 'A claim [@smith2020] and a new one [@fabricated2099].';

  const result = await reCheckFinalMd!(finalMd, draftMd, bibPath);
  assert.equal(result.passed, false, 'Added citekey must cause reCheckFinalMd to fail');
  assert.match(
    result.reason,
    /fabricated2099/,
    'Failure reason must name the added citekey',
  );
});

// ---------------------------------------------------------------------------
// Test 3: Dropped citekey → { passed: false }
// ---------------------------------------------------------------------------
test('GATE-04: dropped citekey in FINAL.md → { passed: false }', {
  skip: !moduleLoaded ? skipReason : false,
}, async () => {
  const root = makePaperRoot(''); // Empty bib.
  const bibPath = join(root, '.paper', 'CITATIONS.bib');

  const draftMd = 'A claim [@smith2020] and another [@jones2019].';
  // Humanizer silently dropped a citation.
  const finalMd = 'A claim [@smith2020].';

  const result = await reCheckFinalMd!(finalMd, draftMd, bibPath);
  assert.equal(result.passed, false, 'Dropped citekey must cause reCheckFinalMd to fail');
  assert.match(
    result.reason,
    /jones2019/,
    'Failure reason must name the dropped citekey',
  );
});

// ---------------------------------------------------------------------------
// Test 4: Swapped citekey (one dropped, one added) → { passed: false }
// ---------------------------------------------------------------------------
test('GATE-04: swapped citekey in FINAL.md → { passed: false }', {
  skip: !moduleLoaded ? skipReason : false,
}, async () => {
  const root = makePaperRoot(''); // Empty bib.
  const bibPath = join(root, '.paper', 'CITATIONS.bib');

  const draftMd = 'A claim [@smith2020].';
  // Humanizer swapped the citekey for a different one.
  const finalMd = 'A claim [@jones2019].';

  const result = await reCheckFinalMd!(finalMd, draftMd, bibPath);
  assert.equal(result.passed, false, 'Swapped citekey must cause reCheckFinalMd to fail');
  // Reason should mention either the added or dropped key (or both).
  const reasonMentionsBothKeys =
    /smith2020/.test(result.reason) || /jones2019/.test(result.reason);
  assert.ok(
    reasonMentionsBothKeys,
    `Failure reason must name at least one of the swapped keys (reason: ${result.reason})`,
  );
});

// ---------------------------------------------------------------------------
// Test 5: Absent bib file → { passed: true } (skip-clean, no quotes to check)
// ---------------------------------------------------------------------------
test('GATE-04: absent CITATIONS.bib → { passed: true } (skip-clean — no quotes to verify)', {
  skip: !moduleLoaded ? skipReason : false,
}, async () => {
  const root = makePaperRoot(); // No bib file written — simulates no bib path exists.
  const bibPath = join(root, '.paper', 'CITATIONS.bib');

  // Matching citekey sets — so only the bib-absent path triggers.
  const draftMd = 'A claim [@smith2020].';
  const finalMd = 'A claim [@smith2020].';

  // Verify the bib truly does not exist (defensive — makePaperRoot with no arg writes nothing).
  assert.equal(existsSync(bibPath), false, 'Precondition: CITATIONS.bib must not exist for this test');

  const result = await reCheckFinalMd!(finalMd, draftMd, bibPath);
  assert.equal(result.passed, true, 'Absent bib → no quotes to check → must pass cleanly');
});
