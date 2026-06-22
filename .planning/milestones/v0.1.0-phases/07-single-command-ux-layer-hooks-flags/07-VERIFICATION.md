---
phase: 07-single-command-ux-layer-hooks-flags
verified: 2026-06-19T00:00:00Z
status: passed
score: 5/5 success criteria verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
human_verification:
  - test: "Live in-chat NL routing (Tier-1, Claude Code)"
    expected: "Typing 'redo section 3', 'make it sound less AI', 'where am I?' in a real Claude Code session selects the correct skill by description and runs the mapped verb path"
    why_human: "Model-routing by skill description cannot be exercised in CI — only the static skill-description CONTENTS are testable. Documented manual-only per known_context / 07-REVIEWS.md accepted MEDIUM. Do NOT block the phase on this."
---

# Phase 7: Single-command UX layer + hooks + flags — Verification Report

**Phase Goal:** `/pensmith` becomes the single state-aware command; verb shortcuts + hidden plumbing namespace; natural-language triggers; inline conversational corrections; resume/PreCompact/PostToolUse/Stop hooks; and the `--yolo` / `--dry-run` / `--estimate` / `--show-prompts` flags.
**Verified:** 2026-06-19
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | `/pensmith` bare resolves state-aware behavior (intake/research/outline/next section/compile/done/resume) from STATE.json + paper://state | ✓ VERIFIED | `resolveNextAction` decision table — router.ts:121-195; bare dispatch path pensmith.ts:299-312. Tests UX-01 (a)-(p) all pass (router.test.ts) |
| 2 | Verb shortcuts (16) work in BOTH tiers; plumbing namespace available for scripting | ✓ VERIFIED | `UX02_VERBS` = 16 (verbs.ts); buildSubCommands pensmith.ts:152-159; tier-contract "verb-shortcut parity next/status/resume in BOTH tiers" + "plumbing-namespace parity" + "no 17th verb" (tier-contract.test.ts, 32/32 pass) |
| 3 | PreCompact section-granular HANDOFF.json <5KB in 10s; SessionStart auto-resume; PostToolUse ≤1/min mtime gate; Stop releases lock + flushes log | ✓ VERIFIED | PreCompact 10s Promise.race pre-compact.ts:75-86; 5120-byte refine handoff.ts:46; SessionStart systemMessage frame session-start.ts:53; PostToolUse THROTTLE_MS=60_000 + mtime gate post-tool-use.ts:19,73 (byte-unchanged since Phase 03); Stop allSettled stop.ts:35. Hook tests 19/19 pass |
| 4 | NL triggers route via skill descriptions; inline conversational corrections work without leaving chat | ✓ VERIFIED (static) / ⚠ live routing human-only | Trigger phrases in skills/pensmith.md:2 + plan-section.md:2; inline corrections → `plan --revise` (plan-section.md:16-27, no 17th verb). nl-triggers + skill-descriptions tests 10/10 pass. LIVE model routing is manual-only (see Human Verification) |
| 5 | `--dry-run` zero external calls; `--estimate` token+USD; `--yolo` skips outline+export approval (default off, REFUSES > 50% cap); `--show-prompts` echoes prompts | ✓ VERIFIED | dry-run sets PENSMITH_NO_LLM='1'+offline pensmith.ts:244-248, honored at pass2.ts:219 / pass4.ts:411 BEFORE egress; estimate table pensmith.ts:265-274; yolo cap hard exit(1) pensmith.ts:254-262; show-prompts setMirrorPromptsToStderr pensmith.ts:241. flags.test.ts 15/15 pass (incl. non-vacuous H3) |

**Score:** 5/5 truths verified (SC4 fully verified for testable surface; live routing routed to human verification, not a gap).

### Load-Bearing Structural Confirmations (Concerns A–G)

| Concern | Claim | Status | Evidence |
| --- | --- | --- | --- |
| **A** | `resolveNextAction` TOTAL + NEVER throws over full SectionStateSchema AND corrupt/absent inputs; catch-all-then-reclassify on loadState; guarded `readSectionState` used by BOTH resolver AND status.ts; dispatchVerb OUTER backstop | ✓ CONFIRMED | catch-all reclassify router.ts:132-140 (StateNotFoundError→new; else→status/attention); guarded `readSectionState` router.ts:93-111 used at router.ts:156 AND status.ts:20,55 (no raw parseFrontmatter remains in status.ts); TOTAL switch w/ default router.ts:162-178; outer backstop router.ts:186-194; dispatchVerb try/catch pensmith.ts:129-144. Unit + e2e tests: C4-HIGH (m,n), C5-HIGH (o,p), C6-HIGH end-to-end execFileSync all pass |
| **B** | citty NO root run(); global flags in argv pre-parse seam BEFORE runMain; bare router dispatched ONLY when no subcommand matched (explicit verbs run once) | ✓ CONFIRMED | Root command has subCommands only, NO run() pensmith.ts:178-180; pre-parse `dispatch()` seam pensmith.ts:239 applies flags before any dispatch; explicit verb → single runMain pensmith.ts:286-291; bare → resolveNextAction pensmith.ts:299. Test "H2: explicit verb runs EXACTLY once" passes |
| **C** | `--yolo` cap pre-flight runs for ANY command line with --yolo (covers write/plan/verify); hard exit(1) when est > 50% cap (cap = PENSMITH_COST_CAP_USD else $5); projectEstimate guards StateNotFoundError/corrupt | ✓ CONFIRMED | `if (hasFlag(argv,'yolo'))` pre-flight (not gated on verb/estimate) pensmith.ts:254; `process.exit(1)` on exceedsHalfCap pensmith.ts:260; cap resolution configuredCapUsd pensmith.ts:195-199; estimator catch-all → empty projection estimator.ts:98-102. Tests H1 (plan/compile/bare --yolo over-cap exit non-zero), C2-H1 (paper-less no-crash), C4-HIGH (corrupt STATE no-crash) pass |
| **D** | `--dry-run` sets PENSMITH_NO_LLM='1' (+offline) so real LLM call sites (pass2/pass4) make ZERO calls; RED test drives `verify --dry-run` WITH a fake key (non-vacuous); no runtime.ts model seam in the dry-run path | ✓ CONFIRMED | pensmith.ts:246 sets PENSMITH_NO_LLM='1'; pass2.ts:219 short-circuits to placeholder BEFORE `new Anthropic()`/messages.create() (pass2.ts:230,255); pass4.ts:411 returns before live branch. Test "H3/C2-H3: `verify <N> --dry-run` with a fake key makes ZERO network calls + appends NO COSTS.jsonl (non-vacuous)" passes. Gate is at the call sites directly, NOT via a runtime model seam |
| **E** | `dispatchVerb` forwards global flags (≥yolo) into bare/next/resume-dispatched verbs so the verb's own approval gate is skipped | ✓ CONFIRMED | mergedArgs forwards yolo/dry-run/estimate/show-prompts pensmith.ts:118-127; bare path pensmith.ts:304-312, next.ts:41-49, resume.ts:66-74 all pass globalFlags. Tests "C3-HIGH-2 (a) BARE" + "(b) RESUME → dispatched gate verb receives yolo:true / skips its gate" pass |
| **F** | `resume` computes next WORK verb via HANDOFF-blind resolver then deletes HANDOFF.json (lifecycle) — never loops on resume | ✓ CONFIRMED | resume reads HANDOFF for summary ONLY resume.ts:48-54; computes verb via resolveNextAction (HANDOFF-blind, never returns 'resume') resume.ts:58; rmSync HANDOFF after dispatch resume.ts:79. Tests "UX-01/H4: valid non-done HANDOFF resolves to next WORK verb, NEVER resume" + "C3-HIGH-2 (b) RESUME" pass |
| **G** | NO 17th verb; 16-workflow bijection intact; every hook obeys stdout protocol (only SessionStart emits a frame; others emit nothing; exit 0); Stop uses Promise.allSettled so flush survives release rejection | ✓ CONFIRMED | UX02_VERBS=16 (verbs.ts); "workflows/ contains exactly 16 markdown bodies" + "workflow filenames bijective with dispatcher verbs" pass; SessionStart sole frame emitter session-start.ts:53; stop/pre-compact/post-tool-use empty stdout (TIER-03/07 tests pass); Stop Promise.allSettled stop.ts:35; "HOOK-04/M1: log flushed EVEN when release rejects" passes |

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `bin/lib/router.ts` | resolveNextAction + readSectionState, total/never-throw | ✓ VERIFIED | 196 lines, substantive; exports resolveNextAction/RouterDecision/readSectionState/SectionStateRead; wired into pensmith.ts/next.ts/status.ts/resume.ts |
| `bin/lib/estimator.ts` | projectEstimate + 50%-cap predicate, guarded | ✓ VERIFIED | 132 lines; exports projectEstimate/EstimateResult; imports pricing.estimateCost; catch-all guard |
| `bin/pensmith.ts` | pre-dispatch seam, 4 flags, yolo cap, dispatchVerb | ✓ VERIFIED | 324 lines; exports dispatchVerb/REAL_VERB_LOADERS/GlobalFlags; no root run() |
| `bin/cli/next.ts` | next verb → resolveNextAction + dispatchVerb | ✓ VERIFIED | Wired; forwards globalFlags |
| `bin/cli/status.ts` | status verb reusing readSectionState | ✓ VERIFIED | Imports readSectionState (no raw parseFrontmatter) |
| `bin/cli/resume.ts` | HANDOFF-aware resume, deletes HANDOFF | ✓ VERIFIED | safeReadHandoff (summary only) + resolveNextAction + rmSync |
| `hooks/session-start.ts` | systemMessage frame emitter | ✓ VERIFIED | Single JSON frame, exit 0 |
| `hooks/stop.ts` | release + closeSessionLog via allSettled | ✓ VERIFIED | Promise.allSettled([release, forceRelease, closeSessionLog]) |
| `hooks/pre-compact.ts` | 10s Promise.race around writeHandoff | ✓ VERIFIED | PRECOMPACT_TIMEOUT_MS=10_000 |
| `hooks/post-tool-use.ts` | HOOK-03 throttle (unchanged) | ✓ VERIFIED | Byte-unchanged since Phase 03 (last commit 532d62b, 2026-05-28) |
| `bin/lib/session-log.ts` | closeSessionLog export | ✓ VERIFIED | Exported at line 269 |
| `.claude-plugin/plugin.json` | skills array w/ colon plumbing namespace | ✓ VERIFIED | 4 skills incl. pensmith:plan-section etc.; manifest validation passes |
| `skills/pensmith.md` + 3 plumbing skills | NL trigger phrases | ✓ VERIFIED | PRD §5.4 phrases present; delegate to resolveNextAction / plan --revise |

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| pensmith.ts | router.ts | resolveNextAction on bare invocation | ✓ WIRED (pensmith.ts:299) |
| pensmith.ts | estimator.ts | projectEstimate in yolo pre-flight | ✓ WIRED (pensmith.ts:255,266) |
| pensmith.ts | session-log.ts | setMirrorPromptsToStderr | ✓ WIRED (pensmith.ts:241) |
| pensmith.ts | PENSMITH_NO_LLM | --dry-run sets env before dispatch | ✓ WIRED (pensmith.ts:246) → honored pass2.ts:219 / pass4.ts:411 |
| status.ts | router.ts | readSectionState (shared guarded helper) | ✓ WIRED (status.ts:20,55) |
| resume.ts | router.ts | resolveNextAction work verb + clear HANDOFF | ✓ WIRED (resume.ts:58,79) |
| stop.ts | lock.ts + session-log.ts | release + closeSessionLog in allSettled | ✓ WIRED (stop.ts:35-39) |
| pre-compact.ts | handoff.ts | Promise.race([writeHandoff, timeout]) | ✓ WIRED (pre-compact.ts:75) |
| session-start.ts | schemas/handoff.ts | HandoffSchema.safeParse | ✓ WIRED (session-start.ts:26) |
| plugin.json | skills/*.md | skills array colon namespace | ✓ WIRED (plugin.json:12-17) |
| skills/pensmith.md | router.ts | bare delegate to resolveNextAction | ✓ WIRED (skills/pensmith.md:15-20) |

### Behavioral Spot-Checks / Probe Execution

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Router/estimator/flags suite | `node --import tsx --test tests/pensmith-router.test.ts tests/estimator.test.ts tests/flags.test.ts` | 41 pass / 0 fail | ✓ PASS |
| Hook suite | `node --import tsx --test tests/hooks/*.test.ts tests/hooks-noop.test.ts` | 19 pass / 0 fail | ✓ PASS |
| NL + skill descriptions | `node --import tsx --test tests/nl-triggers.test.ts tests/skill-descriptions.test.ts` | 10 pass / 0 fail | ✓ PASS |
| Tier-contract parity | `node --import tsx --test tests/tier-contract.test.ts` | 32 pass / 0 fail | ✓ PASS |
| Full gate | `npm run check` | exit 0; 750 tests pass; manifests valid | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| UX-01 | 07-01/02 | Bare /pensmith state-aware | ✓ SATISFIED | router.ts + SC1 tests |
| UX-02 | 07-01/02/04 | 16 verb shortcuts both tiers | ✓ SATISFIED | buildSubCommands + tier-contract parity |
| UX-03 | 07-01/04 | Plumbing namespace /pensmith:plan-section | ✓ SATISFIED | plugin.json:12-17 + plumbing parity test |
| UX-04 | 07-01/04 | Skill descriptions for NL triggers | ✓ SATISFIED (static) | skills/*.md trigger phrases; live = human |
| UX-05 | 07-01/04 | Inline corrections, no 17th verb | ✓ SATISFIED | plan-section.md → plan --revise; no-17th-verb test |
| ERGO-01 | 07-01/02 | --dry-run no external calls | ✓ SATISFIED | PENSMITH_NO_LLM + H3 non-vacuous test |
| ERGO-02 | 07-01/02 | --estimate tokens + USD | ✓ SATISFIED | projectEstimate + estimate table |
| ERGO-03 | 07-01/02 | --yolo skips approval, default off, cap refusal | ✓ SATISFIED | yolo pre-flight exit(1); flags tests |
| ERGO-04 | 07-01/02 | --show-prompts echoes prompts | ✓ SATISFIED | setMirrorPromptsToStderr + H2 test |
| HOOK-01 | 07-01/03 | PreCompact HANDOFF.json 10s timeout | ✓ SATISFIED | Promise.race + 5120 refine; HOOK-01 tests |
| HOOK-02 | 07-01/03 | SessionStart auto-resume | ✓ SATISFIED | systemMessage frame; HOOK-02 (a-c) tests |
| HOOK-03 | 07-01/03 | PostToolUse ≤1/min mtime gate | ✓ SATISFIED | THROTTLE_MS=60_000 (byte-unchanged); HOOK-03 tests |
| HOOK-04 | 07-01/03 | Stop releases lock + flushes log | ✓ SATISFIED | allSettled; HOOK-04/M1 tests |

No orphaned requirements: all 13 phase REQ IDs appear in plan frontmatter AND have implementation evidence.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| (none) | — | No TBD/FIXME/XXX/HACK/PLACEHOLDER/TODO in any Phase 7 modified file | — | Clean — completion is auditable |

The word "stub" appears in code comments only as explanatory context (Phase-2 stubs being promoted to real verbs) — not as live placeholder implementations. No empty-return or console.log-only stubs in the rendering/dispatch paths.

### Accepted MEDIUMs (documented in 07-REVIEWS.md — informational, not gaps)

- **Stop's `release('.paper')` is best-effort orphaned-stub cleanup** — wrapped in Promise.allSettled; the unheld-lock rejection cannot abandon the flush (verified by HOOK-04/M1 test). Accepted.
- **citty undeclared-flag leniency** — flags are applied in the pre-parse seam; explicit verbs declare their own flag set. Accepted.
- **plugin colon-namespace schema** — `pensmith:plan-section` registered; manifest validation passes. Accepted.
- **coarse estimator token heuristics** — STEP_HEURISTICS labeled "estimated ±50%" (estimator.ts:50-62). Intentional. Accepted.

### Human Verification Required

#### 1. Live in-chat natural-language routing (SC4 / UX-03/04/05, Tier-1)

**Test:** In a real Claude Code session with the pensmith plugin loaded, type "redo section 3", "make it sound less AI", and "where am I?".
**Expected:** Claude selects the correct skill by its description and runs the mapped verb (plan --revise + write / done-humanize / status respectively) without leaving the chat.
**Why human:** Model skill-selection by description cannot be exercised in CI — only the static skill-description CONTENTS are testable (and they pass). This is documented manual-only in known_context / 07-REVIEWS.md as an accepted MEDIUM. It is NOT a phase gap; surfaced for completeness.

### Gaps Summary

No gaps. All 5 success criteria are verified in the codebase with file:line and named-test evidence. All 7 load-bearing cross-AI convergence fixes (A–G) are structurally confirmed. The full gate (`npm run check`) exits 0 with 750/750 tests passing, the 16-verb bijection intact, and zero debt markers in modified files. The single human-verification item (live NL routing) is documented manual-only and explicitly not a failure condition.

---

_Verified: 2026-06-19_
_Verifier: Claude (gsd-verifier)_
