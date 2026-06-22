---
phase: 02-tier-shells-doctor-tier-contract-gate
plan: "09"
subsystem: prompts-fallback
tags: [tier-2, prompts, clack, numbered-fallback, ci-safe, tdd]
dependency_graph:
  requires: [02-00]
  provides: [bin/lib/prompts.ts, bin/lib/prompts/schema.ts, bin/lib/prompts/clack.ts, bin/lib/prompts/numbered.ts]
  affects: [03-intake, phase-3-plus-verbs, TIER-05]
tech_stack:
  added: []
  patterns: [discriminated-union-schema, dynamic-import-isolation, readline-numbered-fallback, env-mode-override]
key_files:
  created:
    - bin/lib/prompts/schema.ts
    - bin/lib/prompts/numbered.ts
    - bin/lib/prompts/clack.ts
    - bin/lib/prompts.ts
    - tests/prompts-schema.test.ts
    - tests/prompts-numbered.test.ts
    - tests/prompts-shape.test.ts
  modified: []
decisions:
  - "[02-09] PromptAnswer is hand-written discriminated union type (not zod-inferred) — answers come from trusted code paths inside the module, not from untrusted JSON; type system is sufficient for caller safety"
  - "[02-09] clack.ts is the sole @clack/prompts importer — test asserts import-statement invariant via regex on source files (distinguishes imports from comments)"
  - "[02-09] Dynamic import('./prompts/clack.js') in ask() ensures headless path never pays clack startup cost (Pitfall-11 mitigation: clack version bump cannot break non-TTY mode)"
  - "[02-09] mode resolution: PENSMITH_PROMPT_MODE env override checked first, then TTY auto-detection (both stdout+stderr must be TTY for clack to render correctly)"
  - "[02-09] readline.createInterface({ terminal: false, crlfDelay: Infinity }) — terminal:false prevents Windows piped-stdin from swallowing first keystroke; crlfDelay collapses \\r\\n to single line event"
  - "[02-09] Select out-of-range: 3-retry loop (not exception on first bad input) — writes short re-prompt to stderr, then PromptAbortedError after exhausting retries"
  - "[02-09] process.stdout.write monkey-patch in test uses eslint-disable any + type assertion — overloaded signature cannot be assigned without casting; test-only pattern, documented"
  - "[02-09] exactOptionalPropertyTypes requires conditional build of clack options objects — cannot pass hint:undefined to optional hint field; build option object conditionally with spread"
metrics:
  duration: "~661 seconds (~11 min)"
  completed_date: "2026-05-16"
  tasks: 3
  files_created: 7
  files_modified: 0
  tests_added: 28
  tests_baseline: 309
  tests_final: 337
---

# Phase 2 Plan 09: Prompts Fallback Summary

**One-liner:** `ask()` dispatcher with @clack/prompts TTY path and dependency-free stdin numbered-prompt fallback — both paths converge on a single PromptAnswer shape; CI-safe on all 3 OSes via PENSMITH_PROMPT_MODE=numbered env override.

## Objectives Met

- TIER-05 closed in Phase 2: `bin/lib/prompts.ts` exports `ask()`, `PromptAbortedError`, `PromptTimeoutError`, `PromptQuestion`, `PromptAnswer`
- `bin/lib/prompts/schema.ts`: Zod discriminated union for select / multiselect / text / confirm; field names match gsd-plugin `--text` JSON schema
- `bin/lib/prompts/numbered.ts`: Pure stdin readline fallback — no @clack/prompts import, no process.stdout writes; select with 3-retry on out-of-range, multiselect comma-separated indices, text/confirm with defaults, PromptAbortedError on EOF, PromptTimeoutError on hang
- `bin/lib/prompts/clack.ts`: Sole importer of @clack/prompts; wraps select/multiselect/text/confirm; isCancel → PromptAbortedError
- `bin/lib/prompts.ts`: Dynamic import of clack.ts (Pitfall-11 isolation) + static import of numbered.ts; PENSMITH_PROMPT_MODE env override; both stdout+stderr must be TTY for auto→clack
- Shape parity: same question fed to numbered mode produces identical PromptAnswer.kind and value
- Single-source-of-truth invariant: test asserts only clack.ts contains `import.*@clack/prompts`
- 337 tests pass (309 baseline + 28 new: 8 schema + 13 numbered + 7 shape)
- lint clean; typecheck clean; build clean

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Zod schemas + types + schema tests | da3fbd8 | bin/lib/prompts/schema.ts, tests/prompts-schema.test.ts |
| 2 | Numbered fallback + clack delegate + ask() dispatcher | 99c3744 | bin/lib/prompts/numbered.ts, bin/lib/prompts/clack.ts, bin/lib/prompts.ts, tests/prompts-numbered.test.ts |
| 3 | Shape-parity + invariant tests | 00994df | tests/prompts-shape.test.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript exactOptionalPropertyTypes rejects undefined for optional clack fields**
- **Found during:** Task 2 typecheck verification
- **Issue:** `{ placeholder: question.placeholder }` where `question.placeholder` is `string | undefined` is rejected by `exactOptionalPropertyTypes` when the target type is `{ placeholder?: string }` — TypeScript distinguishes "key absent" from "key = undefined"
- **Fix:** Build clack option objects conditionally — check field `!== undefined` before including it in the object literal
- **Files modified:** bin/lib/prompts/clack.ts
- **Commit:** 99c3744

**2. [Rule 1 - Bug] process.stdout.write type assignment incompatible with overloaded signature**
- **Found during:** Task 2 typecheck verification (test file)
- **Issue:** TypeScript's overloaded `process.stdout.write` type cannot be directly assigned to a new function that accepts `...args: any[]` — the function overload shapes conflict
- **Fix:** Used `eslint-disable-next-line @typescript-eslint/no-explicit-any` with cast `(process.stdout as any).write` for the test-only monkey-patch; documented inline as test-only pattern
- **Files modified:** tests/prompts-numbered.test.ts
- **Commit:** 99c3744

**3. [Rule 3 - Blocking] clack.ts needed for typecheck before Task 3 scheduled**
- **Found during:** Task 2 typecheck — `bin/lib/prompts.ts` dynamic import of `'./prompts/clack.js'` fails typecheck without the file
- **Issue:** Plan sequenced clack.ts as Task 3 but prompts.ts (Task 2) references it via dynamic import — TypeScript resolves the type from the .ts source even for dynamic imports
- **Fix:** Created clack.ts in full during Task 2 (plan noted to "stub placeholders" — full implementation is cleaner and avoids a partial-impl commit that would immediately be replaced). Task 3 commit then adds only the shape test
- **Files modified:** bin/lib/prompts/clack.ts (created during Task 2 commit)
- **Commit:** 99c3744

## Known Stubs

None — all prompt functionality is fully implemented. The clack TTY path (bin/lib/prompts/clack.ts) will be exercised by Phase 3 intake flows when running interactively; CI exercises the numbered fallback path only.

## Threat Flags

No new threat surfaces beyond the plan's STRIDE register (T-02-09-01 through T-02-09-07). All mitigations implemented:

- T-02-09-01 (megabyte line flood): `rl.once('line', ...)` reads exactly one line per ask() call
- T-02-09-02 (adversarial index): `Number.isInteger(n) && n >= 1 && n <= options.length` before using index
- T-02-09-03 (answer echo to stderr): test 11 in numbered tests asserts stderr never contains typed answer value
- T-02-09-04 (stdin never closes): per-question timeout (default 5 min, PENSMITH_PROMPT_TIMEOUT_MS override) tested with 50ms in test 9
- T-02-09-05 (malicious loader): accepted, out of scope
- T-02-09-06 (repudiation of export gate): deferred to Phase 6 DONE-09 as planned
- T-02-09-07 (secret in default field): deferred to Phase 7 (no `secret: boolean` schema field in Phase 2; caller discipline per PRD §16)

## TDD Gate Compliance

All three tasks followed RED → GREEN → REFACTOR:
- Task 1 (schema): RED (module not found) → GREEN (schema implemented) → no refactor needed
- Task 2 (numbered): RED (module not found) → GREEN (numbered + clack + prompts implemented) → REFACTOR (lint/type fixes)
- Task 3 (shape): Implemented atop completed Task 2 foundations — tests pass immediately on first run (GREEN gate via mode:numbered in CI context)

## Self-Check: PASSED

Files exist:
- bin/lib/prompts/schema.ts: FOUND
- bin/lib/prompts/numbered.ts: FOUND
- bin/lib/prompts/clack.ts: FOUND
- bin/lib/prompts.ts: FOUND
- tests/prompts-schema.test.ts: FOUND
- tests/prompts-numbered.test.ts: FOUND
- tests/prompts-shape.test.ts: FOUND

Commits exist:
- da3fbd8 (Task 1 — schema): FOUND
- 99c3744 (Task 2 — numbered + dispatcher): FOUND
- 00994df (Task 3 — shape tests): FOUND

Test suite: 337 tests, 0 failures (baseline was 309; added 28)
Lint: CLEAN
TypeCheck: CLEAN
Build: CLEAN (dist/bin/lib/prompts.js: typeof ask === 'function'; dynamic import of clack confirmed)
