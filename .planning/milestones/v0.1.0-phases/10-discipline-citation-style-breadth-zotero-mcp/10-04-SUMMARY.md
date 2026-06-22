---
phase: 10-discipline-citation-style-breadth-zotero-mcp
plan: 04
subsystem: testing
tags: [intake-clarifier, citation-styles, hash-pin, WN-3, zotero-mcp, tier-contract, bijection, RIS, capability_check]

# Dependency graph
requires:
  - phase: 10-01
    provides: renderStyle / resolveStyleName (8-style render + APA fallback) that makes the 8-style intake offer truthful
  - phase: 10-02
    provides: writeRis + research.ts CITATIONS.ris emission + exporter risCopied (the RIS surface the tier-contract exercises)
  - phase: 10-03
    provides: zotero-mcp adapter (setZoteroClientForTest used-as-source seam, isZoteroAuthenticated key-only) + sources-registry registration + doctor tri-state probe
provides:
  - intake-clarifier prompt that offers all 8 citation styles (APA/MLA/Chicago NB/Chicago AD/IEEE/AMA/Vancouver/Harvard) with no "APA only" deferral
  - atomic WN-3 dual-surface hash re-pin (prompt-loader EXPECTED_PROMPT_HASHES + repo-files PENDING_HASH_PINS) — loadPrompt resolves with no pending bypass
  - workflows/research.md Zotero MCP used-as-source path + declared absent/no-auth fallback (research never broken by Zotero absence)
  - tier-contract research .ris parity assertion + re-asserted 16-verb bijection (no zotero/ris/style verb leak)
affects: [milestone-close, future-phases-that-edit-intake-clarifier, future-phases-that-add-source-adapters]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "WN-3 in-place re-pin: a byte-stable hash-pinned prompt edited in place re-pins DIRECTLY to the real SHA-256 in BOTH surfaces in one commit (no __PENDING_HASH_ sentinel — the sentinel-then-real two-step is only for files that land before their consumers)"
    - "Source-provider-not-a-verb: a new source adapter adds a sources-registry key + doctor probe + capability_check fallback, never a UX-02 verb — re-asserted by a tier-contract bijection guard"

key-files:
  created:
    - .planning/phases/10-discipline-citation-style-breadth-zotero-mcp/10-04-SUMMARY.md
  modified:
    - templates/prompts/intake-clarifier.md
    - bin/lib/prompt-loader.ts
    - tests/repo-files.test.ts
    - workflows/research.md
    - tests/tier-contract.test.ts

key-decisions:
  - "intake-clarifier re-pinned DIRECTLY to real SHA-256 e2fa74ba... (no sentinel) — the file is edited in place and byte-stable, matching the Phase-9 tutorial-prompt / Phase-5 claim-support re-pin precedent rather than the Wave-0 sentinel-then-real path"
  - "Zotero used-as-source path declared in research.md prose (the capability_check degrade list + Step-3 adapter note) — the executable seam (setZoteroClientForTest → search() pull+normalize) shipped in 10-03; this plan makes the workflow body declare BOTH the present+auth wiring and the absent/no-auth skip"
  - "RIS exercised as a library surface reached THROUGH the research verb, NOT a 17th verb case — the tier-contract assertion runs `research --yolo` in a temp root and asserts both CITATIONS.bib AND CITATIONS.ris land (both tiers share bin/cli/research.ts → writeRis, mcpTool:null compile/done asymmetry)"
  - "W4 closed vocabulary untouched — the research.md edits extend only the degrade_if_missing list entries; the required: list (Task / MCP library.read / Zotero MCP) is unchanged, so no new top-level capability_check key"

patterns-established:
  - "16-verb bijection guard generalized to forbid Phase-10 surface tokens (zotero-mcp/zotero/ris/style) from UX02_VERBS while asserting 'zotero-mcp' IS present in the sources registry — a third independent bijection guard alongside 07-04 nl-triggers and 08-06"

requirements-completed: [CITE-02, CITE-03, RSCH-06]

# Metrics
duration: 5min
completed: 2026-06-22
---

# Phase 10 Plan 04: Integration Wave — 8-Style Intake + Zotero Fallback + Re-asserted Invariants Summary

**The intake-clarifier prompt now offers all 8 citation styles (atomically re-pinned across both WN-3 surfaces with no pending bypass), workflows/research.md declares the Zotero MCP used-as-source path plus its absent/no-auth fallback, and tier-contract exercises CITATIONS.ris parity while re-asserting the locked 16-verb bijection — npm run check fully green (856 tests, 0 fail, 0 skip).**

## Performance

- **Duration:** 5 min
- **Started:** 2026-06-22T06:13:05Z
- **Completed:** 2026-06-22T06:18:11Z
- **Tasks:** 3
- **Files modified:** 5 (4 source + 1 SUMMARY created)

## Accomplishments
- intake-clarifier Q3 + example output offer all 8 styles (APA, MLA, Chicago NB, Chicago AD, IEEE, AMA, Vancouver, Harvard); the "APA is the only option / deferred" caveat is gone.
- Atomic WN-3 dual-surface hash re-pin to the real SHA-256 `e2fa74ba...` in both `bin/lib/prompt-loader.ts` EXPECTED_PROMPT_HASHES and `tests/repo-files.test.ts` PENDING_HASH_PINS — `loadPrompt('intake-clarifier')` resolves at runtime with no `PENSMITH_ALLOW_PENDING_PROMPT_HASHES` bypass.
- `workflows/research.md` capability_check declares BOTH the present+authenticated Zotero used-as-source wiring (setZoteroClientForTest → adapter search() pulls + normalizes to SourceCandidate[]) AND the absent/no-auth fallback (skip the Zotero pull, log it, continue on the other 7 adapters); plus an explicit "Zotero is a source provider, not a verb — no 17th verb" note.
- tier-contract: a real `research --yolo` run asserts CITATIONS.ris lands alongside CITATIONS.bib (CITE-05), and the 16-verb bijection guard confirms `UX02_VERBS.length===16` with no zotero/zotero-mcp/ris/style leak and `'zotero-mcp'` confined to the sources registry.
- Full `npm run check` green end-to-end (lint + typecheck + build + tier-contract + 856-test suite + manifests); zero RED-by-skip remaining for the phase.

## Task Commits

Each task was committed atomically:

1. **Task 1: Update intake-clarifier prompt to 8 styles + atomic WN-3 hash re-pin** — `e9fa3a8` (feat)
2. **Task 2: Declare Zotero MCP absent-fallback in workflows/research.md** — `63de469` (feat)
3. **Task 3: Exercise research .ris parity + re-assert 16-verb bijection in tier-contract** — `2201a81` (test)

**Plan metadata:** committed separately (docs: complete plan) — see final metadata commit.

## Files Created/Modified
- `templates/prompts/intake-clarifier.md` - Q3 now proposes the discipline preset default and lists all 8 styles with the APA-fallback note; example-output line lists the 8 options.
- `bin/lib/prompt-loader.ts` - EXPECTED_PROMPT_HASHES['intake-clarifier'] re-pinned to `e2fa74ba...` (WN-3 lockstep with repo-files).
- `tests/repo-files.test.ts` - PENDING_HASH_PINS intake-clarifier hash re-pinned to the SAME `e2fa74ba...` in the same commit.
- `workflows/research.md` - degrade_if_missing declares the present+auth used-as-source wiring + the absent/no-auth skip; Step 3 adapter list now 8 entries with the no-17th-verb note.
- `tests/tier-contract.test.ts` - imports `{ sources }`; adds a research-path CITATIONS.ris parity test + a Phase-10 bijection re-assertion guard.

## Decisions Made
- **Direct re-pin, no sentinel:** the intake-clarifier file is edited in place and byte-stable on this edit, so it re-pins straight to the real SHA-256 in both surfaces in one commit (the Phase-9/Phase-5 in-place re-pin precedent). A `__PENDING_HASH_` sentinel is only for files that land before their consumers — not applicable here.
- **Zotero used-as-source declared in prose; executable seam already shipped:** the `setZoteroClientForTest` → `search()` pull+normalize seam landed in 10-03; this plan's job was to make the workflow body declare the present-path wiring AND the absent/no-auth fallback, so the orchestrator has a contract to follow. The adapter is explicitly NOT described as a stub.
- **RIS via the research verb, not a 17th verb:** RIS is a library surface; the tier-contract assertion runs the existing `research` verb and checks for `.ris` alongside `.bib` (mcpTool:null compile/done asymmetry), keeping the locked-16 bijection intact.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. The baseline intake-clarifier SHA-256 matched the existing pin (`bc93c546...`) before editing, confirming byte-stability; `bin/cli/research.ts` already emitted CITATIONS.ris (from 10-02) and `bin/lib/sources/index.ts` already registered `zotero-mcp` (from 10-03), so the integration assertions had real implementations to exercise.

## User Setup Required
None - no external service configuration required. (Zotero MCP remains optional: absent/unauthenticated degrades gracefully; live MCP transport is MANUAL-only with no CI coverage by design.)

## Next Phase Readiness
- Final plan of the final phase. Phase 10 (Discipline + citation-style breadth + Zotero MCP) is complete: 8 styles render (10-01), RIS emits + bundles (10-02), the zotero-mcp source provider + doctor probe ship (10-03), and this plan makes the styles user-reachable, declares the Zotero fallback, and re-asserts the invariants.
- `npm run check` is fully green with zero RED-by-skip for the phase and no pending-hash bypass needed — ready for phase verification / milestone close.

## Self-Check: PASSED

- All 5 modified source files + the SUMMARY exist on disk.
- All 3 task commits exist in git history (e9fa3a8, 63de469, 2201a81).
- `npm run check` fully green (lint + typecheck + build + tier-contract + 856 tests, 0 fail / 0 skip + manifests).

---
*Phase: 10-discipline-citation-style-breadth-zotero-mcp*
*Completed: 2026-06-22*
