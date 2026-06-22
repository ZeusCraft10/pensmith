# Phase 1: Foundation NFRs - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning
**Mode:** `--auto` (recommended defaults selected for every gray area; see audit log at end of file)

<domain>
## Phase Boundary

Land every Ring-1 Foundation library that the rest of pensmith depends on — green, unit-tested, documented, and lint-chokepointed — so Phase 2 (tier shells + doctor) and Phase 3 (vertical slice) can build on a stable substrate without circular dependencies. Phase 1 ships **no user-visible features** and does NOT touch tier shells, MCP server, hooks, doctor, intake, research, outline, or verifier — those are owned by Phases 2/3+.

In scope (the 13 libraries, in strict dependency order, each with its own atomic plan + unit tests):

1. `bin/lib/paths.ts` (ARCH-08) — cross-platform local-only data dir resolution
2. `bin/lib/atomic-write.ts` (ARCH-05) — `write tmp` → `fsync(tmp)` → `rename` → `fsync(dir)`
3. `bin/lib/lock.ts` (ARCH-06) — concurrent-run lock with PID + hostname + heartbeat
4. `bin/lib/doi.ts` (ARCH-15) — DOI / arXiv / PMID normalization chokepoint
5. `bin/lib/http.ts` (ARCH-12, 13, 14) — undici-backed HTTP client with per-source TTL cache, jittered retry, polite UA, rate-limit floors, `OPENALEX_API_KEY` slot
6. `bin/lib/budget.ts` (ARCH-09, 10, 11) — per-session + per-step cost cap, abort BEFORE LLM call, `--max-parallel` cap
7. `bin/lib/migrations/` loader + README contract (ARCH-07) — `schema_version: 1` from day one, refuse-forward-incompat
8. `bin/lib/pii.ts` (ARCH-17) — hand-rolled regex PII pass for v0.1 (intake-time only)
9. `bin/lib/session-log.ts` (ARCH-16) — replayable jsonl session log + `--show-prompts` plumbing
10. `bin/lib/state.ts` (Foundation slice only — ARCH-19 section state machine is Phase 4)
11. `bin/lib/library.ts` (Foundation slice only — JSON file + `proper-lockfile` per LIB-01; verbs are Phase 8)
12. `bin/lib/checkpoint.ts` (Foundation slice only — file shape + atomic write; PostToolUse throttling + HANDOFF.json shape are Phase 7)
13. `bin/lib/runtime.ts` — provider-agnostic LLM client wrapper (`openai` SDK + `@anthropic-ai/sdk`); no actual LLM calls happen yet in Phase 1

Plus: green CI on linux-x64 / macos-arm64 / windows-x64 (TEST-11), unit tests for every lib (TEST-05), DOI round-trip property test (TEST-06), lock-conflict test (TEST-07), budget-abort cost-fixture test (TEST-08), HTTP cassette tests for 429 / 503 / Retry-After AND the missing-email WARN-and-proceed path (per ROADMAP §1 SC-5), and the one-time WARN banner copy locked.

Out of scope (belongs in later phases — do NOT smuggle them in):
- MCP server bring-up, read-only resources, or state-mutation tools (Phase 2)
- `/pensmith doctor` and ecosystem probe (Phase 2)
- `tier-contract.test.js` framework (Phase 2 — this phase ships ONE-tier libs only)
- HANDOFF.json schema, PreCompact/PostToolUse hook wiring, SessionStart auto-resume (Phase 7)
- `state.ts` section-state-machine fields `state ∈ {planned, …, verified, failed}` and `verified_against_draft_hash` (Phase 4 — ARCH-19/20)
- Wave scheduling (`computeWaves()`) (Phase 4)
- Library `/pensmith list` / `open` verbs and class assignment UX (Phase 8)
- `--yolo` / `--dry-run` / `--estimate` / `--show-prompts` flag wiring at the CLI (Phase 7); Phase 1 ships only the *plumbing* (`session-log.ts` write API, budget hook points)
- Source adapters (`bin/lib/sources.ts`), verifier passes, citation engine, Pandoc, plagiarism, honesty (Phase 3+)

</domain>

<decisions>
## Implementation Decisions

### Build order & PR cadence
- **D-01:** Strict 13-step dependency order is a **hard rule**, not a suggestion: paths → atomic-write → lock → doi → http → budget → migrations → pii → session-log → state → library → checkpoint → runtime. The roadmap goal text mandates "in strict order" and the architecture's three-ring model collapses if any later lib is touched before its dependencies are green. The planner produces ≥13 plans (one per lib) executed in series; small libs MAY be co-planned in one PR if and only if they share no test surface (e.g., `state.ts` + `library.ts` + `checkpoint.ts` could be one wave because all three only depend on `paths.ts` + `atomic-write.ts` + `lock.ts`). The planner's call.
- **D-02:** Each library lands with its unit tests in the same plan/PR. Cross-library integration tests (e.g., "lock + atomic-write together don't lose data under crash") land in the LATER lib's plan to keep dependency direction one-way.
- **D-03:** Every lib gets a 1–2 paragraph header doc-comment that names the chokepoint it owns and the lint rule (or test) that keeps the chokepoint honest. Pitfalls 2/4/7/8 all hinge on chokepoint discipline — the doc-comment is the README a future contributor reads first.

### Atomic write contract (ARCH-05, Pitfall 4)
- **D-04:** Implementation is exactly: open temp file in same directory as target → `write` → `fsync(fd)` → `close` → `rename(temp, target)` → `fsync(dirfd)` → `close(dirfd)`. Skipping the **directory fsync** is the silent-data-loss landmine on power loss / crash / sync-folder pause; it MUST be in the implementation AND covered by a "rename-then-crash leaves valid target" test (simulated via injected error after rename). Lift verbatim from `gsd-plugin/bin/lib/core.cjs` if its license permits; otherwise hand-roll with an attribution comment.
- **D-05:** Temp filename pattern is `${target}.tmp.${pid}.${random8hex}` to avoid collisions when two processes race on the same target (lock should prevent this, but defense-in-depth is cheap). On Windows, `rename` over an existing file works since Node 14 — no need for `unlink` + `rename`.
- **D-06:** API surface is intentionally narrow: `writeAtomic(path: string, data: string | Buffer, opts?: { mode?: number, encoding?: BufferEncoding })`. No streaming variant, no JSON convenience wrapper — those go in higher libs. Keep the chokepoint small.
- **D-07:** All higher-layer state writes (`state.ts`, `library.ts`, `checkpoint.ts`, `session-log.ts` ROTATE only — append uses a different pattern, see D-30) MUST go through `atomic-write.ts`. Add a Phase-1 lint rule (or contract test) banning direct `fs.writeFile` / `fs.promises.writeFile` outside `atomic-write.ts` itself, mirroring the `http.ts` and `doi.ts` chokepoint pattern from REPO-05. The planner decides whether this rides as a new lint rule (preferred) or a runtime assertion in test.

### Lock file (ARCH-06, Pitfall 4 — "OneDrive eats the file")
- **D-08:** Lock lives at `${LOCAL_DATA_DIR}/pensmith/locks/${project-hash}.lock` where `LOCAL_DATA_DIR` is `paths.ts`-resolved. **Never** inside `.paper/`. The dev folder being inside OneDrive means an in-`.paper/` lock will be eaten by sync; the platform local-only dir is the one place sync-folders won't touch (CLAUDE.md non-negotiable + Pitfall 4 critical).
- **D-09:** `project-hash` is `sha256(absolute path of project root).slice(0, 16)`. Hash, not slug, so two projects with the same basename in different folders never collide. Project root = nearest ancestor containing `.paper/PROJECT.md`, falling back to `cwd`.
- **D-10:** Lock file payload is JSON: `{ schema_version: 1, pid, hostname, started_at, heartbeat_at, pensmith_version }`. Use `proper-lockfile@^4` for race-free creation + stale detection (mtime-based). The `heartbeat_at` field is updated by the lock holder every 30s on a setInterval; stale-detection threshold is 90s (3× heartbeat) per industry convention.
- **D-11:** Conflict semantics — second runner reads existing lock; if `heartbeat_at` is fresh (<90s old), it ABORTS with a clear message naming the holder's `pid` + `hostname` and pointing at "if you believe the holder is dead, delete `<lockpath>`". If stale, `proper-lockfile` auto-clears and the second runner takes the lock. NO "wait and retry" loop in v0.1 — too easy to mask a real concurrent-edit bug; user can re-run after fixing.
- **D-12:** Lock test (TEST-07) is a child-process spawn test: parent acquires lock, spawns a child that attempts the same lock, child exits non-zero with the documented "active lock" stderr. Run in CI on all three OSes.
- **D-13:** Lock release happens in (1) the explicit `release()` API caller, (2) a `process.on('exit')` handler installed by `lock.acquire()` (synchronous unlink), and (3) a `process.on('SIGINT' | 'SIGTERM')` handler. The `Stop` hook (Phase 7) will additionally call `release()`, but the synchronous exit handler MUST work even when no hook fires (Tier 2 standalone case).

### DOI / arXiv / PMID normalization (ARCH-15, REPO-05, Pitfall 2)
- **D-14:** All extraction + normalization concentrated in `bin/lib/doi.ts`. The `/^10\./` regex chokepoint is already lint-enforced by REPO-05 / Phase 0 D-07 (AST selector `Literal[regex.pattern=/^\^10\\\\\\./]`). Phase 1 just lands the implementation behind that lint rule.
- **D-15:** Normalization spec, in order:
  1. Strip leading `doi:` / `https://doi.org/` / `http://dx.doi.org/` / `https://dx.doi.org/` prefixes (case-insensitive on the prefix only).
  2. Strip trailing punctuation in the set `{ . , ; : ) ] } > " ' }` repeatedly until no trailing punct remains. **#1 source of false-FABRICATED.**
  3. Lowercase ASCII characters only (`ch.charCodeAt(0) < 128`); leave non-ASCII bytes byte-identical (DOI Handbook: case-folding is ASCII-only). `10.123/ABÇ` → `10.123/abÇ`, NOT `10.123/abç`.
  4. Reject if the result doesn't match `/^10\.\d{4,9}\/[^\s]+$/`.
- **D-16:** Store BOTH `doi_canonical` (post-normalize) AND `doi_as_cited` (raw input string) in any record that holds a DOI. The verifier (Phase 3) needs the canonical for HTTP fetch; reports show the as-cited form so the user can correct their source. State this explicitly in the public type signature.
- **D-17:** arXiv normalization handles BOTH old format (`arXiv:cs.CL/0501001` / `cs/0501001`) AND new format (`arXiv:2401.12345v3` / `2401.12345v3` / `2401.12345`). Version suffixes are preserved (versioned papers may differ); however, an "exact-match-or-base-match" comparator helper is exposed for the verifier to use.
- **D-18:** PMID and PMCID are different namespaces and live in separate fields (`pmid: string | null`, `pmcid: string | null`). PMCID always carries the `PMC` prefix; PMID is digits only. Normalization strips a leading `PMID:` / `PMC:` prefix and validates `/^\d+$/` for PMID, `/^PMC\d+$/` for PMCID.
- **D-19:** Property test (TEST-06) asserts idempotence on **a generated string corpus**: `normalize(normalize(x)) === normalize(x)` for x ∈ {valid DOIs, DOIs with each trailing-punct combination, mixed-case ASCII, non-ASCII bodies, the arXiv old/new fixtures, the PMID/PMCID fixtures, garbage strings that should `null` out}. Use `fast-check` (`^3.x`) — small-step shrink-friendly property tester, ESM-native; lift the corpus generators into `tests/fixtures/doi-corpus.ts` so they're reusable in Phase 3.
- **D-20:** The `doi-regex@^0.1.17` dep (per STACK.md) is consumed only for *extraction from prose* (the verifier scans paragraph text for DOI mentions in Phase 3). Normalization is hand-rolled per D-15 — `doi-regex` does not normalize.

### HTTP client (ARCH-12, ARCH-13, ARCH-14, Pitfall 7)
- **D-21:** Library is `bin/lib/http.ts`. Direct `fetch` / `http` / `https` / `undici` imports anywhere else are already lint-banned by REPO-05 / Phase 0 D-06. Phase 1 lands the implementation.
- **D-22:** Stack: `undici@^7` for the request layer (interceptor architecture, RFC-9111 caching available but not used — see D-25), `p-retry@^6` for jittered exponential backoff. Native `globalThis.fetch` is NOT used in `http.ts` itself — undici's typed Dispatcher API gives us interceptor + per-source rate-limit primitives we need.
- **D-23:** Public API surface:
  ```ts
  request<T>(opts: {
    source: 'crossref'|'openalex'|'arxiv'|'pubmed'|'unpaywall'|'semanticscholar'|'retraction-watch'|'duckduckgo'|'gptzero'|'generic';
    method?: 'GET'|'POST';
    url: string;
    headers?: Record<string,string>;
    body?: string|Buffer;
    cacheKey?: string;       // override default key
    cacheTtlMs?: number;     // override per-source default
    bypassCache?: boolean;   // for "verify-now" force-refresh
  }): Promise<{ status: number; headers: Record<string,string>; body: T; cached: boolean }>
  ```
  The `source` discriminator is what drives per-source rate limits, polite UA, and TTL — there is intentionally no "generic GET" escape hatch for production paths (the `'generic'` value is dev/test only and emits a WARN at runtime).
- **D-24:** Polite User-Agent format: `pensmith/${VERSION} (${PENSMITH_CONTACT_EMAIL || 'no-contact'}; +https://github.com/akhilachanta/pensmith)`. When `PENSMITH_CONTACT_EMAIL` is unset, emit a **one-time** WARN banner (process-lifetime memoized via a module-scope flag) and proceed with the no-contact UA. The doctor-level warning is owned by `DOCT-03` (Phase 2). Banner copy must be locked in `references/http-warnings.md` (a one-line file the http.ts module reads at module load) and tested in cassette test (per ROADMAP §1 SC-5). NEVER hard-refuse on unset email — free basics work without it (PRD §12).
- **D-25:** Cache is **hand-rolled** per STACK.md verdict — NOT undici's `CacheStore`. Layout: `${LOCAL_DATA_DIR}/pensmith/http-cache/${source}/${sha256(method+normalized-url+body-hash).slice(0,2)}/${sha256(...).slice(2)}.json`. Each cache entry is a JSON envelope `{ schema_version: 1, key, source, status, headers, body, fetched_at, ttl_ms, expires_at }`. Reads check `expires_at > Date.now()`; on miss, fetch + write. Default TTLs per source: Crossref 24h, OpenAlex 24h, arXiv 24h, PubMed 24h, Unpaywall 7d, Semantic Scholar 24h, Retraction Watch 1h (recheck-driven), DuckDuckGo 1h, GPTZero **never cached** (always fresh — honesty score must be live), generic `cacheKey ? 1h : no-cache`.
- **D-26:** URL normalization for cache key: lowercase scheme + host, sort query params alphabetically, drop tracking params (`utm_*`, `fbclid`, `gclid`), preserve case in path. Body hash: `sha256(body || '')`.
- **D-27:** Retry policy — `p-retry` with `retries: 3, factor: 2, minTimeout: 500, maxTimeout: 8000, randomize: true` (full-jitter, not equal-jitter, per Pitfall 7). Retry only on: network errors, 429, 502, 503, 504. Honor `Retry-After` (seconds OR HTTP-date) and `X-Rate-Limit-Reset` headers when present — they OVERRIDE the backoff schedule.
- **D-28:** Per-source rate-limit floor (token bucket per source key, in-process):
  - Crossref: 50 req/s
  - OpenAlex: 15,000 req/hr (≈4.16 req/s sustained)
  - arXiv: 1 req per 3s
  - PubMed: 3 req/s without API key (10 req/s with key — Phase 1 ships without key support; the `NCBI_API_KEY` slot lands when PubMed becomes load-bearing in Phase 3)
  - Semantic Scholar: 100 req per 5min (≈0.33 req/s)
  - Unpaywall: 100k/day soft (no per-second cap from server; we self-cap at 10 req/s defensively)
  - Retraction Watch: 10 req/s
  - DuckDuckGo: 1 req per 2s (be polite to the scraper endpoint)
  - GPTZero: 30 req/min (free tier)
  Circuit-breaker: on 5 consecutive 429s from a source, pause that source for 60s and surface a clear log line. Per-source state lives in-memory; persistent state is overkill for v0.1.
- **D-29:** Config slot for `OPENALEX_API_KEY` (ARCH-14) lives in `bin/lib/runtime.ts`'s config-load path (`.paper/config.toml` `[http]` table); `http.ts` reads it via a `getConfig()` helper but does NOT yet *send* the key (sunset is Feb 13, 2026 — by the time we ship v0.1 the polite-pool email-only path may already be dead, so the slot ships in v0.1 even though Phase 1 doesn't wire the request header). Wire-up happens in Phase 3 when source adapters ship. Document this in the config schema doc.
- **D-30:** Cassette tests via `nock@^14` (`nockBack` recorder pattern, fixtures in `tests/fixtures/http-cassettes/`). Live tests gated behind `PENSMITH_NETWORK_TESTS=1` env var (default OFF in CI). Required cassettes Phase 1 ships (per ROADMAP §1 SC-5):
  1. 429 with `Retry-After` header → retry honors header timing
  2. 503 with no header → backoff schedule
  3. `Retry-After` as HTTP-date format
  4. `X-Rate-Limit-Reset` header honored
  5. Missing `PENSMITH_CONTACT_EMAIL` → WARN-once + proceeds with no-contact UA + 200 response
  6. Cache hit (second identical request returns `cached: true` without network)
  7. Cache TTL expiry triggers re-fetch
  8. `bypassCache: true` skips cache entirely

### Budget gating (ARCH-09, ARCH-10, ARCH-11, Pitfall 6)
- **D-31:** `bin/lib/budget.ts` exposes a single guard function: `assertBudget({ scope: 'session'|'step', estimateUsd: number, label: string }): void` (throws `BudgetExceededError`). This is called by every code path that's about to spend money — most importantly **before** invoking `runtime.chat()`. The TEST-08 cost-fixture test asserts that a fixture set with a $4.99 already-spent + a $0.10 estimate against a $5.00 cap throws **before** the simulated LLM call returns (the test injects a Promise-resolving "LLM" that records whether it was called).
- **D-32:** Default caps: `cost_cap_usd_session: 5.00`, `cost_cap_usd_per_step: 0.50`, `max_parallel: 5`. All three live in `[budget]` table of `.paper/config.toml` (schema-versioned per ARCH-07) with sensible env-var overrides (`PENSMITH_COST_CAP_USD`, `PENSMITH_MAX_PARALLEL`).
- **D-33:** Running ledger lives at `.paper/COSTS.jsonl` (append-only, one record per spend event: `{ at, scope, label, estimate_usd, actual_usd?, model, tokens_in?, tokens_out? }`). `assertBudget` reads the ledger lazily (cached for 1s, invalidated on any append). Atomic appends use `O_APPEND` open + single-write — `fs.appendFile` is atomic for writes ≤ PIPE_BUF (typically 4KB), and a single jsonl record is well under that. NOT routed through `atomic-write.ts` (which is for whole-file replacement).
- **D-34:** `--max-parallel` cap (D-32) is enforced at the *call site* (the future wave scheduler in Phase 4 + the source-researcher dispatcher in Phase 3) by accepting a `Semaphore` from `budget.ts`. Phase 1 just exports the `Semaphore` primitive (`acquire()/release()/withPermit()`) — no caller in Phase 1 actually uses it yet, but the API ships now so Phase 3+ doesn't need to retrofit.
- **D-35:** `--yolo` refusal logic (when estimate > 50% of session cap) is *parameterized* in budget.ts as a helper `wouldYoloRefuse({ remaining, estimate, cap })`. The CLI wiring of `--yolo` is Phase 7; Phase 1 just ships the predicate so the test exists.

### Migrations + schema versioning (ARCH-07, Pitfall 5)
- **D-36:** Every state file pensmith writes carries `schema_version: 1` from day one. Phase 1 ships an empty `bin/lib/migrations/` directory containing only a `README.md` (already exists from Phase 0) describing the contract: each migration is a file `from-${N}-to-${N+1}.ts` exporting `migrate(input: unknown): unknown`. v0.1.0 ships zero migrations (we're at v1).
- **D-37:** The migrations *loader* lives at `bin/lib/migrations/loader.ts`. API: `loadAndMigrate<T>({ raw: unknown, currentVersion: number, schema: ZodSchema<T> }): T`. Behavior: read `raw.schema_version`; if equal to `currentVersion`, validate via zod and return; if less, walk the migration chain and re-validate; if **greater**, throw `ForwardIncompatError` with a clear "this state file was written by a newer pensmith — upgrade or remove `.paper/`" message. Refuse-forward-incompat is non-negotiable (Pitfall 5).
- **D-38:** All structured state files use **zod** (`^3.23`) schemas as both the type definition and the runtime validator (per STACK.md). Phase 1 ships skeleton schemas for `state.ts` (project-level state, NOT section state — that's Phase 4), `library.ts` (the library index entry), `checkpoint.ts` (the checkpoint envelope), and `session-log.ts` (one record schema). Schemas live in `bin/lib/schemas/` (one file per state-file kind) and are imported by both the producer and the loader.
- **D-39:** Migration test (no Phase 1 functional test since there are zero migrations yet) — instead, ship a **contract test** that asserts: (a) every Phase 1 state file declares `schema_version: 1`, (b) the loader throws `ForwardIncompatError` on `schema_version: 2`, (c) the loader throws zod-validation-error on a missing required field. This test is the seed for Phase 5+ migrations.

### Cross-platform paths (ARCH-08, Pitfall 8)
- **D-40:** `bin/lib/paths.ts` exports:
  - `localDataDir(): string` — Windows: `process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')`; macOS: `path.join(os.homedir(), 'Library', 'Application Support')`; Linux/other: `process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')`. Always returns the platform-appropriate non-roaming local dir (Pitfall 4 — never `%APPDATA%` on Windows because that's the *roaming* folder which OneDrive may sync).
  - `pensmithDataDir(): string` — `path.join(localDataDir(), 'pensmith')`
  - `pensmithLockDir(): string` — `path.join(pensmithDataDir(), 'locks')`
  - `pensmithHttpCacheDir(): string` — `path.join(pensmithDataDir(), 'http-cache')`
  - `projectRoot(cwd?: string): string | null` — walks up from `cwd` looking for `.paper/PROJECT.md` (NOT `.git`); returns null if not in a paper.
  - `projectHash(root: string): string` — `sha256(path.resolve(root)).slice(0,16)` (used by D-09).
  - `paperDir(root: string): string` — `path.join(root, '.paper')`
  - `sectionDir(root: string, num: string, slug: string): string` — `path.join(paperDir(root), 'sections', `${num}-${slug}`)` — slug is already lowercase-ascii-hyphenated by the caller; this helper just joins.
  - `isInsideSyncFolder(p: string): { inside: boolean, vendor?: 'onedrive'|'icloud'|'dropbox'|'gdrive' }` — substring matches on `OneDrive`, `iCloud`, `Library/Mobile Documents/com~apple~CloudDocs`, `Dropbox`, `Google Drive`. Used by Phase 2 doctor (DOCT-04); ships in Phase 1 because doctor needs it ready by Phase 2 and the function is path-domain.
- **D-41:** Phase 1 adds a lint rule banning direct `os.homedir()` / `process.env.APPDATA|LOCALAPPDATA|XDG_DATA_HOME` references outside `bin/lib/paths.ts`. Same chokepoint pattern as REPO-05. Red-team fixture at `tests/lint-paths-chokepoint.test.ts` (mirroring `lint-chokepoint.test.ts`).
- **D-42:** Tests run on the full CI matrix (TEST-11). Phase 1 unit tests for paths use injected env (via `process.env` mutation in beforeEach/afterEach) to verify all three platform branches even when running on a single OS. The CI matrix verifies the *real* env path — defense in depth.
- **D-43:** Section folder slugs (when produced by higher-layer code) are constrained to `/^[a-z0-9][a-z0-9-]{0,40}$/` to dodge Windows MAX_PATH (260) under deeply-nested OneDrive paths. `paths.ts` exposes a `slugify(s: string): string` helper. Numbering with letter suffix (ARCH-20) is Phase 4; Phase 1 just ships the slug helper.

### PII redaction (ARCH-17)
- **D-44:** `bin/lib/pii.ts` is opt-in (caller passes `enabled: true`); when disabled, the API is a no-op pass-through so callers don't need conditional logic. Default = disabled.
- **D-45:** v0.1 strategy is **hand-rolled regex** per STACK.md and PRD §17. Patterns covered:
  - **Names** — capitalized-word heuristic: `/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g` — known to over-match (any title-cased phrase). Document this honestly in `PRIVACY.md` skeleton (the full PRIVACY.md ships in Phase 6; Phase 1 adds a "PII redaction is regex-based and best-effort; expect over- and under-matches" note to the existing skeleton).
  - **Dates** — `/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/g`, `/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi`
  - **SSN-shaped** — `/\b\d{3}-?\d{2}-?\d{4}\b/g`
  - **Emails** — `/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g`
  - **Phone (US-leaning)** — `/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g`
- **D-46:** API: `redact(input: string, opts: { enabled: boolean }): { output: string, diff: Array<{ start, end, original, replacement, category }> }`. The `diff` array is what enables the "deterministic diff the user can review" requirement (REQUIREMENTS ERGO-07 / ARCH-17 phrasing). Replacement tokens are deterministic by category: `[NAME]`, `[DATE]`, `[SSN]`, `[EMAIL]`, `[PHONE]`.
- **D-47:** `pii.ts` MUST be called BEFORE any `runtime.chat()` invocation when `enabled` is true; this is enforced at the call site (Phase 3 intake), not by `runtime.ts`. Phase 1 just ships the function and its tests. The contract is documented in the function header doc-comment.
- **D-48:** v0.2 path: opt-in shellout to Microsoft Presidio (`PII-V2-01` in REQUIREMENTS). Phase 1 designs the `redact` API to be replaceable — the `opts` object will gain a `backend: 'regex' | 'presidio'` field in v0.2 without breaking callers.

### Session log (ARCH-16)
- **D-49:** `bin/lib/session-log.ts` writes JSONL to `.paper/SESSION.log` (per PRD §10 / §13). One record per call: `{ at, kind, run_id, ...payload }`. `kind` is one of: `prompt`, `response`, `tool_call`, `tool_result`, `cost`, `event`, `warn`, `error`. `run_id` is a ULID generated at session start (lives in module-scope state); the same `run_id` ties together a single CLI/plugin invocation.
- **D-50:** Append uses `fs.appendFile` (atomic for ≤PIPE_BUF, see D-33). Per-record max size is enforced at 16KB; oversize records are *truncated* with a `truncated: true` field rather than dropped — the user wants to know it happened. Larger payloads (full prompts) write the head + tail with an ellipsis; full payloads spill to `.paper/sessions/${run_id}/${seq}.json` (one file per oversized record) so debugging is still possible.
- **D-51:** Rotation policy: when `.paper/SESSION.log` exceeds 50MB, rotate to `.paper/SESSION.log.${timestamp}` and start fresh. Rotation goes through `atomic-write.ts` (full-file rename of the current log). Last 3 rotated files kept; older ones deleted.
- **D-52:** `--show-prompts` plumbing (ERGO-04, Phase 7) just sets a process flag that `session-log.ts` reads — when true, every `kind: 'prompt'` record is ALSO mirrored to stderr in human-readable form. Phase 1 ships the toggle hook (a module-scope setter `setMirrorPromptsToStderr(boolean)`); Phase 7 wires the CLI flag to it.
- **D-53:** Reading the session log (replay) is NOT a Phase 1 deliverable — Phase 1 ships only the writer. A read API (`tail`, `iterate`) lands when something needs it (probably Phase 7 resume).

### State / library / checkpoint (Foundation slice only)
- **D-54:** `bin/lib/state.ts` Phase 1 scope is *project-level* state: the file shape of `.paper/STATE.md` (frontmatter YAML + markdown body, mirroring `.planning/STATE.md`), an atomic write helper, a zod-validated read helper. **The section state machine (ARCH-19: `state ∈ {planned, writing, ...}` + `verified_against_draft_hash`) is Phase 4** and Phase 1 explicitly does NOT ship those fields. Phase 1's state schema covers: `gsd_state_version` (=1), `paper_status: 'intake'|'research'|'outline'|'sectioning'|'compile'|'done'|'archived'`, `current_section: string|null`, `last_updated`. That's it. Anything more is scope creep into Phase 3/4.
- **D-55:** `bin/lib/library.ts` Phase 1 scope is the JSON-file-backed library index per LIB-01: `{ schema_version: 1, papers: Array<{ id, slug, root_path, class: string, status: 'intake'|...|'archived', created_at, last_updated }> }` at `${pensmithDataDir()}/library/index.json`. API: `loadLibrary()`, `saveLibrary(lib)` (atomic), `addPaper(entry)`, `updatePaper(id, partial)`, `removePaper(id)`. All writes go through `proper-lockfile@^4` (per STACK.md) with the lock file at `${pensmithDataDir()}/library/index.json.lock`. **The `/pensmith list` / `open` / `archived` UX (LIB-02..05) is Phase 8** — Phase 1 just ships the persistence layer. Class assignment (LIB-04) at intake is Phase 3.
- **D-56:** `bin/lib/checkpoint.ts` Phase 1 scope is the JSON envelope shape + atomic write/read primitives. Schema: `{ schema_version: 1, run_id, at, kind: 'auto'|'precompact'|'manual', cwd, paper_root, current_section, in_flight: Array<{ tool, args, started_at }>, notes? }`. Files live at `.paper/checkpoints/${at}-${run_id}.json`. **PostToolUse hook throttling (HOOK-03), PreCompact HANDOFF.json shape (HOOK-01 / ARCH-04), and SessionStart auto-resume (HOOK-02) are all Phase 7.** Phase 1 ships `writeCheckpoint(envelope)` + `latestCheckpoint(): envelope | null` + `listCheckpoints(): envelope[]`. The 1/min throttle gate is implemented in Phase 7's hook script.
- **D-57:** Library index format: **JSON** for v0.1 (per STACK.md verdict; resolves PRD §17 open question for the foundation slice). The persistence layer is wrapped behind a small `LibraryStore` interface so Phase 8's swap to SQLite (LIB-V2-01) is local.

### Runtime layer (`bin/lib/runtime.ts`)
- **D-58:** `bin/lib/runtime.ts` provides the provider-agnostic LLM call surface used by Tier 2 (and used by Tier 1 only for budget estimation — Tier 1 actual calls go through the Task tool). Single exported function: `chat({ provider, model, baseURL?, apiKey?, messages, tools?, maxTokens?, temperature? }): Promise<{ message, toolCalls, usage: { inputTokens, outputTokens, costUsd } }>`. Provider ∈ `'anthropic' | 'openai' | 'ollama' | 'vllm' | 'openai-compatible'` per PRD §10.
- **D-59:** Implementation per provider:
  - `anthropic` → `@anthropic-ai/sdk@^0.93` direct (best ergonomics for tool use + streaming).
  - `openai` / `ollama` / `vllm` / `openai-compatible` → `openai@^4` SDK with `baseURL` override (per STACK.md).
- **D-60:** Cost calculation for the `costUsd` field uses a static `bin/lib/runtime/pricing.ts` lookup keyed on `provider:model` (e.g., `anthropic:claude-opus-4-7`, `openai:gpt-4o`). Unknown models fall back to a conservative-overestimate default (e.g., $20/M input, $80/M output) AND emit a one-time WARN. Pricing table is hand-maintained; documented in the file header that it must be reviewed at every model release. Calls into `budget.ts` to record the actual cost AFTER the call.
- **D-61:** `runtime.ts` does NOT call `assertBudget` itself — that's the caller's job (because the caller knows the *estimate* before the call; runtime only knows the *actual* after). Phase 1 documents this contract in the function header. The pre-call `assertBudget` invocation is enforced by the Phase 3 caller code, but the test framework for it ships in Phase 1 (TEST-08 cost-fixture test, see D-31).
- **D-62:** Phase 1 ships **structural** tests only for runtime — no live LLM calls in CI. Tests cover: provider routing, baseURL handling, pricing-table lookup, cost calculation, unknown-model WARN, malformed-response error envelope. Live tests for actual call success are Phase 3's problem.
- **D-63:** Config slot for runtime in `.paper/config.toml`:
  ```toml
  [runtime]
  provider = "anthropic"            # or openai|ollama|vllm|openai-compatible
  model = "claude-opus-4-7"         # or gpt-4o|llama3.1:70b|...
  base_url = ""                     # blank = SDK default
  api_key_env = "ANTHROPIC_API_KEY" # name of env var to read; never store key in config
  max_tokens = 4096
  temperature = 0.0                 # default deterministic; intake may bump for sketch
  ```
  Schema lives at `bin/lib/schemas/runtime-config.ts` (zod).

### Testing strategy (TEST-05, TEST-06, TEST-07, TEST-08, TEST-11)
- **D-64:** Test runner is the existing `node scripts/run-tests.mjs` from Phase 0 (pre-glob discovery + vacuous-pass guard). Phase 1 adds zero new test infrastructure. Add new dev deps: `nock@^14`, `proper-lockfile@^4` (also a runtime dep), `fast-check@^3`, `zod@^3.23`, `undici@^7`, `p-retry@^6`, `@anthropic-ai/sdk@^0.93`, `openai@^4`, `@modelcontextprotocol/sdk@^1.29` (Phase 2 needs it but install now to pin), `@clack/prompts@^0.7` (Phase 2 needs it).
- **D-65:** Property tests use `fast-check` (D-19); cassette tests use `nock` (D-30); concurrent-process tests use `child_process.spawn` against compiled JS in `dist/` (D-12) — this means Phase 1's CI step order MUST run `npm run build` BEFORE `npm test` (already true from Phase 0 D-11 / 00-04 STATE [00-04] note).
- **D-66:** Network-touching tests are gated by `if (process.env.PENSMITH_NETWORK_TESTS !== '1') return t.skip('PENSMITH_NETWORK_TESTS=1 required')`. Phase 1 ships ZERO unguarded network tests (cassettes only). Document the flag in `README-DEV.md`.
- **D-67:** Coverage: aim for ≥85% line coverage on every Phase 1 lib via `c8`. Add `npm run coverage` script; do NOT gate CI on coverage at Phase 1 (codecov was deferred per Phase 0 D-12 and stays deferred — coverage is a developer signal, not a merge gate, until v0.1.0 launch).
- **D-68:** Each Phase 1 lib's plan (one-per-lib per D-01) MUST list its tests in the plan's success criteria; the planner should produce verifiable, runnable test names, not vague "unit tests pass" gates.

### Claude's Discretion
The following are mechanical choices the planner can make without further input:
- Exact dep version pin styles (`^` vs exact) — match Phase 0 STATE convention: pin `pdf-parse` exact (Phase 8 concern), allow caret on everything new in Phase 1 unless STACK.md says otherwise.
- Test file naming convention — already established as `tests/<lib-name>.test.ts` and `tests/fixtures/<topic>/...`. Keep it.
- Whether each lib gets its own subdirectory (`bin/lib/http/index.ts` + helpers) or stays as a single file. Recommendation: single file unless the file would exceed ~400 LOC, then split.
- Whether to add a `bin/lib/index.ts` barrel re-export. **Don't.** Direct imports from `bin/lib/<lib>.ts` keep the dependency graph visible to the lint chokepoint rules and to humans reading PRs.
- Module-internal helper naming — internal-only helpers prefixed with `_` (TS visibility for runtime, mostly readability for humans).
- Where to put the runtime pricing table (`bin/lib/runtime/pricing.ts` recommended; or a flat `bin/lib/runtime-pricing.ts` if you prefer no subdir at Phase 1).
- Whether to add a `tsconfig.test.json` extending the root config with `"types": ["node"]` and looser settings for tests. Not strictly needed; root config is fine.
- Order of plans within a wave — within each dependency-allowed wave, planner picks the order that minimizes review burden.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (`gsd-phase-researcher`, `gsd-planner`) MUST read these before producing RESEARCH.md or PLAN.md.**

### Project source-of-truth
- `PRD.md` — Pensmith specification. §10 (config schema — `[runtime]`, `[budget]`, `[http]` tables drive D-29, D-32, D-63), §13 (file layout — every Phase 1 lib path is fixed here), §14 (NFR non-negotiables — atomic write, lock, schema versioning, cost cap, DOI chokepoint, HTTP chokepoint), §17 (deferred discuss-phase questions — Phase 1 resolves the foundation-slice subset; library index format JSON, PII redaction backend, MCP SDK choice noted), §19 (NFRs as their own early phase — this phase exists because of this section).
- `CLAUDE.md` — Project memory. Non-negotiables: section-as-phase, two-tier, verifier blocks compile/export, no exported trace, honest framing, approval gates default-on. Phase 1 itself doesn't surface these, but every later phase that builds on Phase 1 libs depends on Phase 1 not violating them.

### Phase scope inputs
- `.planning/PROJECT.md` — Active requirements, constraints, key decisions table.
- `.planning/REQUIREMENTS.md` — ARCH-05..17, TEST-05..08, TEST-11 are this phase's full requirement set (per ROADMAP.md Phase 1 mapping). Read EVERY one before planning; D-numbered decisions above MUST cover every requirement.
- `.planning/ROADMAP.md` Phase 1 — Goal text + 5 success criteria the phase must satisfy. SC-1 (CI green on all 3 OSes), SC-2 (DOI round-trip + ASCII case-fold + arXiv old/new + PMID/PMCID), SC-3 (lock conflict + lock-file location), SC-4 (budget abort BEFORE the call + max-parallel + OPENALEX_API_KEY slot), SC-5 (HTTP missing-email WARN + Retry-After/X-Rate-Limit + per-source rate-limit floors + cassette tests for 429/503/Retry-After AND missing-email).

### Prior phase decisions to carry forward
- `.planning/phases/00-repo-skeleton-plugin-manifest/00-CONTEXT.md` — Phase 0 D-01..D-22 establish: TypeScript + ESM + Node ≥20.10, ESLint flat config + chokepoint rules + red-team fixture pattern, GitHub Actions matrix on linux-x64/macos-arm64/windows-x64, npm + lockfile, plugin manifest shape, source-tree skeleton (every Phase 1 lib path is in the existing skeleton), `dist/mcp/server.js` stub. Phase 1 adds NEW chokepoint lint rules (D-07 atomic-write, D-41 paths) following Phase 0's pattern (D-06/D-07/D-08).
- `.planning/phases/00-repo-skeleton-plugin-manifest/00-VERIFICATION.md` — Confirms Phase 0 acceptance: pipeline ALL GREEN 18/18 tests; CI matrix verified; manifest validators wired.
- `.planning/STATE.md` Accumulated Context — `[00-01..00-04]` notes lock in: tsconfig excludes tests/fixtures, ESLint global ignores cannot be overridden by later entries, MCP server declared in BOTH plugin.json and .mcp.json, structural assertions for manifest validation, npm run build BEFORE npm test, fail-fast: false. **Phase 1 inherits all of these — do not unwind.**

### Research-grounded design choices
- `.planning/research/STACK.md` — Stack picks: every dep in D-22 / D-25 / D-30 / D-37 / D-38 / D-46 / D-55 / D-58 / D-59 / D-64 traces to a STACK.md verdict. Where STACK.md says "skip community libs, raw fetch is right" → that's D-23/D-24. Where it says "pin pdf-parse" → that's deferred to Phase 8 (out of Phase 1 scope). The STACK.md "What NOT to use" table lists `node-fetch`, `axios`, `got`, `request`, `chalk`, `inquirer`, `yargs`, `jest`, `pdf-parse@1.x`, Node 18, CommonJS for new code, community paths libs — Phase 1 honors all these "don't use" verdicts.
- `.planning/research/ARCHITECTURE.md` — Three-ring dependency model (Foundation → Domain → Workflow surface) drives the strict 13-step build order in D-01. Section-as-phase invariant (loaded in Phase 4) explains why Phase 1's `state.ts` is intentionally project-level only (D-54). MCP-thin-shim pattern (≤30-line tool handlers) is a Phase 2 concern, but Phase 1's `bin/lib/*` modules MUST expose the right verbs for that thin-shim pattern to work — design the public APIs with future MCP tool handlers as the consumer.
- `.planning/research/PITFALLS.md` — Pitfall 2 (DOI normalization) → D-14..D-20. Pitfall 4 (state corruption + OneDrive) → D-04..D-13, D-40. Pitfall 5 (schema migrations) → D-36..D-39. Pitfall 6 (cost overruns) → D-31..D-35. Pitfall 7 (HTTP gotchas) → D-21..D-30. Pitfall 8 (cross-platform paths) → D-40..D-43. Read these pitfalls' "Avoid" prescriptions verbatim before planning each lib.
- `.planning/research/SUMMARY.md` — Executive summary + push-back deltas. The 13 push-back items (Harvard, RIS, default GPTZero, CSL via citeproc-js, per-step cap, sync detection, verified_against_draft_hash, OPENALEX_API_KEY slot, HANDOFF.json size, tier-contract.test.js timing, verifier acceptance specifics, MCP thin shim, style-match guardrails) — Phase 1 acts on items 5 (per-step cap → D-32), 8 (OPENALEX_API_KEY slot → D-29), and 12 (MCP thin shim → public API design considerations across all libs). Others belong to later phases.

### External specs to validate against (read at lock time, cache version)
- DOI Handbook §case-insensitivity (`https://www.doi.org/the-identifier/resources/handbook`) — confirms ASCII-only case-folding (D-15 step 3).
- arXiv API user manual (`https://info.arxiv.org/help/api/user-manual.html`) — confirms 1-req-per-3s rate limit (D-28) and old/new ID formats (D-17).
- Crossref REST API docs (`https://api.crossref.org`) — polite pool `mailto` requirement (D-24); 50 req/s rate limit (D-28).
- OpenAlex docs (`https://docs.openalex.org/`) — 15K req/hr (D-28); polite-pool email-only sunset Feb 13, 2026 → API-key requirement landing (D-29).
- NCBI E-utilities user guide (`https://www.ncbi.nlm.nih.gov/books/NBK25497/`) — 3 req/s without key, 10 req/s with key (D-28).
- Unpaywall docs (`https://unpaywall.org/products/api`) — `email` query param mandatory (D-28); 100k/day soft (D-28).
- Semantic Scholar API docs — 100 req per 5 min unauthenticated (D-28).
- proper-lockfile README (`https://github.com/moxystudio/node-proper-lockfile`) — confirms PID + mtime + retry semantics behind D-10/D-11.
- p-retry README (`https://github.com/sindresorhus/p-retry`) — confirms `randomize: true` semantics for full jitter (D-27).
- nock + nockBack pattern docs (`https://github.com/nock/nock#nock-back`) — cassette recorder pattern for D-30.
- fast-check property-testing primer (`https://fast-check.dev/`) — for the DOI round-trip property test (D-19).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Test runner: `scripts/run-tests.mjs`** — Phase 0 / 00-01 already shipped a portable cross-platform test runner with vacuous-pass guard. Phase 1 just keeps adding `tests/<lib>.test.ts` files; no new infra needed (D-64).
- **Manifest validator: `scripts/validate-plugin-manifest.cjs`** — Phase 0 / 00-03 ships structural assertions for plugin.json + marketplace.json + .mcp.json. Phase 1 doesn't touch manifests, but if a Phase 1 lib accidentally needs a new manifest field, route the change through this validator.
- **Lint chokepoint pattern: `eslint.config.js` + `tests/lint-chokepoint.test.ts`** — Phase 0 / 00-02 ships REPO-05 chokepoints (`fetch`/`undici` outside `http.ts`, `/^10\./` outside `doi.ts`) with red-team fixture. Phase 1 ADDS two new chokepoint rules following the same pattern: atomic-write banning direct `fs.writeFile` outside `bin/lib/atomic-write.ts` (D-07), and paths banning direct `os.homedir()` / sync-folder env-var reads outside `bin/lib/paths.ts` (D-41). Each new chokepoint MUST add a corresponding red-team fixture (Phase 0 D-08 lesson: chokepoints without fixtures rot silently).
- **CI workflow: `.github/workflows/ci.yml`** — Phase 0 / 00-04 ships the matrix on linux-x64 + macos-arm64 + windows-x64 with `npm ci → lint → typecheck → build → test → validate-manifests`. Phase 1 doesn't change the workflow shape but DOES rely on the build-before-test order (D-65).

### Established Patterns
- **Single ESM `bin/lib/<x>.ts` module per concern** — Phase 0 D-21 created the directory tree (already exists with `.gitkeep`). Phase 1 fills in the `.ts` files. NO subdirectory unless a single file would exceed ~400 LOC (Claude's Discretion above).
- **Schema-version stamp from day one** — Phase 0 D-21 / D-22 established that even stub JSON files carry `schema_version: 1` (per ARCH-07). Phase 1's loader (D-37) makes this contract enforceable.
- **`.cjs` extension for ESM-package CommonJS files** — Phase 0 / 00-03 + 00-02 (eslint.config.js for `scripts/**/*.cjs`) established this. Phase 1's lock-conflict child-process test (D-12) runs against compiled `dist/` JS (which is `.js`, not `.cjs`); no new `.cjs` files needed.
- **Pre-existing `bin/lib/migrations/README.md`** — Phase 0 D-21 already shipped this with the source-tree skeleton. Phase 1's loader (D-37) extends the README with the migration contract spec.

### Integration Points
- **Phase 2 (tier shells + doctor)** consumes Phase 1's `paths.ts`, `lock.ts`, `state.ts`, `library.ts`, `checkpoint.ts`, `session-log.ts`, `runtime.ts`, AND uses `paths.ts.isInsideSyncFolder()` (D-40) to satisfy DOCT-04. Design the public APIs with the doctor as a near-term consumer.
- **Phase 3 (vertical slice)** consumes Phase 1's `http.ts` (for source adapters), `doi.ts` (for normalization), `budget.ts` (for pre-call gating), `pii.ts` (for intake-time redaction), `runtime.ts` (for the actual LLM calls), `session-log.ts` (for `--show-prompts`), `atomic-write.ts` (for every state file write). Phase 3 adds NO new Foundation libs — anything the verifier needs at Foundation level MUST be in Phase 1.
- **Phase 4 (breadth + compile)** EXTENDS Phase 1's `state.ts` with section-state-machine fields (ARCH-19/20). Phase 1's `state.ts` schema MUST be designed extensible (zod schemas with discriminated unions or `.extend()`).
- **Phase 7 (UX layer + hooks)** wires `--yolo`, `--dry-run`, `--estimate`, `--show-prompts` to the Phase 1 hooks (D-35, D-52). Phase 7 also lands the PostToolUse throttled checkpoint that wraps Phase 1's `checkpoint.ts.writeCheckpoint()` (D-56).
- **Phase 8 (library polish)** wraps Phase 1's `library.ts` with the `/pensmith list`/`open` UX. Phase 1's `LibraryStore` interface (D-57) is the swap point for the v0.2 SQLite migration.
- **No Phase 1 code touches `mcp/server.ts`, `hooks/hooks.json`, `agents/`, `workflows/`, `skills/`, `templates/`, `references/` (except `references/http-warnings.md` per D-24).** This is a Foundation-only phase.

</code_context>

<specifics>
## Specific Ideas

- **Repo dev folder is in OneDrive (`Documents/Github/pensmith` under `OneDrive - Roanoke College`).** Lock-file location D-08 (platform local-only data dir, NOT `.paper/`) is therefore not just hygiene — it's the difference between dev being possible and dev being broken on this very machine. Phase 1's lock conflict test (D-12) MUST pass when run from inside the OneDrive folder.
- **Author / email / package metadata.** Reuse `Akhil Achanta <akhilachanta8@gmail.com>` from `package.json` (Phase 0). The polite User-Agent (D-24) embeds this when `PENSMITH_CONTACT_EMAIL` env is set; otherwise WARN-once and proceed.
- **Naming: `bin/lib/migrations/loader.ts`** (D-37), not `bin/lib/migrations.ts` — the `migrations/` directory already exists with `.gitkeep` from Phase 0 D-21 and is meant to host individual migration files in addition to the loader. The loader living inside the same directory keeps the migration concern co-located.
- **Pricing table is hand-maintained and STALE-FAST.** D-60's `pricing.ts` is the one Phase 1 file that needs revisiting at every model release. Add a TODO comment with a 2026-Q3 review date and a link to Anthropic's + OpenAI's pricing pages.
- **Missing-email WARN copy is a locked-string contract** (D-24). The exact wording lives in `references/http-warnings.md`. Don't drift between `http.ts` and the `doctor` warning text; doctor (Phase 2) will reuse the same string.
- **`OPENALEX_API_KEY` slot ships now even though no source code reads it yet** (D-29). The motivation is the Feb 13, 2026 sunset — by the time v0.1 ships the email-only polite pool may already be dead, and a config rev to add the slot post-ship is exactly the kind of break this phase exists to prevent.

</specifics>

<deferred>
## Deferred Ideas

- **Section state machine (ARCH-19) + `verified_against_draft_hash`** — Phase 4. Phase 1 ships only project-level `state.ts` (D-54).
- **Wave scheduling (`computeWaves()`)** — Phase 4. Phase 1 ships the `Semaphore` primitive used by it (D-34) but no scheduler logic.
- **Section renumbering policy with letter suffixes (`03b-validity-threats/`, ARCH-20)** — Phase 4. Phase 1 ships the slug helper only (D-43).
- **HANDOFF.json schema (ARCH-04)** — Phase 3. Phase 1 ships `checkpoint.ts` envelope only (D-56); HANDOFF is a different file with a different consumer (PreCompact hook).
- **`/pensmith list` / `open` / `archived` UX (LIB-02..05)** — Phase 8. Phase 1 ships only the persistence layer (D-55).
- **Class assignment at intake (LIB-04)** — Phase 3 (intake).
- **PII redaction shellout to Microsoft Presidio (PII-V2-01)** — v0.2. Phase 1 ships the regex-only backend with a backend-swap-friendly API (D-48).
- **`--yolo` / `--dry-run` / `--estimate` / `--show-prompts` CLI wiring** — Phase 7. Phase 1 ships only the plumbing predicates (D-35, D-52).
- **Source adapters (`bin/lib/sources.ts`) for Crossref / OpenAlex / arXiv / PubMed / Unpaywall / etc.** — Phase 3. Phase 1 ships the `http.ts` chokepoint they will use (D-21..D-30); the source-discriminator value list in D-23 is the Phase 1→3 contract.
- **`tier-contract.test.js`** — Phase 2 (deliberately — pensmith has only one tier in Phase 1, so a tier-contract test is meaningless). Phase 1 ships single-tier `bin/lib/*` libs that Phase 2 will mirror through MCP and CLI.
- **Doctor's OneDrive warning user-facing wording (DOCT-04)** — Phase 2 doctor. Phase 1 just ships the `isInsideSyncFolder()` predicate (D-40) that doctor will call.
- **Live (non-cassette) HTTP tests against real source APIs** — Phase 3 + a `PENSMITH_NETWORK_TESTS=1` opt-in (D-66). Phase 1 ships ZERO unguarded network tests.
- **Coverage gate in CI (`c8` thresholds)** — keep deferred per Phase 0 D-12 (codecov deferred). Phase 1 ships `npm run coverage` script for developers; not a merge gate (D-67).
- **Cassette refresh CI cron / live smoke run** — `TEST-V2-02`. Stays v0.2.
- **Predatory-journal flag against Beall's-list successors** — `RSCH-V2-02`. Stays v0.2.
- **MCP server bring-up, hooks wiring, doctor end-to-end probes, ecosystem detection (Zotero / Pandoc / humanizer)** — Phase 2.
- **NCBI_API_KEY slot for PubMed authenticated rate limit** — D-28 notes this lands "when PubMed becomes load-bearing in Phase 3". Phase 1 ships the no-key 3 req/s floor only.
- **CSL citation engine (`citation-js` + bundled CSL files)** — Phase 3 (CITE-01 APA-only first), then breadth in Phase 10 (CITE-02..03).

### Reviewed Todos (not folded)

(`gsd-tools list-todos` returned nothing in scope at session time — see Phase 0 STATE.md "Pending Todos: None yet.")

</deferred>

---

## Auto-mode audit log

This phase ran under `--auto`. Every gray area was auto-resolved with the recommended default. Log preserved here so the user can review and correct before Phase 1 starts.

| Gray area | Recommended → Selected | Rationale source |
|-----------|------------------------|------------------|
| Build order & PR cadence | Strict 13-step dep order; one plan per lib (small libs may share a wave when deps allow) | ROADMAP §1 goal text + ARCHITECTURE §3-ring model + Pitfall ordering |
| Atomic write contract | `write tmp → fsync(tmp) → rename → fsync(dir)` with `.tmp.${pid}.${rand}` temp pattern; chokepoint lint banning direct `fs.writeFile` | PRD §14 + Pitfall 4 + STACK.md "lift atomic-write verbatim from gsd-plugin" |
| Lock file location & shape | Platform local-only data dir (NOT `.paper/`), JSON payload with PID/hostname/heartbeat, `proper-lockfile@^4`, hard-abort on conflict | PRD §14 + Pitfall 4 + CLAUDE.md non-negotiable + STACK.md |
| DOI normalization | Single chokepoint, ordered normalize spec (prefix/punct/case/regex), store both canonical+as-cited, separate PMID/PMCID, `fast-check` round-trip property test | PRD §14 + Pitfall 2 + STACK.md + REQUIREMENTS ARCH-15 |
| HTTP client design | undici v7 + p-retry full-jitter + hand-rolled per-source TTL disk cache (NOT undici CacheStore) + per-source rate-limit floors + WARN-once on missing email + OPENALEX_API_KEY slot | STACK.md + Pitfall 7 + ROADMAP §1 SC-5 + REQUIREMENTS ARCH-12..14 + SUMMARY push-back #8 |
| Cassette tests required | 8 cassettes covering 429/503/Retry-After/X-Rate-Limit/missing-email/cache-hit/TTL-expiry/bypassCache | ROADMAP §1 SC-5 + STACK.md nock recommendation |
| Budget gating | `assertBudget` throws BEFORE LLM call; per-session $5 + per-step $0.50; ledger at `.paper/COSTS.jsonl` (append-only); `Semaphore` primitive for `--max-parallel` | PRD §10 + Pitfall 6 + REQUIREMENTS ARCH-09..11 + ROADMAP §1 SC-4 |
| Migrations + schema versioning | `schema_version: 1` everywhere day-one; loader at `bin/lib/migrations/loader.ts`; refuse-forward-incompat throws; zod schemas in `bin/lib/schemas/` | PRD §14 + Pitfall 5 + REQUIREMENTS ARCH-07 + STACK.md zod recommendation |
| Cross-platform paths | `paths.ts` resolves Windows %LOCALAPPDATA% / macOS Application Support / Linux XDG_DATA_HOME; chokepoint lint bans direct `os.homedir()`; `isInsideSyncFolder()` ships now for Phase 2 doctor | Pitfall 4 + Pitfall 8 + REQUIREMENTS ARCH-08 + CLAUDE.md OneDrive context |
| PII redaction | Hand-rolled regex pass for v0.1 (names, dates, SSN, email, phone); deterministic replacement tokens + diff for review; opt-in only; backend-swap API for v0.2 Presidio | PRD §17 + STACK.md + REQUIREMENTS ARCH-17 |
| Session log | JSONL at `.paper/SESSION.log`; rotate at 50MB; oversize records truncated with full payload spilled to `.paper/sessions/`; `--show-prompts` toggle hook ready | PRD §10 + REQUIREMENTS ARCH-16 |
| State / library / checkpoint scope | Foundation-slice ONLY: project-level state, JSON library index + `proper-lockfile`, checkpoint envelope shape; section state machine + UX deferred | REQUIREMENTS ARCH-19/20 → Phase 4, LIB-02..05 → Phase 8 |
| Runtime layer | Provider-agnostic `chat()` wrapping `@anthropic-ai/sdk` + `openai` SDK with baseURL override; static pricing table (hand-maintained, with WARN on unknown model); structural tests only | STACK.md + PRD §10 |
| Testing strategy | `node:test` via existing runner; `nock` cassettes; `fast-check` property tests; `child_process.spawn` for lock conflict; gate live tests behind `PENSMITH_NETWORK_TESTS=1`; ≥85% c8 coverage as dev signal not gate | STACK.md + Phase 0 D-11/D-12 carry-forward + REQUIREMENTS TEST-05..08, TEST-11 |
| New chokepoint lint rules | atomic-write chokepoint (D-07) + paths chokepoint (D-41), each with its own red-team fixture | Phase 0 D-08 lesson — chokepoints without fixtures rot silently |

If any of these defaults conflict with intent, edit this CONTEXT.md before running `/gsd-plan-phase 1`.

---

*Phase: 1-foundation-nfrs*
*Context gathered: 2026-05-07*
