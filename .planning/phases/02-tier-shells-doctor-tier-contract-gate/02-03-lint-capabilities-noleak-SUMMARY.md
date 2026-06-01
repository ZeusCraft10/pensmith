---
phase: 02-tier-shells-doctor-tier-contract-gate
plan: "03"
subsystem: lint-chokepoints, mcp-capabilities, testing
tags: [eslint, D-12, capabilities-noleak, AST-selector, mcp, chokepoint, red-team, fixture, doctor-probe]
dependency_graph:
  requires:
    - phase: 02-02-lint-mcp-no-network
      provides: D-10 eslint.config.js block + override-merge safety pattern
    - phase: 02-01-lint-thin-shim
      provides: D-09 eslint.config.js block + global-ignores pattern
    - phase: 01-13-runtime
      provides: bin/lib/runtime.ts getProviderApiKey/getOpenAlexApiKey/loadRuntimeConfig (helpers D-12 forbids in mcp/)
  provides:
    - tests/fixtures/lint-capabilities-noleak-fixture.ts (D-12 red-team fixture: 5 violations + 1 control)
    - eslint.config.js D-12 block scoped to mcp/**/*.ts (no-restricted-syntax for computed env + runtime helpers; D-07/D-41/D-10 re-listed for flat-config override-merge safety)
    - eslint.config.js D-12 doctor-probe scope extension (computed process.env forbidden in all probes except runtime-config-presence.ts)
    - eslint.config.js D-12 runtime-config-presence static backstop (JSON.stringify + template-literal interpolation of resolved-key identifiers forbidden)
    - tests/lint-capabilities-noleak.test.ts (3-test regression gate: INLINE positive, INLINE control, PROJECT-config-loaded via mcp/ tmp copy)
  affects:
    - 02-04 (mcp/server.ts) — D-12 chokepoint is live before the capabilities handler is written (Pitfall 7 prevention)
    - 02-05 (doctor probes) — D-12 doctor-probe scope extension + runtime-config-presence static backstop complement the T-02-05-01 sentinel test
tech_stack:
  added: []
  patterns:
    - D-12 capabilities-noleak chokepoint: no-restricted-syntax selectors scoped to mcp/**/*.ts for computed process.env[x] + getProviderApiKey/getOpenAlexApiKey/loadRuntimeConfig calls
    - D-12 doctor-probe scope extension: ignores pattern with per-file exclusion (runtime-config-presence.ts)
    - D-12 runtime-config-presence static backstop: JSON.stringify Identifier + TemplateLiteral TemplateElement Identifier selectors for resolved-key names
    - ESLint flat-config override-merge safety: re-list all project-wide D-07/D-41 + D-10 selectors inside the mcp/** file-scoped block (same pattern as 02-02)
    - Global-ignores red-team fixture pattern (established Phase 0, extended Phase 2 for D-12)
    - Test-only copyFile exemption in eslint.config.js (deliberate, documented — same pattern as 02-01/02-02)
key_files:
  created:
    - tests/fixtures/lint-capabilities-noleak-fixture.ts
    - tests/lint-capabilities-noleak.test.ts
  modified:
    - eslint.config.js (D-12 mcp/** block + doctor-probe scope + runtime-config-presence backstop + lint-capabilities-noleak-fixture.ts in global-ignores + test exemption for lint-capabilities-noleak.test.ts)
key-decisions:
  - "D-12 mcp/** block re-lists all D-07/D-41/D-10 project-wide selectors — ESLint 9 flat-config file-scoped blocks OVERRIDE (not merge) the project-wide rule; the D-10 block (from 02-02) was the most recent mcp/** no-restricted-syntax block; without re-listing, adding D-12 would silently drop D-10 coverage on mcp/server.ts"
  - "D-12 doctor-probe scope uses files + ignores combination — ESLint flat-config ignores inside a config object excludes specific files from matching; this allows the computed-env selector to apply to all probes EXCEPT runtime-config-presence.ts"
  - "D-12 runtime-config-presence TemplateLiteral selector uses TemplateElement + Identifier sibling pattern — TemplateLiteral > Identifier would match any identifier descendant; TemplateElement + Identifier ensures only identifiers that follow a template element (i.e., are interpolated) are flagged"
  - "TypeScript as const on rules array incompatible with ESLint RuleConfig mutable type — rules inlined directly into overrideConfig to match sibling test patterns (02-01/02-02) and satisfy tsc"
duration: ~6 minutes
completed: "2026-05-16T10:07:10Z"
---

# Phase 2 Plan 03: Lint Capabilities No-Leak Summary

**D-12 capabilities-no-leak AST chokepoint shipped: computed process.env[x] reads and runtime.ts secret-resolution helper calls forbidden in mcp/**/*.ts; doctor-probe scope extension + runtime-config-presence static backstop added; 3-test regression gate (INLINE positive, INLINE control, PROJECT-config-loaded via mcp/ tmp copy) locks the rail before mcp/server.ts capabilities handler is written.**

## Performance

- **Duration:** ~6 minutes
- **Started:** 2026-05-16T10:01:18Z
- **Completed:** 2026-05-16T10:07:10Z
- **Tasks:** 3 completed (+ 1 deviation fix commit)
- **Files modified:** 3 (eslint.config.js, tests/fixtures/lint-capabilities-noleak-fixture.ts, tests/lint-capabilities-noleak.test.ts)

## Accomplishments

### Task 1: Create red-team fixture (D-12)

Created `tests/fixtures/lint-capabilities-noleak-fixture.ts` with five intentional D-12 violations:
- `process.env[provider.apiKeyEnv]` — computed MemberExpression via member access (D-12 selector A)
- `process.env[envName]` — computed MemberExpression via local variable (D-12 selector A)
- `await getProviderApiKey({ scope: 'paper' })` — runtime helper call (D-12 selector B)
- `await getOpenAlexApiKey()` — runtime helper call (D-12 selector B)
- `await loadRuntimeConfig()` — runtime helper call (D-12 selector B)

Plus one non-violation control: `process.env.HOME` (static dot-access — MUST NOT fire).

Fixture imports the three helpers from `../../bin/lib/runtime.js` so the call-expression nodes type-resolve at lint time. `@ts-nocheck` header — never compiled or executed, only AST-walked.

Commit: `b4473d2`

### Task 2: Add D-12 rules to eslint.config.js + global-ignores + test exemption

Extended `eslint.config.js` with:
1. New file-scoped block `{ files: ['mcp/**/*.ts'], rules: { 'no-restricted-syntax': ... } }` with 2 D-12 selectors (computed env + runtime helpers) PLUS all 6 project-wide D-07/D-41 selectors AND 5 D-10 selectors re-listed (override-merge safety — flat-config last-match semantics)
2. Doctor-probe scope extension block `{ files: ['bin/lib/doctor/probes/**/*.ts'], ignores: ['bin/lib/doctor/probes/runtime-config-presence.ts'], ... }` forbidding computed process.env in all probes except the authorized one
3. runtime-config-presence static backstop block with JSON.stringify + TemplateLiteral interpolation selectors for resolved-key identifiers
4. `tests/fixtures/lint-capabilities-noleak-fixture.ts` added to global-ignores
5. Exemption block `{ files: ['tests/lint-capabilities-noleak.test.ts'], rules: { 'no-restricted-syntax': 'off' } }` for PROJECT test's file copy

`npm run lint` and `npm run typecheck` both exit 0.

Commit: `f106197`

### Task 3: Create tests/lint-capabilities-noleak.test.ts (3 tests)

Created `tests/lint-capabilities-noleak.test.ts` with:
- **Test 1 (INLINE positive):** ESLint with `tseslint.configs.recommended` + inline D-12 selectors → asserts >=5 messages contain "D-12" when applied to fixture. `tseslint.configs.recommended` is required because the fixture uses TypeScript interface syntax.
- **Test 2 (INLINE control):** Same inline config applied to `process.env.HOME` snippet → asserts 0 D-12 messages (static dot-access is permitted).
- **Test 3 (PROJECT-config-loaded):** Loads actual `eslint.config.js`, strips global-ignores-only entries (Pitfall B5 mitigation), copies fixture to `mcp/_capabilities-noleak-fixture-tmp.ts` so the file-scoped D-12 block fires, asserts >=5 D-12 messages, verifies control line (process.env.HOME) is not flagged, cleans up in finally block.

Full suite: 248 pass, 0 fail (245 baseline + 3 new D-12 tests).

Commits: `577d513` (test file) + `b85a902` (typecheck fix)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript as const incompatible with ESLint RuleConfig mutable type**
- **Found during:** Task 3 — `npm run typecheck` after first commit
- **Issue:** The plan's template used `as const` on the `D12_RULES` array. TypeScript's ESLint types require `[Severity, ...unknown[]]` which is a mutable tuple; `readonly ["error", ...]` is not assignable to it. Error: TS2322 on `rules: { 'no-restricted-syntax': D12_RULES }`.
- **Fix:** Removed `D12_RULES` extracted constant; inlined the rules array directly inside each `overrideConfig` block. This matches the 02-01/02-02 sibling test pattern (which always inline their rule arrays).
- **Files modified:** `tests/lint-capabilities-noleak.test.ts`
- **Commit:** `b85a902`
- **Impact:** `npm run typecheck` exits 0. Tests still pass (248/248).

## Verification Results

All acceptance criteria met:

- `test -f tests/fixtures/lint-capabilities-noleak-fixture.ts` → EXISTS
- Fixture violation count (node verify): OK 5 violations + 1 control
- `grep -c "D-12" eslint.config.js` → 12 (well above minimum 4)
- `grep -c "files: \['mcp/\*\*/\*\.ts'\]" eslint.config.js` → 3 (D-09 from 02-01, D-10 from 02-02, D-12 from this plan)
- `grep -c "bin/lib/doctor/probes/" eslint.config.js` → 3 (heading comment + 2 config blocks)
- `npx eslint eslint.config.js --no-warn-ignored` → exits 0
- `npx eslint bin/ --no-warn-ignored` → exits 0 (no false positives on existing source)
- `npm run lint` → exits 0
- `npm run typecheck` → exits 0
- `test -f tests/lint-capabilities-noleak.test.ts` → EXISTS
- `grep -c "D-12" tests/lint-capabilities-noleak.test.ts` → 18 (rule messages + assertion text)
- `grep -c "mcp/_capabilities-noleak-fixture-tmp.ts" tests/lint-capabilities-noleak.test.ts` → 2
- `grep -c "unlink" tests/lint-capabilities-noleak.test.ts` → 2 (cleanup present)
- `node scripts/run-tests.mjs tests/lint-capabilities-noleak.test.ts` → 248 pass, 0 fail
- `test ! -f mcp/_capabilities-noleak-fixture-tmp.ts` → CLEAN (tmp file deleted)
- `npm run check` → exits 0

## Known Stubs

None — this plan creates only lint infrastructure (rules + fixture + tests). No capability handler yet; that's 02-04.

## Threat Flags

No new threat surface beyond what was identified in the plan's threat model:
- T-02-03-01 (computed env in capabilities handler): mitigated — D-12 selector A + regression test
- T-02-03-02 (inline runtime helper call): mitigated — D-12 selector B + regression test
- T-02-03-03 (capabilitiesNormalizer helper to defeat lint signal): D-21 rule restated in plan body; documented in CONTEXT.md
- T-02-03-04 (eslint-disable comment): accepted — code review gate; CI runs with --max-warnings 0

## Self-Check: PASSED

Files present:
- tests/fixtures/lint-capabilities-noleak-fixture.ts: FOUND
- tests/lint-capabilities-noleak.test.ts: FOUND
- eslint.config.js (modified): FOUND
- .planning/phases/02-tier-shells-doctor-tier-contract-gate/02-03-lint-capabilities-noleak-SUMMARY.md: FOUND (this file)

Commits present:
- b4473d2: feat(02-03): create D-12 capabilities-no-leak red-team fixture
- f106197: feat(02-03): add D-12 capabilities-noleak chokepoint rules to eslint.config.js
- 577d513: feat(02-03): add lint-capabilities-noleak.test.ts (D-12 regression gate)
- b85a902: fix(02-03): fix TypeScript type error in lint-capabilities-noleak.test.ts

Full test suite: 248 pass, 0 fail.
