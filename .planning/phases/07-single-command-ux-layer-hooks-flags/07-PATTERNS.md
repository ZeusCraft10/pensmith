# Phase 7: Single-Command UX Layer + Hooks + Flags — Pattern Map

**Mapped:** 2026-06-18
**Files analyzed:** 18 new/modified files
**Analogs found:** 18 / 18 (all files have a close analog in the codebase)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `bin/lib/router.ts` | utility | request-response | `bin/lib/state.ts` | role-match |
| `bin/lib/estimator.ts` | utility | transform | `bin/lib/pricing.ts` | role-match |
| `bin/pensmith.ts` (modify) | config | request-response | `bin/pensmith.ts` itself | exact |
| `bin/cli/next.ts` | controller | request-response | `bin/cli/compile.ts` | exact |
| `bin/cli/status.ts` | controller | request-response | `bin/cli/compile.ts` | exact |
| `bin/cli/resume.ts` | controller | request-response | `bin/cli/compile.ts` | exact |
| `hooks/session-start.ts` (upgrade) | middleware | event-driven | `hooks/pre-compact.ts` | exact |
| `hooks/stop.ts` (upgrade) | middleware | event-driven | `hooks/pre-compact.ts` | exact |
| `hooks/pre-compact.ts` (modify) | middleware | event-driven | `hooks/post-tool-use.ts` | exact |
| `hooks/post-tool-use.ts` | middleware | event-driven | — | DONE — no changes needed |
| `skills/pensmith.md` | config | — | `skills/.gitkeep` (placeholder) | no analog (new content type) |
| `skills/plan-section.md` | config | — | `skills/.gitkeep` (placeholder) | no analog (new content type) |
| `skills/write-section.md` | config | — | `skills/.gitkeep` (placeholder) | no analog (new content type) |
| `skills/verify-section.md` | config | — | `skills/.gitkeep` (placeholder) | no analog (new content type) |
| `.claude-plugin/plugin.json` (modify) | config | — | `.claude-plugin/plugin.json` | exact |
| `tests/router.test.ts` | test | CRUD | `tests/state.test.ts` | role-match |
| `tests/estimator.test.ts` | test | transform | `tests/pricing.test.ts` | exact |
| `tests/hooks/session-start.test.ts` | test | event-driven | `tests/hooks-noop.test.ts` | exact |
| `tests/hooks/stop.test.ts` | test | event-driven | `tests/hooks-noop.test.ts` | exact |
| `tests/hooks/pre-compact.test.ts` | test | event-driven | `tests/hooks-noop.test.ts` | exact |
| `tests/dry-run.test.ts` | test | request-response | `tests/http.test.ts` | role-match |
| `tests/yolo-cap.test.ts` | test | transform | `tests/budget.test.ts` | role-match |
| `tests/show-prompts.test.ts` | test | event-driven | `tests/session-log.test.ts` | role-match |
| `tests/skill-descriptions.test.ts` | test | — | `tests/repo-files.test.ts` | role-match |

---

## Pattern Assignments

### `bin/lib/router.ts` (utility, request-response)

**Status:** NEW FILE
**Analog:** `bin/lib/state.ts`

**Imports pattern** (`bin/lib/state.ts` lines 56-73):
```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { loadAndMigrate } from './migrations/loader.js';
import {
  Schema as StateSchema,
  CURRENT_STATE_VERSION,
  type State,
} from './schemas/state.js';
import { openSessionLog, type SessionLogger } from './session-log.js';
```

For `router.ts`, the import pattern is:
```typescript
import { loadState, StateNotFoundError } from './state.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paperDir, sectionPlan } from './paths.js';
import { parseFrontmatter } from './frontmatter.js';
import { HandoffSchema } from './schemas/handoff.js';
import type { Handoff } from './schemas/handoff.js';
```

**Error typing pattern** (`bin/lib/state.ts` lines 87-101):
```typescript
export class StateNotFoundError extends Error {
  code = 'STATE_NOT_FOUND' as const;
  constructor(message: string) {
    super(message);
    this.name = 'StateNotFoundError';
  }
}
```
Router should define `RouterDecision` as a discriminated union type (see RESEARCH.md Code Examples section).

**StateNotFoundError catch pattern** (`bin/lib/state.ts` lines 209-246):
```typescript
try {
  value = await withLock(file, async () =>
    (await loadAndMigrate({ ... })) as State,
  );
} catch (e) {
  const err = e as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
  if (err?.code === 'ENOENT' || err?.cause?.code === 'ENOENT') {
    throw new StateNotFoundError(`STATE.json not found at ${file}`);
  }
  throw e;
}
```

The router MUST catch `StateNotFoundError` (not re-throw) and return `{ verb: 'new' }`. Pattern:
```typescript
let state;
try {
  state = await loadState(paperRoot);
} catch (e) {
  if (e instanceof StateNotFoundError) return { verb: 'new' };
  throw e;
}
```

**File-existence check pattern** (`hooks/pre-compact.ts` lines 82-111):
```typescript
const jsonPath = join(paperDir, 'STATE.json');
if (existsSync(jsonPath)) {
  try {
    const raw = JSON.parse(readFileSync(jsonPath, 'utf8')) as { ... };
    // ... use raw
  } catch {
    // Malformed — fall through to defaults.
  }
}
```

**parseFrontmatter pattern** (`hooks/pre-compact.ts` lines 179-190):
```typescript
if (existsSync(planPath)) {
  try {
    const { frontmatter } = parseFrontmatter(readFileSync(planPath, 'utf8'));
    const fmState = (frontmatter as { status?: unknown }).status;
    if (typeof fmState === 'string' && isSectionState(fmState)) {
      state = fmState;
    }
  } catch {
    /* leave default */
  }
```

**Key pitfall for router (Pitfall 4 from RESEARCH.md):** The root `bin/pensmith.ts` command's `run()` handler calls `router.resolve()`. The `next` subcommand is a thin alias calling the same function. Do NOT make `next` the only entry point.

---

### `bin/lib/estimator.ts` (utility, transform)

**Status:** NEW FILE
**Analog:** `bin/lib/pricing.ts`

**Pure-function / no-I/O import pattern** (`bin/lib/pricing.ts` lines 1-36):
```typescript
// No imports — pure constant + pure function. Self-contained by design.

export interface ModelPrice {
  inputPerMtok: number;
  outputPerMtok: number;
  currency: 'USD';
}

export function estimateCost(args: {
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
}): number {
  if (args.inputTokens < 0 || args.outputTokens < 0) {
    throw new RangeError(`token counts must be >= 0 ...`);
  }
  // ... lookup + formula
}
```

For `estimator.ts`, the key pattern is: import `estimateCost` from `pricing.ts` and `loadState` from `state.ts`. Zero LLM calls. Zero network calls. Set `PENSMITH_DRY_RUN=1` before any other code runs.

**Static heuristics table pattern** (modeled on `MODEL_PRICES` frozen table in `pricing.ts` lines 59-95):
```typescript
// STEP_HEURISTICS — static token-count estimates per workflow step.
// Conservative (2× expected): calibrate via empirical runs. Label output
// as "estimated ±50%" to match RESEARCH.md recommendation.
const STEP_HEURISTICS = Object.freeze({
  new:      { inputTokens: 5_000,   outputTokens: 2_000 },
  research: { inputTokens: 50_000,  outputTokens: 8_000 },
  outline:  { inputTokens: 10_000,  outputTokens: 3_000 },
  plan:     { inputTokens: 8_000,   outputTokens: 2_000 },  // per section
  write:    { inputTokens: 15_000,  outputTokens: 5_000 },  // per section
  verify:   { inputTokens: 20_000,  outputTokens: 3_000 },  // per section
  compile:  { inputTokens: 20_000,  outputTokens: 5_000 },
  done:     { inputTokens: 30_000,  outputTokens: 5_000 },
} as const);
```

**50% cap PREDICATE pattern** (RESEARCH.md Pitfall 3 / ARCH-11, split per review H1): `estimator.ts` computes the PREDICATE only (a pure `exceedsHalfCap` boolean on EstimateResult); it does NOT call `process.exit`. The REFUSAL (hard exit) lives in the dispatcher PRE-DISPATCH seam (see the bin/pensmith.ts H1 pre-flight) so it fires WHENEVER `--yolo` is active, independent of `--estimate`. The cap lives in `estimator.ts`, NOT in `assertBudget`:
```typescript
// estimator.ts — PURE predicate; pass the configured cap so a lowered cap tightens the threshold (L1):
const sessionCap = args.sessionCapUsd ?? 5.0;        // caller passes config.cost_cap_usd when available
const exceedsHalfCap = totalUsd > sessionCap * 0.5;  // boolean only — no exit, no stdout here
return { rows, totalUsd, exceedsHalfCap };
// The dispatcher H1 pre-flight reads exceedsHalfCap and does process.exit(1) when --yolo is active.
```

---

### `bin/pensmith.ts` (modify — add global flags + root `run()`)

**Status:** MODIFY existing file
**Analog:** `bin/pensmith.ts` itself + `bin/cli/compile.ts` (flag wiring)

**Existing global-flag slot pattern** (`bin/pensmith.ts` lines 72-82):
```typescript
export const command = defineCommand({
  meta: {
    name: 'pensmith',
    version: VERSION,
    description: 'Pensmith — Tier 2 portable CLI. Section-as-phase academic writing.',
  },
  subCommands: buildSubCommands(),
});
```

**Flag declaration pattern** (from `bin/cli/compile.ts` lines 67-83):
```typescript
args: {
  yolo: {
    type: 'boolean',
    description: 'Skip approval gates.',
    default: false,
  },
  lintHeadings: {
    type: 'boolean',
    description: 'Enable the opt-in heading-tense consistency heuristic.',
    default: false,
  },
},
```

For the root command, add four global flags:
```typescript
args: {
  'dry-run':      { type: 'boolean', description: 'Zero external API calls; use cassette fixtures.', default: false },
  'estimate':     { type: 'boolean', description: 'Project token + USD cost; do not execute.', default: false },
  'yolo':         { type: 'boolean', description: 'Skip outline + export approval gates.', default: false },
  'show-prompts': { type: 'boolean', description: 'Echo every LLM prompt to stderr.', default: false },
},
```

**--show-prompts wiring pattern** (`bin/lib/session-log.ts` lines 82-86):
```typescript
// Module-scope toggle — set this BEFORE any LLM call.
let mirrorPromptsToStderr = false;
export function setMirrorPromptsToStderr(enabled: boolean): void {
  mirrorPromptsToStderr = !!enabled;
}
```
In `bin/pensmith.ts` root `run()`:
```typescript
import { setMirrorPromptsToStderr } from './lib/session-log.js';
// ...
if (args['show-prompts']) setMirrorPromptsToStderr(true);
```

**--dry-run wiring pattern** (`bin/lib/http-mock.ts` lines 139-141):
```typescript
export function isOfflineMode(): boolean {
  return process.env['PENSMITH_NETWORK_TESTS'] !== '1';
}
```
In root `run()`, BEFORE dispatching to any subcommand:
```typescript
if (args['dry-run']) {
  process.env['PENSMITH_NETWORK_TESTS'] = '';  // not '1' → isOfflineMode() returns true
  process.env['PENSMITH_DRY_RUN'] = '1';
}
```

**Bare `/pensmith` routing (Pitfall 4 from RESEARCH.md):** The root `defineCommand` needs its own `run()` that calls `router.resolveNextAction()`. This is separate from the `next` subcommand — citty dispatches bare invocation to the root `run()`, not to `next`.

**REAL_VERB_LOADERS pattern** (`bin/pensmith.ts` lines 37-56):
```typescript
const REAL_VERB_LOADERS: Partial<Record<Ux02Verb, () => Promise<AnyCommandDef>>> = {
  doctor: () => import('./cli/doctor.js').then((m) => m.doctorCommand),
  new:    () => import('./cli/intake.js').then((m) => m.intakeCommand),
  // ... existing entries ...
  // Add in Phase 7:
  next:   () => import('./cli/next.js').then((m) => m.nextCommand),
  status: () => import('./cli/status.js').then((m) => m.statusCommand),
  resume: () => import('./cli/resume.js').then((m) => m.resumeCommand),
};
```

---

### `bin/cli/next.ts` (controller, request-response)

**Status:** NEW FILE — promotes stub to real router call
**Analog:** `bin/cli/compile.ts` (thin orchestrator pattern)

**Thin orchestrator pattern** (`bin/cli/compile.ts` lines 22-30, 63-110):
```typescript
import { defineCommand } from 'citty';
import { runCompile, type ReVerifyInput, type ReVerifyResult } from '../lib/compile.js';

export const compileCommand = defineCommand({
  meta: {
    name: 'compile',
    description: 'Assemble all verified section drafts into .paper/DRAFT.md + COMPILE-REPORT.md.',
  },
  args: { yolo: { type: 'boolean', default: false }, ... },
  async run({ args }) {
    const paperRoot = process.cwd();
    const result = await runCompile({ paperRoot, yolo: args.yolo === true, ... });
    if (result.refused) {
      process.stdout.write(`pensmith compile: REFUSED — ...\n`);
      return { ok: false, ...result };
    }
    process.stdout.write(`pensmith compile: wrote ...\n`);
    return { ok: true, ...result };
  },
});
export default compileCommand;
```

For `next.ts`:
```typescript
import { defineCommand } from 'citty';
import { resolveNextAction } from '../lib/router.js';

export const nextCommand = defineCommand({
  meta: { name: 'next', description: 'Resolve and execute the next pending action for the active paper.' },
  async run() {
    const paperRoot = process.cwd();
    const decision = await resolveNextAction(paperRoot);
    // dispatch to the appropriate subcommand
    process.stdout.write(`pensmith next: → ${decision.verb}\n`);
  },
});
export default nextCommand;
```

**stdout-only rule** (`bin/cli/compile.ts` line 10): "stdout-only (no console.* — keeps a future stdio/MCP frame clean)"

---

### `bin/cli/status.ts` (controller, request-response)

**Status:** NEW FILE — promotes stub to real state display
**Analog:** `bin/cli/compile.ts` (thin orchestrator); `bin/lib/state.ts` (loadState)

Same thin-orchestrator pattern as `next.ts`. Reads STATE.json via `loadState()`, reads section PLAN.md frontmatter via `parseFrontmatter()`, prints a status table to stdout.

**loadState + section-walk pattern** (`hooks/pre-compact.ts` lines 44-68):
```typescript
const { phase, sectionsFromState } = readState(paperDir);
const { sectionPointers, currentSection } = collectSectionPointers(paperDir, sectionsFromState);
// walk sectionPointers to find current progress
```

---

### `bin/cli/resume.ts` (controller, request-response)

**Status:** NEW FILE — promotes stub to HANDOFF-aware resume
**Analog:** `bin/cli/compile.ts` (thin orchestrator); HANDOFF read pattern from `hooks/session-start.ts` (once upgraded)

**HANDOFF read pattern** (from RESEARCH.md Code Examples — SessionStart hook):
```typescript
import { existsSync, readFileSync } from 'node:fs';
import { HandoffSchema } from '../lib/schemas/handoff.js';

const HANDOFF_PATH = '.paper/HANDOFF.json';

function safeReadHandoff() {
  if (!existsSync(HANDOFF_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(HANDOFF_PATH, 'utf8'));
    const r = HandoffSchema.safeParse(raw);
    return r.success ? r.data : null;
  } catch { return null; }
}
```

**Thin orchestrator imports** (`bin/cli/compile.ts` lines 22-30):
```typescript
import { defineCommand } from 'citty';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { paperDir } from '../lib/paths.js';
import { resolveNextAction } from '../lib/router.js';
```

**H4 RESUME LIFECYCLE (no resume->resume loop):** `resume` reads HANDOFF (above) for the SUMMARY only, then dispatches to the next WORK verb via `resolveNextAction` (which IGNORES HANDOFF and never returns 'resume'), then CLEARS HANDOFF so a stale pointer cannot re-trigger resume:
```typescript
const handoff = safeReadHandoff();
if (handoff && handoff.phase !== 'done') {
  // print one-line resume summary (stdout or stderr per parity)
}
const decision = await resolveNextAction(process.cwd()); // returns plan/write/verify/compile/done — NEVER resume
// dispatch decision.verb via the exported REAL_VERB_LOADERS table (shared dispatch — no re-import cycle)
try { rmSync(join(paperDir(process.cwd()), 'HANDOFF.json'), { force: true }); } catch { /* best-effort consume */ }
```
This is the H4 fix: resume hands off into the HANDOFF-blind resolver and consumes the pointer, so bare `/pensmith`, `next`, and `resume` always make progress.

---

### `hooks/session-start.ts` (middleware, event-driven) — UPGRADE from exit-0 stub

**Status:** UPGRADE stub — currently 1 line: `process.exit(0);`
**Analog:** `hooks/pre-compact.ts` (full hook pattern)

**Hook file header pattern** (`hooks/pre-compact.ts` lines 1-13):
```typescript
#!/usr/bin/env node
// hooks/pre-compact.ts — Phase 3 Plan 03-08.
//
// Claude Code PreCompact hook. Writes .paper/HANDOFF.json before context
// compaction so the next session can resume.
//
// D-12 LOCKED gate: no LLM invocation here. pre-compact runs synchronously
// and offline.
```

**Hook stdout-only protocol constraint** (`hooks/session-start.ts` comment, line 9):
```
// CRITICAL: stdout is the hook-protocol channel (in Claude Code's hook
// contract). NEVER console.log here. Diagnostics go to stderr.
```

**exit-0 as protocol** (`hooks/session-start.ts` line 11 — current stub):
```typescript
process.exit(0);
```

**Full upgrade pattern** (from RESEARCH.md Code Examples — SessionStart hook):
```typescript
#!/usr/bin/env node
// hooks/session-start.ts — Phase 7 upgrade.
// Claude Code SessionStart hook. Reads HANDOFF.json and emits a
// { systemMessage } JSON to stdout (injected into Claude's first turn).
// NEVER console.log — stdout is the hook-protocol channel.
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
  // exit-0 JSON stdout is injected into Claude's first turn context (official hook protocol)
  process.stdout.write(JSON.stringify({ systemMessage: msg }) + '\n');
}
process.exit(0);
```

**hooks-noop.test.ts constraint** (`tests/hooks-noop.test.ts` lines 17-21):
```typescript
const out = execFileSync(process.execPath, [
  '--import', 'tsx', hook,
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
// Must produce no stdout (would corrupt hook-protocol frame).
assert.equal(out, '', `${hook} stdout MUST be empty, got: ${out}`);
```
IMPORTANT: the `hooks-noop.test.ts` assertion `out === ''` currently applies to ALL four hooks. Once session-start emits JSON stdout, this test MUST be updated to allow session-start's stdout to be a valid JSON object OR MUST be removed from the `out === ''` assert for session-start (the other three hooks stay exit-0 with empty stdout).

---

### `hooks/stop.ts` (middleware, event-driven) — UPGRADE from exit-0 stub

**Status:** UPGRADE stub — currently 1 line: `process.exit(0);`
**Analog:** `hooks/post-tool-use.ts` (lock + try/finally pattern); `bin/lib/lock.ts` (release export)

**Lock release pattern** (`bin/lib/lock.ts` lines 128-138):
```typescript
// release() is already exported — used by Stop hook directly.
export async function release(resource: string): Promise<void> {
  const stub = await stubFor(resource);
  await lockfile.unlock(stub);
}
```
Note: `bin/lib/lock.ts` already exports `release()` (line 135). The Stop hook can call it directly. No new export needed.

**try/finally silent pattern** (`hooks/post-tool-use.ts` lines 83-85):
```typescript
  } catch {
    /* silent — hooks must not crash session */
  }
```

**Session log close pattern** (`bin/lib/session-log.ts` lines 370-374):
```typescript
close: async () => {
  await chain;
},
```

**Full upgrade pattern** (from RESEARCH.md Code Examples — Stop hook):
```typescript
#!/usr/bin/env node
// hooks/stop.ts — Phase 7 upgrade.
// Claude Code Stop hook. Releases pensmith concurrent-run lock + flushes session log.
// NEVER console.log — exit 0 with no stdout is the protocol.
import { closeSessionLog } from '../bin/lib/session-log.js';
import { release } from '../bin/lib/lock.js';

try {
  await Promise.all([
    release('.paper'),    // PID lock release (best-effort)
    closeSessionLog(),    // flush write chain
  ]);
} catch {
  /* silent — hooks must not crash session */
}
process.exit(0);
```
Note: `session-log.ts` does NOT export `closeSessionLog()` by name. The Stop hook should call `openSessionLog({ scope: 'auto' }).close()` or the module needs to export a top-level `closeSessionLog()` convenience function. Verify `session-log.ts` line 371 — `close: async () => { await chain; }` — the chain is module-scope, not per-handle. Adding `export async function closeSessionLog() { await chain; }` to `session-log.ts` is the correct approach.

---

### `hooks/pre-compact.ts` (middleware, event-driven) — ADD 10s timeout wrapper

**Status:** MODIFY existing file — add `Promise.race` timeout around `writeHandoff`
**Analog:** `hooks/post-tool-use.ts` (lock + error containment pattern)

**Existing `writeHandoff` call** (`hooks/pre-compact.ts` lines 59-67):
```typescript
const handoff = assembleHandoff({
  phase,
  currentSection,
  nextAction,
  breadcrumbs,
  sectionPointers,
});
await writeHandoff(handoff, paperDir);
```

**Timeout wrapper addition** (from RESEARCH.md Code Examples — PreCompact hook):
```typescript
// Addition at top of hooks/pre-compact.ts (after imports):
const PRECOMPACT_TIMEOUT_MS = 10_000;

// Replace `await writeHandoff(handoff, paperDir)` with:
await Promise.race([
  writeHandoff(handoff, paperDir),
  new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error('pre-compact: HANDOFF write timed out after 10s')),
      PRECOMPACT_TIMEOUT_MS,
    )
  ),
]);
```

**Lock stale alignment note** (`bin/lib/handoff.ts` lines 74-78): `writeHandoff` already sets `stale: 10_000` on its lockfile options — this matches the 10s timeout, so stale-lock auto-clear covers a timeout race.

**Error containment pattern** (`hooks/pre-compact.ts` lines 67-71):
```typescript
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[pre-compact] HANDOFF write failed: ${msg}\n`);
  }
```
The timeout rejection is caught by this existing catch block — no changes to the catch pattern needed.

---

### `hooks/post-tool-use.ts` — HOOK-03 COMPLETE

**Status:** NO CHANGES NEEDED — already implements ≤1/min throttle via `proper-lockfile` + mtime gate.

**What it does** (`hooks/post-tool-use.ts` lines 17-88):
- Lock sentinel: `.claude/CHECKPOINTS.jsonl.lock` (distinct from `.paper/CHECKPOINTS.jsonl`)
- `THROTTLE_MS = 60_000`
- Reads last `ts` field from CHECKPOINTS.jsonl tail to check throttle gate
- Acquires `proper-lockfile` lock before read-decide-append (CR-04 fix)
- Silent on all errors (`catch { /* silent */ }`)

Planner only needs to verify test coverage for HOOK-03 in `tests/hooks-noop.test.ts` and optionally add `tests/hooks/post-tool-use.test.ts`.

---

### `skills/pensmith.md` (config — primary skill description)

**Status:** NEW FILE — populate with NL trigger phrases
**Analog:** No direct skill file analog exists. The `skills/` directory contains only `.gitkeep`. Pattern comes from GSD reference repos and PRD §5.4.

**Skill description anti-pattern to avoid** (RESEARCH.md Pitfall 7): "helps with sections" → routes nothing. Description MUST contain the EXACT natural-language phrases from PRD §5.4.

**Structure pattern** (from GSD reference repo study in CLAUDE.md):
```markdown
---
name: pensmith
description: |
  Use this when the user wants to work on their academic paper. Handles:
  "start my paper", "begin writing", "what's next?", "where am I?",
  "continue where I left off", "resume my paper".
  
  Also use for bare /pensmith with no verb — routes to the correct next step
  automatically based on paper state.
---

[workflow body follows]
```

---

### `skills/plan-section.md`, `skills/write-section.md`, `skills/verify-section.md` (config — plumbing namespace skills)

**Status:** NEW FILES — plumbing namespace `/pensmith:plan-section` etc.
**Analog:** None exist yet — first skill files.

**Plumbing skill description pattern** (from RESEARCH.md Architecture Patterns — Plumbing Namespace):
```markdown
---
name: pensmith:plan-section
description: |
  PLUMBING: Use this when scripting /pensmith plan for a specific section number.
  Triggers: "plan section N", "redo section N plan", "section N needs a new plan".
---
```

**plugin.json skills array** (from RESEARCH.md Architecture Patterns — Plumbing Namespace):
```json
{
  "skills": [
    { "name": "pensmith",              "file": "skills/pensmith.md" },
    { "name": "pensmith:plan-section", "file": "skills/plan-section.md" },
    { "name": "pensmith:write-section","file": "skills/write-section.md" },
    { "name": "pensmith:verify-section","file": "skills/verify-section.md" }
  ]
}
```

Note: RESEARCH.md flags Assumption A1 — verify exact plugin.json `skills` array format against Anthropic plugin schema before shipping. The colon-prefix name format is assumed correct based on GSD reference repo patterns.

---

### `.claude-plugin/plugin.json` (config) — ADD skills array

**Status:** MODIFY existing file — add `skills` array for plumbing namespace
**Analog:** `.claude-plugin/plugin.json` itself

**Current file** (`.claude-plugin/plugin.json` lines 1-19):
```json
{
  "name": "pensmith",
  "version": "0.1.0-dev",
  "description": "...",
  "mcpServers": {
    "pensmith": {
      "type": "stdio",
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js"]
    }
  }
}
```

Add a `skills` array alongside `mcpServers`. The exact field name needs verification against the Anthropic plugin schema (RESEARCH.md Assumption A1).

---

### `tests/router.test.ts` (test, CRUD)

**Status:** NEW FILE
**Analog:** `tests/state.test.ts` (tmpdir fixture + loadState pattern)

**Test fixture pattern** (`tests/tier-contract.test.ts` lines 61-78):
```typescript
function freshPaperRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-tier-contract-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(
    join(root, 'STATE.json'),
    JSON.stringify({
      $schemaVersion: 1,
      paperId: 'tier-contract-test',
      createdAt: new Date().toISOString(),
      sections: [],
    }),
  );
  return root;
}
```

**node:test structure** (`tests/hooks-noop.test.ts` lines 1-5):
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
```

**Decision table coverage**: Three cases required (per RESEARCH.md Validation Architecture):
1. No STATE.json → `{ verb: 'new' }`
2. Sections in-progress → `{ verb: 'plan' | 'write' | 'verify', n, slug }`
3. All sections verified + no DRAFT.md → `{ verb: 'compile' }`

---

### `tests/estimator.test.ts` (test, transform)

**Status:** NEW FILE
**Analog:** `tests/pricing.test.ts` (pure-function math test)

**Pure-function test pattern** (from `tests/pricing.test.ts` via its analog relationship to `pricing.ts`):
```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost } from '../bin/lib/pricing.js';

test('estimateCost: known anthropic/claude-sonnet-4 input/output', () => {
  const cost = estimateCost({ providerId: 'anthropic', modelId: 'claude-sonnet-4',
    inputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.equal(cost, 3.00 + 15.00);
});
```

For `estimator.ts` tests: assert projection table prints to stdout, assert no network calls (use `PENSMITH_DRY_RUN=1`), assert 50%-cap refusal when projected > 50% of session cap.

---

### `tests/hooks/session-start.test.ts` and `tests/hooks/stop.test.ts` (test, event-driven)

**Status:** NEW FILES (in `tests/hooks/` subdirectory)
**Analog:** `tests/hooks-noop.test.ts`

**execFileSync hook execution pattern** (`tests/hooks-noop.test.ts` lines 14-23):
```typescript
test(`TIER-03/07: ${hook} exists and exits 0`, () => {
  assert.ok(existsSync(hook), `${hook} missing`);
  const out = execFileSync(process.execPath, [
    '--import', 'tsx', hook,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(out, '', `${hook} stdout MUST be empty, got: ${out}`);
});
```

For `session-start.test.ts`: the stdout assertion changes — with no HANDOFF.json present, stdout must be empty (exit 0). With a valid HANDOFF.json fixture, stdout must be valid JSON with a `systemMessage` field.

For `stop.test.ts`: assert exit 0, assert empty stdout, assert the lock was released (verify lock file absent after run).

---

### `tests/hooks/pre-compact.test.ts` (test, event-driven)

**Status:** NEW FILE
**Analog:** `tests/hooks-noop.test.ts` + `tests/handoff-size.test.ts`

**Handoff size test pattern** (`tests/handoff-size.test.ts` — referenced in RESEARCH.md as existing):
The HANDOFF.json size assertion (`≤5KB`) already exists in `tests/handoff-size.test.ts`. The new `pre-compact.test.ts` adds:
1. Assert HANDOFF.json written within 10s (`Promise.race` working correctly)
2. Assert HANDOFF.json size ≤ 5120 bytes (HANDOFF_MAX_BYTES from schemas/handoff.ts)
3. Assert timeout path: inject a slow `writeHandoff` and assert the timeout fires

---

### `tests/dry-run.test.ts`, `tests/yolo-cap.test.ts`, `tests/show-prompts.test.ts`, `tests/skill-descriptions.test.ts` (tests)

**Status:** NEW FILES
**Analogs:**
- `dry-run.test.ts` → `tests/http.test.ts` (network-gate assertion pattern)
- `yolo-cap.test.ts` → `tests/budget.test.ts` (BudgetExceededError pattern)
- `show-prompts.test.ts` → `tests/session-log.test.ts` (setMirrorPromptsToStderr)
- `skill-descriptions.test.ts` → `tests/repo-files.test.ts` (file-existence + content assertions)

**repo-files.test.ts content assertion pattern** (`tests/repo-files.test.ts` lines 14-17):
```typescript
function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), 'utf-8');
}
// ... then:
assert.match(read('skills/pensmith.md'), /where am I/);
assert.match(read('skills/pensmith.md'), /what's next/);
```

**Budget test pattern** (`tests/budget.test.ts` — via its analog to yolo-cap):
```typescript
import { BudgetExceededError, assertBudget } from '../bin/lib/budget.js';
// For yolo-cap: test the 50%-cap check in estimator.ts
// assert that { yolo: true, projected > 50% of cap } → process.exit(1) or throws
```

---

## Shared Patterns

### Hook stdout protocol (Pitfall 1 from RESEARCH.md — applies to ALL hook files)

**Source:** `hooks/session-start.ts` line 9 comment + `tests/hooks-noop.test.ts` lines 17-21
**Apply to:** `hooks/session-start.ts`, `hooks/stop.ts`, `hooks/pre-compact.ts`

```
// CRITICAL: stdout is the hook-protocol channel.
// NEVER console.log here. Diagnostics go to stderr.
```
```typescript
// All diagnostic output:
process.stderr.write(`[hook-name] message\n`);
// Only intentional protocol JSON goes to stdout:
process.stdout.write(JSON.stringify({ systemMessage: msg }) + '\n');
// All hooks exit 0 on success:
process.exit(0);
```

### Silent error swallowing (applies to all hooks)

**Source:** `hooks/post-tool-use.ts` lines 83-85
**Apply to:** `hooks/stop.ts`, `hooks/pre-compact.ts` (existing pattern), `hooks/session-start.ts`

```typescript
} catch {
  /* silent — hooks must not crash session */
}
```

### proper-lockfile pattern (cross-process lock in hooks)

**Source:** `hooks/post-tool-use.ts` lines 38-52
**Apply to:** Any hook that needs a cross-process lock (Stop hook for session lock)

```typescript
import { lock } from 'proper-lockfile';
// ...
writeFileSync(LOCK_SENTINEL_PATH, '', { flag: 'a' });  // ensure sentinel exists

let release: (() => Promise<void>) | null = null;
try {
  release = await lock(LOCK_SENTINEL_PATH, {
    retries: { retries: 5, minTimeout: 50 },
    stale: 10_000,
    realpath: false,
  });
} catch {
  // Could not acquire the lock — degrade silently
  return;
}
try {
  // ... do work ...
} finally {
  await release();
}
```

### isOfflineMode() gate (applies to all adapters and --dry-run)

**Source:** `bin/lib/http-mock.ts` lines 139-141
**Apply to:** `bin/lib/estimator.ts` (must set env BEFORE any adapter), `bin/pensmith.ts` root `run()`

```typescript
export function isOfflineMode(): boolean {
  return process.env['PENSMITH_NETWORK_TESTS'] !== '1';
}
// --dry-run sets PENSMITH_NETWORK_TESTS='' (not '1') so isOfflineMode() returns true
```

### setMirrorPromptsToStderr (applies to --show-prompts flag)

**Source:** `bin/lib/session-log.ts` lines 82-86
**Apply to:** `bin/pensmith.ts` root `run()` global flag handler

```typescript
export function setMirrorPromptsToStderr(enabled: boolean): void {
  mirrorPromptsToStderr = !!enabled;
}
// Call BEFORE any LLM invocation: if (args['show-prompts']) setMirrorPromptsToStderr(true);
```

### Zod safeParse for untrusted files (applies to hooks reading .paper files)

**Source:** `hooks/pre-compact.ts` lines 179-190 (parseFrontmatter + try/catch); `bin/lib/handoff.ts` lines 60-62 (HandoffSchema.parse)
**Apply to:** `hooks/session-start.ts` (reading HANDOFF.json), `hooks/stop.ts` (if reading HANDOFF.json)

```typescript
const r = HandoffSchema.safeParse(raw);
return r.success ? r.data : null;  // never throw on malformed hook input
```

---

## No Analog Found

All files in this phase have real analogs in the codebase. The only "no-analog" cases are the skill description markdown files (`skills/pensmith.md`, `skills/plan-section.md`, etc.) — these are a new content type with no existing equivalent in the `skills/` directory (only `.gitkeep` is present). The planner should use the RESEARCH.md Architecture Patterns section ("Natural-Language Trigger Routing via Skill Descriptions") for these files.

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `skills/pensmith.md` | config | — | No skill description files exist yet; use PRD §5.4 trigger-phrase table |
| `skills/plan-section.md` | config | — | Same — first plumbing namespace skill |
| `skills/write-section.md` | config | — | Same |
| `skills/verify-section.md` | config | — | Same |

---

## Critical Wiring Notes for Planner

### HOOK-03 is complete
`hooks/post-tool-use.ts` already implements the full HOOK-03 requirement. Planner should NOT re-implement it. The only work is:
- Verify `tests/hooks-noop.test.ts` covers exit-0 (it does, line 14-23)
- Optionally add `tests/hooks/post-tool-use.test.ts` for throttle-gate assertion

### lock.ts already exports `release()`
`bin/lib/lock.ts` line 135 already exports `async function release(resource: string)`. The Stop hook can use this directly. No new export needed.

### session-log.ts needs one new export for Stop hook
`bin/lib/session-log.ts` exposes `close()` only on the per-handle `SessionLogger` interface (line 371). The Stop hook needs a module-level `closeSessionLog()` that awaits the module-scope `chain` promise. This is a 3-line addition to `session-log.ts`:
```typescript
// Add to session-log.ts exports:
export async function closeSessionLog(): Promise<void> {
  await chain;
}
```

### hooks-noop.test.ts must be updated for session-start stdout
The current assertion `assert.equal(out, '', ...)` applies to ALL four hooks. Once `session-start.ts` emits JSON stdout (when HANDOFF.json exists), this test will fail for session-start. The test must be updated to:
1. Assert session-start exits 0 (always)
2. Assert session-start stdout is either empty (no HANDOFF.json) or valid JSON with `systemMessage` key
3. Keep the empty-stdout assertion for pre-compact, post-tool-use, stop (they never write stdout)

### Verb `next` vs bare `/pensmith` (Pitfall 4)
The root `defineCommand` in `bin/pensmith.ts` MUST have its own `run()` handler. Bare `pensmith` dispatches to root `run()`, NOT to the `next` subcommand. The `next` subcommand calls the SAME `resolveNextAction()` function. Both paths must produce equivalent output.

---

## Metadata

**Analog search scope:** `bin/lib/`, `bin/cli/`, `hooks/`, `tests/`, `.claude-plugin/`, `skills/`
**Files scanned:** 15 source files read in full; 5 test files read in full
**Pattern extraction date:** 2026-06-18
