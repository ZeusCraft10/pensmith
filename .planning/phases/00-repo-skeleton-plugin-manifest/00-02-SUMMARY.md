---
phase: 00-repo-skeleton-plugin-manifest
plan: "02"
subsystem: linting
tags: [eslint, flat-config, chokepoint, no-restricted-imports, no-restricted-syntax, node-test, typescript-eslint]

requires:
  - phase: 00-01
    provides: package.json (eslint + typescript-eslint deps), tsconfig.json (exclude tests/fixtures/**/*), scripts/run-tests.mjs, directory contract

provides:
  - eslint.config.js (flat config with D-06 HTTP + D-07 DOI chokepoint rules, per-file exemptions, fixture ignore)
  - tests/fixtures/lint-chokepoint-fixture.ts (D-08 red-team fixture with both violations)
  - tests/lint-chokepoint.test.ts (4-test programmatic ESLint regression gate)
  - tests/repo-files.test.ts (8-test smoke suite for Phase 0 root file contract)

affects: [00-03, 00-04, all-later-phases, Phase-1-bin-lib-http.ts, Phase-1-bin-lib-doi.ts]

tech-stack:
  added: []
  patterns:
    - ESLint flat config chokepoint enforcement (no-restricted-imports + no-restricted-syntax, per-file overrides)
    - Red-team fixture as regression gate (D-08 pattern — rules without a fixture rot silently)
    - ESLint flat-config global-ignores semantics: filter ignores-only entries to re-lint ignored files in integration tests

key-files:
  created:
    - eslint.config.js
    - tests/fixtures/lint-chokepoint-fixture.ts
    - tests/lint-chokepoint.test.ts
    - tests/repo-files.test.ts
  modified: []

key-decisions:
  - "ESLint flat-config global ignores (objects with only an ignores key) cannot be overridden by a later files entry — integration tests that need to lint an ignored file must filter out global-ignores entries from the loaded project config"
  - "AST selector for D-07 DOI regex chokepoint: Literal[regex.pattern=/^\\^10\\\\\\./] (4-level escape depth per Pitfall B)"
  - "Project config integration test (test 3) loads eslint.config.js from disk proving the rule configs are correct, not just that rules work in theory"

patterns-established:
  - "Pattern: Red-team fixture + programmatic ESLint test as regression gate for architectural lint chokepoints"
  - "Pattern: Filter global-ignores entries when loading project ESLint config for integration testing"

requirements-completed: [REPO-01, REPO-05]

duration: ~4min
completed: "2026-05-07"
---

# Phase 0 Plan 02: ESLint Chokepoints + Regression Gate Summary

**ESLint flat config with HTTP (D-06) and DOI-regex (D-07) chokepoints, backed by a red-team fixture + 4-test programmatic regression gate and 8-test repo-files smoke suite — all three verification commands green.**

## Performance

- **Duration:** ~4 minutes
- **Started:** 2026-05-06T20:44:53Z
- **Completed:** 2026-05-06T20:48:31Z
- **Tasks:** 2
- **Files created:** 4 (eslint.config.js + 3 test files)
- **Files modified:** 0 (package.json and tsconfig.json untouched)

## Accomplishments

- `eslint.config.js` with `no-restricted-imports` (5 HTTP import paths) and `no-restricted-syntax` (D-07 DOI AST selector) chokepoints, per-file exemptions for `bin/lib/http.ts` and `bin/lib/doi.ts`, and global-ignore for the red-team fixture
- `tests/fixtures/lint-chokepoint-fixture.ts` — D-08 red-team file with both intentional violations (`import { fetch } from 'undici'` + `/^10\./` regex), `@ts-nocheck`, excluded from project lint and typecheck
- `tests/lint-chokepoint.test.ts` — 4-test programmatic ESLint gate: (1) both rules fire on fixture, (2) benign `/^11\./` does NOT fire (Pitfall B negative test), (3) PROJECT eslint.config.js loaded from disk flags both violations, (4) documented gap: global `fetch()` not caught by `no-restricted-imports`
- `tests/repo-files.test.ts` — 8-test smoke suite: root files exist, package.json/tsconfig contracts, LICENSE, stub docs, D-21 directory contract, eslint chokepoint declarations, run-tests.mjs shape
- 12/12 tests pass; `npm run lint` exit 0; `npm run typecheck` exit 0

## Task Commits

Each task was committed atomically:

1. **Task 1: Create eslint.config.js** - `d9bc781` (feat)
2. **Task 2: Red-team fixture + chokepoint test + repo-files smoke test** - `158f8ed` (feat)

**Plan metadata:** _(committed below as docs commit)_

## Files Created

- `eslint.config.js` — ESLint 9 flat config with D-06 HTTP + D-07 DOI chokepoints, per-file exemptions, fixture ignores
- `tests/fixtures/lint-chokepoint-fixture.ts` — D-08 red-team fixture (intentional violations, @ts-nocheck, ignored by project lint)
- `tests/lint-chokepoint.test.ts` — 4-test programmatic chokepoint regression gate
- `tests/repo-files.test.ts` — 8-test Phase 0 root file contract smoke suite

## Resolved Dependency Versions

Inherited from Plan 01 (`npm install` on 2026-05-07):

| Package | Resolved |
|---------|---------|
| eslint | 9.39.4 |
| typescript-eslint | 8.59.2 |
| @typescript-eslint/parser | 8.59.2 |

## Verification Results

### npm run lint
```
Exit code: 0
(no violations — fixture is ignored by project config)
```

### npm run typecheck
```
Exit code: 0
(fixture is excluded via tsconfig.exclude: tests/fixtures/**/* from Plan 01)
```

### npm test
```
discovered 2 test files
✔ lint chokepoints flag both fixture violations (36.5ms)
✔ lint chokepoints do NOT fire on a benign regex like /^11\./ (2.2ms)
✔ PROJECT eslint.config.js (loaded from disk) flags both fixture violations (701.9ms)
✔ DOCUMENTED GAP: global fetch() call is NOT flagged by no-restricted-imports (Phase 1 follow-up) (2.6ms)
✔ root config files exist (1.4ms)
✔ package.json contract (0.3ms)
✔ tsconfig contract (D-03) (0.2ms)
✔ LICENSE is MIT 2026 Akhil Achanta (0.3ms)
✔ README, PRIVACY, README-DEV, CONTRIBUTING stubs are correct (0.6ms)
✔ directory contract from D-21 (0.7ms)
✔ eslint.config.js declares both chokepoints and does NOT use eslint-plugin-import (0.2ms)
✔ scripts/run-tests.mjs is the test runner (not a shell glob) (0.3ms)
tests 12 | pass 12 | fail 0
Exit code: 0
```

## AST Selector Note (Pitfall B)

The DOI regex chokepoint uses this AST selector (unchanged from plan — no adjustment required):

```
Literal[regex.pattern=/^\^10\\\\\\./]
```

This is correct at 4 levels of escape depth:
1. ESLint AST: pattern `^10\.`
2. In regex attribute selector: `/^\^10\\./` (one level)
3. In JS string within config: `Literal[regex.pattern=/^\\^10\\\\\\./]` (two more levels)

Verified via Pitfall B's negative test: benign `/^11\./` does NOT trigger the rule.

## package.json and tsconfig.json Unchanged

```
git diff --stat package.json tsconfig.json
(empty output — no changes)
```

Both files are byte-identical to Plan 01's outputs. This plan adds files only.

## Decisions Made

- **ESLint flat-config global-ignores semantics (Rule 1 auto-fix):** The plan's suggested approach of appending `{ files: ['tests/fixtures/...'] }` to override a global `ignores` entry does not work in ESLint flat config. Global `ignores` (objects with only an `ignores` key, no `files` key) are hard excludes that cannot be overridden by later `files` entries. The correct approach — filtering out global-ignores-only entries from the loaded project config before constructing the integration-test ESLint instance — was applied automatically.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ESLint flat-config global ignores cannot be overridden by files entries**
- **Found during:** Task 2 (tests/lint-chokepoint.test.ts — PROJECT integration test)
- **Issue:** Plan specified appending `{ files: ['tests/fixtures/lint-chokepoint-fixture.ts'] }` to the spread project config to "un-ignore" the fixture. This does NOT work in ESLint 9 flat config: a global-ignores object (with only an `ignores` key, no `files` key) is a hard global exclude. ESLint returns `ruleId: null, message: "File ignored because of a matching ignore pattern"` instead of rule violations.
- **Fix:** Filter out global-ignores-only entries from the loaded `projectConfig` array before constructing the ESLint instance for the integration test. All rule-carrying entries (objects with `files` or `rules`) are kept; only pure-`ignores` objects are removed. Updated the test comment to document this ESLint flat-config behavior.
- **Files modified:** `tests/lint-chokepoint.test.ts`
- **Verification:** `npm test` — all 12 tests pass including the project-config integration test
- **Committed in:** `158f8ed` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in plan's suggested approach for overriding ESLint global ignores)
**Impact on plan:** Required approach adjustment in the integration test; no functional scope change. The test still achieves its goal: proving the project's actual eslint.config.js rule configs are correct (not just that rules work with an inline copy).

## Known Stubs

None — this plan adds no stubs. The per-file exemptions for `bin/lib/http.ts` and `bin/lib/doi.ts` reference Phase 1 modules that don't exist yet, but the exemptions are forward-looking architectural declarations, not stubs.

## Threat Flags

None — this plan adds only lint config and tests. No network endpoints, auth paths, file access patterns, or schema changes at trust boundaries.

## Issues Encountered

ESLint 9 flat-config global-ignores semantics differ from the plan's assumed behavior (documented above). Resolved cleanly with a one-line filter in the integration test.

## Next Phase Readiness

- `npm run lint` is now a real gate (not vacuous) — any engineer who writes `import {...} from 'undici'` outside `bin/lib/http.ts` or uses `/^10\./` outside `bin/lib/doi.ts` gets an ESLint error immediately
- `npm test` discovers and runs test files; runner exits 0
- Phase 0 Plans 00-03 (CI workflow + manifests) can proceed in parallel
- Phase 1 can land `bin/lib/http.ts` and `bin/lib/doi.ts` — the per-file overrides are already in place

---
*Phase: 00-repo-skeleton-plugin-manifest*
*Completed: 2026-05-07*

## Self-Check: PASSED

Files verified:
- eslint.config.js: FOUND (import tseslint, no-restricted-imports, no-restricted-syntax, bin/lib/http.ts, bin/lib/doi.ts, lint-chokepoint-fixture.ts — all present; eslint-plugin-import absent)
- tests/fixtures/lint-chokepoint-fixture.ts: FOUND (from 'undici', /^10\\./, @ts-nocheck)
- tests/lint-chokepoint.test.ts: FOUND (ESLint import, overrideConfigFile, 4 test blocks, both assert.ok includes checks)
- tests/repo-files.test.ts: FOUND (8 test blocks, package.json, scripts/run-tests.mjs, tsconfig, LICENSE, README/PRIVACY/CONTRIBUTING, D-21 dirs, eslint checks)

Commits verified:
- d9bc781: FOUND (Task 1 — eslint.config.js)
- 158f8ed: FOUND (Task 2 — fixture + tests)
