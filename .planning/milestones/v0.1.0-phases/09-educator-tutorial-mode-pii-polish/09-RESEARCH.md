# Phase 9: Educator/Tutorial Mode + PII Polish - Research

**Researched:** 2026-06-20
**Domain:** Observer/event-wrapper architecture for tutorial mode; PII redaction beyond regex; intake `goal` field wiring
**Confidence:** HIGH

## Summary

Phase 9 adds educator/tutorial mode (ERGO-07) and polishes PII redaction (ARCH-17) without touching Foundation libs or workflow bodies with conditional branches. The architecture constraint is absolute: zero `if (educator_mode)` anywhere in Foundation or the 16 workflow bodies.

The good news is the codebase is exceptionally well-positioned. The session-log's `kind: 'event'` + `child(bindings)` API already functions as a lightweight structured-event bus. The assertBudget pre-call seam in budget.ts is the guaranteed pre-LLM chokepoint. The `goal` field already exists in PRD §10 `config.toml` and INTK-02 question 3 — it just needs wiring into intake.ts and a per-section tutorial-mode subscriber.

**Primary recommendation:** Implement educator mode as a `TutorialSubscriber` class that (1) registers to the session-log event stream for specific event kinds, (2) emits annotated provenance "teaching wrappers" to a separate `.paper/TUTORIAL.md` output file, and (3) is activated exclusively by the `goal=learning|both` field read at the top of each CLI verb — never by a conditional inside Foundation libs. PII polishing adds named-entity-awareness via pure-Node dictionary lookup, NOT an NLP library dep (to preserve determinism and avoid a slopsquatted dep).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| goal=learning detection | CLI verb entrypoints (intake.ts, per-verb entry) | Workflow body `<capability_check>` | Goal is config; CLI reads config.toml and activates subscriber before orchestrating verb |
| Tutorial wrapper emission | Tutorial subscriber (new `bin/lib/tutorial.ts`) | — | All emit goes through one module; Foundation/workflows stay clean |
| Annotated provenance | Tutorial subscriber (reads PLAN.md `assigned_sources` + VERIFICATION.md) | — | Claim-source map is already in PlanFrontmatter; subscriber reads it post-write |
| Tutorial end-state output | `.paper/TUTORIAL.md` (new file, atomic write) | — | Separate output; zero trace in DRAFT.md or exports |
| PII redaction beyond regex | `bin/lib/pii.ts` (polished in-place) | Intake orchestration | Pure module stays pure; new patterns added without external deps |
| PII opt-in gate | `bin/cli/intake.ts` | `workflows/new.md` step 4 | Intake is the sole checkpoint before any LLM call |
| PII deterministic diff | `bin/lib/pii.ts` + `bin/cli/intake.ts` | — | Diff produced by comparing raw vs. redacted before persisting |
| Pre-LLM PII ordering | `bin/lib/budget.ts` assertBudget seam | `bin/lib/runtime.ts` getProviderApiKey | PII redaction must complete before assertBudget releases the call |

## Standard Stack

### Core (no new runtime deps required)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node `node:events` | built-in | EventEmitter for TutorialSubscriber | Zero dep; already in the runtime |
| `bin/lib/session-log.ts` | internal | Existing event bus for structured events | Already the single logging chokepoint; extend with tutorial event kinds |
| `bin/lib/pii.ts` | internal | PII redaction; polish in-place | Pure module; add patterns, keep no I/O guarantee |
| `bin/lib/atomic-write.ts` | internal | Write TUTORIAL.md + INTAKE.raw.local | D-07 chokepoint must be used |
| `bin/lib/prompt-loader.ts` | internal | Hash-pinned prompts for tutorial wrappers | D-12 LOCKED slug pattern; tutorial prompts registered here |

### Supporting (optional, evaluation below)

No new external packages are recommended for v0.1.0 tutorial mode or PII polish.

**Why no NLP library for PII:**
- PRD §14 "Determinism where it counts" is a non-negotiable. NLP/NER libraries (compromise, natural) use probabilistic models that produce non-deterministic output across versions — the reviewer diff would not be reproducible.
- PII-V2-01 in REQUIREMENTS.md explicitly defers stronger NLP (Presidio shellout) to v2. v0.1.0 must stay pure-Node regex + curated dictionary extension.
- The "beyond regex-only" polishing in Phase 9 means: more patterns (IBAN, credit-card-like, IP address, student ID patterns), smarter ordering, and a curated common-name word-list for better NAME false-positive suppression — all pure-Node, fully deterministic.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node:events bus | compromise NER | Deterministic; no new dep; but NAME class coverage lower — acceptable since PII-V2-01 defers Presidio |
| Separate TUTORIAL.md output | In-band DRAFT.md annotations | Separate file enforces zero-trace-in-export (DONE-07); annotation-in-draft would require stripping logic |
| session-log event piggyback | new EventEmitter from scratch | session-log already does structured events + child bindings; piggybacking reuses infrastructure |

**Installation:** No new packages to install.

## Package Legitimacy Audit

Phase 9 installs ZERO external packages. All implementation is pure internal refactoring + extension. The `PII-V2-01` v2 item (Presidio) is out of scope.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none) | — | — | — | — | — | — |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
intake (goal=learning|both)
        |
        v
  [TutorialSubscriber.activate()]  <-- reads goal from config.toml
        |                               BEFORE any LLM call
        |  subscribes to session-log events:
        |    'section.written'  -> emit claim→source provenance block
        |    'section.verified' -> emit verdict walk-through
        |    'research.done'    -> emit source-selection rationale
        |    'outline.done'     -> emit structure rationale
        |    'compile.done'     -> emit transition/consistency notes
        v
  [session-log child(module:'tutorial')]
        |
        v
  [TUTORIAL.md]  (atomicWriteFile via D-07 chokepoint)
        |
  (goal=learning: stop after research; no DRAFT.md written)
  (goal=both: continue to compile; TUTORIAL.md + DRAFT.md both produced)
  (goal=draft: TutorialSubscriber never activated; zero-branch in Foundation)
```

### Recommended Project Structure

```
bin/lib/
├── tutorial.ts          # NEW: TutorialSubscriber + TutorialEvent types
├── pii.ts               # POLISHED: more patterns + NAME suppression dictionary
bin/cli/
├── intake.ts            # WIRED: reads goal + activates subscriber + PII opt-in diff
templates/prompts/
├── tutorial-section-provenance.md    # NEW hash-pinned prompt (teaching wrapper)
├── tutorial-research-rationale.md   # NEW hash-pinned prompt
tests/
├── tutorial.test.ts     # NEW: subscriber activation, emit, TUTORIAL.md contract
├── pii-polish.test.ts   # NEW: extended corpus for new PII patterns + diff format
```

### Pattern 1: TutorialSubscriber (Observer / Wrapper Architecture)

**What:** A single-responsibility class that subscribes to structured events emitted by existing verb orchestrators (via session-log or a thin event channel), and writes teaching annotations to TUTORIAL.md. It is activated once (at intake) if and only if `goal === 'learning' || goal === 'both'`. Foundation libs and workflow bodies are UNTOUCHED.

**When to use:** goal=learning or goal=both. goal=draft → subscriber is never created. This is the load-bearing architectural choice.

**How events reach the subscriber:**

The session-log already has `kind: 'event'` records for every major verb milestone. The TutorialSubscriber can:
- Option A: subscribe directly to the session-log chain (read events as they're written)
- Option B: use a thin `node:events` EventEmitter passed as a dependency-injected parameter to verb orchestrators

**Option B is recommended** because:
- The session-log chain is fire-and-forget (async, swallows errors). Tutorial annotations need sequential ordering to keep TUTORIAL.md readable.
- Dependency injection keeps Foundation clean: the EventEmitter is passed in by the CLI verb entrypoint, which is the `goal`-aware tier. Foundation orchestrators that receive `undefined` for the emitter simply skip emission — zero branch needed in Foundation.

```typescript
// Source: [ASSUMED] — pattern derived from Node.js EventEmitter docs + codebase structure
// bin/lib/tutorial.ts

import { EventEmitter } from 'node:events';
import { atomicWriteFile, atomicAppendFile } from './atomic-write.js';
import path from 'node:path';

export type TutorialEventKind =
  | 'research.done'     // after research phase; payload: { sources: SourceCandidate[] }
  | 'outline.done'      // after outline approval; payload: { sections: OutlineEntry[] }
  | 'section.written'   // after each section drafter; payload: { n, slug, assignedSources, planPath }
  | 'section.verified'  // after each verify pass; payload: { n, slug, pass1Results, pass2Results }
  | 'compile.done';     // after compile; payload: { smoothingChanges, flaggedContradictions }

export interface TutorialEvent {
  kind: TutorialEventKind;
  payload: Record<string, unknown>;
}

export class TutorialSubscriber {
  private emitter: EventEmitter;
  private tutorialPath: string;
  private goal: 'learning' | 'both';

  constructor(opts: { tutorialPath: string; goal: 'learning' | 'both' }) {
    this.tutorialPath = opts.tutorialPath;
    this.goal = opts.goal;
    this.emitter = new EventEmitter();
    this._wire();
  }

  // Verb orchestrators call this to emit tutorial events.
  // If the subscriber was never created (goal=draft), callers hold undefined
  // and skip the call — no branch needed in Foundation.
  emit(event: TutorialEvent): void {
    this.emitter.emit(event.kind, event.payload);
  }

  private _wire(): void {
    this.emitter.on('section.written', async (payload) => {
      await this._emitSectionProvenance(payload);
    });
    this.emitter.on('section.verified', async (payload) => {
      await this._emitVerdictWalkthrough(payload);
    });
    // ... other handlers
  }

  private async _emitSectionProvenance(payload: unknown): Promise<void> {
    // Read PlanFrontmatter.assigned_sources from planPath
    // Render annotated provenance block: "Claim X is supported by Smith (2021)
    // because their paper makes exactly this argument..."
    // atomicAppendFile to tutorialPath
  }
}
```

### Pattern 2: Claim-Source Provenance (annotated provenance per claim)

**What:** For goal=learning, after each section is written + verified, the TutorialSubscriber reads PlanFrontmatter.assigned_sources (the claim→source mapping already in PLAN.md) and VERIFICATION.md Pass-1 verdicts, then emits a teaching block to TUTORIAL.md.

**The claim→source mapping already exists:** PlanFrontmatterSchema has `assigned_sources: string[]` (citekeys). The section PLAN.md body has the detailed claim-to-source prose (the `## Brief` and paragraph plan). The TutorialSubscriber reads these files post-write — no changes to Foundation.

**Example TUTORIAL.md block:**
```markdown
## Section 2 — Background: Source Provenance

**Why Smith (2021) was assigned here:**
The search phase ranked this source T1 (top quartile) for relevance. Its claim
that "transformer attention scales sub-quadratically with linear attention
approximations" directly supports paragraph 3's central claim. Verification:
Pass-1 DOI PASS (titleJW=0.97, authorJW=0.95), Pass-3 quote PASS.

**Why Jones (2019) appears in paragraph 1:**
Jones establishes the baseline transformer complexity that the section's
argument pushes back against. Classic counterexample pattern.
```

### Pattern 3: goal=learning End-State

**What:** In `goal=learning` mode, the workflow stops after research and emits a tutorial-style summary. In `goal=both`, it continues through compile and produces TUTORIAL.md alongside DRAFT.md.

**goal=learning stop point:** The `research.done` event triggers a full tutorial summary (sources, why-each-was-picked, topic overview) and the CLI verb entrypoint then returns without routing to outline. The `router.ts` `resolveNextAction` already uses a state-machine; a new `goal` field in config.toml steers routing.

**Stopping requires:**
1. `goal` field persisted in `config.toml` at intake time.
2. `resolveNextAction` reads `goal` from config and returns `{ action: 'tutorial-done' }` after research when `goal === 'learning'`.
3. The `pensmith next` umbrella respects this and prints the tutorial summary.

### Pattern 4: PII Polish Beyond Regex-Only

**What:** Phase 1 ships 5 regex classes (EMAIL, PHONE, SSN, NAME, DATE). Phase 9 "beyond regex-only" adds:
1. **More patterns:** IBAN-like (`\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}\b`), credit-card-like (Luhn-proximity heuristic), IP address (`\b(?:\d{1,3}\.){3}\d{1,3}\b`), student/employee ID patterns (configurable by institution prefix).
2. **NAME false-positive suppression:** A curated ~500-word dictionary of common non-name capitalized tokens (months, days, acronyms, academic terms like "The", "In", "Results", "Method") reduces NAME false positives without an NLP dep. This is a pure-Node string-set lookup, fully deterministic.
3. **Deterministic diff output:** `diffPii(original: string, redacted: string): PiiDiff[]` produces a structured diff that intake.ts prints for user review before persisting. Each entry: `{ span: [start, end], kind: PiiKind, raw: string, tag: string }`. This is purely positional math, no randomness.

**Why not compromise/natural NLP:** Not needed for v0.1.0 (PII-V2-01 defers Presidio). NLP libs are probabilistic, breaking the determinism guarantee.

```typescript
// Source: [ASSUMED] — extends existing pii.ts pure-module pattern
// Additions to bin/lib/pii.ts:

const RE_IP = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const RE_IBAN_LIKE = /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g;

// Name suppression dictionary (500 tokens — loaded from a bundled JSON, NOT a dep)
const NAME_SUPPRESSION = new Set([
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'Introduction', 'Methods', 'Results', 'Discussion', 'Conclusion', 'Abstract',
  // ... ~480 more academic + common capitalized non-name tokens
]);

// diffPii: deterministic diff for reviewer display
export interface PiiDiff {
  span: [number, number];
  kind: PiiKind;
  raw: string;
  tag: string;  // e.g. '[REDACTED:EMAIL]'
}

export function diffPii(original: string, redacted: string): PiiDiff[] {
  const spans = classifyPii(original);
  return spans.map((m) => ({
    span: m.span,
    kind: m.kind,
    raw: m.raw,
    tag: `[REDACTED:${m.kind}]`,
  }));
}
```

### Pattern 5: PII Opt-In Wiring at Intake (Pre-LLM Ordering)

**What:** `INTK-05` requires PII runs before any LLM call. The intake.ts flow must be:
1. Collect raw answers from user (AskUserQuestion / stdin).
2. If `pii_redaction=true` in config.toml (or user answered yes): run `redactPii(rawAnswers)` and produce `diffPii()` for user review.
3. Display the diff, await confirmation.
4. Persist redacted answers to `.paper/INTAKE.md` (atomic).
5. Persist raw answers to `.paper/INTAKE.raw.local` (gitignored).
6. THEN route to research / LLM calls.

The pre-LLM guarantee is structural: intake.ts is the first CLI verb that will ever call the LLM (for intake-clarifier prompt). Steps 2-5 happen before `loadPrompt('intake-clarifier')` is passed to the model. The `assertBudget` seam in `budget.ts` is a belt-and-suspenders check — PII must be complete before any budget assertion fires, which is before any LLM call.

**The intake.ts currently does NOT have the goal field wired.** This is a Phase 9 task: add `--goal` arg (learning|draft|both, default draft) + read from config.toml + persist to config.toml + activate TutorialSubscriber if learning|both.

### Anti-Patterns to Avoid

- **educator_mode branch in Foundation:** `if (goal === 'learning') { ... }` inside `bin/lib/write-orchestrator.ts`, `bin/lib/compile.ts`, `bin/lib/verify/*.ts` — FORBIDDEN. These are Foundation libs with no knowledge of user-facing config.
- **educator_mode branch in workflow bodies:** `{% if goal == 'learning' %}` or any equivalent in `workflows/*.md` — FORBIDDEN. Workflow bodies must remain two-tier clean.
- **Tutorial output in DRAFT.md:** Tutorial annotations must go to TUTORIAL.md only. DRAFT.md → compile → export pipeline must be byte-identical between goal=draft and goal=both for the same assignment.
- **TutorialSubscriber in Foundation:** The subscriber is wired ONLY in CLI verb entrypoints (bin/cli/*.ts), never imported by bin/lib/*.ts.
- **Non-deterministic diff:** Using `Date.now()` or any randomness in `diffPii` — the diff must be purely positional so identical input always produces identical diff.
- **Redacting the assignment template or prompt text:** The workflow body's new.md already specifies this correctly: redaction applies to USER'S ANSWERS only, never to pensmith-controlled prompt strings.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Async event ordering in tutorial emit | Custom async queue | node:events + enqueue pattern from session-log.ts | session-log already solved the in-flight chain problem; copy its `enqueue` pattern |
| Tutorial file writer | Custom writer | atomicWriteFile (D-07 chokepoint) | D-07 lint rule bans all other write paths |
| Claim-source mapping | Parse DRAFT.md | Read PlanFrontmatterSchema.assigned_sources + PLAN.md body | The mapping already exists; no re-extraction needed |
| goal field storage | New state file | config.toml `goal` key (already in PRD §10 spec) | config.toml is the existing per-project config; no new schema |
| Pre-LLM PII guarantee | Complex ordering logic | Write before `loadPrompt()` call in intake.ts | The prompt load is the first LLM-bound operation; writing before it guarantees pre-LLM |

**Key insight:** The observer/event pattern costs zero new external dependencies and zero Foundation changes. All wiring is in CLI verb entrypoints, which are already the `goal`-aware tier.

## Runtime State Inventory

Phase 9 is NOT a rename/refactor/migration phase. Omit.

## Common Pitfalls

### Pitfall 1: educator_mode branch leakage

**What goes wrong:** Developer adds `if (goal === 'learning') extraAnnotation()` inside `write-orchestrator.ts` or `compile.ts` because it seems natural. Now Foundation knows about educator mode.
**Why it happens:** The `goal` field is in config.toml which is readable from anywhere; the temptation is to branch at the point of use.
**How to avoid:** TutorialSubscriber holds the ONLY reference to `goal`. Foundation orchestrators accept an optional `events?: TutorialEmitter` parameter and emit without knowing what goal is. When `events` is undefined (goal=draft), the emit call is skipped — zero branch.
**Warning signs:** Any import of `config.toml`'s `goal` field inside a `bin/lib/` file; any `tutorial` or `educator` or `learning` string appearing in Foundation libs.

### Pitfall 2: goal=draft/both regression

**What goes wrong:** Tutorial subscriber is activated for goal=draft because the config.toml reader has a bug (missing null-check), or the subscriber's `.emit()` has a side-effect that touches DRAFT.md.
**Why it happens:** The subscriber emits to TUTORIAL.md via `atomicAppendFile` which is correct, but if the subscriber also patches any other file (e.g., VERIFICATION.md for "explain" annotations), it breaks the section-isolation invariant.
**How to avoid:** TutorialSubscriber writes ONLY to `.paper/TUTORIAL.md`. Verification and DRAFT.md are untouched. Section-isolation mtime test (TEST-09) must also cover TUTORIAL.md as a non-section output.
**Warning signs:** Any `atomicWriteFile` call in TutorialSubscriber that targets `.paper/sections/`.

### Pitfall 3: PII egress before redaction

**What goes wrong:** The intake workflow emits the raw assignment to the LLM via `intake-clarifier` before `redactPii()` runs.
**Why it happens:** The Tier-1 workflow body runs the model before the CLI's side-effect functions.
**How to avoid:** In intake.ts, the PII redaction block runs synchronously before `loadPrompt('intake-clarifier')` is reached. The workflow body's step 4 explicitly documents this ordering (it already says "Apply PII redaction: before persisting answers"). The test for this: `PII-egress-before-redact` cassette test asserts that no raw PII string appears in any HTTP/LLM request captured by nock.
**Warning signs:** `loadPrompt` being called before `redactPii` in the same intake.ts function.

### Pitfall 4: Non-deterministic diff

**What goes wrong:** `diffPii` uses `Date.now()` for span IDs or sorts by some non-deterministic comparator. Two runs on the same input produce different diffs.
**Why it happens:** Developer adds a unique-ID field to PiiDiff for UI keying.
**How to avoid:** `diffPii` is a pure function: `(string, string) => PiiDiff[]` with no I/O and no randomness. Spans are sorted by start position (stable). Test: `diffPii(diffPii(x)) === diffPii(x)` (idempotence, same output twice).
**Warning signs:** Any `Math.random()`, `Date.now()`, or `randomUUID()` inside pii.ts.

### Pitfall 5: Tutorial subscriber coupling into Foundation

**What goes wrong:** `bin/lib/write-orchestrator.ts` imports `TutorialSubscriber` directly to call `.emit()`.
**Why it happens:** Feels ergonomic — "the orchestrator knows when writing is done."
**How to avoid:** `write-orchestrator.ts` takes an optional `onSectionWritten?: (n: number, slug: string, planPath: string) => void` callback parameter. The CLI entrypoint (write.ts) provides the callback that calls `tutorialSubscriber.emit(...)`. Foundation never imports tutorial.ts. This is the dependency-inversion pattern.
**Warning signs:** `import ... from './tutorial.js'` inside any `bin/lib/` file that is not `tutorial.ts` itself.

### Pitfall 6: NAME regex over-suppression from dictionary

**What goes wrong:** The NAME suppression dictionary incorrectly suppresses a real author name (e.g., "In Smith" where "In" is in the suppression set).
**Why it happens:** The NAME regex captures "In Smith" as a two-token NAME, then "In" dictionary lookup suppresses the whole match.
**How to avoid:** Dictionary lookup suppresses ONLY if the ENTIRE match is in the dictionary (single-token case), OR if the FIRST token is in the dictionary AND the second token alone does not look like a name. Two-token and three-token names where the LAST token is not in the dictionary are kept. Test corpus must include "In Smith" → NOT suppressed (because "Smith" is not in the dictionary).
**Warning signs:** Regression in the NAME positive fixture for two-token names where first token is a common word.

### Pitfall 7: TUTORIAL.md not gitignored

**What goes wrong:** TUTORIAL.md is committed to git and reveals that goal=learning was used.
**Why it happens:** New output file not added to `.gitignore`.
**How to avoid:** Phase 9 Wave 0 task adds `.paper/TUTORIAL.md` and `.paper/INTAKE.raw.local` to `.gitignore`. Test: `repo-files.test.ts` asserts these paths are gitignored.

## Code Examples

### Dependency-injection event channel pattern (avoiding Foundation coupling)

```typescript
// Source: [ASSUMED] — derived from existing write-orchestrator.ts pattern
// bin/lib/write-orchestrator.ts — ADDITION (no existing code removed)

export type SectionWrittenCallback = (opts: {
  n: number;
  slug: string;
  planPath: string;
  assignedSources: string[];
}) => void;

// Existing signature: runAllSections(sections, opts)
// New signature: runAllSections(sections, opts, onSectionWritten?)
export async function runAllSections(
  sections: OutlineSectionEntry[],
  opts: RunAllOptions,
  onSectionWritten?: SectionWrittenCallback,  // ADDITIVE — undefined = no-op
): Promise<RunAllResult> {
  // ... existing wave logic ...
  // After each section completes:
  if (onSectionWritten) {
    onSectionWritten({ n, slug, planPath, assignedSources });
  }
}
```

```typescript
// Source: [ASSUMED] — derived from existing intake.ts pattern
// bin/cli/write.ts — ADDITION (no existing code removed)

// At the top of the write verb, before runAllSections:
const goal = readGoalFromConfig(cwd);  // 'draft' | 'learning' | 'both'
const subscriber = (goal === 'learning' || goal === 'both')
  ? new TutorialSubscriber({ tutorialPath: path.join(paperDir(), 'TUTORIAL.md'), goal })
  : undefined;

await runAllSections(sections, opts, subscriber
  ? (evt) => subscriber.emit({ kind: 'section.written', payload: evt })
  : undefined
);
```

### PII opt-in diff display pattern

```typescript
// Source: [ASSUMED] — extends existing intake.ts flow
// bin/cli/intake.ts — ADDITION inside run({ args })

if (piiRedactionEnabled) {
  const rawAnswer = collectedAnswers;
  const redacted = redactPii(rawAnswer);
  const diff = diffPii(rawAnswer, redacted);
  if (diff.length > 0) {
    process.stdout.write('PII redaction preview:\n');
    for (const d of diff) {
      process.stdout.write(`  [${d.kind}] "${d.raw}" → "${d.tag}"\n`);
    }
    // await confirmation (AskUserQuestion in Tier-1; @clack/prompts in Tier-2)
    await confirmOrAbort('Proceed with these redactions?');
  }
  await atomicWriteFile(intakePath, redacted);
  await atomicWriteFile(rawPath, rawAnswer);   // INTAKE.raw.local (gitignored)
} else {
  await atomicWriteFile(intakePath, collectedAnswers);
}
// ONLY NOW: loadPrompt('intake-clarifier') + model call
```

### goal=learning stop-point in router.ts

```typescript
// Source: [ASSUMED] — extends existing resolveNextAction in bin/lib/router.ts
// bin/lib/router.ts — ADDITION in resolveNextAction

const config = readConfigToml(cwd);
const goal = config?.project?.goal ?? 'producing a draft';

// After research is done, check goal
if (state.currentPhase === 'research' && state.researchDone) {
  if (goal === 'learning the topic') {
    return { action: 'tutorial-done' };  // new state-machine terminal for learning
  }
}
// ... existing routing logic unchanged for goal=draft and goal=both
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Regex-only PII (5 classes) | Regex + suppression dictionary + more pattern classes | Phase 9 | Better NAME precision; fewer false positives on academic text |
| No tutorial output | TUTORIAL.md via observer pattern | Phase 9 | goal=learning produces annotated provenance without touching Foundation |
| goal not wired | goal persisted in config.toml + activates TutorialSubscriber | Phase 9 | ERGO-07 satisfied; goal=draft/both paths unchanged |

**Deprecated/outdated:**
- workflow body step descriptions suggesting tutorial-mode is implemented via if-branches — the correct model is the observer/event pattern above.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | TutorialSubscriber uses dependency-injected callbacks (not session-log direct subscription) for sequential ordering | Architecture Patterns | If session-log ordering proves adequate, A1 is moot; both approaches work architecturally |
| A2 | `goal` is persisted in config.toml (already in PRD §10 spec) and does NOT require a new STATE.json field | Pattern 5 | If goal needs to survive restarts and config.toml is not read by router.ts, a STATE.json field or migration is needed |
| A3 | NAME suppression dictionary is bundled as a JSON file in `bin/lib/` (not a runtime dep) | Pattern 4 | If dictionary is large, bundle size impact; estimate: ~500 tokens ≈ 8KB JSON, negligible |
| A4 | `diffPii` can live inside `bin/lib/pii.ts` without breaking the "pure module, no I/O" guarantee | Pattern 4 | diffPii takes two strings and returns a struct — it is pure; no risk |
| A5 | TUTORIAL.md is a per-paper output (`.paper/TUTORIAL.md`), not a per-section output | Architecture Patterns | If per-section granularity is needed, the emit pattern is the same; only the target path changes |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed. (Table has 5 items — these are the assumptions requiring confirmation before locking the plan.)

## Open Questions

1. **Does goal=learning stop AFTER research or after outline?**
   - PRD §7.13: "In `learning` mode (no draft), pensmith generates a tutorial-style summary of the topic from the curated sources after research, then stops." This says AFTER research. But the same section says every STEP adds an explain wrapping, implying the outline step also runs in `both` mode.
   - What we know: goal=learning stops after research and emits a tutorial summary. goal=both runs everything.
   - What's unclear: Does goal=learning get an outline step with tutorial annotations, or hard-stop at research?
   - Recommendation: Implement as PRD §7.13 states — hard stop after research for goal=learning. This avoids all section-write machinery for learning-only mode.

2. **Is the `goal` field in `config.toml` stored as the PRD §10 English string ("producing a draft" | "learning the topic" | "both") or a short enum ("draft" | "learning" | "both")?**
   - PRD §10 shows `goal = "producing a draft"` in config.toml but REQUIREMENTS.md ERGO-07 says `goal ∈ {draft, learning, both}`.
   - What's unclear: Which form is canonical for intake.ts's `--goal` arg?
   - Recommendation: Use short enum values (draft|learning|both) for CLI arg and internal code; config.toml stores the short form. The intake clarifier question surfaces the long English form as the display label.

3. **Does TUTORIAL.md get included in the `done` / export pipeline?**
   - What we know: DONE-07 says zero pensmith trace in exported docs. TUTORIAL.md is a pensmith artifact.
   - Recommendation: TUTORIAL.md is excluded from all exports (not concatenated by compile, not passed to Pandoc). It lives only in `.paper/`. The user reads it alongside the paper for learning purposes. Add to `exporter.ts` output-path exclusion list.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >=20.10 | All runtime | Yes | v24.16.0 | — |
| node:events (built-in) | TutorialSubscriber | Yes | built-in | — |
| bin/lib/pii.ts | PII polish | Yes | internal | — |
| bin/lib/atomic-write.ts | TUTORIAL.md write | Yes | internal | — |

**Missing dependencies with no fallback:** none
**Missing dependencies with fallback:** none

## Validation Architecture

**nyquist_validation is enabled** (config.json has `workflow.nyquist_validation: true`, key not explicitly false).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | node:test (built-in) |
| Config file | none — discovered via `scripts/run-tests.mjs` |
| Quick run command | `node --import tsx --test tests/tutorial.test.ts tests/pii-polish.test.ts` |
| Full suite command | `node scripts/run-tests.mjs` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ERGO-07 | goal=learning activates TutorialSubscriber | unit | `node --import tsx --test tests/tutorial.test.ts` | No — Wave 0 |
| ERGO-07 | goal=draft never activates TutorialSubscriber | unit | `node --import tsx --test tests/tutorial.test.ts` | No — Wave 0 |
| ERGO-07 | goal=both runs full pipeline + TUTORIAL.md | integration | `node --import tsx --test tests/tutorial.test.ts` | No — Wave 0 |
| ERGO-07 | Section provenance block appears in TUTORIAL.md after section.written event | unit | `node --import tsx --test tests/tutorial.test.ts` | No — Wave 0 |
| ERGO-07 | TUTORIAL.md excluded from all export outputs | unit | `node --import tsx --test tests/zero-trace-export.test.ts` | Partial — extend |
| ARCH-17 | diffPii is pure, deterministic, idempotent | unit | `node --import tsx --test tests/pii-polish.test.ts` | No — Wave 0 |
| ARCH-17 | New PII patterns (IP, IBAN-like) fire on corpus | unit | `node --import tsx --test tests/pii-polish.test.ts` | No — Wave 0 |
| ARCH-17 | NAME suppression dict prevents false positives on academic terms | unit | `node --import tsx --test tests/pii-polish.test.ts` | No — Wave 0 |
| INTK-05 | PII redaction runs BEFORE loadPrompt('intake-clarifier') call | unit | `node --import tsx --test tests/intake-pii-ordering.test.ts` | No — Wave 0 |
| INTK-05 | INTAKE.raw.local written with raw text; INTAKE.md with redacted | unit | `node --import tsx --test tests/intake-pii-ordering.test.ts` | No — Wave 0 |
| TEST-09 | TutorialSubscriber emits ONLY to .paper/TUTORIAL.md (not sections/) | unit | `node --import tsx --test tests/tutorial.test.ts` | No — Wave 0 |

### Sampling Rate

- **Per task commit:** `node --import tsx --test tests/tutorial.test.ts tests/pii-polish.test.ts tests/intake-pii-ordering.test.ts`
- **Per wave merge:** `node scripts/run-tests.mjs`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/tutorial.test.ts` — subscriber activation, emit routing, TUTORIAL.md contract, goal=draft/learning/both isolation
- [ ] `tests/pii-polish.test.ts` — extended corpus (IP, IBAN-like, NAME suppression), diffPii determinism, idempotence
- [ ] `tests/intake-pii-ordering.test.ts` — ordering gate: redactPii runs before loadPrompt; INTAKE.raw.local written
- [ ] `bin/lib/tutorial.ts` — TutorialSubscriber module (Wave 0 creates stub; Wave 1+ fills body)
- [ ] `templates/prompts/tutorial-section-provenance.md` — hash-pinned prompt slug for teaching annotation
- [ ] `.gitignore` additions: `.paper/TUTORIAL.md` and `.paper/INTAKE.raw.local`

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1` per config.json.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | `diffPii` and new regex patterns validated by fast-check property test; no user input enters TUTORIAL.md without going through the existing pii.ts redactPii pipeline |
| V6 Cryptography | no | — |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| PII egress before redaction | Information Disclosure | PII redaction before `loadPrompt` (structural ordering in intake.ts) |
| TUTORIAL.md persisting raw PII | Information Disclosure | TutorialSubscriber never receives raw answers — it receives post-redaction plan metadata (assigned_sources, citekeys, verdicts — none of which contain user PII) |
| educator_mode branch injection via fork | Tampering | No `if (goal)` in Foundation; TutorialSubscriber is activated by CLI tier only, which is process-local; no attack surface |
| NAME regex ReDoS (existing risk, made worse by dictionary lookup) | DoS | Dictionary lookup is O(1) set membership; does not change the regex engine path; existing T-01-REDOS-01 bound still holds |

## Sources

### Primary (HIGH confidence)

- `bin/lib/pii.ts` — verified Phase-1 regex patterns, PiiKind types, D-49 threat model coverage
- `bin/lib/session-log.ts` — verified existing event/emit infrastructure (kind:'event', child bindings)
- `bin/lib/budget.ts` — verified assertBudget pre-call seam as the pre-LLM gate
- `bin/lib/drafter-input.ts` — verified DrafterInputSchema strict chokepoint (WRTE-04)
- `bin/lib/schemas/plan-frontmatter.ts` — verified assigned_sources exists as the claim-source map
- `workflows/new.md` step 4 — verified PII redaction ordering spec (EMAIL first, deterministic order)
- `PRD.md §7.13` — verified educator mode spec (learning/both/draft, stop-after-research for learning)
- `PRD.md §10` — verified goal field in config.toml
- `REQUIREMENTS.md ERGO-07` — verified requirement text: "intake choice goal ∈ {draft, learning, both}; learning triggers tutorial-mode end-state with annotated provenance"
- `.planning/ROADMAP.md Phase 9` — verified success criteria and goal statement

### Secondary (MEDIUM confidence)

- node:events built-in — [VERIFIED] standard Node.js module; no external dep
- `tests/pii.test.ts` — reviewed existing test coverage to identify gaps Phase 9 must fill

### Tertiary (LOW confidence)

- PiiDiff shape and diffPii API design — [ASSUMED] derived from codebase patterns; exact API TBD at plan time
- NAME suppression dictionary size (~500 tokens) — [ASSUMED] estimate; actual list built during implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all tooling verified against existing codebase
- Architecture: HIGH — observer/event pattern is well-established; dependency-injection approach avoids all Foundation coupling
- Pitfalls: HIGH — branching pitfalls verified against existing patterns in Phase 5/8 (pass2 advisory isolation, style-match producer non-fatal pattern)
- PII polish specifics: MEDIUM — new pattern regexes need corpus testing before finalizing

**Research date:** 2026-06-20
**Valid until:** 2026-07-20 (stable architecture; PRD is locked)
