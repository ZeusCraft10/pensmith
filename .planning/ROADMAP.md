# Roadmap: pensmith

## Milestones

- ✅ **v0.1.0 Foundation** — Phases 0–10 (shipped 2026-06-22) — full two-tier architecture, Foundation NFRs, the deterministic verifier gate, compile/export pipeline, single-command UX, and the citation/style libraries. Archive: [milestones/v0.1.0-ROADMAP.md](milestones/v0.1.0-ROADMAP.md).
- ✅ **v0.2.0 End-to-End** — Phases 11–16 (shipped 2026-06-24) — connected the generative seams: Tier-2 LLM transport, live research discovery, citation rendering at export, fail-closed verifier gate, foundation/security hardening, CI/DX + docs parity. 25/25 requirements; 3-OS CI green. Archive: [milestones/v0.2.0-ROADMAP.md](milestones/v0.2.0-ROADMAP.md).
- 🚧 **v0.3.0 Truly End-to-End** — Phases 17–19 (in progress) — wire discovered LIBRARY.json sources into the plan/outline/write prompts (FEED, the v0.2.0 carried-forward headline), close the two documented security residuals (SEC — DNS-rebind pinning, PDF worker-abort), and promote the audit-hardening work into standing CI invariants (HARDEN — strict e2e gate, live-provider lane, citation-integrity test). 11/11 requirements.

## Phases

<details>
<summary>✅ v0.1.0 Foundation (Phases 0–10) — SHIPPED 2026-06-22</summary>

- [x] Phase 0: Repo skeleton & plugin manifest (4/4) — 2026-05-07
- [x] Phase 1: Foundation NFRs (14/14) — 2026-05-14
- [x] Phase 2: Tier shells + doctor + tier-contract gate (10/10) — 2026-05-16
- [x] Phase 3: Vertical slice through one section (10/10) — 2026-05-28
- [x] Phase 4: Breadth — N sections + compile + wave scheduling (5/5) — 2026-06-17
- [x] Phase 5: Verifier completeness (Pass 2 + Pass 4) (5/5) — 2026-06-18
- [x] Phase 6: Done / export pipeline + zero-trace gate (5/5) — 2026-06-18
- [x] Phase 7: Single-command UX layer + hooks + flags (4/4) — 2026-06-19
- [x] Phase 8: Style match + sketch + add + library + BYO PDF polish (7/7) — 2026-06-20
- [x] Phase 9: Educator/tutorial mode + PII polish (4/4) — 2026-06-20
- [x] Phase 10: Discipline + citation-style breadth + Zotero MCP (5/5) — 2026-06-22

Full detail: [milestones/v0.1.0-ROADMAP.md](milestones/v0.1.0-ROADMAP.md) · [-REQUIREMENTS.md](milestones/v0.1.0-REQUIREMENTS.md) · [-MILESTONE-AUDIT.md](milestones/v0.1.0-MILESTONE-AUDIT.md). Phase dirs: `milestones/v0.1.0-phases/`.

</details>

<details>
<summary>✅ v0.2.0 End-to-End (Phases 11–16) — SHIPPED 2026-06-24</summary>

- [x] Phase 11: Tier-2 LLM transport (4/4) — GEN-01/02/06 — 2026-06-22
- [x] Phase 12: Live research + intake bootstrap + humanizer Task (4/4) — GEN-03/04/05 — 2026-06-22
- [x] Phase 13: Citation rendering at export (2/2) — REND-01/02/03 — 2026-06-24
- [x] Phase 14: Fail-closed verifier gate (4/4) — GATE-01/02/03/04 — 2026-06-24
- [x] Phase 15: Foundation & security hardening (8/8) — HARD-01..06 — 2026-06-24
- [x] Phase 16: CI/DX parity + docs & packaging (4/4) — CI-01/02/03 + DOCS-01/02/03 — 2026-06-24

25/25 requirements satisfied; 3-OS CI green (run 28093018921). Audit: `tech_debt` (accepted — the LIBRARY.json→plan/outline/write context feed carried to v0.3.0). Full detail: [milestones/v0.2.0-ROADMAP.md](milestones/v0.2.0-ROADMAP.md) · [-REQUIREMENTS.md](milestones/v0.2.0-REQUIREMENTS.md) · [-MILESTONE-AUDIT.md](milestones/v0.2.0-MILESTONE-AUDIT.md). Phase dirs: `milestones/v0.2.0-phases/`.

</details>

### 🚧 v0.3.0 Truly End-to-End (Phases 17–19) — in progress

- [ ] **Phase 17: Source→Drafting Feed (FEED)** - Discovered LIBRARY.json sources flow into outline/plan/write prompts, section-isolated by construction and injection-fenced
- [ ] **Phase 18: Security Residuals (SEC)** - DNS-rebind socket-pinning and worker-thread PDF-abort close the two documented `.planning/SECURITY.md` residuals
- [ ] **Phase 19: Integration & Verifier Hardening (HARDEN)** - Strict required e2e CI gate, secrets-gated live-provider lane, and a citation-integrity differential test stand as permanent invariants

## Phase Details

### Phase 17: Source→Drafting Feed (FEED)
**Goal**: The section planner and drafter actually consume the sources `research` discovered — the core "citation-grounded drafting" differentiator becomes real instead of aspirational, and the higher-stakes injection surface this wiring creates is fenced in the same change.
**Depends on**: Nothing (first v0.3.0 phase; builds on the already-shipped v0.2.0 research/LIBRARY.json pipeline)
**Requirements**: FEED-01, FEED-02, FEED-03, FEED-04, FEED-05
**Success Criteria** (what must be TRUE):
  1. Running `outline` on a paper with a populated `LIBRARY.json` produces an OUTLINE.md whose per-section source suggestions are drawn from real discovered sources (title/authors/year/citekey), not a `[]` placeholder — with the outline approval gate still enforced (`--yolo`-only skip)
  2. Running `plan <N>` produces a PLAN.md whose `assigned_sources` frontmatter is a non-empty list of real citekeys that exist in `LIBRARY.json` — the section planner references actual discovered sources, not `(no sources loaded yet…)`
  3. Running `write <N>` produces a DRAFT.md whose `[@citekey]` tokens are a subset of that section's own `assigned_sources` — verified both by construction (the drafter's prompt-building code path cannot reach unfiltered `LIBRARY.json`) and by the existing strict membership check; a 2-section paper with disjoint `assigned_sources` shows zero cross-section citekey bleed
  4. A section with an empty or insufficient assigned-source pool degrades gracefully (a clear WARN/skip path) rather than inventing a placeholder citekey
  5. `section-planner.md` and `section-drafter.md` wrap every injected source abstract/title/author string in the same `PENSMITH_UNTRUSTED_DATA` fence-and-breakout-stripping mechanism Pass 2/4 already use — an adversarial-abstract fixture proves injected instructions do not alter `assigned_sources` or DRAFT.md content
  6. Tier-1 (workflow-body prose) and Tier-2 (`bin/cli/*.ts`) construct the same filtered, fenced prompt payload — `tests/tier-contract.test.ts` (extended) stays green with no drift between tiers
**Plans**: TBD

### Phase 18: Security Residuals (SEC)
**Goal**: The two documented, deliberately-deferred security residuals from `.planning/SECURITY.md` (WR-03 DNS-rebind TOCTOU, WR-05 PDF-parse non-cancellation) are closed with real fixes, not shortcuts that look like fixes.
**Depends on**: Nothing (fully independent of Phase 17/19 — different files, different failure modes; may be built in parallel)
**Requirements**: SEC-01, SEC-02
**Success Criteria** (what must be TRUE):
  1. A request to an untrusted URL is dialed at the socket layer to the exact IP address `checkSsrf()` already validated — a new test proves the validated address is the one actually connected, closing the window where a second, independent DNS lookup could resolve to a different (rebound) address
  2. A real, virtual-hosted HTTPS source (TLS SNI + Host-header dependent) still fetches correctly after the pin lands — the fix preserves the original hostname for SNI/Host rather than substituting the IP into the URL
  3. `maxRedirections` remains unset/zero, and a guard/test fails the build if that ever changes — the single-hop pin isn't silently bypassed by a future redirect-following refactor
  4. Extracting text from a hostile or oversized PDF that exceeds the parse timeout genuinely stops consuming CPU — the worker is terminated (`await worker.terminate()`) rather than merely abandoned by a `Promise.race`, proven by a race-condition test at the exact timeout boundary
  5. A worker that completes successfully at or near the timeout boundary is neither discarded as a false timeout nor left as a zombie process — one-shot settlement across `message`/`error`/timeout is deterministic
**Plans**: TBD

### Phase 19: Integration & Verifier Hardening (HARDEN)
**Goal**: The two systemic themes the 37-finding audit just fixed (router/state-transition correctness, citation-integrity gaps) become standing CI invariants that can't silently regress — hardening on top of the already-merged fixes, not a precondition for them.
**Depends on**: Phase 17 (FEED) — the assigned-sources-population and citekey-containment assertions are only meaningful once real FEED data exists; the CI-job-promotion and router-advance-generalization work has no FEED dependency but lands in this phase for one clean narrative
**Requirements**: HARDEN-01, HARDEN-02, HARDEN-03, HARDEN-04
**Success Criteria** (what must be TRUE):
  1. `scripts/e2e-smoke.mjs` runs as a required CI job that fails the build (non-zero exit) on any regression, with an explicit, reviewed allowlist of which former `[FINDING]`s are now hard `fail()`s — CI does not go red on day one from unrelated pre-existing findings
  2. At every stage of the bare-`pensmith` router chain (research→outline→plan→write→verify→compile→done), the strict gate asserts BOTH artifact existence AND that the router's reported next-action correctly advances — a written artifact that doesn't flip the state the router keys on is caught, not just a missing file
  3. The strict gate asserts FEED's data-flow property end-to-end: each section's `assigned_sources` is a non-empty subset of `LIBRARY.json` citekeys, and each section's DRAFT.md citekeys are a subset of its own `assigned_sources`
  4. A secrets-gated live-provider CI lane exercises real Pass-2/Pass-4 LLM calls, a live Crossref/Retraction-Watch re-query, and the SSRF preflight against real infrastructure, asserting FABRICATED/MIS-CITED/RETRACTED surface correctly end-to-end through verify→compile→done — triggered only by `push`(main)/`workflow_dispatch`, never `pull_request`/`pull_request_target`, and never a required check
  5. The default, secrets-free `PENSMITH_NO_LLM` CI lane stays green and required exactly as before — the live lane is additive and never blocks a PR from a fork
  6. A citation-integrity differential test proves every citekey the exporter renders (including uppercase, locator, multi-cite, and collision-suffixed forms) was seen by Pass-1's broader extraction — a fabricated or silently-dropped citekey can never reach the exported document undetected
  7. A live-path smoke check (in the same non-default lane as HARDEN-02) exercises a real Pandoc export producing a correctly formatted reference, a live PyMuPDF extraction, and one live research-adapter round-trip
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|-----------------|--------|-----------|
| 17. Source→Drafting Feed (FEED) | 0/TBD | Not started | - |
| 18. Security Residuals (SEC) | 0/TBD | Not started | - |
| 19. Integration & Verifier Hardening (HARDEN) | 0/TBD | Not started | - |

| Milestone | Phases | Plans | Status | Shipped |
|-----------|--------|-------|--------|---------|
| v0.1.0 Foundation | 0–10 (11) | 73 | ✅ Complete | 2026-06-22 |
| v0.2.0 End-to-End | 11–16 (6) | 26 | ✅ Complete | 2026-06-24 |
| v0.3.0 Truly End-to-End | 17–19 (3) | TBD | 🚧 In progress | - |

---
*Roadmap initialized: 2026-05-06 from PRD.md*
*v0.1.0 archived 2026-06-22 · v0.2.0 archived 2026-06-24*
*v0.3.0 phases 17–19 added: 2026-07-06*
