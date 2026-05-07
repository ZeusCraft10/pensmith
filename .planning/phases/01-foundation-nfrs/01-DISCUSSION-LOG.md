# Phase 1: Foundation NFRs - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 1-foundation-nfrs
**Mode:** `--auto` (no interactive prompts; recommended option auto-selected for every gray area)
**Areas discussed:** Build order, Atomic write contract, Lock file, DOI normalization, HTTP client, Cassette tests, Budget gating, Migrations + schema versioning, Cross-platform paths, PII redaction, Session log, State/library/checkpoint scope, Runtime layer, Testing strategy, New chokepoint lint rules

---

## Build order & PR cadence

| Option | Description | Selected |
|--------|-------------|----------|
| Strict 13-step dep order, one plan per lib (waves allowed when deps overlap) | Honor ROADMAP "in strict order" + ARCH 3-ring model | ✓ |
| Mega-plan with all 13 libs in one PR | Faster review but blast-radius is the whole foundation | |
| Bottom-up bundles (3-4 libs per plan) | Compromise but obscures dep direction | |

**Auto-selected:** Option 1.
**Notes:** ROADMAP.md goal text mandates "in strict order"; ARCHITECTURE.md ring model collapses if a later lib lands first. Within each wave (e.g., state/library/checkpoint), the planner has discretion to co-plan libs that share no test surface.

---

## Atomic write contract (ARCH-05)

| Option | Description | Selected |
|--------|-------------|----------|
| `write tmp → fsync(tmp) → rename → fsync(dir)` + `.tmp.${pid}.${rand}` temp + chokepoint lint | PRD §14 + Pitfall 4 prescribed pattern | ✓ |
| Skip dir-fsync; rename-only | Faster but loses data on power loss / OneDrive pause | |
| `fs.writeFile` with retry on EBUSY | Sync-folder-friendly but doesn't guarantee atomicity | |

**Auto-selected:** Option 1.
**Notes:** Dir-fsync is the silent-data-loss landmine. Lift verbatim from gsd-plugin/bin/lib/core.cjs if license permits. Add a chokepoint lint banning direct `fs.writeFile` outside `bin/lib/atomic-write.ts` mirroring the REPO-05 / Phase 0 D-06 pattern.

---

## Lock file (ARCH-06)

| Option | Description | Selected |
|--------|-------------|----------|
| Platform local-only data dir + JSON payload (PID/hostname/heartbeat) + `proper-lockfile@^4` + hard-abort on conflict | PRD §14 + CLAUDE.md OneDrive non-negotiable | ✓ |
| Lock inside `.paper/lockfile` | OneDrive will eat it on this dev machine | |
| Hand-rolled `fs.open(..., 'wx')` | Misses race / stale-mtime edge cases that proper-lockfile handles | |
| Wait-and-retry semantics on conflict | Risks masking real concurrent-edit bugs | |

**Auto-selected:** Option 1.
**Notes:** Project hash is `sha256(absolute path).slice(0,16)` so two same-name projects in different folders never collide. Heartbeat 30s; stale threshold 90s. Lock-conflict test (TEST-07) uses `child_process.spawn` against compiled `dist/` and runs on all 3 OSes — explicitly tested from inside the OneDrive folder.

---

## DOI normalization (ARCH-15, REPO-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Single chokepoint; ordered normalize spec; ASCII-only case-fold; both canonical+as-cited stored; PMID/PMCID separate; `fast-check` round-trip property test | PRD §14 + Pitfall 2 + DOI Handbook | ✓ |
| Lowercase the entire string (including non-ASCII) | Violates DOI Handbook (`10.123/ABÇ` ≠ `10.123/abç`) | |
| Trust input; normalize on read only | Misses trailing-punct false-FABRICATED (#1 source of fake-failures) | |
| `doi-regex` for both extraction AND normalization | `doi-regex` doesn't normalize; only extract | |

**Auto-selected:** Option 1.
**Notes:** Normalization order: strip prefix → strip trailing punct repeatedly → ASCII-only lowercase → final-shape regex. arXiv handles old (`cs/0501001`) and new (`2401.12345v3`) formats; PMID is digits-only, PMCID has `PMC` prefix. Property test corpus reused by Phase 3 verifier.

---

## HTTP client (ARCH-12, ARCH-13, ARCH-14)

| Option | Description | Selected |
|--------|-------------|----------|
| `undici@^7` + `p-retry@^6` + hand-rolled per-source TTL disk cache + per-source rate-limit floors + WARN-once on missing email + OPENALEX_API_KEY slot | STACK.md verdict + Pitfall 7 + ROADMAP §1 SC-5 | ✓ |
| `undici` with built-in `CacheStore` | HTTP-semantic cache (Vary, Cache-Control) doesn't fit per-source DOI-keyed TTL | |
| `node-fetch` / `axios` / `got` | All explicitly rejected in STACK.md "What NOT to use" | |
| Hard-refuse without `PENSMITH_CONTACT_EMAIL` | PRD §12: free basics work without it; doctor warns, http WARN-once and proceeds | |

**Auto-selected:** Option 1.
**Notes:** Public API discriminates by `source` enum (Crossref, OpenAlex, arXiv, PubMed, Unpaywall, Semantic Scholar, Retraction Watch, DuckDuckGo, GPTZero, generic). `generic` emits a runtime WARN. Per-source TTL defaults: Crossref/OpenAlex/arXiv/PubMed/SemScholar 24h; Unpaywall 7d; Retraction Watch 1h; DDG 1h; GPTZero never cached. URL normalization for cache key drops tracking params.

---

## Cassette tests required for HTTP

| Option | Description | Selected |
|--------|-------------|----------|
| 8 cassettes: 429/Retry-After, 503/no-header, Retry-After-as-HTTP-date, X-Rate-Limit-Reset, missing-email-WARN+proceed+200, cache-hit, TTL-expiry, bypassCache | ROADMAP §1 SC-5 explicit + STACK.md nockBack | ✓ |
| Just the 3 ROADMAP-named (429 / 503 / Retry-After) | Misses missing-email path which SC-5 also names | |
| Live network tests in CI | Flaky; rate-limited; STACK.md explicitly gates live behind PENSMITH_NETWORK_TESTS=1 | |

**Auto-selected:** Option 1.
**Notes:** All cassettes via `nock@^14` `nockBack` recorder pattern; fixtures live at `tests/fixtures/http-cassettes/`. Live tests gated `PENSMITH_NETWORK_TESTS=1` env (default OFF in CI).

---

## Budget gating (ARCH-09, ARCH-10, ARCH-11)

| Option | Description | Selected |
|--------|-------------|----------|
| `assertBudget` throws BEFORE LLM call; per-session $5 + per-step $0.50; `.paper/COSTS.jsonl` ledger; `Semaphore` primitive for `--max-parallel` | PRD §10 + Pitfall 6 + ROADMAP §1 SC-4 | ✓ |
| Track cost; warn after-the-fact | Pitfall 6 explicit anti-pattern (after-billing abort is too late) | |
| Per-session cap only | Runaway parallel waves can blow budget without per-step gating (SUMMARY push-back #5) | |
| In-memory ledger only | Loses state across `/compact` and resume | |

**Auto-selected:** Option 1.
**Notes:** Cost-fixture test (TEST-08) injects a Promise-resolving "LLM" and asserts the call never returns. `Semaphore` primitive ships now even though no Phase 1 code uses it (Phase 3 dispatcher + Phase 4 wave scheduler will).

---

## Migrations + schema versioning (ARCH-07)

| Option | Description | Selected |
|--------|-------------|----------|
| `schema_version: 1` everywhere day-one; loader at `bin/lib/migrations/loader.ts`; refuse-forward-incompat throws; zod schemas in `bin/lib/schemas/` | PRD §14 + Pitfall 5 | ✓ |
| Add schema_version when first breaking change happens | Pitfall 5 explicit anti-pattern (retrofitting versioning is painful) | |
| Best-effort migrate forward-incompat | Risks corrupting state on read | |
| JSON Schema instead of zod | zod doubles as type definition AND validator (per STACK.md) | |

**Auto-selected:** Option 1.
**Notes:** Phase 1 ships zero migrations (we're at v1) but the loader + the contract test + the `ForwardIncompatError` envelope land now.

---

## Cross-platform paths (ARCH-08)

| Option | Description | Selected |
|--------|-------------|----------|
| `paths.ts` resolves Windows %LOCALAPPDATA% / macOS Application Support / Linux XDG_DATA_HOME; chokepoint lint bans direct `os.homedir()`; `isInsideSyncFolder()` ships now | Pitfall 4 + Pitfall 8 + REQUIREMENTS ARCH-08 + DOCT-04 dependency | ✓ |
| Use Windows %APPDATA% (roaming) | OneDrive may sync %APPDATA% — use %LOCALAPPDATA% (non-roaming) | |
| `~/.pensmith` everywhere | Violates platform conventions; gets in trouble with Windows MAX_PATH | |
| Defer `isInsideSyncFolder()` to Phase 2 | Phase 2 doctor needs it ready; cheap to ship now in the right module | |

**Auto-selected:** Option 1.
**Notes:** Slug constraint `/^[a-z0-9][a-z0-9-]{0,40}$/` to dodge MAX_PATH (260) under deeply-nested OneDrive paths. Red-team fixture `tests/lint-paths-chokepoint.test.ts` mirrors REPO-05 / Phase 0 D-08 pattern.

---

## PII redaction (ARCH-17)

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-rolled regex (names, dates, SSN, email, phone); deterministic replacement tokens + diff for review; opt-in only; backend-swap API for v0.2 Presidio | STACK.md + PRD §17 + REQUIREMENTS ARCH-17 | ✓ |
| Microsoft Presidio shellout in v0.1 | Adds Python dep; STACK.md defers to v0.2 | |
| Skip PII redaction in v0.1 | REQUIREMENTS ARCH-17 says ship in v0.1 | |

**Auto-selected:** Option 1.
**Notes:** Document the over- and under-match honestly in PRIVACY.md. v0.2 path: `redact({ enabled, backend: 'regex'|'presidio' })` — the `backend` field doesn't exist in v0.1 but the API shape is replaceable.

---

## Session log (ARCH-16)

| Option | Description | Selected |
|--------|-------------|----------|
| JSONL at `.paper/SESSION.log`; rotate at 50MB; oversize records truncated with spillover to `.paper/sessions/${run_id}/`; `--show-prompts` toggle hook | PRD §10 + REQUIREMENTS ARCH-16 | ✓ |
| Plain text log | Loses structured replay capability | |
| One file per session | Many small files; harder to grep | |
| No size cap | Can grow unbounded on long-running sessions | |

**Auto-selected:** Option 1.
**Notes:** Append uses `fs.appendFile` (atomic for ≤PIPE_BUF). NOT routed through `atomic-write.ts` (which is for whole-file replacement). Read API (tail/iterate) deferred to Phase 7 resume.

---

## State / library / checkpoint scope (foundation slice)

| Option | Description | Selected |
|--------|-------------|----------|
| Foundation slice ONLY: project-level state, JSON library index + `proper-lockfile`, checkpoint envelope shape; section state machine + UX deferred | REQUIREMENTS phase mapping (ARCH-19/20 → Phase 4, LIB-02..05 → Phase 8) | ✓ |
| Ship section state machine now | ARCH-19 maps to Phase 4; would smuggle Phase 4 scope into Phase 1 | |
| Ship `/pensmith list` UX now | LIB-02..05 map to Phase 8 | |
| SQLite library index now | LIB-V2-01 is v0.2; STACK.md defers | |

**Auto-selected:** Option 1.
**Notes:** `state.ts` zod schema MUST be designed extensible (discriminated unions or `.extend()`) so Phase 4 can add section fields without breaking Phase 1 callers. `LibraryStore` interface (D-57) is the swap point for v0.2 SQLite.

---

## Runtime layer

| Option | Description | Selected |
|--------|-------------|----------|
| Provider-agnostic `chat()` wrapping `@anthropic-ai/sdk@^0.93` + `openai@^4` SDK with baseURL override; static pricing table (hand-maintained); structural tests only | STACK.md + PRD §10 | ✓ |
| Use Vercel `ai-sdk` for unified interface | Heavy abstraction; STACK.md explicitly skips | |
| Anthropic-only in v0.1 | PRD §10 lists 5 providers; runtime layer is the indirection point | |
| Live LLM tests in CI | Cost + flakiness; structural-only is sufficient at Phase 1 | |

**Auto-selected:** Option 1.
**Notes:** `runtime.ts` does NOT call `assertBudget` itself (caller knows estimate before the call). Pricing table needs review at every model release — TODO comment with 2026-Q3 review date and links to provider pricing pages.

---

## Testing strategy (TEST-05, TEST-06, TEST-07, TEST-08, TEST-11)

| Option | Description | Selected |
|--------|-------------|----------|
| Existing `node scripts/run-tests.mjs` runner; `nock` cassettes; `fast-check` property tests; `child_process.spawn` for lock conflict; gate live behind `PENSMITH_NETWORK_TESTS=1`; ≥85% c8 coverage as dev signal not gate | STACK.md + Phase 0 D-11/D-12 carry-forward | ✓ |
| Add Vitest for richer matchers | STACK.md says skip Vitest for CLI/library; node:test sufficient | |
| Live network tests in CI by default | Flaky; rate-limited | |
| Coverage gate at 85% in CI | Premature; codecov deferred per Phase 0 D-12 | |

**Auto-selected:** Option 1.
**Notes:** New deps to add: `nock@^14`, `proper-lockfile@^4`, `fast-check@^3`, `zod@^3.23`, `undici@^7`, `p-retry@^6`, `@anthropic-ai/sdk@^0.93`, `openai@^4`. Phase 2 deps installed-now (to pin versions): `@modelcontextprotocol/sdk@^1.29`, `@clack/prompts@^0.7`. Lock-conflict test runs against compiled `dist/` so CI step order MUST be `build` BEFORE `test` (already locked by Phase 0 [00-04] STATE note).

---

## New chokepoint lint rules

| Option | Description | Selected |
|--------|-------------|----------|
| atomic-write chokepoint (D-07) + paths chokepoint (D-41), each with red-team fixture | Phase 0 D-08 lesson — chokepoints without fixtures rot silently | ✓ |
| Skip the lint; rely on convention | Convention rots; chokepoints are load-bearing for Pitfalls 2/4/7/8 | |
| Add chokepoint but skip the red-team fixture | Phase 0 D-08 explicit lesson — fixture keeps the rule honest | |

**Auto-selected:** Option 1.
**Notes:** New ESLint rules + new red-team fixtures (`tests/lint-atomic-write-chokepoint.test.ts`, `tests/lint-paths-chokepoint.test.ts`) ride in their owning lib's plan (atomic-write plan and paths plan, respectively).

---

## Claude's Discretion

The planner has discretion on:
- Exact dep version pin styles (`^` vs exact) — match STACK.md (caret on most; exact on `pdf-parse` which is a Phase 8 concern).
- Test file naming convention — keep established `tests/<lib-name>.test.ts` pattern.
- Whether each lib gets its own subdirectory vs. single file (single file unless >~400 LOC).
- Whether to add `bin/lib/index.ts` barrel re-export — recommendation: **don't** (preserves dependency-graph visibility for chokepoint lints and PR reviews).
- Internal helper naming (`_` prefix for module-internal; not enforced).
- Pricing table location: `bin/lib/runtime/pricing.ts` recommended; `bin/lib/runtime-pricing.ts` acceptable.
- Whether to add `tsconfig.test.json`. Not strictly needed; root config is fine.
- Order of plans within a single dependency-allowed wave.

## Deferred Ideas

Captured in CONTEXT.md `<deferred>` section. Summary:
- Section state machine + `verified_against_draft_hash` → Phase 4
- Wave scheduling `computeWaves()` → Phase 4 (Phase 1 ships only the `Semaphore` primitive)
- Stable section numbering with letter suffixes → Phase 4 (Phase 1 ships only the slug helper)
- HANDOFF.json schema → Phase 3
- `/pensmith list` / `open` / `archived` UX → Phase 8
- Class assignment at intake → Phase 3
- Microsoft Presidio PII shellout → v0.2
- `--yolo` / `--dry-run` / `--estimate` / `--show-prompts` CLI wiring → Phase 7
- Source adapters (`bin/lib/sources.ts`) → Phase 3
- `tier-contract.test.js` framework → Phase 2
- Doctor's user-facing OneDrive warning copy → Phase 2 doctor
- Live (non-cassette) HTTP tests → Phase 3 + opt-in env gate
- Coverage gate in CI → deferred (codecov deferred per Phase 0 D-12)
- Cassette refresh CI cron / live smoke run → v0.2
- Predatory-journal flag → v0.2
- MCP server bring-up, hooks wiring, doctor ecosystem detection → Phase 2
- NCBI_API_KEY slot for PubMed authenticated tier → Phase 3
- CSL citation engine → Phase 3 (APA-only) and Phase 10 (breadth)
