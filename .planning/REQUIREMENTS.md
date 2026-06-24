# Requirements: pensmith — v0.2.0 End-to-End

**Defined:** 2026-06-22
**Core Value:** Every citation in every exported paper is real and supports the claim it's attached to — verified by re-fetching the live DOI/quote. The verifier blocks compile and export; no FABRICATED, MIS-CITED, or quote-NOT_FOUND ever escapes.

> **Milestone theme:** Make pensmith produce a submission-ready, sourced, citation-formatted paper end-to-end. v0.1.0 shipped the architecture and the verifier gate; v0.2.0 connects the generative seams (Tier-2 transport, live research, citation-at-export), makes the gate fail-closed end-to-end, and hardens security + CI. Scope = the 2026-06-22 improvement-review backlog.

## v1 Requirements

Requirements for the v0.2.0 release. Each maps to exactly one roadmap phase.

### Generative pipeline (GEN) — the unlock

- [x] **GEN-01**: A Tier-2 LLM transport module (`bin/lib/anthropic.ts`) is the single chokepoint for LLM calls against an Anthropic / OpenAI-compatible endpoint — streaming, budget-gated via `assertBudget`, key resolved from runtime config, no key value logged
- [x] **GEN-02**: The six generative verbs (intake, research, outline, plan, write, revise) call the transport and produce real artifacts in Tier 2 when a key is configured (no more `tier2-placeholder` output)
- [x] **GEN-03**: `pensmith research` discovers real source candidates by querying the registered adapters, dedupes them, and runs the retraction cross-check — replacing the hardcoded zero-candidate placeholder library
- [x] **GEN-04**: Intake bootstraps a paper-level STATE.json + paperId so global-library registration and style-match run in the real flow instead of WARN-skipping
- [x] **GEN-05**: The Tier-1 humanizer wrap invokes the humanizer skill via Task and records a real before/after honesty score, skipping cleanly with a banner when the skill is absent
- [x] **GEN-06**: When no LLM key is configured, the generative verbs fail loud (clear banner + explicit non-success signal) instead of returning `ok:true` with an empty library

### Citation rendering at export (REND)

- [x] **REND-01**: Exports resolve `[@key]` tokens into formatted in-text citations in the paper's discipline citation style
- [x] **REND-02**: Exports include a rendered bibliography / reference list in the selected CSL style (Pandoc `--citeproc --csl --bibliography`)
- [x] **REND-03**: An exporter test asserts a *formatted* reference appears in output (e.g. "Vaswani et al."), not merely a copied `.bib`/`.ris` sidecar

### Fail-closed verifier gate (GATE)

- [x] **GATE-01**: Compile refuses when a section's `VERIFICATION.md` is missing or has no parseable status (fail-closed — a never-verified section can never compile)
- [x] **GATE-02**: The refuse-gate verdict rows are produced and parsed by a shared render+parse pair, guarded by a writer→parser round-trip test (writer drift cannot silently yield zero blocking citekeys)
- [x] **GATE-03**: Verification re-queries Retraction Watch on the resolved DOI at verify time and escalates a live retraction hit to MIS-CITED (blocking), not only via the WARN-only freshness channel
- [ ] **GATE-04**: The humanized `FINAL.md` is re-checked (deterministic Pass-3 + citekey-set diff) before export, so humanization cannot introduce an unverified or altered citation

### Foundation & security hardening (HARD)

- [x] **HARD-01**: Lock keys are canonicalized (resolve + realpath, case-normalized on win32) before hashing, so two callers targeting the same file always acquire the same lock
- [x] **HARD-02**: `http.ts` enforces SSRF guards — scheme allowlist + DNS-resolved RFC1918 / loopback / link-local block — on `add <url>`, fetched DOIs, and the DuckDuckGo path
- [x] **HARD-03**: PII redaction recurses into nested string leaves before any `SESSION.log` write (not only top-level keys)
- [x] **HARD-04**: A secure-phase audit produces a per-phase SECURITY.md marking each threat PROVEN/UNPROVEN against a test; `pdf-parse` is pinned/replaced with input size + wall-clock bounds; advisory Pass-2/Pass-4 prompts wrap untrusted source/draft text in fenced delimiters
- [x] **HARD-05**: The GPTZero honesty check discloses (and size-caps + consent-gates) that it POSTs the full paper body to an external service
- [x] **HARD-06**: The `TokenBucket` / `Semaphore` concurrency primitives are FIFO-fair (no slot leak) so concurrent paid LLM calls respect the configured `--max-parallel` cap

### CI / DX parity (CI)

- [x] **CI-01**: `npm run check` mirrors CI exactly (prebuild-first), so a green local run implies a green CI run
- [x] **CI-02**: A fresh-clone CI job asserts `git status --porcelain` is clean after build, catching stale derived-file drift
- [x] **CI-03**: CI runs the suite under non-TTY / detached stdin and adds a coverage gate (c8 thresholds)

### Docs & packaging (DOCS)

- [ ] **DOCS-01**: README ships real install instructions + `/pensmith` quick start + the PRD §3 dual-use disclaimer; the §3 disclaimer also surfaces at intake
- [ ] **DOCS-02**: The four stub workflow bodies (doctor/status/next/resume) are filled, and stale "Phase 3+ / ships in Phase 6" copy in the doctor probes, PRIVACY.md, and CONTRIBUTING.md is refreshed to shipped reality
- [x] **DOCS-03**: Test-only dependencies (e.g. `nock`) move out of `dependencies`; `http-mock.ts` is excluded from the shipped `dist/` tree

## v2 Requirements

Acknowledged from the review backlog but deferred beyond v0.2.0 (breadth that doesn't gate end-to-end usability). Tracked, not in the current roadmap.

### Research & sources breadth (RDUP / FIG)

- **RDUP-01**: Reference dedup/merge across BYO PDF / `add` / Zotero / live search (DOI-normalize then author+title+year fuzzy)
- **FIG-01**: Figure/table/caption handling across plan → write → compile → export (passthrough + cross-section-stable caption numbering)

### Resume & verification breadth (RES / UVQ)

- **RES-01**: Partial-draft / mid-section resume from the last checkpoint instead of restarting a long section (SC-12)
- **UVQ-01**: Surface PDF_UNAVAILABLE / TEXT_UNAVAILABLE quotes as a 4th DONE-09 advisory bucket requiring conscious confirmation

### Test & discoverability breadth (LIVE / REF)

- **LIVE-01**: Periodic live-path smoke CI job (real Pandoc export asserting a formatted ref; live pymupdf extraction; one live adapter round-trip)
- **REF-01**: Discoverable verb + global-flag reference card (16 verbs, 4 flags; document the `--yolo` 50%-cap HARD-refuse)
- **FLAG-01**: Pay down the 13 deferred Phase-1 Foundation findings (stale singleton logger, module-global log chain, spilled_to separator, diacritic codepoints)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cross-paper "literature comparison" mode | Scope creep beyond the current direction (carried from v0.1.0 out-of-scope) |
| Multi-author / collaboration | Local single-user tool |
| Cloud-hosted state / telemetry | Local-only is a core constraint |
| Paid plagiarism / detection-evasion services | Free distinctive-phrase check only; honest framing constraint |
| Making exports "undetectable" | Honest-framing non-negotiable — the humanizer improves prose, it does not evade detection |
| Exported-document metadata / footer / pensmith trace | Deliberate zero-trace user choice; README disclaimer is the only disclosure |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| GEN-01 | Phase 11 | Complete |
| GEN-02 | Phase 11 | Complete |
| GEN-03 | Phase 12 | Complete |
| GEN-04 | Phase 12 | Complete |
| GEN-05 | Phase 12 | Complete |
| GEN-06 | Phase 11 | Complete |
| REND-01 | Phase 13 | Complete |
| REND-02 | Phase 13 | Complete |
| REND-03 | Phase 13 | Complete |
| GATE-01 | Phase 14 | Complete |
| GATE-02 | Phase 14 | Complete |
| GATE-03 | Phase 14 | Complete |
| GATE-04 | Phase 14 | Pending |
| HARD-01 | Phase 15 | Complete |
| HARD-02 | Phase 15 | Complete |
| HARD-03 | Phase 15 | Complete |
| HARD-04 | Phase 15 | Complete |
| HARD-05 | Phase 15 | Complete |
| HARD-06 | Phase 15 | Complete |
| CI-01 | Phase 16 | Complete |
| CI-02 | Phase 16 | Complete |
| CI-03 | Phase 16 | Complete |
| DOCS-01 | Phase 16 | Pending |
| DOCS-02 | Phase 16 | Pending |
| DOCS-03 | Phase 16 | Complete |

**Coverage:**

- v1 requirements: 25 total
- Mapped to phases: 25 ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-22 (from the 2026-06-22 improvement-review backlog)*
*Last updated: 2026-06-22 — traceability filled after roadmap creation (Phases 11–16)*
