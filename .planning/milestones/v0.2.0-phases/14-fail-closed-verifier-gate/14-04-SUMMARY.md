---
phase: 14-fail-closed-verifier-gate
plan: "04"
subsystem: done-gate
tags: [gate-04, humanizer-recheck, citation-integrity, citekey-diff, pass3]
dependency_graph:
  requires: ["14-01"]
  provides: ["GATE-04"]
  affects: ["bin/cli/done.ts"]
tech_stack:
  added: []
  patterns: ["citekey-set diff", "runPass3 on FINAL.md", "hard-block before runDoneGate"]
key_files:
  modified:
    - bin/cli/done.ts
decisions:
  - "Citekey-set diff runs BEFORE Pass-3 (Pitfall 5) — set math is O(n), runs offline"
  - "bibByCitekey built from full CITATIONS.bib (Pitfall 4) — NOT filtered by DRAFT keys"
  - "GATE-04 is a hard block (return { ok: false }) BEFORE runDoneGate, not inside the advisory DONE-09 flow"
  - "Skip cleanly when finalPath === null or args.yolo === true — no throw"
  - "Absent or whitespace-only bib returns { passed: true } — no quotes to check"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-24"
  tasks_completed: 2
  files_modified: 1
---

# Phase 14 Plan 04: GATE-04 reCheckFinalMd Summary

GATE-04: deterministic citekey-set diff + Pass-3 re-check on humanized FINAL.md, hard-blocking export before runDoneGate when any citation integrity issue is found.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add reCheckFinalMd helper (citekey-set diff + Pass-3) | 5548f59 | bin/cli/done.ts |
| 2 | Wire GATE-04 hard block between humanize and runDoneGate | 5548f59 | bin/cli/done.ts |

Both tasks committed atomically in a single commit (the helper and call site are inseparable for correctness).

## What Was Built

Added `reCheckFinalMd(finalMd, draftMd, bibPath): Promise<{ passed: boolean; reason: string }>` as a named export in `bin/cli/done.ts`.

### Step (a) — Citekey-set diff (runs first)

`extractCitekeys(FINAL.md)` set must equal `extractCitekeys(DRAFT.md)` set. Any added, dropped, or swapped `[@key]` token returns `{ passed: false, reason: "citekey-set mismatch after humanization — added: [...]; dropped: [...]" }`.

### Step (b) — Pass-3 quote re-check (only when sets match)

Absent or empty `CITATIONS.bib` → `{ passed: true }` (skip-clean). Otherwise builds `bibByCitekey` from the **full** CITATIONS.bib via the `parseBibtex` pattern (Pitfall 4 — NOT filtered by DRAFT keys), runs `runPass3(finalMd, bibByCitekey)`, and hard-blocks on any `NOT_FOUND` verdict.

### Call site (GATE-04 wire)

Inserted after the honesty block and **before** `readSectionUnsupported` / `runDoneGate` in `doneCommand.run()`:

```ts
if (finalPath !== null && args.yolo !== true) {
  const finalMd = readFileSync(finalPath, 'utf8');
  const bibPath = join(paperDir(paperRoot), 'CITATIONS.bib');
  const gate4 = await reCheckFinalMd(finalMd, draftMd, bibPath);
  if (!gate4.passed) {
    process.stdout.write(`pensmith done: GATE-04 BLOCKED — FINAL.md failed re-verification: ${gate4.reason}\n`);
    return { ok: false };
  }
}
```

Skip conditions: `finalPath === null` (no humanizer / `--raw`) and `args.yolo === true`.

## Tests

All 5 `done-recheck.test.ts` tests flipped from SKIP to PASS:

| Test | Result |
|------|--------|
| Matching citekey sets + absent bib → passed | PASS |
| Added citekey in FINAL.md → failed, names added key | PASS |
| Dropped citekey in FINAL.md → failed, names dropped key | PASS |
| Swapped citekey in FINAL.md → failed, names key | PASS |
| Absent CITATIONS.bib → passed (skip-clean) | PASS |

Full suite: **915 pass, 0 fail, 2 skip** (2 skips are from parallel Wave-2 plans 14-02/14-03, unrelated).

## Deviations from Plan

None — plan executed exactly as written.

The build (`npm run build`) and lint (`npm run lint`) surface errors only in `bin/lib/compile.ts` and `bin/lib/sources/retraction-watch.ts` — both modified by the parallel Wave-2 plans 14-02/14-03, which this plan was explicitly forbidden from touching. `done.ts` has zero lint errors and zero typecheck errors.

## Threat Surface Scan

No new network endpoints or trust boundaries introduced. GATE-04 reads only local files (FINAL.md, DRAFT.md, CITATIONS.bib). Pass-3 network (OA fetch) is the existing cassette-backed path — no new secret/PII surface.

## Self-Check

- [x] `bin/cli/done.ts` exists and exports `reCheckFinalMd`
- [x] Commit 5548f59 exists
- [x] 5 done-recheck tests pass (0 skipped)
- [x] Hard block placed BEFORE `runDoneGate` call
- [x] Skip when `finalPath === null` or `args.yolo === true` confirmed in code

## Self-Check: PASSED
