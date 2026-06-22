---
phase: 10-discipline-citation-style-breadth-zotero-mcp
plan: 02
subsystem: bibliography
tags: [ris, citation-js, plugin-ris, exporter, mendeley, endnote, d-19, d-07, wave-1]

# Dependency graph
requires:
  - phase: 04-bibliography
    provides: "bin/lib/bibtex-write.ts serializer (exact structural template) + exported suffixForCollision + SourceCandidate fixtures (Vaswani/He/Doe)"
  - phase: 10-00
    provides: "tests/ris-write.test.ts RED-by-skip CITE-05 contract (TY  - JOUR / ER  - / count) loaded via .href dynamic import"
  - phase: 10-01
    provides: "bin/lib/citations.ts { Cite } re-export (D-19 chokepoint) — ris-write imports through it, not citation-js"
provides:
  - "bin/lib/ris-write.ts — writeRis(candidates, targetPath) RIS2001 serializer (RIS sibling of writeBibtex; spec:'new' for Mendeley/EndNote interop)"
  - "ExportResult.risCopied: boolean — exportDraft bundles CITATIONS.ris into the export dir alongside CITATIONS.bib"
  - "research-time .paper/CITATIONS.ris emission (symmetric with CITATIONS.bib at the same call site)"
affects: [10-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RIS serializer as a verbatim structural copy of bibtex-write.ts with a SINGLE divergence (the final cite.format('ris', {spec:'new'}) call) — same CSL intermediate, same collision loop, same citekey sort"
    - "Import the shared suffixForCollision from bibtex-write.js rather than duplicating it — one collision-encoding implementation across both serializers"
    - "Symmetric dual-artifact emission: .ris written at the SAME research call site as .bib so the exporter is a pure copy step (existsSync-guarded, never throws)"

key-files:
  created:
    - bin/lib/ris-write.ts
  modified:
    - bin/cli/research.ts
    - bin/lib/exporter.ts
    - tests/exporter.test.ts

key-decisions:
  - "ris-write.ts imports { Cite } from './citations.js' (D-19) and writes via atomicWriteFile (D-07) — same two chokepoints as bibtex-write.ts; never imports 'citation-js' directly (ESLint backstop)"
  - "spec:'new' on cite.format('ris', ...) is REQUIRED — RIS2001 TY/ER tags for Mendeley/EndNote interop (RESEARCH Pitfall 4); the RED test asserts TY  - JOUR + ER  -"
  - "Wrote .ris at research time (symmetric with .bib) so the exporter copy step mirrors bibCopied exactly — RESEARCH Open Question 1 recommendation; exporter never re-serializes"
  - "Local ExportResult test interface widened with optional bibCopied?/risCopied? so res.risCopied is typed without coupling the test to the full production interface"

patterns-established:
  - "Sibling-serializer-by-structural-copy: clone a tested serializer module, change ONLY the format call + drop the format-specific post-process, import shared helpers from the original — the canonical shape for adding an export format on a locked chokepoint"

requirements-completed: [CITE-05]

# Metrics
duration: 3min
completed: 2026-06-22
---

# Phase 10 Plan 02: RIS Export (ris-write.ts + exporter .ris bundling + research-time CITATIONS.ris) Summary

**Shipped RIS export (CITE-05) alongside the existing BibTeX path: a new `bin/lib/ris-write.ts` serializer that is a verbatim structural copy of `bibtex-write.ts` with the SOLE divergence being `cite.format('ris', { spec: 'new', format: 'text' })`, plus research-time `.paper/CITATIONS.ris` emission and an `exportDraft` copy step (`ExportResult.risCopied`) — flipping the 4 Wave-0 RED-by-skip ris-write tests to GREEN while preserving the D-19 + D-07 chokepoints and zero-trace export posture.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-06-22T05:53:47Z
- **Completed:** 2026-06-22T05:57:20Z
- **Tasks:** 2
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- **`bin/lib/ris-write.ts`** — `writeRis(candidates, targetPath)` mirrors `bibtex-write.ts` completely: identical `CslAuthor`/`CslEntry` interfaces, `parseAuthor`, `toCsl` (same hasId DOI/ISBN/arXiv drop, same `note='RETRACTED'` persistence), the same `seenKeys` collision loop, and the same `entries.sort(citekey)` for git-diff-stable output. `suffixForCollision` is **imported** from `./bibtex-write.js` (not duplicated). THE SOLE divergence: `new Cite(...).format('ris', { spec:'new', format:'text' })` (RIS2001) instead of `'bibtex'`, and the bibtex `@<type>{<autokey>,` header-rewrite regex is dropped (RIS records carry no citekey header). Empty array writes a zero-length file (parity with writeBibtex).
- **D-19 chokepoint intact:** imports `{ Cite } from './citations.js'` — never `'citation-js'`. ESLint `no-restricted-imports` passes. No new npm dep (`@citation-js/plugin-ris` is bundled in citation-js@0.7.22).
- **D-07 chokepoint intact:** final write through `atomicWriteFile`, never raw `fs.writeFile`. ESLint callee selector passes.
- **`bin/cli/research.ts`** emits `.paper/CITATIONS.ris` via `writeRis` immediately after `writeBibtex`, at the SAME call site (symmetric — RESEARCH Open Question 1). The return object and stdout banner now report the ris path. The Tier-2 placeholder passes the same empty candidates array, so `.ris` is zero-length (parity with the empty `.bib`).
- **`bin/lib/exporter.ts`** — `ExportResult` gains `risCopied: boolean`; a symmetric copy block (mirroring `bibCopied` exactly) copies `CITATIONS.ris` into the export dir, guarded by `risSrc !== risDst && existsSync(risSrc)` so it never throws when the `.ris` is absent and never overwrites the source.
- **Tests:** 4 ris-write tests flipped RED-by-skip → GREEN; 2 new exporter tests added (`.ris` copy-when-present asserts `risCopied === true` + byte match; absent-`.ris` asserts no-throw + `risCopied === false`).
- **Zero-trace posture preserved:** RIS is plain-text bibliographic data with no metadata stamp and no pensmith fingerprint; the existing zero-trace export tests stay GREEN with the `.ris` in the export dir.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create bin/lib/ris-write.ts (writeRis serializer)** — `9dc87aa` (feat)
2. **Task 2: Emit CITATIONS.ris at research time + copy it in exportDraft** — `6005bbf` (feat)

**Plan metadata:** see final `docs(10-02)` commit.

## Files Created/Modified
- `bin/lib/ris-write.ts` — NEW. `writeRis` RIS2001 serializer; structural copy of bibtex-write.ts (148 lines), sole divergence is the `format('ris', {spec:'new'})` call; imports `{ Cite }` (D-19), `atomicWriteFile` (D-07), `suffixForCollision` (shared).
- `bin/cli/research.ts` — added `writeRis` import + `risPath` + `await writeRis(candidates, risPath)` after `writeBibtex`; return object/banner report the `.ris` path.
- `bin/lib/exporter.ts` — `ExportResult.risCopied: boolean` + symmetric CITATIONS.ris copy block (existsSync-guarded).
- `tests/exporter.test.ts` — widened local `ExportResult` interface (optional `bibCopied?`/`risCopied?`); added 2 CITE-05 tests (.ris copy-present + absent-no-throw).

## Decisions Made
- **`writeRis` is a structural copy, not a refactor of `bibtex-write.ts`.** The plan and PATTERNS.md prescribe duplicating the CSL intermediate + collision loop verbatim (the two serializers share `suffixForCollision` via import, but keep their own `toCsl`/loop). This keeps each serializer's format-specific behavior isolated and the diff between them trivially auditable — the SOLE intentional difference is the format call.
- **`spec:'new'` is load-bearing.** RIS2001 (`spec:'new'`) produces the `TY  - JOUR` / `ER  -` tags the RED test asserts and that Mendeley/EndNote require (RESEARCH Pitfall 4). The default (legacy) spec would not satisfy the contract.
- **`.ris` written at research time, copied (not re-serialized) at export.** Symmetric with `.bib`; the exporter stays a pure file-copy step (RESEARCH Open Question 1).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Local exporter-test `ExportResult` interface widened to type `res.risCopied`**
- **Found during:** Task 2 (writing the new .ris exporter tests)
- **Issue:** `tests/exporter.test.ts` declares a minimal local `interface ExportResult { outputPath: string }` (it does not import the production interface). The new tests assert `res.risCopied`, which would be a TS2339 (property does not exist) under `tsc --noEmit`, breaking the clean-typecheck success criterion.
- **Fix:** Widened the local interface to `{ outputPath: string; bibCopied?: boolean; risCopied?: boolean }` (optional fields — keeps existing tests unaffected, types the new assertions).
- **Files modified:** tests/exporter.test.ts
- **Verification:** `tsc --noEmit` exits 0; the 2 new tests pass.
- **Committed in:** `6005bbf` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking, test-only typing). All production must-haves (writeRis, risCopied, research-time .ris, D-19 + D-07 chokepoints, zero-trace) were implemented exactly as specified.

## Issues Encountered
None. ESLint, tsc, build, the full test suite, and manifest validation are all green.

## Known Stubs
None — `writeRis` produces real RIS2001 output from the bundled `@citation-js/plugin-ris`; the research-time `.ris` is zero-length only because the Tier-2 placeholder aggregates zero candidates today (identical, intentional parity with the existing zero-length placeholder `.bib` — Phase 4 swaps the placeholder for real discovery and both files populate together).

## Threat Flags
None — no new network endpoints, auth paths, or trust-boundary surface. RIS is produced offline by the vetted `@citation-js/plugin-ris` through the same `toCsl()` intermediate as the tested BibTeX path; the exporter copy targets a DISTINCT export dir and never overwrites the source. All threat-register dispositions (T-10-02-01..SC, all `mitigate`) are satisfied: T-10-02-01 (vetted plugin + spec:'new', asserted in tests), T-10-02-02 (no metadata, covered by the zero-trace scan), T-10-02-03 (D-19 import + ESLint backstop), T-10-02-04 (atomicWriteFile + distinct-dir copy), T-10-02-SC (no installs).

## Next Phase Readiness
- 10-04 (downstream consumers) can rely on `.paper/CITATIONS.ris` existing alongside `.paper/CITATIONS.bib` after every `pensmith research` run, and on `exportDraft(...).risCopied` reflecting whether the `.ris` was bundled.
- The remaining 7 suite skips are the 10-03 zotero/disciplines RED-by-skip contracts (zotero-mcp injected-client used-as-source leg + disciplines 6-field schema); none are owned by this plan.

## Self-Check: PASSED

`bin/lib/ris-write.ts` exists on disk and exports `writeRis`. Both task commits (`9dc87aa`, `6005bbf`) are present in git history. `npm run check` GREEN — ESLint + tsc + build + tier-contract + 853 tests (0 fail, 7 skip) + manifest validation all pass.

---
*Phase: 10-discipline-citation-style-breadth-zotero-mcp*
*Completed: 2026-06-22*
