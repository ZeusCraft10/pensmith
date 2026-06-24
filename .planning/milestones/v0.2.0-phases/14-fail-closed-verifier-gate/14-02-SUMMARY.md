---
phase: 14-fail-closed-verifier-gate
plan: "02"
subsystem: compile-gate
tags: [gate-01, gate-02, verdict-rows, compile, verify, refactor]
dependency_graph:
  requires: ["14-01"]
  provides: ["verdict-rows-module", "gate-01-guard", "gate-02-single-source"]
  affects: ["bin/lib/compile.ts", "bin/cli/verify.ts"]
tech_stack:
  added: []
  patterns: ["pure-utility-module", "fail-closed-guard", "shared-render-parse-pair"]
key_files:
  created:
    - bin/lib/verify/verdict-rows.ts
  modified:
    - bin/cli/verify.ts
    - bin/lib/compile.ts
decisions:
  - "REFUSING_VERDICTS constant deleted from compile.ts — BLOCKING_VERDICTS in verdict-rows.ts is the single definition"
  - "failingCitekeys inline function deleted — parseVerdictRows is the single parser"
  - "GATE-01 continue skips both the verdict parse AND the staleness block (matches existing if(!sec) pattern)"
  - "Status: unverifiable passes hasStatus check (Pitfall 3) — no behavioral change for bib-missing sections"
metrics:
  duration: "~12 minutes"
  completed: "2026-06-24T06:28:21Z"
  tasks_completed: 2
  files_created: 1
  files_modified: 2
---

# Phase 14 Plan 02: GATE-01 + GATE-02 (verdict-rows shared module + fail-closed compile) Summary

GATE-02 shared render+parse module extracted to verdict-rows.ts; GATE-01 hasStatus fail-closed guard wired into compile.ts section loop; verify.ts writer delegated to render functions with byte-identical output.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create bin/lib/verify/verdict-rows.ts | 63a45c7 | bin/lib/verify/verdict-rows.ts (created) |
| 2 | Wire verify.ts + compile.ts + GATE-01 guard | 063503a | bin/cli/verify.ts, bin/lib/compile.ts |

## What Was Built

### bin/lib/verify/verdict-rows.ts (new — GATE-02)

Pure module (no fs/path/network imports) exporting the matched render+parse trio:

- `renderPass1VerdictRow(citekey, verdict, titleJW, authorJW, reason)` — byte-identical format to the former inline template literal in verify.ts:155
- `renderPass3VerdictRow(citekey, quoteSnippet, verdict, levRatio, reason)` — byte-identical to verify.ts:159 including the U+2026 ellipsis and em-dashes
- `parseVerdictRows(verificationMd)` — same regex and logic as the deleted inline `failingCitekeys` function; anchored on `^\s*-\s*` to exclude freshness table rows (Pitfall 2)

Module-local `BLOCKING_VERDICTS` set mirrors the deleted `REFUSING_VERDICTS` from compile.ts.

### bin/cli/verify.ts (modified — GATE-02 writer)

Added import of `renderPass1VerdictRow`, `renderPass3VerdictRow` from `../lib/verify/verdict-rows.js`. Replaced the two inline template-literal map callbacks in the `lines[]` array with calls to the render functions. All other lines[] content, `atomicWriteFile`, and return shape are unchanged.

### bin/lib/compile.ts (modified — GATE-01 + GATE-02 parser)

- Added `import { parseVerdictRows } from './verify/verdict-rows.js'`
- Deleted `const REFUSING_VERDICTS = new Set([...])` (line 62)
- Deleted `function failingCitekeys(verificationMd)` (lines 134-147)
- Inserted GATE-01 guard immediately after the `verificationMd` read and before the refuse-gate for-loop:
  ```typescript
  const hasStatus = /^Status:\s*\S/m.test(verificationMd);
  if (!hasStatus) {
    refuseReasons.push(`section ${os.n} (${os.slug}): no verifiable VERIFICATION.md ...`);
    continue;
  }
  ```
- Replaced `for (const ck of failingCitekeys(verificationMd))` with `for (const ck of parseVerdictRows(verificationMd))`

## Tests Flipped (skip → pass)

| Test | File | Status |
|------|------|--------|
| GATE-02: round-trip — render Pass-1+Pass-3 rows, parse back, failing set matches | verdict-rows.test.ts | skip → PASS |
| GATE-02: format-drift mutation — corrupted bold marker drops row | verdict-rows.test.ts | skip → PASS |
| GATE-02: freshness-table immunity — table rows NOT matched | verdict-rows.test.ts | skip → PASS |
| GATE-01: NO VERIFICATION.md → refuses with gate-01 reason | compile-refuse.test.ts | pre-impl skip → PASS |
| GATE-01: empty/whitespace-only VERIFICATION.md → refuses | compile-refuse.test.ts | pre-impl skip → PASS |
| GATE-01: content but no Status: line → refuses | compile-refuse.test.ts | pre-impl skip → PASS |
| GATE-01: valid Status: verified + OK row → compiles | compile-refuse.test.ts | already-passing → still PASS |
| GATE-01 regression (Pitfall 3): Status: unverifiable → NOT refused | compile-refuse.test.ts | already-passing → still PASS |

## Byte-Identical Output Confirmation

The human-readable VERIFICATION.md format is unchanged. The render functions in verdict-rows.ts return the same string byte-for-byte as the former inline template literals. Confirmed by:

1. The `renderPass1VerdictRow` return value uses the same format: `- ${citekey}: **${verdict}** — titleJW=${titleJW.toFixed(2)}, authorJW=${authorJW.toFixed(2)} — ${reason}`
2. The `renderPass3VerdictRow` return value uses the same format: `- ${citekey} ("${quoteSnippet}…"): **${verdict}** — lev=${levRatio.toFixed(3)} — ${reason}`
3. All existing compile-refuse tests that depend on the written verdict format continue to pass.
4. The verify-advisory-isolation tests (checking bin/cli/verify.ts structure) pass.
5. known-bad-citations.test.ts (Pass-1 end-to-end through verify.ts) passes.

## Deviations from Plan

None — plan executed exactly as written.

- `verify-output.test.ts` referenced in the plan's verify command does not exist in the test suite (no such file). The byte-identical guarantee is confirmed by the existing compile-refuse + known-bad-citations tests, which exercise the full verify→parse round-trip.

## Test Suite Status

| Suite | Result |
|-------|--------|
| `npm run build` | PASS |
| `npm run lint` | PASS (0 errors) |
| `npm run typecheck` | PASS (0 errors) |
| `npm run test:tier-contract` | PASS (48/48) |
| `npm test` (full suite) | PASS (915 pass, 2 pre-existing skips, 0 fail) |
| `tests/verdict-rows.test.ts` | 3/3 PASS (all skip→pass) |
| `tests/compile-refuse.test.ts` | 9/9 PASS (GATE-01 assertions active) |
| `tests/known-bad-citations.test.ts` | 4/4 PASS |

## Known Stubs

None.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The `parseVerdictRows` function is a pure string parser; the hasStatus guard reads only existing VERIFICATION.md content already read by the prior code.

## Self-Check: PASSED

- [x] bin/lib/verify/verdict-rows.ts exists: confirmed (created in Task 1)
- [x] bin/cli/verify.ts imports renderPass1VerdictRow: confirmed (grep match)
- [x] bin/lib/compile.ts imports parseVerdictRows: confirmed (grep match)
- [x] failingCitekeys function absent from compile.ts: confirmed (deleted)
- [x] Commit 63a45c7 exists: confirmed (verdict-rows.ts)
- [x] Commit 063503a exists: confirmed (verify.ts + compile.ts)
- [x] Full suite: 915 pass, 0 fail
