// tests/verdict-rows.test.ts — GATE-02 writer→parser round-trip scaffold (Phase 14, Plan 01).
//
// Contract under test:
//   bin/lib/verify/verdict-rows.ts (Wave-1, Plan 02):
//     renderPass1VerdictRow(citekey, verdict, titleJW, authorJW, reason): string
//     renderPass3VerdictRow(citekey, quoteSnippet, verdict, levRatio, reason): string
//     parseVerdictRows(verificationMd): string[]  — failing citekeys only
//
// RED-by-skip (Wave-0 scaffold): behavioral assertions SKIP until verdict-rows.ts
// ships and exports these three functions. Feature-detect via dynamic import +
// typeof check — a hard static import would crash the process before the module
// exists (T-14-01-SCAFFOLD mitigation).
//
// Three non-vacuous behaviors covered:
//   (1) Round-trip  — render a mixed set, parse it back, assert deepEqual on Sets
//       (Pitfall 5: array deepEqual would be order-sensitive; Set comparison is not).
//   (2) Format-drift mutation — corrupt one bold marker, assert the row drops out.
//   (3) Freshness-table immunity (Pitfall 2) — table rows must NOT be parsed as
//       verdict rows (the '^\s*-\s*' anchor excludes '| citekey | ...' table lines).
//
// Path resolution: fileURLToPath(import.meta.url) / new URL(...).href —
// spaced-path safe (OneDrive dev folder; Phase-11 %20 lesson).

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// Resolve the target module paths using URL semantics — safe for spaced paths.
// Check for .ts source (tsx will resolve it); import via .js (tsx loader maps it).
const verdictRowsTsUrl = new URL('../bin/lib/verify/verdict-rows.ts', import.meta.url);
const verdictRowsJsUrl = new URL('../bin/lib/verify/verdict-rows.js', import.meta.url);
const verdictRowsTsPath = fileURLToPath(verdictRowsTsUrl);

// Feature-detect: does the module exist on disk AND export the expected functions?
// We perform the import once and share the result across tests.
let renderPass1VerdictRow: ((citekey: string, verdict: string, titleJW: number, authorJW: number, reason: string) => string) | undefined;
let renderPass3VerdictRow: ((citekey: string, quoteSnippet: string, verdict: string, levRatio: number, reason: string) => string) | undefined;
let parseVerdictRows: ((verificationMd: string) => string[]) | undefined;
let moduleLoaded = false;
let skipReason = '';

// Attempt import before tests run. Node test runner runs all top-level
// code first, then the registered test callbacks — the awaited import
// below resolves before any test callback fires.
if (existsSync(verdictRowsTsPath)) {
  try {
    // Dynamic import via .href keeps noEmit clean (no static TS resolution
    // of a file that does not exist at typecheck time). tsx maps .js → .ts.
    const mod = await import(verdictRowsJsUrl.href) as Record<string, unknown>;
    if (
      typeof mod['renderPass1VerdictRow'] === 'function' &&
      typeof mod['renderPass3VerdictRow'] === 'function' &&
      typeof mod['parseVerdictRows'] === 'function'
    ) {
      renderPass1VerdictRow = mod['renderPass1VerdictRow'] as typeof renderPass1VerdictRow;
      renderPass3VerdictRow = mod['renderPass3VerdictRow'] as typeof renderPass3VerdictRow;
      parseVerdictRows = mod['parseVerdictRows'] as typeof parseVerdictRows;
      moduleLoaded = true;
    } else {
      skipReason = 'verdict-rows.ts exists but does not yet export renderPass1VerdictRow / renderPass3VerdictRow / parseVerdictRows — not yet wired (Wave-1)';
    }
  } catch {
    skipReason = 'verdict-rows.ts import failed — not yet wired (Wave-1)';
  }
} else {
  skipReason = 'bin/lib/verify/verdict-rows.ts not yet created — not yet wired (Wave-1)';
}

// ---------------------------------------------------------------------------
// Test 1: Round-trip — render mixed set, parse back, compare as Sets
// ---------------------------------------------------------------------------
test('GATE-02: round-trip — render Pass-1 + Pass-3 rows, parse back, failing set matches (Set comparison)', {
  skip: !moduleLoaded ? skipReason : false,
}, () => {
  // These assertions only run when moduleLoaded is true.
  const r1 = renderPass1VerdictRow!('smith2020', 'FABRICATED', 0, 0, 'not in bib');
  const r2 = renderPass1VerdictRow!('jones2019', 'MIS-CITED', 0.4, 0.3, 'JW below threshold');
  const r3 = renderPass1VerdictRow!('vaswani2017', 'OK', 1.0, 1.0, 'D-11 AND-gate passed');
  const r4 = renderPass3VerdictRow!('smith2020', 'the claimed quote', 'NOT_FOUND', 0.1, 'not found in PDF');

  const rendered = [r1, r2, r3, r4].join('\n');
  const failing = parseVerdictRows!(rendered);

  // Set comparison — NOT array deepEqual (order not guaranteed; Pitfall 5).
  assert.deepEqual(
    new Set(failing),
    new Set(['smith2020', 'jones2019']),
    'parseVerdictRows must return exactly the blocking citekeys (FABRICATED, MIS-CITED, NOT_FOUND) as a set',
  );

  // Positive check: vaswani2017 must NOT appear (verdict is OK).
  assert.ok(
    !failing.includes('vaswani2017'),
    'parseVerdictRows must NOT include citekeys with verdict OK',
  );
});

// ---------------------------------------------------------------------------
// Test 2: Format-drift mutation — corrupt bold marker → row disappears
// ---------------------------------------------------------------------------
test('GATE-02: format-drift mutation — corrupted bold marker causes row to drop from parseVerdictRows', {
  skip: !moduleLoaded ? skipReason : false,
}, () => {
  // Render a FABRICATED row.
  const row = renderPass1VerdictRow!('smith2020', 'FABRICATED', 0, 0, 'not in bib');

  // Introduce a deliberate typo in the bold verdict marker.
  const corrupted = row.replace('**FABRICATED**', '**FABRICATD**');

  // The corrupted row must NOT yield any citekey (drift detected).
  const failing = parseVerdictRows!(corrupted);
  assert.deepEqual(
    failing,
    [],
    'A row with a corrupted bold marker must not yield any failing citekey — format drift is detected',
  );
});

// ---------------------------------------------------------------------------
// Test 3: Freshness-table immunity — table rows must NOT be parsed
// ---------------------------------------------------------------------------
test('GATE-02: freshness-table immunity — table rows are NOT matched by parseVerdictRows (Pitfall 2)', {
  skip: !moduleLoaded ? skipReason : false,
}, () => {
  // A VERIFICATION.md body containing a Source Freshness table row.
  // The table uses pipe-delimited format; the parser regex anchors on '^\s*-\s*'
  // (list-item syntax) and must exclude these rows.
  const bodyWithTable = [
    '## Source Freshness (RSCH-10)',
    '',
    '| citekey | probe | status | detail |',
    '| --- | --- | --- | --- |',
    '| smith2020 | retraction-watch | WARN | cited work appears in Retraction Watch |',
    '| jones2019 | DOI HEAD | WARN | DOI 404 |',
    '',
  ].join('\n');

  const failing = parseVerdictRows!(bodyWithTable);
  assert.deepEqual(
    failing,
    [],
    'parseVerdictRows must return [] for a body containing only table rows (no list-item verdict rows)',
  );
});
