---
phase: 1
slug: foundation-nfrs
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-08
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `01-RESEARCH.md` §Validation Architecture (lines 891–960). Phase requirement set: ARCH-05..17, TEST-05..08, TEST-11.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node 20 built-in) via `scripts/run-tests.mjs` discoverer (Phase 0 / 00-01) |
| **Config file** | none — runner is the script |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm run coverage` (`c8 node scripts/run-tests.mjs`) |
| **Build prerequisite** | `npm run build` MUST run before `npm test` (lock-conflict spawn test reads `dist/`) — Phase 0 D-11 |
| **Estimated runtime** | ~30 seconds quick / ~60 seconds full coverage (Phase 1 lib count + cassettes) |

---

## Sampling Rate

- **After every task commit:** Run `npm run lint && npm run typecheck && npm test`
- **After every plan wave:** Run `npm run check` (lint + typecheck + build + test + validate-manifests)
- **Before `/gsd-verify-work`:** `npm run coverage` green (≥85% line coverage is a developer signal, NOT a CI merge gate per Phase 0 D-12)
- **Max feedback latency:** ~60 seconds (lint + typecheck + test on warm cache)

---

## Per-Task Verification Map

> One row per acceptance-criterion-bearing test. Plan IDs are placeholders the planner will assign. Threat refs (T-01-NN) are defined in PLAN.md `<threat_model>` blocks (security_enforcement: true).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-W0-01 | W0 | 0 | TEST-11 | — | CI installs deps without engine-conflict | CI workflow | `git push` triggers `.github/workflows/ci.yml` | ✅ exists (Phase 0) | ⬜ pending |
| 01-W0-02 | W0 | 0 | TEST-05 | — | DOI corpus generators reusable in Phase 3 | fixture file | `node -e "import('./tests/fixtures/doi-corpus.ts')"` | ❌ W0 | ⬜ pending |
| 01-W0-03 | W0 | 0 | ARCH-12 | T-01-05 (cache poison) | 8 cassette JSONs present | file existence | `test -d tests/fixtures/http-cassettes && ls tests/fixtures/http-cassettes/*.json | wc -l` | ❌ W0 | ⬜ pending |
| 01-W0-04 | W0 | 0 | ARCH-05 | T-01-01 (race) | red-team fixture present for atomic-write chokepoint | lint fixture | `npm run lint` flags fixture as expected violation | ❌ W0 | ⬜ pending |
| 01-W0-05 | W0 | 0 | ARCH-12 | — | locked WARN string source-of-truth | file existence | `test -f references/http-warnings.md` | ❌ W0 | ⬜ pending |
| 01-01-01 | 01-paths | 1 | ARCH-08 | T-01-09 (path traversal) | localDataDir resolves LOCALAPPDATA on Win, Application Support on macOS, XDG_DATA_HOME on Linux | unit (env injection) | `npm test -- tests/paths.test.ts` | ❌ W1 | ⬜ pending |
| 01-01-02 | 01-paths | 1 | ARCH-08 | — | isInsideSyncFolder matches OneDrive/iCloud/Dropbox/GDrive substrings | unit | `npm test -- tests/paths.test.ts` | ❌ W1 | ⬜ pending |
| 01-01-03 | 01-paths | 1 | ARCH-08 | — | chokepoint lint bans direct `os.homedir()` outside paths.ts | lint | `npm run lint` | ❌ W1 | ⬜ pending |
| 01-01-04 | 01-paths | 1 | TEST-11 | — | CI Node version bumped 20.10 → 20.18 (BLOCKING for undici@7 / nock@14 / clack@1) | CI smoke | `actions/setup-node@v4` resolves Node 20.18 | ❌ W1 | ⬜ pending |
| 01-02-01 | 02-atomic-write | 2 | ARCH-05 | T-01-01 (race) | rename-then-crash leaves valid target | unit (injected error after rename) | `npm test -- tests/atomic-write.test.ts` | ❌ W2 | ⬜ pending |
| 01-02-02 | 02-atomic-write | 2 | ARCH-05 | T-01-01 (race) | temp pattern `${target}.tmp.${pid}.${rand}` collision-free under simulated race | unit | `npm test -- tests/atomic-write.test.ts` | ❌ W2 | ⬜ pending |
| 01-02-03 | 02-atomic-write | 2 | ARCH-05 | — | dirfd fsync runs on POSIX; guarded on Windows (RESEARCH §3 finding) | unit (platform branching) | `npm test -- tests/atomic-write.test.ts` | ❌ W2 | ⬜ pending |
| 01-02-04 | 02-atomic-write | 2 | ARCH-05 | T-01-01 | chokepoint lint bans direct `fs.writeFile`/`fs.promises.writeFile` outside atomic-write.ts | lint | `npm run lint` | ❌ W2 | ⬜ pending |
| 01-03-01 | 03-lock | 3 | ARCH-06 | T-01-02 (lock theft) | lock acquisition + 30s heartbeat + 90s stale window | unit | `npm test -- tests/lock.test.ts` | ❌ W3 | ⬜ pending |
| 01-03-02 | 03-lock | 3 | ARCH-06 / TEST-07 | T-01-02 | child_process.spawn second-runner aborts non-zero with PID + hostname | spawn test | `npm test -- tests/lock.test.ts` | ❌ W3 | ⬜ pending |
| 01-03-03 | 03-lock | 3 | ARCH-06 | T-01-02 | lock file path resolves to LOCALAPPDATA/pensmith/locks (NOT inside `.paper/`) | unit (path assertion) | `npm test -- tests/lock.test.ts` | ❌ W3 | ⬜ pending |
| 01-03-04 | 03-lock | 3 | ARCH-06 | — | release runs on explicit call + `process.on('exit'\|'SIGINT'\|'SIGTERM')` | unit (signal injection) | `npm test -- tests/lock.test.ts` | ❌ W3 | ⬜ pending |
| 01-04-01 | 04-doi | 4 | ARCH-15 | T-01-08 (proto pollution) | DOI prefix strip (6 forms) | unit | `npm test -- tests/doi.test.ts` | ❌ W4 | ⬜ pending |
| 01-04-02 | 04-doi | 4 | ARCH-15 | — | DOI trailing punctuation strip (8 chars) | unit | `npm test -- tests/doi.test.ts` | ❌ W4 | ⬜ pending |
| 01-04-03 | 04-doi | 4 | ARCH-15 | — | ASCII-only case fold (non-ASCII bytes preserved) | unit | `npm test -- tests/doi.test.ts` | ❌ W4 | ⬜ pending |
| 01-04-04 | 04-doi | 4 | ARCH-15 | — | arXiv old/new format normalization w/ version preservation | unit | `npm test -- tests/doi.test.ts` | ❌ W4 | ⬜ pending |
| 01-04-05 | 04-doi | 4 | ARCH-15 | — | PMID/PMCID separation in distinct fields | unit | `npm test -- tests/doi.test.ts` | ❌ W4 | ⬜ pending |
| 01-04-06 | 04-doi | 4 | TEST-06 | — | `normalize(normalize(x)) === normalize(x)` over fast-check generated corpus | property test | `npm test -- tests/doi.test.ts` | ❌ W4 | ⬜ pending |
| 01-05-01 | 05-http | 5 | ARCH-12 | T-01-04 (SSRF) | WARN-once on missing PENSMITH_CONTACT_EMAIL + proceed with no-contact UA | cassette | `npm test -- tests/http.test.ts` | ❌ W5 | ⬜ pending |
| 01-05-02 | 05-http | 5 | ARCH-12 | T-01-05 (cache poison) | cache hit returns `cached: true` without network | cassette | `npm test -- tests/http.test.ts` | ❌ W5 | ⬜ pending |
| 01-05-03 | 05-http | 5 | ARCH-12 | T-01-05 | TTL expiry triggers re-fetch | cassette | `npm test -- tests/http.test.ts` | ❌ W5 | ⬜ pending |
| 01-05-04 | 05-http | 5 | ARCH-12 | — | `bypassCache: true` skips cache | cassette | `npm test -- tests/http.test.ts` | ❌ W5 | ⬜ pending |
| 01-05-05 | 05-http | 5 | ARCH-13 | T-01-04 | 429 + Retry-After (seconds) honored | cassette | `npm test -- tests/http.test.ts` | ❌ W5 | ⬜ pending |
| 01-05-06 | 05-http | 5 | ARCH-13 | T-01-04 | 429 + Retry-After (HTTP-date) honored | cassette | `npm test -- tests/http.test.ts` | ❌ W5 | ⬜ pending |
| 01-05-07 | 05-http | 5 | ARCH-13 | — | 503 backoff schedule (full-jitter via custom onFailedAttempt — RESEARCH §2 finding) | cassette | `npm test -- tests/http.test.ts` | ❌ W5 | ⬜ pending |
| 01-05-08 | 05-http | 5 | ARCH-13 | — | X-Rate-Limit-Reset overrides backoff schedule | cassette | `npm test -- tests/http.test.ts` | ❌ W5 | ⬜ pending |
| 01-05-09 | 05-http | 5 | ARCH-12 | T-01-04 | per-source rate-limit floor enforced (Crossref 50/s, OpenAlex 4.16/s sustained, arXiv 1/3s, PubMed 3/s) | unit (token bucket) | `npm test -- tests/http.test.ts` | ❌ W5 | ⬜ pending |
| 01-05-10 | 05-http | 5 | ARCH-12 | — | chokepoint lint bans direct `fetch`/`undici` outside http.ts (already in eslint.config.js from Phase 0) | lint | `npm run lint` | ✅ exists | ⬜ pending |
| 01-05-11 | 05-http | 5 | ARCH-14 | — | `OPENALEX_API_KEY` config slot present (RESEARCH §5: sunset already passed) | unit | `npm test -- tests/runtime.test.ts` | ❌ W13 | ⬜ pending |
| 01-06-01 | 06-budget | 6 | ARCH-09 / TEST-08 | T-01-03 (budget bypass) | `assertBudget` throws BEFORE simulated LLM call (cost-fixture asserts injected `chat()` was never invoked) | fixture | `npm test -- tests/budget.test.ts` | ❌ W6 | ⬜ pending |
| 01-06-02 | 06-budget | 6 | ARCH-10 | — | per-step cap independent of session cap | unit | `npm test -- tests/budget.test.ts` | ❌ W6 | ⬜ pending |
| 01-06-03 | 06-budget | 6 | ARCH-11 | — | `Semaphore.withPermit()` enforces `max_parallel` count | unit (concurrent acquire/release) | `npm test -- tests/budget.test.ts` | ❌ W6 | ⬜ pending |
| 01-06-04 | 06-budget | 6 | ARCH-09 | T-01-03 | `wouldYoloRefuse()` returns true when estimate > 50% of cap | unit | `npm test -- tests/budget.test.ts` | ❌ W6 | ⬜ pending |
| 01-06-05 | 06-budget | 6 | ARCH-09 | — | COSTS.jsonl append is atomic under concurrent writes (≤PIPE_BUF) | unit | `npm test -- tests/budget.test.ts` | ❌ W6 | ⬜ pending |
| 01-07-01 | 07-migrations | 7 | ARCH-07 | T-01-08 (proto pollution via untrusted JSON) | every Phase 1 state file declares `schema_version: 1` | contract | `npm test -- tests/migrations.test.ts` | ❌ W7 | ⬜ pending |
| 01-07-02 | 07-migrations | 7 | ARCH-07 | — | loader throws `ForwardIncompatError` on `schema_version: 2` | contract | `npm test -- tests/migrations.test.ts` | ❌ W7 | ⬜ pending |
| 01-07-03 | 07-migrations | 7 | ARCH-07 | T-01-08 | loader throws ZodError on missing required field | contract | `npm test -- tests/migrations.test.ts` | ❌ W7 | ⬜ pending |
| 01-07-04 | 07-migrations | 7 | ARCH-07 | — | zod schema `.extend()` works for state.ts so Phase 4 can add section fields without breaking Phase 1 | unit | `npm test -- tests/migrations.test.ts` | ❌ W7 | ⬜ pending |
| 01-08-01 | 08-pii | 8 | ARCH-17 | T-01-06 (PII leakage) | `redact()` returns diff array with category labels for names/dates/SSN/email/phone | unit | `npm test -- tests/pii.test.ts` | ❌ W8 | ⬜ pending |
| 01-08-02 | 08-pii | 8 | ARCH-17 | — | `enabled: false` is no-op pass-through | unit | `npm test -- tests/pii.test.ts` | ❌ W8 | ⬜ pending |
| 01-08-03 | 08-pii | 8 | ARCH-17 | T-01-06 | replacement tokens are deterministic (`[NAME]`, `[DATE]`, `[SSN]`, `[EMAIL]`, `[PHONE]`) | unit | `npm test -- tests/pii.test.ts` | ❌ W8 | ⬜ pending |
| 01-09-01 | 09-session-log | 9 | ARCH-16 | T-01-07 (secret leak) | JSONL records written to `.paper/SESSION.log` with run_id + at + kind | unit | `npm test -- tests/session-log.test.ts` | ❌ W9 | ⬜ pending |
| 01-09-02 | 09-session-log | 9 | ARCH-16 | T-01-07 | rotation at 50MB triggers atomic rename | unit (size injection) | `npm test -- tests/session-log.test.ts` | ❌ W9 | ⬜ pending |
| 01-09-03 | 09-session-log | 9 | ARCH-16 | T-01-07 | oversize records (>16KB) truncated with `truncated: true` field; full payload spilled to `.paper/sessions/${run_id}/${seq}.json` | unit | `npm test -- tests/session-log.test.ts` | ❌ W9 | ⬜ pending |
| 01-09-04 | 09-session-log | 9 | ARCH-16 | — | `setMirrorPromptsToStderr(true)` mirrors prompt records to stderr | unit | `npm test -- tests/session-log.test.ts` | ❌ W9 | ⬜ pending |
| 01-10-01 | 10-state | 10 | ARCH-07 | — | `state.ts` schema covers `gsd_state_version`, `paper_status`, `current_section`, `last_updated` (foundation slice — no section-state-machine fields) | unit | `npm test -- tests/state.test.ts` | ❌ W10 | ⬜ pending |
| 01-10-02 | 10-state | 10 | — | — | atomic write/read round-trip for `.paper/STATE.md` frontmatter | unit | `npm test -- tests/state.test.ts` | ❌ W10 | ⬜ pending |
| 01-11-01 | 11-library | 11 | LIB-01 (foundation slice) | — | `loadLibrary/saveLibrary/addPaper/updatePaper/removePaper` round-trip with `proper-lockfile` | unit | `npm test -- tests/library.test.ts` | ❌ W11 | ⬜ pending |
| 01-11-02 | 11-library | 11 | — | — | library index lives at `${pensmithDataDir()}/library/index.json` | unit (path assertion) | `npm test -- tests/library.test.ts` | ❌ W11 | ⬜ pending |
| 01-12-01 | 12-checkpoint | 12 | — | — | `writeCheckpoint/latestCheckpoint/listCheckpoints` round-trip; envelope shape per D-56 | unit | `npm test -- tests/checkpoint.test.ts` | ❌ W12 | ⬜ pending |
| 01-13-01 | 13-runtime | 13 | — | T-01-07 (API key leak) | provider routing for anthropic/openai/ollama/vllm/openai-compatible (structural — NO live LLM calls) | unit | `npm test -- tests/runtime.test.ts` | ❌ W13 | ⬜ pending |
| 01-13-02 | 13-runtime | 13 | — | T-01-07 | API key read from `api_key_env` env var (NEVER from config); api_key never logged | unit | `npm test -- tests/runtime.test.ts` | ❌ W13 | ⬜ pending |
| 01-13-03 | 13-runtime | 13 | ARCH-14 | — | pricing-table lookup; unknown-model conservative fallback + WARN-once | unit | `npm test -- tests/runtime.test.ts` | ❌ W13 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> Wave 0 lands prerequisites that every later wave depends on. Must complete before W1.

- [ ] **CI Node version bump** — `.github/workflows/ci.yml`: `node: '20.10'` → `node: '20.18'` (BLOCKING — required by `undici@7` engines `>=20.18.1`, `nock@14` engines `>=20.12.1`, `@clack/prompts@1.x` engines `>=20.12`; verified via `npm view <pkg> engines`). Without this bump, `npm ci` fails on the matrix.
- [ ] **`tests/fixtures/doi-corpus.ts`** — fast-check generators reusable in Phase 3 (per D-19)
- [ ] **`tests/fixtures/http-cassettes/`** — directory with 8 JSON cassettes (per D-30)
- [ ] **`tests/fixtures/lint-atomic-write-chokepoint-fixture.ts`** — red-team for D-07 (Phase 0 D-08 pattern)
- [ ] **`tests/fixtures/lint-paths-chokepoint-fixture.ts`** — red-team for D-41 (Phase 0 D-08 pattern)
- [ ] **`references/http-warnings.md`** — locked WARN string for missing-email banner (D-24); doctor will reuse in Phase 2
- [ ] **`bin/lib/schemas/`** — directory for zod schemas (D-38)
- [ ] **`bin/lib/runtime/`** — directory for `pricing.ts` (D-60)
- [ ] **`bin/lib/migrations/loader.ts`** — `migrations/` directory already exists from Phase 0 D-21

*All other phase behaviors have automated verification via `npm test`.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| OneDrive sync detection on real path | ARCH-08 / Pitfall 4 | Cannot virtualize OneDrive sync state in CI; the dev box at `OneDrive - Roanoke College/Documents/Github/pensmith` IS the live test path | Locally on the dev box, run `node -e "import('./dist/lib/paths.js').then(m=>console.log(m.isInsideSyncFolder(process.cwd())))"` and assert `{ inside: true, vendor: 'onedrive' }` |
| Lock conflict from inside OneDrive folder | ARCH-06 / Pitfall 4 | Lock file MUST live in LOCALAPPDATA, not `.paper/`; manual verification confirms the platform-local-only path doesn't get sync-eaten | Locally on the dev box, run the lock conflict spawn test from `cd "C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith"`; verify lock file appears under `%LOCALAPPDATA%\pensmith\locks\` and second runner aborts |
| `PENSMITH_NETWORK_TESTS=1` live HTTP smoke | ARCH-12, ARCH-13 (Phase 1 cassette-only) | Live network tests are gated OFF by default per D-66; developer-run only | Run `PENSMITH_NETWORK_TESTS=1 npm test -- tests/http.test.ts`; expect zero unguarded network failures |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (8 entries above)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s (lint+typecheck+test on warm cache)
- [ ] `nyquist_compliant: true` set in frontmatter (after wave_0_complete)

**Approval:** pending
