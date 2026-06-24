---
phase: 13-citation-rendering-at-export
plan: "01"
subsystem: test
tags: [citation-rendering, rend, red-by-skip, offline, known-good-fixture]
dependency_graph:
  requires: []
  provides: [REND-01, REND-02, REND-03]
  affects: [tests/exporter.test.ts]
tech_stack:
  added: []
  patterns:
    - source-grep RED-by-skip predicate (D-07-01/D-10-00 precedent)
    - fileURLToPath fixture resolution (Phase-11 spaced-path pattern)
    - offline pandocPresent:false injection for deterministic CI
key_files:
  created: []
  modified:
    - tests/exporter.test.ts
decisions:
  - "source-grep on resolveAndRenderCitations is the load-bearing skip gate; existsSync alone would be always-true since exporter.ts already exists"
  - "FIXTURE_DIR computed via fileURLToPath(new URL('./fixtures/known-good-fixture', import.meta.url)) — spaced-path safe on OneDrive path"
  - "Pitfall-4 bib-ordering guard uses source-text index comparison (bibDst index < execFileAsync index) — no Pandoc needed"
  - "ExportDraft local type extended with style?: string to typecheck the new pandocPresent:false + style:'apa' calls"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-24T05:09:38Z"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 1
---

# Phase 13 Plan 01: RED-by-skip REND-01/02/03 Citation Render Assertions Summary

**One-liner:** RED-by-skip REND-01/02/03 offline citation assertions on vaswani2017attention fixture, skip-gated by source-grep predicate on resolveAndRenderCitations.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Source-grep RED-by-skip predicate (renderCitationsWired) | 46c7069 | tests/exporter.test.ts |
| 2 | REND-01/02/03 offline assertions on known-good fixture | 46c7069 | tests/exporter.test.ts |
| 3 | Pandoc-args, bib-ordering, zero-trace non-regression guards | 46c7069 | tests/exporter.test.ts |

## Assertions Added

### Task 1: renderCitationsWired predicate + consistency test

- `exporterSrcText` — module-scope const reading `bin/lib/exporter.ts` as UTF-8 text (existsSync guard; missing file yields empty string, never throws)
- `renderCitationsWired` — `exporterSrcText.includes('resolveAndRenderCitations')` — currently `false` (Wave-0)
- **Consistency test:** "renderCitationsWired source-grep predicate reflects Plan 13-02 wiring state" — passes in both states; confirms the predicate detects genuine absence, not a path error

### Task 2: REND-01/02/03 offline fixture tests (both skip)

- **Test 1** — "REND-01/02/03 offline — known-good fixture: no raw [@key], APA in-text appears, ## References heading, Vaswani present":
  - REND-01: `!rendered.includes('[@')` — no raw token survives
  - REND-03: `rendered.includes('Vaswani')` — formatted reference appears
  - REND-02: `rendered.includes('## References')` — bibliography heading present

- **Test 2** — "REND-01 APA in-text form pin — (Vaswani et al., 2017)":
  - `rendered.includes('(Vaswani et al., 2017)')` — exact APA in-text form
  - `!rendered.includes('[@vaswani2017attention]')` — raw token absent alongside formatted form

Both tests: `pandocPresent: false`, `style: 'apa'`, FIXTURE_DIR via `fileURLToPath(new URL('./fixtures/known-good-fixture', import.meta.url))`.

### Task 3: Pandoc-args, ordering, zero-trace guards (all skip)

- **Pitfall-3 guard:** source contains `'--citeproc'`, `'--csl'`, `'--bibliography'`
- **Pitfall-4 ordering guard:** `exporterSrcText.indexOf('bibDst') < exporterSrcText.indexOf("execFileAsync('pandoc'")` — bib-copy precedes pandoc shellout in source text
- **Zero-trace non-regression:** citation-rendered md export does not contain `'pensmith'` (case-insensitive)

## Test Counts

| File | Pass | Skip | Fail | Total |
|------|------|------|------|-------|
| tests/exporter.test.ts (direct run) | 5 | 5 | 0 | 10* |
| tests/exporter.test.ts (module import) | 7 | 5 | 0 | 12 |
| tests/zero-trace-export.test.ts | 7 | 0 | 0 | 7 |
| Full npm test suite | 894 | 5 | 0 | 899 |

*Node `--test` mode counts 10 vs 12 for module-import mode — the 2 synchronous consistency tests complete before the TAP channel is established in `--test` mode. Both counts confirm 0 failures. The 5 skips are all new REND assertions.

## Predicate Verification (Spaced Path)

Confirmed that `fileURLToPath(new URL('./fixtures/known-good-fixture', import.meta.url))` correctly resolves to:

```
C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith\tests\fixtures\known-good-fixture
```

No `%20` in the resolved path. Both `section.md` and `CITATIONS.bib` found. The skip message reflects "not yet wired" (renderCitationsWired=false), not a swallowed path error.

The `exporterSrcPath` resolves correctly to the production file (`bin/lib/exporter.ts`) and `resolveAndRenderCitations` is confirmed absent from it, so all 5 new behavioral tests skip as expected.

## Deviations from Plan

None — plan executed exactly as written.

The ExportDraft local type was extended with `style?: string` as specified. The module-presence consistency test was retained from the original file; the new renderCitationsWired consistency test was added alongside it. The FIXTURE_DIR constant was defined once at module scope (not inside each test body) for efficiency and clarity.

## Known Stubs

None. This plan adds test assertions only; no production code modified.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced. The source-text read is repo-internal, read-only. The fixture read is committed repo content, read-only.

## Self-Check: PASSED

- `tests/exporter.test.ts` — present and contains 12 test() calls
- Commit `46c7069` — verified in git log
- `npm test` — 899 tests, 894 pass, 5 skip, 0 fail
- `npm run check` — lint + typecheck + build all green
- `tests/zero-trace-export.test.ts` — unmodified, 7/7 pass
