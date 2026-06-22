---
phase: 08-style-match-sketch-add-library-byo-pdf-polish
plan: 03
subsystem: pdf-ingestion
tags: [pymupdf, pdf-parse, shellout, graceful-degradation, byo-pdf, rsch-05, security-execfile]

# Dependency graph
requires:
  - phase: 08-style-match-sketch-add-library-byo-pdf-polish
    plan: 00
    provides: tests/pymupdf-shellout.test.ts RED-by-skip contract + tests/fixtures/pdf/byo-text.pdf
  - phase: 01-foundation
    provides: bin/lib/pdf-text.ts (extractPdfText chokepoint, image-only heuristic), bin/lib/atomic-write.ts (D-07 write chokepoint)
provides:
  - bin/lib/pymupdf-shellout.ts (pymupdfShellout — python3 fitz subprocess wrapper, graceful-absent)
  - extractPdfText lazy pymupdf fallback in the image-only near-empty branch (RSCH-05b)
  - pdf-parse@1.1.1 exact-pin version-drift guard (T-08-03-04) in repo-files.test.ts
affects: [08-06 add (PDF ingest routes through extractPdfText which now reaches the fallback)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Graceful-absent subprocess: execFile arg array (no shell string) + JSON.stringify-embedded internal tmpfile path; ALL errors caught -> null, never throws"
    - "Lazy import of the child_process module inside the cold (image-only) branch so the subprocess surface is not loaded on every PDF (T-08-03-03)"
    - "Untrusted bytes -> tmpfile written through the D-07 atomicWriteFile chokepoint (direct fs.writeFile banned outside atomic-write.ts)"

key-files:
  created:
    - bin/lib/pymupdf-shellout.ts
  modified:
    - bin/lib/pdf-text.ts
    - tests/repo-files.test.ts

key-decisions:
  - "[08-03] pymupdfShellout honors a PENSMITH_PYTHON env override (default python3) — the locked Wave-0 RED test (08-00) forces the ENOENT/null path by pointing PENSMITH_PYTHON at a nonexistent binary; the literal plan/PATTERNS action hardcoded 'python3', but the locked test contract is load-bearing so the override is the resolved interpreter source"
  - "[08-03] tmpfile bytes written via atomicWriteFile (D-07 chokepoint) not fs.promises.writeFile — the plan's literal action used direct fs.writeFile which the D-07 ESLint chokepoint bans outside bin/lib/atomic-write.ts; routing through the sanctioned chokepoint is correct-by-construction and avoids weakening the chokepoint with a new per-file exemption"
  - "[08-03] pdf-parse pin guard asserts BOTH the declared package.json pin (literal '1.1.1', no range) AND the installed require('pdf-parse/package.json').version — a lockfile refresh that drifts either surface is the threat (T-08-03-04); installed-only would miss a stale lockfile, declared-only would miss a drifted node_modules"
  - "[08-03] fallback gate is fallbackText non-null AND >=IMAGE_ONLY_TEXT_THRESHOLD (50) non-whitespace chars — a non-null-but-still-near-empty PyMuPDF result falls through to the same WARN+degrade path as a null result, so a partially-failing fitz never returns garbage that masks the image-only signal"

requirements-partial: [RSCH-05b]
requirements-completed: []

# Metrics
duration: ~12min
completed: 2026-06-20
---

# Phase 8 Plan 03: pymupdf shellout + extractPdfText image-only fallback (RSCH-05b) Summary

**Added `bin/lib/pymupdfShellout` — a graceful-absent python3 `fitz` subprocess wrapper (execFile arg array, no shell-injection surface, returns null on ANY failure, never throws) — and wired it as a LAZY fallback into the `extractPdfText` image-only branch, so scanned/image-only PDFs get a higher-fidelity extraction attempt while the PDF stays fully usable when PyMuPDF is absent (the path THIS machine + CI exercise). pdf-parse is now locked exact at 1.1.1 by a dual-surface version-drift guard.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-06-20
- **Tasks:** 2 (both `type=auto`; Task 1 `tdd=true`)
- **Files created/modified:** 3 (1 new + 2 modified)

## Accomplishments

- **pymupdfShellout (Task 1):** Flipped the 08-00 RED-by-skip `tests/pymupdf-shellout.test.ts` to GREEN. The wrapper writes the untrusted PDF bytes to an internally-generated tmpfile, shells out to `<python> -c "import fitz; ..."` via `execFile` with an ARGS ARRAY, and returns the extracted text — or `null` on ANY subprocess failure (interpreter absent/ENOENT, `import fitz` non-zero exit, 15s timeout, empty output). Never throws.
- **Lazy fallback wiring (Task 2):** Extended `extractPdfText` so the `isImageOnlyResult` near-empty branch now lazily imports `pymupdf-shellout` and uses its text iff it clears the 50-non-whitespace-char floor; otherwise it emits a single WARN and returns the original near-empty pdf-parse text (graceful degradation). The fallback runs ONLY in the image-only branch — healthy PDFs never spawn a subprocess.
- **pdf-parse pin guard (Task 2):** Added the T-08-03-04 version-drift guard to `repo-files.test.ts` asserting pdf-parse is pinned exact 1.1.1 in BOTH the declared `package.json` dependency and the installed `require('pdf-parse/package.json').version`.

## Task Commits

1. **Task 1: pymupdfShellout graceful-absent subprocess wrapper** — `10aa6e8` (feat)
2. **Task 2: lazy pymupdf fallback in extractPdfText + pdf-parse@1.1.1 pin guard** — `8cb3cc7` (feat)

## Files Created/Modified

- `bin/lib/pymupdf-shellout.ts` (new) — `pymupdfShellout(buf): Promise<string | null>`; execFile arg array, JSON.stringify-embedded internal tmpfile path, 15s timeout + 10MB maxBuffer, tmpfile unlinked in finally, PENSMITH_PYTHON override.
- `bin/lib/pdf-text.ts` (modified) — image-only branch now reaches the lazy pymupdf fallback before WARN+returning near-empty text; all prior invariants (bytes-only contract, debug-shim ENOENT rethrow, `pdf-parse/lib/pdf-parse.js` sub-path import) preserved.
- `tests/repo-files.test.ts` (modified) — T-08-03-04 pdf-parse exact-pin guard (declared + installed); added `createRequire` import.

## Threat Model Compliance

| Threat ID | Disposition | How addressed |
|-----------|-------------|---------------|
| T-08-03-01 | mitigate | execFile arg array (no shell string); tmpfile path internally generated + JSON.stringify-embedded — no user-controlled shell metacharacters reach the interpreter |
| T-08-03-02 | mitigate | execFile `timeout: 15_000` + `maxBuffer: 10MB`; any timeout/overflow caught -> null |
| T-08-03-03 | mitigate | fallback runs ONLY in the image-only near-empty branch (lazy import); healthy PDFs never spawn a subprocess |
| T-08-03-04 | mitigate | repo-files asserts pdf-parse pinned exact 1.1.1 (declared package.json pin + installed version) |
| T-08-03-05 | mitigate | pymupdfShellout returns null on ANY failure (never throws); extractPdfText degrades to near-empty pdf-parse text + single WARN |
| T-08-03-06 | mitigate | tmpfile in os.tmpdir() with a random suffix; always unlinked in finally (errors ignored) |
| T-08-03-SC | accept | No npm/pip installs performed; PyMuPDF remains a Python shellout only |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] D-07 atomic-write chokepoint banned the plan's literal `fs.promises.writeFile` for the tmpfile**
- **Found during:** Task 1 (eslint of the new file)
- **Issue:** The plan/PATTERNS action wrote the tmpfile via `fs.promises.writeFile(tmp, buf)`. The D-07 `no-restricted-syntax` ESLint chokepoint (`CallExpression[callee.property.name='writeFile']`) bans direct `fs.writeFile` everywhere except `bin/lib/atomic-write.ts`. The new file failed lint.
- **Fix:** Routed the tmpfile write through `atomicWriteFile` (the sanctioned D-07 chokepoint, which accepts `string | Buffer` and handles mkdir + atomic rename). Chose this over adding a per-file ESLint exemption so the chokepoint stays intact (CLAUDE.md / D-07 architectural constraint takes precedence over the plan's literal action).
- **Files modified:** bin/lib/pymupdf-shellout.ts
- **Commit:** 10aa6e8

**2. [Rule 1 - Contract] Interpreter source honors PENSMITH_PYTHON (locked Wave-0 test contract)**
- **Found during:** Task 1 (reading the locked 08-00 RED test before implementing)
- **Issue:** The plan/PATTERNS action hardcoded `execFile('python3', ...)`. The locked Wave-0 RED test (`tests/pymupdf-shellout.test.ts`, committed in 08-00) forces the failure/null path by setting `process.env.PENSMITH_PYTHON = '/nonexistent/python-that-is-not-here'`. A hardcoded `'python3'` would ignore the override and the test would NOT reliably exercise the absent path on a machine where `python3` exists.
- **Fix:** `pythonBin()` resolves `process.env.PENSMITH_PYTHON` (default `'python3'`) as the interpreter. The locked test is the load-bearing contract; this is the designed graceful-degradation seam.
- **Files modified:** bin/lib/pymupdf-shellout.ts
- **Commit:** 10aa6e8

## Known Stubs

None. `pymupdfShellout` is a complete, working implementation; `null` on absent PyMuPDF is the designed contract, not a stub. On this machine (and CI) `import fitz` fails, so the null/degrade path is the one exercised — by design (08-RESEARCH §environment probe).

## Verification

- `node --import tsx --test tests/pymupdf-shellout.test.ts` -> 1 pass, 0 fail (RED-by-skip flipped GREEN).
- `node --import tsx --test tests/pymupdf-shellout.test.ts tests/add-source.test.ts tests/repo-files.test.ts` -> 47 pass, 0 fail, 3 skip (add-source is 08-06 RED-by-skip; pdf-parse pin guard GREEN).
- Full suite (`node scripts/run-tests.mjs`) -> 781 tests, 767 pass, 0 fail, 14 skip. All 14 skips are later-wave RED-by-skip (add/08-06, intake-style-producer/08-05, sketch/08-04, style-match/08-02, write-style/08-06). Zero skips from this plan.
- `tsc --noEmit` -> 0 errors.
- `eslint` on all 3 touched files -> 0 errors. pdf-text.ts still imports `pdf-parse/lib/pdf-parse.js` (sub-path, D-06), not bare.

## Requirement Status (RSCH-05b — PARTIAL, not marked complete)

The plan frontmatter declared `requirements: [RSCH-05]`, but the canonical REQUIREMENTS.md entry is **RSCH-05b** (Phase 8 superset): "BYO PDF ingestion (user-supplied arbitrary PDFs); pymupdf shellout fallback when pdf-parse fails; metadata hydration via Crossref." This plan delivers the **pymupdf shellout fallback** sub-clause only. The BYO-PDF `add <pdf>` ingestion path and Crossref hydration land in **08-06** (the `add` verb, which routes through `extractPdfText` and thus reaches this new fallback). RSCH-05b is therefore deliberately **left open** — marking it complete here would falsely claim the BYO-ingestion + hydration clauses. 08-06 completes RSCH-05b.

## Self-Check: PASSED

- FOUND: bin/lib/pymupdf-shellout.ts
- FOUND commit: 10aa6e8
- FOUND commit: 8cb3cc7
