---
phase: 08-style-match-sketch-add-library-byo-pdf-polish
plan: 04
subsystem: api
tags: [add-source, crossref, byo-pdf, pdf-parse, sketch, remap, citty, citation-js, cassette]

# Dependency graph
requires:
  - phase: 08-style-match-sketch-add-library-byo-pdf-polish
    plan: 00
    provides: tests/add-source.test.ts + tests/sketch.test.ts RED-by-skip contracts; add-doi.json crossref cassette; byo-text.pdf fixture
  - phase: 08-style-match-sketch-add-library-byo-pdf-polish
    plan: 01
    provides: list/open promotion precedent + dispatchVerb shared dispatch seam (REAL_VERB_LOADERS edit point)
  - phase: 08-style-match-sketch-add-library-byo-pdf-polish
    plan: 03
    provides: extractPdfText pymupdf fallback (the BYO-PDF ingest path routes through it)
  - phase: 01-foundation
    provides: crossref adapter, http.ts D-06 chokepoint, bibtex-write/citekey, frontmatter updateFrontmatter, atomic-write, lock, doi normalize/verify, prompts ask(), paths
provides:
  - bin/cli/add.ts — mid-paper DOI/PDF/URL ingestion (writeBibtex) + assigned_sources-only remap gate
  - bin/cli/sketch.ts — Socratic thesis discovery with the no-advance-until-confirm invariant + dispatch-to-`new`
  - intakeCommand OPTIONAL --thesis seed (Open-Q2; not a new verb)
  - loadCassetteDir(adapter) — merge every cassette in an adapter dir (offline multi-cassette resolution)
  - parseWithRetry — bounded retry around pdf-parse@1.1.1 transient PDF.js lexer faults
affects: [08-05 intake-style-producer, 08-06 write-style, 08-07 README STYL-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thin-orchestrator CLI verb (compile.ts shape): detect input type → compose existing chokepoints → stdout-only → return {ok}"
    - "Injectable test seams on an interactive verb (thesis / confirm / __dispatch) so the Socratic loop + gate + dispatch are observable without a live TTY or the full `new` pipeline"
    - "assigned_sources-only frontmatter remap via updateFrontmatter inside withLock + atomicWriteFile — protected fields (status, verified_against_draft_hash) byte-untouched"
    - "Bounded retry over a flaky third-party parser whose failure is transient event-loop-scheduling state, NOT input-dependent (setImmediate tick between attempts)"

key-files:
  created:
    - bin/cli/add.ts
    - bin/cli/sketch.ts
  modified:
    - bin/cli/intake.ts
    - bin/pensmith.ts
    - bin/lib/http-mock.ts
    - bin/lib/sources/crossref.ts
    - bin/lib/pdf-text.ts

key-decisions:
  - "[08-04] ask() uses `kind:` (not the PATTERNS examples' `type:`) per bin/lib/prompts/schema.ts; the answer is a discriminated union read as `answer.kind === 'confirm' ? answer.value : false` (the done.ts export-confirm precedent)"
  - "[08-04] remap targets a single section when --section/--slug are supplied (the add-source.test.ts shape), else iterates every section from loadState().sections; remap fires on --remap OR (not --yolo AND confirm) so a --yolo run can still remap explicitly without a prompt"
  - "[08-04] sketch exposes injectable thesis/confirm/__dispatch seams matching the locked Wave-0 test; --confirm:false declines WITHOUT creating any state (no-advance), confirm dispatches `new` via the injected spy or the real dispatchVerb wrapper"
  - "[08-04] intake gains an OPTIONAL --thesis seed (Open-Q2) that pre-fills the Tier-2 placeholder — NOT a 17th verb; sketch dispatches `new {thesis}` so the thesis is not dropped"
  - "[08-04] add promotes add+sketch in REAL_VERB_LOADERS only; UX02_VERBS stays length 16 (both verbs were already members); buildSubCommands auto-registers"

patterns-established:
  - "loadCassetteDir(adapter): merge all <adapter> cassette files for offline path-match — lets a DOI/query live in any committed cassette, not one hard-coded basename"
  - "parseWithRetry: a bounded (3x) retry yielding a setImmediate tick between attempts recovers pdf-parse@1.1.1's transient PDF.js global-state lexer faults; the deterministic debug-shim ENOENT is never retried"

requirements-completed: [ERGO-05, ERGO-06, RSCH-05]

# Metrics
duration: ~55min
completed: 2026-06-20
---

# Phase 8 Plan 04: `add <doi|pdf|url>` + `sketch` verbs Summary

**Promoted `add` (mid-paper DOI/PDF/URL ingestion → Crossref hydrate → writeBibtex → assigned_sources-only remap gate) and `sketch` (Socratic thesis discovery with a no-advance-until-confirm invariant that dispatches `new` with the thesis seed) from Phase-2 stubs to real thin-orchestrator verbs, flipping both Wave-0 RED-by-skip suites GREEN while keeping the 16-verb bijection intact.**

## Performance

- **Duration:** ~55 min
- **Completed:** 2026-06-20
- **Tasks:** 2 (both `type=auto`)
- **Files created/modified:** 7 (2 new verbs + 5 modified)

## Accomplishments
- **`add` (ERGO-06 + RSCH-05b):** DOI → `crossrefFetchById(normalizeDoi)`; PDF → `extractPdfText` (pdf-parse → pymupdf fallback, 08-03) → title heuristic → `crossrefSearch`; URL → `httpFetch` (D-06, SSRF-safe) sniffing Content-Type (PDF bytes → PDF path; HTML → `<meta>` DOI scrape → retry as DOI). Hydrated candidate is written to `.paper/CITATIONS.bib` via `writeBibtex` (D-19 citation-js chokepoint) and `verifyDoi` runs at add-time (a 404 warns but still adds — the Pass-1 verifier blocks compile on FABRICATED).
- **assigned_sources-only remap (Pitfall 3 / A6):** `remapSections` appends the citekey to each section PLAN.md `assigned_sources[]` via `updateFrontmatter` inside `withLock` + `atomicWriteFile`, leaving `status` and `verified_against_draft_hash` byte-unchanged — a verified section stays verified.
- **`sketch` (ERGO-05):** a Socratic text loop synthesizes a candidate thesis; the no-advance invariant (Pitfall 6) is enforced — NO `.paper/` / STATE.json / LIBRARY.json before confirm. On confirm it dispatches the existing `new` verb with the thesis seed (no self-`initState`).
- **REAL_VERB_LOADERS promotion:** `add` + `sketch` registered (single line each); UX02_VERBS stays length 16 (no 17th verb).

## Task Commits

Each task was committed atomically:

1. **Task 1: add.ts DOI/PDF/URL ingestion + remap gate** - `46c6b24` (feat)
2. **Task 2: sketch.ts Socratic loop + intake --thesis + REAL_VERB_LOADERS** - `137f445` (feat)

## Files Created/Modified
- `bin/cli/add.ts` (new) — `addCommand`; type detection, Crossref/PDF/URL hydration, writeBibtex, verifyDoi, single/all-section remap gate.
- `bin/cli/sketch.ts` (new) — `sketchCommand`; Socratic loop, no-advance invariant, confirm gate, dispatch-to-`new`; injectable thesis/confirm/__dispatch seams.
- `bin/cli/intake.ts` (modified) — OPTIONAL `--thesis` seed pre-fills the Tier-2 intake placeholder (Open-Q2).
- `bin/pensmith.ts` (modified) — `add` + `sketch` added to REAL_VERB_LOADERS.
- `bin/lib/http-mock.ts` (modified) — new `loadCassetteDir(adapter)` merger.
- `bin/lib/sources/crossref.ts` (modified) — offline `search`/`fetchById` scan the full cassette dir (resolves add-doi.json).
- `bin/lib/pdf-text.ts` (modified) — `parseWithRetry` wraps pdf-parse against transient PDF.js lexer faults.

## Decisions Made
- ask() uses `kind:` per the real prompt schema (the PATTERNS examples' `type:` were wrong); answer read via the discriminated union.
- remap targets one section when `--section/--slug` are passed (test shape), else all sections from STATE.json; fires on `--remap` OR (not `--yolo` AND confirm).
- intake gains an OPTIONAL `--thesis` seed (Open-Q2) — not a new verb; sketch forwards the thesis so it is not dropped.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Crossref offline path could not serve the committed add-doi.json cassette**
- **Found during:** Task 1
- **Issue:** The crossref adapter's offline path hard-codes `loadCassetteFile('crossref', 'works-attention')` (the Attention-Is-All-You-Need payload). The ERGO-06 DOI under test (`10.1038/nphys1170`) lives in the separately-committed `add-doi.json`, so `add <doi>` would have hydrated the wrong work — the test asserts a photosynthesis/2009 title, which `works-attention` cannot satisfy.
- **Fix:** Added `loadCassetteDir(adapter)` to http-mock.ts (merges every cassette JSON in the adapter dir) and switched crossref's offline `search`/`fetchById` to scan the merged set via direct path-match. Existing `works-attention` lookups are unaffected (still found in the dir); `add-doi.json`'s `/works/10.1038/nphys1170` now resolves.
- **Files modified:** bin/lib/http-mock.ts, bin/lib/sources/crossref.ts
- **Verification:** add-source.test.ts ERGO-06 GREEN; full suite (incl. http-cache.test.ts which uses the separate MockAgent path) unaffected — 776 pass.
- **Committed in:** 46c6b24 (Task 1 commit)

**2. [Rule 1 - Bug] pdf-parse@1.1.1 intermittently rejects the BYO-PDF with a transient PDF.js lexer fault**
- **Found during:** Task 1 (RSCH-05 PDF ingest)
- **Issue:** `extractPdfText` resolves with full text on a cold first call, but when the event loop has prior async activity (the common case — STATE.json was just loaded by the test's `mkProjectWithSection`), pdf-parse's 2018-fork PDF.js content-stream lexer intermittently rejects with `FormatError` ("Command token too long: 128" / "Invalid number" / "bad XRef entry"). Bisection proved the failure is transient event-loop-scheduling state, NOT input-dependent: the SAME bytes parse cleanly on the very next tick (try1 fails, try2 after a `setImmediate` always succeeds, 5/5 runs). This is exactly the "pdf-parse fails" condition RSCH-05b's fallback contract names — but pymupdf is absent in CI, so a bare fall-through yields no title and no CITATIONS.bib entry.
- **Fix:** Added `parseWithRetry` in pdf-text.ts — a bounded (3x) retry that yields a `setImmediate` tick between attempts so PDF.js re-runs from a clean scheduling state. The deterministic debug-shim ENOENT (Pitfall #1) is never retried (rethrown immediately). All prior invariants preserved (bytes-only contract, sub-path import, image-only WARN, pymupdf fallback, last-error rethrow on genuine failure).
- **Files modified:** bin/lib/pdf-text.ts
- **Verification:** add-source.test.ts RSCH-05 GREEN (5/5 stable); pymupdf-shellout.test.ts still GREEN (it only reads the fixture bytes, never parses).
- **Committed in:** 46c6b24 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes were prerequisites for the two new verbs to function against the committed Wave-0 fixtures — the cassette merge resolves the ERGO-06 DOI, the retry stabilizes the RSCH-05 PDF ingest. No scope creep; no chokepoint weakened (no new ESLint exemptions; both fixes live inside the existing chokepoint modules).

## Issues Encountered
- The PATTERNS examples used `ask({ type: 'confirm' })`, but the real prompt schema (bin/lib/prompts/schema.ts) and every existing caller use `ask({ kind: 'confirm' })`. Followed the real API + the done.ts precedent.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `add` and `sketch` are live verbs; 08-05 (intake style-producer) and 08-06 (write-style) remain RED-by-skip and are unaffected.
- The BYO-PDF ingest path now exercises extractPdfText's full retry → pymupdf-fallback chain, completing the RSCH-05b ingestion clause that 08-03 left open.

## Known Stubs
None introduced. Both verbs are complete working implementations composing existing chokepoints.

## Self-Check: PASSED

- FOUND: bin/cli/add.ts
- FOUND: bin/cli/sketch.ts
- FOUND: .planning/phases/08-style-match-sketch-add-library-byo-pdf-polish/08-04-SUMMARY.md
- FOUND commit: 46c6b24 (Task 1)
- FOUND commit: 137f445 (Task 2)

---
*Phase: 08-style-match-sketch-add-library-byo-pdf-polish*
*Completed: 2026-06-20*
