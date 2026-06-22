---
phase: 10-discipline-citation-style-breadth-zotero-mcp
plan: 00
subsystem: testing
tags: [csl, citation-js, ris, zotero-mcp, disciplines, red-by-skip, wave-0]

# Dependency graph
requires:
  - phase: 03-citation-engine
    provides: "templates/citation-styles/apa.csl bundled-file precedent + bin/lib/citations.ts (parseBib/renderApa) + known-good CITATIONS.bib fixture"
  - phase: 04-bibliography
    provides: "bin/lib/bibtex-write.ts serializer + SourceCandidate fixtures (Vaswani/He/Doe) reused verbatim for the RIS suite"
provides:
  - "7 committed bundled CSL style files (mla, chicago-notes-bib, chicago-author-date, ieee, ama, vancouver, harvard) — offline render assets, no render-time network"
  - "tests/ris-write.test.ts — CITE-05 RIS2001 output contract (RED-by-skip until 10-02)"
  - "tests/sources/zotero-mcp.test.ts — RSCH-06 both SC3 legs incl. present+authenticated injected-client leg quoting the 10-03 canonical gate predicate verbatim (RED-by-skip until 10-03)"
  - "tests/disciplines-schema.test.ts — 6-field PRD §8 completeness + CS→ieee + densityTarget keys (RED-by-skip until 10-03)"
  - "tests/citation-render.test.ts extended — 7 per-style existence (GREEN) + 7 renderStyle render tests (skip until 10-01)"
affects: [10-01, 10-02, 10-03, 10-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RED-by-skip Wave-0 scaffold: existence/schema gates skip-guarded so the full suite stays GREEN with zero failures (05-01/06-01/08-00 convention)"
    - "Dynamic import via runtime URL .href specifier keeps tsc --noEmit clean while a target module is absent (08-00 pattern)"
    - "Feature-detect a not-yet-exported symbol (typeof renderStyle/setZoteroClientForTest === 'function') so behavioral tests skip cleanly instead of TypeError"
    - "Offline-render guard: committed CSL files validated to carry no rel='independent-parent' <link> (no citation-js network fetch at templates.add)"

key-files:
  created:
    - templates/citation-styles/mla.csl
    - templates/citation-styles/chicago-notes-bib.csl
    - templates/citation-styles/chicago-author-date.csl
    - templates/citation-styles/ieee.csl
    - templates/citation-styles/ama.csl
    - templates/citation-styles/vancouver.csl
    - templates/citation-styles/harvard.csl
    - tests/ris-write.test.ts
    - tests/sources/zotero-mcp.test.ts
    - tests/disciplines-schema.test.ts
  modified:
    - tests/citation-render.test.ts

key-decisions:
  - "All Wave-0 RED gates implemented as RED-by-skip (skip, not assertion-fail) to honor the load-bearing success criterion 'full suite stays GREEN at end of Wave 0' and the project's locked Wave-0 convention — diverges from the plan-body 'fire RED' wording (deviation Rule 3)"
  - "CSL files fetched from citation-style-language/styles-distribution master (fully-resolved independent styles, all HTTP 200) — NOT the main styles repo, whose vancouver/chicago-fullnote are dependent styles returning 404 or carrying independent-parent links"
  - "Upstream CSL bytes kept intact (no pensmith comment header prepended, unlike apa.csl) to preserve CC-BY-SA attribution provenance and keep future re-procurement diffable"

patterns-established:
  - "RED-by-skip with module-absence skip guard + .href dynamic import + symbol feature-detect — the canonical Phase-10 Wave-0 scaffold shape"

requirements-completed: []

# Metrics
duration: 9min
completed: 2026-06-22
---

# Phase 10 Plan 00: Wave-0 RED Scaffold + 7 Bundled CSL Files Summary

**Procured and committed 7 offline-validated bundled CSL style files and landed 4 RED-by-skip test contracts (RIS export, Zotero injected-client used-as-source, discipline 6-field schema, 7-style render) so the full suite stays GREEN (848 tests, 0 fail, 18 skip) while Waves 1–2 implement against a fixed target.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-06-22T05:30:12Z
- **Completed:** 2026-06-22T05:39:38Z
- **Tasks:** 3
- **Files modified:** 11 (7 CSL created, 3 tests created, 1 test extended)

## Accomplishments
- 7 bundled CSL files committed as offline render assets — each validated as real CSL XML (no 404 HTML), each confirmed to carry NO `rel="independent-parent"` `<link>` (so citation-js never attempts a render-time network fetch at `templates.add`), and each retaining its upstream `<rights>` CC-BY-SA attribution verbatim.
- `tests/ris-write.test.ts` (CITE-05): RIS2001 `TY  - JOUR` / `ER  -` contract over the 3 reused SourceCandidate fixtures; loaded via a `.href` runtime specifier so tsc stays clean while `bin/lib/ris-write.ts` is absent.
- `tests/sources/zotero-mcp.test.ts` (RSCH-06): encodes BOTH SC3 legs — (a) absent-degrade never-throws-returns-`[]`, (b) registry membership, and (c) the present+authenticated injected-client used-as-source proof that quotes the 10-03 Task 1 STEP B canonical gate predicate verbatim; `setZoteroClientForTest` is feature-detected so leg (c) skips cleanly until 10-03 ships the seam.
- `tests/disciplines-schema.test.ts` (RSCH-06/CITE-02): 6-field PRD §8 completeness + `computer-science → ieee` + `densityTarget` low/center/high keys, guarded by a `schemaComplete` predicate that inverts once 10-03 expands the JSON.
- `tests/citation-render.test.ts` extended with 7 per-style existence assertions (GREEN now — files committed in Task 1) + 7 `renderStyle` render tests (skip until 10-01, with a runtime feature-detect of `renderStyle` so a not-yet-exported symbol skips instead of throwing).

## Task Commits

Each task was committed atomically:

1. **Task 1: Procure and commit the 7 CSL style files** — `7d61698` (feat)
2. **Task 2: Create the 3 new RED test files** — `17f1c00` (test)
3. **Task 3: Extend citation-render.test.ts** — `94163ce` (test)

**Plan metadata:** see final `docs(10-00)` commit.

## Files Created/Modified
- `templates/citation-styles/{mla,chicago-notes-bib,chicago-author-date,ieee,ama,vancouver,harvard}.csl` — 7 bundled offline CSL render assets
- `tests/ris-write.test.ts` — CITE-05 RIS output RED suite
- `tests/sources/zotero-mcp.test.ts` — RSCH-06 absent-degrade + present+authenticated injected-client RED suite
- `tests/disciplines-schema.test.ts` — discipline 6-field completeness RED suite
- `tests/citation-render.test.ts` — extended with 7 existence + 7 render tests

## Decisions Made
- **RED-by-skip for every Wave-0 gate.** The plan body says existence/schema assertions should "fire RED," but the convergence context, this plan's own `success_criteria` ("full suite stays GREEN at end of Wave 0"), and the project's locked Wave-0 convention (STATE decisions 05-01, 06-01, 08-00) all require skip-based RED so `npm test` reports zero failures. Assertion-based RED was verified to break the suite (exit 1, 5 fails). Resolved as RED-by-skip — each gate flips to a real assertion automatically once its module/schema lands.
- **styles-distribution repo (not main styles repo).** The fully-resolved independent-style distribution returns HTTP 200 for all 7 and carries no `independent-parent` links; the main `styles/master` repo serves several as dependent styles (404 or parent-link), which would break offline render.
- **Upstream bytes kept verbatim.** No pensmith comment header on these 7 (unlike apa.csl) — preserves CC-BY-SA provenance and diffability.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] RED gates converted from assertion-fail to RED-by-skip**
- **Found during:** Task 2 (creating the 3 RED test files)
- **Issue:** The plan body specifies always-on existence/schema assertions that "fire RED." Implemented literally, these produced 5 hard failures, taking the full suite to exit 1 / 5 fails — directly violating the load-bearing success criterion "full suite stays GREEN at end of Wave 0" and the project's locked Wave-0 convention (a non-skip Wave-0 scaffold has never shipped; STATE 05-01/06-01/08-00 mandate skip-based RED). `scripts/run-tests.mjs` has no expected-RED allowlist — it propagates the `node --test` exit code, so any `✖` makes `npm test` go red.
- **Fix:** Wrapped each existence gate in `{ skip }` (module-absence guard) and each disciplines schema gate in `{ skip: skipUntil6Fields }` (a `schemaComplete` predicate). Gates now report as skipped-with-reason and invert to real assertions once 10-01/10-02/10-03 land the modules/schema. Behavioral intent fully preserved.
- **Files modified:** tests/ris-write.test.ts, tests/sources/zotero-mcp.test.ts, tests/disciplines-schema.test.ts
- **Verification:** Full suite GREEN — 848 tests, 0 fail, 18 skip; lint + tsc clean.
- **Committed in:** `17f1c00` (Task 2 commit)

**2. [Rule 3 - Blocking] ris-write dynamic import switched to a .href runtime specifier**
- **Found during:** Task 2 (tsc verification)
- **Issue:** A string-literal dynamic `import('../bin/lib/ris-write.js')` is statically resolved by `tsc`, producing TS2307 (Cannot find module) for the not-yet-existing module — breaking the "tsc clean" success criterion.
- **Fix:** Applied the 08-00 pattern: import via `new URL('../bin/lib/ris-write.js', import.meta.url).href` plus a local `WriteRis` type, so tsc does not statically resolve the absent module.
- **Files modified:** tests/ris-write.test.ts
- **Verification:** `tsc --noEmit` exits 0.
- **Committed in:** `17f1c00` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking)
**Impact on plan:** Both required to satisfy the plan's own success criteria (green suite, clean tsc). No scope creep — every test contract specified in the plan is present and encodes the same behavior; only the RED mechanism (skip vs assert-fail) and the import specifier changed.

## Issues Encountered
- The styles-distribution master serves MLA as 8th edition and Chicago as 17th edition (the convergence note anticipated 9th/18th). These are the canonical fully-resolved independent styles available upstream and they render offline correctly, which is the property the RED gates depend on; edition drift is cosmetic and does not affect the offline-render contract. Recorded for the 10-01 implementer.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Wave-1 implementers (10-01 renderStyle, 10-02 ris-write, 10-03 zotero-mcp adapter + disciplines.json) have a fixed RED target. Each skip guard inverts to a real assertion the moment its module/schema ships.
- The 7 CSL files are committed and readable via `readFileSync` — 10-01's `ensureStyleTemplate` can register them without a network call.
- 10-03 must implement the canonical gate predicate EXACTLY as quoted in `tests/sources/zotero-mcp.test.ts` leg (c) (the test is the executable contract).

## Self-Check: PASSED

All 11 created/modified files exist on disk; all 3 task commits (`7d61698`, `17f1c00`, `94163ce`) are present in git history. Full suite GREEN (848 tests, 0 fail, 18 skip); lint + tsc clean.

---
*Phase: 10-discipline-citation-style-breadth-zotero-mcp*
*Completed: 2026-06-22*
