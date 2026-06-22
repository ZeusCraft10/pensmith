---
phase: 06-done-export-pipeline-zero-trace-gate
plan: 04
subsystem: export
tags: [zero-trace, docx, pdf, jszip, pdf-lib, xmp, pandoc, latex, export, DONE-06, DONE-07, DONE-08, TEST-10]

# Dependency graph
requires:
  - phase: 06-done-export-pipeline-zero-trace-gate
    plan: 01
    provides: "jszip + pdf-lib deps; sample-zero-trace.docx + sample-zero-trace.pdf negative-control fixtures (Trace Sentinel structural-removal sentinel); RED zero-trace + exporter test suites; pinned symbols zeroTracePatch/zeroTracePdf/exportDraft"
  - phase: 01-foundation
    provides: "atomicWriteFile (D-07 chokepoint, accepts Buffer); paperDir() (PENSMITH_PAPER_ROOT-aware); isPandocPresent() (execFileSync probe)"
provides:
  - "bin/lib/exporter.ts — zeroTracePatch (docx ZIP scrub, full field set + all-entry sweep) + zeroTracePdf (pdf /Info clear + STRUCTURAL XMP-object delete, no length-altering byte edits) + exportDraft (Pandoc shellout + md fallback + offline md->tex + bib copy into distinct export dir) + ExportFormat/ExportOptions/ExportResult"
  - "THE zero-trace contract (DONE-07/TEST-10) for ALL FOUR formats, verified OFFLINE + Pandoc-/engine-free against committed fixtures"
affects:
  - "06-05 (CLI done-orchestrator delegates to exportDraft; adds runHumanizer + runDoneGate to exporter.ts/done.ts)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "in-process structural metadata scrub as the mandatory last step of every binary export (JSZip for docx, pure-JS pdf-lib for pdf) — Pandoc/engine flags are defense-in-depth only"
    - "structural XMP removal: pdf.context.delete(metaRef) BEFORE save() because pdf-lib serializes ALL indirect objects regardless of reachability — catalog-only delete leaks the stream"
    - "deterministic offline md->tex writer so .tex is a REAL scanned artifact (not 'clean by construction') on a Pandoc-absent CI machine"
    - "distinct export dir (<paperDir>/export) so outputs never collide with source artifacts and the bib copy is never a same-path no-op"
    - "read-only post-save residual assertion (never a byte-edit) as the loud failure signal for an incomplete structural strip"

key-files:
  created:
    - bin/lib/exporter.ts
  modified:
    - tests/humanizer-wrap.test.ts

key-decisions:
  - "Binary-vs-text detection in the docx literal-sweep: skip word/media|embeddings|fonts + known binary extensions + a NUL-byte sniff, so the LIVE Pandoc docx path's binary parts are never string-corrupted (cycle-3 MEDIUM-1). CI fixture has no binary parts but the live path does."
  - "renderLatex is intentionally minimal (title + section/subsection + paragraphs with LaTeX-special escaping) — the contract is a real comment-free trace-free .tex, not full Markdown fidelity; Pandoc handles rich latex when present (then we defensively strip any %pensmith/%Generated line)."
  - "zeroTracePdf normalizes /Info dates to epoch via try/catch (dates are determinism, not identifying trace) and keeps the residual-pensmith check READ-ONLY (throws to surface an incomplete strip, never byte-edits)."
  - "[Rule 3] humanizer-wrap.test.ts skip guard tightened to require the runHumanizer EXPORT in source, not merely exporter.ts existence — exporter.ts is created in 06-04 two plans before 06-05 adds runHumanizer, so file-existence alone spuriously un-skipped + failed. runHumanizer/DONE-03 stays 06-05 scope."

requirements-completed: [DONE-06, DONE-07, DONE-08, TEST-10]

# Metrics
duration: 8min
completed: 2026-06-18
---

# Phase 6 Plan 04: Zero-Trace Export Keystone (exporter.ts) Summary

**Shipped the LOAD-BEARING zero-trace export module: `zeroTracePatch` (docx ZIP scrub of the full Dublin-Core+cp+app field set plus an all-non-binary-entry 'pensmith' sweep) and `zeroTracePdf` (pdf /Info clear + STRUCTURAL XMP-indirect-object delete with no length-altering byte edits), wired as the mandatory last step of every docx/pdf export through `exportDraft` — which also emits a real comment-free offline md→tex artifact, degrades to a markdown-only banner fallback when Pandoc/the PDF engine is absent (never throwing), and bundles CITATIONS.bib into a distinct `.paper/export/` dir. THE gating TEST-10/DONE-07 suite is GREEN offline + Pandoc-/engine-free for all four formats: Test D proves BOTH 'pensmith' AND 'Trace Sentinel' are gone and the PDF still loads.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-06-18T08:59:36Z
- **Completed:** 2026-06-18T09:07:48Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- **`zeroTracePatch` (DONE-07, docx):** loads the ZIP, blanks the FULL identifying field set in `docProps/core.xml` (`dc:creator/title/subject/description`, `cp:keywords/category/contentStatus/lastModifiedBy`) and `docProps/app.xml` (`Application/Company/Manager/Template`), epochs `dcterms:created/modified` to `1970-01-01T00:00:00Z`, with regexes tolerant of attribute-bearing AND self-closing tag forms; then sweeps EVERY non-binary entry (including the non-`.xml` `_rels/.rels`) for the literal `pensmith` while passing binary parts (media/fonts/embeddings) through untouched; writes back via `atomicWriteFile`.
- **`zeroTracePdf` (DONE-07, pdf — HIGH-C2-1):** empties `/Info` (Producer/Creator/Author/Title/Subject/Keywords) via pdf-lib setters and removes the XMP stream STRUCTURALLY — `pdf.context.delete(metaRef)` on the actual indirect object BEFORE `save()` (because pdf-lib serializes all indirect objects regardless of reachability) THEN drops the catalog `/Metadata` entry. NO length-altering byte edits; a read-only residual-`pensmith` assertion surfaces an incomplete strip loudly.
- **`exportDraft` (DONE-06 + DONE-08):** resolves a DISTINCT export dir (`<paperDir>/export`); Pandoc path (docx/pdf) shells out via `execFile` (array args, never `exec`, 60s timeout) with zero-trace metadata flags then runs the MANDATORY per-format scrub; md-only fallback + banner when Pandoc/the PDF engine is absent (never throws ENOENT); deterministic OFFLINE md→tex writer emits a real comment-free `.tex`; CITATIONS.bib copied into the export dir guarded `bibSrc !== bibDst`.
- **All four format scans GREEN offline** (Pandoc + PDF engine absent on this machine): zero-trace Tests B (docx) + D (pdf, incl. the Trace Sentinel structural-removal negative control + still-loads) + E (md) + F (real offline .tex) plus the exporter suite (md fallback into distinct dir, bib copy, deterministic no-throw).

## Task Commits

Each task was committed atomically:

1. **Task 1: zeroTracePatch + zeroTracePdf zero-trace scrubs (DONE-07/TEST-10)** — `6773da9` (feat)
2. **Task 2: exportDraft orchestration + offline md→tex writer (DONE-06/08)** — `d3ae6d1` (feat)

## Files Created/Modified

- `bin/lib/exporter.ts` (created, 475 lines) — `zeroTracePatch`, `zeroTracePdf`, `exportDraft`, `renderLatex` (offline md→tex), `writeMarkdown`, `buildPandocArgs`, `escapeLatex`, `isBinaryDocxEntry`, `blankXmlTag`, `epochDctermsTag`, and the `ExportFormat`/`ExportOptions`/`ExportResult` types.
- `tests/humanizer-wrap.test.ts` (modified) — skip-guard tightened to require the `runHumanizer` export in source (Rule 3, see Deviations).

## Decisions Made

- **Binary-vs-text detection in the docx sweep** skips `word/media|embeddings|fonts`, known binary extensions, and a NUL-byte sniff — so the LIVE Pandoc docx path (which can carry images/fonts) is never string-corrupted, addressing cycle-3 MEDIUM-1. The CI fixture has no binary parts; this is forward-protection for the live path.
- **`renderLatex` kept minimal** (title + `\section`/`\subsection` + escaped paragraphs) — the contract is a real, comment-free, trace-free `.tex` artifact, not full Markdown fidelity. When Pandoc is present the Pandoc latex path is used and any `% pensmith`/`% Generated` line is defensively stripped.
- **`/Info` dates normalized to epoch via try/catch** (determinism, not identifying trace) and the **residual-`pensmith` check kept READ-ONLY** — it throws to surface an incomplete structural strip, it never byte-edits (which would shift xref offsets + `/Length` values and corrupt the file).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Cross-plan skip-guard collision in tests/humanizer-wrap.test.ts**
- **Found during:** Task 2 (full-suite regression run)
- **Issue:** The Wave-0 (06-01) RED scaffold pinned `runHumanizer` to `bin/lib/exporter.ts` and skip-guarded `humanizer-wrap.test.ts` on `existsSync(exporter.ts)`. But the plan split adds `runHumanizer` (DONE-03) in **06-05**, while `exporter.ts` is created **here in 06-04**. The moment this plan created `exporter.ts`, the guard un-skipped the behavioral test, which then FAILED with `mod.runHumanizer is not a function` — breaking the plan's "full suite green except 06-05 RED-by-skip" criterion.
- **Fix:** Tightened the skip guard to require the `runHumanizer` export to actually exist in `exporter.ts` source (synchronous regex content check, mirroring how `export-gate.test.ts` guards on its own owner module `bin/cli/done.ts`). The test now stays RED-by-skip (its intended Wave-0 state) until 06-05 lands the wrap.
- **Scope note:** `runHumanizer`/DONE-03 is NOT implemented here — it remains 06-05 scope (06-05 Task 1 wires it together with `runDoneGate` and whole-paper Pass 4). This fix only corrects the guard predicate.
- **Files modified:** `tests/humanizer-wrap.test.ts`
- **Commit:** `d3ae6d1`

**2. [Rule 1 - Bug] Literal NUL byte written into source by the Write tool**
- **Found during:** Task 1
- **Issue:** The intended `text.includes('\x00')` NUL-byte sniff in `isBinaryDocxEntry` was stored by the editor as a literal U+0000 byte in `bin/lib/exporter.ts` (binary content in a `.ts` source file).
- **Fix:** Replaced the literal NUL with the proper `'\x00'` escape sequence (verified the file is NUL-free afterward). The logic is unchanged; this only corrected the byte representation.
- **Files modified:** `bin/lib/exporter.ts` (pre-commit; folded into the Task 1 commit)
- **Commit:** `6773da9`

## Authentication Gates

None — no auth required for offline export scrubs.

## Verification Results

- `node --import tsx --test tests/zero-trace-export.test.ts` — **6/6 GREEN** (Tests A/B/C/D/E/F; B docx scrub, D pdf structural XMP removal incl. Trace Sentinel + still-loads, E md, F real offline .tex all pass).
- `node --import tsx --test tests/exporter.test.ts` — **4/4 GREEN** (md fallback into distinct dir + Pandoc banner + no ENOENT; CITATIONS.bib copied distinct source/dest; deterministic on injected `pandocPresent=false`).
- `npm test` (full suite) — **680 tests, 676 pass, 0 fail, 4 skipped** (the 4 skips are 06-05-owned RED-by-skip: 3× `export-gate.test.ts` guarded on `bin/cli/done.ts`, 1× `humanizer-wrap.test.ts` guarded on the `runHumanizer` export).
- `npm run lint` — clean (execFile array args; atomicWriteFile/copyFile only; no banned imports).
- `tsc --noEmit` — clean.

## Known Stubs

None. The single "not available" string in `exporter.ts` is the DONE-06 markdown-only fallback banner (intentional, correct degradation behavior), not a stub.

## Next Plan Readiness

- `exportDraft({ inputPath, format, paperRoot, pandocPresent?, outputDir? })` is the entrypoint 06-05's CLI done-orchestrator delegates to (leave `outputDir` unset to use the default `<paperDir>/export`).
- `runHumanizer` + `runDoneGate` (DONE-03/DONE-09) remain for 06-05; the `humanizer-wrap.test.ts` + `export-gate.test.ts` skip guards will un-skip when 06-05 lands those symbols.
- THE zero-trace non-negotiable is now CI-gated offline for all four formats — 06-05 inherits the guarantee by delegating to `exportDraft` (per-format scrub is the mandatory last step inside it).

---
*Phase: 06-done-export-pipeline-zero-trace-gate*
*Completed: 2026-06-18*

## Self-Check: PASSED

Created file `bin/lib/exporter.ts` + SUMMARY verified present on disk. Both task commits (`6773da9`, `d3ae6d1`) verified in git log.
