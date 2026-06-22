---
phase: 08-style-match-sketch-add-library-byo-pdf-polish
plan: 02
subsystem: style-match
tags: [style-match, pure-stats, fingerprint-registry, per-paper-only, reuse-detection, styl-01, styl-02, pitfall-1]

# Dependency graph
requires:
  - phase: 08-style-match-sketch-add-library-byo-pdf-polish
    plan: 00
    provides: tests/style-match.test.ts RED-by-skip contract (STYL-01 deterministic pure-stats profile + 64-hex fingerprint; PITFALL-1 path-free registry; STYL-02 reuse detection) + paperA/paperB sample fixtures
  - phase: 08-style-match-sketch-add-library-byo-pdf-polish
    plan: 01
    provides: pensmithStyleFingerprintsPath export in paths.ts; the PAPER-registry vs FINGERPRINT-registry separation
  - phase: 01-foundation
    provides: atomic-write.ts (atomicWriteFile D-07), lock.ts (withLock D-26), schemas/library.ts (schema-file shape), exporter.ts (JSZip docx-read pattern)
provides:
  - StyleProfileSchema (CURRENT_STYLE_VERSION=1) — a FLAT pure-stats profile (top-level numeric features + 64-hex fingerprint) matching the authoritative test contract
  - buildStyleProfile(samplesDir) — deterministic pure-stats profile from .md/.txt/.docx samples (NO LLM at build); content-hash fingerprint
  - writeStyleProfile(paperDir, profile) — atomicWriteFile to <paperDir>/STYLE.json ONLY (per-paper, never pensmithDataDir)
  - checkAndRegisterFingerprint(fingerprint, paperId, paperName) — withLock-guarded path-free hash→identity registry; returns priorPapers for cross-paper reuse detection
  - styleMatchToVoiceHint(profile) — pure render of the profile into a drafter voice hint
affects: [08-05 intake style-match producer (calls all 4 exports + surfaces the reuse notice unconditionally), 08-06/write STYL-03 (consumes styleMatchToVoiceHint from STYLE.json)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-stats deterministic profiling: content-hash fingerprint (sha256 of sorted per-file content hashes) + fingerprint-derived generatedAt so two builds of identical samples are byte-identical (deepEqual-stable, no wall-clock jitter)"
    - "Path-free reuse registry: a privacy-minimal Record<fingerprint, {paperId,paperName,addedAt}[]> stored under pensmithDataDir() with NO features/folderPath keys — detection-only; the notice is the caller's unconditional responsibility"
    - "JSZip docx text extraction (mirrors exporter.ts): loadAsync → file('word/document.xml') → async('string') → strip tags"

key-files:
  created:
    - bin/lib/schemas/style.ts
    - bin/lib/style-match.ts
  modified: []

key-decisions:
  - "[08-02] StyleProfileSchema is FLAT (top-level medianSentenceLength/typeTokenRatio/passiveVoiceRate/fingerprint), NOT the nested `features` object the PLAN <action> + PATTERNS.md described. The authoritative tests/style-match.test.ts StyleProfile interface reads `profile.medianSentenceLength` / `profile.fingerprint` directly, and the PITFALL-1 negative-control asserts those exact flat names are ABSENT from the registry. A nested `features` schema could not satisfy both the test's flat reads and Task-1's nested verify command — the RED test wins (same precedent as 08-01's uuid→min(1) resolution). Task-1's <verify> nested-shape smoke command is superseded by the live test."
  - "[08-02] generatedAt is DERIVED FROM THE FINGERPRINT (deterministicTimestamp), not Date.now(). The STYL-01 determinism test asserts deepEqual on two consecutive buildStyleProfile calls; a wall-clock timestamp would break byte-equality. A content-addressed artifact gets a content-stable timestamp."
  - "[08-02] checkAndRegisterFingerprint signature takes ONLY (fingerprint, paperId, paperName) — the PATTERNS.md sketch included a 4th folderPath arg, but the test calls it with 3 args and PITFALL-1 forbids storing any path. Dropped folderPath entirely; the caller resolves the other paper's folder from the GLOBAL PAPER registry by paperId when surfacing the notice."
  - "[08-02] Rates are clamped to [0,1] (Math.min(1, hits/sentences)) because a sentence can match the passive/subordinator regex more than once; the schema bounds these at [0,1] so the clamp is required for valid parse."
  - "[08-02] Registry load is tolerant (ENOENT → {}, corrupt JSON → {}) so a damaged style-fingerprints.json never aborts intake; the append-never-overwrite invariant preserves all prior papers under a fingerprint."

requirements-completed: [STYL-01, STYL-02]

# Metrics
duration: ~12min
completed: 2026-06-20
---

# Phase 8 Plan 02: Pure-stats style-match + path-free fingerprint registry Summary

**Shipped the deterministic pure-stats style-match pipeline (STYL-01, STYL-02): `buildStyleProfile` computes a no-LLM numeric prose profile + content-hash 64-hex fingerprint from a folder of .md/.txt/.docx samples, `writeStyleProfile` persists it to the per-paper `.paper/STYLE.json` ONLY, and `checkAndRegisterFingerprint` detects cross-paper sample reuse via a privacy-minimal hash→identity registry that holds NO prose features and NO filesystem paths — flipping tests/style-match.test.ts from 4 RED-by-skip to 4 GREEN with zero suite regression.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-06-20
- **Tasks:** 2
- **Files created/modified:** 2 (both created)

## Accomplishments

- **STYL-01 pure-stats profile** — `buildStyleProfile(samplesDir)` reads sorted `.md/.txt/.docx` samples (docx via JSZip, mirroring exporter.ts), computes sentence-length quantiles (p25/median/p75), type-token ratio, a passive-voice heuristic (`(was|were|is|are|been|be|being) + …ed`), a subordinating-clause rate (small subordinator list), opening/closing word frequency tables, and average paragraph length — **NO LLM, NO network, NO randomness**. The content-hash fingerprint (sha256 of the sorted per-file content hashes) + fingerprint-derived `generatedAt` make two builds of identical samples **byte-identical** (the determinism `deepEqual` assertion).
- **STYL-01 per-paper-only write** — `writeStyleProfile(paperDir, profile)` writes ONLY `<paperDir>/STYLE.json` via `atomicWriteFile`. The module imports `pensmithStyleFingerprintsPath` (for the registry) but NEVER `pensmithDataDir` for the profile write target — prose features never leave the paper (Pitfall 1 / T-08-02-01).
- **STYL-02 + PITFALL-1 path-free registry** — `checkAndRegisterFingerprint(fingerprint, paperId, paperName)` runs the whole read-mutate-write inside `withLock` (T-08-02-04), tolerates an absent/corrupt registry (→ `{}`), appends `{paperId, paperName, addedAt}` (never overwriting prior entries), and returns `priorPapers` = the earlier DIFFERENT-paperId entries sharing the fingerprint. The on-disk registry is a `Record<fingerprint, PriorPaper[]>` with **NO "features" key and NO "folderPath"/path key** — asserted by the 08-00 RED negative controls.
- **Detection-only / unconditional-notice contract** — the module DETECTS + RETURNS; it does not gate, prompt, or print. The cross-paper-reuse notice is the CALLER's (08-05 intake producer) UNCONDITIONAL responsibility (NOT --yolo-gated) per STYL-02 / Pitfall 2 — documented in the module header.
- **styleMatchToVoiceHint** — pure (no I/O) render of the profile into the drafter's voice hint (the load-bearing signal 08-06/write consumes from STYLE.json under STYL-03).

## Task Commits

1. **Task 1: StyleProfileSchema (bin/lib/schemas/style.ts)** — `fb5efcf` (feat)
2. **Task 2: style-match.ts — build/write/register/render** — `5145d9a` (feat)

## Files Created/Modified

- `bin/lib/schemas/style.ts` (created) — `CURRENT_STYLE_VERSION=1` + FLAT `StyleProfileSchema` (top-level numeric features + 64-hex `fingerprint`); header documents PURE-STATS, per-paper-only, registry-has-no-features.
- `bin/lib/style-match.ts` (created) — 4 exports (`buildStyleProfile`, `writeStyleProfile`, `checkAndRegisterFingerprint`, `styleMatchToVoiceHint`) + `PriorPaper` type; pure stat helpers (segment/tokenize/quantile/topN); header states the 4 load-bearing non-negotiables.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] StyleProfileSchema flat-vs-nested shape conflict (PLAN/PATTERNS vs. authoritative test)**
- **Found during:** Task 1 (reconciling the schema against the RED test before writing it).
- **Issue:** The PLAN `<action>` and PATTERNS.md specified a NESTED `features: { medianSentenceLengthWords, ... }` schema with `sampleSetFingerprint`. The authoritative `tests/style-match.test.ts` `StyleProfile` interface reads FLAT top-level fields (`profile.medianSentenceLength`, `profile.p25SentenceLength`, `profile.typeTokenRatio`, `profile.passiveVoiceRate`, `profile.fingerprint`), and the PITFALL-1 negative-control asserts those exact flat names are ABSENT from the registry. One zod schema cannot parse both a flat object and a nested object with different key names.
- **Fix:** Built `StyleProfileSchema` FLAT to match the test contract (which is the convergence-load-bearing source of truth, exactly as 08-01 chose the RED test over PATTERNS.md for the uuid→min(1) decision). Kept the richer descriptive fields (samplesDir, samplesAnalyzed, generatedAt, opening/closingWordTopN, subordinatingClauseRate) at top level too.
- **Files modified:** bin/lib/schemas/style.ts
- **Commit:** fb5efcf

**2. [Rule 1 - Bug] Task-1 `<verify>` smoke command parses the superseded nested shape**
- **Found during:** Task 1.
- **Issue:** The plan's Task-1 `<verify>` `node -e` command hardcodes the nested `features:{...Words}` / `sampleSetFingerprint` shape, which the corrected flat schema rejects.
- **Fix:** Used an equivalent FLAT verify command (parses a valid flat profile, rejects a non-64-char fingerprint) — same assertion intent (valid parses, bad fingerprint rejected) against the corrected shape. The live `tests/style-match.test.ts` GREEN run is the authoritative verification.
- **Files modified:** none (verification-command only).
- **Commit:** fb5efcf

**3. [Rule 1 - Bug] checkAndRegisterFingerprint dropped the PATTERNS.md `folderPath` 4th arg**
- **Found during:** Task 2.
- **Issue:** PATTERNS.md sketched a 4-arg signature `(fingerprint, paperId, paperName, folderPath)`. The test calls it with 3 args, and PITFALL-1 forbids storing any path in the registry.
- **Fix:** Signature is `(fingerprint, paperId, paperName)` — no path accepted, none stored. The caller resolves the other paper's folder from the GLOBAL PAPER registry by paperId when it surfaces the notice (documented in the JSDoc).
- **Files modified:** bin/lib/style-match.ts
- **Commit:** 5145d9a

### Design Note (not a deviation)

`generatedAt` is derived deterministically from the fingerprint rather than `Date.now()`, because the STYL-01 determinism test asserts `deepEqual` on two consecutive builds of the same samples — a wall-clock timestamp would break byte-equality. A content-addressed artifact gets a content-stable timestamp. (The fingerprint registry's `addedAt`, by contrast, IS a real wall-clock timestamp — it records a registration event, not a content-derived value, and is never asserted for determinism.)

## Known Stubs

None. Both exports are fully wired and exercised by GREEN tests. `styleMatchToVoiceHint` and the `buildStyleProfile`→`writeStyleProfile`→`checkAndRegisterFingerprint` chain have no live caller YET — the intake style-match producer that calls them is built in 08-05 — but that is intended forward-wiring per the plan's objective ("these are the library functions [08-05] depends on"), not an empty-data stub flowing to a UI.

## Threat Flags

None. No new network endpoints, auth paths, or trust-boundary schema changes beyond the plan's `<threat_model>` (all mitigations applied: per-paper-only write, path-free registry, path.resolve traversal guard, withLock concurrency, pure-stats determinism).

## Verification

- `node --import tsx --test tests/style-match.test.ts` → **4/4 GREEN** (was 4 RED-by-skip): deterministic non-degenerate profile + 64-hex fingerprint + non-zero passive rate; per-paper STYLE.json write; PITFALL-1 no-features-AND-no-folderPath registry; STYL-02 reuse detection (priorPapers=[] first, non-empty + names paper-1 on the second paperId).
- `npx tsc --noEmit` → 0 errors.
- `npx eslint bin/lib/style-match.ts bin/lib/schemas/style.ts` → 0 errors (atomicWriteFile + withLock used; no raw fs.writeFile; no env reads outside paths.ts; `pensmithDataDir` and `folderPath` appear ONLY in comments).
- Manual grep: `bin/lib/style-match.ts` references `pensmithDataDir` and `folderPath` in COMMENTS ONLY — neither is imported nor written into any record; the only paths.ts import is `pensmithStyleFingerprintsPath`.
- **Full suite:** `npm test` → 781 tests, 771 pass, 0 fail, 10 skip. The 4 style-match tests flipped skip→GREEN; the remaining 10 skips are later-wave (08-05/06) RED-by-skip suites (STYL-03 write-style, sketch, add-source, intake-producer, pymupdf).

## Self-Check: PASSED
