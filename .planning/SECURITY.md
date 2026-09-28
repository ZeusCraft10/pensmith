# Pensmith v0.1.0 — Milestone Security Audit

**Phase:** 15-foundation-security-hardening  
**Authored:** 2026-06-24  
**Wave:** 4 (Plans 15-02 through 15-07 have landed; this audit is authoritative as of Wave 4 completion)  
**Phase 17 update (2026-09-27, egress stream — SEC-01, SEC-03, RUN-04, RUN-08):** row 2a is now PROVEN (per-request IP pinning); rows 25–27 are new (response size cap, LLM-endpoint allowlist, the one egress gate). Row 11 now runs through the V2 `detector-consent` gate.
**Status legend:** PROVEN — enforcing test is currently green; UNPROVEN-in-CI — behavior is correct but cannot be validated in CI without live network access (manual-only verification instructions provided); UNPROVEN — no enforcing test yet (follow-up required).

---

## Purpose

This document is the deferred secure-phase audit required by HARD-04a. It enumerates every significant threat surface identified across the Phase 15 hardening work, cross-references the per-phase `<threat_model>` blocks (Plans 15-02 through 15-08), and maps each threat to its enforcing test. Every row marked PROVEN cites a test that was confirmed green before this document was committed.

This is a planning artifact — it lives in `.planning/` and is NOT a public-facing security disclosure. Phase 16 covers README/docs.

---

## Threat Matrix

| # | Threat | Chokepoint | Enforcing Test | Status |
|---|--------|------------|----------------|--------|
| 1 | SSRF — private-IP / loopback reach via user-supplied URL | `bin/lib/http.ts` → `checkSsrf()` | `tests/ssrf-guard.test.ts` | **PROVEN** |
| 2 | SSRF — live DNS resolution to RFC1918/loopback/link-local/CGNAT/multicast/unspecified; IPv4-mapped hex-colon form | `bin/lib/http.ts` → `checkSsrf()` DNS pre-flight | `tests/ssrf-guard.test.ts` (injected resolver; WR-01/WR-02 coverage added Phase 15 fix) | **PROVEN-in-CI** / UNPROVEN-live (see §Manual) |
| 2a | SSRF — DNS TOCTOU rebinding window: the pre-flight resolves to a public IP, then the socket resolves again and gets a private IP | `bin/lib/http.ts` → `checkSsrf()` / `checkLlmEndpoint()` return the validated addresses; a per-request undici `Agent` whose connect `lookup` answers ONLY with them (hostname kept for TLS SNI + Host); `maxRedirections: 0` (undici never follows a redirect); http.ts follows 301/302/303/307/308 itself (SRC-01, D-19-06): each hop gets the scheme allowlist, a fresh resolve + validate, a new pinned `Agent`, its own mirror line and SESSION.log record, and credentials are dropped across origins | `tests/ssrf-pinning.test.ts` (a resolver that flips public → 127.0.0.1 is consulted once and the dial goes to the validated IP; SNI server reached with the hostname as SNI/Host; cert verification on; a redirect to 169.254.169.254 or to a name resolving to 10.0.0.5 is refused at the re-validated hop with no dial; each hop resolved once and pinned to its own address; `maxRedirections: 0` asserted), `tests/http-redirect.test.ts` | **PROVEN** (SEC-01, Phase 17; per-hop re-pinning SRC-01, Phase 19). |
| 3 | API key / secret leaks to SESSION.log | `bin/lib/pii.ts` → `redactKeys()` + `deepRedactPii()` | `tests/pii.test.ts` + `tests/session-log.test.ts` | **PROVEN** |
| 4 | PII (email, phone, SSN, credit card) leaks to SESSION.log via nested object | `bin/lib/pii.ts` → `deepRedactPii()` + `bin/lib/session-log.ts` → `buildRecord()` | `tests/session-log.test.ts` (HARD-03 rows) | **PROVEN** |
| 5 | Lock-race / clobber — two callers target same file via different path conventions, get different stubs, never contend | `bin/lib/lock.ts` → `stubFor()` canonicalization (resolve + realpathSync) | `tests/lock.test.ts` (HARD-01 row: "two path conventions for one file → identical stub") | **PROVEN** |
| 6 | Lock-race — cross-process concurrent write (BLOCKER-01/02) | `bin/lib/lock.ts` → `withLock()` / `proper-lockfile` | `tests/lock.test.ts` (TEST-07 cross-process spawn) | **PROVEN** |
| 7 | Prompt injection — untrusted source abstract / claim sentence in Pass-2/Pass-4 prompt | `templates/prompts/claim-support.md` + `orphan-label.md` — PENSMITH_UNTRUSTED_DATA fence marker | `tests/pass2-injection.test.ts` | **PROVEN** |
| 8 | PDF supply-chain — pdf-parse version drift (malicious or breaking update) | `package.json` exact pin `pdf-parse@1.1.1` + dual-surface pin guard | `tests/repo-files.test.ts` ("pdf-parse stays pinned exact at 1.1.1") | **PROVEN** |
| 9 | PDF OOM / hang — unbounded input causes memory exhaustion or infinite parse loop | `bin/lib/pdf-text.ts` → `MAX_PDF_BYTES` cap (50 MB) before any parse; pdf-parse runs only in the `worker_threads` worker `bin/lib/pdf-worker.ts` (heap limit 1.5 GB) under `PDF_TIMEOUT_MS`; a one-shot settle guard over message / error / exit / timeout, and on timeout the parent AWAITS `worker.terminate()` before rejecting (SEC-02, D-19-22) | `tests/pdf-text-bounds.test.ts` (byte cap) + `tests/pdf-worker.test.ts` (a result 1 ms before the timeout is returned; a hanging parse is terminated and `activePdfWorkers()` returns to 0; a process whose parse timed out exits on its own; worker entry from source and from `dist/`) | **PROVEN** (SEC-02, Phase 19): the WR-05 residual — pdf-parse burning CPU after a `Promise.race` timeout — is closed; a timed-out parse is killed with its thread, reclaiming CPU and memory. PLUG-02 (Phase 23) adds the plugin-bundle layout to the worker-entry test. |
| 10 | GPTZero API-key never logged | `bin/lib/honesty.ts` → presence-only check; value reaches only the `x-api-key` header | `tests/honesty.test.ts` (key-never-logged assertion) | **PROVEN** |
| 11 | GPTZero full-body egress without consent — raw essay text sent to third-party service | `bin/lib/honesty.ts` → the V2 `detector-consent` gate (asks in a terminal; `--yolo` NEVER skips it; a run that cannot prompt gives "score unavailable (no consent)"); offline never sends | `tests/honesty.test.ts` (consent declined / no terminal / `--yolo` → no POST; offline → "score unavailable (offline)") | **PROVEN** |
| 12 | GPTZero over-sized POST — excessive bandwidth / API cost on large papers | `bin/lib/honesty.ts` → `GPTZERO_MAX_BYTES` truncation before POST | `tests/honesty.test.ts` (HARD-05: "over-cap input → POST body truncated") | **PROVEN** |
| 13 | GPTZero live-egress consent with real API key | `bin/lib/honesty.ts` → same consent gate | manual only (see §Manual) | **UNPROVEN-in-CI** |
| 14 | Zero-trace in exported .docx — pensmith metadata stamp in Word XML | `bin/lib/exporter.ts` → `zeroTracePatch()` + deterministic ZIP generator | `tests/zero-trace-export.test.ts` (Tests A–B) + `tests/repo-files.test.ts` (fixture hash-pins) | **PROVEN** |
| 15 | Zero-trace in exported .pdf — pensmith / XMP metadata in PDF /Info dict | `bin/lib/exporter.ts` → `zeroTracePdf()` | `tests/zero-trace-export.test.ts` (Tests C–D) | **PROVEN** |
| 16 | Zero-trace in exported .md / .tex — generator comment or pensmith string | `bin/lib/exporter.ts` → pandoc pipeline + md/tex codepath | `tests/zero-trace-export.test.ts` (Tests E–F) | **PROVEN** |
| 17 | Verifier gate fail-closed — compile runs despite unverified / fabricated section | `bin/cli/compile.ts` → `runCompile()` → GATE-01 guard | `tests/compile-refuse.test.ts` (GATE-01 rows) | **PROVEN** |
| 18 | Verifier gate retraction — MIS-CITED / retracted DOI escapes export | `bin/lib/verifier/pass1.ts` → `fetchById()` retraction check | `tests/gate-retraction.test.ts` (GATE-03 rows) | **PROVEN** |
| 19 | Verifier gate done-recheck — citekey drift after verification | `bin/cli/compile.ts` → `reCheckFinalMd()` (GATE-04, no --yolo escape) | `tests/done-recheck.test.ts` (GATE-04 rows) | **PROVEN** |
| 20 | Prompt drift / supply-chain — prompt template silently modified | `bin/lib/prompt-loader.ts` → `EXPECTED_PROMPT_HASHES` (WN-3) | `tests/repo-files.test.ts` (hash-pin tests for all locked templates) | **PROVEN** |
| 21 | Concurrency over-parallelization — HTTP rate-limit bypass via non-FIFO TokenBucket | `bin/lib/http.ts` → `TokenBucket` FIFO waiter queue | `tests/token-bucket-fairness.test.ts` | **PROVEN** |
| 22 | Concurrency over-parallelization — Semaphore slot leak on bare-caller exception | `bin/lib/budget.ts` → `Semaphore.withLock()` try/finally; bare-caller doc warning | `tests/budget.test.ts` (HARD-06: withLock-releases-permit-on-throw; FIFO regression) | **PROVEN** |
| 23 | HTTP cache header leak — cached responses include auth/session headers from original request | `bin/lib/http.ts` → cache layer | `tests/http-cache-no-header-leak.test.ts` | **PROVEN** |
| 24 | Honesty framing drift — "evade detection" wording sneaks into honesty report | `references/honesty-framing.md` → SHA-256 hash-pin (WN-3) | `tests/repo-files.test.ts` ("references/honesty-framing.md hash-pin") | **PROVEN** |
| 25 | Unbounded upstream response — a hostile or broken endpoint streams an endless body (memory exhaustion; the old `MAX_PDF_BYTES` check ran only after full buffering) | `bin/lib/http.ts` → the body is streamed under a per-call `maxBytes` (JSON/text 8 MiB, PDFs `MAX_PDF_BYTES`, LLM 16 MiB); a larger `content-length` is refused up front; `ResponseTooLargeError` aborts before full buffering | `tests/response-size-cap.test.ts` (a 60 MB stream is aborted at the cap with bounded memory growth; a declared oversize length is refused before reading) | **PROVEN** (SEC-03, Phase 17) |
| 26 | LLM-endpoint SSRF — a configured model endpoint used to reach metadata / internal services | `bin/lib/http.ts` → `checkLlmEndpoint()` for `opts.llm` requests only: the request origin must equal the `llm.endpoint` origin; `http://` only when every resolved address is loopback; 169.254.0.0/16, fe80::/10, fd00:ec2::254 never; other private ranges only over https; pinned like every request. Source requests to loopback/private are always refused. http.ts trusts its caller for `llm.endpoint`, so ONLY `bin/lib/anthropic.ts` (which passes the resolved runtime endpoint) may set `llm`: the `llm-transport-single-module` chokepoint row flags any other `fetch(…, { llm })` call or `llm: {` literal in bin/, mcp/, hooks/ and scripts/ | `tests/egress-gate.test.ts` (D-17-09 rows); `tests/chokepoints.test.ts` (the row's fixture: a module self-allowlisting a loopback target fails lint) | **PROVEN** (RUN-08 transport half, Phase 17; caller restriction enforced by the chokepoint row since review round 1). Config-time validation of `endpoint` / `api_key_env` belongs to the runtime loader (llm stream). |
| 27 | Silent egress in offline / dry-run modes — an adapter, `verifyDoi`, the Pass-3 OA-PDF fetch or the LLM leaking a request when the user asked for no network | `bin/lib/http.ts` → one gate: `--dry-run` refuses every request; `PENSMITH_NO_LLM` refuses `opts.llm`; sources-offline answers only exact recorded fixtures (else `OfflineEgressError`), and dials only a configured loopback LLM endpoint | `tests/egress-gate.test.ts`, `tests/flags.test.ts` H3 (socket-level dial recorder over research / add / verify / compile / done under `--dry-run` and `PENSMITH_OFFLINE=1`: 0 dials), `tests/net-mode.test.ts` (no env bypass in http.ts), `tests/offline-fail-closed.test.ts` (a fixture miss is never another record), `tests/dry-run-sources.test.ts` (dry-run research: 0 dials, 0 cassette reads) | **PROVEN** (RUN-04, Phase 17) |
| 28 | Local-file exfiltration through a shared paper — a `.paper/config.toml` whose `[sources] byo_pdf_dir` names a folder outside the paper (e.g. the reader's Documents) makes `research` copy its PDFs into the shared paper and send their titles out; a `[sources] zotero_collection` pulls the reader's Zotero collection into the shared LIBRARY.json; a failed collection lookup writes the reader's collection names into RESEARCH.md | `bin/lib/own-source-approvals.ts` → a folder outside the project (after realpath) and any collection are read only with this user's approval for this paper (`new --pdfs`, or the `byo-folder` / `zotero-collection` gates — `--yolo` never answers them; no terminal → skipped); approvals in the data dir, keyed by the project's real path; `ZoteroError.publicReason` keeps library details out of RESEARCH.md | `tests/own-source-approvals.test.ts` (built CLI: an outside folder is not read by `research --yolo`, nothing copied; approved at the gate it is; `new --pdfs` approves) + `tests/zotero-research.test.ts` (an unapproved collection: zero Zotero requests; a not-found collection keeps names and the library id out of RESEARCH.md) | **PROVEN** (Phase 19 review round 1) |
| 29 | Evidence laundering through bring-your-own text — a PDF that is not the cited work (a DOI found in its footnote, or any PDF attached with `add <id> --pdf`) stored as that work's copy, so a fabricated quote matches its text | `bin/lib/pdf-identify.ts` → `isOwnWork()` (a record found by identifier must match the PDF's own title + first author, or be printed as its title with the author below); `bin/lib/byo-ingest.ts` → `checkPdfForRecord()` + the `pdf-attach-unmatched` gate (never `--yolo`), `byo.asserted`; `bin/lib/byo-text.ts` → an asserted copy's text is never evidence, every read re-hashes (S-17) | `tests/pdf-identify.test.ts` (the footnote-citation essay stays unidentified) + `tests/add-pdf-attach-cli.test.ts` (wrong PDF refused even with `--yolo`; an identified copy never replaced without `--replace-pdf`; an asserted copy never verifies a quote) + `tests/pass3-byo-cli.test.ts` (edited PDF / forged `.txt` never make a quote pass) | **PROVEN** (Phase 19 review round 1) |

---

## Manual-Only Verifications

The following threats are architecturally mitigated but cannot be exercised in CI without live network/API access:

| # | Behavior | Requirement | Why Manual | Test Instructions |
|---|----------|-------------|------------|-------------------|
| M-1 | A real `add <url>` to a host that resolves to 127.x/10.x/169.254.x is blocked via live DNS | HARD-02 | CI uses an injected resolver; real DNS unavailable | `pensmith add http://<host-resolving-to-private-IP>` (live is the default since Phase 17) — expect rejection with an `SSRF guard:` error |
| M-2 | GPTZero consent + size cap with a real API key on a large paper | HARD-05 | Live API + real GPTZERO_API_KEY required | Run `pensmith done` on a paper > GPTZERO_MAX_BYTES with a valid key; confirm: (a) consent prompt shown, (b) POST body truncated to cap, (c) key not printed anywhere in output |

---

## Cross-Reference: Per-Phase Threat Model Blocks

| Plan | Threat IDs | Coverage in This Audit |
|------|-----------|------------------------|
| 15-02 (lock.ts) | T-15-01 (BLOCKER-01/02, D-26/D-40) | Rows 5, 6 |
| 15-03 (http.ts) | T-15-02 (ARCH-12/13, D-06 SSRF), T-15-06a (TokenBucket FIFO) | Rows 1, 2, 2a, 21, 23 |
| Phase 17 (egress: http.ts gate) | SEC-01, SEC-03, RUN-04, RUN-08 (D-17-05, D-17-09) | Rows 2a, 25, 26, 27 |
| 15-04 (pii.ts + session-log.ts) | T-15-03 (T-01-06/07/08 PII/key leak) | Rows 3, 4 |
| 15-05 (pdf-text.ts) | T-15-04b (OOM/hang), T-15-04b-SC (supply-chain pin) | Rows 8, 9 |
| 15-06 (pass2/pass4 fencing) | T-15-04c (prompt injection) | Row 7 |
| 15-07 (honesty.ts) | T-15-05 (GPTZero consent/cap/key-no-log), T-15-05-framing (framing drift) | Rows 10, 11, 12, 13, 24 |
| 15-08 (SECURITY.md + Semaphore doc) | T-15-06b (Semaphore bare-caller permit leak), T-15-04a (audit) | Rows 22, (this document) |
| Phase 6 (zero-trace export) | DONE-07 / HIGH-1 | Rows 14, 15, 16 |
| Phase 14 (verifier gate) | GATE-01/03/04 | Rows 17, 18, 19 |
| Phase 8/9 (prompt-loader WN-3) | WN-3 prompt drift | Rows 20, 24 |

---

## Prior-Milestone Chokepoint Threats

These were identified before Phase 15 and are included for completeness:

| Chokepoint | Threat Ref | Current Status |
|------------|-----------|----------------|
| `bin/lib/pii.ts` | T-01-06 (key leak), T-01-07 (PII egress), T-01-08 (__proto__ pollution) | PROVEN — rows 3, 4 + `tests/pii.test.ts` |
| `bin/lib/lock.ts` | D-26 (cross-process lock), D-40 (lock dir not in .paper/) | PROVEN — rows 5, 6 + `tests/lock.test.ts` |
| `bin/lib/http.ts` | ARCH-12 (SSRF), ARCH-13 (redirect re-check), D-06 (sole network chokepoint) | PROVEN — rows 1, 2 + `tests/ssrf-guard.test.ts` |
| `bin/lib/budget.ts` | T-01-RACE-03 (TOCTOU budget window — accepted; per-section caps bound overrun to one estimate) | Accepted risk, documented in `assertBudget()` source comment |

---

## Counts

- **Total threats enumerated:** 30 table rows (1–29 plus 2a) + 2 manual-only (M-1, M-2); rows 2a and updated 9 added Phase 15 fix; rows 25–27 added Phase 17 (counts recounted from the table in Phase 17); rows 28–29 added in Phase 19 review round 1
- **PROVEN (CI-verified):** 28 (row 9 moved here in Phase 19, SEC-02; rows 28–29 added in Phase 19 review round 1)
- **PROVEN-in-CI / UNPROVEN-live:** 1 (row 2 — live DNS SSRF)
- **PROVEN-with-residual (documented gap, deferred fix):** 0
- **UNPROVEN-in-CI (manual-only):** 2 (rows 13, M-2 — live GPTZero)
- **UNPROVEN (no test, follow-up required):** 0

Row 9's WR-05 residual (post-timeout PDF CPU) was closed in Phase 19 (SEC-02: the parse runs in a worker that is terminated on timeout). Row 2a's WR-03 DNS TOCTOU gap was closed in Phase 17 (SEC-01).

All enforcing tests confirmed green at time of authoring (Wave 4, 2026-06-24). Phase 15 fix audit: 2026-06-24.
