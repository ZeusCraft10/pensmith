---
phase: 03-vertical-slice-one-section
plan: "01"
subsystem: verifier-primitives
tags: [wave-1, deterministic-primitives, jaro-winkler, levenshtein, nfkc-normalize, pass-1, pass-3, D-11, VRFY-02, VRFY-04]
dependency_graph:
  requires:
    - 03-00
  provides:
    - bin/lib/normalize.ts (nfkcNormalize, normalizeText alias)
    - bin/lib/fuzzy.ts (jaroWinkler, levenshtein, levenshteinSubstring, normalizeForFuzzy, TITLE_JW_THRESHOLD=0.92, AUTHOR_JW_THRESHOLD=0.85, QUOTE_LEV_THRESHOLD=0.95)
    - bin/lib/author-normalize.ts (firstAuthorSurname, normalizeAuthorList)
    - tests/author-normalize.test.ts (Wave 0 scaffold gap closed, 14 cases)
  affects:
    - tests/normalize.test.ts (5 @ts-expect-error directives removed)
    - tests/fuzzy.test.ts (8 @ts-expect-error directives removed)
    - tests/fuzzy.property.test.ts (6 @ts-expect-error directives removed)
tech_stack:
  added: []  # zero new dependencies — hand-rolled per RESEARCH.md Standard Stack
  patterns:
    - "Hand-rolled deterministic primitive in bin/lib/ (mirrors doi.ts chokepoint pattern)"
    - "Pre-normalize-then-measure: nfkcNormalize() called before every fuzzy comparison"
    - "Threshold constants exported as single source of truth (D-11 T-3-11 mitigation)"
    - "Uint32Array 2-row DP for Levenshtein (O(min) space, typed-access perf)"
    - "Strict-equality short-circuit BEFORE normalize for property-test safety (JW(a,a)===1 for all a)"
key_files:
  created:
    - bin/lib/normalize.ts
    - bin/lib/fuzzy.ts
    - bin/lib/author-normalize.ts
    - tests/author-normalize.test.ts
  modified:
    - tests/normalize.test.ts
    - tests/fuzzy.test.ts
    - tests/fuzzy.property.test.ts
decisions:
  - "D-11 thresholds (TITLE=0.92, AUTHOR=0.85, QUOTE=0.95) exported as named constants from fuzzy.ts — single source of truth, mitigates T-3-11 drift"
  - "Hand-rolled JW + Levenshtein per RESEARCH.md Standard Stack — zero npm dep added (no jaro-winkler, no fastest-levenshtein, no string-similarity)"
  - "Reconciled plan vs Wave 0 test naming: exported both plan API (nfkcNormalize, levenshteinSubstring) AND Wave 0 test API (normalizeText, levenshtein, normalizeForFuzzy) so tests stayed source-of-truth"
  - "Symmetry property test relaxed to Math.abs(JW(a,b)-JW(b,a)) < 1e-10 tolerance — Plan 03-01 cycle-4 review LOW: IEEE-754 division ordering can sub-ulp-drift on (m/|A|+m/|B|+(m-t)/m)/3"
  - "Ukkonen banding deferred — classical 2-row DP is sufficient for current property-test bounds (numRuns 100-200, maxLength ≤50); banding is documented as future optimization in fuzzy.ts JSDoc"
  - "Created tests/author-normalize.test.ts (Wave 0 gap) — applied Rule 3 (blocking missing dependency) per plan acceptance criteria requiring this test"
metrics:
  duration: "~2h single session"
  completed: "2026-05-26"
  tasks_completed: 3
  files_created: 4
  files_modified: 3
---

# Phase 03 Plan 01: Verifier Primitives Summary

Hand-rolled deterministic primitives for D-11's Pass-1 (citation integrity) and Pass-3 (quote integrity) AND-gates. Three modules (normalize, fuzzy, author-normalize) totaling 580 LOC with zero third-party dependency cost — fuzzy.ts imports only `./normalize.js`, author-normalize.ts imports only `./normalize.js`. All 36 plan-target tests move from RED/SKIP to GREEN.

## Tasks Completed

| Task | Name | Commit | Files Created/Modified |
|------|------|--------|------------------------|
| 1.1  | Implement bin/lib/normalize.ts (NFKC + artifact stripping) | d32dcaf | bin/lib/normalize.ts (NEW); tests/normalize.test.ts (5 @ts-expect-error removed) |
| 1.2  | Implement bin/lib/fuzzy.ts (JW + Levenshtein + thresholds) | 6c0fa24 | bin/lib/fuzzy.ts (NEW); tests/fuzzy.test.ts + tests/fuzzy.property.test.ts (14 @ts-expect-error removed) |
| 1.3  | Implement bin/lib/author-normalize.ts (first-author surname) | af4b9ee | bin/lib/author-normalize.ts (NEW); tests/author-normalize.test.ts (NEW — Wave 0 gap) |

## LOC per Module

| Module | Total lines | Effective code (no comments/blanks) | Exports |
|--------|-------------|--------------------------------------|---------|
| bin/lib/normalize.ts        | 100 | 30  | `nfkcNormalize`, `normalizeText` (alias) |
| bin/lib/fuzzy.ts            | 323 | 224 | `jaroWinkler`, `levenshtein`, `levenshteinSubstring`, `normalizeForFuzzy`, `TITLE_JW_THRESHOLD`, `AUTHOR_JW_THRESHOLD`, `QUOTE_LEV_THRESHOLD` |
| bin/lib/author-normalize.ts | 157 | 111 | `firstAuthorSurname`, `normalizeAuthorList` |
| **Total**                   | **580** | **365** | 12 named exports |

The plan estimated "~150 LOC per module" and "two ~150-LOC modules" — the actual normalize+fuzzy total (423 LOC including extensive JSDoc) lands close to that envelope. Heavy commenting is deliberate: these are load-bearing deterministic primitives that downstream Pass-1/Pass-3 logic depends on, so the JSDoc encodes algorithmic invariants (symmetry, idempotency, threshold rationale) that future maintainers must preserve.

## Tests Green Delta

| Test File | Before | After | Notes |
|-----------|--------|-------|-------|
| tests/normalize.test.ts        | 1 FAIL + 5 SKIP | **6 PASS** | All 6 production-module + behavioral assertions GREEN |
| tests/fuzzy.test.ts            | 1 FAIL + 8 SKIP | **9 PASS** | Existence + 8 golden (raw JW, title/author thresholds, Levenshtein) |
| tests/fuzzy.property.test.ts   | 1 FAIL + 6 SKIP | **7 PASS** | Existence + JW=1 on a=a, symmetric ±1e-10, range [0,1], Levenshtein symmetric + triangle inequality |
| tests/author-normalize.test.ts | (did not exist) | **14 PASS** | Existence + 12 behavioral (7 categories) + 1 batch + 2 safety |
| **Total Plan 03-01 target tests** | **3 FAIL + 19 SKIP** | **36 PASS, 0 FAIL, 0 SKIP** | |

### Full-suite delta

| Metric | Baseline (post-rebase to 848aebd) | After Plan 03-01 | Delta |
|--------|-----------------------------------|------------------|-------|
| Pass   | 348 | 416 | **+68** |
| Fail   | 101 | 43  | **-58** |
| Skip   | 80  | 55  | **-25** |

Plan acceptance threshold was "FAIL count must decrease by at least 4 vs baseline (24→≤20)". Actual delta is -58, vastly exceeding the threshold. The over-delivery comes from: (a) the 4 plan-target test files moving entirely to GREEN (36 tests), and (b) other Wave 0 test files that were skip-guarded on `existsSync(bin/lib/normalize.ts || fuzzy.ts)` and previously skipped — they now run and pass behaviorally (e.g., citation-render's normalize-dependent path, drafter-input).

Note on baseline-magnitude mismatch with the user's "Wave 0 had 24 fails" expectation: this worktree was created from `main` at `ecc8f4b` (Phase 1 close), NOT from `848aebd` (Wave 0 RED scaffold). A fast-forward merge to `848aebd` was required before executing tasks. Post-merge, the actual baseline observed on Windows-x64 was 101 fails (a large fraction being MCP-server preflight tests that crash on `npm test` because the dist/ artifact is not yet built when the test runner spawns the server child — pre-existing noise out of scope for this plan). The fuzzy/normalize/author-specific baseline (3 existence FAILs + 19 SKIP behaviors) matched the user's expected shape.

## Confirmation of Zero Third-Party Deps

`npm ls --depth=0` after Plan 03-01 shows IDENTICAL top-level dependency tree as Wave 0:

```
pensmith@0.1.0-dev
+-- @anthropic-ai/sdk@0.93.0
+-- @clack/prompts@0.7.0
+-- @modelcontextprotocol/sdk@1.29.0
+-- citation-js@0.7.22       (Wave 0 — D-19 chokepoint dep, NOT used by Plan 03-01 modules)
+-- citty@0.2.2
+-- doi-regex@0.1.17
+-- fast-check@3.23.2          (Wave 0 — devDep for property tests, NOT a runtime dep)
+-- pdf-parse@1.1.1            (Wave 0 — D-06 chokepoint dep, NOT used by Plan 03-01 modules)
+-- p-retry@6.2.1
+-- proper-lockfile@4.1.2
+-- smol-toml@1.6.1
+-- undici@7.25.0
+-- yaml@2.9.0
+-- zod@3.25.76
... (no NEW entries — verified via diff against Wave 0 SUMMARY)
```

Import-graph verification (grep on the 3 new bin/lib/ files):
```
bin/lib/normalize.ts        → (no imports)
bin/lib/fuzzy.ts            → import { nfkcNormalize } from './normalize.js';
bin/lib/author-normalize.ts → import { nfkcNormalize } from './normalize.js';
```

Anti-pattern check (would have indicated regression toward npm-vendored fuzzy):
```
grep -E "from 'jaro-winkler|from 'string-similarity|from 'fastest-levenshtein|from 'pdf-parse|from 'citation-js" bin/lib/{normalize,fuzzy,author-normalize}.ts
→ (no matches — PASS)
```

## Post-Merge Gate Results

| Gate | Command | Exit Code | Notes |
|------|---------|-----------|-------|
| lint  | `npm run lint`     | 0 | Clean — ESLint chokepoints for pdf-parse + citation-js held (no exemption needed) |
| tsc   | `npx tsc --noEmit` | 0 | Clean — Uint32Array DP uses `!` non-null assertions for noUncheckedIndexedAccess compat |
| build | `npm run build`    | 0 | Clean — prebuild regenerated version.generated.ts; tsc compile succeeded |
| test  | `npm test`         | 1 (overall) | Plan-target tests 36/36 GREEN. Overall exit non-zero due to pre-existing Wave 0/Phase 1 unrelated failures (MCP preflight, missing bin/cli/* stubs) — NOT a regression. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Wave 0 missed creating tests/author-normalize.test.ts**
- **Found during:** Task 1.3 setup
- **Issue:** Plan 03-01 Task 1.3 `read_first` lists `tests/author-normalize.test.ts (created in Plan 00 Wave 0)`, but Wave 0's actual SUMMARY (03-00-SUMMARY.md) lists 13 root-level test files created — `author-normalize.test.ts` is not among them. The plan's acceptance criteria requires this file to be GREEN with ≥10 cases.
- **Fix:** Created `tests/author-normalize.test.ts` alongside the production module. 14 test cases covering all 7 categories from the plan's `<behavior>` block (comma-separated, initials-prefix, multi-given-name, Dutch particle surname-first, particle in middle, hyphenated+diacritic, cross-form consistency) plus empty/whitespace safety + batch surface + multi-particle case.
- **Files modified:** tests/author-normalize.test.ts (NEW)
- **Commit:** af4b9ee

**2. [Rule 1 - Bug] Uint32Array indexed access flagged by noUncheckedIndexedAccess**
- **Found during:** Task 1.2 typecheck
- **Issue:** tsconfig.json has `noUncheckedIndexedAccess: true`. TypeScript treats `Uint32Array[j]` as `number | undefined` even though typed-array indexed reads never return undefined in practice. Initial implementation used regular `Array<number>` with `prev[j] + 1` which TS flagged at 5 sites.
- **Fix:** Switched to `Uint32Array` (gives O(1) dense layout + zero-fill init) AND added `!` non-null assertions at the 4 in-bounds index reads in the Levenshtein DP hot loop. Documented invariant in JSDoc: every access j is in [0, n] and we allocated n+1 slots.
- **Files modified:** bin/lib/fuzzy.ts
- **Commit:** 6c0fa24

**3. [Rule 3 - Blocking] @ts-expect-error directives in Wave 0 test files became unused**
- **Found during:** Task 1.1 + 1.2 post-implementation typecheck
- **Issue:** Wave 0 scaffold added `@ts-expect-error` on every dynamic-import line in normalize.test.ts, fuzzy.test.ts, fuzzy.property.test.ts (commit 848aebd) because the production modules did not yet exist. Once Plan 03-01 created bin/lib/normalize.ts + bin/lib/fuzzy.ts, those imports resolve cleanly, making the @ts-expect-error directives "unused" — TS flags this as error TS2578 (TypeScript treats unused expect-error as a separate failure to prevent silent decay).
- **Fix:** Removed 19 obsolete @ts-expect-error lines (5 in normalize.test.ts, 8 in fuzzy.test.ts, 6 in fuzzy.property.test.ts). Did NOT touch other test files' @ts-expect-error directives (those gate Wave 2+ production modules still pending: handoff, verifier, drafter-input, etc.).
- **Files modified:** tests/normalize.test.ts, tests/fuzzy.test.ts, tests/fuzzy.property.test.ts
- **Commits:** d32dcaf (normalize), 6c0fa24 (fuzzy)

**4. [Rule 3 - Environment] Worktree HEAD did not match EXPECTED_BASE**
- **Found during:** Initial state-load step (before Task 1.1)
- **Issue:** User-provided EXPECTED_BASE was `848aebdc93603748bbd350255c22b5cf3049ef60` (the Wave 0 RED scaffold close), but the worktree was created from `ecc8f4b4` (Phase 1 close) — 98 commits behind, all Phase 2/3-prep commits missing including the entire Wave 0 test surface and the chokepoint ESLint config.
- **Fix:** Fast-forward merged `848aebd` into the worktree's branch (`git merge 848aebd --ff-only`). Verified no commits ahead before the merge (worktree branch had zero diff vs ecc8f4b). After merge, HEAD == `848aebd` per EXPECTED_BASE.
- **Files modified:** (175 files brought in by the merge — all from upstream main, no executor changes)
- **Commits:** N/A (fast-forward only, no new commit)

### CLAUDE.md Compliance Check

Verified the three new modules against project CLAUDE.md non-negotiables:

- **"Verifier blocks compile and export"** — These three modules ARE the deterministic foundation of Pass-1 (jaroWinkler at 0.92/0.85) and Pass-3 (levenshteinSubstring at 0.95). Thresholds are exported as named constants so callers cannot duplicate-and-drift D-11's locked values. ✓
- **"Two-tier architecture"** — All three modules are pure-function `bin/lib/*` primitives with no MCP/CLI tier-specific code. They will be consumed identically by Tier 1 (MCP server) and Tier 2 (citty CLI). ✓
- **"No exported-document trace"** — N/A; these modules don't touch export pipeline.
- **"Approval gates default-on"** — N/A; these modules don't introduce user-facing gates.

## Known Stubs

None. All three modules are fully-implemented production code with green tests. The plan's `<output>` block did not list any stubs as expected.

## Threat Flags

None. The three modules introduce:
- Zero new network endpoints
- Zero new file-access paths
- Zero new auth surfaces
- Zero new schema/trust-boundary surfaces

All new code is pure-function deterministic computation on already-trusted strings (BibTeX-parsed, NFKC-normalized). Threat-register entries (T-3-DOS-01, T-3-04, T-3-11) from the plan's `<threat_model>` are mitigated per spec and documented in JSDoc headers.

## Self-Check: PASSED

Verified file existence:
- bin/lib/normalize.ts: FOUND (100 lines)
- bin/lib/fuzzy.ts: FOUND (323 lines)
- bin/lib/author-normalize.ts: FOUND (157 lines)
- tests/author-normalize.test.ts: FOUND (157 lines)
- .planning/phases/03-vertical-slice-one-section/03-01-SUMMARY.md: FOUND (this file)

Verified commits exist:
- d32dcaf (Task 1.1 normalize): FOUND on worktree-agent-a65aabcc4ce151f80
- 6c0fa24 (Task 1.2 fuzzy): FOUND on worktree-agent-a65aabcc4ce151f80
- af4b9ee (Task 1.3 author-normalize): FOUND on worktree-agent-a65aabcc4ce151f80

Verified import contract:
- bin/lib/normalize.ts: 0 imports (pure stdlib via String.prototype) ✓
- bin/lib/fuzzy.ts: 1 import (./normalize.js) ✓
- bin/lib/author-normalize.ts: 1 import (./normalize.js) ✓
- No `from 'pdf-parse'`, `from 'citation-js'`, `from 'jaro-winkler'`, `from 'fastest-levenshtein'`, or `from 'string-similarity'` in any of the three new files ✓

Verified threshold constants (D-11 LOCKED values):
- TITLE_JW_THRESHOLD === 0.92 ✓
- AUTHOR_JW_THRESHOLD === 0.85 ✓
- QUOTE_LEV_THRESHOLD === 0.95 ✓

Verified test deltas:
- Plan-target tests (4 files): 36/36 PASS, 0 FAIL, 0 SKIP ✓
- Full-suite delta: PASS +68, FAIL -58, SKIP -25 — well above the +4 acceptance threshold ✓
