---
phase: 15-foundation-security-hardening
plan: "06"
subsystem: verifier-prompts / prompt-loader
tags: [security, prompt-injection, HARD-04c, WN-3, hash-pin, advisory-passes]
dependency_graph:
  requires: ["15-01"]
  provides: ["HARD-04c fenced prompts", "WN-3 re-pin for claim-support + orphan-label"]
  affects: ["templates/prompts/claim-support.md", "templates/prompts/orphan-label.md", "bin/lib/prompt-loader.ts", "tests/repo-files.test.ts"]
tech_stack:
  added: []
  patterns: ["unguessable UUID-style fence delimiter", "WN-3 atomic dual-site hash re-pin"]
key_files:
  created: []
  modified:
    - templates/prompts/claim-support.md
    - templates/prompts/orphan-label.md
    - bin/lib/prompt-loader.ts
    - tests/repo-files.test.ts
decisions:
  - "Used PENSMITH_UNTRUSTED_DATA_7f3a9c2e-4b8d-4f1a-a0e2-1c5d7b9f3e6a as the unguessable fence open marker (matching exactly what tests/pass2-injection.test.ts exports as FENCE_MARKER)"
  - "Fence marker appears in the SECURITY NOTE prose as well as each fenced block — 3 occurrences per prompt (note + 2 data fields each), satisfying the >=2 check in the injection test"
  - "Close marker is END_ prefixed version of the open marker"
  - "pass2.ts and pass4.ts unchanged — fencing is purely template text interpolated at call time"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-24"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 4
---

# Phase 15 Plan 06: HARD-04c Prompt Injection Fencing + WN-3 Re-pin Summary

Wrapped untrusted interpolation slots in the advisory Pass-2 (claim-support) and Pass-4 (orphan-label) prompt templates with unguessable UUID-style fence delimiters and updated both SHA-256 pin sites atomically.

## Tasks Completed

### Task 1: Fence untrusted fields in claim-support.md + orphan-label.md (HARD-04c)

Added to `templates/prompts/claim-support.md`:
- A `## SECURITY NOTE` section instructing the model to treat fenced content as DATA, not instructions, and that fenced content cannot change role/verdicts/output format
- `{{claim_sentence}}` wrapped in open/close fence markers (UNTRUSTED label)
- `{{source_abstract}}` wrapped in open/close fence markers (UNTRUSTED label)

Added to `templates/prompts/orphan-label.md`:
- Same `## SECURITY NOTE` section
- `{{sentence}}` wrapped in fence markers
- `{{paragraph_context}}` wrapped in fence markers

Fence marker used (exact FENCE_MARKER from pass2-injection.test.ts):
- Open: `<<<PENSMITH_UNTRUSTED_DATA_7f3a9c2e-4b8d-4f1a-a0e2-1c5d7b9f3e6a>>>`
- Close: `<<<END_PENSMITH_UNTRUSTED_DATA_7f3a9c2e-4b8d-4f1a-a0e2-1c5d7b9f3e6a>>>`

Verdict vocabulary, output format, and advisory nature of both passes are fully preserved.

### Task 2: WN-3 lockstep re-pin (repo-files.test.ts + prompt-loader.ts)

New SHA-256 hashes after fencing edits:
- `claim-support`: `38a28b6b8c997e56951799705b2337f2cdb24fe6c97fae4c631fd30f0fedaa26`
- `orphan-label`: `68330195e2cf4109d40ffbaf366e8d800d395153cb6add2cadbb0f244aefe974`

Updated BOTH pin sites atomically in the same commit:
1. `bin/lib/prompt-loader.ts` EXPECTED_PROMPT_HASHES lines 131-132
2. `tests/repo-files.test.ts` PENDING_HASH_PINS lines 332-333

`loadPrompt('claim-support')` and `loadPrompt('orphan-label')` resolve successfully with no `PENSMITH_ALLOW_PENDING_PROMPT_HASHES` bypass.

## Test Results

| Test file | Before | After |
|-----------|--------|-------|
| tests/pass2-injection.test.ts | 8 tests (some skipped) | 8 pass, 0 skip, 0 fail |
| tests/repo-files.test.ts | 50 tests | 50 pass, 0 fail |
| Full npm test | 949 pass / 3 skip / 0 fail | 949 pass / 3 skip / 0 fail |

- `npm run typecheck` (tsc --noEmit): CLEAN
- `npm run lint` on plan files: CLEAN (full suite lint error in tests/lock.test.ts is pre-existing from another Wave-2 plan, outside this plan's file scope)

## Commits

| Hash | Message |
|------|---------|
| `6b0f9d1` | feat(15-06): HARD-04c fence untrusted fields in Pass-2/Pass-4 prompts + WN-3 re-pin |

## Deviations from Plan

None — plan executed exactly as written. The fence marker appeared in the SECURITY NOTE prose section as well as in each fenced data block (3 total open-marker occurrences per file), which satisfies the test's `>= 2` requirement with headroom.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. Template edits only — the trust boundary change is additive mitigation (T-15-04c disposition: mitigate, now implemented).

## Self-Check

- `templates/prompts/claim-support.md` — FOUND, contains UNTRUSTED, fence count = 3
- `templates/prompts/orphan-label.md` — FOUND, contains UNTRUSTED, fence count = 3
- `bin/lib/prompt-loader.ts` — FOUND, hash updated to 38a28b6b...
- `tests/repo-files.test.ts` — FOUND, hash updated to 38a28b6b...
- Commit `6b0f9d1` — FOUND in git log

## Self-Check: PASSED
