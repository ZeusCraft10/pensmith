# Requirements: pensmith — v0.3.0 Truly End-to-End

**Defined:** 2026-07-06
**Core Value:** Every citation in every exported paper is real and supports the claim it's attached to — verified by re-fetching the live DOI/quote. The verifier blocks compile and export; no FABRICATED, MIS-CITED, or quote-NOT_FOUND ever escapes.

> **Milestone theme:** Close the v0.2.0 carried-forward gap so the discovered research actually informs drafting — the section planner/drafter consume the sources `research` found (grounded, section-scoped, injection-fenced) — and turn the two systemic themes the 37-finding audit just fixed into standing CI invariants so they can't silently return. Scope = the **FEED** source→drafting feed + the **HARDEN** integration/verifier hardening + the two documented **SEC** residuals. Breadth (dedup, figures/tables, partial-draft resume, unverifiable-quote bucket, verb card, FLAG paydown) is deferred to a future milestone. Research (2026-07-06, `.planning/research/SUMMARY.md`) confirmed zero new dependencies: FEED is pure wiring of three placeholder call sites; SEC uses undici's already-imported `connect` seam + `node:worker_threads`; HARDEN reuses `fast-check`/`nock` (already installed) and GitHub Actions environment secrets.

## v1 Requirements

Requirements for the v0.3.0 release. Each maps to exactly one roadmap phase.

### Source→drafting feed (FEED) — the headline

- [ ] **FEED-01**: `plan <N>` receives its section's assigned sources from `LIBRARY.json` (citekey + title/authors/year/abstract) via a pure source-context builder, replacing the placeholder candidate-context (`plan.ts:127`) — so the section planner references the real discovered sources, not `(no sources loaded yet…)`
- [ ] **FEED-02**: `write <N>` drafts against ONLY its section's mapped sources (citekey-filtered from `LIBRARY.json` at call time) and emits `[@citekey]` tokens drawn from them — replacing the `'[]'` placeholder (`write.ts:216`); a section with an empty/insufficient assigned-source set degrades gracefully rather than inventing a placeholder source
- [ ] **FEED-03**: `outline` proposes sections and a per-section source assignment derived from `LIBRARY.json`, with the outline approval gate preserved (`--yolo`-only skip)
- [ ] **FEED-04**: The section→source map is persisted authoritatively in each section's `PLAN.md` `assigned_sources`; a section's drafting prompt contains ONLY its mapped sources — isolation enforced *by construction* (a new pure `bin/lib/source-context.ts` citekey-filters before `interpolate()`) and backstopped by the strict drafter-input membership check — identical across Tier 1 and Tier 2 (tier-contract extended)
- [ ] **FEED-05**: The `section-planner` and `section-drafter` prompts fence the injected (untrusted) source abstracts with the same breakout-resistant markers Pass 2/4 already use, so a malicious source abstract cannot steer manuscript prose or citation selection

### Integration & verifier hardening (HARDEN)

- [ ] **HARDEN-01**: `scripts/e2e-smoke.mjs` runs as a REQUIRED, strict CI job that exits non-zero on any finding, with per-stage assertions that the STATE.json/PLAN.md transitions advance across the bare-`pensmith` router chain (research→LIBRARY.json, outline→sections registered, write→written, verify→verified/failed, compile→DRAFT.md, done→FINAL.md terminal)
- [ ] **HARDEN-02**: A secrets-gated live-provider CI lane (environment-scoped secrets; `push`(main)/`workflow_dispatch` only; never `pull_request_target`) exercises the real Pass-2/Pass-4 LLM paths, the live Crossref/Retraction-Watch re-query, and the SSRF preflight, asserting FABRICATED/MIS-CITED/RETRACTED surface end-to-end through verify→compile→done — additive; offline `PENSMITH_NO_LLM` stays the default required green check
- [ ] **HARDEN-03**: A citation-integrity differential/property test (fast-check) asserts every citekey the exporter renders (uppercase/locator/multi-cite/collision-suffixed) was seen by Pass-1 extraction — a fabricated-key-is-always-flagged invariant standing on top of the already-merged audit fixes
- [ ] **HARDEN-04**: A live-path smoke check exercises a real Pandoc export asserting a formatted reference, a live PyMuPDF extraction, and one live research-adapter round-trip (under the same non-default lane)

### Security residuals (SEC)

- [ ] **SEC-01**: The SSRF guard pins the connection to the validated resolved IP via the undici `connect` callback while preserving the original hostname for TLS SNI/Host — closing the DNS-rebind TOCTOU (WR-03); `checkSsrf()` returns the validated address, and a test proves the validated IP is the one actually dialed
- [ ] **SEC-02**: PDF text extraction runs in a worker thread with a one-shot settled-guard and awaited `terminate()`, so a hostile/oversized PDF is hard-aborted on timeout without zombie workers or discarded valid results (WR-05), covered by a race-condition test at the timeout boundary

## v2 Requirements

Deferred to a future milestone. Tracked, not in this roadmap.

### Breadth (BRDTH)

- **BRDTH-01**: Reference dedup/merge across BYO / `add` / Zotero / live-search into the library
- **BRDTH-02**: Figure / table / caption handling in drafting + export
- **BRDTH-03**: Partial-draft / mid-section resume
- **BRDTH-04**: Unverifiable-quote 4th DONE-09 advisory bucket
- **BRDTH-05**: Verb / flag reference card
- **BRDTH-06**: Pay down the 13 deferred Phase-1 Foundation FLAGs

## Out of Scope

Explicitly excluded (carried from PROJECT.md).

| Feature | Reason |
|---------|--------|
| Inline LaTeX equation rendering | Export `.tex`; user runs LaTeX themselves |
| Paywalled full-text parsing | Only legitimate OA via Unpaywall / arXiv / PubMed Central |
| Automatic Turnitin/GPTZero certification submission | Score for honesty display only |
| Cross-paper "literature comparison" mode | Scope creep beyond the current direction |
| Multi-author / collaboration features | Local single-user tool |
| Cloud-hosted state | Everything is local-only |
| Paid plagiarism services | Free distinctive-phrase check only |
| Metadata stamp / footer / any pensmith trace in exports | Explicit user choice; README disclaimer is the only disclosure |

## Traceability

Which phases cover which requirements. Filled by roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FEED-01 | Phase 17 | Pending |
| FEED-02 | Phase 17 | Pending |
| FEED-03 | Phase 17 | Pending |
| FEED-04 | Phase 17 | Pending |
| FEED-05 | Phase 17 | Pending |
| HARDEN-01 | Phase 19 | Pending |
| HARDEN-02 | Phase 19 | Pending |
| HARDEN-03 | Phase 19 | Pending |
| HARDEN-04 | Phase 19 | Pending |
| SEC-01 | Phase 18 | Pending |
| SEC-02 | Phase 18 | Pending |

**Coverage:**
- v1 requirements: 11 total
- Mapped to phases: 11 (Phase 17: 5, Phase 18: 2, Phase 19: 4)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-06*
*Last updated: 2026-07-06 — v0.3.0 roadmap created (Phases 17–19), 11/11 requirements mapped*
