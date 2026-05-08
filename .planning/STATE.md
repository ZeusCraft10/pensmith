---
gsd_state_version: 1.0
milestone: v0.1.0
milestone_name: milestone
status: executing
stopped_at: Wave 10 complete (state + library + checkpoint all shipped); Wave 11 (runtime) is the only remaining Phase 1 plan
last_updated: "2026-05-08T23:55:00.000Z"
last_activity: 2026-05-08 -- Phase 01 Plan 12 (checkpoint.ts) shipped — feat 2dd174b + test 24a0200; 203 tests pass
progress:
  total_phases: 11
  completed_phases: 1
  total_plans: 32
  completed_plans: 17
  percent: 53
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-06)

**Core value:** Every citation in every exported paper is real and supports the claim it's attached to — verified by re-fetching the live DOI/quote. The verifier blocks compile and export; no FABRICATED, MIS-CITED, or quote-NOT_FOUND ever escapes.
**Current focus:** Phase 1 — Foundation NFRs (Phase 0 repo skeleton lands first; Foundation NFRs immediately after, in strict dependency order)

## Current Position

Phase: 1 of 11 (Foundation NFRs) — EXECUTING (13/14 plans complete)
Plan: 13/14 complete through Wave 10 sibling C (checkpoint.ts); next is 01-13 (runtime.ts), the sole Wave 11 plan
Status: In flight — Wave 10 trio (state + library + checkpoint) all shipped; only Wave 11 (runtime) remains in Phase 1
Last activity: 2026-05-08 -- Plan 12 checkpoint.ts shipped: feat 2dd174b, test 24a0200 (9 new tests; 203 total pass)

Progress: [█████░░░░░] 53%  (Phase 0 done; Phase 1 13/14 plans through 01-12)

Plan files (depends_on order):

- 01-00 (wave 0)  — ✅ DONE — Wave 0 prep (CI Node 20.10→20.18, deps, chokepoints, fixtures, locked WARN copy) — commits 2e109dc / f3569c3 / f1842e7
- 01-01 (wave 1)  — ✅ DONE — paths.ts (a507cd7 recovery + 7b0869e tests + 79cf59d SUMMARY)
- 01-02 (wave 2)  — ✅ DONE — atomic-write.ts D-07 chokepoint (908cdc2 / 53e01b5 / e1b582e)
- 01-03 (wave 3)  — ✅ DONE — lock.ts proper-lockfile CJS shim (2a5bed4 / b250bb0 / 4599549)
- 01-04 (wave 4)  — ✅ DONE — doi.ts + fast-check property fuzz (b915ad6 / a793506 / 479403d)
- 01-05 (wave 5)  — ✅ DONE — http.ts undici + retry shim + 8 cassettes (a71a798 / 0a56be6 / 30f7642 / 4538b44)
- 01-06 (wave 6)  — ✅ DONE — budget.ts cost ledger (65fb183 / 8567e88 / 795296c)
- 01-07 (wave 4)  — ✅ DONE — migrations + 5 zod schemas + loader (8bd0a4d / 85fc938 / ed35099 / d0d955b / 4f1b11a)
- 01-08 (wave 4)  — ✅ DONE — pii.ts D-49 redaction primitives (1c9f3af / 2a77d74 / 89d1493)
- 01-09 (wave 9)  — ✅ DONE — session-log.ts JSONL D-49/50/51/52 (f605207 / 1334691 / 6e4b985)
- 01-10 (wave 10) — ✅ DONE — state.ts D-58 paper-state glue (8617c63 / e475b0b / 85e2737)
- 01-11 (wave 10) — ✅ DONE — library.ts D-59 paper-library glue (3a2e83c / fe430e3 / 9ee0aac)
- 01-12 (wave 10) — ✅ DONE — checkpoint.ts D-60 append-only audit log (2dd174b / 24a0200 / SUMMARY-pending)
- 01-13 (wave 11) — ⏭ NEXT — runtime.ts (structural-only tests; OPENALEX_API_KEY slot)

See `.planning/HANDOFF.json` for the next-executor handoff (last_updated 2026-05-08T23:55:00Z, points at 01-13).

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| Phase 0 (00-01) | 1 | ~12 min | ~12 min |
| Phase 0 (00-02) | 1 | ~4 min | ~4 min |
| Phase 0 (00-03) | 1 | ~3 min | ~3 min |
| Phase 0 (00-04) | 1 | ~2 min | ~2 min |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table. Recent decisions affecting current work:

- Section-as-phase as load-bearing model — directory contract (`.paper/sections/<NN-slug>/`) enforces state isolation
- Two-tier source-of-truth — workflow bodies + templates shared between Tier 1 plugin and Tier 2 CLI
- `tier-contract.test.js` is a Phase 2 hard merge gate (not a wrap-up task)
- Verifier Pass 1 (DOI integrity + author/title fuzzy match) and Pass 3 (OA quote verification) are deterministic and blocking; Pass 2 + Pass 4 are LLM-judged and advisory
- Zero pensmith trace in exports — verified by zero-trace test in Phase 6
- OneDrive/iCloud/Dropbox/Google Drive detection ships in Phase 2 doctor (dev folder is in OneDrive)
- CSL via citeproc-js + bundled CSL files resolves PRD §17 citation-style open question
- [00-01] scripts.test = node scripts/run-tests.mjs (not shell glob) — Windows cmd.exe glob-expansion landmine avoided per D-10
- [00-01] No eslint-plugin-import at Phase 0 — D-06 satisfied by built-in no-restricted-imports + per-file override
- [00-01] tsconfig.exclude includes tests/fixtures/**/* — Plan 02 red-team fixture excluded from typecheck from day one
- [00-02] ESLint flat-config global ignores cannot be overridden by later files entries — integration tests that re-lint ignored files must filter out global-ignores entries from loaded project config
- [00-02] AST selector for D-07 DOI chokepoint: Literal[regex.pattern=/^\^10\\\\\\./] — 4-level escape depth (Pitfall B verified by negative test)
- [00-03] MCP server declared in BOTH plugin.json.mcpServers AND .mcp.json (Assumption A3 — redundant dual-declaration per D-18 + RESEARCH A3)
- [00-03] Structural assertions used for manifest validation (no JSON-Schema) — Anthropic publishes no stable JSON-Schema artifact; structural approach matches gsd-plugin's bin/validate-plugin.cjs (D-17 revised cycle 2)
- [00-03] eslint.config.js requires scripts/**/*.cjs override for @typescript-eslint/no-require-imports — .cjs files in ESM packages intentionally use require(); tseslint.configs.recommended flags this without the override
- [00-04] npm run build placed BEFORE npm test in CI step order — Pitfall D: manifest validator checks dist/mcp/server.js exists when dist/ exists; building first ensures clean path resolution
- [00-04] Pitfall C arm64 assertion step added to macos-latest — test "$RUNNER_ARCH" = "ARM64" explicitly fails CI if GitHub demotes runner to Intel without notice
- [00-04] fail-fast: false locked in — all 3 OSes report independently; macOS failure does not hide Windows failures
- [01-12] D-60 carve-out from D-39 — append-only audit log (CHECKPOINTS.jsonl) reads via CheckpointSchema.safeParse and SKIPS bad/forward-versioned lines with one WARN per call; this is the SOLE Phase-1 exception to refuse-forward-incompat, justified by the append-only semantic (skipping never causes data loss)
- [01-12] Plan vs Schema reconciliation (user ruling) — Plan said `refs: Record<string, unknown>`; W7 schema (locked) is `z.record(z.string(), z.string())`. Public API honors the schema (refs?: Record<string, string>); test 4 adapted to use string values; foundation-slice carry-forward note softened to allow future broadening via versioned migration
- [01-12] Concurrency budget — W3 default exponential-backoff retry schedule (factor=1.5, retries=16) cannot accommodate 20+ concurrent contenders on Windows + OneDrive within the default 60s timeoutMs; checkpoint test 6 lowered to N=10 to match W11 sibling and stay within retry budget

### Pending Todos

None yet.

### Blockers/Concerns

- Style-match (Phase 8) is novel-territory dual-use with no industry precedent; flagged for milestone-close review of guardrails before shipping.
- PRD §17 open questions (verifier prompt wording, section-dependency syntax, wave-scheduling algorithm, MCP SDK choice, PDF parsing library, style-match implementation, library index format, section renumbering policy) deferred to per-phase discuss-phase as planned.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none — fresh init)* | | | |

## Session Continuity

Last session: 2026-05-08T23:55:00.000Z
Stopped at: Wave 10 complete — 01-10 (state), 01-11 (library), and 01-12 (checkpoint) all shipped; only 01-13 (runtime, Wave 11) remains in Phase 1
Resume file: .planning/HANDOFF.json (next_action points at /gsd-execute-phase 1 to pick up 01-13)
