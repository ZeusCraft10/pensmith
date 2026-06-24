---
phase: 16-ci-dx-parity-docs-packaging
verified: 2026-06-24T00:00:00Z
status: human_needed
score: 6/6
overrides_applied: 0
human_verification:
  - test: "Push the current commit to origin/main and confirm the GitHub Actions 3-OS matrix (ubuntu/macos/windows) is green, including the new 'Test suite + coverage gate (non-TTY stdin — CI-03)' step and the 'Assert working tree is clean after build (stale-derived-file guard — CI-02)' step"
    expected: "All 3 OS jobs complete green; the porcelain gate prints 'OK: working tree is clean.' and the coverage step exits 0 with all thresholds met"
    why_human: "The CI-02 porcelain gate and CI-03 coverage-under-non-TTY-stdin steps only run inside GitHub Actions — there is no local equivalent that exercises the actual fresh-clone checkout path on all 3 OSes. Local simulation (git status --porcelain + npm run test:coverage < /dev/null) passes and was verified, but the final 3-OS matrix confirmation requires a real push."
---

# Phase 16: CI/DX Parity + Docs & Packaging — Verification Report

**Phase Goal:** Make local==CI (prebuild-first check, porcelain-clean gate, coverage gate), ship real user-facing docs (README + §3 disclaimer at intake), fill four stub workflow bodies, and move nock to devDependencies with lazy import in http-mock.ts. Closes v0.2.0.
**Verified:** 2026-06-24
**Status:** human_needed — all 6 requirements verified in the codebase; one manual item remains (real 3-OS CI matrix confirmation on push).
**Re-verification:** No — initial verification.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | CI-01: `npm run check` runs prebuild FIRST (local order matches ci.yml) | VERIFIED | `package.json scripts.check = "npm run prebuild && npm run lint && npm run typecheck && npm run build && npm run test:tier-contract && npm test && npm run validate:manifests"`. Exact order verified programmatically. repo-files.test.ts line 66 asserts `scripts.check.startsWith('npm run prebuild')` (50/50 PASS). ci.yml step order: prebuild→lint→tsc→build→tier-contract→test:coverage→validate. |
| 2 | CI-02: ci.yml asserts `git status --porcelain` is empty after build; .gitignore covers generated files | VERIFIED | ci.yml lines 60-69: `Assert working tree is clean after build` step with `shell: bash` + `git status --porcelain` + `exit 1` on non-empty. .gitignore covers `bin/lib/version.generated.ts`, `bin/lib/verbs.json`, `coverage/`, `dist/`. Local simulation: `npm run prebuild && git status --porcelain` = empty. |
| 3 | CI-03: `test:coverage` script + `.c8rc.json` with `check-coverage:true` at ratchet thresholds; suite runs under non-TTY stdin; ci.yml has coverage step | VERIFIED | `.c8rc.json`: `check-coverage:true`, lines:80/functions:66/branches:66/statements:80 (recalibrated from Plan 01's 85/72/82/85 due to `all:true` flag changing effective baseline). `npm run test:coverage < /dev/null` = 971 pass, 0 fail, exit 0; measured lines:85.54/fn:71.51/br:90.19/st:85.54 — all above thresholds. ci.yml line 53-55: named step `Test suite + coverage gate (non-TTY stdin — CI-03)` with `shell: bash` + `npm run test:coverage < /dev/null`. |
| 4 | DOCS-01: README has install + /pensmith-only quickstart + PRD §3 disclaimer verbatim + GSD §18 credit; stale assertions gone; §3 disclaimer prints at intake | VERIFIED | README: §3 opener ("pensmith is a structured research-and-drafting assistant"), honest-framing ("not a guarantee against AI detectors"), §18 credit ("Get Shit Done"), `## Style Match` preserved, `/pensmith` quickstart only. Stale `/v0\.1\.0 in development/` and `/Phase 6/` assertions removed from repo-files.test.ts (lines 91-92 deleted). intake.ts: DISCLAIMER constant with "not a guarantee against AI detectors" written via `process.stdout.write` before any `ask()`. repo-files.test.ts lines 97-102: 3 real-content asserts (§3 opener, honest-framing, GSD credit) — 50/50 PASS. |
| 5 | DOCS-02: four workflow bodies filled (non-stub, capability_check, Shell-fallback, bijection); stale probe/PRIVACY copy refreshed; doctor-output.md WN-3 re-pinned | VERIFIED | doctor/status/next/resume.md: all have `## Overview`, `## Outputs`, `## Body`, `Shell fallback (TIER-06)`, `<capability_check>`. No stub sentinels ("Phase 2 stub", "Phase 3+", "## Steps"). workflow-bodies.test.ts: 3/3 PASS (guard opened). workflows-keyequal.test.ts: 4/4 PASS (16-verb/16-body bijection intact). validate-plugin-manifest.cjs: GREEN. http-crossref-ping.ts: stale "deferred to Phase 3 / not yet shipped" removed. doctor-output.md: SHA-256 = e43c0cd7... matches PINNED in repo-files.test.ts. PRIVACY.md: "ships with v0.1.0" gone; "local-only" + "No telemetry" preserved. |
| 6 | DOCS-03: nock in devDependencies (not dependencies); http-mock.ts lazy-imports nock; production-facing functions work without nock | VERIFIED | package.json: `devDependencies.nock = "^14"`, no `dependencies.nock`. http-mock.ts: no top-level `import nock from 'nock'`; `await import('nock')` found in loadCassettes/clearCassettes/recordCassettes/finalizeRecording. http-mock.test.ts: 2/2 PASS (Test A: no top-level import; Test B: isOfflineMode/loadCassetteDir/loadCassetteFile callable without nock). |

**Score:** 6/6 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | prebuild-first check, test:coverage script, nock in devDependencies | VERIFIED | check starts with `npm run prebuild`; `test:coverage` = `c8 node scripts/run-tests.mjs`; `coverage` key removed; nock in devDependencies only |
| `.c8rc.json` | check-coverage:true + ratchet thresholds | VERIFIED | lines:80/fn:66/br:66/st:80 (recalibrated post `all:true`); measured suite 85.54/71.51/90.19/85.54 — all above gate |
| `.github/workflows/ci.yml` | porcelain-clean gate + non-TTY coverage step; old bare npm test replaced | VERIFIED | CI-02 step (lines 60-69): `git status --porcelain` + exit 1; CI-03 step (lines 53-55): `npm run test:coverage < /dev/null` with `shell: bash`; bare `- run: npm test` removed |
| `.gitignore` | covers version.generated.ts, verbs.json, coverage/, dist/ | VERIFIED | All four patterns confirmed present |
| `README.md` | real README with §3 + §18 + /pensmith quickstart + Style Match | VERIFIED | All content assertions pass; stale v0.1.0/Phase 6 strings absent |
| `bin/cli/intake.ts` | §3 disclaimer via process.stdout.write before any ask() | VERIFIED | DISCLAIMER constant at run() line 331+; "not a guarantee against AI detectors" on single source line; written via `process.stdout.write(DISCLAIMER + '\n\n')` |
| `workflows/new.md` | disclaimer step in Body; capability_check preserved | VERIFIED | Body step 1 documents disclaimer print; `<capability_check>` block present |
| `workflows/doctor.md` | filled body: 11 probes, renderTty/renderJson, exit-1-on-FAIL | VERIFIED | 47 lines; ## Overview/Outputs/Body; Shell fallback (TIER-06); capability_check |
| `workflows/status.md` | filled body: loadState + readSectionState + resolveNextAction | VERIFIED | 39 lines; ## Overview/Outputs/Body; Shell fallback (TIER-06); capability_check |
| `workflows/next.md` | filled body: resolveNextAction state machine + dispatchVerb | VERIFIED | 49 lines; ## Overview/Outputs/Body; Shell fallback (TIER-06); capability_check |
| `workflows/resume.md` | filled body: HANDOFF → resolveNextAction → dispatchVerb → clear HANDOFF | VERIFIED | 42 lines; ## Overview/Outputs/Body; Shell fallback (TIER-06); capability_check |
| `bin/lib/http-mock.ts` | lazy nock import (no top-level); production functions nock-free | VERIFIED | `await import('nock')` in all 4 nock-using functions; isOfflineMode/loadCassetteFile/loadCassetteDir unchanged |
| `bin/lib/doctor/probes/http-crossref-ping.ts` | stale Phase-2/3 copy removed | VERIFIED | No "deferred to Phase 3", "not yet shipped", or "Phase 2" strings |
| `references/doctor-output.md` | refreshed http-crossref-ping section; SHA-256 re-pinned | VERIFIED | SHA-256 e43c0cd7... matches PINNED in repo-files.test.ts line 192; "cassette-wiring probe" copy matches probe summary |
| `PRIVACY.md` | "ships with v0.1.0" gone; real data-flow content; local-only + No telemetry preserved | VERIFIED | All three assertions pass |
| `tests/repo-files.test.ts` | CI-01 + DOCS-03 assertions; stale stub asserts removed; real README asserts added | VERIFIED | Lines 65-69: CI-01 (check starts with prebuild) + DOCS-03 (nock placement); lines 96-112: real README asserts; stale lines 91-92 deleted; 50/50 PASS |
| `tests/http-mock.test.ts` | DOCS-03 lazy-nock + production-functions-without-nock guard | VERIFIED | 2/2 PASS (guard opened — Plan 02 landed lazy import) |
| `tests/workflow-bodies.test.ts` | DOCS-02 non-stub content guard for doctor/status/next/resume | VERIFIED | 3/3 PASS (guard opened — Plan 04 filled bodies) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `package.json scripts.check` | `ci.yml` step order | Both run prebuild→lint→tsc→build→tier-contract→test→validate | WIRED | check script verified; ci.yml steps verified; orders match |
| `.c8rc.json` | `package.json test:coverage` | c8 auto-discovers .c8rc.json in repo root | WIRED | `npm run test:coverage < /dev/null` exits 0; thresholds enforced |
| `ci.yml` porcelain step | `.gitignore` | git status --porcelain empty because generated files gitignored | WIRED | `git status --porcelain` = empty after `npm run prebuild` |
| `bin/cli/intake.ts DISCLAIMER` | `process.stdout` | `process.stdout.write(DISCLAIMER + '\n\n')` before first ask() | WIRED | Source confirms write call at line 343 |
| `bin/lib/http-mock.ts` nock-using functions | `nock` (devDependency) | `await import('nock')` inside function bodies only | WIRED | 4 dynamic imports found; no top-level import |
| `references/doctor-output.md` bytes | `tests/repo-files.test.ts PINNED` | SHA-256 hash-pin (WN-3) | WIRED | Computed hash e43c0cd7... = PINNED constant |
| `repo-files.test.ts` CI-01 assertion | `package.json scripts.check` | `startsWith('npm run prebuild')` assert | WIRED | Assert at line 66; 50/50 PASS |

---

### Data-Flow Trace (Level 4)

Not applicable — phase delivers CI configuration, documentation, test scaffolding, and a packaging cleanup. No new dynamic data paths introduced.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CI-01: `check` starts with prebuild | `node -e "...startsWith('npm run prebuild')"` | ALL PASS | PASS |
| CI-02: porcelain empty after prebuild | `npm run prebuild && git status --porcelain` | empty output | PASS |
| CI-03: coverage gate meets thresholds | `npm run test:coverage < /dev/null` (exit code) | exit 0; lines 85.54/fn 71.51/br 90.19/st 85.54 vs gates 80/66/66/80 | PASS |
| CI-03: non-TTY stdin | `< /dev/null` redirect | 971/971 pass, 0 fail, exit 0 | PASS |
| DOCS-01: README §3 disclaimer present | `grep` on README.md | "not a guarantee against AI detectors" found | PASS |
| DOCS-01: §3 disclaimer at intake | `grep` on intake.ts | DISCLAIMER + process.stdout.write found | PASS |
| DOCS-01: stale asserts removed | repo-files.test.ts 50/50 | 50 pass, 0 fail | PASS |
| DOCS-02: 4 bodies non-stub | `node --import tsx --test tests/workflow-bodies.test.ts` | 3/3 PASS (guard opened) | PASS |
| DOCS-02: bijection intact | `node --import tsx --test tests/workflows-keyequal.test.ts` | 4/4 PASS | PASS |
| DOCS-02: manifest valid | `node scripts/validate-plugin-manifest.cjs` | GREEN | PASS |
| DOCS-02: WN-3 pin correct | SHA-256 of doctor-output.md | e43c0cd7... = PINNED | PASS |
| DOCS-03: nock in devDeps only | `node -e "...deps.nock / devDependencies.nock"` | ALL PASS | PASS |
| DOCS-03: http-mock.ts lazy nock | `node --import tsx --test tests/http-mock.test.ts` | 2/2 PASS | PASS |
| Full suite | `npm test` | 971/971 pass, 0 fail, 0 skip | PASS |
| Zero-trace invariant | `node --import tsx --test tests/zero-trace-export.test.ts` | 7/7 PASS | PASS |
| H1 lint gate | `node --import tsx --test tests/lint-tutorial-no-branch.test.ts` | 3/3 PASS | PASS |
| Lint | `npm run lint` | 0 errors, 1 pre-existing warning (coverage/lcov-report out of scope) | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| CI-01 | 16-02 | `npm run check` prebuild-first; repo-files assertion locks it | SATISFIED | check script verified; repo-files line 66 asserts it; 50/50 PASS |
| CI-02 | 16-02 | ci.yml porcelain gate + .gitignore covers generated files | SATISFIED | ci.yml lines 60-69; .gitignore verified for 4 required patterns |
| CI-03 | 16-01, 16-02 | test:coverage script + .c8rc.json check-coverage:true + non-TTY stdin step in ci.yml | SATISFIED | .c8rc.json with check-coverage:true; test:coverage exits 0; ci.yml step at lines 53-55 with `< /dev/null shell:bash` |
| DOCS-01 | 16-03 | README + intake disclaimer | SATISFIED | README rewritten; intake DISCLAIMER printed; repo-files real-content asserts pass |
| DOCS-02 | 16-01, 16-04 | 4 workflow bodies filled; stale copy refreshed; WN-3 re-pin | SATISFIED | workflow-bodies.test.ts 3/3; bijection 4/4; manifest GREEN; pin verified |
| DOCS-03 | 16-01, 16-02 | nock in devDeps; http-mock.ts lazy nock; production functions nock-free | SATISFIED | package.json verified; http-mock.test.ts 2/2 PASS |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| coverage/lcov-report/block-navigation.js | 1 | Unused eslint-disable directive | Info | Generated file in gitignored `coverage/` dir; out of scope for this phase; pre-existing |

No TBD/FIXME/XXX markers found in any Phase 16 modified files. No unreferenced debt markers. No stubs in production output paths.

---

### Human Verification Required

#### 1. Real 3-OS CI Matrix Confirmation

**Test:** Push the current HEAD (commit after Plan 04 — `e966cb0`) to `origin/main` (or open a PR) and observe the GitHub Actions CI run.

**Expected:**
- All 3 OS jobs (ubuntu-latest, macos-latest, windows-latest) complete GREEN.
- The `Test suite + coverage gate (non-TTY stdin — CI-03)` step completes with exit 0; coverage report shows lines/fn/branches/statements all above the .c8rc.json thresholds (80/66/66/80).
- The `Assert working tree is clean after build (stale-derived-file guard — CI-02)` step prints `OK: working tree is clean.` and exits 0 on all 3 OSes.
- The `Generate derived sources (prebuild)` step runs before lint/typecheck (confirming CI-01 ordering in the CI context).

**Why human:** The CI-02 porcelain gate exercises the actual fresh GitHub Actions checkout environment (not just `git status --porcelain` locally). The `< /dev/null` non-TTY redirect requires Git Bash (`shell: bash`) on Windows — confirmed in the YAML but only verifiable on a real Windows GitHub runner. Local simulation of both gates passes but cannot substitute for the 3-OS matrix run. This is the single outstanding validation item per the VALIDATION.md "Manual-Only Verifications" table.

---

### Gaps Summary

No gaps found. All 6 requirements (CI-01, CI-02, CI-03, DOCS-01, DOCS-02, DOCS-03) are verifiably satisfied in the codebase with passing test evidence. The sole outstanding item is the real 3-OS GitHub Actions matrix run — a structural limit of CI verification (cannot run GitHub Actions locally), not a code deficiency.

**Invariants verified:**
- Single-command UX: `/pensmith` is the only command in the README quickstart. PASS.
- §3 disclaimer is the only disclosure mechanism: ships in README AND printed at intake. PASS.
- Honest framing: "not a guarantee against AI detectors" present; no "undetectable"/"evade detection"/"impersonate". STYL-04 asserts PASS.
- 16-verb/16-body bijection: workflows-keyequal.test.ts 4/4 PASS; validate-plugin-manifest GREEN.
- Zero-trace invariant: zero-trace-export.test.ts 7/7 PASS.
- Verifier gate: not regressed (full suite 971/971 PASS).

---

_Verified: 2026-06-24_
_Verifier: Claude (gsd-verifier)_
