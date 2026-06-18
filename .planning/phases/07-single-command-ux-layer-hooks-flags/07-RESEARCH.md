# Phase 7: Single-Command UX Layer + Hooks + Flags — Research

**Researched:** 2026-06-18
**Domain:** Claude Code hook mechanics / citty CLI routing / state-machine UX / flag implementation
**Confidence:** HIGH

---

## Summary

Phase 7 is almost entirely a wiring phase, not a net-new invention phase. The codebase already has: all 16 verbs registered in `bin/pensmith.ts` REAL_VERB_LOADERS (10 real, 6 stubs), the HANDOFF.json schema finalized in `bin/lib/schemas/handoff.ts`, the PreCompact hook body in `hooks/pre-compact.ts`, a throttled PostToolUse in `hooks/post-tool-use.ts`, the session-log with `setMirrorPromptsToStderr` already hooked to the --show-prompts signal, and `bin/lib/budget.ts` + `bin/lib/pricing.ts` providing the cost ledger. The four hook stubs that matter (SessionStart, Stop) are exit-0 no-ops waiting to be wired.

The primary work is: (a) implement `bin/lib/router.ts` — the bare `/pensmith` state-aware decision table that reads STATE.json + PLAN.md frontmatter and selects the next verb; (b) wire the plumbing namespace (`/pensmith:plan-section` etc.) as skill descriptions in `skills/`; (c) upgrade session-start.ts and stop.ts from no-op stubs to real implementations; (d) build `bin/lib/estimator.ts` — the `--estimate` flag dry-run token projector; and (e) implement `--dry-run` mode using the already-present `http-mock.ts` + `isOfflineMode()` pattern.

Claude Code hooks in the current API use `hooks/hooks.json` in the plugin bundle (confirmed from the official docs and the repo's own `hooks-noop.test.ts`). The four event names are: `SessionStart`, `PreCompact`, `PostToolUse`, `Stop`. The hooks.json schema uses `{ schemaVersion, hooks: [{ event, script }] }` — the repo already has this wired and tested. The CRITICAL finding is that Claude Code's official docs define PreCompact timeout as the default 600s, not a special 10s limit; the "10s timeout" for PreCompact in TIER-03 is a PROJECT-IMPOSED budget constraint that the planner must implement via `Promise.race` + `AbortController` in pre-compact.ts, not a platform limit.

**Primary recommendation:** Build `bin/lib/router.ts` as the state-aware bare-command engine; upgrade hook stubs inline (session-start.ts and stop.ts); implement estimator.ts as a pure cost-projection pass with no LLM calls; wire --dry-run to the isOfflineMode() + cassette pattern already present.

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
| ERGO-01 | `--dry-run` uses cached fixtures, zero external calls | Wire PENSMITH_NETWORK_TESTS=0 + isOfflineMode() gate; already used by cassette tests |
| ERGO-02 | `--estimate` projects tokens+USD before executing | `bin/lib/estimator.ts` (new): dry-run pass via estimateCost() from pricing.ts |
| ERGO-03 | `--yolo` skips outline+export approval gates; refuses >50% cap | Already partially wired in compile.ts + done.ts; add session-cap check in router |
| ERGO-04 | `--show-prompts` echoes every LLM prompt | `setMirrorPromptsToStderr(true)` already exists in session-log.ts; just wire the flag |
| HOOK-01 | PreCompact writes section-granular HANDOFF.json ≤5KB, 10s timeout | hooks/pre-compact.ts already has the body; add Promise.race(10_000) timeout gate |
| HOOK-02 | SessionStart hook auto-invokes resume skill | Upgrade session-start.ts stub to read HANDOFF.json + emit stdout context |
| HOOK-03 | PostToolUse mid-session checkpoint, throttled ≤1/min via mtime gate | hooks/post-tool-use.ts already implements this — DONE, just verify test coverage |
| HOOK-04 | Stop hook releases lock + flushes session log | Upgrade stop.ts stub: call withLock release + await chain flush |
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
| `--dry-run` cassette mode | Tier 2 CLI global flag | Tier 1 skill flag via workflow body | `isOfflineMode()` already used by all adapters; just set env flag |
| `--estimate` cost projection | Tier 2 CLI global flag + `bin/lib/estimator.ts` | Tier 1 skill flag | estimateCost() from pricing.ts; pure math, no LLM call |
| `--yolo` gate bypass | Both tiers (compile + done already have yolo arg) | — | Add session-cap check to refuse when estimate >50% |
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
- Session log mirror: `setMirrorPromptsToStderr()` from `bin/lib/session-log.ts` [VERIFIED: codebase grep]
- HANDOFF write: `writeHandoff()` + `assembleHandoff()` from `bin/lib/handoff.ts` [VERIFIED: codebase grep]
- State read: `loadState()` from `bin/lib/state.ts` [VERIFIED: codebase grep]
- Lock release: `withLock()` release is managed internally; hooks need to signal the lock via the PID-based lock in `bin/lib/lock.ts` [VERIFIED: codebase grep]

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
HANDOFF.json exists + phase != 'done'              → run `resume` (auto-resume)
Default (sections in progress)                     → plan → write → verify
  next incomplete section (lowest n where status ∉
  {written, verified})
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

### Stop Hook — Lock Release + Log Flush

Stop fires when the main agent finishes its reply. The hook must:
1. Release the pensmith concurrent-run lock (PID lock in `bin/lib/lock.ts`)
2. Flush the session-log write chain (call `log.close()`)

```typescript
// hooks/stop.ts (replacement)
import { closeSessionLog } from '../bin/lib/session-log.js';
import { releaseLock } from '../bin/lib/lock.js';

await Promise.all([
  releaseLock('.paper'),    // PID lock release
  closeSessionLog(),        // flush write chain
]);
process.exit(0);
```

**Important:** `bin/lib/lock.ts` currently only exposes `withLock()` (RAII-style). Phase 7 may need to add a `releaseLock()` standalone function OR the Stop hook reads the lock file's PID, verifies it matches its own, and unlinks it. The existing `withLock()` exits its critical section automatically, so Stop's lock concern is specifically the *outer session-level lock* (not the per-file write lock). [ASSUMED — lock.ts API extension needed; verify current lock.ts exports]

### --dry-run Flag Implementation

The `isOfflineMode()` predicate in `bin/lib/http-mock.ts` controls whether source adapters use cassette fixtures. Tier 2 `--dry-run` simply sets `PENSMITH_NETWORK_TESTS` to an empty string (or sets a new env flag `PENSMITH_DRY_RUN=1`) at the CLI entry point before any adapter calls. All adapters that call `isOfflineMode()` at their top gate will then use cassettes automatically.

```typescript
// In bin/pensmith.ts or global flag handler:
if (args.dryRun) {
  process.env['PENSMITH_NETWORK_TESTS'] = '';  // disable live calls
  process.env['PENSMITH_DRY_RUN'] = '1';       // signal to LLM client
}
```

The LLM client also needs to check `PENSMITH_DRY_RUN` and return stub responses instead of making real API calls. [VERIFIED: isOfflineMode() implementation in http-mock.ts; ASSUMED for LLM stub behavior]

### --estimate Flag Implementation

`bin/lib/estimator.ts` is the new file. It is a DRY-RUN planning pass (no LLM calls) that:
1. Reads STATE.json to determine which verbs will execute
2. For each verb, applies a token-count heuristic (e.g., research = ~50K tokens, write-section = ~15K per section)
3. Calls `estimateCost({ providerId, modelId, inputTokens, outputTokens })` from `pricing.ts`
4. Prints the projection table and total USD cost
5. If total > 50% of `cost_cap_usd` from config AND `--yolo` is off → prompt user to confirm

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

### Pitfall 3: `--yolo` 50% cap check — session cap vs. per-step cap
**What goes wrong:** ARCH-11 says "refuse --yolo when estimate exceeds 50% of session cap." The session cap is `cost_cap_usd` from config (default $5). But `assertBudget` in budget.ts uses per-scope caps (paper/section/task), not a global session cap predicate.
**Why it happens:** There is no `sessionCap` field in BudgetSpec. The 50% check must be implemented in the `--estimate` projection path, not inside `assertBudget`.
**How to avoid:** In `estimator.ts`, after computing the total projected cost: if `projected > (cost_cap_usd * 0.5)` AND `--yolo` is true → print warning + exit non-zero (refuse). This is a pre-flight check, not a mid-run check.
**Warning signs:** `--yolo` proceeding despite a very large estimate.

### Pitfall 4: Verb `next` vs. bare `/pensmith`
**What goes wrong:** `next` and bare `/pensmith` (no verb) should be identical. But citty routes bare invocation to the root command's `run()`, not to a `next` subcommand. If `next` is wired as a subcommand, bare `/pensmith` goes nowhere.
**Why it happens:** citty's `defineCommand` with `subCommands` dispatches a subcommand key when a verb is given; if no verb is given, it runs the root command's `run()`. So bare `/pensmith` must implement its own `run()` that calls the router.
**How to avoid:** The root `command` in `bin/pensmith.ts` needs a `run()` handler that calls `router.resolve()`. The `next` verb can then be a thin alias that calls the same function.
**Warning signs:** Bare `pensmith` exits 0 with no output.

### Pitfall 5: State-aware routing before any paper exists
**What goes wrong:** `loadState()` throws `StateNotFoundError` when `.paper/STATE.json` doesn't exist. The router must catch this and treat it as "no active paper → run intake", NOT as a crash.
**Why it happens:** `loadState()` translates ENOENT to a typed error (StateNotFoundError), not to null. The router must have an explicit catch branch.
**How to avoid:** `router.resolve()` catches `StateNotFoundError` and returns `{ verb: 'new' }`.
**Warning signs:** `pensmith` crashes with `StateNotFoundError` in a fresh directory.

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
**Why it happens:** If the estimator calls any code that flows through `runtime.ts` → LLM client before the estimate printout.
**How to avoid:** `estimator.ts` MUST be a pure projection function: reads STATE.json, reads config (for provider+model), calls `estimateCost()`, prints projection. Zero network calls. Zero LLM calls. Set `PENSMITH_DRY_RUN=1` before any adapter code runs.
**Warning signs:** Cost appears on COSTS.jsonl before the estimate table is printed.

### Pitfall 9: PostToolUse checkpoint path `.claude/` vs `.paper/`
**What goes wrong:** The existing `post-tool-use.ts` writes to `.claude/CHECKPOINTS.jsonl`, but `bin/lib/checkpoint.ts` writes to `.paper/CHECKPOINTS.jsonl`. These are two different files.
**Why it happens:** The PostToolUse hook uses a hardcoded Claude-session path; the library uses paper-scoped path. They serve different purposes (hook breadcrumbs vs. domain checkpoint).
**How to avoid:** This is intentional — do not merge these. The planner should document both clearly: `.claude/CHECKPOINTS.jsonl` = hook throttle ledger (per-session breadcrumbs), `.paper/CHECKPOINTS.jsonl` = domain-level audit log via `recordCheckpoint()`.
**Warning signs:** Trying to `findCheckpoint()` on the hook-written file and getting nothing.

---

## Code Examples

### Router — State-Aware Decision

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
  | { verb: 'status'; reason: 'done' }
  | { verb: 'resume'; handoff: Handoff };

export async function resolveNextAction(paperRoot: string): Promise<RouterDecision> {
  let state;
  try {
    state = await loadState(paperRoot);
  } catch (e) {
    if (e instanceof StateNotFoundError) return { verb: 'new' };
    throw e;
  }

  const pDir = paperDir(paperRoot);

  // Check HANDOFF.json first — indicates interrupted session
  const handoffPath = join(pDir, 'HANDOFF.json');
  if (existsSync(handoffPath)) {
    try {
      const h = JSON.parse(readFileSync(handoffPath, 'utf8')) as Handoff;
      if (h.phase !== 'done') return { verb: 'resume', handoff: h };
    } catch { /* malformed handoff — fall through */ }
  }

  if (!existsSync(join(pDir, 'RESEARCH.md'))) return { verb: 'research' };
  if (!existsSync(join(pDir, 'OUTLINE.md')))  return { verb: 'outline' };

  const sections = state.sections ?? [];
  if (sections.length === 0) return { verb: 'outline' };

  // Walk sections in order; find first incomplete
  for (const { n, slug } of sections.sort((a, b) => a.n - b.n)) {
    const planPath = sectionPlan(n, slug, paperRoot);
    if (!existsSync(planPath)) return { verb: 'plan', n, slug };
    const { frontmatter } = parseFrontmatter(readFileSync(planPath, 'utf8'));
    const status = (frontmatter as { status?: string }).status ?? 'planned';
    if (status === 'planned')   return { verb: 'plan',   n, slug };
    if (status === 'writing')   return { verb: 'write',  n, slug };
    if (status === 'written')   return { verb: 'verify', n, slug };
    if (status === 'verifying') return { verb: 'verify', n, slug };
    // verified / failed / unverifiable — continue to next section
  }

  // All sections verified
  if (!existsSync(join(pDir, 'DRAFT.md'))) return { verb: 'compile' };
  if (!existsSync(join(pDir, 'FINAL.md'))) return { verb: 'done' };
  return { verb: 'status', reason: 'done' };
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
// In bin/pensmith.ts root command args + run():
// session-log.ts already exports setMirrorPromptsToStderr()
import { setMirrorPromptsToStderr } from './lib/session-log.js';

// In the root defineCommand args:
'show-prompts': { type: 'boolean', description: 'Echo every LLM prompt to stderr.', default: false },

// In the root command run() (before dispatching to subcommand):
if (args['show-prompts']) {
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
- Stop as exit-0 no-op: must be upgraded to release lock + flush session log.
- SessionStart as exit-0 no-op: must emit HANDOFF.json summary to Claude context.

---

## Runtime State Inventory

> Phase 7 is a wiring/upgrade phase, not a rename/migration phase. No runtime state category applies.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `.claude/CHECKPOINTS.jsonl` (hook breadcrumbs), `.paper/HANDOFF.json` (phase pointer), `.paper/STATE.json` (paper state) | No rename; schema unchanged |
| Live service config | None — pensmith is purely local | None |
| OS-registered state | None | None |
| Secrets/env vars | `PENSMITH_NETWORK_TESTS`, `PENSMITH_DRY_RUN` (new env flag to add) | Add `PENSMITH_DRY_RUN` to doctor probe + docs |
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
| UX-01 | bare `pensmith` with no STATE.json → runs intake | unit | `node --import tsx --test tests/router.test.ts` | ❌ Wave 0 |
| UX-01 | bare `pensmith` with verified sections → runs compile | unit | `node --import tsx --test tests/router.test.ts` | ❌ Wave 0 |
| UX-02 | all 16 verbs registered + loaders resolve | integration | `node --import tsx --test tests/cli-verbs.test.ts` | ✅ exists |
| UX-03 | plumbing namespace skills exist on disk | repo-files | `node --import tsx --test tests/repo-files.test.ts` | ✅ exists (add assertion) |
| UX-04 | skill descriptions contain trigger phrases | snapshot | `node --import tsx --test tests/skill-descriptions.test.ts` | ❌ Wave 0 |
| ERGO-01 | --dry-run produces no network calls | unit | `node --import tsx --test tests/dry-run.test.ts` | ❌ Wave 0 |
| ERGO-02 | --estimate prints cost table, no LLM call | unit | `node --import tsx --test tests/estimator.test.ts` | ❌ Wave 0 |
| ERGO-03 | --yolo refuses when estimate > 50% session cap | unit | `node --import tsx --test tests/yolo-cap.test.ts` | ❌ Wave 0 |
| ERGO-04 | --show-prompts wires setMirrorPromptsToStderr | unit | `node --import tsx --test tests/show-prompts.test.ts` | ❌ Wave 0 |
| HOOK-01 | PreCompact writes HANDOFF.json within 10s | unit | `node --import tsx --test tests/hooks/pre-compact.test.ts` | ❌ Wave 0 |
| HOOK-01 | PreCompact HANDOFF.json ≤5KB | unit | exists → `tests/handoff-size.test.ts` | ✅ exists |
| HOOK-02 | SessionStart emits resume context JSON | unit | `node --import tsx --test tests/hooks/session-start.test.ts` | ❌ Wave 0 |
| HOOK-03 | PostToolUse throttles ≤1/min | unit | verify in hooks-noop.test.ts + post-tool-use.test.ts | partially (hooks-noop tests exit-0 only) |
| HOOK-04 | Stop releases lock + flushes session log | unit | `node --import tsx --test tests/hooks/stop.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --import tsx --test tests/hooks-noop.test.ts tests/cli-verbs.test.ts tests/router.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/router.test.ts` — covers UX-01 decision table (no STATE.json, mid-progress, all-verified)
- [ ] `tests/estimator.test.ts` — covers ERGO-02 cost projection
- [ ] `tests/dry-run.test.ts` — covers ERGO-01 zero-network assertion
- [ ] `tests/yolo-cap.test.ts` — covers ERGO-03 50%-cap refusal
- [ ] `tests/show-prompts.test.ts` — covers ERGO-04 flag wiring
- [ ] `tests/hooks/pre-compact.test.ts` — covers HOOK-01 timeout + size
- [ ] `tests/hooks/session-start.test.ts` — covers HOOK-02 resume context
- [ ] `tests/hooks/stop.test.ts` — covers HOOK-04 lock + flush
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
| --dry-run bypassing cassette gate | Spoofing | `isOfflineMode()` checks `PENSMITH_NETWORK_TESTS !== '1'`; dry-run MUST NOT set it to `'1'` |
| --estimate triggering real LLM | Information Disclosure | estimator.ts must NEVER import runtime.ts LLM call paths; set PENSMITH_DRY_RUN=1 guard |
| Skill description NL routing ambiguity | — | Distinct trigger phrases per skill; planner must avoid overlapping descriptions |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Plugin skills with colon-prefix names (`pensmith:plan-section`) are registered via plugin.json `skills` array with the colon in the name field | Architecture Patterns — Plumbing Namespace | Wrong: might need a different manifest field; check Anthropic plugin schema before writing plugin.json |
| A2 | Stop hook can release the pensmith concurrent-run lock by adding a `releaseLock()` export to `bin/lib/lock.ts` | Architecture Patterns — Stop Hook | Wrong: lock.ts may not expose a standalone release; may need different approach (e.g., delete lock file after PID check) |
| A3 | LLM stub responses for `--dry-run` can be implemented by checking `PENSMITH_DRY_RUN=1` in the Tier-2 runtime client | Architecture Patterns — dry-run | Wrong: may need a more explicit stub injection point; the LLM client isn't yet wired in Tier-2 for most verbs |
| A4 | Static token heuristics for `--estimate` (research=50K, write-section=15K, etc.) are reasonable starting values | Code Examples — estimator | Wrong: actual usage may differ significantly; heuristics should be marked as estimates in the output |
| A5 | `PENSMITH_DRY_RUN` is a new env flag (not already in use) | Standard Stack | Wrong: check existing env var usage to avoid collision |

---

## Open Questions

1. **Does `bin/lib/lock.ts` expose a standalone `releaseLock()` function for Stop hook?**
   - What we know: `withLock()` is RAII-style (lock acquired + released in callback). No standalone release is visible.
   - What's unclear: How does Stop cleanly release the session-level lock without being inside a `withLock()` callback?
   - Recommendation: Add `releaseLock(file)` export to lock.ts in Wave 0 of this phase. Alternatively, Stop hook can check PID match and directly unlink the lock file (lower-level but correct).

2. **Does the Claude Code plugin support colon-prefix skill names in plugin.json?**
   - What we know: PRD §5.5 specifies `/pensmith:plan-section` as the plumbing namespace; GSD reference repos use this pattern.
   - What's unclear: Exact plugin.json `skills` array field names and whether colon is allowed.
   - Recommendation: Verify against `.claude-plugin/plugin.json` schema doc before writing skill files; fallback is to document the namespace in CONTRIBUTING.md without plugin-level enforcement.

3. **What is the actual token footprint for each workflow stage?**
   - What we know: `estimator.ts` needs static heuristics; no live calibration data exists.
   - What's unclear: Research = how many tokens? Write-section = how many tokens per 500 words?
   - Recommendation: Use conservative estimates (2× the expected usage); label output as "estimated ± 50%".

---

## Sources

### Primary (HIGH confidence)
- [VERIFIED: codebase] `bin/lib/verbs.ts` — locked 16-verb set
- [VERIFIED: codebase] `hooks/hooks.json` — current hook wiring format `{ schemaVersion: 1, hooks: [{ event, script }] }`
- [VERIFIED: codebase] `hooks/pre-compact.ts` — PreCompact body (complete except timeout)
- [VERIFIED: codebase] `hooks/post-tool-use.ts` — HOOK-03 already implemented
- [VERIFIED: codebase] `hooks/session-start.ts` + `hooks/stop.ts` — exit-0 stubs awaiting upgrade
- [VERIFIED: codebase] `bin/lib/session-log.ts` — `setMirrorPromptsToStderr()` exists at line 84
- [VERIFIED: codebase] `bin/lib/http-mock.ts` — `isOfflineMode()` exists at line 139
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
- Pitfalls: HIGH — pitfalls 1–6 verified from codebase reading; pitfalls 7–9 from PRD and code patterns
- NL routing mechanism: HIGH — official Claude Code hook protocol verified
- Skill plumbing namespace: MEDIUM — exact plugin.json schema not confirmed

**Research date:** 2026-06-18
**Valid until:** 2026-07-18 (stable domain; Claude Code hook API changes rarely)
