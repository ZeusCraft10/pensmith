---
phase: 03-vertical-slice-one-section
plan: 08
wave: 5
status: completed
---

# Plan 03-08 — Wave 5 Summary

## Objective met

Wave 5 lit up the two Phase-2 hook stubs with their production bodies and
landed the HANDOFF assembler.

- `bin/lib/handoff.ts` (84 LOC) — assembleHandoff + writeHandoff emitting
  the D-17 LOCKED canonical shape from `bin/lib/schemas/handoff.ts`.
  Delegates the durable write to `atomicWriteFile` (D-07 LOCKED chokepoint).
  proper-lockfile guard on a dedicated `.lock` sentinel (NOT on
  HANDOFF.json itself — the target may not exist on first pre-compact run).
- `hooks/pre-compact.ts` (239 LOC) — `onPreCompact({ paperDir? })` per the
  test contract. Reads STATE.json (canonical) or STATE.md scan for phase;
  enumerates `.paper/sections/*` + STATE.json `sections[]` for pointers;
  uses `parseFrontmatter` (Plan 03 Task 3.4) to project PLAN.md.status
  into `section_pointers[].state`. D-12 LOCKED: pure template-literal
  next_action, zero LLM invocation. Silent stderr-degrade on failure.
- `hooks/post-tool-use.ts` (56 LOC) — `onPostToolUse` throttles
  CHECKPOINTS.jsonl to ≤1 write per 60s (T-3-DOS-04).
- `bin/lib/frontmatter.ts` is OWNED by Plan 03 Task 3.4 (CYCLE-2 H-1
  wave-order fix). Plan 08 only CONSUMED it via `parseFrontmatter` in
  pre-compact.ts.

## Acceptance gates

| Gate | Result |
| ---- | ------ |
| `grep "schema_version: 1 as const" bin/lib/handoff.ts` | ≥1 match (literal number) |
| `grep "schemaVersion: '1'" bin/lib/handoff.ts` | 0 matches (older shape gone) |
| `grep -c "HandoffSchema.parse" bin/lib/handoff.ts` | 2 (defense-in-depth) |
| `grep "atomicWriteFile(" bin/lib/handoff.ts` | 1 match (D-07 delegation) |
| `grep -E "writeFile.*tmp\|rename.*tmp" bin/lib/handoff.ts` | 0 matches (no reimplementation) |
| `grep "HANDOFF_LOCK_FILENAME\|HANDOFF.json.lock" bin/lib/handoff.ts` | ≥1 match (sentinel pattern) |
| `grep -c "loadPrompt\|draft-summary\|Task tool" hooks/pre-compact.ts` | 0 (D-12 LOCKED) |
| `npm run lint` | exit 0 |
| `npm run typecheck` (tsc --noEmit) | exit 0 |
| `npm run build` | exit 0 |
| `npm test` (PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1) | 495 pass / 31 fail / 3 skip |
| Handoff suite (handoff + handoff-size) | 6/6 GREEN |

## Sample HANDOFF.json output

For the minimal fixture used by `tests/handoff-size.test.ts` (STATE.json
with `sections: []`), the produced HANDOFF.json:

```json
{
  "schema_version": 1,
  "last_updated": "2026-05-27T...",
  "current_section": null,
  "phase": "intake",
  "next_action": "Resume intake on section (none). Last verb: unknown.",
  "breadcrumbs": [],
  "section_pointers": []
}
```

Size: ~200 bytes — well under the 5120-byte D-17 budget.

## Stale-lock recovery

`proper-lockfile` is invoked with `{ stale: 10_000, retries: { retries: 5,
minTimeout: 50 }, realpath: false }`. A 10-second stale threshold lets the
library reap orphan locks left by a killed previous process before
retrying. The `tests/handoff.test.ts` and `tests/handoff-size.test.ts`
suites both pass against this configuration.

## Net failing delta

- Pre-Wave-5 baseline: 490 pass / 33 fail
- Post-Wave-5: 495 pass / 31 fail
- Net: +5 passing, −2 failing (floor ≥ −4)

## Rule-3 deviations

**Minor** — removed 3 stale `@ts-expect-error` directives in
`tests/handoff.test.ts` and `tests/handoff-size.test.ts` once `HandoffSchema`
and `onPreCompact` started type-checking cleanly. Same pattern Plan 03-07
applied to the MCP-server tests when its production code landed.

## Confirmation: no `// TODO Phase 3` markers remain in hooks/

```
$ grep -rn "TODO Phase 3" hooks/
(no matches)
```

## Files modified

- `bin/lib/handoff.ts` (NEW, 84 LOC)
- `hooks/pre-compact.ts` (re-written, 239 LOC)
- `hooks/post-tool-use.ts` (re-written, 56 LOC)
- `tests/handoff.test.ts` (Rule-3: 2 @ts-expect-error directives removed)
- `tests/handoff-size.test.ts` (Rule-3: 1 @ts-expect-error directive removed)

## D-/T-3- mitigations closed

- D-17 (HANDOFF 5KB budget + locked schema shape)
- D-18 (pointers-only, never content)
- D-07 (atomic-write chokepoint preserved — handoff.ts delegates)
- D-12 (pre-compact carries zero LLM invocation)
- ARCH-04 (context-overflow safety net via pre-compact handoff)
- T-3-HOOK-01 (hooks degrade gracefully — try/catch + stderr-only)
- T-3-FSYNC-01 (atomic write through the durable D-07 chokepoint)
- T-3-DOS-04 (post-tool-use throttle ≤1/60s)
- T-3-CONCURRENCY-01 (proper-lockfile sentinel)
- T-3-LEAK-01 (HandoffSchema caps next_action @200 + pointers-only)
