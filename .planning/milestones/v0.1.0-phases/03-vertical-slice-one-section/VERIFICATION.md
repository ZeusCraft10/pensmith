---
phase: 03-vertical-slice-one-section
verified: 2026-05-28T00:00:00Z
verdict: PASS-WITH-CAVEATS
goal_summary: >
  A single fixture assignment runs end-to-end through
  intake -> research -> outline -> plan -> write -> verify on ONE section
  in both tiers, with section-as-phase isolation, deterministic
  Pass 1 + Pass 3 only, APA only. The 7 source adapters, the 8 D-12 LOCKED
  prompts (SHA-256 pinned), the strict drafter-input chokepoint, the HANDOFF
  writer at 5 KB cap, the pre-compact + post-tool-use hooks, the 3 MCP-tool
  per-section verbs, and the DOCT-05 wiring probe all ship.
score: 12/12 goal-backward checks PASS
build_gates:
  lint: 0
  typecheck: 0
  build: 0
  tests: { total: 524, pass: 519, fail: 5, skip: 0 }
carry_forward:
  review_findings_medium: 7
  review_findings_low: 6
  review_findings_info: 4
  baseline_test_failures: 5
---

# Phase 3: Vertical Slice — Verification Report

**Phase Goal (ROADMAP §Phase 3 + PRD §15):** A single fixture assignment
runs end-to-end through intake -> research -> outline -> plan -> write ->
verify on ONE section in both Tier 1 and Tier 2, proving the
section-as-phase invariant before scaling to N sections. Deterministic
Pass 1 + Pass 3 only; APA only.

**Verified:** 2026-05-28
**Verdict:** PASS-WITH-CAVEATS
**Re-verification:** No — initial verification after Phase 3 closure +
the 5 HIGH REVIEW fixes (commits 5c38462, d8123e3, 532d62b, b035fdf,
0a4397c).

## Goal-backward checks

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 1 | CLI verbs exist + execute + `yolo: { default: false }` | PASS | `bin/cli/{intake,research,outline,plan,write,verify}.ts` all exist; `yolo` declared with `default: false` at intake:49, outline:36, plan:53, research:48, verify:56, write:45 (grep). |
| 2 | Section-as-phase isolation enforced | PASS | `bin/lib/paths.ts:54` `validateSlug` + `:172` `sectionDir`; `tests/section-isolation.test.ts` "re-doing section 3 leaves sections 01/02/04/05 mtimes unchanged" PASS in test log line. |
| 3 | 7 source adapters present (crossref/openalex/arxiv/pubmed/semanticscholar/unpaywall/retraction-watch) | PASS | All 7 files present under `bin/lib/sources/`; `index.ts:20-28` exports typed registry; `retraction-watch.ts` exports only `fetchById` (D-15) — grep confirms. |
| 4 | 8 D-12 LOCKED prompts loaded by SHA-256, no `__PENDING_HASH__` sentinels | PASS | `bin/lib/prompt-loader.ts:87-101` lists exactly 8 slugs with real 64-char hex SHA-256 hashes; `grep "__PENDING_HASH__" bin/lib/prompt-loader.ts` returns 0; `ls templates/prompts/` returns exactly 8 files. |
| 5 | Strict drafter-input chokepoint (zod `.strict()`) | PASS | `bin/lib/drafter-input.ts:48-71` `DrafterInputSchema = z.object({...}).strict()`; `:86` `assertDrafterInput` throws on extra fields. Test `tests/drafter-input.test.ts` exercises it. |
| 6 | Pass-1 + Pass-3 deterministic; D-13 dormant slugs not loaded by verify.md | PASS | `bin/lib/verify/{pass1,pass3}.ts` present; `grep "pass1-fuzzy-judge\|pass3-quote-checker\|loadPrompt" workflows/verify.md` returns 0 (D-13 dormancy). Known-bad fixtures: Pass-1 flags 10/10 MIS-CITED; Pass-3 flags 10/10 NOT_FOUND (tests PASS in log). |
| 7 | HANDOFF writer at 5 KB cap, D-17 shape | PASS | `bin/lib/handoff.ts` + `bin/lib/schemas/handoff.ts:21` `HANDOFF_MAX_BYTES = 5120`; schema declares `schema_version: z.literal(1)` (number), `last_updated`, `current_section`, `phase` enum, `next_action` max(200), `breadcrumbs.max(5)`, `section_pointers[]`; `.refine` enforces byte-size; explicit guard in `writeHandoff` (WR-02 carry-forward inconsistency, non-blocking). |
| 8 | Hooks: pre-compact writes HANDOFF; post-tool-use throttle ≤1/60s under proper-lockfile (CR-04 fix) | PASS | `hooks/pre-compact.ts` + `hooks/post-tool-use.ts:15` imports `proper-lockfile`; `:43-47` `lock(CHECKPOINTS_LOCK_PATH, ...)` gates read/decide/append block. |
| 9 | MCP-tool surfaces expose 3 per-section verbs | PASS | `mcp/tools.ts:190` `pensmith_plan`, `:212` `pensmith_write`, `:233` `pensmith_verify` registered with input schemas; tier-contract test cases plan-section / write-section / verify-section all PASS. |
| 10 | Doctor probes including DOCT-05 wiring | PASS | `bin/lib/doctor/probes/intake-outline-verify-wiring.ts` exists (DOCT-05); `tests/doctor-probes.test.ts:190` asserts `'intake-outline-verify-wiring' in r` and `:191` asserts exactly 11 probes; test "D-20: runDoctor returns Record keyed by probe.id (11 probes)" PASS in log line. |
| 11 | CR-02 verifier-invariant fix (retraction cross-check + bibtex `note = {RETRACTED}` + regression test) | PASS | `bin/lib/sources/retraction-cross-check.ts:47` `crossCheckRetractions` mutates `c.retracted = true`; `bin/cli/research.ts:23,73` imports and invokes it BEFORE LIBRARY.json persist; `bin/lib/bibtex-write.ts:93` `if (c.retracted === true) entry.note = 'RETRACTED'`; regression test `tests/sources/retraction-cross-check.test.ts` exists. |
| 12 | PRD §15 E2E smoke evidence | PASS | `tests/fixtures/known-good-fixture/{section.md, CITATIONS.bib}` exists; 6 tier-contract cases (intake, research, outline, plan-section, write-section, verify-section) all PASS in log lines 256-274 of the test output; known-bad-citations + known-bad-quotes deterministic verifier suites all PASS. |

## Build/test gates

| Gate | Exit | Notes |
|------|------|-------|
| `npm run lint` | 0 | clean |
| `npm run typecheck` | 0 | clean |
| `npm run build` | 0 | prebuild + tsc clean (version.generated.ts 0.1.0-dev + 16 verbs) |
| `PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1 npm test` | 1 (5 baseline fails) | tests 524 / pass 519 / fail 5 / skip 0 / todo 0 — duration 12.65s |

## Architecture invariants

| Invariant | Status | Evidence |
|-----------|--------|----------|
| D-07 atomic-write chokepoint | PASS | Every persistent write routes through `atomicWriteFile` (handoff, bibtex-write, all 6 CLI verbs). `hooks/post-tool-use.ts` uses `appendFileSync` (throttle/append-only, not durable). REVIEW.md confirms. |
| D-12 LOCKED 8 prompt slugs | PASS | `ls templates/prompts/` returns 8 files; `prompt-loader.ts:87-101` enumerates exactly the same 8. |
| D-13 dormancy (verify.md does not load pass1-fuzzy-judge / pass3-quote-checker) | PASS | `grep "pass1-fuzzy-judge\|pass3-quote-checker\|loadPrompt" workflows/verify.md` returns 0. |
| D-15 retraction-watch fetchById-only | PASS | `grep "^export" bin/lib/sources/retraction-watch.ts` returns only `export async function fetchById`. `bin/lib/sources/retraction-cross-check.ts:54` calls `lookup.fetchById` only. |
| D-17 HANDOFF schema + 5 KB cap | PASS | `bin/lib/schemas/handoff.ts:21,46` + `bin/lib/handoff.ts` explicit guard. |
| D-19 citation-js chokepoint | PASS | `grep "import.*citation-js" bin/`: only `bin/lib/citations.ts:64` (the wrapper). Wrapper consumers: `bin/lib/bibtex-write.ts:33` + `bin/lib/verify/pass1.ts:28` (exactly 2). |
| Verifier-blocks-compile (CLAUDE.md non-negotiable) | PASS | Pass-1 flags 10/10 known-bad-citations as MIS-CITED; Pass-3 flags 10/10 known-bad-quotes as NOT_FOUND; both deterministic (no LLM in scope). |
| Approval-gates default-on | PASS | All 6 verbs declare `yolo: { type: 'boolean', default: false }`. |

## Known carry-forward

The following are explicitly NOT re-evaluated as Phase-3 failures.

### REVIEW.md MEDIUM (7) — carry-forward to Phase 4

1. WR-01: hooks/pre-compact.ts directory walking non-deterministic across platforms.
2. WR-02: HANDOFF refine() stringifies twice + compact-vs-pretty size mismatch.
3. WR-03: assembleHandoff `slice(0, 200)` truncates by code-unit (multi-byte UTF-8 risk).
4. WR-04: bibtex-write header-rewrite regex matches `@string{` / `@comment{` (silent corruption).
5. WR-05: prompt-loader `stripFrontmatter` splits on every `^---\s*$` line.
6. WR-06: post-tool-use reads entire CHECKPOINTS.jsonl per call (O(N²) growth).
7. WR-07: section-planner.md / outline-author.md example slugs include `NN-` prefix (double-prefix risk).

### REVIEW.md LOW (6) — carry-forward

IN-01 (deep-equal NaN), IN-02 (drafter-input dup authors), IN-03 (pubmed.ts no zod parse), IN-04 (bibtex toCsl silent drop) — plus 2 additional LOW REVIEW items.

### REVIEW.md INFO (4) — carry-forward

Documentation / observability suggestions only; non-blocking.

### Baseline test failures (5) — carry-forward, NOT Phase-3 deliverables

1. `schema validation failure throws SchemaValidationError with rich issues` — schemas.test.ts (schema/migration v1).
2. `CURRENT_*_VERSION constants are all 1` — migration.test.ts (version constants).
3. `state: valid example parses` — schemas.test.ts (state).
4. `state: rejects empty paperId / wrong $schemaVersion / bad createdAt` — schemas.test.ts (state).
5. `Case C: paper_advance_section is idempotent` — tier-contract.test.ts (idempotency).

None of the 5 failures touches a Phase-3 deliverable as defined by the
goal-backward checks above:
- (1)/(3)/(4) are schemas-test artifacts for the `state` literal-1
  $schemaVersion gate from Phase 1, not Phase 3's HANDOFF / SourceCandidate
  / PlanFrontmatter / slimmed-State schemas (whose own tests PASS).
- (2) is a Phase-1 / Phase-2 migration constant test.
- (5) is Phase-2 tier-contract idempotency (Case A/B/D PASS; Case C is
  pre-existing in the baseline noted by REVIEW.md and ROADMAP).

## Verdict rationale

All 12 goal-backward checks PASS against the actual codebase, all 3 build
gates exit 0, and the test totals match the documented baseline exactly
(519 pass / 5 fail / 0 skip — same 5 failures as before this verification).
The 5 baseline failures are confirmed pre-existing and do not touch any
Phase-3 deliverable surface. The 7 MEDIUM + 6 LOW + 4 INFO findings from
REVIEW.md are carry-forward to Phase 4 per scope, not regressions.
The 5 HIGH findings (CR-01..CR-05) were closed by the 5 commits cited in
the task brief — re-checked here: CR-02 verified via the new
`retraction-cross-check.ts` module wired into `research.ts` AND the
regression test; CR-04 verified via `proper-lockfile` import + `lock(...)`
block in `post-tool-use.ts`. The verdict is PASS-WITH-CAVEATS because the
goal is achieved while the carry-forward MEDIUMs remain queued for Phase 4.

---

_Verified: 2026-05-28_
_Verifier: Claude (gsd-verifier)_
