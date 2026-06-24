---
phase: 15-foundation-security-hardening
plan: "02"
subsystem: http
tags: [security, ssrf, rate-limiting, fifo, hardening]
dependency_graph:
  requires: ["15-01"]
  provides: ["checkSsrf", "isPrivateIp", "FIFO-TokenBucket"]
  affects: ["bin/lib/http.ts", "bin/cli/add.ts"]
tech_stack:
  added: ["node:dns/promises (built-in, no new deps)"]
  patterns: ["FIFO waiter queue + single grant timer (mirrors Semaphore from budget.ts)", "injectable resolver for test isolation"]
key_files:
  created: []
  modified:
    - bin/lib/http.ts
    - bin/cli/add.ts
decisions:
  - "Fail-CLOSED on DNS resolver error for untrusted URLs (resolver error = block, not pass)"
  - "Redirect handling: undici request() does NOT auto-follow by default — callers handle 3xx manually and route back through fetch() → callOnce, so checkSsrf re-fires on each hop automatically. No maxRedirections override needed."
  - "source==='generic' is the trigger for SSRF guard; trusted API sources bypass cleanly (offline cassette tests unaffected)"
  - "TokenBucket tokens are permanently consumed (rate bucket, not semaphore) — no release/return path per RESEARCH A5"
  - "Export __TokenBucketForTest (not TokenBucket) to keep production class unexported while satisfying Wave-0 scaffold probe"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-24"
  tasks_completed: 2
  files_modified: 2
---

# Phase 15 Plan 02: SSRF Guard + FIFO TokenBucket Summary

DNS-preflight SSRF guard with injectable resolver and FIFO-fair single-timer TokenBucket, both shipped in http.ts as the sole network chokepoint.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | SSRF guard in http.ts + add.ts comment (HARD-02) | 4e9fb28 | bin/lib/http.ts, bin/cli/add.ts |
| 2 | FIFO-fair TokenBucket in http.ts (HARD-06) | 4e9fb28 | bin/lib/http.ts |

## What Was Built

### HARD-02: SSRF Guard

Added to `bin/lib/http.ts`:

- `isPrivateIp(addr)` — classifies IPv4 (RFC1918: 10/8, 172.16-31, 192.168/16; loopback 127/8; link-local 169.254/16; 0.x) and IPv6 (::1, fe80::/10 link-local, fc/fd::/7 ULA). Handles IPv4-mapped IPv6 (`::ffff:x.x.x.x`) by extracting embedded v4 and re-checking.
- `SSRF_ALLOWED_SCHEMES` — scheme allowlist Set (`https:`, `http:`), mirroring CACHE_HEADER_ALLOWLIST pattern.
- `checkSsrf(url, resolveFn?)` — exported async guard: validates URL, checks scheme allowlist, resolves ALL addresses via injected or real dns.lookup, rejects if ANY address is private. Fail-CLOSED on resolver error. resolveFn defaults to `dnsLookup(h, {all:true})`.
- Wired into `callOnce()` for `source === 'generic'` (or `opts.untrusted === true`) requests only. Trusted sources (crossref/openalex/arxiv/etc.) bypass.

Fixed `bin/cli/add.ts` line 201: replaced false "SSRF mitigation" comment with accurate description that httpFetch routes through checkSsrf which DNS-resolves and blocks RFC1918/loopback/link-local.

**Redirect handling decision**: undici `request()` does NOT auto-follow redirects (verified in existing codebase — callers handle 3xx and re-call fetch()). Since re-fetch routes back through `fetch() → callOnce`, checkSsrf already re-fires on each redirect hop. No maxRedirections override needed.

### HARD-06: FIFO TokenBucket

Rebuilt `TokenBucket` class in `bin/lib/http.ts` with:
- `private waiters: Array<() => void> = []` — explicit FIFO queue
- `private timerPending = false` — single-timer guard (no storm)
- `acquire()` fast-path: tokens >= 1 AND waiters.length === 0 (consume immediately)
- `acquire()` slow-path: push resolver to waiters, call `_scheduleGrant()` if !timerPending
- `_scheduleGrant()`: single setTimeout, on fire: set timerPending=false, refill, shift oldest waiter (FIFO), decrement token, invoke, recurse if more waiters remain
- `refill()` byte-unchanged
- Added `export { TokenBucket as __TokenBucketForTest }` seam for test scaffold

## Tests Flipped: Skip → Pass

| Test File | Before | After |
|-----------|--------|-------|
| tests/ssrf-guard.test.ts | 5 skipped, 2 always-pass | 7/7 PASS |
| tests/token-bucket-fairness.test.ts | 2 skipped, 1 always-pass | 3/3 PASS |
| tests/http.test.ts | 10/10 PASS (regression: unchanged) | 10/10 PASS |

## Verification Results

- `npm run build`: PASS (tsc clean)
- `npm run typecheck`: PASS (npx tsc --noEmit clean)
- `npm run lint` (my files only): PASS — bin/lib/http.ts and bin/cli/add.ts are lint-clean. Pre-existing lint error in tests/lock.test.ts:278 (out of scope, present before this plan)
- `npm run test:tier-contract`: 48/48 PASS
- `npm test`: 949/952 PASS, 0 fail, 3 skip (pre-existing skips from other Wave-2 plans)

## Public Hosts Pass / Private IPs Rejected / Fail-Closed Confirmed

- Public IP 93.184.216.34 (example.com): passes guard (test: SSRF guard public host test PASS)
- 127.0.0.1 loopback: rejected (test PASS)
- 10.0.0.5 RFC1918: rejected (test PASS)
- 169.254.169.254 IMDS link-local: rejected (test PASS)
- file: scheme: rejected (test PASS)
- Resolver error: blocked (fail-CLOSED, throws with "blocked, fail-closed" message)
- Trusted API sources (crossref/openalex etc.): bypass guard entirely — all existing http.test.ts cassette tests still PASS

## FIFO Confirmed

TokenBucket FIFO test: capacity=1, 3 concurrent acquires queued in order 1→2→3, completion order asserted as [1,2,3] — PASS.

## Deviations from Plan

None — plan executed exactly as written.

Redirect handling choice documented per plan instruction: undici does NOT auto-follow (confirmed), callers re-route through fetch(), checkSsrf re-fires per hop automatically.

## Known Stubs

None.

## Threat Flags

None — implementation is purely within http.ts chokepoint (D-06), no new network surface introduced. The checkSsrf guard closes T-15-02 and T-15-02b. The FIFO TokenBucket closes T-15-06.

## Self-Check: PASSED

- bin/lib/http.ts: exists and contains checkSsrf, isPrivateIp, SSRF_ALLOWED_SCHEMES, FIFO TokenBucket, __TokenBucketForTest export
- bin/cli/add.ts: contains updated comment referencing checkSsrf
- Commit 4e9fb28 exists in git log
- All target tests PASS
