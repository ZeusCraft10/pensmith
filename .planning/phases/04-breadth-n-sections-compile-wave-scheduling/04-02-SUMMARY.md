---
phase: 04-breadth-n-sections-compile-wave-scheduling
plan: 02
subsystem: verify-and-compile-infra
tags: [rsch-10, freshness-probe, doi-head, retraction-watch, compile-report, d-14, letter-suffix-paths, arch-20, ssrf-mitigation]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "bin/lib/http.ts HEAD chokepoint, bin/lib/http-mock.ts cassette loader, bin/lib/doi.ts normalizeDoi, bin/lib/budget.ts Semaphore, zod schema conventions, bin/lib/paths.ts sectionDir/validateSlug"
  - phase: 03-vertical-slice-one-section
    provides: "bin/lib/verify/pass1.ts runPass1 aggregator + citation regex, bin/lib/sources/retraction-watch.ts fetchById (cassette-backed), bin/cli/verify.ts VERIFICATION.md emitter, cassette pattern (≤50KB, header-scrub)"
provides:
  - "probeFreshness(citekey, doi) + FreshnessResult — RSCH-10 DOI HEAD + retraction-watch advisory probe, WARN-only"
  - "probeFreshnessAll — Semaphore(5)-bounded freshness fan-out"
  - "renderFreshnessTable — deterministic ## Source Freshness (RSCH-10) VERIFICATION.md table"
  - "runFreshnessForDraft (pass1.ts) — draft→freshness helper SEPARATE from the blocking verdict path"
  - "CompileReportSchema — strict zod v1 frontmatter (D-14 reserved keys, schema_version literal 1)"
  - "renderCompileReport — deterministic COMPILE-REPORT.md renderer (D-14 5-section locked layout)"
  - "parseSectionDirName — defensive NN[letter]-slug parser with traversal rejection"
  - "sectionDir optional { letterSuffix } — ARCH-20 reserved insertion-path hook"
affects: [04-05-compile-report (consumes renderCompileReport/CompileReportSchema for COMP-07), verify, compile, 08-insertion (letter-suffix)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Advisory side-channel WARN-only by construction: freshness lives in a separate function from runPass1 so the blocking verdict path is literally untouched (D-10 / PRD §14)"
    - "SSRF mitigation: validate DOI via doi.ts BEFORE any request; HEAD target is always https://doi.org/<normalized> — never a caller URL (T-04-05)"
    - "Offline cassette short-circuit mirrors the retraction-watch adapter: isOfflineMode() + loadCassetteFile bypass http.ts (nock@14 cannot intercept undici)"
    - "Deterministic markdown renderer validates its frontmatter through the zod schema BEFORE serialization, guaranteeing the output round-trips through parse()"
    - "Backward-compatible param overload: sectionDir 3rd arg accepts root-string OR opts-object so legacy (n,slug,root) callers are unchanged"

key-files:
  created:
    - bin/lib/verify/freshness.ts
    - bin/lib/schemas/compile-report.ts
    - bin/lib/compile-report.ts
    - tests/freshness-probe.test.ts
    - tests/compile-report-schema.test.ts
    - tests/letter-suffix-paths.test.ts
    - tests/fixtures/cassettes/doi-head/head-ok.json
    - tests/fixtures/cassettes/doi-head/head-404.json
    - tests/fixtures/cassettes/retraction-watch/freshness-hit.json
  modified:
    - bin/lib/verify/pass1.ts
    - bin/cli/verify.ts
    - bin/lib/paths.ts

key-decisions:
  - "D-14 (CONTEXT.md) is the LOCKED source of truth for the COMPILE-REPORT schema; 04-RESEARCH §F DRIFTED (renamed body sections + added outline_hash/pandoc_target). Schema is .strict() and REJECTS those drift keys (ARCH-07)."
  - "retraction-watch.ts confirmed a REAL cassette-backed adapter (fetchById), NOT a Phase-3 stub — so the freshness probe issues a genuine offline lookup; no DEBUG-stub branch needed (RESEARCH §J risk A3 resolved as live)."
  - "Freshness wiring is a NEW function (runFreshnessForDraft) rather than a mutation of runPass1's return shape — keeps the array-returning runPass1 contract and its bin/cli/verify.ts caller intact, and makes 'blocking path untouched' true by construction."
  - "Cassettes placed under tests/fixtures/cassettes/<adapter>/ (not the flat tests/cassettes/ the PLAN <files> listed) because loadCassetteFile + cassette-size/no-leak tests only resolve that path — Rule 3 blocking-issue fix."
  - "sectionDir 3rd arg overloaded (string root | { letterSuffix } opts, plus 4th-arg opts) to satisfy both the PLAN's sectionDir(n,slug,{letterSuffix}) form and PATTERNS' sectionDir(n,slug,root,{letterSuffix}) form without breaking existing 3-arg root callers."

patterns-established:
  - "WARN-only advisory probes never share a code path with blocking verdicts — physical separation, not a flag"
  - "Renderer-validates-then-serializes: render*() parses through the zod schema first so emitted frontmatter is always schema-valid"
  - "Defensive directory-basename parser (parseSectionDirName) ships before any caller exists — cheap insurance for letter-suffix tolerance (Research §K)"

requirements-completed: [RSCH-10, ARCH-20]

metrics:
  duration: ~38min
  completed: 2026-06-17
  tasks: 3
  files_changed: 12
---

# Phase 4 Plan 02: Freshness Probe + COMPILE-REPORT Infra + Letter-Suffix Paths Summary

RSCH-10 source-freshness probe wired into Pass 1 as WARN-only (DOI HEAD + Retraction Watch, SSRF-validated, transport-noise silent), plus the deterministic D-14-locked COMPILE-REPORT.md renderer/schema that Plan 05 consumes, plus ARCH-20 letter-suffix path tolerance (`parseSectionDirName` + optional `sectionDir` suffix) — all three independent utility surfaces shipped without touching the scheduler or compile pipeline.

## What Was Built

Three orthogonal utility surfaces, each TDD RED→GREEN:

1. **RSCH-10 freshness probe** (`bin/lib/verify/freshness.ts`, wired through `pass1.ts` + `verify.ts`). `probeFreshness(citekey, doi)` HEAD-probes `doi.org` and cross-checks Retraction Watch, returning a `FreshnessResult` whose `warnings[]` is empty when fresh. DOI HEAD 4xx/5xx → WARN; retraction hit → WARN; transport error (no real HTTP status) → silent. `Semaphore(5)` HEAD fan-out. The probe runs AFTER the blocking verdict and never feeds `status` — `## Source Freshness (RSCH-10)` is surfaced as an advisory table in VERIFICATION.md.

2. **COMPILE-REPORT infrastructure** (`bin/lib/schemas/compile-report.ts` + `bin/lib/compile-report.ts`). `CompileReportSchema` is strict, `schema_version: z.literal(1)`, carries the 8 D-14 reserved keys (incl. Pandoc `title`/`author`/`abstract` defaulting to `''`), and rejects `schema_version: 2` and the RESEARCH-drift keys `outline_hash`/`pandoc_target`. `renderCompileReport` deterministically emits frontmatter (validated through the schema) plus the 5 D-14 body sections in fixed order, with the `## Advisory Findings` empty marker reserved for Phase 5.

3. **ARCH-20 letter-suffix tolerance** (`bin/lib/paths.ts`). `sectionDir` gains an optional `{ letterSuffix }` (3-arg legacy callers unchanged); `parseSectionDirName` parses `NN[letter]-slug` and rejects `..`, absolute paths, path separators, and null bytes (V12 ASVS / T-04-06). Phase 4 tolerates `03b-...` directories; it does not emit them.

## Task Commits

| Task | Name | Commit | Key files |
|------|------|--------|-----------|
| 1 | Wave 0 — failing tests + cassettes (RED) | `614137b` | 3 cassettes, tests/freshness-probe.test.ts, tests/compile-report-schema.test.ts, tests/letter-suffix-paths.test.ts |
| 2 | Freshness probe + Pass 1 wiring (GREEN) | `29987c7` | bin/lib/verify/freshness.ts, bin/lib/verify/pass1.ts, bin/cli/verify.ts |
| 3 | COMPILE-REPORT schema + renderer + letter-suffix paths (GREEN) | `c52f410` | bin/lib/schemas/compile-report.ts, bin/lib/compile-report.ts, bin/lib/paths.ts |

## Verification

- `node --import tsx --test tests/freshness-probe.test.ts tests/compile-report-schema.test.ts tests/letter-suffix-paths.test.ts` → 30 tests, all GREEN.
- `tests/cassette-size.test.ts` + `tests/cassette-no-leak.test.ts` GREEN over the 3 new cassettes (each ≤2KB, no sensitive headers).
- `tests/paths.test.ts` (25 tests) GREEN — no regression from the `sectionDir` overload.
- `tests/known-bad-citations.test.ts` GREEN — Pass 1 blocking verdict path intact.
- `npm run lint` → 0 errors (1 pre-existing warning in the Plan 04-01 `tests/wave-scheduler.test.ts`, not this plan's file).
- `npx tsc --noEmit` → clean (exactOptionalPropertyTypes-safe).

## Threat-Model Mitigations Applied

| Threat ID | Mitigation in code |
|-----------|--------------------|
| T-04-05 (SSRF / DOI HEAD) | `normalizeDoi` validation before any request; HEAD target hard-coded to `https://doi.org/<normalized>`; 10s timeout + chokepoint retry |
| T-04-06 (parseSectionDirName traversal) | reject `..`, path separators, absolute paths, Windows drive prefix, null byte; slug re-validated via `SLUG_RE` |
| T-04-08 (COMPILE-REPORT forward-incompat) | `z.literal(1)` + `.strict()` reject forward-incompat keys incl. `outline_hash`/`pandoc_target` |
| T-04-09 (freshness escalated to block) | freshness lives in a separate function; `runPass1` blocking path untouched; never maps to FABRICATED/MIS-CITED |
| T-04-SC (cassettes) | no new deps; 3 cassettes git-committed, header-clean, ≤2KB; covered by cassette-size/no-leak gates |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Cassette location corrected to the loader-resolvable path**
- **Found during:** Task 1
- **Issue:** The PLAN `files_modified`/`<files>` listed cassettes at flat `tests/cassettes/doi-head-ok.json`. But the offline consumer (`loadCassetteFile(adapter, basename)`) and the `cassette-size`/`cassette-no-leak` gates only resolve `tests/fixtures/cassettes/<adapter>/<basename>.json`. Flat-path cassettes would be unreadable by the freshness probe and unscanned by the leak gate.
- **Fix:** Placed cassettes under `tests/fixtures/cassettes/doi-head/{head-ok,head-404}.json` and `tests/fixtures/cassettes/retraction-watch/freshness-hit.json`. The freshness probe reads them via the same `loadCassetteFile` path the retraction-watch adapter uses.
- **Files:** the 3 cassette files
- **Commit:** `614137b`

**2. [Rule 3 - Blocking issue] Freshness wired as a new pass1.ts function, not a mutation of runPass1's return shape**
- **Found during:** Task 2
- **Issue:** The plan says "append a `freshness` field to its result". `runPass1` returns `Pass1Result[]` (an array); attaching a field would change the type and break the `bin/cli/verify.ts` caller (`pass1.map`/`pass1.some`).
- **Fix:** Added `runFreshnessForDraft` (separate exported function) and re-exported `FreshnessResult`/`renderFreshnessTable` from `pass1.ts`. `verify.ts` calls it after the blocking verdict and adds `freshness` to its own structured return. This makes "blocking verdict path untouched" literally true.
- **Files:** bin/lib/verify/pass1.ts, bin/cli/verify.ts
- **Commit:** `29987c7`

**3. [Rule 3 - Blocking issue] exactOptionalPropertyTypes-safe parser return type**
- **Found during:** Task 3 typecheck
- **Issue:** `parseSectionDirName`'s `letterSuffix?: string` return type rejected the assignment of `m[2]` (`string | undefined`) under `exactOptionalPropertyTypes: true`. The RED test also `deepEqual`s an object with an explicit `letterSuffix: undefined`, so the key must be present.
- **Fix:** Declared the return type as `letterSuffix: string | undefined` (key always present, may be `undefined`).
- **Files:** bin/lib/paths.ts
- **Commit:** `c52f410`

### Source-precedence ruling honored
Per the PLAN `<interfaces>` ruling, **04-CONTEXT.md D-14 is authoritative** for the COMPILE-REPORT schema; 04-RESEARCH §F (which renamed body sections and added `outline_hash`/`pandoc_target`) is wrong where it conflicts. The schema/renderer implement the D-14 layout verbatim and the schema actively rejects the RESEARCH-drift keys.

## Out-of-Scope Discoveries (logged, not fixed)

Logged to `.planning/phases/04-breadth-n-sections-compile-wave-scheduling/deferred-items.md`. All trace to a pre-existing `CURRENT_STATE_VERSION` bump (state.ts → 2) that earlier-phase tests still assert as 1, confirmed at baseline `b1b2d48`. None touch this plan's files:
- `tests/schemas.test.ts` — 3 failures (state version + v1 fixture).
- migrations/loader test — `schema validation failure throws SchemaValidationError` (same root cause).
- `tests/tier-contract.test.ts` Case C `paper_advance_section is idempotent` (same root cause; advance-section reads a state that no longer parses).
- `tests/wave-scheduler.test.ts` — 1 lint warning (stale `eslint-disable`), Plan 04-01's file.

Per the executor SCOPE BOUNDARY and the prompt's explicit note ("These are NOT yours to fix in this plan… Do not touch state.ts or schemas.test.ts"), these were not fixed.

## Known Stubs

None. All three surfaces are fully wired:
- The freshness probe issues real (cassette-backed offline) HEAD + retraction lookups and surfaces a populated table.
- `renderCompileReport`'s `## Advisory Findings` empty marker is an intentional, D-14-specified reserved slot for Phase 5 (not a stub — documented in CONTEXT.md D-14 and the plan).
- `parseSectionDirName` ships before a Phase-4 caller by design (Research §K "cheap insurance"); this is a deliberate forward-tolerance utility, not dead/stub code.

## Self-Check: PASSED

All 12 created/modified files verified present on disk. All 3 task commits (`614137b`, `29987c7`, `c52f410`) verified in `git log`. Target test suites GREEN; lint 0 errors; tsc clean.
