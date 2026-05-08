---
phase: 01-foundation-nfrs
plan: 05
subsystem: infra
tags: [http, undici, retry, cache, full-jitter, polite-pool, rate-limit, mock-agent, cassette, arch-12, arch-13, d-23, d-24, d-30, d-31, d-32]

requires:
  - phase: 01-foundation-nfrs/01-00
    provides: undici@^7 + p-retry@^6 + nock@^14 dev deps; references/http-warnings.md locked WARN string; tests/fixtures/http-cassettes/.gitkeep
  - phase: 01-foundation-nfrs/01-01
    provides: pensmithHttpCacheDir() — composes platform-local data dir + /pensmith/http-cache
  - phase: 01-foundation-nfrs/01-02
    provides: atomicWriteFile() — crash-safe write chokepoint (cache writes route through it)
provides:
  - bin/lib/http.ts — sole call site for undici (D-06 chokepoint enforced)
  - bin/lib/retry.ts — full-jitter retry shim (AWS algorithm, not p-retry's bounded multiplicative)
  - 8 cassette JSONs covering Crossref happy/404/429-retry/500-retry, OpenAlex work + search, Unpaywall oa + no-oa
  - 23 cassette/integration tests for http, http-cache, retry
  - Per-source TokenBucket rate gate (ARCH-13)
  - WARN-once banner gate for missing PENSMITH_CONTACT_EMAIL (D-24)
affects: [01-foundation-nfrs/01-06 (budget — wraps LLM provider HTTP calls), Phase 3 verifier (re-fetches DOIs across sections — needs the cache), Phase 2 doctor (reuses references/http-warnings.md verbatim)]

tech-stack:
  added: [undici@^7 (used), MockAgent (testing), full-jitter backoff algorithm]
  patterns:
    - "Chokepoint module + per-file eslint exemption (mirrors bin/lib/atomic-write.ts and bin/lib/doi.ts)"
    - "MockAgent.disableNetConnect() lockdown — every test installs interceptors before any fetch; non-mocked URLs throw"
    - "Per-test cache-dir isolation by overriding LOCALAPPDATA/XDG_DATA_HOME/HOME inside withFreshState()"
    - "WARN-once gate via module-level boolean (warnedNoEmail) reset by _resetWarnedForTest exported for test isolation only"

key-files:
  created:
    - bin/lib/http.ts (474 LoC — fetch + clearCache + WARN-once + TTL cache + TokenBucket + retry-wrapped dispatch)
    - bin/lib/retry.ts (146 LoC — retry + fullJitterDelayMs + RetryOptions)
    - tests/http.test.ts (7 tests — 200, 404, UA, WARN-once, no-WARN, lockdown, clearCache)
    - tests/http-cache.test.ts (6 tests — cache hit, TTL expiry, noCache, no .tmp leak, 404 cached, clearCache)
    - tests/retry.test.ts (15 tests — 10 pure shim + 5 cassette integration)
    - tests/fixtures/http-cassettes/{crossref-doi-200,crossref-doi-404,crossref-doi-429-retry,crossref-doi-500-retry,openalex-work-200,openalex-search-200,unpaywall-200,unpaywall-no-oa-200}.json
  modified:
    - eslint.config.js (added per-file exemption for tests/{http,http-cache,retry}.test.ts so they may import undici and override path env vars for test isolation)

key-decisions:
  - "Hand-rolled full-jitter retry instead of p-retry@6 randomize:true — p-retry's randomize is bounded multiplicative (1.0..2.0 of the exponential base), AWS full-jitter is uniform[0, base*2^(n-1)]. Adversarial servers can synchronize bounded-multiplicative retries; full-jitter decorrelates them. p-retry remains installed as a dependency for future non-HTTP consumers but is not used by the HTTP chokepoint."
  - "Cache key excludes User-Agent — version bumps and PENSMITH_CONTACT_EMAIL changes should NOT invalidate every cached body. The body is API-supplied and does not depend on those headers."
  - "404 GETs are cached (alongside 200) — verifier (Phase 3) needs a definite negative verdict so it doesn't retry every section against the same not-found DOI. TTL bounds the 'not found' assertion."
  - "TokenBucket acquire is INSIDE the retry's fn (not before the retry call) — a 429 retry should re-acquire a token to remain polite. Cache hits skip the bucket because they incur no upstream load."
  - "Test-only exports (_resetWarnedForTest, _resetBucketsForTest) live in bin/lib/http.ts itself rather than a sibling file. Underscore prefix marks them; documented as 'NEVER call from production code'."
  - "Tests redirect pensmithHttpCacheDir() by overriding LOCALAPPDATA / XDG_DATA_HOME / HOME inside a withFreshState() helper — not by passing an injection point through the http API. The chokepoint stays narrow (no test backdoor in production code)."
  - "Banner sentinel for the WARN-once test counts the unique-to-banner phrase 'pensmith: PENSMITH_CONTACT_EMAIL is not set.' rather than the bare word PENSMITH_CONTACT_EMAIL — the locked banner contains the word twice (lead + 'Set …' sentence), so a naive count would always read 2x the emission count."

patterns-established:
  - "HTTP chokepoint: ALL outgoing HTTP calls go through bin/lib/http.fetch(); direct undici/node:http/node:https imports are banned project-wide except in tests/{http,http-cache,retry}.test.ts (per-file exemption needed for MockAgent install)"
  - "Per-source TTL table — TTL_MS_BY_SOURCE keyed on HttpSource union; future sources add a row, no behavior change"
  - "Per-source TokenBucket — RPS_BY_SOURCE keyed on HttpSource; lazy-instantiated bucketFor() returns one TokenBucket per source"
  - "Cassette format — { request: {method,url}, responses: [{status,headers,body}, ...] } — reusable for nock or MockAgent replay"
  - "Lockdown mode — MockAgent.disableNetConnect() is the default in every test; PENSMITH_NETWORK_TESTS=1 reserved for future record-mode (none of Phase 1 needs live network)"

requirements-completed: [ARCH-12, ARCH-13, TEST-05, TEST-11]

duration: ~75min
completed: 2026-05-08
---

# Phase 01-foundation-nfrs Plan 05: Foundation NFRs Wave 5 (HTTP chokepoint + full-jitter retry) Summary

**Polite-pool HTTP client via undici with per-source TokenBucket rate gate, AWS full-jitter retry, per-source TTL disk cache through atomicWriteFile, locked WARN-once banner — proven by 23 cassette + integration tests under MockAgent lockdown.**

## Performance

- **Duration:** ~75 min
- **Started:** 2026-05-08 (Wave 4 handoff)
- **Completed:** 2026-05-08
- **Tasks:** 3 (atomic commits)
- **Files created:** 11 (2 source + 3 test + 8 cassettes)
- **Files modified:** 1 (eslint.config.js — per-file test exemption)
- **Test count delta:** +23 (103 → 126)

## Accomplishments

- `bin/lib/http.ts` is now the sole call site for `undici` / `node:http` / `node:https` in the repo — D-06 chokepoint is load-bearing for every future scholarly-API caller (Phase 3 verifier, budget tracker, Phase 9 SSRF hardening pass)
- Polite User-Agent `pensmith/{version} ({contact})` per D-23, with WARN-once banner per D-24 sourced from `references/http-warnings.md` (no string drift between http.ts and Phase 2 doctor)
- AWS full-jitter retry (`fullJitterDelayMs(attempt, base, cap) = uniform[0, min(cap, base*2^(attempt-1))]`) replaces p-retry's bounded multiplicative jitter; decorrelates retry stampedes against shared upstream queues
- Per-source TokenBucket rate gate (ARCH-13): crossref 50 RPS, openalex 10, unpaywall 10, arxiv 1, pubmed 3, generic 5; bucket acquire is INSIDE the retry's `fn` so 429 retries re-pay rate cost; cache hits skip the bucket entirely
- Per-source TTL disk cache (D-30): crossref/openalex/arxiv/pubmed 7d, unpaywall + generic 1d; cache writes route through `atomicWriteFile` (D-04 + W2 dependency) so a crash mid-write cannot corrupt the cache
- 8 cassette JSONs cover the Crossref happy/404/retry-after/server-error matrix, both OpenAlex endpoints, and both Unpaywall oa-status branches; lockdown mode (`MockAgent.disableNetConnect()`) is the test-suite default

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement bin/lib/retry.ts (full-jitter shim)** — `a71a798` (feat)
2. **Task 2: Implement bin/lib/http.ts (chokepoint, polite UA, WARN-once, TTL cache, retry, TokenBucket)** — `0a56be6` (feat)
3. **Task 3: 8 nock cassettes + tests/http.test.ts + tests/http-cache.test.ts + tests/retry.test.ts** — `30f7642` (test)

## Files Created/Modified

### Created

- `bin/lib/retry.ts` — full-jitter retry shim. Exports `retry<T>(fn, opts)`, `fullJitterDelayMs(attempt, base, cap)`, `RetryOptions`. Defaults: maxAttempts=5, baseMs=200, capMs=30s. Caps the exponent at 30 internally so attempt=100 stays finite.
- `bin/lib/http.ts` — HTTP chokepoint. Exports `fetch(url, opts)`, `clearCache()`, `HttpResponse`, `FetchOptions`, `HttpSource`. Test-only exports `_resetWarnedForTest`, `_resetBucketsForTest`.
- `tests/http.test.ts` — 7 tests: 200 cassette, 404 cassette, UA-contains-pensmith/email, WARN-once-stderr, no-WARN-when-set, lockdown-throws, clearCache.
- `tests/http-cache.test.ts` — 6 tests: cache hit (no second interceptor consumed), TTL expiry refetch, noCache bypass, no-.tmp-leak (atomicWriteFile), 404 cached, clearCache empties dir.
- `tests/retry.test.ts` — 15 tests across two layers: pure shim (no-fail, transient retry, exhaustion, retryOn-false abort, onAttempt fires, invalid maxAttempts, jitter range, cap clamp, attempt<1, large-attempt-no-overflow) + cassette integration (429-then-200, 500-then-200, noRetry skip, 404 not retried, permanent 500 exhaustion).
- `tests/fixtures/http-cassettes/crossref-doi-200.json` — Crossref happy: DOI 10.1038/test, message-type=work, full author block.
- `tests/fixtures/http-cassettes/crossref-doi-404.json` — Crossref 404: error message body.
- `tests/fixtures/http-cassettes/crossref-doi-429-retry.json` — Crossref 429 with `retry-after: 1` then 200.
- `tests/fixtures/http-cassettes/crossref-doi-500-retry.json` — Crossref 500 then 200.
- `tests/fixtures/http-cassettes/openalex-work-200.json` — OpenAlex work fetch (`/works/W123`).
- `tests/fixtures/http-cassettes/openalex-search-200.json` — OpenAlex search (`/works?search=foo`).
- `tests/fixtures/http-cassettes/unpaywall-200.json` — Unpaywall is_oa=true, gold OA, oa_locations populated.
- `tests/fixtures/http-cassettes/unpaywall-no-oa-200.json` — Unpaywall is_oa=false, oa_locations empty.

### Modified

- `eslint.config.js` — added per-file exemption block for `tests/{http,http-cache,retry}.test.ts` turning off `no-restricted-imports` (so they may `import { MockAgent, setGlobalDispatcher } from 'undici'`) and `no-restricted-syntax` (so they may override `process.env.LOCALAPPDATA / XDG_DATA_HOME / HOME` inside `withFreshState()` for per-test cache-dir isolation). Both bans remain in force project-wide.

## Decisions Made

See frontmatter `key-decisions` for the full list. Highlights:

- **Hand-rolled full-jitter shim instead of p-retry@6 `randomize:true`** — p-retry's randomize bounds are multiplicative (default 1.0..2.0 of the base), AWS full-jitter is uniform `[0, base*2^(n-1)]`. The bounded-multiplicative form has a non-zero floor, so adversarial servers can still synchronize retry stampedes. Full-jitter decorrelates them maximally. p-retry stays installed for non-HTTP consumers; the HTTP chokepoint uses our shim.
- **TokenBucket acquire INSIDE retry's fn, not before it** — a 429 retry should re-pay the rate cost so we remain polite. Cache hits skip the bucket because they don't hit upstream.
- **Cache 404s alongside 200s** — Phase 3's verifier needs a definite "not found" so it doesn't pound the same upstream once per section. TTL bounds the negative assertion.
- **Cache key excludes User-Agent** — version bumps and PENSMITH_CONTACT_EMAIL changes shouldn't invalidate every cached body.
- **WARN-once sentinel is the unique-to-banner phrase, not the env-var word** — the banner contains `PENSMITH_CONTACT_EMAIL` twice (once in the lead, once in the "Set…" sentence), so counting that word over-counts emissions by 2x.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Added per-file eslint exemption for tests/{http,http-cache,retry}.test.ts**

- **Found during:** Task 3 (writing tests)
- **Issue:** The HTTP test files MUST `import { MockAgent, setGlobalDispatcher } from 'undici'` to install cassette interceptors — there is no other way to test `bin/lib/http.ts` without live network. They MUST also override `process.env.LOCALAPPDATA / XDG_DATA_HOME / HOME` inside `withFreshState()` so each test has an isolated `pensmithHttpCacheDir()`. The Phase 0 D-06 / D-41 chokepoints reject both as written.
- **Fix:** Added an eslint config block scoped to exactly those three test files, turning off `no-restricted-imports` and `no-restricted-syntax`. Both bans remain in force everywhere else (verified: lint passes with no warnings on the rest of the repo).
- **Files modified:** `eslint.config.js`
- **Verification:** `npm run lint` exits 0; the existing `tests/lint-paths-chokepoint.test.ts` and `tests/lint-atomic-write-chokepoint.test.ts` red-team fixtures still flag their violations.
- **Committed in:** `30f7642` (Task 3 commit)

**2. [Rule 2 — Missing critical] Capped retry exponent at 30 to prevent NaN/Infinity**

- **Found during:** Task 1 (writing retry.ts)
- **Issue:** Plan specified `Math.pow(2, attempt - 1)` directly. With `attempt = 100`, `2^99 ≈ 6.3e29` overflows the IEEE-754 safe-integer range; subsequent `Math.min(cap, Infinity)` returns the cap, but `Math.floor(Math.random() * (Infinity + 1))` is NaN on some JS engines.
- **Fix:** Bounded the exponent at 30 inside `fullJitterDelayMs()` (`Math.min(attempt - 1, 30)`). 2^30 = ~1e9 ms = ~12 days, far beyond any sensible `capMs`, so the cap still wins.
- **Files modified:** `bin/lib/retry.ts`
- **Verification:** Added test `'fullJitterDelayMs: large attempt does not overflow to NaN'` (passes attempt=100; result must be finite and ≤ capMs).
- **Committed in:** `a71a798` (Task 1 commit)

**3. [Rule 2 — Missing critical] WARN-once test sentinel uses banner-unique phrase**

- **Found during:** Task 3 (first test run)
- **Issue:** Plan said "asserts stderr is written EXACTLY ONCE across N fetch calls, and the literal string from references/http-warnings.md is present". I initially counted occurrences of the word `PENSMITH_CONTACT_EMAIL`. The locked banner contains that word **twice** (once in the lead, once in the "Set PENSMITH_CONTACT_EMAIL to your email…" sentence). So even with a perfect WARN-once gate, the test reported 2 emissions and failed.
- **Fix:** Changed the sentinel regex to `/pensmith: PENSMITH_CONTACT_EMAIL is not set\./g`, which appears exactly once per banner emission. Also kept the `/no-contact User-Agent/` assertion to prove the locked banner phrasing is intact.
- **Files modified:** `tests/http.test.ts`
- **Verification:** Test now passes; sentinel count is 1 across 3 noCache fetches.
- **Committed in:** `30f7642` (Task 3 commit, fixed during the task)

---

**Total deviations:** 3 auto-fixed (1 Rule 3 blocking, 2 Rule 2 missing-critical)
**Impact on plan:** All three are correctness/security necessities, not scope creep. The eslint exemption is the smallest possible blast radius (3 files, named explicitly); the exponent cap is defensive arithmetic; the WARN-once sentinel is a test-counting bug not a runtime bug.

## Issues Encountered

- **TypeScript strict-mode `body: unknown` on `MockInterceptor.reply()`** — undici's `reply()` overload expects `string | object | Buffer`. Initial Cassette interface declared `body: unknown` which the compiler rejected. Fixed by typing `body: object | string` in the cassette type (matches the underlying API and accepts every cassette JSON).
- **`writeFile` chokepoint vs. test fixture write** — the TTL-expiry test needed to rewrite the cache file's `savedAt` to a stale timestamp. `fsp.writeFile` is banned by the D-07 lint rule. Resolved by routing the test write through `atomicWriteFile` (the chokepoint itself), which is exactly the production path. No exemption needed.
- **No live-network gate exercised this wave** — the plan mentions PENSMITH_NETWORK_TESTS=1 record mode, but Phase 1 ships cassette-only. Live record mode is reserved for future cassette refresh; no test depends on it.

## User Setup Required

None — no external service configuration, no env vars required for the test suite (PENSMITH_CONTACT_EMAIL is *optional* and the WARN-once gate handles missing values).

For production use of the HTTP chokepoint, the user is encouraged (not required) to set `PENSMITH_CONTACT_EMAIL` in their shell profile to avoid the no-contact UA — the locked banner explains this on first request.

## Next Phase Readiness

- **W6 (budget) unblocked.** `budget.ts` will wrap LLM provider HTTP calls; it now has a typed `fetch()` to call into.
- **Phase 3 verifier unblocked.** The verifier re-fetches DOIs across sections; the per-source 7-day cache means a 100-section paper × 50 DOIs run that re-runs once = 0 upstream requests. Cassettes also serve as live-API conformance fixtures Phase 3 can re-record under PENSMITH_NETWORK_TESTS=1.
- **Phase 2 doctor (DOCT-03) unblocked.** Doctor will reuse the locked WARN string from `references/http-warnings.md` verbatim; same source of truth as the http.ts module-load read, so drift is impossible without breaking both.
- **Phase 9 security pass — known carry-forward.** SSRF hardening (allowlist, IP filtering, no redirect-to-private), 100MB body cap, and live PENSMITH_NETWORK_TESTS smoke tests are deferred to Phase 9 per threat model dispositions T-01-04 / T-01-DOS-04.

---

## Self-Check: PASSED

Verified each claim against disk and git:

```
FOUND: bin/lib/retry.ts
FOUND: bin/lib/http.ts
FOUND: tests/http.test.ts
FOUND: tests/http-cache.test.ts
FOUND: tests/retry.test.ts
FOUND: tests/fixtures/http-cassettes/crossref-doi-200.json
FOUND: tests/fixtures/http-cassettes/crossref-doi-404.json
FOUND: tests/fixtures/http-cassettes/crossref-doi-429-retry.json
FOUND: tests/fixtures/http-cassettes/crossref-doi-500-retry.json
FOUND: tests/fixtures/http-cassettes/openalex-work-200.json
FOUND: tests/fixtures/http-cassettes/openalex-search-200.json
FOUND: tests/fixtures/http-cassettes/unpaywall-200.json
FOUND: tests/fixtures/http-cassettes/unpaywall-no-oa-200.json
FOUND: a71a798 (Task 1 — retry.ts)
FOUND: 0a56be6 (Task 2 — http.ts)
FOUND: 30f7642 (Task 3 — cassettes + tests)
PASS:  npm run check (lint + typecheck + 126/126 tests + manifest)
```

---
*Phase: 01-foundation-nfrs*
*Completed: 2026-05-08*
