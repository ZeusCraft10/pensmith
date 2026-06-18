---
phase: 06-done-export-pipeline-zero-trace-gate
plan: 01
subsystem: testing
tags: [jszip, pdf-lib, zero-trace, docx, pdf, xmp, gptzero, duckduckgo, cassettes, hash-pin, RED-scaffold]

# Dependency graph
requires:
  - phase: 05-verifier-completeness-pass-2-pass-4
    provides: "renderPass2Section markdown shape (Pass-2 table) + Pass2Result/Pass4Result types the gate + section-fixture mirror"
  - phase: 01-foundation
    provides: "http-mock.ts Cassette[] schema + loadCassetteFile + isOfflineMode; repo-files.test.ts SHA-256 byte-pin pattern; ecosystem-presence isHumanizerSkillPresent/isPandocPresent"
provides:
  - "jszip + pdf-lib runtime dependencies (slopcheck OK, no install/postinstall, pure-JS)"
  - "tests/fixtures/sample-zero-trace.docx — deterministic real-ZIP negative control (full DC+cp field set; pensmith in cp:category AND _rels/.rels)"
  - "tests/fixtures/sample-zero-trace.pdf — deterministic hand-authored real-PDF negative control (pensmith in /Info+XMP; Trace Sentinel in /Info+XMP)"
  - "Six RED test files (zero-trace, plagiarism, honesty, exporter, export-gate, humanizer-wrap) — behavioral tests RED-by-skip pending Waves 1-2; contract symbol names pinned (incl. zeroTracePdf)"
  - "DDG + GPTZero offline cassettes in Cassette[] schema under the D-25 51200-byte cap"
  - "tests/fixtures/section-pass2-unsupported/VERIFICATION.md — renderPass2Section-shaped UNSUPPORTED feed for HIGH-3 readSectionUnsupported (06-05)"
  - "references/honesty-framing.md LOCKED + SHA-256 byte-pinned; CONTRIBUTING.md drift rule"
affects: [06-02 (exporter/plagiarism/honesty/done modules turn the skip-guarded tests GREEN), 06-05 (HIGH-3 readSectionUnsupported disk-feed test)]

# Tech tracking
tech-stack:
  added: [jszip@^3.10.1, pdf-lib@^1.17.1]
  patterns: ["RED-by-skip behavioral tests (skip-guarded on existsSync of the unbuilt module) keep the full suite GREEN in Wave 0", "genuine negative-control fixtures authored INDEPENDENTLY of the scrub logic (hand-authored XML / hand-authored PDF bytes)", "non-'pensmith' sentinel token ('Trace Sentinel') in BOTH /Info AND XMP forces structural XMP removal, not literal masking", "deterministic binary fixtures (epoch ZIP dates / fixed PDF /ID + offsets) → reproducible SHA-256 byte-pins", "LOCKED copy file byte-pinned GREEN-from-creation (WN-3 static-copy)"]

key-files:
  created:
    - scripts/make-zero-trace-fixture.mjs
    - scripts/make-zero-trace-pdf-fixture.mjs
    - tests/fixtures/sample-zero-trace.docx
    - tests/fixtures/sample-zero-trace.pdf
    - tests/fixtures/section-pass2-unsupported/VERIFICATION.md
    - tests/fixtures/cassettes/duckduckgo/html-search.json
    - tests/fixtures/cassettes/gptzero/predict-text.json
    - tests/zero-trace-export.test.ts
    - tests/plagiarism.test.ts
    - tests/honesty.test.ts
    - tests/exporter.test.ts
    - tests/export-gate.test.ts
    - tests/humanizer-wrap.test.ts
    - references/honesty-framing.md
  modified:
    - package.json
    - package-lock.json
    - tests/repo-files.test.ts
    - CONTRIBUTING.md

key-decisions:
  - "PDF fixture hand-authored as raw bytes (not via pdf-lib) so it is a genuine negative control, independent of the scrub library; pdf-lib used only to validate the bytes parse"
  - "DOCX fixture XML hand-authored with varied tag forms (self-closing <Template/>, attribute-bearing <dc:subject xml:lang>) so a too-narrow patch overfit to one shape fails TEST-10"
  - "RED-by-skip stance mirrors known-bad-pass2.test.ts exactly: module-presence consistency test passes either way, behavioral tests skip-guarded — full suite stays GREEN with 0 failures"
  - "honesty-framing.md byte-pinned GREEN from creation (static copy, WN-3) — no __PENDING__ sentinel needed"
  - "slopcheck verdict for jszip + pdf-lib re-run at install time: scanned 2 packages, 2 OK"

patterns-established:
  - "Pattern: genuine offline negative-control fixtures (independent authorship + a non-target sentinel token in BOTH metadata channels) that defeat literal-masking AND too-narrow scrubs"
  - "Pattern: deterministic binary test fixtures with committed generator scripts + SHA-256 byte-pins guarding silent drift"

requirements-completed: [DONE-02, DONE-03, DONE-04, DONE-05, DONE-06, DONE-07, DONE-08, DONE-09, TEST-10]

# Metrics
duration: 11min
completed: 2026-06-18
---

# Phase 6 Plan 01: Done / Export Pipeline — Wave 0 RED Scaffold + Fixtures + Cassettes + Locked Framing + Deps Summary

**Landed the offline, Pandoc-free, PDF-engine-free RED scaffold for the whole Phase-6 export pipeline: jszip + pdf-lib deps, two genuine binary negative-control fixtures (.docx + .pdf) with a structural-removal sentinel, six skip-guarded RED test suites scanning all four export formats, the offline DDG + GPTZero cassettes, the LOCKED + byte-pinned honesty-framing copy, and the Pass-2 section feed fixture — full suite stays GREEN (681 tests, 0 fail, 19 RED-by-skip).**

## Performance

- **Duration:** 11 min
- **Started:** 2026-06-18T08:25:35Z
- **Completed:** 2026-06-18T08:36:53Z
- **Tasks:** 3
- **Files modified:** 18

## Accomplishments

- Added `jszip` + `pdf-lib` as runtime dependencies (slopcheck re-run at install: **2 OK**; confirmed neither carries an install/preinstall/postinstall script — both pure-JS).
- Built the committed real-ZIP `.docx` negative control carrying the FULL Dublin-Core + cp identifying field set, with the literal `pensmith` in `cp:category` (the narrow-patch trap) AND in the non-`.xml` entry `_rels/.rels` (the `.xml`-only-sweep trap), plus a self-closing `<Template/>` and an attribute-bearing `<dc:subject xml:lang>` — so a too-narrow `zeroTracePatch` will FAIL TEST-10.
- Built the committed hand-authored real-PDF negative control carrying `pensmith` in BOTH the `/Info` dict and the XMP stream, AND the non-`pensmith` token `Trace Sentinel` in BOTH `/Info /Author` and the XMP `<dc:creator>` — so the only passing `zeroTracePdf` is one that STRUCTURALLY removes the XMP indirect object (a literal byte-sweep would leave `Trace Sentinel` and Test D would catch it). Both fixtures are byte-deterministic and SHA-256 byte-pinned.
- Wrote six RED test files covering DONE-02..09 + TEST-10. TEST-10 scans ALL FOUR formats (`.md`, `.tex`, `.docx`, `.pdf`) offline; Test A (docx) + Test C (pdf, incl. the Trace Sentinel negative-control assertion) PASS now; Tests B/D/E/F skip pending `exporter.ts`. Behavioral tests across all six suites are RED-by-skip — 19 skips, 0 failures.
- Locked `references/honesty-framing.md` (transparency-only; `improves prose … does not promise to make output undetectable`) and byte-pinned it + both binary fixtures in `repo-files.test.ts` (3 new GREEN pins); added the CONTRIBUTING.md drift rule.

## Task Commits

Each task was committed atomically:

1. **Task 1: deps + fixtures + cassettes + Pass-2 fixture** - `e9a9fb3` (chore)
2. **Task 2: six RED test files (DONE-02..09 + TEST-10)** - `579ae29` (test)
3. **Task 3: locked honesty-framing copy + byte-pins + CONTRIBUTING rule** - `f2d4367` (feat)

**Plan metadata:** (final docs commit — this SUMMARY + STATE + ROADMAP + REQUIREMENTS)

## Files Created/Modified

- `package.json` / `package-lock.json` - added jszip + pdf-lib to dependencies
- `scripts/make-zero-trace-fixture.mjs` - deterministic JSZip generator for the .docx negative control (epoch dates, hand-authored XML)
- `scripts/make-zero-trace-pdf-fixture.mjs` - deterministic hand-authored-bytes generator for the .pdf negative control (fixed /ID + offsets; pdf-lib used only to validate parse)
- `tests/fixtures/sample-zero-trace.docx` - committed real-ZIP negative control
- `tests/fixtures/sample-zero-trace.pdf` - committed real-PDF negative control
- `tests/fixtures/section-pass2-unsupported/VERIFICATION.md` - renderPass2Section-shaped UNSUPPORTED + SUPPORTED rows (HIGH-3 feed)
- `tests/fixtures/cassettes/duckduckgo/html-search.json` - DDG HTML cassette (2 result__a anchors, 1469 B)
- `tests/fixtures/cassettes/gptzero/predict-text.json` - GPTZero v2 cassette (ai=0.82, AI_ONLY, 477 B)
- `tests/zero-trace-export.test.ts` - TEST-10 gating suite, all four formats, Test D structural-removal assertion
- `tests/plagiarism.test.ts` - DONE-02 n-gram + offline DDG + advisory-never-throws
- `tests/honesty.test.ts` - DONE-04/05 GPTZero cassette + VERBATIM framing-note assertion + pluggable selectBackend
- `tests/exporter.test.ts` - DONE-06/08 Pandoc-absent md fallback into distinct dir + bib copy
- `tests/export-gate.test.ts` - DONE-09 gate logic (issues→fire, clean→generic confirm, --yolo→skip); imports Pass2Result/Pass4Result types
- `tests/humanizer-wrap.test.ts` - DONE-03 absent-skill skip-clean banner
- `references/honesty-framing.md` - LOCKED honest-framing copy
- `tests/repo-files.test.ts` - 3 new SHA-256 byte-pins (framing + docx + pdf)
- `CONTRIBUTING.md` - "Locked copy files" section with honesty-framing lock rule + fixture drift rule

## Decisions Made

- **PDF fixture hand-authored from raw bytes**, not generated via pdf-lib, to keep it a genuine negative control (independent of the Wave-2 scrub library). pdf-lib's `PDFDocument.load()` is called only to validate the bytes parse.
- **Non-target sentinel `Trace Sentinel` placed in BOTH `/Info` and the XMP stream** so the structural-removal contract (delete the XMP indirect object) is the only passing scrub — a literal `pensmith`-only byte-sweep is provably insufficient.
- **RED-by-skip stance mirrors `known-bad-pass2.test.ts` exactly** (module-presence consistency test passes either way; behavioral tests `{ skip: !existsSync(modPath) }`). This keeps the full suite GREEN-able in Wave 0.
- **honesty-framing.md byte-pinned GREEN from creation** (static copy file, WN-3 single-source), not a runtime prompt slug, so no `__PENDING__` sentinel is used.

## Deviations from Plan

None - plan executed exactly as written. (The only judgment call was rewording the honesty-framing.md header to describe the transparency-only policy without using the literal tokens "evade/beat/defeat", so the file unambiguously contains zero detection-avoidance wording per the plan's acceptance criterion — a wording choice within the plan's instructions, not a behavioral deviation.)

## Issues Encountered

- **tsc null-safety on `zip.file(...)`:** Test A initially dereferenced `zip.file('docProps/core.xml').async()` directly; JSZip types the return as nullable, so `tsc --noEmit` flagged TS2531. Resolved by capturing the entry and asserting it exists before `.async('string')`. Caught by the typecheck gate before commit; not a runtime defect.

## Wave-0 Test Status (per plan acceptance criterion — documented stance)

- **Always-run / GREEN now (10):** cassette-existence + module-presence consistency markers (×6), humanizer machine-baseline, zero-trace Test A (docx negative control), zero-trace Test C (pdf negative control incl. Trace Sentinel).
- **RED-by-skip (19 skipped, 0 failed):** every behavioral test across the six suites — guarded on the unbuilt `bin/lib/exporter.ts`, `bin/lib/plagiarism.ts`, `bin/lib/honesty.ts`, `bin/cli/done.ts`. They un-skip and must PASS when Waves 1-2 land those modules.
- **repo-files.test.ts:** all 3 new byte-pins GREEN from creation; CF-D24 CONTRIBUTING guard still GREEN.

## Supply-Chain (threat_model T-06-01-SC obligation)

slopcheck re-run at install time on `jszip` + `pdf-lib`: **scanned 2 packages, 2 OK**. Verified via `require('<pkg>/package.json').scripts` that neither has `install`/`preinstall`/`postinstall` (jszip scripts are test/lint/build/benchmark; pdf-lib scripts are test/lint/build/release — none run on `npm install`). Both resolve under node:test. The npm postinstall warnings observed at install time were for pre-existing deps (citation-js, esbuild), NOT the two new packages.

## Verification Results

- `node --import tsx --test tests/repo-files.test.ts` — 44 pass / 0 fail (3 new pins GREEN).
- Six RED suites — 29 tests: 10 pass, 19 skip, 0 fail; Test A + Test C pass.
- `npm test` (full suite) — **681 tests, 662 pass, 0 fail, 19 skipped.**
- `npm run lint` — clean. `npm run typecheck` — clean.
- `node -e "require('jszip')"` + `node -e "require('pdf-lib')"` — both resolve.
- Both fixtures byte-deterministic across re-runs (verified by re-generating and re-hashing).

## Next Phase Readiness

- All offline, Pandoc-free, engine-free inputs Waves 1-2 need are committed: the two negative-control fixtures, the two cassettes, the locked framing copy, and the Pass-2 section feed fixture.
- Contract symbol names are pinned for Waves 1-2: `zeroTracePatch`, `zeroTracePdf`, `exportDraft({ inputPath, format, paperRoot, pandocPresent })`, `runPlagiarism` / `extractDistinctivePhrases` / `renderPlagiarismSection`, `scoreHonesty` / `renderHonestyReport` / `selectBackend`, `runDoneGate`, `runHumanizer`.
- No blockers. The 19 skip-guarded behavioral tests are the GREEN target for 06-02.

---
*Phase: 06-done-export-pipeline-zero-trace-gate*
*Completed: 2026-06-18*

## Self-Check: PASSED

All 14 created files + 3 modified files verified present on disk. All 3 task commits (e9a9fb3, 579ae29, f2d4367) verified in git log.
