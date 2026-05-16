---
phase: 02-tier-shells-doctor-tier-contract-gate
plan: "05"
subsystem: cli-doctor
tags: [tier-2, citty, doctor, probes, dispatcher, cli]
dependency_graph:
  requires: [02-00, 02-04]
  provides: [bin/pensmith.ts, bin/cli/stubs.ts, bin/cli/doctor.ts, bin/lib/doctor/probes.ts, bin/lib/doctor/render.ts, bin/lib/doctor/probes/*]
  affects: [02-07-tier-contract-gate]
tech_stack:
  added: [citty@^0.2.2 (already installed 02-00)]
  patterns: [citty-subcommands, probe-interface, probe-aggregator, record-keyed-by-id]
key_files:
  created:
    - bin/pensmith.ts
    - bin/cli/stubs.ts
    - bin/cli/doctor.ts
    - bin/lib/doctor/probes.ts
    - bin/lib/doctor/render.ts
    - bin/lib/doctor/probes/node-version.ts
    - bin/lib/doctor/probes/mcp-sdk-presence.ts
    - bin/lib/doctor/probes/zotero-mcp-presence.ts
    - bin/lib/doctor/probes/pandoc-presence.ts
    - bin/lib/doctor/probes/humanizer-skill-presence.ts
    - bin/lib/doctor/probes/contact-email-presence.ts
    - bin/lib/doctor/probes/sync-folder-detection.ts
    - bin/lib/doctor/probes/runtime-config-presence.ts
    - bin/lib/doctor/probes/build-artifact-resolves.ts
    - bin/lib/doctor/probes/http-crossref-ping.ts
    - tests/cli-verbs.test.ts
    - tests/cli-stubs.test.ts
    - tests/doctor-probes.test.ts
    - tests/doctor-exit-code.test.ts
    - tests/doctor-shape.test.ts
  modified:
    - package.json
decisions:
  - "[02-05] bin.pensmith locked to dist/bin/pensmith.js (D-24 LOCKED path) in package.json — exact path required by 02-07 preflight and CONTRIBUTING.md"
  - "[02-05] http-crossref-ping probe is SKIP-only in Phase 2 (cross-AI review HIGH fix from Codex iter 1) — production code must not import from tests/; Phase 3 ships bin/lib/http-mock.ts production-tree chokepoint to re-enable PASS/FAIL"
  - "[02-05] D-04 sync-folder-detection uses PENSMITH_PAPER_DIR env-var override for test isolation — paperDir() resolves from process.cwd() in production"
  - "[02-05] DOCT-07 runtime-config-presence delegates entirely to loadCapabilityFacts() (cross-AI cycle-2 HIGH #2) — single composition site shared with mcp/; probe only re-keys snake_case to camelCase for the doctor's historical detail shape"
  - "[02-05] TIER-03 exit-code test uses [FAIL] pattern (not /FAIL/) to avoid matching the footer 'N FAIL' count in the TTY renderer"
metrics:
  duration: "815 seconds (~14 min)"
  completed_date: "2026-05-16"
  tasks: 3
  files_created: 20
  files_modified: 1
  tests_added: 35
  tests_baseline: 265
  tests_final: 300
---

# Phase 2 Plan 05: CLI Doctor Summary

**One-liner:** citty dispatcher with 16 UX-02 verbs (doctor real + 15 stubs) + read-only doctor verb running 10 probes returning `Record<string, ProbeResult>` (D-20), exit code from FAIL presence (D-15), human-first TTY + `--json` renderers (D-16/D-18).

## Objectives Met

- bin/pensmith.ts: citty dispatcher with exactly 16 subCommands (UX-02 canonical per D-05)
- bin/cli/stubs.ts: makeStub() factory — all 15 stub verbs print "not implemented yet" and exit 0
- bin/cli/doctor.ts: doctor verb handler — runDoctor() + renderTty/renderJson + exit-code logic
- bin/lib/doctor/probes.ts: ProbeResult/Probe/Severity types + runDoctor() aggregator
- bin/lib/doctor/render.ts: TTY + JSON renderers (D-18 locked shape from references/doctor-output.md)
- 10 probe modules: DOCT-01 (node-version), DOCT-01-wiring (mcp-sdk-presence), DOCT-02 ecosystem (zotero, pandoc, humanizer), DOCT-03 (contact-email), DOCT-04 (sync-folder), DOCT-05 Phase-2 substitute (build-artifact-resolves), DOCT-07 (runtime-config-presence), D-03(d) (http-crossref-ping SKIP-only)

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | citty dispatcher + 16 UX-02 verbs | 53d6f68 | bin/pensmith.ts, bin/cli/stubs.ts, bin/cli/doctor.ts, tests/cli-verbs.test.ts, tests/cli-stubs.test.ts |
| 2 | Ten probes + aggregator | 89ff1f3 | bin/lib/doctor/probes.ts, bin/lib/doctor/render.ts, bin/lib/doctor/probes/* (10 files), tests/doctor-probes.test.ts |
| 3 | Doctor renderer + exit-code tests | 52b5e7e | tests/doctor-exit-code.test.ts, tests/doctor-shape.test.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] workflows/*.md preflight test updated for empty workflows dir**
- **Found during:** Task 1 test execution
- **Issue:** `workflows/` directory exists from Phase 0 (with `.gitkeep`) but has no `.md` files; plan spec assumed either directory missing OR populated — neither case handled the empty-but-present case
- **Fix:** Added `if (files.length === 0) return;` early exit to the preflight test
- **Files modified:** tests/cli-verbs.test.ts
- **Commit:** 53d6f68

**2. [Rule 1 - Bug] DOCT-07 sentinel test used wrong env-var key**
- **Found during:** Task 2 test execution
- **Issue:** Test cleared all provider keys then set `OPENALEX_API_KEY = SENTINEL`, but the default runtime config only has `ANTHROPIC_API_KEY` in its providers array; `OPENALEX_API_KEY` is not a registered provider slot → probe always returned WARN (0 providers), not PASS
- **Fix:** Changed sentinel injection to `ANTHROPIC_API_KEY` (the actual default provider slot)
- **Files modified:** tests/doctor-probes.test.ts
- **Commit:** 89ff1f3

**3. [Rule 1 - Bug] TIER-03 exit-code test used /FAIL/ pattern matching footer count**
- **Found during:** Task 3 test execution
- **Issue:** TTY renderer always emits `Doctor: N PASS, N WARN, N FAIL, N SKIP` footer containing "FAIL" even when no probe failed; `/FAIL/` test incorrectly entered the catch branch
- **Fix:** Changed to `/\[FAIL\]/` (matching only the probe-level TTY icon, not the footer count)
- **Files modified:** tests/doctor-exit-code.test.ts
- **Commit:** 52b5e7e

**4. [Rule 1 - Bug] runtime-config-presence.ts comments referenced forbidden string pattern**
- **Found during:** Task 2 acceptance criteria check
- **Issue:** Plan spec requires `grep -lE 'loadRuntimeConfig' bin/lib/doctor/probes/*.ts` returns no files; probe file had this string in comments (correctly explaining WHY we don't use it directly)
- **Fix:** Replaced the literal function name in comments with descriptive text ("runtime config") while preserving the documented intent
- **Files modified:** bin/lib/doctor/probes/runtime-config-presence.ts
- **Commit:** 89ff1f3

## Key Design Decisions

- **D-12 (no-leak):** runtime-config-presence probe delegates fully to `loadCapabilityFacts()` — same helper mcp/ uses — rather than calling `loadRuntimeConfig()` + `process.env[...]` directly. Tier-equivalence for DOCT-07 is structural (same source), not statistical (parallel implementations).
- **D-03(d):** http-crossref-ping ships as SKIP-only in Phase 2. Cross-AI review HIGH from Codex iter 1: production code must never import from `tests/`. Phase 3 will introduce `bin/lib/http-mock.ts` (production-tree) and re-enable PASS/FAIL.
- **D-17:** sync-folder-detection probe honors `PENSMITH_PAPER_DIR` env-var for test isolation, defaulting to `paperDir()` in production.
- **D-18:** JSON render shape `{ schemaVersion: 1, probes: Record, summary: { pass, warn, fail, skip } }` matches references/doctor-output.md exactly.
- **D-20:** `runDoctor()` returns `Record<string, ProbeResult>` keyed by `probe.id` (NOT an array), killing array-order questions and enabling parallel probe execution by Tier 1 in future phases.

## Known Stubs

- **15 of 16 verbs** in bin/pensmith.ts are stubs: `new`, `next`, `status`, `research`, `outline`, `plan`, `write`, `verify`, `compile`, `done`, `resume`, `list`, `open`, `sketch`, `add`. Each prints "not implemented yet" and exits 0. Phase 3+ will replace them.
- **http-crossref-ping** probe is SKIP-only in Phase 2 (by design, documented in code and tests). Phase 3 will enable PASS/FAIL.

## Threat Flags

No new threat surfaces beyond those enumerated in the plan's STRIDE register. All T-02-05-01..08 mitigations implemented:
- T-02-05-01 (sentinel-value leak test): 3 tests verify SENTINEL never appears in detail
- T-02-05-02 (D-19 read-only): test asserts no files created in tmp dir after runDoctor()
- T-02-05-03 (stub spoofing): cli-stubs.test.ts asserts every stub matches /not implemented yet/

## Self-Check: PASSED

Files exist:
- bin/pensmith.ts: FOUND
- bin/cli/stubs.ts: FOUND
- bin/cli/doctor.ts: FOUND
- bin/lib/doctor/probes.ts: FOUND
- bin/lib/doctor/render.ts: FOUND
- All 10 probe files: FOUND
- All 5 test files: FOUND

Commits exist:
- 53d6f68 (Task 1): FOUND
- 89ff1f3 (Task 2): FOUND
- 52b5e7e (Task 3): FOUND

Test suite: 300 tests, 0 failures (baseline was 265; added 35)
Lint: CLEAN
TypeCheck: CLEAN
Build: dist/bin/pensmith.js, dist/bin/cli/stubs.js, dist/bin/cli/doctor.js, dist/mcp/server.js — all PRESENT
