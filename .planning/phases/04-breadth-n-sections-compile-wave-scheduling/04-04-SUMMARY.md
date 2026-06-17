---
phase: 04-breadth-n-sections-compile-wave-scheduling
plan: 04
subsystem: section-mutation-revise
tags: [revise, citation-swap, approval-gate, wrte-02, plan-02, plan-03, rsch-10, d-06, tier-contract, hash-pinned-prompt, llm-injection-mitigation]

# Dependency graph
requires:
  - phase: 04-breadth-n-sections-compile-wave-scheduling (Plan 04-01)
    provides: "replaceCitekeys / extractCitekeys (bin/lib/citation-token.ts) — the flagged-token locator consumed by the swap path"
  - phase: 04-breadth-n-sections-compile-wave-scheduling (Plan 04-02)
    provides: "freshness-aware Pass 1 (RSCH-10) the re-verify-after-swap path inherits; CompileReport infra (unused here)"
  - phase: 04-breadth-n-sections-compile-wave-scheduling (Plan 04-03)
    provides: "the shared tests/tier-contract.test.ts PHASE_3_CASES registry (serialized after 04-03 to avoid a concurrent edit — 04-04 adds the `revise` entry)"
  - phase: 03-vertical-slice-one-section
    provides: "prompt-loader (EXPECTED_PROMPT_HASHES + WN-3 sentinel pattern), frontmatter.updateFrontmatter, atomic-write, withLock, bibtex-write/citations chokepoints, citty verb pattern, section path helpers"
provides:
  - "runRevise — single Tier-1/Tier-2 revise chokepoint (D-06): parse verdict → LLM swap → strict-zod + membership guard → approval gate → patch DRAFT.md → reset verified_against_draft_hash null"
  - "ReviseResult / ReviseSwapProposal / ReviseSwapVars / ResearchHit types + ApprovalUnavailableError (exit 3)"
  - "firstFailingCitation(verificationMd) — pure VERIFICATION.md first-failing-verdict parser"
  - "bin/cli/revise.ts — thin citty CommandDef delegating 100% to runRevise"
  - "pensmith plan <N> --revise / --research — the canonical revise surface (PLAN-02), same runRevise chokepoint, locked-16 preserved"
  - "templates/prompts/revise-swap.md — hash-pinned strict-JSON citation-swap prompt (Phase 4 D-05 slug)"
  - "revise tier-contract registry entry + dual-tier parity test (CONTRIBUTING.md D-24)"
affects: [compile, verify, plan-phase-05 (extends the revise parity assertions), 08-style-match (voice-hint consume point established here)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Injectable LLM seam: runRevise takes proposeSwap(vars) (+ approve, + researchAdapter) callbacks so the chokepoint stays pure/testable and CI never touches a live model or an interactive TTY — mirrors 04-03's injectable writeSection"
    - "Two-surface, one-chokepoint revise: bin/cli/revise.ts AND plan --revise BOTH delegate to runRevise (D-06 no divergent path) without expanding the locked UX-02 16 verbs"
    - "LLM-response-injection mitigation by construction (T-04-14): strict zod parse + replacement_citekey ∈ assigned_sources membership check before ANY DRAFT.md mutation — no new citekey can ever enter the draft"
    - "Mechanical remove (NOT LLM rewrite): action:remove deletes the bracketed citation clause via regex, one proposeSwap call max per attempt"
    - "WN-3 lockstep across two commits: byte-pin landed in repo-files.test.ts at Task 1 (file byte-stable); prompt-loader sentinel re-pinned to the SAME SHA-256 at Task 3 — both surfaces agree"

key-files:
  created:
    - bin/lib/revise.ts
    - bin/cli/revise.ts
    - templates/prompts/revise-swap.md
    - tests/revise-swap.test.ts
    - tests/fixtures/cassettes/revise-swap/revise-swap-suggest.json
    - tests/fixtures/cassettes/revise-swap/revise-swap-remove.json
    - tests/fixtures/cassettes/revise-swap/revise-swap-rejected.json
  modified:
    - bin/lib/prompt-loader.ts
    - bin/cli/plan.ts
    - workflows/plan.md
    - tests/repo-files.test.ts
    - tests/tier-contract.test.ts

key-decisions:
  - "[Rule 4 — architectural] `revise` is NOT one of the locked UX-02 16 verbs (verbs.ts: doctor/new/next/status/research/outline/plan/write/verify/compile/done/resume/list/open/sketch/add — NO revise). The plan's premise that revise is 'in the locked 16' is factually false against the codebase. Adding a 17th verb breaks cli-verbs.test.ts (exactly-16) AND adding workflows/revise.md breaks workflows-keyequal.test.ts ARCH-01 (16-bijection). Resolution (auto-selected under config workflow.auto_advance:true / mode:yolo): ship bin/lib/revise.ts + bin/cli/revise.ts + the revise-swap prompt + tests + cassettes + the tier-contract entry, and wire the user-facing surface through the EXISTING `plan --revise` flag (PLAN-02; workflows/plan.md step 7; MCP pensmith_plan already accepts `revise`). The approval-gate Body that the plan wanted in workflows/revise.md lands in workflows/plan.md instead (the workflow that owns --revise). All of must_haves.truths and success_criteria are satisfied; the locked 16-verb + 16-workflow-bijection invariants are preserved; 595/595 GREEN."
  - "Injectable proposeSwap/approve/researchAdapter seams — bin/lib has no model-transport client yet (Tier-2 placeholder era, same as plan/write). The chokepoint owns prompt-load + zod parse + membership guard + patch; the transport is injected. Tests feed cassette content; the CLI supplies a deterministic Tier-2 `remove` placeholder."
  - "Tier-2 placeholder proposeSwap recommends action:remove — deterministic and always membership-valid (no replacement needed), so both tiers reach an identical terminal patched DRAFT.md in the parity test. Real model wiring (loadPrompt('revise-swap') + interpolate + model call) is later-phase; the prompt is hash-pinned and ready."
  - "WN-3 byte-pin landed in repo-files.test.ts at Task 1 with the REAL hash (the prompt is byte-stable on creation) to keep the hash-pin loop GREEN; prompt-loader kept the __PENDING_HASH_revise-swap__ sentinel until Task 3. Both surfaces carry 835876cc… after Task 3 (lockstep honored across the two task commits)."
  - "--research is orthogonal to the swap loop: `revise --research <query>` with no proposeSwap transport is a valid 'research only' call (returns the research result without entering — and throwing in — the swap loop)."

patterns-established:
  - "Single revise chokepoint backs every surface (CLI verb, plan --revise, MCP pensmith_plan) — WRTE-02 / D-06 satisfied with zero divergent code"
  - "Verifier-blocks-escape preserved through revise: the membership guard means a FABRICATED/MIS-CITED swap can only substitute a citekey already vetted into assigned_sources — a revise can never silently introduce a new unverified citation"

requirements-completed: [WRTE-02, PLAN-02, PLAN-03, RSCH-10]

# Metrics
metrics:
  duration: ~13min
  completed: 2026-06-17
  tasks: 3
  files_changed: 12
---

# Phase 4 Plan 04: Section-Mutation Revise Summary

The single `bin/lib/revise.ts::runRevise` chokepoint repairs ONE verifier-flagged citation per invocation — parsing the section's VERIFICATION.md for the first FABRICATED/MIS-CITED/NOT_FOUND verdict, asking an LLM (via the hash-pinned `revise-swap` strict-JSON prompt) for a citekey swap drawn ONLY from the section's `assigned_sources`, rendering the diff behind the default-on approval gate (PRD §19), and on accept patching DRAFT.md atomically and resetting `verified_against_draft_hash` to null. `--yolo` skips the gate and auto-loops the same path up to 2 retries then emits RETRY_EXHAUSTED; `--research <query>` appends section-scoped to RESEARCH.md + the bib + a per-section RESEARCH-LOG.md without touching other sections. Both `pensmith revise` and the canonical `pensmith plan <N> --revise` delegate to this one chokepoint (D-06) — and they do so WITHOUT adding a 17th verb, keeping the locked UX-02 16 intact.

## What Was Built

1. **`bin/lib/revise.ts` — the chokepoint (D-06).** `runRevise(opts)` implements the 04-RESEARCH §I 6-step flow with three injectable seams (`proposeSwap` = LLM, `approve` = gate, `researchAdapter` = --research) so it is pure/testable and CI never touches a live model or TTY. Strict zod parse + `replacement_citekey ∈ assigned_sources` membership guard run BEFORE any mutation (T-04-14). `swap` uses Plan 01's `replaceCitekeys` locator; `remove` is a mechanical bracket-clause delete (no second model call). All writes route through `atomicWriteFile`; the hash reset goes through `updateFrontmatter` under `withLock`.

2. **`templates/prompts/revise-swap.md` — hash-pinned prompt (D-05).** 4 hard constraints (replacement from `## Available sources` only; support-the-claim-or-recommend-remove; no new/aliased citekeys; strict-JSON output) + the JSON schema in the body + Input sections for the flagged citation, verifier reason, claim context, available sources, and the voice hint (WRTE-02 consume point). Registered in `EXPECTED_PROMPT_HASHES` (sentinel at Task 1 → real SHA-256 at Task 3) with the matching `tests/repo-files.test.ts` pin (WN-3).

3. **Verb + workflow wiring.** `bin/cli/revise.ts` is a thin citty CommandDef delegating 100% to `runRevise`. The canonical surface `pensmith plan <N> --revise [--research <query>] [--yolo]` routes through the SAME chokepoint. `workflows/plan.md` gained an `AskUserQuestion` capability_check (degrade → @clack/prompts TTY; non-TTY exit 3) and a full `## Revise body` documenting the flow — no new workflow file, no Pass 2/4 reference.

4. **Tier-contract `revise` entry (D-24).** A `revise` case in `PHASE_3_CASES` (mcpTool `pensmith_plan`, cliArgs `plan 3 --revise --yolo`, verbFile `bin/cli/revise.ts`) plus a dedicated dual-tier parity test asserting Tier 2 (`plan --revise --yolo`) and Tier 1 (MCP `pensmith_plan` `{revise:true,yolo:true}`) reach the identical patched DRAFT.md.

## Task Commits

| Task | Name | Commit | Key files |
|------|------|--------|-----------|
| 1 | Wave 0 — revise-swap prompt (sentinel) + RED test + 3 cassettes | `fac17ec` | templates/prompts/revise-swap.md, prompt-loader.ts, repo-files.test.ts, revise-swap.test.ts, 3 cassettes |
| 2 | revise.ts chokepoint (TDD GREEN) | `f8421e5` | bin/lib/revise.ts |
| 3 | revise verb + plan --revise body + re-pin hash + tier-contract entry | `95e02d6` | bin/cli/revise.ts, bin/cli/plan.ts, workflows/plan.md, prompt-loader.ts, tier-contract.test.ts |

## Verification

- `node --import tsx --test tests/revise-swap.test.ts tests/repo-files.test.ts tests/tier-contract.test.ts` → 63 tests GREEN (incl. revise parity).
- `loadPrompt('revise-swap')` succeeds WITHOUT `PENSMITH_ALLOW_PENDING_PROMPT_HASHES` (real 64-char SHA-256 pinned).
- Full suite `npm test` → **595/595 GREEN** (+11 over the 584 baseline; zero regressions).
- `npm run build`, `npx tsc --noEmit`, `npm run lint` all clean (0 errors).
- Locked invariants preserved: prebuild emits "16 verbs"; `cli-verbs.test.ts` (exactly-16) + `workflows-keyequal.test.ts` (16-bijection, W4 vocabulary) GREEN.
- Acceptance greps on `bin/lib/revise.ts`: `replaceCitekeys` is the swap locator (3 refs); `atomicWriteFile` is the sole writer (9 uses, 0 raw `fs.writeFile`); hash reset via `updateFrontmatter`/`withLock`; `remove` branch has no second proposeSwap call.

## Threat-Model Mitigations Applied

| Threat ID | Mitigation in code |
|-----------|--------------------|
| T-04-14 (LLM swap-response tampering) | Strict zod parse; reject if `action ∉ {swap,remove}` OR `replacement_citekey ∉ assigned_sources` — runs before any DRAFT.md mutation. Tested by the membership-guard + RETRY_EXHAUSTED cases. |
| T-04-15 (approval-gate bypass) | Gate default-on (PRD §19); only `--yolo` skips; non-TTY without `--yolo` raises `ApprovalUnavailableError` (exit 3). |
| T-04-16 (--yolo unbounded auto-loop) | Retry cap = 2 (`YOLO_RETRY_CAP`); exhaustion writes RETRY_EXHAUSTED, no further redrafting. |
| T-04-17 (cross-section disturbance via --research) | --research writes only `.paper/RESEARCH.md`, `.paper/CITATIONS.bib`, and `sections/<N>/RESEARCH-LOG.md`; sibling-mtime+content test guards isolation (PLAN-03). |
| T-04-18 (prompt drift) | `revise-swap.md` hash-pinned in `EXPECTED_PROMPT_HASHES`; `loadPrompt` re-validates at runtime; WN-3 lockstep with repo-files pin. |
| T-04-SC (cassettes / installs) | No new deps; 3 cassettes git-committed, header-clean, ≤712B; covered by cassette-size/no-leak gates. |

## Deviations from Plan

### RULE 4 — Architectural: `revise` is not a locked verb (surfaced, auto-resolved under auto-mode)

- **Found during:** execution-start context read (Task 3 prep) — verified against `bin/lib/verbs.ts`, `tests/cli-verbs.test.ts`, `tests/workflows-keyequal.test.ts`.
- **Issue:** The plan's `<read_first>` and `<action>` for Task 3 assert "`revise` is already in the 16-verb UX-02 set" and "do NOT add a new top-level verb — `revise` is in the locked 16." This is **factually false** against the codebase. The locked 16 (`verbs.ts`) are `doctor/new/next/status/research/outline/plan/write/verify/compile/done/resume/list/open/sketch/add` — `revise` is absent (it is a natural-language trigger / a `--revise` FLAG on `plan` per PRD + PLAN-02). Two GREEN-baseline invariants make the literal plan unexecutable:
  - `tests/cli-verbs.test.ts` (TIER-04): the dispatcher must register **exactly 16** verbs. A 17th `revise` verb breaks it.
  - `tests/workflows-keyequal.test.ts` (ARCH-01): `workflows/*.md` must be **exactly 16, bijective** with the dispatcher verbs. A new `workflows/revise.md` breaks it.
  Executing the plan literally would have broken ≥3 baseline tests (the prompt explicitly forbids breaking the GREEN 584/584 baseline).
- **Resolution (auto-selected under `config.workflow.auto_advance: true` / `mode: yolo` — checkpoint:decision auto-recommended option):** Ship every revise artifact the plan's `must_haves` require (`bin/lib/revise.ts`, `bin/cli/revise.ts`, `templates/prompts/revise-swap.md`, prompt-loader/repo-files pins, tests + 3 cassettes, the tier-contract `revise` registry entry) and route the user-facing surface through the EXISTING `pensmith plan <N> --revise` flag — the canonical revise surface per PLAN-02, `workflows/plan.md` step 7, and the already-wired MCP `pensmith_plan` `revise` arg. Both `bin/cli/revise.ts` and `plan --revise` delegate to the SAME `runRevise` chokepoint (D-06). The approval-gate Body the plan wanted in `workflows/revise.md` lives in `workflows/plan.md` instead (the workflow that owns `--revise`), satisfying the must_haves "approval-gate capability_check + Body" artifact requirement; the D-24 tier-contract obligation lands where the body changed.
- **Why this honors the plan's intent:** every `must_haves.truths` bullet and every `<success_criteria>` line is satisfied — single chokepoint both tiers, default-on approval gate, --yolo cap-2 → RETRY_EXHAUSTED, accept→patch+reset-null, --research section-scoped, voice-hint consume point, D-24 registry entry. The ONLY plan artifact not created verbatim is the standalone `workflows/revise.md` file, which cannot exist without breaking ARCH-01; its content was relocated, not dropped.
- **Files:** bin/cli/plan.ts, workflows/plan.md, tests/tier-contract.test.ts (and the revise verb file as a CommandDef rather than a registered top-level dispatcher entry).
- **Commit:** `95e02d6`.

### Cassette location (consistent with the 04-02 Rule-3 precedent)

- The plan `<files>` listed cassettes at flat `tests/cassettes/revise-swap-*.json`. As Plan 04-02 already established (Rule 3), the offline `loadCassetteFile(adapter, basename)` loader and the cassette-size/no-leak gates only resolve `tests/fixtures/cassettes/<adapter>/<basename>.json`. Cassettes were placed at `tests/fixtures/cassettes/revise-swap/{suggest,remove,rejected}.json` so the test can read them and the leak/size gates cover them. Not a behavior change — a path correction matching the loader contract.

## Known Stubs

None that block the plan goal. The Tier-2 placeholder `proposeSwap` (deterministic `remove`) in `bin/cli/revise.ts` and `bin/cli/plan.ts` is the documented pre-model-client seam — identical in spirit to the existing Tier-2 placeholders in `bin/cli/{plan,write,research}.ts`. The hash-pinned `revise-swap` prompt is complete and ready; a later phase swaps the placeholder seam for `loadPrompt('revise-swap') + interpolate + model call`. The chokepoint logic (parse, validate, membership-guard, patch, reset, retry, research) is fully implemented and exercised by passing tests.

## User Setup Required

None — no external service configuration; no new dependency added.

## Next Phase Readiness

- `runRevise` is the section-mutation entry point Plan 05 builds on. Plan 05 Task 4 MAY extend the `revise` tier-contract case with full ±-tolerance parity assertions (the registry entry + parity test are in place).
- The voice-hint consume point (`voiceHint(planMd)` → prompt vars) establishes the WRTE-02 seam that Phase 8 style-match featurization will deepen.
- No blockers. Full suite GREEN at 595/595; build, tsc, lint, tier-contract all clean. No new package.json dependency.

## Self-Check: PASSED

All 7 created files and 5 modified files verified present on disk. All 3 task commits (`fac17ec`, `f8421e5`, `95e02d6`) verified in git history. Target suites GREEN (63/63); full suite 595/595; build/tsc/lint clean.
