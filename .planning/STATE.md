---
gsd_state_version: 1.0
milestone: v0.1.0
milestone_name: milestone
status: executing
stopped_at: Phase 2 plan 02-05 (cli-doctor) complete. bin/pensmith.ts citty dispatcher (16 UX-02 verbs), 10 doctor probes, read-only runDoctor(), TTY + --json renderers, exit-code contract, 300 tests pass. Next plan is 02-06.
last_updated: "2026-05-16T10:45:00Z"
last_activity: 2026-05-16 -- Phase 2 plan 02-05 executed (3 tasks + 4 auto-fixes, 20 files created, commits 53d6f68/89ff1f3/52b5e7e)
progress:
  total_phases: 11
  completed_phases: 2
  total_plans: 28
  completed_plans: 21
  percent: 75
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-06)

**Core value:** Every citation in every exported paper is real and supports the claim it's attached to — verified by re-fetching the live DOI/quote. The verifier blocks compile and export; no FABRICATED, MIS-CITED, or quote-NOT_FOUND ever escapes.
**Current focus:** Phase 1 — Foundation NFRs (Phase 0 repo skeleton lands first; Foundation NFRs immediately after, in strict dependency order)

## Current Position

Phase: 2 of 11 (Tier shells + doctor + tier-contract gate) — **EXECUTING**
Plan: 02-05 complete (8/10 plans in Phase 2); next is 02-06
Status: Executing Phase 2
Last activity: 2026-05-16 -- 02-05 cli-doctor complete (53d6f68/89ff1f3/52b5e7e)

Progress: [███████░░░] 71%  (Phase 0 done; Phase 1 closed; Phase 2 wave 2 partial)

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
- 01-12 (wave 10) — ✅ DONE — checkpoint.ts D-60 append-only audit log (2dd174b / 24a0200 / 44bec0f)
- 01-13 (wave 11) — ✅ DONE — runtime.ts + pricing.ts (ARCH-14, Key Finding #5 OPENALEX_API_KEY slot) — 43a1835 / adfcbc2 / b00ed17 / SUMMARY-pending

See `.planning/HANDOFF.json` for the next-executor handoff (last_updated 2026-05-09T00:30:00Z, points at `/gsd-verify-phase 1`).

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
- [01-13] pricing.ts is a separate file from runtime.ts — pure constant table + pure function with NO imports/IO; runtime.ts is the W2+W3+W7+W9 config-loader chokepoint. Different semantic surfaces → different files; W6 budget.ts imports estimateCost from pricing.ts without pulling in the chokepoint stack
- [01-13] T-01-07 no-leak property — resolved api-key VALUES never reach disk (W7 schema persists env-var NAMES only) AND never reach the session log (`present:boolean` pre-computed before log call so the resolved string never enters the payload object). Test 8 in tests/runtime.test.ts is the load-bearing assertion
- [01-13] ENOENT → defaults() (NOT NotFoundError) — runtime config is OPTIONAL; missing runtime.json operates with schema defaults. First W10/W11 sibling that does NOT translate ENOENT to a typed error class (state/library/checkpoint all throw NotFoundError on ENOENT; runtime returns defaults)
- [01-13] defaults() seeds an anthropic provider entry — W7 RuntimeConfigSchema's providers has a .refine requiring ≥1 provider, so `RuntimeConfigSchema.parse({})` would fail without seed. anthropic with apiKeyEnv='ANTHROPIC_API_KEY' is the production-typical first provider; callers overwrite via saveRuntimeConfig
- [01-13] Test fixtures adapted per Plan-vs-Schema reconciliation — W7 ProviderSchema requires `name: z.enum(['anthropic','openai'])` in addition to `apiKeyEnv`; test fixtures here include the `name` field. Same reconciliation pattern as 01-12 (refs typing)
- [01-13] gpt-5 set equal to gpt-4o per RESEARCH §pricing-pending — placeholder so budget assertions don't accidentally rely on a divergent value while the official rate is still unannounced. When OpenAI publishes the rate, bump the entry and reference the vendor page in the commit message
- [02-00] parseRetryAfter is a pure export in retry.ts (not inlined in http.ts) — matches fullJitterDelayMs shape; independently unit-testable per D-01
- [02-00] serverRetryDelay closure inside wrapped fn — cleanest Retry-After pattern given retry() fixed-base signature; maxAttempts/baseMs/capMs unchanged (T-02-00-02 preserved)
- [02-00] SHA-256 hash-pin (not substring match) for doctor-output.md — substring match silently allows inserted lines or rewritten copy outside matched fragments (D-18)
- [02-00] DOCT-05/wiring-smoke absent from doctor-output.md — Phase 3 deferral enforced by anti-drift assertion in repo-files.test.ts (D-04)
- [02-01] tseslint.configs.recommended required in inline ESLint test config when fixture uses TypeScript-specific syntax (declare const) — precedent for future chokepoint test inline configs
- [02-01] tests/lint-thin-shim.test.ts exempted from no-restricted-syntax (D-07 writeFile selector) — test-only fsp.writeFile to create mcp/-pathed tmp file; deliberate and documented
- [02-01] D-09 handler statement-count budget enforced by AST walk in Test 3, not by ESLint selector — no-restricted-syntax cannot count statement-body length in a single selector
- [02-02] D-10 mcp/** file-scoped block re-lists all D-07/D-41 project-wide selectors — ESLint 9 flat-config file-scoped blocks OVERRIDE (not merge) project-wide rule; without re-listing, DOI regex in mcp/server.ts would escape the chokepoint
- [02-02] https selector included in D-10 alongside net/http/tls — plan listed 5 selectors including https.createServer; all 5 covered in fixture and eslint.config.js
- [02-03] D-12 mcp/** block re-lists D-07/D-41/D-10 selectors — ESLint 9 flat-config last-match semantics: the D-12 block (third mcp/** no-restricted-syntax block) REPLACES D-10 block without re-listing; same override-merge safety pattern as 02-02
- [02-03] D-12 doctor-probe scope uses files+ignores combination — ESLint flat-config ignores inside a config object excludes specific files from matching; allows computed-env selector on all probes except the authorized runtime-config-presence.ts
- [02-03] TypeScript as const on rules array incompatible with ESLint RuleConfig mutable type — inline rules in overrideConfig instead (matches 02-01/02-02 sibling pattern)
- [02-04] SDK v1.29 wraps all handler errors (including zod McpError(InvalidParams)) in {isError:true, content:[...]} body — TIER-06 tests assert res.isError===true instead of assert.rejects; this is correct per SDK mcp.js catch block behavior
- [02-04] loadCapabilityFacts() in bin/lib/capabilities.ts is the single authorised composition site for runtime config + env presence flags; both mcp/resources.ts and mcp/tools.ts are zero-composition thin shims (D-12 architectural fix from cross-AI review)
- [02-04] sections[] added as optional field to StateSchema v1 (not via migration) — additive-only change; mutation helpers default to prev.sections ?? [] so existing STATE.json files are backward-compatible
- [02-04] verifyDoi() added to bin/lib/doi.ts (Rule 3 auto-fix) — Phase 1 doi.ts only had normalization; Phase 2 paper_doi_verify tool requires Crossref re-fetch; doi.ts exemption covers http import
- [02-05] bin.pensmith locked to dist/bin/pensmith.js (D-24 LOCKED path) in package.json — exact path required by 02-07 preflight and CONTRIBUTING.md
- [02-05] http-crossref-ping probe is SKIP-only in Phase 2 (cross-AI review HIGH fix from Codex iter 1) — production code must not import from tests/; Phase 3 ships bin/lib/http-mock.ts production-tree chokepoint to re-enable PASS/FAIL
- [02-05] DOCT-07 runtime-config-presence delegates entirely to loadCapabilityFacts() (cross-AI cycle-2 HIGH #2) — single composition site shared with mcp/; probe only re-keys snake_case to camelCase for the doctor's historical detail shape
- [02-05] TIER-03 exit-code test uses [FAIL] pattern (not /FAIL/) to avoid matching the footer 'N FAIL' count in the TTY renderer

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

Last session: 2026-05-16T10:45:00Z
Stopped at: Phase 2 plan 02-05 complete. bin/pensmith.ts citty dispatcher (16 UX-02 verbs, 1 real + 15 stubs), 10 doctor probes (DOCT-01/02/03/04/05/07 + D-03(d) SKIP-only), runDoctor() Record<string,ProbeResult>, TTY + --json renderers (D-16/D-18), exit code from FAIL presence (D-15), D-12 no-leak sentinel test, 300 tests pass, lint+typecheck+build clean. Next: 02-06.
Resume file: .planning/phases/02-tier-shells-doctor-tier-contract-gate/02-06-PLAN.md (next_action: execute 02-06)
