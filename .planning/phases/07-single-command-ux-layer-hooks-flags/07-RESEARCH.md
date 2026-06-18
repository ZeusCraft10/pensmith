# Phase 7: Single-Command UX Layer + Hooks + Flags — Research

**Researched:** 2026-06-18
**Domain:** Claude Code hook mechanics / citty CLI routing / state-machine UX / flag implementation
**Confidence:** HIGH

---

## Summary

Phase 7 is almost entirely a wiring phase, not a net-new invention phase. The codebase already has: all 16 verbs registered in `bin/pensmith.ts` REAL_VERB_LOADERS (10 real, 6 stubs), the HANDOFF.json schema finalized in `bin/lib/schemas/handoff.ts`, the PreCompact hook body in `hooks/pre-compact.ts`, a throttled PostToolUse in `hooks/post-tool-use.ts`, the session-log with `setMirrorPromptsToStderr` already hooked to the --show-prompts signal, and `bin/lib/budget.ts` + `bin/lib/pricing.ts` providing the cost ledger. The four hook stubs that matter (SessionStart, Stop) are exit-0 no-ops waiting to be wired.

The primary work is: (a) implement `bin/lib/router.ts` — the bare `/pensmith` state-aware decision table that reads STATE.json + PLAN.md frontmatter and selects the next verb; (b) wire the plumbing namespace (`/pensmith:plan-section` etc.) as skill descriptions in `skills/`; (c) upgrade session-start.ts and stop.ts from no-op stubs to real implementations; (d) build `bin/lib/estimator.ts` — the `--estimate` flag dry-run token projector; and (e) implement `--dry-run` mode using the already-present `http-mock.ts` + `isOfflineMode()` pattern PLUS the already-present `PENSMITH_NO_LLM` guard at the LLM call sites.

Claude Code hooks in the current API use `hooks/hooks.json` in the plugin bundle (confirmed from the official docs and the repo's own `hooks-noop.test.ts`). The four event names are: `SessionStart`, `PreCompact`, `PostToolUse`, `Stop`. The hooks.json schema uses `{ schemaVersion, hooks: [{ event, script }] }` — the repo already has this wired and tested. The CRITICAL finding is that Claude Code's official docs define PreCompact timeout as the default 600s, not a special 10s limit; the "10s timeout" for PreCompact in TIER-03 is a PROJECT-IMPOSED budget constraint that the planner must implement via `Promise.race` + `AbortController` in pre-compact.ts, not a platform limit.

**Primary recommendation:** Build `bin/lib/router.ts` as the state-aware bare-command engine; upgrade hook stubs inline (session-start.ts and stop.ts); implement estimator.ts as a pure cost-projection pass with no LLM calls; wire --dry-run to the isOfflineMode() cassette gate for SOURCE adapters AND to the existing `PENSMITH_NO_LLM` guard for the LLM call sites (pass2/pass4).

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UX-01 | `/pensmith` bare command resolves state-aware behavior | Router decision table reading STATE.json + PLAN.md frontmatter sections |
| UX-02 | Verb shortcuts work in BOTH tiers; maps to locked 16 | REAL_VERB_LOADERS already covers 10; 6 stubs need real loaders (resume, list, open, sketch, add, next/status) or stay stubs per Phase 8 scope |
| UX-03 | Hidden plumbing namespace `/pensmith:plan-section` etc. | Skill files in `skills/` with colon-prefix names + plugin.json skills array |
| UX-04 | Skill descriptions optimized for NL triggering | Write skill description strings targeting the user phrases from PRD §5.4 |
| UX-05 | Inline conversational corrections routed to correct skill | Skill description strings + the workflow bodies already handle the fork |
| ERGO-01 | `--dry-run` uses cached fixtures, zero external calls | Wire PENSMITH_NETWORK_TESTS='' + isOfflineMode() gate for source adapters; PENSMITH_NO_LLM='1' for the LLM call sites |
| ERGO-02 | `--estimate` projects tokens+USD before executing | `bin/lib/estimator.ts` (new): dry-run pass via estimateCost() from pricing.ts |
| ERGO-03 | `--yolo` skips outline+export approval gates; refuses >50% cap | Already partially wired in compile.ts + done.ts; add session-cap pre-flight in dispatcher |
| ERGO-04 | `--show-prompts` echoes every LLM prompt | `setMirrorPromptsToStderr(true)` already exists in session-log.ts; just wire the flag |
| HOOK-01 | PreCompact writes section-granular HANDOFF.json ≤5KB, 10s timeout | hooks/pre-compact.ts already has the body; add Promise.race(10_000) timeout gate |
| HOOK-02 | SessionStart hook auto-invokes resume skill | Upgrade session-start.ts stub to read HANDOFF.json + emit stdout context |
| HOOK-03 | PostToolUse mid-session checkpoint, throttled ≤1/min via mtime gate | hooks/post-tool-use.ts already implements this — DONE, just verify test coverage |
| HOOK-04 | Stop hook releases lock + flushes session log | Upgrade stop.ts stub: call lock release + await chain flush |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| State-aware bare `/pensmith` routing | Tier 2 CLI (`bin/lib/router.ts`) | Tier 1 skill body (`workflows/next.md`) | Both tiers must produce same routing output; Tier 1 skill invokes the same router via MCP resource paper://state |
| Verb shortcuts (new/next/status/etc.) | Tier 2 CLI dispatcher (`bin/pensmith.ts`) | Tier 1 skill files (`skills/`) | citty subCommands for Tier 2; skill description files for Tier 1 |
| Plumbing namespace `/pensmith:plan-section` | Tier 1 plugin manifest (plugin.json skills array) | — | Plugin names with colon syntax; Tier 2 has no colon-prefix concept |
| Natural-language skill routing | Tier 1 model (skill descriptions) | — | Pure model-routing; no code required; description strings are the implementation |
| Inline corrections | Tier 1 skill bodies (workflows/*.md) | Tier 2 verb dispatch | Already handled by section isolation + plan --revise path |
| PreCompact HANDOFF write | Tier 1 hook (`hooks/pre-compact.ts`) | — | Claude Code Tier 1 only; Tier 2 never receives hook events |
| SessionStart resume | Tier 1 hook (`hooks/session-start.ts`) | Tier 2 `pensmith resume` verb | Hook fires automatically in Tier 1; user manually runs `resume` in Tier 2 |
| PostToolUse checkpoint | Tier 1 hook (`hooks/post-tool-use.ts`) | — | Tier 1 only; Tier 2 has no hook reception |
| Stop lock-release + log-flush | Tier 1 hook (`hooks/stop.ts`) | — | Tier 1 only |
| `--dry-run` cassette mode | Tier 2 CLI global flag | Tier 1 skill flag via workflow body | `isOfflineMode()` gates source adapters; `PENSMITH_NO_LLM` gates the LLM call sites — both set by the flag |
| `--estimate` cost projection | Tier 2 CLI global flag + `bin/lib/estimator.ts` | Tier 1 skill flag | estimateCost() from pricing.ts; pure math, no LLM call |
| `--yolo` gate bypass | Both tiers (compile + done already have yolo arg) | — | Add session-cap pre-flight that refuses when estimate >50% (dispatcher, not per-verb) |
| `--show-prompts` mirror | Both tiers (`setMirrorPromptsToStderr`) | — | Already exists; need flag → function call wiring |

---

## Standard Stack

### Core (no new packages — Phase 7 uses existing dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `citty` | ^0.2.2 (locked, D-03) | Verb dispatcher + global flags parsing | Already in use; `defineCommand` accepts top-level `args` for global flags |
| `proper-lockfile` | (existing) | Cross-process lock coordination in hooks | Already used in pre-compact.ts + post-tool-use.ts |
| `zod` | (existing) | HANDOFF.json + STATE.json schema validation | Already used throughout |
| `tsx` | (existing) | Hook script execution without build | hooks-noop.test.ts confirms `--import tsx` execution pattern |

### No New Packages

Phase 7 introduces no new npm packages. All required capabilities already exist in the codebase:
- Cost projection: `estimateCost()` from `bin/lib/pricing.ts` [VERIFIED: codebase grep]
- Offline mode: `isOfflineMode()` from `bin/lib/http-mock.ts` [VERIFIED: codebase grep]
- LLM-call offline guard: `PENSMITH_NO_LLM` honored by `bin/lib/verify/pass2.ts` (runPass2) + `bin/lib/verify/pass4.ts` (runPass4) [VERIFIED: codebase read — pass2.ts:215, pass4.ts:392]
- Session log mirror: `setMirrorPromptsToStderr()` from `bin/lib/session-log.ts` [VERIFIED: codebase grep]
- HANDOFF write: `writeHandoff()` + `assembleHandoff()` from `bin/lib/handoff.ts` [VERIFIED: codebase grep]
- State read: `loadState()` from `bin/lib/state.ts` [VERIFIED: codebase grep]
- Lock release: `release(resource)` standalone export already exists in `bin/lib/lock.ts` [VERIFIED: codebase read — lock.ts:135]

---

## Package Legitimacy Audit

> No new packages are introduced in Phase 7. All dependencies are existing.

| Package | Status |
|---------|--------|
| All dependencies | Pre-existing, already audited in prior phases |

**Packages removed due to slopcheck:** none
**Packages flagged as suspicious:** none

---

## Architecture Patterns

### Bare `/pensmith` State-Aware Router Decision Table

The router reads `.paper/STATE.json` (via `loadState()`) and per-section `PLAN.md` frontmatter (via `parseFrontmatter()`) to determine the next action. This is a pure function: `(paperRoot, flags) → verb | error`.

```
State decision table:

CONDITION                                          → ACTION
─────────────────────────────────────────────────────────────────────────────
STATE.json absent (ENOENT from loadState)          → run `new` (intake)
state.phase === 'intake' or PROJECT.md missing     → run `new`
state.phase === 'research' / RESEARCH.md missing   → run `research`
state.phase === 'outline' / OUTLINE.md missing     → run `outline`
state.phase === 'outline' / OUTLINE.md exists +
  approval pending (no `approved: true` frontmatter)  → open approval gate
All sections in STATE.sections have status='verified' → run `compile`
DRAFT.md exists + FINAL.md missing                 → run `done`
DRAFT.md + FINAL.md both exist                     → print status (done)
Default (sections in progress)                     → plan → write → verify
  next incomplete section (lowest n where status ∉
  {written, verified})

PINNED ORDERING (review H4 — ONE ordering, used by BOTH this file and 07-02):
  resolveNextAction is a PURE next-WORK-verb resolver and IGNORES HANDOFF.json.
  Order of checks:
    1. STATE.json absent                  → { verb:'new' }
    2. RESEARCH.md absent                 → { verb:'research' }
    3. OUTLINE.md absent / zero sections  → { verb:'outline' }
    4. section walk (plan/write/verify)   → first NON-terminal-OR-stuck section (TOTAL map below)
    5. all sections verified, no DRAFT.md → { verb:'compile' }
    6. DRAFT.md, no FINAL.md              → { verb:'done' }
    7. both present                       → { verb:'status', reason:'done' }
    8. guaranteed terminal fallback       → { verb:'status', reason:'attention' }
  resolveNextAction NEVER returns { verb:'resume' }. HANDOFF.json is consumed
  ONLY by the SessionStart hook (emit resume context) and the explicit `resume`
  verb — and `resume` dispatches to resolveNextAction's next WORK verb, never to
  itself. See HANDOFF lifecycle below.

  COMPLETE SECTION-STATE -> VERB MAP (C3-HIGH-1 — TOTAL over SectionStateSchema;
  the function can NEVER fall through to `undefined`). For each section walked in
  ascending `n`, the FIRST section whose state is not 'verified' decides the verb:
    - PLAN.md missing on disk     → { verb:'plan',   n, slug }   (no frontmatter yet)
    - status 'planned'            → { verb:'plan',   n, slug }
    - status 'writing'            → { verb:'write',  n, slug }
    - status 'written'            → { verb:'verify', n, slug }
    - status 'verifying'          → { verb:'verify', n, slug }
    - status 'failed'             → { verb:'verify', n, slug }   (re-attempt verification — NOT 'continue')
    - status 'unverifiable'       → { verb:'verify', n, slug }   (re-attempt verification — NOT 'continue')
    - status 'verified'           → CONTINUE to the next section (the ONLY continue case)
    - any unrecognized status     → { verb:'status', reason:'attention', section:{n,slug} } (defensive; SectionStateSchema is the source of truth, but a hand-edited PLAN.md must not crash routing)
  CRITICAL CHANGE vs. the prior spec: 'failed' and 'unverifiable' are NO LONGER
  treated as 'continue'. Routing a failed/unverifiable section to `verify` means
  the walk RETURNS at the first non-verified section, so the post-walk compile
  branch (step 5) is only ever reached when EVERY section is 'verified'. This
  closes the totality gap where `[verified, failed, verified]` with no DRAFT
  matched NO branch and returned `undefined` (crashing the bare dispatcher's
  decision.verb access — SC1/SC5). Step 8 is an unreachable-by-construction
  belt-and-suspenders terminal return so the TS compiler + runtime both prove
  totality.
```

[VERIFIED: codebase grep — STATE.json schema + SectionStateSchema + HANDOFF schema]

### Plumbing Namespace — Skill File Naming Convention

Claude Code plugin skill names use the file basename as the slash-command name. The colon-prefix plumbing namespace (`/pensmith:plan-section`) is produced by naming skill files with the colon in the registered plugin name within plugin.json's skills array.

```json
// plugin.json (skills addition for plumbing namespace)
{
  "skills": [
    { "name": "pensmith", "file": "skills/pensmith.md" },
    { "name": "pensmith:plan-section", "file": "skills/plan-section.md" },
    { "name": "pensmith:write-section", "file": "skills/write-section.md" },
    ...
  ]
}
```

[ASSUMED — based on GSD reference repo pattern from CLAUDE.md study; exact plugin.json skills array format needs verification against Anthropic plugin schema docs]

### Natural-Language Trigger Routing via Skill Descriptions

Skill descriptions are the ONLY mechanism that routes natural-language phrases to verbs. The model selects a skill by matching the user message against the description field. PRD §5.4 table defines the mapping; the planner must write description strings that capture these phrases.

Example from PRD §5.4:
```
"redo section 3" / "section 3 needs work"  → pensmith:plan, pensmith:write for section 3
"make it sound less AI"                    → pensmith:humanize (folded under done)
"where am I?" / "what's next?"             → pensmith:status
```

Skill description anti-pattern: vague descriptions like "manages sections" route nothing. The skill description MUST contain the target phrases the user would naturally say, per PRD §5.4. [CITED: PRD §5.4]

### PreCompact Hook — 10s Self-Imposed Timeout

The Claude Code platform's default hook timeout is 600s. The TIER-03 requirement specifies a 10s timeout for PreCompact. This must be implemented as a `Promise.race` inside the hook body:

```typescript
// hooks/pre-compact.ts (addition)
const PRECOMPACT_TIMEOUT_MS = 10_000;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`pre-compact timeout after ${ms}ms`)), ms)
    ),
  ]);
}

// In onPreCompact:
await withTimeout(writeHandoff(handoff, paperDir), PRECOMPACT_TIMEOUT_MS);
```

[VERIFIED: official Claude Code hook docs — PreCompact default timeout is platform 600s; 10s is project-spec constraint]

### PostToolUse Checkpoint — Already Implemented

`hooks/post-tool-use.ts` already implements the ≤1/min throttle via proper-lockfile + mtime gate. Reading the file confirms:
- Lock sentinel: `.claude/CHECKPOINTS.jsonl.lock`
- `THROTTLE_MS = 60_000`
- Reads last `ts` field from CHECKPOINTS.jsonl tail to check throttle

**HOOK-03 is complete.** The planner only needs test coverage verification, not new implementation. [VERIFIED: codebase read of hooks/post-tool-use.ts]

### SessionStart Hook — Resume Behavior

SessionStart hook stdout (exit 0) is injected as context for Claude's first turn. The pattern:

```typescript
// hooks/session-start.ts (replacement)
const handoff = readHandoffSync('.paper');  // pure sync read, no LLM
if (handoff) {
  process.stdout.write(JSON.stringify({
    systemMessage: `[pensmith resume] Last stopped at phase '${handoff.phase}', ` +
      `section '${handoff.current_section}', next: ${handoff.next_action}`
  }) + '\n');
}
process.exit(0);
```

The systemMessage field in hook stdout JSON is injected into Claude's context window at session start. This is the official mechanism — no separate "resume" invocation needed in Claude Code Tier 1. [VERIFIED: Claude Code hooks docs — exit 0 JSON.systemMessage is passed to Claude]

### HANDOFF.json Lifecycle (review H4 — consume/clear so resume always advances)

`HANDOFF.json` is a crash-resilience POINTER, not a routing source. A non-`done`
HANDOFF must NOT trap bare `/pensmith` (or `next`/`resume`) in an infinite resume.
The lifecycle:

1. **Write** — `hooks/pre-compact.ts` writes HANDOFF.json (pointers, ≤5KB).
2. **Surface (read-only)** — `hooks/session-start.ts` reads HANDOFF and emits the
   resume context frame. SessionStart does NOT route; it only injects context.
3. **Consume + clear** — the explicit `resume` verb (and SessionStart-driven
   resume in Tier 1) computes the NEXT WORK VERB via `resolveNextAction()`
   (which ignores HANDOFF), prints the resume summary, dispatches to that work
   verb, and then DELETES `.paper/HANDOFF.json` (best-effort `rmSync(..., {force:true})`)
   so a stale HANDOFF cannot re-trigger resume on the next bare invocation.
4. **Routing ignores HANDOFF** — `resolveNextAction()` never reads HANDOFF, so
   bare `/pensmith` always resolves a real work verb (plan/write/verify/compile/done),
   never `resume`. This is the SC1 correctness property.

Net effect: `resume` is one-shot — it hands off to plan/write/verify and clears the
pointer. There is no resume→resume re-entry because `resume` dispatches into the
HANDOFF-blind resolver, and the cleared file is gone for the next bare call.

### Stop Hook — Lock Release + Log Flush

Stop fires when the main agent finishes its reply. The hook must:
1. Release the pensmith concurrent-run lock via `release('.paper')` (standalone export in `bin/lib/lock.ts`)
2. Flush the session-log write chain (call `closeSessionLog()`)

```typescript
// hooks/stop.ts (replacement)
import { closeSessionLog } from '../bin/lib/session-log.js';
import { release } from '../bin/lib/lock.js';

// CRITICAL (review M1 / C2-M2): release('.paper') unlocks a stub that may NOT be
// held — `release` recomputes the stub and calls proper-lockfile.unlock(), which
// REJECTS when the resource is not locked (lock.ts:135 docstring: "ONLY for
// cleanup of orphaned locks held by the current process"). With Promise.all, that
// rejection ABANDONS closeSessionLog() — the log flush is lost. Use
// Promise.allSettled so BOTH always run to completion; an unheld-lock rejection
// must NOT truncate the flush.
await Promise.allSettled([
  release('.paper'),     // best-effort lock release; may reject on an unheld lock
  closeSessionLog(),     // flush write chain — must ALWAYS complete
]);
process.exit(0);
```

**Important (corrected — A2 resolved):** `bin/lib/lock.ts` ALREADY exposes a standalone `release(resource): Promise<void>` (lock.ts:135) — no API extension is needed. The relevant subtlety is NOT the existence of `release`, it is that `release` REJECTS on an unheld lock (no code acquires a `.paper`-keyed resource lock — locks are per-file), so the Stop hook must use `Promise.allSettled` (not `Promise.all`) so the rejected release can never abandon the `closeSessionLog()` flush. [VERIFIED: lock.ts:135 release() + proper-lockfile.unlock semantics]

### --dry-run Flag Implementation

`--dry-run` must guarantee ZERO external calls (ERGO-01) across BOTH egress channels:

1. **Source adapters** (crossref / openalex / semantic-scholar): the `isOfflineMode()` predicate in `bin/lib/http-mock.ts` returns `true` whenever `PENSMITH_NETWORK_TESTS !== '1'`. Setting `PENSMITH_NETWORK_TESTS=''` (never `'1'`) forces every adapter onto cassette fixtures.

2. **The LLM client** (the Anthropic SDK call sites). **CORRECTED (cycle-2 C2-H3 — verified against the actual code):** there is NO model-invocation function in `bin/lib/runtime.ts` — `runtime.ts` is config / API-key load ONLY (`loadRuntimeConfig`, `getProviderApiKey`, `getOpenAlexApiKey`, `getS2ApiKey`). The ONLY live `new Anthropic().messages.create()` calls in the entire codebase are in `bin/lib/verify/pass2.ts` (`runPass2`) and `bin/lib/verify/pass4.ts` (`runPass4` Step-3 AMBIGUOUS labeling). BOTH ALREADY short-circuit to a deterministic UNCLEAR placeholder with ZERO network calls when `process.env['PENSMITH_NO_LLM'] === '1' || !process.env['ANTHROPIC_API_KEY']`. Tier-2 `write` / `research` are placeholders that make NO LLM calls in any mode. So the correct, minimal, no-Phase-5-edit mechanism is: **`--dry-run` sets `PENSMITH_NO_LLM='1'`**, and the EXISTING pass2/pass4 guards skip the live API. There is nothing to add to `runtime.ts`, and no Phase-5 verify code needs to change.

```typescript
// In bin/pensmith.ts pre-dispatch seam (BEFORE runMain / before any verb runs):
if (dryRun) {
  process.env['PENSMITH_NETWORK_TESTS'] = '';  // source adapters → cassettes (isOfflineMode()===true)
  process.env['PENSMITH_NO_LLM'] = '1';        // LLM call sites (pass2/pass4) → offline placeholder, zero egress
  process.env['PENSMITH_DRY_RUN'] = '1';       // advisory marker only (doctor/diagnostics); NOT itself a gate
}
```

The LOAD-BEARING gates are `PENSMITH_NETWORK_TESTS=''` (source adapters) and `PENSMITH_NO_LLM='1'` (LLM call sites — the signal the real sites already honor). `PENSMITH_DRY_RUN` is retained ONLY as a human/doctor-facing marker that dry-run is active; do NOT claim a "runtime.ts model-call seam honors PENSMITH_DRY_RUN" — none exists. The dry-run RED test MUST drive a path that WOULD egress absent the guard: `verify <N> --dry-run` WITH a (fake) `ANTHROPIC_API_KEY` present, asserting zero network egress AND no `COSTS.jsonl` append. Driving `write`/`research` would be VACUOUS — they make zero LLM calls in every mode and so cannot distinguish dry-run from normal operation. [VERIFIED: isOfflineMode() in http-mock.ts:139; PENSMITH_NO_LLM guards in pass2.ts:215 + pass4.ts:392; runtime.ts confirmed config-load only.]

### --estimate Flag Implementation

`bin/lib/estimator.ts` is the new file. It is a DRY-RUN planning pass (no LLM calls) that:
1. Reads STATE.json to determine which verbs will execute
2. For each verb, applies a token-count heuristic (e.g., research = ~50K tokens, write-section = ~15K per section)
3. Calls `estimateCost({ providerId, modelId, inputTokens, outputTokens })` from `pricing.ts`
4. Prints the projection table and total USD cost
5. The 50%-cap REFUSAL is NOT in the estimator — `estimator.ts` computes only the pure `exceedsHalfCap` predicate; the hard `exit(1)` lives in the dispatcher pre-flight (see Pitfall 3 + Pitfall 4)

```typescript
// Example projection table (stdout):
// ┌───────────────┬───────────┬───────────┬────────────┐
// │ Step          │ Input tok │ Output tok│ Est. cost  │
// ├───────────────┼───────────┼───────────┼────────────┤
// │ research      │   50,000  │    8,000  │   $0.18    │
// │ write §1      │   15,000  │    5,000  │   $0.12    │
// │ verify §1     │   20,000  │    3,000  │   $0.07    │
// │ ...           │   ...     │    ...    │   ...      │
// ├───────────────┼───────────┼───────────┼────────────┤
// │ TOTAL         │  300,000  │   60,000  │   $0.90    │
// └───────────────┴───────────┴───────────┴────────────┘
```

Token heuristics are static estimates (not computed by the LLM). They are configurable via a `bin/lib/estimator.ts`-internal `STEP_HEURISTICS` table. [ASSUMED — exact heuristic values need project-specific calibration]

### Recommended Project Structure Additions

```
bin/
├── lib/
│   ├── router.ts          # NEW — bare /pensmith decision table
│   ├── estimator.ts       # NEW — --estimate token+USD projector
│   └── [existing files unchanged]
├── cli/
│   ├── next.ts            # NEW — promote `next` stub to real router call
│   ├── status.ts          # NEW — promote `status` stub to real state display
│   └── resume.ts          # NEW — promote `resume` stub to HANDOFF-aware resume
hooks/
├── session-start.ts       # UPGRADE from exit-0 stub
├── stop.ts                # UPGRADE from exit-0 stub
├── pre-compact.ts         # ADD: 10s timeout wrapper around existing body
├── post-tool-use.ts       # DONE — no changes needed (HOOK-03 already implemented)
skills/
├── pensmith.md            # POPULATE — primary skill description for NL routing
├── [one per plumbing verb] # ADD — plan-section.md, write-section.md, etc.
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-process hook throttle | Custom file-based mutex | `proper-lockfile` (already used in post-tool-use.ts) | Stale-lock detection, realpath:false pattern already established |
| Token cost estimation | LLM self-report of tokens | `estimateCost()` from `bin/lib/pricing.ts` | Pure math; MODEL_PRICES table is deeply frozen and tested |
| Session resume context | Custom transcript parser | Hook stdout `systemMessage` field (Claude Code protocol) | Official mechanism; stdout JSON is injected as Claude context |
| Offline cassette mode | Custom stub server | `isOfflineMode()` from `bin/lib/http-mock.ts` | Already used by all source adapters; zero new code |
| Dry-run LLM gate | New runtime.ts model-call seam | `PENSMITH_NO_LLM` (honored by pass2/pass4 already) | No fictional chokepoint — the real call sites already gate on this env var |
| HANDOFF size enforcement | Manual JSON byte count | `HandoffSchema.refine()` (already present) | Refine throws at parse time if >5120 bytes |
| State-machine routing | Complex FSM library | Pure function reading STATE.json + PLAN.md frontmatter | Simple decision table; no state transitions happen in router |

**Key insight:** Phase 7 is integration, not invention. Every primitive the router and flags need already exists in `bin/lib/`. The work is connecting the inputs (flags, STATE.json) to the already-built functions.

---

## Common Pitfalls

### Pitfall 1: Hook stdout contamination
**What goes wrong:** Any `console.log()` or `process.stdout.write()` in a hook script that isn't the valid JSON protocol output corrupts Claude Code's hook frame. The agent may fail to parse the session-start context or misinterpret Stop as an error.
**Why it happens:** Prior phases document this (STATE.md decision [02-06]). Hook stubs already have `// NEVER console.log here` comments.
**How to avoid:** All hooks must route diagnostics to `process.stderr`. Only intentional protocol JSON goes to stdout. Exit 0 with no stdout is safe (noop).
**Warning signs:** The `hooks-noop.test.ts` test asserts `out === ''` for stdout — run it after any hook change.

### Pitfall 2: PreCompact timeout races
**What goes wrong:** `Promise.race([handoffWrite, timeoutReject])` can resolve the timeout but leave the handoff write dangling if the lock (`proper-lockfile`) hasn't been released. This corrupts `.paper/HANDOFF.json.lock`.
**Why it happens:** `writeHandoff()` acquires a `proper-lockfile` lock. If the write times out, the lock may not be released in time.
**How to avoid:** The 10s timeout MUST be applied OUTSIDE the lock acquisition, not inside it. Or use AbortController + lock.stale (10_000ms) so stale-lock auto-clear covers the race. The existing `writeHandoff()` already sets `stale: 10_000` in its lock options — matching the timeout value is deliberate.
**Warning signs:** A stuck `.paper/HANDOFF.json.lock` file after a PreCompact.

### Pitfall 3: `--yolo` 50% cap check — session cap vs. per-step cap, and SCOPE (review C2-H1)
**What goes wrong:** ARCH-11 says "refuse --yolo when estimate exceeds 50% of session cap." Two distinct ways to get this wrong:
  (a) The session cap is the configured per-session cap (default $5, env override `PENSMITH_COST_CAP_USD` per D-32). `assertBudget` in budget.ts uses per-scope caps (paper/section/task), NOT a global session cap predicate — so the 50% check must be implemented in the estimate projection path, not inside `assertBudget`.
  (b) **SCOPE (C2-H1):** the refusal must fire for ANY command line where `--yolo` is present — NOT only the gate-skipping verbs (compile/done/outline) and bare invocation. Scoping it to gate-bearing verbs leaves `pensmith write --yolo` / `pensmith plan --yolo` over-cap UNREFUSED, which violates the UNQUALIFIED non-negotiable. The pre-flight runs in the dispatcher whenever `--yolo` appears, before any verb dispatch.
**Why it happens:** There is no `sessionCap` field in BudgetSpec; and an over-narrow scope feels "safer" (don't surprise non-gate verbs) but contradicts the unqualified requirement.
**How to avoid:** In the dispatcher pre-flight, whenever `--yolo` is present (any verb, including bare): call `projectEstimate({ paperRoot, sessionCapUsd: <configured cap> })`; if `exceedsHalfCap` → write the refusal to stderr and `process.exit(1)`. This is a pre-flight check, not a mid-run check, and not nested inside `--estimate`. The configured cap is read from `PENSMITH_COST_CAP_USD` (env override, D-32) if set, else the documented $5 default — do NOT reference a `cost_cap_usd` runtime-config field (the runtime-config schema has no such field today; see C2-M3).
**Warning signs:** `pensmith write --yolo` proceeding despite a very large estimate; or `--yolo` crashing in a paper-less directory (see Pitfall 5 — guard `projectEstimate`→`loadState` StateNotFoundError).

### Pitfall 4: citty root `run()` double-executes verbs + applies global flags too late (CORRECTED — prior text was FACTUALLY INVERTED, see review H2)
**What goes wrong (CORRECTED):** The earlier model in this section was WRONG. Verified directly against `node_modules/citty/dist/index.mjs:209-228`: `runCommand` runs a matched subcommand at line 217 and then **falls through and UNCONDITIONALLY runs the parent command's `run()` at line 228** — there is NO early return. So a root `run()` is NOT an either/or with subcommands; it fires *after every explicit verb*. Two concrete failures result:
  (a) **Double execution.** `pensmith compile` runs `compile` (217), then falls into root `run()` (228); a root `run()` whose "bare invocation" branch dispatches the router would resolve and execute a SECOND verb. citty has no built-in "a subcommand already ran" guard.
  (b) **Flags applied too late.** `setMirrorPromptsToStderr(true)` and the `PENSMITH_NO_LLM` / `PENSMITH_NETWORK_TESTS` env mutations placed inside root `run()` execute AFTER the subcommand already ran its LLM/adapter calls — so `--show-prompts` (ERGO-04) and `--dry-run` (ERGO-01) are **no-ops for any explicit verb**.
**Why it happens:** citty's `runCommand` executes child then parent with no short-circuit. The reliable earlier-firing seam is a manual argv pre-parse before `runMain` (global flags may appear after the verb, e.g. `pensmith write --dry-run`); citty would `throw 'No command specified'` (line 225) on a bare invocation, which is exactly why bare routing must NOT go through `runMain` — it calls `resolveNextAction()` directly.
**How to avoid (CORRECTED):** Do NOT add a root `run()`. Instead:
  1. **Global-flag + yolo-cap setup goes in a manual argv pre-parse** in `bin/pensmith.ts` BEFORE `runMain` that scans `process.argv` for `--show-prompts`/`--dry-run`/`--estimate`/`--yolo` and applies the env + mirror setup + yolo cap pre-flight FIRST.
  2. **Bare routing is gated on "no subcommand matched."** The argv pre-parse detects the no-verb case and dispatches `resolveNextAction()` directly; when a verb IS present it calls `runMain(command)` exactly once. This keeps bare `/pensmith` working without ever letting a second verb fire after an explicit one.
**Warning signs:** `pensmith compile` runs compile then ALSO runs a router-resolved verb (double execution); `pensmith write --dry-run` still makes live calls because the env was set after the verb ran.

### Pitfall 5: State-aware routing before any paper exists
**What goes wrong:** `loadState()` throws `StateNotFoundError` when `.paper/STATE.json` doesn't exist. The router AND the estimator/yolo pre-flight must catch this and treat it as "no active paper", NOT as a crash. The router returns `{ verb: 'new' }`; the yolo pre-flight treats a paper-less dir as "nothing to estimate → under-cap → skip gracefully" (NEVER crash).
**Why it happens:** `loadState()` translates ENOENT to a typed error (StateNotFoundError), not to null. Both `resolveNextAction` and `projectEstimate` call `loadState`; both need an explicit catch branch (C2-H1: `pensmith --yolo` in a fresh dir must not crash on the cap pre-flight).
**How to avoid:** `resolveNextAction()` catches `StateNotFoundError` → `{ verb:'new' }`. `projectEstimate()` catches `StateNotFoundError` → returns an empty projection (`rows: []`, `totalUsd: 0`, `exceedsHalfCap: false`) so the yolo pre-flight sees "under cap" and does not exit/crash.
**Warning signs:** `pensmith` (or `pensmith --yolo`) crashes with `StateNotFoundError` in a fresh directory.

### Pitfall 6: hooks/hooks.json format vs settings.json format
**What goes wrong:** The Claude Code docs describe two hook configuration mechanisms: the legacy `hooks/hooks.json` (plugin-bundled, `{ schemaVersion, hooks: [{ event, script }] }`) and the newer `settings.json` format (`{ hooks: { EventName: [{ matcher, hooks: [{ type, command }] }] } }`). The repo uses the legacy plugin-bundled format, which is already tested and working. Using the wrong format causes hooks to not fire.
**Why it happens:** The docs show the newer format prominently; the plugin-bundled format is distinct.
**How to avoid:** Keep the existing `hooks/hooks.json` format. Do NOT migrate to `settings.json`. The `hooks-noop.test.ts` test asserts the current `{ schemaVersion: 1, hooks: [{ event, script }] }` format — this is the locked contract.
**Warning signs:** Hooks silently not firing; `hooks-noop.test.ts` failing.

### Pitfall 7: NL-trigger skill descriptions too vague
**What goes wrong:** A skill description that says "helps with research" never routes "find me some sources" because the phrase doesn't match well.
**Why it happens:** Skill descriptions are matched by the model against the user's message. Vague descriptions route nothing.
**How to avoid:** Per PRD §5.4, include the exact natural-language phrases the user would say. Each skill description MUST explicitly list its trigger phrases. Example: "Use this when the user says 'research my topic', 'find sources', 'look up papers', or 'I need references for...'."
**Warning signs:** User says "redo section 3" and nothing happens (model doesn't select the skill).

### Pitfall 8: --estimate running real LLM calls
**What goes wrong:** An `--estimate` flag that accidentally triggers a real API call before the estimate is shown wastes money and defeats the purpose.
**Why it happens:** If the estimator imports any code path that constructs the Anthropic SDK and calls `messages.create()` (today only pass2/pass4 do that).
**How to avoid:** `estimator.ts` MUST be a pure projection function: reads STATE.json, reads config (for provider+model), calls `estimateCost()` from pricing.ts, prints projection. Zero network calls. Zero LLM calls. It imports ONLY `pricing.ts` + `state.ts` — never `verify/pass2.ts`/`verify/pass4.ts` and never any Anthropic SDK path.
**Warning signs:** Cost appears on COSTS.jsonl before the estimate table is printed.

### Pitfall 9: PostToolUse checkpoint path `.claude/` vs `.paper/`
**What goes wrong:** The existing `post-tool-use.ts` writes to `.claude/CHECKPOINTS.jsonl`, but `bin/lib/checkpoint.ts` writes to `.paper/CHECKPOINTS.jsonl`. These are two different files.
**Why it happens:** The PostToolUse hook uses a hardcoded Claude-session path; the library uses paper-scoped path. They serve different purposes (hook breadcrumbs vs. domain checkpoint).
**How to avoid:** This is intentional — do not merge these. The planner should document both clearly: `.claude/CHECKPOINTS.jsonl` = hook throttle ledger (per-session breadcrumbs), `.paper/CHECKPOINTS.jsonl` = domain-level audit log via `recordCheckpoint()`.
**Warning signs:** Trying to `findCheckpoint()` on the hook-written file and getting nothing.

---

## Code Examples

### Router — State-Aware Decision

**NEVER-THROW INVARIANT (C5-HIGH — load-bearing).** `resolveNextAction` is **TOTAL** and **NEVER throws**: every filesystem-read or parse failure across its ENTIRE input surface — `STATE.json` (loadState), each per-section `PLAN.md` (readFileSync + parseFrontmatter -> `yaml.parseDocument().toJSON()`), and the `existsSync` probes for OUTLINE/DRAFT/FINAL — resolves to a valid `RouterDecision` (`status/attention` or, for a genuinely-absent PLAN.md, `plan`) with a one-line stderr diagnostic on the corrupt path. SC1/SC5 require bare `/pensmith` to never crash on `decision.verb`; that guarantee was hardened for `STATE.json` in cycle 4 (C4-HIGH) but the per-section `PLAN.md` read was left unguarded (cycle 5, claude HIGH). Both `readFileSync` (EACCES/EISDIR/TOCTOU after the `existsSync` probe) and `parseFrontmatter` (malformed YAML, duplicate map keys) THROW; the repo's own `hooks/pre-compact.ts:178-187` wraps this IDENTICAL `parseFrontmatter(readFileSync(planPath,'utf8'))` call in try/catch precisely because it can throw. The guard below mirrors that precedent, distinguishes **file absent -> `plan`** (as today) from **file present-but-corrupt/unreadable -> `status/attention`**, and adds an OUTER try/catch backstop around the whole resolver body as defense-in-depth so NOTHING escapes (per-read guards keep diagnostics specific; the backstop guarantees totality even against an unforeseen throw).

```typescript
// Source: codebase analysis of state.ts + schemas/state.ts + schemas/handoff.ts
import { loadState, StateNotFoundError } from './state.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { paperDir, sectionPlan } from './paths.js';
import { parseFrontmatter } from './frontmatter.js';
import { readFileSync } from 'node:fs';
import type { Handoff } from './schemas/handoff.js';

export type RouterDecision =
  | { verb: 'new' }
  | { verb: 'research' }
  | { verb: 'outline' }
  | { verb: 'plan'; n: number; slug: string }
  | { verb: 'write'; n: number; slug: string }
  | { verb: 'verify'; n: number; slug: string }
  | { verb: 'compile' }
  | { verb: 'done' }
  // C3-HIGH-1: `status.reason` is widened so the resolver is TOTAL — it has a
  // valid return for BOTH the all-done terminus AND a stuck-section terminus,
  // and therefore never falls through to `undefined`.
  //   reason:'done'      → DRAFT.md + FINAL.md both present (nothing left to do)
  //   reason:'attention' → a section is in an unrecognized state, or the
  //                        guaranteed terminal fallback fired (should be
  //                        unreachable by construction, but proves totality)
  | { verb: 'status'; reason: 'done' | 'attention'; section?: { n: number; slug: string } };
// NOTE (H4): resolveNextAction does NOT emit a 'resume' decision. The { verb:'resume' }
// arm lives only for the explicit `resume` VERB's own return typing, handled in
// bin/cli/resume.ts; resolveNextAction always returns a concrete next WORK verb.

export async function resolveNextAction(paperRoot: string): Promise<RouterDecision> {
  // C5-HIGH OUTER BACKSTOP (defense-in-depth): wrap the WHOLE resolver body so
  // that even an unforeseen throw from any fs/parse op resolves to a valid
  // RouterDecision rather than escaping. The per-read guards below keep the
  // diagnostics specific; this backstop guarantees the never-throw invariant
  // holds no matter what. resolveNextAction is TOTAL and NEVER throws.
  try {
    let state;
    try {
      state = await loadState(paperRoot);
    } catch (e) {
      // C4-HIGH: loadState translates ONLY ENOENT -> StateNotFoundError. CATCH-ALL
      // then reclassify: absent file -> new; present-but-corrupt/schema-invalid/
      // forward-incompat/permission-denied -> status/attention. NEVER re-throw.
      if (e instanceof StateNotFoundError) return { verb: 'new' };
      process.stderr.write(
        `[pensmith] STATE.json at ${paperRoot} is unreadable/corrupt: ${(e as Error).message}\n`,
      );
      return { verb: 'status', reason: 'attention' };
    }

    const pDir = paperDir(paperRoot);

    // H4 PINNED ORDERING: resolveNextAction is the next-WORK-verb resolver and
    // IGNORES HANDOFF.json entirely (no { verb:'resume' } is ever returned here).
    // HANDOFF is consumed only by the SessionStart hook and the explicit `resume`
    // verb; `resume` re-dispatches into THIS function so it always makes progress.
    if (!existsSync(join(pDir, 'RESEARCH.md'))) return { verb: 'research' };
    if (!existsSync(join(pDir, 'OUTLINE.md')))  return { verb: 'outline' };

    const sections = state.sections ?? [];
    if (sections.length === 0) return { verb: 'outline' };

    // Walk sections in ascending n; the FIRST non-'verified' section decides the
    // verb. C3-HIGH-1: the map below is TOTAL over SectionStateSchema
    // (planned/writing/written/verifying/verified/failed/unverifiable) — 'verified'
    // is the ONLY 'continue' case. 'failed'/'unverifiable' route BACK to verify
    // (re-attempt), so the walk always RETURNS at the first stuck section and the
    // post-walk compile branch is only reached when EVERY section is verified.
    for (const { n, slug } of sections.sort((a, b) => a.n - b.n)) {
      const planPath = sectionPlan(n, slug, paperRoot);
      // C5-HIGH: distinguish a GENUINELY-ABSENT PLAN.md (-> plan, as today) from a
      // PRESENT-but-corrupt/unreadable one. existsSync==false means absent.
      if (!existsSync(planPath)) return { verb: 'plan', n, slug };

      // C5-HIGH PER-SECTION READ GUARD (mirrors hooks/pre-compact.ts:178-187):
      // BOTH readFileSync (EACCES/EISDIR/TOCTOU after the existsSync probe) and
      // parseFrontmatter -> yaml.parseDocument().toJSON() (malformed YAML,
      // duplicate map keys) can THROW. A present-but-corrupt PLAN.md routes to
      // status/attention (matching the unrecognized-status `default` arm) WITHOUT
      // throwing — NOT to 'plan' (that is the absent-file disposition above).
      let status: string;
      try {
        const { frontmatter } = parseFrontmatter(readFileSync(planPath, 'utf8'));
        status = (frontmatter as { status?: string }).status ?? 'planned';
      } catch (e) {
        process.stderr.write(
          `[pensmith] PLAN.md for section ${n} (${slug}) is unreadable/corrupt: ` +
            `${(e as Error).message}\n`,
        );
        return { verb: 'status', reason: 'attention', section: { n, slug } };
      }

      switch (status) {
        case 'verified':
          continue;                                   // ONLY continue case
        case 'planned':
          return { verb: 'plan',   n, slug };
        case 'writing':
          return { verb: 'write',  n, slug };
        case 'written':
        case 'verifying':
        case 'failed':                                // re-attempt verification
        case 'unverifiable':                          // re-attempt verification
          return { verb: 'verify', n, slug };
        default:
          // Unrecognized status (hand-edited PLAN.md). Do NOT fall through to
          // undefined — surface a stuck-section status instead.
          return { verb: 'status', reason: 'attention', section: { n, slug } };
      }
    }

    // All sections verified (the walk fell through ONLY because every section was
    // 'verified' — 'failed'/'unverifiable' would have returned 'verify' above).
    if (!existsSync(join(pDir, 'DRAFT.md'))) return { verb: 'compile' };
    if (!existsSync(join(pDir, 'FINAL.md'))) return { verb: 'done' };
    return { verb: 'status', reason: 'done' };
  } catch (e) {
    // C5-HIGH BACKSTOP: any fs/parse op that throws despite the per-read guards
    // above lands here. Never let it escape -> status/attention keeps the
    // never-throw invariant total. (Should be unreachable by construction.)
    process.stderr.write(
      `[pensmith] router resolveNextAction hit an unexpected error: ${(e as Error).message}\n`,
    );
    return { verb: 'status', reason: 'attention' };
  }
  // (Unreachable: the try body's branches are exhaustive once the walk completes,
  // and the catch backstop covers every throw — resolveNextAction is provably
  // TOTAL and never returns undefined / never throws.)
}
```

### SessionStart Hook — Emit Resume Context

```typescript
// hooks/session-start.ts (replacement for exit-0 stub)
// Source: official Claude Code hooks docs — systemMessage field in stdout JSON
import { existsSync, readFileSync } from 'node:fs';
import { HandoffSchema } from '../bin/lib/schemas/handoff.js';

const HANDOFF_PATH = '.paper/HANDOFF.json';

function safeReadHandoff() {
  if (!existsSync(HANDOFF_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(HANDOFF_PATH, 'utf8'));
    const r = HandoffSchema.safeParse(raw);
    return r.success ? r.data : null;
  } catch { return null; }
}

const handoff = safeReadHandoff();
if (handoff && handoff.phase !== 'done') {
  const msg = `[pensmith] Auto-resume: phase='${handoff.phase}', ` +
    `section='${handoff.current_section ?? 'none'}'. Next: ${handoff.next_action}. ` +
    `Sections: ${handoff.section_pointers.map(p => `${p.slug}(${p.state})`).join(', ')}`;
  // exit-0 JSON stdout is injected into Claude's first turn context
  process.stdout.write(JSON.stringify({ systemMessage: msg }) + '\n');
}
process.exit(0);
```

### Stop Hook — Lock Release + Log Flush (allSettled, review M1/C2-M2)

```typescript
// hooks/stop.ts (replacement for exit-0 stub)
import { closeSessionLog } from '../bin/lib/session-log.js';
import { release } from '../bin/lib/lock.js';

try {
  // Promise.allSettled (NOT Promise.all): release('.paper') may reject when the
  // resource is not locked (lock.ts:135 — proper-lockfile.unlock of an unheld
  // stub rejects). With Promise.all that rejection abandons closeSessionLog();
  // allSettled guarantees the flush always runs to completion.
  await Promise.allSettled([
    release('.paper'),     // best-effort lock release
    closeSessionLog(),     // flush write chain — ALWAYS completes
  ]);
} catch {
  // never crash the session; diagnostics (if any) go to stderr only
}
process.exit(0);
```

### PreCompact Hook — Add Timeout Wrapper

```typescript
// Addition to hooks/pre-compact.ts onPreCompact function
const PRECOMPACT_TIMEOUT_MS = 10_000;

// Wrap the existing writeHandoff call:
await Promise.race([
  writeHandoff(handoff, paperDir),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('pre-compact: HANDOFF write timed out after 10s')), PRECOMPACT_TIMEOUT_MS)
  ),
]);
// Note: proper-lockfile's stale:10_000 matches this timeout so
// the lock auto-clears if the write never completes
```

### --show-prompts Wiring

```typescript
// In bin/pensmith.ts pre-dispatch argv pre-parse (BEFORE runMain):
// session-log.ts already exports setMirrorPromptsToStderr()
import { setMirrorPromptsToStderr } from './lib/session-log.js';

// In the root defineCommand args:
'show-prompts': { type: 'boolean', description: 'Echo every LLM prompt to stderr.', default: false },

// In the argv pre-parse (before dispatching to subcommand):
if (hasFlag('show-prompts')) {
  setMirrorPromptsToStderr(true);
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Plugin hooks declared in `hooks.json` with legacy `{ schemaVersion, hooks: [{ event, script }] }` | Settings-based `{ hooks: { EventName: [...] } }` format in Claude Code docs | Claude Code 2025+ | Repo uses legacy format; both work; DO NOT migrate |
| SessionStart as exit-0 no-op | SessionStart emits JSON `{ systemMessage }` to inject context | Phase 7 (this phase) | Auto-resume without manual `/pensmith resume` |
| PostToolUse writes raw JSON | PostToolUse is throttled via proper-lockfile + mtime gate | Phase 3 (03-08) | Already done — HOOK-03 is complete |

**Deprecated/outdated:**
- Stop as exit-0 no-op: must be upgraded to release lock + flush session log (via Promise.allSettled).
- SessionStart as exit-0 no-op: must emit HANDOFF.json summary to Claude context.

---

## Runtime State Inventory

> Phase 7 is a wiring/upgrade phase, not a rename/migration phase. No runtime state category applies.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `.claude/CHECKPOINTS.jsonl` (hook breadcrumbs), `.paper/HANDOFF.json` (phase pointer), `.paper/STATE.json` (paper state) | No rename; schema unchanged |
| Live service config | None — pensmith is purely local | None |
| OS-registered state | None | None |
| Secrets/env vars | `PENSMITH_NETWORK_TESTS`, `PENSMITH_NO_LLM` (existing — honored by pass2/pass4), `PENSMITH_DRY_RUN` (new advisory marker), `PENSMITH_COST_CAP_USD` (existing override per D-32) | Add `PENSMITH_DRY_RUN` to doctor probe + docs |
| Build artifacts | `dist/hooks/*.js` (compiled from hooks/*.ts) | Ensure tsc compile covers hooks/ |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All TypeScript hooks | ✓ | v24.16.0 | — |
| tsx | Hook execution (`--import tsx`) | ✓ (confirmed by hooks-noop.test.ts) | (existing) | Build first (but tsx is devDep) |
| proper-lockfile | Stop lock release, PostToolUse | ✓ (existing dep) | (existing) | — |
| zod | Schema validation | ✓ (existing dep) | (existing) | — |
| citty | CLI dispatcher | ✓ (existing dep, ^0.2.2 locked D-03) | ^0.2.2 | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` + tsx |
| Config file | scripts/run-tests.mjs (test discoverer) |
| Quick run command | `node --import tsx --test tests/hooks-noop.test.ts tests/cli-verbs.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UX-01 | bare `pensmith` with no STATE.json → runs intake | unit | `node --import tsx --test tests/pensmith-router.test.ts` | ❌ Wave 0 |
| UX-01 | bare `pensmith` with verified sections → runs compile | unit | `node --import tsx --test tests/pensmith-router.test.ts` | ❌ Wave 0 |
| UX-02 | all 16 verbs registered + loaders resolve | integration | `node --import tsx --test tests/cli-verbs.test.ts` | ✅ exists |
| UX-03 | plumbing namespace skills exist on disk | repo-files | `node --import tsx --test tests/repo-files.test.ts` | ✅ exists (add assertion) |
| UX-04 | skill descriptions contain trigger phrases | snapshot | `node --import tsx --test tests/skill-descriptions.test.ts` | ❌ Wave 0 |
| ERGO-01 | --dry-run produces no network calls (source + LLM) | unit | `node --import tsx --test tests/flags.test.ts` | ❌ Wave 0 |
| ERGO-02 | --estimate prints cost table, no LLM call | unit | `node --import tsx --test tests/estimator.test.ts` | ❌ Wave 0 |
| ERGO-03 | --yolo refuses when estimate > 50% session cap (any verb) | unit | `node --import tsx --test tests/flags.test.ts` | ❌ Wave 0 |
| ERGO-04 | --show-prompts wires setMirrorPromptsToStderr | unit | `node --import tsx --test tests/flags.test.ts` | ❌ Wave 0 |
| HOOK-01 | PreCompact writes HANDOFF.json within 10s | unit | `node --import tsx --test tests/hooks/pre-compact.test.ts` | ❌ Wave 0 |
| HOOK-01 | PreCompact HANDOFF.json ≤5KB | unit | exists → `tests/handoff-size.test.ts` | ✅ exists |
| HOOK-02 | SessionStart emits resume context JSON | unit | `node --import tsx --test tests/hooks/session-start.test.ts` | ❌ Wave 0 |
| HOOK-03 | PostToolUse throttles ≤1/min | unit | verify in hooks-noop.test.ts + post-tool-use.test.ts | partially (hooks-noop tests exit-0 only) |
| HOOK-04 | Stop releases lock + flushes session log (allSettled) | unit | `node --import tsx --test tests/hooks/stop.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --import tsx --test tests/hooks-noop.test.ts tests/cli-verbs.test.ts tests/pensmith-router.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/pensmith-router.test.ts` — covers UX-01 decision table (no STATE.json, mid-progress, all-verified) + H4 non-done-HANDOFF case
- [ ] `tests/estimator.test.ts` — covers ERGO-02 cost projection
- [ ] `tests/flags.test.ts` — covers ERGO-01 (dry-run zero-network on a real LLM-calling verb path), ERGO-03 (yolo 50%-cap refusal for any verb incl. non-gate), ERGO-04 (show-prompts), and the H1/H2/H3 regression gates
- [ ] `tests/hooks/pre-compact.test.ts` — covers HOOK-01 timeout + size
- [ ] `tests/hooks/session-start.test.ts` — covers HOOK-02 resume context
- [ ] `tests/hooks/stop.test.ts` — covers HOOK-04 lock + flush (incl. flush-survives-release-rejection)
- [ ] `tests/skill-descriptions.test.ts` — covers UX-04 NL trigger phrase presence

---

## Security Domain

> `security_enforcement: true` in config.json.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | n/a |
| V3 Session Management | partially | HANDOFF.json is not a session secret; lock file protects concurrent access |
| V4 Access Control | no | local single-user tool |
| V5 Input Validation | yes | Router parses STATE.json via Zod (already gated) |
| V6 Cryptography | no | n/a |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| HANDOFF.json path traversal | Tampering | All paths go through `validateSlug()` + `sectionPlan()` helpers |
| Hook stdout injection | Tampering | Hooks use structured JSON output only; no user-supplied strings in stdout |
| --dry-run bypassing cassette gate | Spoofing | `isOfflineMode()` checks `PENSMITH_NETWORK_TESTS !== '1'`; dry-run MUST NOT set it to `'1'` (sets it to `''`) |
| --dry-run LLM network leak | Information Disclosure | dry-run sets `PENSMITH_NO_LLM='1'`; the real LLM call sites (pass2/pass4) already short-circuit to a zero-egress placeholder under that env var |
| --estimate triggering real LLM | Information Disclosure | estimator.ts imports ONLY pricing.ts + state.ts; never the Anthropic SDK paths in verify/pass2.ts / pass4.ts |
| Skill description NL routing ambiguity | — | Distinct trigger phrases per skill; planner must avoid overlapping descriptions |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Plugin skills with colon-prefix names (`pensmith:plan-section`) are registered via plugin.json `skills` array with the colon in the name field | Architecture Patterns — Plumbing Namespace | Wrong: might need a different manifest field; check Anthropic plugin schema before writing plugin.json |
| A2 | RESOLVED — `bin/lib/lock.ts` ALREADY exposes a standalone `release(resource)` export (lock.ts:135); no API extension is needed. The real subtlety is that `release` REJECTS on an unheld lock, so Stop must use `Promise.allSettled`. | Architecture Patterns — Stop Hook | n/a — verified against lock.ts:135 |
| A3 | CORRECTED — `--dry-run` gates the LLM client by setting `PENSMITH_NO_LLM='1'`, which the EXISTING call sites (`verify/pass2.ts` runPass2 + `verify/pass4.ts` runPass4) already honor. There is NO model-invocation seam in `runtime.ts` (it is config/API-key load only), so no new chokepoint and no Phase-5 edit is needed. | Architecture Patterns — dry-run | n/a — verified against runtime.ts (config-load only), pass2.ts:215, pass4.ts:392 |
| A4 | Static token heuristics for `--estimate` (research=50K, write-section=15K, etc.) are reasonable starting values | Code Examples — estimator | Wrong: actual usage may differ significantly; heuristics should be marked as estimates in the output |
| A5 | `PENSMITH_DRY_RUN` is a new env flag retained as an advisory marker only (the load-bearing gates are `PENSMITH_NETWORK_TESTS=''` + `PENSMITH_NO_LLM='1'`) | Standard Stack | Low risk — marker only; the real gates are pre-existing env vars |

---

## Open Questions

1. **RESOLVED — Does `bin/lib/lock.ts` expose a standalone release for the Stop hook?**
   - Answer: YES. `release(resource): Promise<void>` is exported at lock.ts:135. The Stop hook calls `release('.paper')` directly. The remaining design point is using `Promise.allSettled` so an unheld-lock rejection cannot abandon the session-log flush (review M1/C2-M2).

2. **Does the Claude Code plugin support colon-prefix skill names in plugin.json?**
   - What we know: PRD §5.5 specifies `/pensmith:plan-section` as the plumbing namespace; GSD reference repos use this pattern.
   - What's unclear: Exact plugin.json `skills` array field names and whether colon is allowed.
   - Recommendation: Verify against `.claude-plugin/plugin.json` schema doc before writing skill files; fallback is to document the namespace in CONTRIBUTING.md without plugin-level enforcement.

3. **What is the actual token footprint for each workflow stage?**
   - What we know: `estimator.ts` needs static heuristics; no live calibration data exists.
   - What's unclear: Research = how many tokens? Write-section = how many tokens per 500 words?
   - Recommendation: Use conservative estimates (2× the expected usage); label output as "estimated ± 50%".

4. **Where does the configured session cap come from for the --yolo 50% pre-flight (C2-M3)?**
   - What we know: PRD/D-32 specify `cost_cap_usd` (default $5) with env override `PENSMITH_COST_CAP_USD`. The runtime-config Zod schema has NO `cost_cap_usd` field today, and no migration is planned this phase.
   - What's unclear: whether a runtime-config field should be added now.
   - Recommendation (this phase): read `PENSMITH_COST_CAP_USD` if set, else the documented $5 default. Do NOT reference a nonexistent `cost_cap_usd` runtime-config field. A schema field + migration is a future-phase concern (C2-M3, non-blocking).

---

## Sources

### Primary (HIGH confidence)
- [VERIFIED: codebase] `bin/lib/verbs.ts` — locked 16-verb set
- [VERIFIED: codebase] `hooks/hooks.json` — current hook wiring format `{ schemaVersion: 1, hooks: [{ event, script }] }`
- [VERIFIED: codebase] `hooks/pre-compact.ts` — PreCompact body (complete except timeout)
- [VERIFIED: codebase] `hooks/post-tool-use.ts` — HOOK-03 already implemented
- [VERIFIED: codebase] `hooks/session-start.ts` + `hooks/stop.ts` — exit-0 stubs awaiting upgrade
- [VERIFIED: codebase] `bin/lib/session-log.ts` — `setMirrorPromptsToStderr()` exists
- [VERIFIED: codebase] `bin/lib/http-mock.ts` — `isOfflineMode()` exists at line 139
- [VERIFIED: codebase] `bin/lib/lock.ts` — standalone `release(resource)` exists at line 135 (rejects on unheld lock)
- [VERIFIED: codebase] `bin/lib/runtime.ts` — config/API-key load ONLY; NO model-invocation function
- [VERIFIED: codebase] `bin/lib/verify/pass2.ts:215` + `bin/lib/verify/pass4.ts:392` — the ONLY live `messages.create()` call sites, gated on `PENSMITH_NO_LLM` / `ANTHROPIC_API_KEY`
- [VERIFIED: codebase] `bin/lib/pricing.ts` — `estimateCost()` exists; MODEL_PRICES deeply frozen
- [VERIFIED: codebase] `bin/lib/schemas/handoff.ts` — HANDOFF_MAX_BYTES=5120, schema with refine
- [CITED: https://code.claude.com/docs/en/hooks] Claude Code official hooks reference — event names, stdin schema, stdout protocol, timeout defaults

### Secondary (MEDIUM confidence)
- [CITED: PRD.md §5.1–5.5] State-aware bare command behavior, verb shortcuts, plumbing namespace, NL triggers, inline corrections
- [CITED: REQUIREMENTS.md UX-01..05, ERGO-01..04, HOOK-01..04] Exact requirement language for this phase
- [CITED: STATE.md decisions] Prior-phase architectural decisions locked into the codebase

### Tertiary (LOW confidence)
- [ASSUMED] Colon-prefix skill name in plugin.json (A1 above)
- [ASSUMED] Token heuristic values for estimator.ts (A4 above)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all primitives verified in codebase
- Architecture: HIGH — decision table derived from existing schema types; hook mechanics verified against official docs
- Pitfalls: HIGH — pitfalls 1–6 verified from codebase reading; pitfalls 7–9 from PRD and code patterns; dry-run/yolo seams re-verified against runtime.ts/pass2/pass4/lock.ts (cycle 2)
- NL routing mechanism: HIGH — official Claude Code hook protocol verified
- Skill plumbing namespace: MEDIUM — exact plugin.json schema not confirmed

**Research date:** 2026-06-18
**Valid until:** 2026-07-18 (stable domain; Claude Code hook API changes rarely)
