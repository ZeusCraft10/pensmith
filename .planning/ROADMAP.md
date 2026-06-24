# Roadmap: pensmith

## Milestones

- ✅ **v0.1.0 Foundation** — Phases 0–10 (shipped 2026-06-22) — full two-tier architecture, Foundation NFRs, the deterministic verifier gate, compile/export pipeline, single-command UX, and the citation/style libraries. Full detail archived in [milestones/v0.1.0-ROADMAP.md](milestones/v0.1.0-ROADMAP.md).
- 🚧 **v0.2.0 End-to-End** — Phases 11–16 — make pensmith produce a submission-ready, sourced, citation-formatted paper end-to-end: Tier-2 LLM transport, live research source discovery, citation rendering at export, fail-closed gate hardening, foundation/security hardening, and CI/DX + docs parity.

## Phases

<details>
<summary>✅ v0.1.0 Foundation (Phases 0–10) — SHIPPED 2026-06-22</summary>

- [x] Phase 0: Repo skeleton & plugin manifest (4/4 plans) — 2026-05-07
- [x] Phase 1: Foundation NFRs (14/14 plans) — 2026-05-14 (VERIFICATION PASS 5/5)
- [x] Phase 2: Tier shells + doctor + tier-contract gate (10/10 plans) — 2026-05-16
- [x] Phase 3: Vertical slice through one section (10/10 plans) — 2026-05-28
- [x] Phase 4: Breadth — N sections + compile + wave scheduling (5/5 plans) — 2026-06-17
- [x] Phase 5: Verifier completeness (Pass 2 + Pass 4) (5/5 plans) — 2026-06-18
- [x] Phase 6: Done / export pipeline + zero-trace gate (5/5 plans) — 2026-06-18
- [x] Phase 7: Single-command UX layer + hooks + flags (4/4 plans) — 2026-06-19
- [x] Phase 8: Style match + sketch + add + library + BYO PDF polish (7/7 plans) — 2026-06-20
- [x] Phase 9: Educator/tutorial mode + PII polish (4/4 plans) — 2026-06-20
- [x] Phase 10: Discipline + citation-style breadth + Zotero MCP (5/5 plans) — 2026-06-22

Full phase goals, success criteria, and per-plan detail are preserved in the archive:
[milestones/v0.1.0-ROADMAP.md](milestones/v0.1.0-ROADMAP.md). Requirements traceability:
[milestones/v0.1.0-REQUIREMENTS.md](milestones/v0.1.0-REQUIREMENTS.md). Milestone audit:
[milestones/v0.1.0-MILESTONE-AUDIT.md](milestones/v0.1.0-MILESTONE-AUDIT.md).

</details>

### v0.2.0 End-to-End (Phases 11–16)

- [x] **Phase 11: Tier-2 LLM transport** — `bin/lib/anthropic.ts` transport chokepoint + six generative verbs wired + fail-loud on missing key (completed 2026-06-22)
- [x] **Phase 12: Live research + intake bootstrap + humanizer Task** — real source candidates from adapters, paper-level STATE.json at intake, Tier-1 humanizer wrap with real before/after score (completed 2026-06-22)
- [ ] **Phase 13: Citation rendering at export** — `[@key]` tokens resolved to formatted in-text citations + bibliography in the paper's CSL style at export time
- [x] **Phase 14: Fail-closed verifier gate** — missing VERIFICATION.md blocks compile, shared verdict render/parse pair, live retraction re-query at verify time, post-humanize re-verification (completed 2026-06-24)
- [ ] **Phase 15: Foundation & security hardening** — lock-key canonicalization, real SSRF guards, recursive PII redaction, secure-phase audit + pdf-parse bounds + prompt-injection delimiting, GPTZero consent gate, FIFO-fair concurrency primitives
- [ ] **Phase 16: CI/DX parity + docs & packaging** — prebuild-first `npm run check`, fresh-clone CI gate, coverage gate, real README + disclaimer, stub workflow bodies filled, packaging cleanup

## Phase Details

### Phase 11: Tier-2 LLM transport

**Goal**: The portable Tier-2 CLI can generate real artifacts — the LLM transport module exists as a single chokepoint, the six generative verbs call it, and the CLI fails loudly when no key is configured.
**Depends on**: Phase 10 (v0.1.0 complete)
**Requirements**: GEN-01, GEN-02, GEN-06
**Success Criteria** (what must be TRUE):

  1. Running any generative verb (`intake`, `research`, `outline`, `plan`, `write`, `revise`) in Tier 2 with a valid key configured produces a real artifact — no more `tier2-placeholder` output.
  2. All LLM calls route through `bin/lib/anthropic.ts` (a single import chokepoint); no key value appears in the session log or stdout.
  3. When no LLM key is configured, each generative verb prints a clear error banner and exits with a non-zero code — it never silently returns `ok:true` with an empty result.
  4. The transport is budget-gated: `assertBudget` is called before every LLM call and the hard cost cap is respected.

**Plans**: 4 plans

Plans:

- [x] 11-01-PLAN.md — Wave-0 RED-by-skip transport test scaffold (chokepoint, no-leak, budget-gate, fail-loud, offline seam, provider shapes)
- [x] 11-02-PLAN.md — bin/lib/anthropic.ts transport chokepoint (provider dispatch, budget gate, http.ts POST, no-leak)
- [x] 11-03-PLAN.md — wire intake + outline + write to complete() with fail-loud on missing key
- [x] 11-04-PLAN.md — wire research + plan + revise (shared proposeSwap) with fail-loud; research defensive parse

**UI hint**: no

### Phase 12: Live research + intake bootstrap + humanizer Task

**Goal**: `pensmith research` discovers real source candidates; intake writes a proper STATE.json + paperId so the full paper-level flow runs without WARN-skipping; and the Tier-1 humanizer wrap produces a real before/after honesty score.
**Depends on**: Phase 11
**Requirements**: GEN-03, GEN-04, GEN-05
**Success Criteria** (what must be TRUE):

  1. `pensmith research` queries the registered adapters and returns at least one real deduplicated candidate with a retraction check — the zero-candidate placeholder library is gone.
  2. `pensmith intake` writes `STATE.json` with a `paperId` so that global-library registration and style-match proceed in the real flow without WARN-skipping.
  3. In Tier 1, the humanizer wrap calls the humanizer skill via Task and records a real before/after GPTZero honesty score; when the skill is absent it prints a clear skip banner and continues.

**Plans**: 4 plans

Plans:

- [x] 12-01-PLAN.md — Wave-0 RED-by-skip scaffolds (research-discovery, intake-bootstrap, humanizer-task; fileURLToPath spaced-path safe; offline cassettes + PENSMITH_NO_LLM + injected TaskRunner)
- [x] 12-02-PLAN.md — GEN-03 live research: extract research-orchestrator (adapter fan-out + DOI/title dedup + source-evaluator), wire INTAKE.md vars + approval gates, replace research.ts swap-seam, preserve D-15 ordering
- [x] 12-03-PLAN.md — GEN-04 intake bootstrap: idempotent initState(paperDir(cwd)) before runSideEffects so resolvePaperId is non-null and the WARN-skip guards flip active
- [x] 12-04-PLAN.md — GEN-05 humanizer Task: injectable __setTaskRunnerForTest seam, Tier-1 Task invocation -> .paper/FINAL.md, null-runner clean skip; locked honest framing preserved

**UI hint**: no

### Phase 13: Citation rendering at export

**Goal**: Exports resolve `[@key]` citation tokens into formatted in-text citations and include a rendered bibliography in the paper's discipline style — no literal `[@key]` tokens escape to the final document.
**Depends on**: Phase 10 (REND is self-contained at the exporter boundary; can run in parallel with Phases 11–12, but sequenced here after the generative unlock for testability)
**Requirements**: REND-01, REND-02, REND-03
**Success Criteria** (what must be TRUE):

  1. An exported `.docx`, `.pdf`, `.tex`, or `.md` contains formatted in-text citations (e.g. "(Vaswani et al., 2017)") in place of every `[@key]` token.
  2. Every export includes a formatted bibliography / reference list in the paper's selected CSL style, rendered via `--citeproc --csl --bibliography`.
  3. An automated exporter test asserts a formatted author-year or numeric reference appears in the output — not merely that a `.bib`/`.ris` sidecar was copied.

**Plans**: 2 plans

- [x] 13-01-PLAN.md — Wave 0: RED-by-skip exporter-citation scaffold (offline REND-01/02/03 assertions on the known-good fixture + Pandoc-args/ordering + zero-trace guards)
- [ ] 13-02-PLAN.md — Wave 1: wire renderInText (citations.ts) + resolveAndRenderCitations/citeproc args/bib-reorder (exporter.ts) + discipline→style (done.ts)

**UI hint**: no

### Phase 14: Fail-closed verifier gate

**Goal**: The verifier gate is truly fail-closed end-to-end: a missing or unreadable `VERIFICATION.md` blocks compile, the verdict format is round-trip-safe, live retraction hits escalate to blocking at verify time, and humanized output is re-verified before export.
**Depends on**: Phase 12
**Requirements**: GATE-01, GATE-02, GATE-03, GATE-04
**Success Criteria** (what must be TRUE):

  1. `pensmith compile` refuses when any section's `VERIFICATION.md` is absent or contains no parseable status verdict — a never-verified section can never compile.
  2. A round-trip test asserts that the verdict-row writer and parser agree: writing a set of blocking citekeys through the shared render+parse pair and reading them back yields an identical set (writer drift cannot silently yield zero blocking keys).
  3. When `pensmith verify <N>` encounters a DOI that is live-retracted on Retraction Watch, it escalates that citation to MIS-CITED (blocking in Pass 1), not merely a freshness WARN.
  4. Running `pensmith done` re-checks `FINAL.md` (Pass-3 re-fetch + citekey-set diff) before export; if humanization altered or introduced a citation the re-check fails and export is blocked.

**Plans**: 4 plans

- [x] 14-01-PLAN.md — Wave 1: RED-by-skip scaffolds for all four gates (verdict-rows round-trip + compile-refuse GATE-01 + gate-retraction GATE-03 + done-recheck GATE-04) + the GATE-03 blocking cassette
- [x] 14-02-PLAN.md — Wave 2: GATE-01 + GATE-02 — shared verdict-rows.ts render+parse pair, compile.ts hasStatus fail-closed guard + parseVerdictRows wiring, verify.ts writer delegation (output byte-unchanged)
- [x] 14-03-PLAN.md — Wave 2: GATE-03 — live Retraction Watch re-query in pass1.ts verdictForCitekey (blocking on confirmed hit, silent on transport error)
- [x] 14-04-PLAN.md — Wave 2: GATE-04 — reCheckFinalMd (citekey-set diff + Pass-3) hard-blocks export in done.ts before runDoneGate

**UI hint**: no

### Phase 15: Foundation & security hardening

**Goal**: All six foundation/security gaps from the 2026-06-22 review are closed: lock-key collisions fixed, real SSRF guards in the HTTP chokepoint, recursive PII scrubbing before log writes, a per-phase security audit with pdf-parse bounds and prompt-injection delimiting, GPTZero consent gate, and FIFO-fair concurrency primitives.
**Depends on**: Phase 11 (HARD-06 concurrency fairness is most relevant once real LLM calls exist; HARD-01..05 can run in parallel with Phases 11–14 but are sequenced here for clean wave scheduling)
**Requirements**: HARD-01, HARD-02, HARD-03, HARD-04, HARD-05, HARD-06
**Success Criteria** (what must be TRUE):

  1. Two callers targeting the same file via different path conventions (relative vs absolute, symlinked) acquire the same lock — a test asserts lock-key collision is impossible after `path.resolve` + `realpath` canonicalization.
  2. `http.ts` rejects any request to an RFC1918 / loopback / link-local address (DNS-resolved) and any non-`https:` scheme — a test asserts the SSRF guard fires before any network byte is sent.
  3. A nested-object PII fixture (e.g. `{ user: { email: "..." } }`) is fully redacted before any `SESSION.log` write — top-level-only redaction is no longer sufficient.
  4. A per-phase `SECURITY.md` marks each threat PROVEN or UNPROVEN against a test; `pdf-parse` input is size-capped and wall-clock-bounded; advisory Pass-2/Pass-4 prompts wrap untrusted text in fenced delimiters.
  5. Before `pensmith done` POSTs the paper body to GPTZero, the user sees a disclosure (external service, full-text transmission) and must confirm — this consent gate is skippable only with `--yolo`.

**Plans**: 8 plans (4 waves)

- [ ] 15-01-PLAN.md — Wave 1: RED-by-skip scaffolds for all six HARD items (SSRF / TokenBucket-FIFO / PDF-bounds / Pass-2/4 fence / lock-canon / deep-PII / GPTZero-consent; fileURLToPath spaced-path safe; injected resolver + deterministic timers)
- [ ] 15-02-PLAN.md — Wave 2: HARD-02 SSRF guard (checkSsrf DNS-preflight + redirect re-check) + HARD-06 FIFO TokenBucket — both in http.ts (one plan, no parallel same-file edits)
- [ ] 15-03-PLAN.md — Wave 2: HARD-01 lock.ts stubFor canonicalization (resolve + realpath + win32 case-fold) + compile.ts 'compile:' de-prefix
- [ ] 15-04-PLAN.md — Wave 2: HARD-03 pii.ts deepRedactPii + session-log.ts buildRecord recursive string-leaf redaction before write
- [ ] 15-05-PLAN.md — Wave 2: HARD-04b pdf-text.ts byte cap + Promise.race wall-clock timeout around the pdf-parse call
- [ ] 15-06-PLAN.md — Wave 2: HARD-04c Pass-2/Pass-4 prompt-injection fencing + WN-3 lockstep re-pin (repo-files.test.ts + prompt-loader.ts)
- [ ] 15-07-PLAN.md — Wave 3: HARD-05 GPTZero disclosure + consent gate + size cap (honesty.ts) + honesty-framing.md disclosure + standalone re-pin
- [ ] 15-08-PLAN.md — Wave 4: HARD-06 Semaphore bare-caller try/finally doc + HARD-04a .planning/SECURITY.md milestone audit (authored last, cites each enforcing test)

**UI hint**: no

### Phase 16: CI/DX parity + docs & packaging

**Goal**: A developer can run `npm run check` locally and trust the result matches CI exactly; the fresh-clone CI job catches stale derived files; the real README ships with install + quickstart + PRD §3 disclaimer; stub workflow bodies are filled; and packaging is clean.
**Depends on**: Phase 15
**Requirements**: CI-01, CI-02, CI-03, DOCS-01, DOCS-02, DOCS-03
**Success Criteria** (what must be TRUE):

  1. `npm run check` runs `prebuild` first; a developer who sees green locally will not encounter a red CI run caused by stale derived artifacts.
  2. The CI pipeline includes a fresh-clone job that runs the full build, then asserts `git status --porcelain` is empty — any stale derived-file drift causes CI to fail.
  3. CI runs the test suite with non-TTY / detached stdin and enforces a `c8` coverage gate, so flaky TTY-dependent tests and coverage regressions are caught automatically.
  4. The README ships real install instructions, the `/pensmith` quickstart, and the PRD §3 dual-use disclaimer verbatim; the disclaimer also surfaces at intake.
  5. The four stub workflow bodies (doctor, status, next, resume) are filled with real `## Body` content and accurate `<capability_check>` blocks; stale "Phase 3+ / ships in Phase 6" copy in doctor probes, PRIVACY.md, and CONTRIBUTING.md is updated to reflect shipped reality.

**Plans**: TBD
**UI hint**: no

## Progress

**v0.1.0 Foundation — shipped 2026-06-22 (11 phases, 73 plans, 126 tasks, 100%)**
**v0.2.0 End-to-End — in progress**

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 0. Repo skeleton & plugin manifest | v0.1.0 | 4/4 | Complete | 2026-05-07 |
| 1. Foundation NFRs | v0.1.0 | 14/14 | Complete | 2026-05-14 |
| 2. Tier shells + doctor + tier-contract gate | v0.1.0 | 10/10 | Complete | 2026-05-16 |
| 3. Vertical slice through one section | v0.1.0 | 10/10 | Complete | 2026-05-28 |
| 4. Breadth — N sections + compile + wave scheduling | v0.1.0 | 5/5 | Complete | 2026-06-17 |
| 5. Verifier completeness (Pass 2 + Pass 4) | v0.1.0 | 5/5 | Complete | 2026-06-18 |
| 6. Done / export pipeline + zero-trace gate | v0.1.0 | 5/5 | Complete | 2026-06-18 |
| 7. Single-command UX layer + hooks + flags | v0.1.0 | 4/4 | Complete | 2026-06-19 |
| 8. Style match + sketch + add + library + BYO PDF polish | v0.1.0 | 7/7 | Complete | 2026-06-20 |
| 9. Educator/tutorial mode + PII polish | v0.1.0 | 4/4 | Complete | 2026-06-20 |
| 10. Discipline + citation-style breadth + Zotero MCP | v0.1.0 | 5/5 | Complete | 2026-06-22 |
| 11. Tier-2 LLM transport | v0.2.0 | 4/4 | Complete   | 2026-06-22 |
| 12. Live research + intake bootstrap + humanizer Task | v0.2.0 | 4/4 | Complete   | 2026-06-22 |
| 13. Citation rendering at export | v0.2.0 | 1/2 | In Progress|  |
| 14. Fail-closed verifier gate | v0.2.0 | 4/4 | Complete   | 2026-06-24 |
| 15. Foundation & security hardening | v0.2.0 | 0/8 | Not started | - |
| 16. CI/DX parity + docs & packaging | v0.2.0 | 0/TBD | Not started | - |

---
*Roadmap initialized: 2026-05-06 from PRD.md + research/SUMMARY.md (auto mode)*
*v0.1.0 Foundation milestone archived: 2026-06-22*
*v0.2.0 End-to-End roadmap created: 2026-06-22 (Phases 11–16, 25 requirements)*
