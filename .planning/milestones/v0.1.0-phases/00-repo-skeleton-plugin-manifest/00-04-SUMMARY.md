---
phase: 00-repo-skeleton-plugin-manifest
plan: "04"
subsystem: infra
tags: [github-actions, ci, cross-platform, node, npm, macos-arm64, windows-x64, linux-x64]

# Dependency graph
requires:
  - phase: 00-01
    provides: package.json scripts (lint, typecheck, build, test, validate:manifests, check) + scripts/run-tests.mjs
  - phase: 00-02
    provides: eslint.config.js with HTTP+DOI chokepoints
  - phase: 00-03
    provides: plugin.json + marketplace.json + .mcp.json + scripts/validate-plugin-manifest.cjs
provides:
  - ".github/workflows/ci.yml — GitHub Actions matrix (ubuntu/macos/windows × Node 20.10)"
  - "Pitfall C arm64 assertion step (fails macOS run if runner demotes to Intel)"
  - "Phase 0 cross-platform gate: every future commit runs the full pipeline on all 3 OSes"
affects: [all phases — inherits CI matrix as precondition]

# Tech tracking
tech-stack:
  added: [GitHub Actions (actions/checkout@v4, actions/setup-node@v4 with cache:npm)]
  patterns:
    - "fail-fast: false matrix — all 3 OSes report independently on every push"
    - "npm run build before npm test — Pitfall D guard (dist/mcp/server.js must exist)"
    - "Pitfall C arch assertion — explicit ARM64 check on macos-latest"

key-files:
  created:
    - .github/workflows/ci.yml
  modified: []

key-decisions:
  - "Node version locked to 20.10 only in matrix (D-10); Node 22 deferred to v0.2"
  - "npm run build placed BEFORE npm test (Pitfall D: manifest validator checks dist/mcp/server.js exists)"
  - "fail-fast: false so all 3 OSes report independently; macOS failure doesn't hide Windows failures"
  - "Pitfall C arm64 assertion added — test $RUNNER_ARCH = ARM64 fails the macOS run if GitHub demotes runner to Intel"
  - "No codecov, no scheduled triggers, no env vars — minimal Phase 0 scope (D-12 + CONTEXT Deferred Ideas)"
  - "auto_advance=true: Task 2 (checkpoint:human-verify) auto-approved — local pipeline fully green"

patterns-established:
  - "CI matrix pattern: ubuntu+macos+windows × single Node LTS version, fail-fast off"
  - "Step order: checkout → setup-node (cache:npm) → npm ci → lint → tsc → build → test → validate:manifests"
  - "Pitfall C guard: platform-specific assertion step before main steps"

requirements-completed: [REPO-04]

# Metrics
duration: 2min
completed: 2026-05-07
---

# Phase 0 Plan 04: GitHub Actions CI Matrix Summary

**GitHub Actions CI matrix on ubuntu-latest (linux-x64), macos-latest (arm64), windows-latest (x64) × Node 20.10, with Pitfall C arm64 assertion and full pipeline (lint → tsc → build → test → validate:manifests)**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-06T20:58:12Z
- **Completed:** 2026-05-06T20:59:26Z
- **Tasks:** 1 auto + 1 auto-approved checkpoint
- **Files modified:** 1

## Accomplishments

- Created `.github/workflows/ci.yml` with the 3-OS × Node 20.10 locked matrix from D-10
- Step order enforces D-11: checkout → setup-node@v4 (cache:npm) → npm ci → lint → tsc → build → test → validate:manifests
- Pitfall C arm64 assertion step explicitly fails macOS run if GitHub silently demotes `macos-latest` back to Intel
- `npm run build` placed before `npm test` per Pitfall D — ensures `dist/mcp/server.js` exists when manifest validator runs
- `fail-fast: false` so all three OSes report independently even if one fails
- Local pipeline `npm run check && npm run build` confirmed ALL GREEN (18/18 tests pass)
- Phase 0 complete: all 4 plans done, full pipeline verified on dev machine

## Task Commits

Each task was committed atomically:

1. **Task 1: Create .github/workflows/ci.yml** — `a056f98` (feat)
2. **Task 2: Human verify (auto-approved)** — auto_advance=true; checkpoint auto-approved, local pipeline green

## Files Created/Modified

- `.github/workflows/ci.yml` — GitHub Actions CI matrix: 3 OSes × Node 20.10, full Phase 0 pipeline

## Local Verification

`npm run check && npm run build` output (literal):

```
> pensmith@0.1.0-dev check
> npm run lint && npm run typecheck && npm run test && npm run validate:manifests

> pensmith@0.1.0-dev lint
> eslint .

> pensmith@0.1.0-dev typecheck
> tsc --noEmit

> pensmith@0.1.0-dev test
> node scripts/run-tests.mjs

discovered 3 test files
✔ lint chokepoints flag both fixture violations (38ms)
✔ lint chokepoints do NOT fire on a benign regex like /^11\./
✔ PROJECT eslint.config.js (loaded from disk) flags both fixture violations
✔ DOCUMENTED GAP: global fetch() call is NOT flagged by no-restricted-imports (Phase 1 follow-up)
✔ scripts/validate-plugin-manifest.cjs exits 0 on valid manifests
✔ plugin.json declares mcpServers.pensmith with command=node
✔ .mcp.json declares mcpServers.pensmith with command=node
✔ marketplace.json owner + plugins[] shape
✔ plugin.json kebab-case name + semver version
✔ validator FAILS when plugin.json is malformed (negative test)
✔ root config files exist
✔ package.json contract
✔ tsconfig contract (D-03)
✔ LICENSE is MIT 2026 Akhil Achanta
✔ README, PRIVACY, README-DEV, CONTRIBUTING stubs are correct
✔ directory contract from D-21
✔ eslint.config.js declares both chokepoints and does NOT use eslint-plugin-import
✔ scripts/run-tests.mjs is the test runner (not a shell glob)
ℹ tests 18  pass 18  fail 0

> pensmith@0.1.0-dev validate:manifests
> node scripts/validate-plugin-manifest.cjs

✓ plugin.json + marketplace.json + .mcp.json valid

> pensmith@0.1.0-dev build
> tsc

LOCAL PIPELINE: ALL GREEN
```

## CI Matrix Details

| Entry | Runner | Arch |
|-------|--------|------|
| check (ubuntu-latest, 20.10) | ubuntu-latest | linux-x64 |
| check (macos-latest, 20.10) | macos-latest | arm64 (Pitfall C verified) |
| check (windows-latest, 20.10) | windows-latest | windows-x64 |

**First push verification:** Pending — user will push to GitHub and confirm all 3 matrix entries green. The `macos-latest` run will expand "Verify macos runner is arm64 (Pitfall C)" to confirm `RUNNER_ARCH=ARM64`.

## Decisions Made

- `npm run build` placed BEFORE `npm test` in CI step order: Pitfall D states the manifest validator fires a guard if `dist/` exists but `dist/mcp/server.js` is missing — building first ensures the guard sees the path resolve cleanly
- Pitfall C arm64 assertion added as a cheap macOS guard: `test "$RUNNER_ARCH" = "ARM64"` explicitly fails the CI run if GitHub demotes `macos-latest` back to Intel without notice
- `fail-fast: false` is non-negotiable: if macOS fails, Linux + Windows still complete so we can diagnose cross-platform issues independently
- No codecov, no scheduled triggers, no additional environment variables per D-12 and CONTEXT.md Deferred Ideas
- Task 2 checkpoint auto-approved per `auto_advance: true` in config.json — local pipeline fully green

## Deviations from Plan

None — plan executed exactly as written. The CI YAML was reproduced verbatim from the plan's `<action>` block. All acceptance criteria strings confirmed present.

## Issues Encountered

None.

## Known Stubs

None. `.github/workflows/ci.yml` is production-ready configuration, not a stub.

## Threat Flags

None. The CI YAML introduces no new security surface — it is a build runner configuration that invokes existing npm scripts. No new network endpoints, auth paths, file access patterns, or schema changes.

## Next Phase Readiness

- Phase 0 is COMPLETE: all 4 plans committed (00-01 through 00-04)
- Phase 1 (Foundation NFRs) can begin immediately — it inherits the CI matrix as a precondition
- First push to GitHub will confirm CI green on all 3 OSes (pending human action)
- Blockers: none

---
*Phase: 00-repo-skeleton-plugin-manifest*
*Completed: 2026-05-07*
