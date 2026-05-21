---
phase: 3
cycle: 5
reviewers: [gemini, codex, claude-in-session]
reviewed_at: 2026-05-21T10:39:00Z
head_at_review: 1ba43a8
plans_reviewed:
  - 03-00-PLAN.md
  - 03-01-PLAN.md
  - 03-02-PLAN.md
  - 03-03-PLAN.md
  - 03-04-PLAN.md
  - 03-05-PLAN.md
  - 03-06-PLAN.md
  - 03-07-PLAN.md
  - 03-08-PLAN.md
  - 03-09-PLAN.md
runtime_skipped: "claude CLI (running inside Claude Code — skipped for independence)"
unavailable_clis: [claude-cli, cursor-agent, qwen, coderabbit]
opencode_status: "FAILED — opencode 1.1.34 returned a 0-byte file and the underlying LLM API call to gpt-5-nano errored at the 'title generator' step (AI_APICallError on opencode.ai/zen/v1/responses). Same failure mode as cycle 4. Excluded from cycle-5."
cursor_status: "UNAVAILABLE — only Cursor IDE GUI (Cursor 3.4.20) installed; no cursor-agent headless CLI subcommand. Excluded."
cycle5_summary:
  unresolved_high_count: 0
  unresolved_high_ids: []
  cycle4_fix_status:
    NEW-H-3_status_enum: FULLY RESOLVED (gemini + codex agree — schema, parity, and grep AC all in place)
    M-1_pending_hash_pins_export: PARTIALLY RESOLVED (gemini says fully; codex catches Plan 09 lines 444/454 still showing bare `const PENDING_HASH_PINS` in the Task 9.3.5 "before/after" snippets — could re-introduce the export-bug at execution time)
    M-2_last_verification_field: PARTIALLY RESOLVED (gemini says fully; codex catches sibling field `was_current_at_migration` still NOT in PlanFrontmatterSchema — strict-by-default Zod parsing will strip it, recreating the exact silent-drop problem M-2 fixed for last_verification)
    M-3_per_plan_lock: FULLY RESOLVED (gemini + codex agree — `withLock(planUpdate.path)` wrap present at Plan 03 lines 405-411, nested-lock semantics documented, grep AC in place)
    L-1_disciplines_9key: FULLY RESOLVED (gemini + codex agree — 8-key snippet removed, prose swept to "9 presets")
    L-2_resumePrompt_resumed: FULLY RESOLVED (gemini + codex agree — T-3-LEAK-01 now references `next_action max 200`)
  reviewer_verdicts:
    gemini: NEEDS-CYCLE-N (0 HIGH, 2 MEDIUM, 0 LOW — but both MEDIUMs are not real plan gaps under analysis; see Consensus Analysis)
    codex: NEEDS-CYCLE-6 (0 HIGH, 1 MEDIUM was_current_at_migration, 2 LOW Plan 09 snippets + Plan 06 acceptance enum)
    claude_in_session: NEEDS-CYCLE-6 (0 HIGH, 1 MEDIUM, 2 LOW — converges with Codex; rejects both Gemini MEDIUMs as not-plan-gaps after verification)
  consensus:
    confirmed_plan_gaps:
      - "M-2 sibling field: was_current_at_migration is written by migration (Plan 03 line 397) but not in PlanFrontmatterSchema; strict-by-default Zod parse strips it"
      - "Plan 09 Task 9.3.5 snippets at lines 444 and 454 still use bare `const PENDING_HASH_PINS` — implementer following the literal snippet would strip the M-1 fix"
      - "Plan 06 verify-workflow acceptance criteria at lines 477 and 540 list only 'verifying'/'verified'/'failed' — missing the 'unverifiable' literal that D-08-AMENDED requires the verify verb to persist"
    rejected_as_not_real_gaps:
      - "Gemini MEDIUM #1 (lock retry semantics) — withLock helper from Phase 2 bin/lib/lock.ts already encodes a retry schedule (lines 88-108) and the migration code documents MigrationLockTimeoutError; the plan is NOT brittle on this axis"
      - "Gemini MEDIUM #2 (.refine() interaction with last_verification) — the existing .refine on PlanFrontmatterSchema only checks `!p.depends_on.includes(p.slug)` and never touches last_verification; there is zero interaction surface"
note: |
  Cycle 5 convergence review of cycle-4-amended plans (commit 1ba43a8). HIGH=0 holds.
  All six cycle-4 fixes hit their primary targets; two of them (M-1 and M-2) have small
  collateral gaps that Codex caught with grep-level precision and that an independent
  Claude-in-session re-read confirmed by reading the offending lines directly:

  1. The M-2 schema-strict-by-default decision was the right choice, but the migration
     writes a SECOND extra field (was_current_at_migration) that did NOT get declared.
     Cycle 4 made the schema explicit about ONE field and forgot the other. Either
     declare it (`was_current_at_migration: z.boolean().optional()`) or drop the migration
     emit; otherwise the migration appears to write a useful breadcrumb that Zod silently
     strips on the very next loadState — exactly the failure mode cycle-4 M-2 was fixing.

  2. The M-1 `export` keyword is correctly placed on the live source-of-truth at Plan 00
     line 601, but Plan 09 Task 9.3.5's didactic "before/after" snippets at lines 444
     and 454 still show bare `const`. An implementer following the snippet literally
     when re-pinning hashes would re-introduce the export bug. Either both snippets
     gain `export const` (mirroring the live state) or the snippets reference the live
     line by number rather than re-rendering them.

  3. Plan 06's verify-workflow acceptance criteria need 'unverifiable' added to the
     status-enum gate at lines 477 and 540 — the body amendment correctly handles the
     terminal state but the acceptance gate would falsely PASS a verify implementation
     that never persists 'unverifiable'.

  Gemini surfaced two MEDIUM concerns that did not survive verification: the lock-retry
  concern overlooks the Phase 2 withLock helper's built-in retry schedule; the .refine()
  interaction concern overlooks that the existing refine only touches `depends_on`.
  Both are excluded under the cycle-5 stricter-rule "real plan gap" filter.

  All 3 confirmed items are mechanical text edits (~15 min total replan). No decision
  changes needed; no schema/architecture rework. Recommend NEEDS-CYCLE-6.
---

# Cross-AI Plan Review — Phase 3 Cycle 5 (Vertical Slice Through One Section)

## Cycle 5 Context

This is the FIFTH review pass on the Phase 3 plans. The cycle trajectory has been:
- Cycle 1 (7d70e85 → b3e6230): 5 HIGH closed → 4 → 2.
- Cycle 2 (a86d2df → 8a9dd87): cross-plan wave-order + handoff schema HIGHs closed → 2 → 1.
- Cycle 3 (cd0cdd2 → e39ab05): NEW-H-1 (Cite re-export) + NEW-H-2 (updateFrontmatter pure-string) closed → 1.
- Cycle 4 (4b9d641 → 1ba43a8): NEW-H-3 (status enum 'unverifiable' parity) + 3 MEDIUMs + 2 LOWs closed. Claimed HIGH=0.

This cycle re-reviews the cycle-4-amended plans (commit 1ba43a8) under a STRICTER
convergence rule: orchestrator continues until every MEDIUM/LOW concern that reveals
a real plan gap, ambiguity, or missing safeguard is folded in. Stylistic preferences,
items already addressed in prior cycles, out-of-scope items, and reviewer disagreements
that reflect different threat models (rather than real gaps) are explicitly excluded.

Two highest-risk surfaces from cycle 4 receive extra scrutiny:
- **M-3 nested-lock**: outer state.json lock + inner per-PLAN.md locks. Deadlock-free?
  Compatible timeouts? Lock ordering across multiple PLAN.md paths?
- **M-2 schema change**: `z.unknown().optional()` for `last_verification`. Does it admit
  all the right shapes? Does it interact correctly with the existing `.refine`?
  Does the round-trip preserve the migration's emitted shape?

---

## Gemini Review (Cycle 5)

### Cycle-4 Fix Verification
- **NEW-H-3 (D-08-AMENDED schema enum parity)**: FULLY RESOLVED — The diff for Plan 03 shows the `status` enum now includes `'unverifiable'`, and the plan text confirms this change will be propagated to `SectionStateSchema` and `HandoffSchema`.
- **M-1 (PENDING_HASH_PINS export)**: FULLY RESOLVED — The diff for Plan 00 shows the change from `const` to `export const`, and Plan 09 adds a corresponding dynamic-import test to verify the change.
- **M-2 (last_verification field present)**: FULLY RESOLVED — The diff for Plan 03 confirms the `last_verification: z.unknown().optional()` field has been added to the `PlanFrontmatterSchema`, satisfying the requirement.
- **M-3 (per-PLAN.md lock missing)**: FULLY RESOLVED — The diff for Plan 03 shows the file update operation is now correctly wrapped in a `withLock` call, addressing the missing lock.
- **L-1 (Plan 05 8-key vs 9-key contradiction)**: FULLY RESOLVED — The diff for Plan 05 shows the stale 8-key JSON snippet and contradictory prose have been removed and corrected.
- **L-2 (Plan 08 stale resumePrompt reference)**: FULLY RESOLVED — The diff for Plan 08 shows the outdated reference to `resumePrompt` has been correctly updated to `next_action`.

### New Concerns Introduced by Cycle-4 Amendments
- **MEDIUM** | **Lock acquisition is brittle due to unspecified retry logic.** The M-3 fix introduces a nested lock pattern using `withLock` but fails to specify retry behavior. `proper-lockfile` defaults to `retries: 0`, meaning a transient lock held by an editor or other process will cause the entire migration to fail immediately rather than waiting. This makes the implementation fragile. | **Plan 03**: The `withLock` implementation details should be amended to include a sane retry strategy (e.g., specifying `retries` and `retryWait` options) to ensure robustness against transient file contention.
- **MEDIUM** | **The `z.unknown()` type for `last_verification` creates ambiguity for the schema's existing `.refine()` logic.** The M-2 fix adds `last_verification: z.unknown().optional()`. This is risky because the `PlanFrontmatterSchema` has a pre-existing `.refine()` validation. The refinement function will now receive an object containing a key with a completely unknown type, which could cause the refinement to crash if it makes any assumptions about property types (e.g., during iteration). The plan does not address how the `.refine()` logic should be updated to handle this. | **Plan 03**: The plan must be updated to either (a) use a more specific type than `z.unknown()` for `last_verification` or (b) explicitly detail the necessary changes to the `.refine()` implementation to ensure it can safely handle or ignore the new field.

### Remaining MEDIUM/LOW Concerns Worth Folding In
None — convergence achieved under stricter rule.

### Convergence Recommendation
NEEDS-CYCLE-N — 2 plan-worthy items remain.

While all six specific fixes from the previous cycle were implemented correctly in the plan, the amendments for M-2 and M-3 introduced two new medium-severity concerns related to implementation robustness and correctness. These gaps should be closed before proceeding to ensure the migration process is not brittle and the schema validation does not contain hidden failure modes.

---

## Codex Review (Cycle 5)

### Cycle-4 Fix Verification

- **NEW-H-3 — FULLY RESOLVED**: `PlanFrontmatterSchema.status` includes `'unverifiable'` at `03-03-PLAN.md:274`; `SectionStateSchema` parity is explicitly required at `03-03-PLAN.md:289`; acceptance covers all three schemas at `03-03-PLAN.md:303-307`.
- **M-1 — PARTIALLY RESOLVED**: Plan 00 now uses `export const PENDING_HASH_PINS` at `03-00-PLAN.md:601`, and Plan 09 adds a dynamic-import assertion at `03-09-PLAN.md:485-497`. But Plan 09's replacement snippets still show bare `const PENDING_HASH_PINS` at `03-09-PLAN.md:444` and `03-09-PLAN.md:454`, which can reintroduce the export bug during Task 9.3.5.
- **M-2 — PARTIALLY RESOLVED**: `last_verification: z.unknown().optional()` is present at `03-03-PLAN.md:275`, with round-trip AC at `03-03-PLAN.md:308-311`. However the same migration writes `was_current_at_migration` at `03-03-PLAN.md:397`, and that field is still not schema-declared, so strict/default Zod object parsing can strip it.
- **M-3 — FULLY RESOLVED**: The PLAN.md mutation is wrapped in `withLock(planUpdate.path)` at `03-03-PLAN.md:405-411`, and the outer/inner lock behavior plus timeout error is documented at `03-03-PLAN.md:413` and `03-03-PLAN.md:431-433`.
- **L-1 — FULLY RESOLVED**: Plan 05 now consistently says EXACTLY 9 presets and removes the inline 8-key body at `03-05-PLAN.md:365-367`; acceptance also requires the 9 keys at `03-05-PLAN.md:404-406`.
- **L-2 — FULLY RESOLVED**: T-3-LEAK-01 now references `next_action max 200 chars`, not `resumePrompt`, at `03-08-PLAN.md:448`.

### New Concerns Introduced by Cycle-4 Amendments

- **MEDIUM | M-2 schema strictness leaves `was_current_at_migration` unpreserved**: Cycle-4 chose explicit fields instead of `.passthrough()`, but only added `last_verification`. The migration still writes `was_current_at_migration`, so either add `was_current_at_migration: z.boolean().optional()` to `PlanFrontmatterSchema` or remove that migration output.

### Remaining MEDIUM/LOW Concerns Worth Folding In

- **LOW | Plan 09 can undo the `PENDING_HASH_PINS` export during re-pin**: The Task 9.3.5 "before/after" snippets still use bare `const`. Change both snippets to `export const`, and update the stale illustrative `Object.keys(m.PENDING_HASH_PINS)` command at `03-09-PLAN.md:468` to the array `.map(p => p.slug)` form.
- **LOW | Plan 06 acceptance text still omits `unverifiable` from verify status values**: The body amendment is correct at `03-06-PLAN.md:421-424`, but acceptance/success criteria at `03-06-PLAN.md:477` and `03-06-PLAN.md:540` still list only `verified/failed`. Add `unverifiable` there so the acceptance gate matches D-08-AMENDED.

### Convergence Recommendation

**NEEDS-CYCLE-6 — 3 plan-worthy items remain**

HIGH appears to be 0, and the nested-lock concern is adequately bounded for this slice. The remaining items are small but real plan gaps: one schema preservation bug and two stale snippets/acceptance lines that can mislead implementation or weaken convergence checks.

---

## Claude-in-Session Review (Cycle 5)

### Cycle-4 Fix Verification

- **NEW-H-3 — FULLY RESOLVED**: Verified at three independent code-shape pin points. (a) Plan 03 line 274 PlanFrontmatterSchema.status now has 7 literals including 'unverifiable'. (b) Plan 03 step 4 (line 289) extends SectionStateSchema with the same 7th literal AND declares it the single source of truth (HandoffSchema imports it transitively per line 219). (c) Acceptance criteria (lines 303-307) assert all three schemas accept status='unverifiable' AND a grep gate covers state.ts + plan-frontmatter.ts. All three schemas stay in lock-step.

- **M-1 — PARTIALLY RESOLVED**: Plan 00 line 601 is correct (`export const PENDING_HASH_PINS`). Plan 09 step 4.5 (lines 485-497) adds the fail-fast dynamic-import test. HOWEVER Plan 09 Task 9.3.5 "before" snippet at line 444 shows `const PENDING_HASH_PINS` (no export) and the "after" snippet at line 454 also shows bare `const`. If an implementer applies the "after" snippet literally during re-pin, they would silently strip the `export` keyword that step 4.5 just installed grep-coverage for. The fail-fast test would then catch it at test-execution time, so this is correctly classified as LOW (not MEDIUM) — the safety net exists, but the snippets bait the implementer toward a wrong edit. Codex's classification (LOW) is correct.

- **M-2 — PARTIALLY RESOLVED**: Plan 03 line 275 correctly adds `last_verification: z.unknown().optional()` with explicit-not-passthrough semantics, and lines 308-311 add round-trip acceptance criteria. The cycle-4 fix is internally consistent for `last_verification`. BUT Plan 03 line 397 (in the same migration that motivated the M-2 fix) ALSO writes `was_current_at_migration: true` into the PLAN.md frontmatter when `parsed.currentSection === entry.n` or `parsed.currentSectionSlug === slug`. The schema at lines 267-279 has NO declaration for `was_current_at_migration` AND is NOT `.passthrough()`. By the same logic that drove the M-2 fix (strict-by-default Zod object schemas strip undeclared keys), this breadcrumb will be silently stripped on the very next loadState round-trip. The migration emit is therefore write-once-then-lost: the v1→v2 migration writes it, the next normal load reads PLAN.md through PlanFrontmatterSchema.parse() and the key vanishes. This is the exact failure mode M-2 was patching, missed for the sibling field. MEDIUM, not LOW — confirms Codex.

- **M-3 — FULLY RESOLVED**: Plan 03 lines 405-411 wrap each PLAN.md mutation in `withLock(planUpdate.path)`. The nested-lock design is documented at line 413 (outer = stateJsonPath, inner = planPath, distinct paths, proper-lockfile supports nested acquisition). Lock timeout escalation to `MigrationLockTimeoutError` is specified at lines 413 and 431-433. The grep AC at line 415 (`grep -B2 "updateFrontmatter(text" bin/lib/state.ts` must show `withLock(` within 2 preceding lines) is mechanical and enforceable. Gemini's "brittle retries" concern overlooks that `bin/lib/lock.ts withLock` (Phase 2) already encodes a default retry schedule with exponential backoff (lines 88-108 of lock.ts) — this is the same helper, not a fresh proper-lockfile.lock call. Not a plan gap.

- **L-1 — FULLY RESOLVED**: Plan 05 line 365 removes the prior 8-key JSON snippet and points to the canonical 9-key body in the REVIEWS CONVERGENCE block. Stale prose sweeps at lines 182 and 345 align "9 preset keys". Acceptance criteria at line 406 require the 9-key shape.

- **L-2 — FULLY RESOLVED**: Plan 08 line 448 T-3-LEAK-01 row now lists `next_action max 200 chars` with the D-17 cite. Historical references at lines 108 and 171 are correctly preserved with "GONE" / "older shape" markers per the cycle-4 commit message.

### New Concerns Introduced by Cycle-4 Amendments

- **MEDIUM | Schema-strict regression on sibling migration field**: same finding as Codex. The cycle-4 M-2 fix declared ONE migration-emitted field (`last_verification`) explicitly to defeat strict-by-default stripping, but did not declare the sibling field `was_current_at_migration` that the same migration step writes when the v1 STATE.json's `currentSection` / `currentSectionSlug` matches the section being persisted. PlanFrontmatterSchema is not `.passthrough()`. On the next loadState parse the field is silently dropped — the migration appears to write a useful "this section was current at migration time" breadcrumb for `pensmith status` rendering, but the breadcrumb never survives a single round-trip. Fix: declare `was_current_at_migration: z.boolean().optional()` on PlanFrontmatterSchema (Plan 03 line 275 area) AND add a corresponding round-trip acceptance criterion (Plan 03 lines 308-311 area).

### Remaining MEDIUM/LOW Concerns Worth Folding In

- **LOW | Plan 09 Task 9.3.5 "before/after" snippets re-introduce the `const` bug visually**: same finding as Codex. Plan 09 lines 444 and 454 still show bare `const PENDING_HASH_PINS = ...`. The fail-fast assertion added at lines 485-497 catches the regression at test time, but the snippets bait the implementer toward stripping `export` during the manual re-pin edit. Fix: change both snippets to `export const`, OR rewrite the snippets to "edit Plan 00 line 601 in place by adding `expected: 'sha256...'` to each entry" without reproducing the full block. Either resolves the visual bait.

- **LOW | Plan 06 verify-workflow acceptance enum omits `unverifiable`**: same finding as Codex. Lines 477 (`verify.md body uses D-08 LOCKED enum values: 'verifying', 'verified', 'failed'`) and 540 (`D-08 LOCKED status enum values used in write.md and verify.md ('writing', 'written', 'verifying', 'verified', 'failed')`) list only 6 of the 7 D-08-AMENDED literals. The body amendment at line 423 ("UNVERIFIABLE → 'unverifiable'") and the verdict computation at lines 414-415 do emit the terminal state correctly, but a verify implementation that NEVER persists 'unverifiable' would still pass these acceptance gates. Fix: add `'unverifiable'` to both lists; also extend the verification block at line 530 to include 'unverifiable' in the slug grep. Defense-in-depth alignment with the schema parity already in place at Plan 03.

### Gemini Concerns That Did Not Survive Verification (Excluded)

- **Gemini MEDIUM #1 (lock retry brittleness)**: REJECTED. The migration code calls `withLock(...)` from `bin/lib/lock.ts` — the Phase 2 helper that already encodes a retry schedule with exponential backoff (lock.ts lines 88-108). It does NOT call `proper-lockfile.lock` directly with `retries: 0`. The plan inherits the sane defaults; the design is robust against transient editor contention.

- **Gemini MEDIUM #2 (.refine() interaction with last_verification)**: REJECTED. The existing `.refine` on PlanFrontmatterSchema (Plan 03 lines 276-279) is one line: `(p) => !p.depends_on.includes(p.slug)`. It only inspects the `depends_on` array; it does not iterate other keys, does not call `Object.entries(p)`, does not type-narrow `last_verification`. There is zero interaction surface between `z.unknown()` for `last_verification` and the depends_on no-self-ref check. The concern is theoretical without a real failure path.

### Convergence Recommendation

**NEEDS-CYCLE-6 — 3 plan-worthy items remain**

All three are mechanical text edits (no decision changes, no schema architecture rework). Estimated close-out: ~15 minutes. The three findings are:
1. (MEDIUM) Plan 03: declare `was_current_at_migration: z.boolean().optional()` on PlanFrontmatterSchema, or remove the migration's emit of that field.
2. (LOW) Plan 09: fix the bare-const snippets at lines 444 and 454 to `export const`, or rewrite the task to edit Plan 00 in place.
3. (LOW) Plan 06: add `'unverifiable'` to the acceptance enum lists at lines 477 and 540, and to the verification block at line 530.

After these three are folded in, the cycle-6 review should converge cleanly (no expected new findings — both Gemini and Codex independently report no other plan-worthy items, and the rejected Gemini MEDIUMs do not represent real plan gaps under stricter-rule analysis).

---

## Consensus Summary

### Agreed Strengths
- All 6 cycle-4 fixes hit their named primary targets (Gemini + Codex + Claude agree).
- The M-3 nested-lock design (outer state.json + inner per-PLAN.md, with documented timeout escalation) is sound for this slice (all three reviewers confirm; Gemini's brittleness concern overlooks the existing Phase 2 retry schedule).
- The D-08-AMENDED enum parity is now structurally enforced across all three schemas with both syntactic (grep) and semantic (zod-parse) acceptance criteria.
- The cycle trajectory holds: 5 → 4 → 2 → 1 → 0 HIGH, with the cycle-5 review confirming HIGH=0.

### Agreed Concerns (the three real plan gaps)
- **MEDIUM** — Plan 03 PlanFrontmatterSchema is missing the `was_current_at_migration` declaration. The migration emits this field at line 397 but the schema (strict-by-default per the explicit M-2 decision) will strip it on the next round-trip. Same failure mode that M-2 fixed for `last_verification`, missed for the sibling field. (Codex + Claude.)
- **LOW** — Plan 09 Task 9.3.5 snippets at lines 444 and 454 still show bare `const PENDING_HASH_PINS`. The fail-fast test from step 4.5 catches the regression at test time, but the snippets bait the implementer toward stripping `export` during the re-pin edit. (Codex + Claude.)
- **LOW** — Plan 06 verify-workflow acceptance criteria at lines 477 and 540 list only 6 of the 7 D-08-AMENDED status literals; `'unverifiable'` is absent from the acceptance gate even though the body amendment handles the terminal state correctly. (Codex + Claude.)

### Divergent Views
- **Gemini vs Codex on lock-retry brittleness**: Gemini flags it as MEDIUM; Codex and Claude reject after verifying that `withLock` from Phase 2 lock.ts already encodes a retry schedule. The disagreement reflects Gemini reading the plan in isolation without consulting bin/lib/lock.ts. Not a real plan gap.
- **Gemini vs Codex on .refine() interaction with last_verification**: Gemini flags it as MEDIUM; Codex and Claude reject after verifying that the only `.refine` on PlanFrontmatterSchema inspects only the `depends_on` array. Not a real plan gap.
- **Codex severity (MEDIUM) for was_current_at_migration vs the architectural-recurrence framing (this is the same failure pattern M-2 fixed)**: All three reviewers agree the issue is real; the MEDIUM classification reflects that the migration breadcrumb is non-load-bearing for the verify pipeline (it's a `pensmith status` rendering hint), but the silent-strip is exactly the same architectural flaw the cycle-4 work was meant to close.

### Recommendation

**NEEDS-CYCLE-6** — 3 plan-worthy items remain (1 MEDIUM + 2 LOW). All mechanical text edits to existing plan files. No decisions, schemas, or architecture to revisit. Estimated close-out: ~15 minutes. After cycle 6 amends these three lines, convergence is the expected outcome under the stricter rule.

CYCLE_SUMMARY: current_high=0
