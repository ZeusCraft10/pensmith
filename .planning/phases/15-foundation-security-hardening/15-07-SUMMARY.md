---
phase: 15-foundation-security-hardening
plan: "07"
subsystem: honesty
tags: [hard-05, gptzero, disclosure, consent-gate, size-cap, wn-3, locked-copy]
dependency_graph:
  requires: ["15-01", "15-06"]
  provides: ["HARD-05 GPTZero egress consent + disclosure + cap"]
  affects: ["bin/lib/honesty.ts", "references/honesty-framing.md", "tests/repo-files.test.ts"]
tech_stack:
  added: []
  patterns: ["ask() consent gate (yolo-skippable, non-TTY silent-decline)", "loadFramingNote verbatim-read pattern (extended to disclosure section)", "GPTZERO_MAX_BYTES size cap with truncation seam"]
key_files:
  created: []
  modified:
    - bin/lib/honesty.ts
    - references/honesty-framing.md
    - tests/repo-files.test.ts
decisions:
  - "Consent gate placed AFTER offline branch: offline cassette has no network egress so consent is irrelevant; test-injection decline (consentGranted=false) checked before offline branch so the seam still works"
  - "Disclosure shown only before live POST (not offline branch) — consistent with 'no data egress without consent' framing"
  - "scoreHonestyWithOptions exported as the consent-seam entry point; scoreHonesty unchanged for backward compatibility"
  - "Non-TTY silent-decline: honesty is advisory; hanging ask() in CI would violate never-blocks-export invariant (Pitfall 6)"
metrics:
  duration: "~10 minutes"
  completed: "2026-06-24"
  tasks_completed: 2
  files_modified: 3
---

# Phase 15 Plan 07: HARD-05 GPTZero Disclosure + Consent + Size Cap Summary

**One-liner:** GPTZero POST now guarded by verbatim disclosure from locked framing file + ask() consent gate (yolo-skippable, non-TTY silent-decline) + 50 KB size cap, with WN-3 standalone hash-pin re-pinned atomically.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend honesty-framing.md + re-pin PINNED | 35fb3a4 | references/honesty-framing.md, tests/repo-files.test.ts |
| 2 | Disclosure + consent gate + size cap in scoreWithGptzero | 35fb3a4 | bin/lib/honesty.ts |

Both tasks committed atomically (same commit per requirement: framing edit + PINNED re-pin must be lockstep).

## What Was Built

### references/honesty-framing.md
Extended with a new `## GPTZero Data Transmission Disclosure` section containing a `> ` blockquote line read verbatim by `bin/lib/honesty.ts`. Copy states:
- Full paper text sent to GPTZero (api.gptzero.me)
- Transparency-only — does NOT make output undetectable
- No data sent without consent
Transparency-only constraint preserved; wording never weakens the locked framing.

### tests/repo-files.test.ts (line 208)
Standalone PINNED constant updated from `549bdecb...` to `9f894ea8...` — the new SHA-256 of the extended framing file. This is the WN-3 re-pin (standalone, NOT the PENDING_HASH_PINS loop).

### bin/lib/honesty.ts
Five additions:
1. `GPTZERO_MAX_BYTES = 50_000` — exported size-cap constant (HARD-05 seam)
2. `__truncateForGptzeroTest()` — exported truncation function (test seam)
3. `loadDisclosureNote()` — reads the new `## GPTZero Data Transmission Disclosure` section from the locked framing file, same verbatim-read pattern as `loadFramingNote()`
4. `GptzeroScoringOptions` interface — `{ yolo?: boolean; consentGranted?: boolean }`
5. `scoreHonestyWithOptions()` — exported entry point that threads opts into `scoreWithGptzero()`

`scoreWithGptzero()` restructured (in order):
1. Key-absence guard (unchanged)
2. Explicit `consentGranted === false` injection → null (test seam; before offline branch)
3. Offline cassette branch (unchanged; no disclosure/consent — no egress)
4. Disclosure shown (`loadDisclosureNote()` → stdout)
5. Consent gate: yolo skips; `consentGranted === true` bypasses ask(); non-TTY → silent null; TTY → `ask()` interactive
6. Size cap: over-cap input truncated with stdout note
7. Live httpFetch POST (unchanged)

GPTZERO_API_KEY value still reaches only the `x-api-key` header — never logged anywhere.

## Tests Flipped

| Test | Before | After |
|------|--------|-------|
| HARD-05: GPTZERO_MAX_BYTES seam export consistent with Wave-1 RED state | skip | PASS |
| HARD-05: GPTZERO_MAX_BYTES is a positive number | skip | PASS |
| HARD-05: over-cap input → POST body truncated to GPTZERO_MAX_BYTES | skip | PASS |
| HARD-05: consent declined (non-TTY default) → scoreHonesty returns null | skip | PASS |
| references/honesty-framing.md hash-pin (Phase 6 DONE-04 LOCKED) | FAIL (stale hash) | PASS |

All existing DONE-04/05 regression tests remain PASS.

## Verification

```
node --import tsx --test tests/honesty.test.ts tests/repo-files.test.ts
  tests 60, pass 60, fail 0

npm run lint      → clean
npm run typecheck → clean
npm run test:tier-contract → 48/48 pass
npm test          → 952/952 pass
```

## Deviations from Plan

**1. [Rule 1 - Bug] Offline cassette regression test would have silently declined in non-TTY**

- **Found during:** Task 2 implementation — first pass put disclosure+consent before the offline branch
- **Issue:** The existing `scoreHonesty('some text', 'test-key-offline')` regression test runs in non-TTY (node:test environment); with consent before offline branch, the non-TTY silent-decline path returned null before the cassette was read
- **Fix:** Reordered: explicit `consentGranted===false` injection checked first (seam always works), then offline branch (no egress = no consent needed), then disclosure+consent only for the live branch
- **Files modified:** bin/lib/honesty.ts (scoreWithGptzero reordering)
- **Commit:** 35fb3a4

## Self-Check

- [x] `bin/lib/honesty.ts` exists and contains `GPTZERO_MAX_BYTES`, `scoreHonestyWithOptions`, `loadDisclosureNote`
- [x] `references/honesty-framing.md` contains `## GPTZero Data Transmission Disclosure`
- [x] `tests/repo-files.test.ts` PINNED updated to `9f894ea8...`
- [x] Commit 35fb3a4 exists in git log

## Self-Check: PASSED

All three files modified; commit 35fb3a4 verified; 952/952 tests green; lint + typecheck clean.

## Threat Flags

None — no new network endpoints or auth paths beyond what the plan anticipated (GPTZero POST was already present; this plan adds the consent gate that guards it).
