---
phase: 02-tier-shells-doctor-tier-contract-gate
plan: "08"
subsystem: contributing-docs
tags: [contributing, tier-contract, D-24, D-23, prose-gate, repo-files-test]
dependency_graph:
  requires:
    - 02-07-tier-contract (D-23 layers 1–3 live; section can reference real-and-running mechanisms)
    - 02-00-review-cleanup (tests/repo-files.test.ts baseline)
  provides:
    - CONTRIBUTING.md § Tier contract — do not skip (D-24-locked prose, D-23 layer 4)
    - tests/repo-files.test.ts CF-D24 test (drift protection)
  affects:
    - All future contributors and AI agents touching mcp/, bin/cli/, workflow/hook scaffolding
tech_stack:
  added: []
  patterns:
    - D-24 locked-prose pattern (content locked in CONTEXT, enforced by test)
    - repo-files.test.ts additive extension (02-00 assertions preserved verbatim)
key_files:
  created: []
  modified:
    - CONTRIBUTING.md (97 lines added — D-24-locked Tier contract section)
    - tests/repo-files.test.ts (31 lines added — CF-D24 test)
decisions:
  - "CONTEXT.md D-24 headings match PLAN verbatim — no divergence found; PLAN prose used as-is"
  - "Markdown lint warnings (MD032 blanks-around-lists) are pre-existing and not CI-blocking (npm run lint does not lint .md files)"
  - "CF-D24 test uses assert.match with /s (dotAll) flag for multi-line regex assertions — consistent with assert.match API"
metrics:
  duration: "~5 minutes"
  completed_date: "2026-05-16"
  tasks_completed: 2
  files_created: 0
  files_modified: 2
---

# Phase 2 Plan 08: Contributing Summary

**One-liner:** D-24-locked "Tier contract — do not skip" section added to CONTRIBUTING.md (D-23 layer 4 — prose gate), guarded by a CF-D24 test that asserts all 5 headings, 3 Wave 1 chokepoints, and 4 merge-gate layers on every PR.

## What Was Built

**CONTRIBUTING.md § Tier contract — do not skip** — The fourth and final layer of D-23's hard merge gate. The section is D-24-locked and contains:

- **`### What the tier contract guarantees`** — Explains Tier 1 / Tier 2 behavioral equivalence for `paper://capabilities` (Case A), D-12 presence-flag enforcement (Case B), and `paper_advance_section` idempotency (Case C).
- **`### The four merge-gate layers`** — Names all four layers: CI step (`npm run test:tier-contract` on 3-OS matrix, D-22), branch protection (GitHub settings one-time setup), preflight (`scripts/validate-plugin-manifest.cjs`, D-23), prose (this section, D-24).
- **`### Wave 1 lint chokepoints (the file you're not allowed to write)`** — Explains D-09 thin-shim, D-10 mcp-no-network, D-12 capabilities-no-leak with concise "what it catches" and "what to do instead" guidance.
- **`### Discipline rule: fix the tiers, don't write a normalizer`** — The D-21 discipline rule: lists unacceptable fixes (capabilitiesNormalizer, loosening assertions, test.skip, eslint-disable) and acceptable fixes in order of preference.

The Phase 0 chokepoints section (HTTP / DOI rules) is preserved verbatim.

**tests/repo-files.test.ts CF-D24 test** — Additive extension after the 02-00 assertions. Asserts:
- All 5 D-24-locked headings are present verbatim
- D-09 thin-shim, D-10 mcp-no-network, D-12 capabilities-no-leak are each named
- All 4 merge-gate layers (CI step, branch protection, preflight, prose/this section) are named
- Phase 0 "Architectural chokepoints" section is preserved

## Tests

- 352 baseline (end of 02-07) + 1 new CF-D24 test = **353 total**, all pass.
- `npm run check` exits 0: lint + typecheck + build + test:tier-contract + npm test + validate:manifests all green.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | `9a99f7f` | docs(02-08): add Tier contract — do not skip section to CONTRIBUTING.md |
| 2 | `d9f490c` | test(02-08): add CF-D24 test asserting Tier contract section in CONTRIBUTING.md |

## Deviations from Plan

None — plan executed exactly as written.

- CONTEXT.md D-24 headings were checked and match the PLAN's verbatim body exactly. No divergence.
- The plan noted markdown lint does not apply to .md files; IDE warnings (MD032) are pre-existing and non-blocking.
- 02-00's existing assertions were preserved unchanged.

## Requirements Closed

- **D-24:** CONTRIBUTING.md has the locked "Tier contract — do not skip" section.
- **D-23 layer 4 (prose):** Live and named. All four D-23 gate layers are now complete.
- **Phase 2 closed:** All 10 plans (02-00 through 02-09 as structured in the wave) complete. Requirements ARCH-01, ARCH-03, ARCH-18, TIER-01..07, DOCT-01..07 addressed across the full Phase 2 plan set.

## Threat Flags

None — all new surface is documentation and read-only test assertions (no new network endpoints, no new auth paths, no schema changes).

## Known Stubs

None — the section references real-and-running mechanisms (tier-contract test, CI step, preflight validator all landed in prior plans).

## Self-Check: PASSED

Files modified:
- CONTRIBUTING.md: FOUND (97 lines added, verified by inline node -e check)
- tests/repo-files.test.ts: FOUND (CF-D24 test added)

Commits exist:
- 9a99f7f: FOUND (Task 1 — CONTRIBUTING.md tier contract section)
- d9f490c: FOUND (Task 2 — CF-D24 test)

Test count: 353 pass, 0 fail (verified by npm run check).

Grep self-checks (all returned expected counts):
- `## Tier contract — do not skip`: 1
- `### What the tier contract guarantees`: 1
- `### The four merge-gate layers`: 1
- `### Wave 1 lint chokepoints`: 1
- `### Discipline rule`: 1
- D-09|D-10|D-12|D-21|D-22|D-23|D-24 matches: 6
- `test:tier-contract`: 1
