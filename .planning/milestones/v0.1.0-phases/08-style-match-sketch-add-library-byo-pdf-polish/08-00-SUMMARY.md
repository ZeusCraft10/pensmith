---
phase: 08-style-match-sketch-add-library-byo-pdf-polish
plan: 00
subsystem: testing
tags: [red-by-skip, fixtures, style-match, global-library, pymupdf, crossref-cassette, byo-pdf, tdd-scaffold]

# Dependency graph
requires:
  - phase: 07-single-command-ux-layer-hooks-flags
    provides: RED-by-skip via existsSync/source-grep precedent; router.readSectionState never-throw helper; dispatchVerb shared dispatch seam
  - phase: 01-foundation
    provides: paths.ts (pensmithDataDir/sectionPlan/paperDir), state.ts (initState/initSection), frontmatter.ts, atomic-write.ts, pdf-text.ts (extractPdfText), http-mock.ts (loadCassetteFile/isOfflineMode)
provides:
  - 7 RED-by-skip test suites pinning the Phase 8 implementation contracts (global-library, style-match, intake style-producer, pymupdf, write-style, sketch, add-source)
  - 5 committed offline fixtures (Task 1, prior commit 685c05e): paperA/paperB style sample sets, byo-text.pdf, add-doi.json crossref cassette
  - STYL-04 README dual-use disclosure CONTENT CONTRACT (RED-by-skip assertion in repo-files.test.ts)
  - The DERIVE-AT-DISPLAY status-cycle + never-throw contract (LIB-05) and the PITFALL-1 path-free-fingerprint-registry contract, both encoded as Wave-0 assertions
affects: [08-01 global-library, 08-02 style-match, 08-03 pymupdf, 08-04 sketch, 08-05 intake style-producer, 08-06 add+write-style, 08-07 README STYL-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RED-by-skip via runtime URL.href import — keeps tsc --noEmit clean while the target module is unbuilt (mirrors known-bad-pass2)"
    - "Per-file D-41 ESLint env-override exemption for the 4 new isolation tests (mirrors library.test.ts/state.test.ts)"

key-files:
  created:
    - tests/global-library.test.ts
    - tests/style-match.test.ts
    - tests/intake-style-producer.test.ts
    - tests/pymupdf-shellout.test.ts
    - tests/write-style-integration.test.ts
    - tests/sketch.test.ts
    - tests/add-source.test.ts
  modified:
    - eslint.config.js
    - tests/repo-files.test.ts

key-decisions:
  - "[08-00] RED-by-skip imports the unbuilt module via a runtime URL.href specifier (await import(MOD.href)) with a local type interface — not a static '../bin/lib/X.js' path — so tsc --noEmit stays clean while X is absent (the known-bad-pass2 precedent applied to all 7 Phase-8 suites)"
  - "[08-00] Source-grep skip-predicates gate the suites whose target FILE already exists as a stub (intake.ts→buildStyleProfile+styleSamples, write.ts→styleProfilePath, sketch.ts→dispatchVerb, add.ts→extractPdfText+writeBibtex) — existsSync alone cannot detect not-yet-wired behavior (the [07-01] flagsWired precedent)"
  - "[08-00] D-41 env-override ESLint exemption added for the 4 new tests that redirect LOCALAPPDATA/XDG_DATA_HOME/HOME into a tmpdir; pymupdf + add-source omitted (they touch no D-41 chokepoint env var)"
  - "[08-00] STYL-04 README dual-use disclosure is a Wave-7 (08-07) deliverable per 08-RESEARCH wave order; Wave 0 encodes only its CONTENT CONTRACT as a RED-by-skip assertion in repo-files.test.ts (guarded on the `## Style Match` section presence) — README.md itself is NOT modified in Wave 0"
  - "[08-00] deriveLibraryStatus(folderPath, storedStatus) test asserts the DERIVED on-disk value (sectioning {done:2,total:3}, etc.) NOT the stored entry.status — the cycle-2 HIGH fix encoded as a live Wave-0 assertion; archived comes from the stored flag, intake/unknown from absent/corrupt STATE.json (never-throw)"

patterns-established:
  - "RED-by-skip URL.href import: const MOD = new URL('../bin/lib/X.js', import.meta.url); const {fn} = (await import(MOD.href)) as XMod; — typecheck-safe pre-build"
  - "Inline section PLAN.md fixtures: tests build their own .paper/sections/NN-slug/PLAN.md via initState+initSection+atomicWriteFile rather than relying on an unlisted committed fixture path (add-source.test.ts)"

requirements-completed: [LIB-01, LIB-02, LIB-03, LIB-05, ERGO-05, ERGO-06, RSCH-05, STYL-01, STYL-02, STYL-03]

# Metrics
duration: ~35min
completed: 2026-06-20
---

# Phase 8 Plan 00: Wave-0 RED scaffold (style-match + sketch + add + library + BYO PDF) Summary

**Landed the complete Phase-8 Wave-0 test contract — 7 RED-by-skip suites + 5 offline fixtures + the STYL-04 README content contract — so every later wave flips a known RED-by-skip assertion to GREEN, with the full suite staying GREEN (779 tests, 0 fail, 29 skip) and tsc + lint clean.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-06-20
- **Tasks:** 3 (Task 1 fixtures pre-committed by a prior executor in 685c05e; this run completed Tasks 2-3 + the README contract)
- **Files modified/created:** 9 (7 new test files + eslint.config.js + repo-files.test.ts)

## Accomplishments
- Encoded the LIB-05 DERIVE-AT-DISPLAY status-cycle (intake → research → outline → sectioning X/Y → compile → done → archived) + never-throw on missing/corrupt STATE.json and corrupt section PLAN.md — the cycle-2 HIGH "status stuck at intake / dead sectioning branch" fix, as a live Wave-0 assertion.
- Encoded the PITFALL-1 split: the FINGERPRINT registry carries hashes + paper identity ONLY (no "features" key, no "folderPath"/path key), while the PAPER registry DELIBERATELY retains folderPath (LIB-03) — both as negative-control assertions.
- Encoded the intake style-match PRODUCER wiring (the cross-AI-review gap): builds .paper/STYLE.json + surfaces the cross-paper-reuse notice UNCONDITIONALLY (not --yolo-gated) + opt-in gating.
- Encoded the section-state-corruption guard (Pitfall 3/A6): `add` remap appends to assigned_sources[] while leaving status + verified_against_draft_hash byte-unchanged.
- Verified the 5 offline fixtures committed in Task 1 (685c05e) are present and untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1: style/PDF/cassette fixtures** - `685c05e` (test) — *prior executor; verified present, NOT recommitted*
2. **Task 2: global-library / style-match / intake-producer / pymupdf / write-style RED suites** - `70855d3` (test)
3. **Task 3: sketch no-advance + add-source cassette-backed RED suites** - `1b0b324` (test)
4. **STYL-04 README dual-use disclosure content contract** - `9dd0372` (test)

## Files Created/Modified
- `tests/global-library.test.ts` - LIB-01/02 init+UPSERT+index-location, LIB-03 folderPath retention, LIB-05 status-cycle + never-throw (16 cases)
- `tests/style-match.test.ts` - STYL-01 deterministic pure-stats profile + 64-hex fingerprint; PITFALL-1 path-free registry; STYL-02 reuse detection
- `tests/intake-style-producer.test.ts` - STYL-01/02 PRODUCER: STYLE.json build + unconditional reuse notice + opt-in gating
- `tests/pymupdf-shellout.test.ts` - RSCH-05 null-on-failure absent-fitz degradation
- `tests/write-style-integration.test.ts` - STYL-03/Pitfall-7 voice_hint > style-match > default
- `tests/sketch.test.ts` - ERGO-05/Pitfall-6 no-advance invariant + dispatch-to-`new` delegation
- `tests/add-source.test.ts` - ERGO-06 DOI cassette hydration, RSCH-05 PDF ingest, Pitfall-3/A6 remap guard
- `eslint.config.js` - D-41 env-override exemption for the 4 new isolation tests
- `tests/repo-files.test.ts` - STYL-04 README dual-use disclosure content contract (RED-by-skip)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] D-41 ESLint chokepoint blocked the new env-override isolation tests**
- **Found during:** Task 2 (lint of the 5 new files)
- **Issue:** The D-41 `no-restricted-syntax` chokepoint bans `process.env.LOCALAPPDATA` / `XDG_DATA_HOME` outside bin/lib/paths.ts; the 4 new tests need them to redirect pensmithDataDir() into a tmpdir (the canonical library.test.ts isolation pattern).
- **Fix:** Added a scoped per-file `no-restricted-syntax: off` exemption block in eslint.config.js for the 4 affected files (global-library, style-match, intake-style-producer, write-style-integration), mirroring the existing exemption for library.test.ts/state.test.ts. pymupdf + add-source were deliberately omitted (they touch no D-41 env var).
- **Files modified:** eslint.config.js
- **Commit:** 70855d3

### Scope Note (not a deviation)

**STYL-04 README dual-use disclosure** — Per 08-RESEARCH's wave order, the README `## Style Match` section is a Wave-7 (08-07) deliverable and is NOT in this plan's `files_modified`. The orchestrator brief listed a "README dual-use disclosure content contract test." I honored both by adding the CONTENT CONTRACT as a RED-by-skip assertion in repo-files.test.ts (guarded on section presence; passes in its pending state, opens to enforce when 08-07 authors the section) WITHOUT modifying README.md — avoiding premature edits to a later wave's file and the repo-files `v0.1.0 in development`/`Phase 6` stub assertions. Commit 9dd0372.

## Known Stubs

None introduced. All 7 suites are RED-by-skip scaffolds (skip-guarded against unbuilt modules / unwired stubs), not stubs that flow empty data to a UI. They are the intended pre-implementation contract.

## Verification

- `npm test` → 779 tests, 750 pass, 0 fail, 29 skip (the 29 new RED-by-skip tests skip cleanly; the rest of the suite stays GREEN).
- `tsc --noEmit` → 0 errors (URL.href imports keep the unbuilt modules opaque to the typechecker).
- `eslint` on all 9 touched files → 0 errors.
- The 5 Task-1 fixtures exist and were NOT recommitted: tests/fixtures/style-samples/paperA/{sample-1.md,sample-2.txt}, paperB/sample-1.md, tests/fixtures/pdf/byo-text.pdf, tests/fixtures/cassettes/crossref/add-doi.json.

## Self-Check: PASSED
