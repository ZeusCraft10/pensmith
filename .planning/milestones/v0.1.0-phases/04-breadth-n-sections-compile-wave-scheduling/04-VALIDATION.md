---
phase: 04
slug: breadth-n-sections-compile-wave-scheduling
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-29
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Pulled from `04-RESEARCH.md` § 3 (Validation Architecture). Planner expands per-plan,
> executor fills `<automated>` blocks per task. Wave 0 of each plan installs the missing
> test files listed below.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (built-in) + `tsx` for TS execution |
| **Config file** | none — `scripts/run-tests.mjs` is the dispatcher |
| **Quick run command** | `node --import tsx --test tests/<changed-area>.test.ts` |
| **Full suite command** | `npm test` |
| **Cassette/contract subset** | `npm run test:tier-contract` |
| **Full check** | `npm run check` (lint + typecheck + build + tier-contract + tests + manifests) |
| **Estimated runtime** | ~60s full suite, <5s per file |

---

## Sampling Rate

- **After every task commit:** Run `node --import tsx --test tests/<changed-area>.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** `npm run check` must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Source: REQUIREMENTS.md (canonical COMP meanings) + 04-CONTEXT.md (locked decisions).
04-RESEARCH.md's COMP-04..07 ID labels were DRIFT and are overruled here. Each row maps a
phase requirement (or load-bearing decision) to its automated test. Wave 0 of each plan
installs the test files marked ❌.

| Req ID | Behavior | Test Type | Automated Command | File Exists |
|--------|----------|-----------|-------------------|-------------|
| ARCH-19 | `Semaphore`-based bounded parallel with `--max-parallel` honored | unit | `node --import tsx --test tests/wave-scheduler.test.ts` | ❌ W0 |
| ARCH-20 | Scheduler holds NO on-disk state (STATE.json unchanged across runs) | integration | `node --import tsx --test tests/scheduler-stateless.test.ts` | ❌ W0 |
| PLAN-02 | PLAN.md `wave: N` frontmatter override is honored | unit | `node --import tsx --test tests/wave-override.test.ts` | ❌ W0 |
| PLAN-03 | Validator REJECTS `wave: N` when `N < max(deps.wave) + 1` | unit | `node --import tsx --test tests/wave-override.test.ts -t reject` | ❌ W0 |
| WRTE-02 | `revise --section N --yolo` patches DRAFT.md and resets `verified_against_draft_hash` | integration | `node --import tsx --test tests/revise-swap.test.ts` | ❌ W0 |
| RSCH-10 | Stale DOI emits WARN, does not block (advisory) | unit (cassette) | `node --import tsx --test tests/freshness-probe.test.ts` | ❌ W0 |
| COMP-01 | Compile REFUSES on Pass 1/3 FABRICATED / MIS-CITED / NOT_FOUND | integration | `node --import tsx --test tests/compile-refuse.test.ts` | ❌ W0 |
| COMP-01 (staleness) | Compile WARNS + auto-re-verifies when frontmatter hash diverges | integration | `node --import tsx --test tests/compile-staleness.test.ts` | ❌ W0 |
| COMP-02 | Compile concat = outline order, not wave order; never modifies `sections/<N>/DRAFT.md` (mtime+hash) | unit | `node --import tsx --test tests/compile-order.test.ts` | ❌ W0 |
| COMP-03 | Smoother runs N-1 times for N sections | integration (cassette) | `node --import tsx --test tests/compile-smoother.test.ts` | ❌ W0 |
| COMP-03 (D-13) | Token-set drift triggers raw-concat fallback + WARN; never mutates `[@citekey]` | unit | `node --import tsx --test tests/smoother-token-protect.test.ts` | ❌ W0 |
| COMP-04 | Cross-section claim-consistency scan produces flags only, never edits, never blocks compile | unit | `node --import tsx --test tests/consistency-scan.test.ts` (04-05) | ❌ W0 |
| COMP-05 | Citation density (per-section + paper-wide mean/stdev) vs. discipline preset target; warn-only | unit | `node --import tsx --test tests/citation-density.test.ts` (04-05) | ❌ W0 |
| COMP-06 | Wave scheduling `computeWaves()` topologically sorts by `depends_on` (Kahn) | unit | `node --import tsx --test tests/wave-scheduler.test.ts -t topo` (04-01 Wave-0 scheduler test) | ❌ W0 |
| COMP-07 | Compile writes `.paper/DRAFT.md` AND `.paper/COMPILE-REPORT.md` | unit / integration | `node --import tsx --test tests/compile-order.test.ts tests/compile-bib-regen.test.ts` (04-05) | ❌ W0 |
| D-07 (atomic-write) | All compile writes route through `atomicWriteFile` sole-writer chokepoint | unit | extend `tests/atomic-write-chokepoint.test.ts` | partial |
| D-19 / COMP-07 (bib regen) | `.paper/CITATIONS.bib` regenerated at compile time (citekey collisions resolved via base-26 suffix) | integration | `node --import tsx --test tests/compile-bib-regen.test.ts` (04-05) | ❌ W0 |
| D-14 (report schema) | COMPILE-REPORT.md matches schema v1 (frontmatter + 5 body sections, fixed order) | unit | `node --import tsx --test tests/compile-report-schema.test.ts` | ❌ W0 |
| D-15 (paths) | `parseSectionDirName("03b-foo")` → `{n:3, letterSuffix:'b', slug:'foo'}`; `'03' < '03b' < '04'` | unit | `node --import tsx --test tests/letter-suffix-paths.test.ts` | ❌ W0 |
| Section isolation | Re-running section N leaves any other section's mtime+hash unchanged (Phase 3 SC-4 → N) | integration | `node --import tsx --test tests/section-isolation-n.test.ts` | ❌ W0 |
| Tier contract (compile) | Tier 1 vs Tier 2 produce equivalent DRAFT.md + COMPILE-REPORT.md (±20% length) | tier-contract | `npm run test:tier-contract` (extend) | partial |
| Tier contract (revise) | Tier 1 vs Tier 2 produce identical citekey patch | tier-contract | `npm run test:tier-contract` (extend) | partial |
| Tier contract (write) | Tier 1 parallel vs Tier 2 sequential produce same final per-section state | tier-contract | `npm run test:tier-contract` (extend) | partial |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · W0 = will be installed in Wave 0*

---

## Wave 0 Requirements

Wave 0 of each plan installs the test files for that plan's REQ-IDs before any production
code lands. Listing here is canonical; per-plan PLAN.md files inherit.

- [ ] `tests/wave-scheduler.test.ts` — ARCH-19, COMP-06 (Kahn topo-sort case)
- [ ] `tests/scheduler-stateless.test.ts` — ARCH-20
- [ ] `tests/wave-override.test.ts` — PLAN-02, PLAN-03
- [ ] `tests/write-orchestrator.test.ts` — wave-driven write orchestration
- [ ] `tests/revise-swap.test.ts` — WRTE-02, D-05/D-06
- [ ] `tests/freshness-probe.test.ts` — RSCH-10
- [ ] `tests/compile-refuse.test.ts` — COMP-01 (verifier-blocks-compile)
- [ ] `tests/compile-staleness.test.ts` — COMP-01 (staleness branch), D-08
- [ ] `tests/compile-order.test.ts` — COMP-02 + COMP-07 (DRAFT.md emission)
- [ ] `tests/compile-smoother.test.ts` — COMP-03
- [ ] `tests/smoother-token-protect.test.ts` — COMP-03 / D-13
- [ ] `tests/citation-density.test.ts` — COMP-05 (density vs discipline preset target)
- [ ] `tests/compile-bib-regen.test.ts` — COMP-07 / D-19 (bib regen)
- [ ] `tests/compile-report-schema.test.ts` — D-14 (report schema v1)
- [ ] `tests/consistency-scan.test.ts` — COMP-04 (consistency flags, never blocks)
- [ ] `tests/letter-suffix-paths.test.ts` — D-15
- [ ] `tests/section-isolation-n.test.ts` — section-as-phase invariant extended to N
- [ ] Cassettes: `tests/cassettes/smoother-{clean,token-drift,multi-paragraph}.json`
- [ ] Cassettes: `tests/cassettes/revise-swap-{suggest,remove,rejected}.json`
- [ ] Cassettes: `tests/cassettes/doi-head-{ok,404}.json`, `retraction-watch-hit.json`
- [ ] Extend `tests/tier-contract.test.ts` — compile + revise + write-wave parity cases

No new test framework install needed; `node:test` + `tsx` + `nock` already in place per Phase 3 03-00 bootstrap.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `--revise` outline-approval gate UX (per PRD §19 non-negotiable) | PLAN-03 / D-05 | Interactive prompt requires human eyes; auto-fixture covers only the `--yolo` branch | Run `pensmith --revise 2` on a fixture with a FABRICATED verdict; confirm the diff preview renders and approval gate blocks until user types `y`. `--yolo` path is fully automated in `tests/revise-swap.test.ts`. |
| Wave progress streaming readability (Tier 1 MCP) | ARCH-19 | Subjective: are wave/section status events legible in MCP transcript? | Run `pensmith compile` on a 5-section fixture in Tier 1; confirm MCP notifications fire per wave start/end. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references above
- [ ] No watch-mode flags (`--watch`, `--watchAll`) used in CI or task verify
- [ ] Feedback latency < 60s per wave
- [ ] `nyquist_compliant: true` set in frontmatter when all checks pass

**Approval:** pending
