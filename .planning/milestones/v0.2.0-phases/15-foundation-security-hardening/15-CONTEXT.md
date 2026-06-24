# Phase 15: Foundation & security hardening - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey-area defaults auto-accepted, grounded in PROJECT.md non-negotiables + the 2026-06-22 review's foundation/security findings + each prior phase's `<threat_model>` block

<domain>
## Phase Boundary

Close the six foundation/security gaps from the review. Each is largely independent (different files):

- **HARD-01:** canonicalize lock keys before hashing in `lock.ts` so two callers targeting the same file always share one lock (fixes the silent re-enablement of the BLOCKER-01/02 clobber races).
- **HARD-02:** real SSRF guards in `http.ts` — scheme allowlist + DNS-resolved RFC1918 / loopback / link-local block — on `add <url>`, fetched DOIs, and the DuckDuckGo path (the `add <url>` "SSRF mitigation" comment is currently false).
- **HARD-03:** recursive PII redaction on nested string leaves before any `SESSION.log` write (only top-level keys today; the log lives in an OneDrive-synced tree).
- **HARD-04:** (a) a security audit producing a `SECURITY.md` marking each milestone threat PROVEN/UNPROVEN against a test (the deferred secure-phase); (b) `pdf-parse` pinned/replaced + input size + wall-clock bounds (it is fed attacker-controlled bytes); (c) advisory Pass-2/Pass-4 prompts wrap untrusted source/draft text in fenced delimiters (prompt-injection).
- **HARD-05:** the GPTZero honesty check discloses (and size-caps + consent-gates) that it POSTs the full paper body to an external service.
- **HARD-06:** `TokenBucket` / `Semaphore` concurrency primitives are FIFO-fair (no slot leak) so concurrent paid LLM calls respect `--max-parallel`.

Out of scope: CI/DX parity + docs (Phase 16). This phase is security/foundation only.
</domain>

<decisions>
## Implementation Decisions

### HARD-01 — canonicalize lock keys (lock.ts)
- `stubFor(resource)` currently hashes the RAW resource string (`sha256(resource).slice(0,12)`). Callers pass inconsistent conventions for the SAME file (state.ts `path.resolve`, compile.ts a `'compile:'` prefix, add.ts/revise.ts an un-resolved `path.join`). Fix: normalize INSIDE `stubFor` before hashing — `path.resolve` + best-effort `fs.realpathSync.native` (fall back to resolve if the path doesn't exist yet), case-fold on win32. Drop the ad-hoc `'compile:'` prefix at the call site (callers pass a real file path).
- This is the macOS /var→/private/var hazard I hit in the v0.1.0 CI HOOK-04 fix surfacing as a real production bug. Test: two callers with different path conventions for the same file get the SAME stub (hence the same lock).

### HARD-02 — real SSRF guards (http.ts)
- Add an SSRF guard in the http.ts chokepoint applied to any request whose URL is (or derives from) user/remote input — `add <url>`, fetched DOI redirects, the DuckDuckGo HTML path. Guard = (1) scheme allowlist (`https:` only, maybe `http:` for explicitly-allowed dev), (2) resolve the hostname via DNS and REJECT if it resolves to a private/reserved range (RFC1918 10/8, 172.16/12, 192.168/16; loopback 127/8 + ::1; link-local 169.254/16 + fe80::/10; ULA fc00::/7; 0.0.0.0). Reject BEFORE the socket connects. Handle redirect targets too (re-check on each hop). Replace the false "SSRF mitigation" comment in add.ts with the real guard.
- The guard is a function in http.ts (the network chokepoint); applied to outbound fetches by default for untrusted URLs. Internal trusted API hosts (crossref/openalex/etc.) are https public hosts → pass. Offline cassette tests are unaffected (no real DNS). Add tests: a URL resolving to 127.0.0.1 / 10.x / 169.254.x is rejected; a public https host passes.

### HARD-03 — recursive PII redaction before SESSION.log (session-log.ts / pii.ts)
- `redactKeys`/`redactPii` currently cover top-level keys/strings only; nested object string leaves can leak. Fix: make the redaction RECURSE into nested objects/arrays, redacting every string leaf (redactPii) + every sensitive key at any depth (redactKeys), before the record is serialized + written (and before the oversize-spill payload is built — it must come FROM the recursively-redacted record). Keep determinism + the existing no-raw-payload-bypass invariant. Test: a deeply-nested PII string + a nested secret key are both redacted in the written line.

### HARD-04 — secure audit + pdf-parse bounds + prompt-injection delimiting
- **(a) SECURITY.md:** produce a milestone security audit (`.planning/SECURITY.md` or per-phase) enumerating the key threats (the chokepoints: http.ts SSRF, no-key/PII leak, lock races, prompt-injection, zero-trace, supply-chain) and marking each PROVEN (cite the enforcing test) or UNPROVEN (with a follow-up). This satisfies the deferred secure-phase. Use the gsd-security-auditor where it fits.
- **(b) pdf-parse bounds:** PDF ingestion (`pdf-text.ts` / the pdf-parse call fed by `add <pdf>` + BYO PDF) gets a max-input-bytes cap + a wall-clock timeout so a malicious/huge PDF can't hang or OOM. Confirm `pdf-parse@1.1.1` is pinned (it is) + add `npm audit` awareness; replacement is optional if bounds suffice. Test: an over-cap PDF is rejected with a clear error (not a crash/hang).
- **(c) Pass-2/Pass-4 delimiting:** in the advisory Pass-2 (claim-support) + Pass-4 (orphan-label) prompts, wrap untrusted source-abstract/section-draft text in fenced delimiters (e.g. a clearly-marked `<<<UNTRUSTED>>> ... <<<END>>>` block) + a system instruction to treat fenced content as data, not instructions. These passes are advisory (never block), so the blast radius is bounded, but the delimiting reduces injection. Test: a draft containing an injection string ("ignore previous instructions…") is fenced in the built prompt.

### HARD-05 — GPTZero full-body disclosure + consent + size cap (honesty.ts)
- The honesty check POSTs the FULL paper body to GPTZero. Add: (1) a clear disclosure (the locked honest-framing copy already exists — extend with a "this sends your full text to GPTZero" note), (2) a consent gate before the POST (default-on; respects `--yolo` / a config opt-out like the existing approval gates — but disclosure always shows), (3) a size cap (truncate or refuse over a sane byte limit, with a note). The API key is already never logged — keep that. Test: the POST is gated + the disclosure copy is present + over-cap input is handled.

### HARD-06 — FIFO-fair TokenBucket / Semaphore (http.ts / budget.ts)
- Audit `TokenBucket.acquire` (http.ts:252-284) + `Semaphore` (budget.ts:157-200) for async-fairness: a slot/permit leak or non-FIFO grant lets concurrent paid LLM calls over-parallelize past `--max-parallel`. Fix: FIFO waiter queue; release grants the next waiter deterministically (on a microtask, not racily); no permit is lost on an exception (release in finally). Test: N+K concurrent acquirers with N slots → at most N run concurrently, the rest queue FIFO, and an exception in one holder still releases its permit.

### Invariants
- All network stays via http.ts (HARD-02 strengthens it). Secrets/keys never logged (HARD-03/05). Deterministic + offline tests (no real DNS/network in CI — the SSRF guard is unit-tested with a stubbed resolver/IP). 16-verb bijection unchanged. No regression to the verifier gate / zero-trace.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `bin/lib/lock.ts` — `stubFor` (~line 70) hashes raw resource; the canonicalization site. Callers: state.ts (resolve), compile.ts ('compile:' prefix), add.ts/revise.ts (join).
- `bin/lib/http.ts` — the network chokepoint; `TokenBucket` (252-284), the fetch path (~518), the header allowlist (CR-03, ~433). SSRF guard + HARD-06 land here.
- `bin/lib/session-log.ts` (`redactPii`/`redactKeys` from pii.ts, line 29) + `bin/lib/pii.ts` — recursion target for HARD-03.
- `bin/lib/budget.ts` — `Semaphore` (157-200, already FIFO-ish) for HARD-06.
- `bin/lib/pdf-text.ts` + the pdf-parse call — HARD-04(b) bounds.
- `bin/lib/verify/pass2.ts` + `pass4.ts` (+ their prompts in templates/prompts/) — HARD-04(c) delimiting.
- `bin/lib/honesty.ts` — HARD-05 GPTZero POST + locked framing copy.
- `bin/lib/sources/add` / `bin/cli/add.ts` — the `add <url>` SSRF call site (false comment to replace).
- The gsd-security-auditor agent / secure-phase pattern — HARD-04(a) SECURITY.md.

### Established Patterns
- Chokepoint + red-team fixture + regression test (D-06/D-07/D-41); approval-gate (@clack TTY + non-TTY exit-3, --yolo skip); offline cassettes; the no-leak `present:boolean` pattern.

### Integration Points
- lock.ts (+ its callers' prefix removal); http.ts (SSRF + TokenBucket); session-log/pii.ts; pdf-text.ts; pass2/pass4 + prompts; honesty.ts; a new SECURITY.md.
</code_context>

<specifics>
## Specific Ideas

- HARD-01: two path conventions for one file → same lock stub (test).
- HARD-02: a URL resolving to a private/loopback/link-local IP is rejected before connect; public https passes; redirect hops re-checked.
- HARD-03: nested PII string + nested secret key both redacted in the written SESSION.log line.
- HARD-04: SECURITY.md marks each threat PROVEN/UNPROVEN w/ test; over-cap PDF rejected cleanly; Pass-2/4 prompts fence untrusted text.
- HARD-05: GPTZero POST gated + disclosed + size-capped; key still never logged.
- HARD-06: at most N concurrent for N slots, FIFO queue, permit released on exception.
</specifics>

<deferred>
## Deferred Ideas

- CI parity, fresh-clone gate, coverage gate, README/docs (Phase 16 — HARD-04(a) SECURITY.md is a planning doc, not the README).
- Replacing pdf-parse outright (only if bounds prove insufficient — bounds first).
- Async-fairness beyond TokenBucket/Semaphore (scheduler-level) — out of scope.
</deferred>
