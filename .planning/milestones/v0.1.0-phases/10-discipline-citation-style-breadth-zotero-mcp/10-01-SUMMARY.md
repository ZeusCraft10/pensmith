---
phase: 10-discipline-citation-style-breadth-zotero-mcp
plan: 01
subsystem: citation-engine
tags: [csl, citation-js, multi-style, renderStyle, memoization, h2-fix, wave-1]

# Dependency graph
requires:
  - phase: 03-citation-engine
    provides: "bin/lib/citations.ts (parseBib/renderApa + PKG_ROOT walk + Cite re-export) and templates/citation-styles/apa.csl bundled-file precedent"
  - phase: 10-00
    provides: "7 committed bundled CSL files + tests/citation-render.test.ts per-style render tests (RED-by-skip) + the renderStyle feature-detect skip guard"
provides:
  - "renderStyle(entries, style) — generic offline+deterministic N-style bibliography renderer over all 8 bundled CSL files (apa, mla, chicago-notes-bib, chicago-author-date, ieee, ama, vancouver, harvard)"
  - "resolveStyleName(discipline) — discipline→CSL-style lookup (computer-science→ieee, history/philosophy→chicago-author-date, literature→mla, all-else/unknown→apa)"
  - "registeredStyles Map memoization (one templates.add per style name per process) replacing the apaRegistered boolean — Pitfall-1 collision guard"
  - "_resetStyleTemplatesForTest() (clears Map) + _resetApaTemplateForTest() re-pointed to registeredStyles.delete('apa')"
  - "renderApa re-routed through renderStyle(entries,'apa') — SINGLE 'pensmith-apa' registration path (H2 fix), export contract unchanged + byte-identical output"
affects: [10-02, 10-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Map<string,boolean> memoization keyed by style name, checked BEFORE every plugins.config.get('@csl').templates.add — guards citeproc's no-idempotency 'template already registered' throw (RESEARCH Pitfall 1)"
    - "Single-registration delegation: a locked legacy export (renderApa) re-routed through the generalized path so a shared citeproc template name has exactly ONE registrar — the second add never fires"
    - "Offline+deterministic render via format:'text' + lang:'en-US' + readFileSync of bundled .csl (no render-time fetch); proven by a byte-identical back-to-back regression test"

key-files:
  created: []
  modified:
    - bin/lib/citations.ts
    - tests/citation-render.test.ts

key-decisions:
  - "Removed CUSTOM_APA_NAME and APA_CSL_PATH consts (both went dead after renderApa's body collapsed to a renderStyle delegate) to satisfy the no-unused-vars eslint gate — the plan's interface note pre-listed them as 'reuse' but the H2 delegation supersedes that"
  - "ensureStyleTemplate constructs the per-style path inline from PKG_ROOT + STYLE_FILENAMES rather than special-casing apa via APA_CSL_PATH, keeping ONE code path for all 8 styles including apa"
  - "Followed the plan's H2 override of PATTERNS.md line 168 ('either is acceptable'): renderApa MUST delegate; the standalone apaRegistered boolean + ensureApaTemplate were deleted"

patterns-established:
  - "Generalize-a-single-resource-memo-to-N-via-Map while preserving the locked single-resource export by delegation — the canonical shape for extending a chokepoint module without breaking its Wave-0 contract"

requirements-completed: [CITE-02, CITE-03]

# Metrics
duration: 6min
completed: 2026-06-22
---

# Phase 10 Plan 01: citations.ts Multi-Style renderStyle + renderApa Delegation Summary

**Generalized the APA-only renderer in `bin/lib/citations.ts` to all 8 styles via a `registeredStyles` Map memoization, added `renderStyle`/`resolveStyleName`, and re-routed `renderApa` through `renderStyle(entries,'apa')` so 'pensmith-apa' has a single Map-guarded registration path — flipping the 7 Wave-0 per-style render tests from SKIP to GREEN and proving determinism + H2 byte-parity + no-collision, all offline.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-22T05:44:11Z
- **Completed:** 2026-06-22T05:50:19Z
- **Tasks:** 2
- **Files modified:** 2 (bin/lib/citations.ts, tests/citation-render.test.ts)

## Accomplishments
- **`renderStyle(entries, style)`** renders a non-empty, deterministic, offline bibliography for all 8 styles (apa + mla + chicago-notes-bib + chicago-author-date + ieee + ama + vancouver + harvard) by `readFileSync` of the bundled `templates/citation-styles/<style>.csl` then `templates.add('pensmith-${style}', ...)` — never fetches. `format:'text'` + `lang:'en-US'` keep output byte-identical for identical input (the bundled en-US citeproc locale, no network variance).
- **`registeredStyles` Map** replaces the single `apaRegistered` boolean: the `registeredStyles.get(style)` check before every `templates.add` is the Pitfall-1 collision guard, so a hot loop of `renderStyle` calls registers each style exactly once.
- **H2 single-registration fix:** `renderApa`'s body collapsed to `return renderStyle(entries, 'apa')` after its array guard — the export name/async/signature are unchanged, output is byte-identical (same apa.csl, same 'pensmith-apa' name, same cite.format options), and 'pensmith-apa' now has exactly ONE registrar (`ensureStyleTemplate`). Calling `renderApa()` and `renderStyle(entries,'apa')` in one process no longer throws "template already registered".
- **`resolveStyleName(discipline)`** provides the discipline→style table for downstream consumers (CS→ieee, history/philosophy→chicago-author-date, literature→mla, all-else/unknown→apa).
- **Test reset symbols kept in lockstep:** `_resetApaTemplateForTest()` re-pointed to `registeredStyles.delete('apa')` (no stale boolean); added `_resetStyleTemplatesForTest()` clearing the whole Map.
- **Three Task-2 regression tests** appended: deterministic byte-identical double `renderStyle('ieee')` + no-collision (CITE-02), `renderApa↔renderStyle('apa')` byte-parity + `doesNotReject` in one process (the executable H2 proof), and the `resolveStyleName` mapping table.
- **D-19 chokepoint intact:** still the SOLE `import Cite from 'citation-js'`; eslint clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Map memoization + renderStyle + resolveStyleName; renderApa delegates** — `e32b524` (feat)
2. **Task 2: determinism + single-registration parity + resolveStyleName tests** — `54f4546` (test)

**Plan metadata:** see final `docs(10-01)` commit.

## Files Created/Modified
- `bin/lib/citations.ts` — added `registeredStyles` Map, `STYLE_FILENAMES`, `ensureStyleTemplate`, `renderStyle`, `resolveStyleName`, `_resetStyleTemplatesForTest`; rewrote `renderApa` to delegate; deleted `apaRegistered`/`ensureApaTemplate`/`CUSTOM_APA_NAME`/`APA_CSL_PATH`; re-pointed `_resetApaTemplateForTest`.
- `tests/citation-render.test.ts` — appended 3 tests (determinism+collision, renderApa↔renderStyle('apa') H2 parity, resolveStyleName table).

## Decisions Made
- **Deleted `CUSTOM_APA_NAME` and `APA_CSL_PATH`.** After `renderApa` collapsed to a `renderStyle('apa')` delegate, both consts became unreferenced in code (comments only). The no-unused-vars eslint gate would fail if they were retained, and the plan's Task-1 step 6 explicitly authorizes removing `CUSTOM_APA_NAME` when unused. `ensureStyleTemplate` constructs the apa path itself from `PKG_ROOT` + `STYLE_FILENAMES['apa']`, so `APA_CSL_PATH` had no remaining purpose. This diverges from the `<interfaces>` note that pre-listed both as "reuse, do NOT redeclare" — superseded by the H2 delegation (deviation Rule 3).
- **One code path for all 8 styles including apa.** `ensureStyleTemplate('apa')` resolves to `apa.csl` and registers 'pensmith-apa' exactly as the old `renderApa` did, so there is no apa special-case branch — the byte-identical guarantee falls out of using the identical name + bytes + options.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed `APA_CSL_PATH` (in addition to the plan-sanctioned `CUSTOM_APA_NAME` removal)**
- **Found during:** Task 1 (eslint verification)
- **Issue:** Once `renderApa` delegates to `renderStyle('apa')`, the module-level `APA_CSL_PATH` const is no longer read anywhere in code — only in comments. The repo's no-unused-vars eslint rule (the Task-1 `<verify>` gate) would flag it. The plan's `<interfaces>` block listed `APA_CSL_PATH` as a "reuse, do NOT redeclare" symbol, but the H2 delegation makes it dead code.
- **Fix:** Deleted the `APA_CSL_PATH` const and updated the three comments that referenced it to describe the inline path construction instead. (`CUSTOM_APA_NAME` removal was already plan-sanctioned by Task-1 step 6.)
- **Files modified:** bin/lib/citations.ts
- **Verification:** `npx eslint bin/lib/citations.ts` exits 0; `tsc --noEmit` exits 0.
- **Committed in:** `e32b524` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking). The plan's H2 single-registration requirement, byte-parity contract, and offline+deterministic must-haves were all implemented exactly as specified.

## Issues Encountered
- **Flaky unrelated test `tests/lock.test.ts:79`.** A lock-ordering concurrency test (asserting `A-start, A-end, B-start` interleaving) failed once on a `npm test` run, then passed on immediate re-run and again under `npm run check`. It is a timing-sensitive test with zero relationship to citations.ts (no lock interaction in this plan's changes). Out of scope per the deviation scope boundary (only auto-fix issues directly caused by the current task's changes); logged here for the phase verifier. Not deferred to `deferred-items.md` because it is pre-existing flakiness, not a discovered defect from this plan.

## Known Stubs
None — all 8 styles render real bibliographies from the bundled CSL files; `resolveStyleName` returns concrete style keys.

## Threat Flags
None — no new network endpoints, auth paths, or trust-boundary surface introduced. Render is offline (`readFileSync` only) and output is plain text (no HTML/script injection surface), consistent with the plan's threat register (T-10-01-01..04, all `mitigate`/`accept` dispositions satisfied).

## Next Phase Readiness
- 10-02 (`ris-write.ts`) can import `{ Cite }` from `./citations.js` unchanged — the D-19 chokepoint and re-export are intact.
- 10-04 (downstream consumers of multi-style render) can call `renderStyle(entries, resolveStyleName(discipline))` — both exports are live and tested.
- The remaining 11 suite skips are the RIS/zotero/disciplines RED-by-skip contracts owned by 10-02/10-03; this plan's 8 render tests (7 styles + apa) and 3 Task-2 regression tests are all GREEN.

## Self-Check: PASSED

Both task commits present in git history (`e32b524`, `54f4546`); both modified files exist on disk; `bin/lib/citations.ts` exports `renderStyle`, `resolveStyleName`, `_resetStyleTemplatesForTest`, `renderApa`, `parseBib`, `Cite`. `npm run check` GREEN — eslint + tsc + build + tier-contract + 851 tests (0 fail, 11 skip) + manifest validation all pass.

---
*Phase: 10-discipline-citation-style-breadth-zotero-mcp*
*Completed: 2026-06-22*
