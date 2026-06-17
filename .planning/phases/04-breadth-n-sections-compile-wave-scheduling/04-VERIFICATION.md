---
phase: 04-breadth-n-sections-compile-wave-scheduling
verified: 2026-06-17T12:30:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 4: Breadth — N sections + compile + wave scheduling — Verification Report

**Phase Goal:** Scale from one section to N. Wave scheduler honors `depends_on`; compile concatenates sections in outline order, runs cross-section smoothing read-only on section files, produces consistency flags (never edits), and refuses on any FABRICATED / MIS-CITED / quote NOT_FOUND. Stable section numbering with letter suffixes is locked.
**Verified:** 2026-06-17T12:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | `pensmith compile` refuses on any FABRICATED / MIS-CITED / quote-NOT_FOUND, citing offending section + citation | ✓ VERIFIED | `bin/lib/compile.ts:62` `REFUSING_VERDICTS`; `:276-279` collect-all refuse reasons naming section + citekey; `:307-315` early-return BEFORE any write. Tests: `tests/compile-refuse.test.ts` (4 tests — FABRICATED/MIS-CITED/NOT_FOUND each refuse + no DRAFT.md write; clean writes). All GREEN. |
| 2 | Cross-section smoothing writes only to `.paper/DRAFT.md`, never `sections/<N>/DRAFT.md` (mtime + content-hash invariant) | ✓ VERIFIED | `bin/lib/compile.ts:416,429` — sole writes are project-level `atomicWriteFile`; section files only `readFileSync` (`:227-228`). Test: `tests/compile-order.test.ts` `ARCH-20: compile is read-only on every section DRAFT.md (mtime + content-hash unchanged)` — snapshots mtimeMs+sha256 before/after, asserts equality. GREEN. |
| 3 | Wave scheduler topologically sorts by `depends_on`, respects `--max-parallel` (default 5) Tier 1; Tier 2 same order serially | ✓ VERIFIED | `bin/lib/scheduler.ts:44-142` Kahn topo-sort (`computed_wave`); `:154-171` `runWave` Semaphore-bounded. `write-orchestrator.ts:105-109` Tier-2 forces maxParallel 1 + single WARN; default 5 at `bin/cli/write.ts`. Tests: `tests/wave-scheduler.test.ts` (topo/cap/D-03), `tests/tier-contract.test.ts` `write-wave 3-section deps parity — identical settled state + Tier-2 serial WARN`. GREEN. |
| 4 | Stable letter-suffix numbering enforced (inserts never renumber); `verified_against_draft_hash` flags compile-staleness | ✓ VERIFIED | Letter-suffix: `bin/lib/paths.ts:193-262` `sectionDir({letterSuffix})` + `parseSectionDirName` (traversal-safe, lexicographic sort `'03'<'03b'<'04'`); `tests/letter-suffix-paths.test.ts` (11 tests). Staleness: `bin/lib/draft-hash.ts:34` D-07 hash; `bin/lib/compile.ts:282-303` recompute + re-verify; `tests/compile-staleness.test.ts` (3 tests, incl. Pass 2/4-never-reachable probe). GREEN. See note below on scope. |
| 5 | `plan <N> --revise` and `plan <N> --research <query>` modify only target section's PLAN.md + RESEARCH additions (no cross-section disturbance) | ✓ VERIFIED | `bin/cli/plan.ts:92-103` both flags route to single `runRevise`; `bin/lib/revise.ts:281-309` patches only target DRAFT.md + resets that PLAN.md hash; `:315-393` `--research` writes only project `.paper/` files + `sections/<N>/RESEARCH-LOG.md`. Test: `tests/revise-swap.test.ts` `revise --research: section-scoped append, sibling untouched` — sibling content+mtime asserted unchanged. GREEN. |

**Score:** 5/5 truths verified

### SC#5 Deviation Verdict: `--revise` delivered via `plan --revise`, NOT a standalone verb

**ACCEPTED — the contract holds.** SC#5's own wording is `pensmith plan <N> --revise`, and that is exactly what ships. `revise` is confirmed absent from the locked 16 verbs (`bin/lib/verbs.ts:15-32`: doctor/new/next/status/research/outline/plan/write/verify/compile/done/resume/list/open/sketch/add — no `revise`). A 17th verb would break `tests/cli-verbs.test.ts` (exactly-16) and a `workflows/revise.md` would break `tests/workflows-keyequal.test.ts` (16-bijection); both invariants are GREEN at HEAD (workflow count = 16). Both `bin/cli/revise.ts` (CommandDef, not a dispatcher entry) and `bin/cli/plan.ts --revise` delegate to the single `runRevise` chokepoint (D-06, no divergent path). The target-section-only mutation contract is verified by `tests/revise-swap.test.ts` (sibling content+mtime unchanged) and the membership guard (`bin/lib/revise.ts:264-267`) which prevents any new citekey entering DRAFT.md.

### Compile Refuse-Gate: Structurally Unbypassable — CONFIRMED

The #1 project non-negotiable (CLAUDE.md / PRD §14: verifier blocks compile) is structurally enforced, not merely tested in isolation:

- **The only `.paper/DRAFT.md` write is `bin/lib/compile.ts:416**` (`atomicWriteFile(draftPath, compiled)`). The COMPILE-REPORT write is `:429`, bib regen `:413`.
- **The refuse early-return is `:307-315`** (`if (refuseReasons.length > 0) { ... return { refused: true ... } }`), which executes BEFORE Step 2 concat (`:317`), Step 3 smoothing (`:322`), and Step 4 writes (`:411-429`). The DRAFT.md write at `:416` is therefore unreachable when any refuse reason exists.
- **Refuse reasons are collected across ALL sections first** (`:263-304` loop) — a bad citation in any one section blocks the whole compile (no partial DRAFT.md).
- **Both fresh verdicts AND staleness re-verify failures feed the same `refuseReasons` array** (`:277-279` fresh; `:289-294` re-verify failure), so a stale section whose re-verify surfaces a new failure also refuses (proven by `tests/compile-staleness.test.ts` "re-verify FAILS blocks compile").
- **Pass 2/4 can never run on the staleness path** — proven by the `runPass2/runPass4` probe seam in `tests/compile-staleness.test.ts:105-116` asserting `pass2or4Invoked === false`. The production seam (`bin/cli/compile.ts:37-61`) wires only `runPass1` + `runPass3`.

The line `bin/lib/compile.ts:223` is a section's own DRAFT.md *read* (input loading), not the project DRAFT.md write — no false positive.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `bin/lib/compile.ts` | runCompile keystone pipeline | ✓ VERIFIED | 485 lines; refuse-gate + outline-concat + N-1 smoothing + consistency + density + bib regen + emit; sole writer atomicWriteFile. Imported by `bin/cli/compile.ts`. |
| `bin/lib/scheduler.ts` | Kahn topo-sort + bounded runWave | ✓ VERIFIED | `buildWaveGraph` + `runWave`; pure (no fs I/O). Imported by `write-orchestrator.ts`. |
| `bin/lib/write-orchestrator.ts` | wave-driven multi-section drain | ✓ VERIFIED | `runAllSections` drains waves, Tier-2 serial WARN, blocked-subtree pruning. Imported by `bin/cli/write.ts` + tests. |
| `bin/lib/revise.ts` | single revise chokepoint | ✓ VERIFIED | `runRevise` strict-zod + membership guard + approval gate + patch + hash reset + --research. Imported by `bin/cli/{plan,revise}.ts`. |
| `bin/lib/draft-hash.ts` | D-07 per-section hash | ✓ VERIFIED | `computeDraftHash(bytes, sources)` SHA-256, no normalization. Used by compile + tests. |
| `bin/lib/outline-parse.ts` | pure OUTLINE.md GFM parser | ✓ VERIFIED | `parseOutline` slug-validated, throws on malformed. Used by compile + scheduler. |
| `bin/lib/consistency-scan.ts` | COMP-04 flags-only scan | ✓ VERIFIED | `runConsistencyScan` never throws/blocks. Used by compile. |
| `bin/lib/citation-density.ts` | COMP-05 warn-only density | ✓ VERIFIED | `computeCitationDensity` per-section + mean/stdev vs discipline band. Used by compile. |
| `bin/lib/citation-token.ts` | `[@key]` token helpers | ✓ VERIFIED | `extractCitekeys`/`replaceCitekeys` for placeholder masking. Used by compile + revise. |
| `bin/lib/paths.ts` (letter-suffix) | `sectionDir` suffix + `parseSectionDirName` | ✓ VERIFIED | Reserved insertion-path hook + traversal-safe parser. |
| `templates/prompts/smoother.md` | hash-pinned (D-12/D-13) | ✓ VERIFIED | Present; real SHA-256 `ee934f8e…` pinned in `prompt-loader.ts:116` + repo-files. |
| `templates/prompts/revise-swap.md` | hash-pinned (D-05) | ✓ VERIFIED | Present; real SHA-256 `835876cc…` pinned in `prompt-loader.ts:110` + repo-files. |
| `bin/cli/compile.ts` | real compile verb (locked-16) | ✓ VERIFIED | Promoted from stub; registered `bin/pensmith.ts:52` REAL_VERB_LOADERS. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `bin/cli/compile.ts` | `runCompile` | import + delegate, wires Pass1+3 reVerify seam | ✓ WIRED | `:25,88,93` |
| `bin/cli/plan.ts --revise/--research` | `runRevise` | single chokepoint (D-06) | ✓ WIRED | `:14,92-100` |
| `bin/cli/revise.ts` | `runRevise` | thin CommandDef delegate | ✓ WIRED | (parity test GREEN) |
| `write-orchestrator.ts` | `buildWaveGraph` + `runWave` | wave drain | ✓ WIRED | `:35,128,157` |
| `compile.ts` refuse-gate | DRAFT.md write | early-return precedes write | ✓ WIRED (gated) | `:307-315` before `:416` |
| `bin/pensmith.ts` | `compileCommand` | REAL_VERB_LOADERS | ✓ WIRED | `:52` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full gate (lint+tsc+build+tier-contract+tests+manifests) | `npm run check` | exit 0; 632/632 tests pass; manifests valid | ✓ PASS |
| Core compile/scheduler suites | `node --test tests/compile-*.ts tests/wave-*.ts tests/scheduler-*.ts tests/section-isolation-n.ts tests/letter-suffix-paths.ts tests/draft-hash.ts tests/consistency-scan.ts tests/citation-density.ts tests/outline-parse.ts tests/smoother-token-protect.ts` | 64/64 pass | ✓ PASS |
| Revise + tier-contract parity | `node --test tests/revise-swap.test.ts tests/tier-contract.test.ts` | 32/32 pass (incl. compile/write-wave/revise parity) | ✓ PASS |
| Hash-pinned prompts exist | `ls templates/prompts/{smoother,revise-swap}.md` | both present, real SHA-256 pins in prompt-loader | ✓ PASS |
| Locked-16 preserved | workflow count + cli-verbs/workflows-keyequal tests | 16 workflows; `revise` not a verb; both invariant tests GREEN | ✓ PASS |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
| ----------- | ----------- | ------ | -------- |
| ARCH-19 | Section state machine + `verified_against_draft_hash` for compile-staleness | ✓ SATISFIED | scheduler.ts + draft-hash.ts + compile staleness path |
| ARCH-20 | Stable numbering, letter-suffix policy | ✓ SATISFIED | paths.ts sectionDir/parseSectionDirName; letter-suffix-paths.test.ts |
| PLAN-02 | `--revise` re-plans from verification feedback | ✓ SATISFIED | plan.ts --revise → runRevise |
| PLAN-03 | `--research <query>` section-scoped, no cross-section disturbance | ✓ SATISFIED | revise.ts applyResearch; sibling-untouched test |
| WRTE-02 | Style-match / voice hint per-section consume | ✓ SATISFIED | revise.ts voiceHint() WRTE-02 seam |
| RSCH-10 | Auto-recheck stale sources | ✓ SATISFIED | freshness.ts WARN-only probe (04-02) |
| COMP-01 | Compile refuses on FABRICATED/MIS-CITED/NOT_FOUND | ✓ SATISFIED | compile.ts refuse-gate; compile-refuse.test.ts |
| COMP-02 | Outline-order concatenation | ✓ SATISFIED | compile.ts:257 sort by n; compile-order.test.ts |
| COMP-03 | Smoothing read-only on citation markers | ✓ SATISFIED | compile.ts placeholder mask + token-set equality; smoother-token-protect.test.ts |
| COMP-04 | Consistency check flags only, never edits | ✓ SATISFIED | consistency-scan.ts; consistency-scan.test.ts |
| COMP-05 | Citation density vs discipline target | ✓ SATISFIED | citation-density.ts; citation-density.test.ts |
| COMP-06 | Wave scheduling topo-sorts by depends_on | ✓ SATISFIED | scheduler.ts buildWaveGraph; wave-scheduler.test.ts |
| COMP-07 | Compile writes DRAFT.md + COMPILE-REPORT.md | ✓ SATISFIED | compile.ts:416,429; compile-staleness/report-schema tests |

### Anti-Patterns Found

None blocking. Scan of phase-modified files:
- No `TBD`/`FIXME`/`XXX` debt markers in any phase source file.
- The Tier-2 boundary smoother + Tier-2 `proposeSwap` placeholders are documented "Known Stubs" — they are NOT goal-blocking. The smoother is best-effort prose that never blocks compile (D-13), its seam + hash-pinned prompt are complete, and the deterministic compile path (refuse, staleness, concat, scan, density, bib, report) is fully wired and tested. The revise placeholder (deterministic `remove`) reaches an identical terminal patched DRAFT.md in both tiers (parity test GREEN). Both are the documented pre-model-transport seam, consistent with the existing Tier-2 stance for plan/write/research. ℹ Info.
- `defaultProposeSwap` (revise.ts:206-216) throws loudly if no transport injected — fail-loud, not a silent stub. ℹ Info.

### Scope Note on SC#4 (letter-suffix path-walking)

D-15 / CONTEXT.md scopes Phase 4's letter-suffix obligation to **reservation + tolerance**, explicitly excluding insertion entry points ("Phase 4 does not ship insertion entry points; that belongs to Phase 8"). The current compile/scheduler section-discovery derives the directory from OUTLINE.md `n`+`slug` as `NN-slug` (no readdir, no `parseSectionDirName` call yet), so a `03b-` directory is only addressable once Phase 8 ships the insertion + outline-mutation surface that emits the suffix. This is the documented design (04-02 SUMMARY: "ships before any Phase-4 caller by design — cheap insurance"). The traversal-safe parser and lexicographic-sort invariant required by SC#4 are present and tested. The `verified_against_draft_hash` compile-staleness half of SC#4 is fully wired and tested. **SC#4 is satisfied within Phase 4's defined boundary**; the live letter-suffix insertion path is correctly deferred to Phase 8 (Phase 8 goal confirms it owns `add`).

### Human Verification Required

None. This phase produces deterministic, fully-testable code (no visual UI, no live-LLM behavior gated on the phase goal — the LLM smoother/swap transports are injectable seams whose contracts are exercised by cassette-backed tests, and their best-effort/non-blocking nature is structurally enforced). The full `npm run check` gate passes at exit 0.

### Gaps Summary

No gaps. All 5 ROADMAP success criteria are verified against the codebase with file:line + passing-test evidence. The single SC#5 deviation (revise delivered via `plan --revise` rather than a standalone verb) matches SC#5's literal wording and preserves the locked-16-verb / 16-workflow-bijection invariants; both surfaces delegate to one `runRevise` chokepoint. The compile refuse-gate is structurally unbypassable (refuse early-return precedes every write). All 13 phase requirements are satisfied. Full gate GREEN: 632/632 tests, lint/tsc/build/manifests clean.

---

_Verified: 2026-06-17T12:30:00Z_
_Verifier: Claude (gsd-verifier)_
