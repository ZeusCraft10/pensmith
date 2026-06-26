# pensmith

## What This Is

`pensmith` is a structured research-and-drafting assistant for academic papers. It runs an opinionated workflow — intake → research → outline → for each section { plan → write → verify } → compile → done — using only verifiable peer-reviewed and configurable academic sources, and ships in two tiers from one source of truth: a Claude Code plugin (Tier 1, with parallel subagents and MCP-backed state) and a portable Node CLI (Tier 2, against any OpenAI-compatible endpoint). It's for students, grad students, and researchers who already use LLMs for academic writing and want a structured workflow that pulls from real citable sources, verifies every citation against the live source, and doesn't pollute their writing with obvious AI tells.

## Core Value

Every citation in every exported paper is real and supports the claim it's attached to — verified by re-fetching the live DOI/quote. The verifier blocks compile and export; no FABRICATED, MIS-CITED, or quote-NOT_FOUND ever escapes.

> **Still the right priority after v0.1.0.** Shipping the full architecture confirmed the section-as-phase / bounded-verifier model is the load-bearing idea. The v0.2.0 work doesn't change the core value — it makes the generative pipeline that *feeds* the verifier actually run end-to-end (Tier-2 transport, live source discovery, citations rendered at export).

## Requirements

### Validated

<!-- Shipped in v0.1.0 and confirmed working (tests green, 3-OS CI green). -->

**Architecture & foundation** — all proved out and unit-tested:
- ✓ Two-tier source-of-truth: workflow bodies + templates shared between Tier 1 plugin and Tier 2 CLI, drift-gated by `tests/tier-contract.test.ts` — v0.1.0
- ✓ Section-as-phase directory layout (`.paper/sections/<NN-slug>/{PLAN,DRAFT,VERIFICATION}.md`) with mtime-proven isolation — v0.1.0
- ✓ `<capability_check>` blocks in every workflow body (Task / MCP / AskUserQuestion / Pandoc / Zotero / humanizer) — v0.1.0
- ✓ HANDOFF.json (section-granular, <5KB) + atomic write-then-rename chokepoint (`bin/lib/atomic-write.ts`, D-07) — v0.1.0
- ✓ Concurrent-run lock (`bin/lib/lock.ts`, proper-lockfile) with stale-lock auto-clear — v0.1.0 *(see v0.2.0: lock-key canonicalization hardening)*
- ✓ Schema versioning + migrations from day one (state v1→v2 shipped) — v0.1.0
- ✓ Cross-platform paths (Windows %LOCALAPPDATA%, macOS Application Support, Linux XDG) via sole-call-site `paths.ts` (D-41) — v0.1.0
- ✓ Hard cost cap with pre-call `assertBudget` gate + cost ledger — v0.1.0
- ✓ HTTP client (`bin/lib/http.ts` chokepoint, D-06): undici, per-source TokenBucket, full-jitter retry, TTL cache, polite UA WARN — v0.1.0
- ✓ Replayable session log (JSONL) + `--show-prompts` — v0.1.0

**Single-command UX & ergonomics**:
- ✓ Bare `/pensmith` state-aware router; 16 locked verbs (bijective with 16 workflow bodies); hidden plumbing namespace; NL triggers; inline corrections — v0.1.0
- ✓ Global flags: `--dry-run` (cassette-only), `--estimate` (tokens+USD, 50%-cap refusal), `--yolo` (default off), `--show-prompts` — v0.1.0
- ✓ `/pensmith doctor` (10 probes: OneDrive/iCloud/Dropbox/GDrive sync detection, Pandoc, Zotero MCP auth, humanizer skill, contact-email WARN) — v0.1.0

**Verifier (the gate)** — deterministic + blocking:
- ✓ Pass 1: DOI/arXiv/PMID integrity re-fetch (404 → FABRICATED) + author/title/year fuzzy match (→ MIS-CITED) — v0.1.0
- ✓ Pass 3: quotation verification against OA full text (PASS/NOT_FOUND/FUZZY) — v0.1.0
- ✓ Section marked `verified` only when Pass 1 + Pass 3 clean; Pass 2 (claim support) + Pass 4 (orphan audit) advisory only — v0.1.0
- ✓ DOI/arXiv/PMID normalization (`bin/lib/doi.ts`, D-07) with idempotence property test — v0.1.0
- ✓ Compile refuse-gate (FABRICATED/MIS-CITED/NOT_FOUND blocks compile), outline-order concat, read-only cross-section smoothing, consistency flags, density check — v0.1.0
- ✓ `verified_against_draft_hash` compile-staleness flagging — v0.1.0

**Export**:
- ✓ Zero-trace export — verified by test across `.docx`/`.pdf`/`.tex`/`.md` (zero "pensmith" occurrences, incl. ZIP entries + PDF metadata) — v0.1.0
- ✓ Free distinctive-phrase plagiarism check (DuckDuckGo HTML, advisory) — v0.1.0
- ✓ GPTZero honesty score before/after, framing rendered verbatim from a locked copy — v0.1.0
- ✓ DONE-09 export confirmation gate (per-issue summary; only `--yolo` skips) — v0.1.0
- ✓ Pandoc export with md-only fallback; `.bib` + `.ris` sidecar bundle — v0.1.0

**Differentiated / breadth**:
- ✓ Library mode: `list` / `open`, class grouping, derive-at-display status lifecycle — v0.1.0
- ✓ Style-match opt-in: per-paper `.paper/STYLE.json` only (no global cache), fingerprint reuse surfaced unconditionally, dual-use disclosure — v0.1.0
- ✓ Educator/tutorial mode (`goal=learning`) as observer/wrapper (zero `if(educator_mode)` branches) — v0.1.0
- ✓ PII redaction polish (IP/IBAN/NAME) running before any LLM call, deterministic diff — v0.1.0
- ✓ 8-style CSL rendering library (APA/MLA/Chicago×2/IEEE/AMA/Vancouver/Harvard) + RIS writer — v0.1.0 *(see v0.2.0: not yet applied at export)*
- ✓ Zotero MCP source adapter (absence non-breaking) + tri-state doctor probe (no key leak) — v0.1.0
- ✓ BYO PDF ingestion (`pdf-parse` pinned + `pymupdf` shellout fallback) — v0.1.0

**Resume / hooks (Tier 1)**:
- ✓ PreCompact HANDOFF (10s race), SessionStart auto-resume, PostToolUse checkpoint (≤1/min), Stop lock-release + log-flush (allSettled) — v0.1.0

**Testing & determinism**:
- ✓ `known-bad-citations.json` (10/10 FABRICATED), `known-bad-quotes.json` (10/10 NOT_FOUND), tier-contract cases, offline cassettes, full Foundation unit suite — 3-OS CI green — v0.1.0

**v0.2.0 End-to-End** — shipped + verified (25/25 reqs, 3-OS CI green):
- ✓ Tier-2 LLM transport (`bin/lib/anthropic.ts`) — single chokepoint; all 6 generative verbs call it; fail-loud on missing key; budget-gated; no key leak; all LLM I/O via `http.ts` — v0.2.0 (GEN-01/02/06)
- ✓ Live research source discovery in `pensmith research` (adapter fan-out + DOI/title dedup + source-evaluator + retraction cross-check → real LIBRARY.json) — v0.2.0 (GEN-03)
- ✓ Intake paper-level STATE.json/paperId bootstrap (library registration + style-match now run, no WARN-skip) — v0.2.0 (GEN-04)
- ✓ Tier-1 humanizer Task seam (injectable; real before/after honesty score; clean skip when absent) — v0.2.0 (GEN-05)
- ✓ Citation rendering at export: `[@key]` → formatted in-text cites + bibliography in the paper's CSL style (Pandoc citeproc + offline citation-js path; zero-trace preserved) — v0.2.0 (REND-01/02/03)
- ✓ Fail-closed verifier gate: missing-VERIFICATION refuse, shared verdict render/parse pair + round-trip test, blocking live retraction re-query, post-humanize FINAL.md re-verify (unconditional — no `--yolo` escape) — v0.2.0 (GATE-01/02/03/04)
- ✓ Security hardening: lock-key canonicalization, real SSRF guards (DNS-resolved private-range block), recursive PII redaction, pdf-parse input bounds, Pass-2/4 prompt fencing, GPTZero consent gate, FIFO TokenBucket, + `.planning/SECURITY.md` audit — v0.2.0 (HARD-01..06)
- ✓ CI/DX parity: prebuild-first `npm run check`, fresh-clone porcelain gate, coverage gate, non-TTY stdin run, real README + §3 disclaimer at intake, filled workflow bodies, nock→devDep — v0.2.0 (CI/DOCS)

### Active

<!-- v0.3.0 scope. Carried forward from the v0.2.0 audit (tech_debt) + the v2/Future backlog. -->

**Make the pipeline truly end-to-end (the v0.2.0 carried-forward headline):**
- [ ] Feed discovered `LIBRARY.json` sources into the plan/outline/write prompts — research discovers sources (GEN-03 ✓) but the section planner/writer still receive placeholder context, so a full-pipeline paper's planner is blind to the sourced research
- [ ] Live-path smoke CI (real Pandoc export asserting a formatted ref; live pymupdf extraction; one live adapter round-trip)

**Breadth (v2/Future from the 2026-06-22 review):**
- [ ] Reference dedup/merge across BYO/add/Zotero/live-search; figure/table/caption handling; partial-draft/mid-section resume; unverifiable-quote 4th DONE-09 advisory bucket; verb/flag reference card; pay down the 13 deferred Phase-1 Foundation FLAGs

**Security residuals (documented in `.planning/SECURITY.md`):**
- [ ] DNS-rebind socket-pinning (undici connect callback) for the SSRF guard (WR-03); worker-thread PDF-parse abort on timeout (WR-05)

### Out of Scope

- Inline LaTeX equation rendering — export to `.tex`; user runs LaTeX themselves
- Paywalled full-text parsing — only legitimate OA via Unpaywall, arXiv, PubMed Central
- Automatic Turnitin/GPTZero submission for certification — score for honesty display only
- Cross-paper "literature comparison" mode — scope creep beyond the current direction
- Multi-author / collaboration features — local single-user tool
- Cloud-hosted state — everything is local-only
- Paid plagiarism services — free distinctive-phrase check only
- Voice/speech UI — text-only
- Per-section research as primary mode — research is whole-paper upfront; sections request additions via `plan <N> --research <query>`
- Metadata stamp / visible footer / any pensmith trace in exported documents — explicit user-facing choice; README disclaimer is the only disclosure mechanism

## Current State

**Shipped: v0.2.0 End-to-End (2026-06-24).** Two milestones complete (v0.1.0 Foundation + v0.2.0 End-to-End): 17 phases, 99 plans, ~966 tests, 3-OS CI matrix (ubuntu/macos/windows × Node 20.18) GREEN on `origin/main` (run 28093018921). Repo: github.com/ZeusCraft10/pensmith.

The generative seams the Foundation milestone scaffolded are now connected: the Tier-2 LLM transport exists and the six verbs call it; `research` discovers real sources via the adapters; exports render formatted citations + a bibliography; the verifier gate is fail-closed end-to-end (incl. post-humanize re-verify); and the security/CI hardening landed (SSRF, recursive PII, lock-key canon, prompt fencing, GPTZero consent, porcelain + coverage CI gates).

**Known limitation (v0.2.0 audit `tech_debt`, carried to v0.3.0):** the discovered `LIBRARY.json` sources don't yet flow into the plan/outline/write prompts — so a paper run through the *full* pipeline has its section planner/writer blind to the sourced research. The verbs generate real artifacts; they just don't yet consume the discovered candidates. This is the v0.3.0 headline.

**Tech stack:** Node ≥20.10, TypeScript (NodeNext, strict), undici, proper-lockfile, citation-js, pdf-parse/pdf-lib, jszip, Pandoc (optional shellout), MCP SDK, c8 coverage. Live LLM via `bin/lib/anthropic.ts` (Anthropic/OpenAI-compatible, through `http.ts`). Knowledge graph: gitignored, rebuild via `/gsd:graphify build`.

## Next Milestone Goals (v0.3.0)

**Goal:** Make the pipeline *truly* end-to-end — close the v0.2.0 carried-forward gap so the discovered research actually informs drafting.

- **Wire `LIBRARY.json` → plan/outline/write prompts** (the tech-debt headline): the section planner + drafter receive the discovered/assigned sources, not placeholder context.
- **Live-path smoke CI** (real Pandoc/pymupdf/one live adapter round-trip) so the manual-only verifications get automated coverage.
- **v2/Future breadth:** reference dedup, figure/table/caption handling, partial-draft resume, unverifiable-quote advisory bucket, verb reference card, Phase-1 FLAG paydown.
- **Security residuals:** DNS-rebind socket-pinning (WR-03), worker-thread PDF abort (WR-05).

## Context

**Inspiration:** Architecturally modeled on [Get Shit Done](https://github.com/gsd-build/get-shit-done) by TÂCHES and the [gsd-plugin](https://github.com/jnuyens/gsd-plugin) repackaging by Jasper Nuyens. The skill / agent / MCP / workflow-body / HANDOFF.json patterns are theirs; pensmith adapts (not copies) them to academic writing. Required README credit per PRD §18.

**Load-bearing mental model:** A paper is a project, a section is a phase, the outline is the roadmap, compile is milestone completion, done is ship. State isolation is enforced by directory structure (`.paper/sections/<N>/`), not careful prompting. Re-doing section 3 never disturbs sections 1, 2, 4, 5. The verifier runs bounded per-section (~20–40 LLM calls instead of ~200 across the whole paper). **This proved out across all 11 v0.1.0 phases** — re-doing a section never touched its siblings, and the per-section verifier stayed bounded.

**Two-tier requirement:** Both Claude Code plugin (Tier 1, parallel subagents + MCP) and portable Node CLI (Tier 2, sequential, OpenAI-compatible endpoint) must work. Workflow bodies and templates are the shared source of truth. `tests/tier-contract.test.ts` gates drift. *(v0.1.0 caveat: Tier-2's generative path is a placeholder until the v0.2.0 LLM transport lands.)*

**External APIs (all free, no keys for basics):** OpenAlex, Crossref, arXiv, PubMed, Semantic Scholar, Unpaywall, GPTZero (free tier), Retraction Watch, DuckDuckGo HTML. Polite User-Agent with `PENSMITH_CONTACT_EMAIL`.

**Ecosystem composition:** Probes for and adapts to Zotero MCP (with auth check), Pandoc, and the user's installed `humanizer` skill at `~/.claude/skills/humanizer/`.

## Constraints

- **License**: AGPL-3.0-or-later — copyleft, open-source from day one
- **Two-tier**: Both Tier 1 and Tier 2 must work from the same workflow files. Non-negotiable.
- **Single-command UX**: README quick start teaches `/pensmith` and only `/pensmith`. Verbs are power-user fallback.
- **Verifier gates compile and export**: No FABRICATED, MIS-CITED, or quote-NOT_FOUND ever escapes a section. Author/title fuzzy match is part of Pass 1, not optional.
- **No exported-document trace**: Zero metadata stamp, zero footer, zero pensmith fingerprint in exported docs. Explicit user choice.
- **Honest framing on detection**: GPTZero score is transparency, never "we make it undetectable." Humanizer "improves prose."
- **Approval gates default-on**: Outline approval and export confirmation only skip with `--yolo`.
- **Local-only state**: No cloud, no telemetry. Documented in PRIVACY.md.
- **No paywall bypass**: Full-text only via legitimate OA channels.
- **Hard cost cap**: `cost_cap_usd` default $5/session aborts overruns.
- **Cross-platform paths**: Windows / macOS / Linux all resolve the data dir via `bin/lib/paths.ts`.
- **Schema versioning from day one**: Every state file has a schema version; migrations live in `bin/lib/migrations/`.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Section-as-phase as load-bearing model | Maps GSD's structured-workflow primitives 1:1 onto academic writing; enables bounded verification, isolated re-do, parallel writing | ✓ Good — held across all 11 phases; section isolation + bounded verifier proven by mtime tests |
| Two-tier from one source of truth | Avoid duplicate logic between plugin and CLI; workflow bodies + templates shared via `<capability_check>` blocks | ✓ Good — tier-contract gate caught drift repeatedly; (Tier-2 generative transport deferred to v0.2.0) |
| Single-command UX (`/pensmith`) | User remembers one thing; tool tracks state. Verb shortcuts are fallback | ✓ Good — 16-verb/16-body bijection enforced by three independent guards |
| Free-only plagiarism check (DuckDuckGo distinctive phrases) | Paid services rejected; lower recall acceptable; free + no key + clearly about catching plagiarism | ✓ Good — advisory, never blocks, offline-cassette tested |
| No exported-document metadata or footer | Deliberate user-facing choice (against initial recommendation); README disclaimer is the only disclosure | ✓ Good — zero-trace verified by test across all 4 formats |
| Style-match shipped (opt-in) with dual-use disclosure | Legitimate uses (consistency across thesis/dissertation); user takes responsibility per README | ⚠️ Revisit — shipped per-paper-only (no global cache); novel dual-use territory, watch real usage |
| Deterministic Pass 1 + Pass 3 blocking; Pass 2 + Pass 4 advisory | Re-fetch-the-source integrity can't be left to an LLM; claim-support judgment is advisory by nature | ✓ Good — known-bad fixtures flag 10/10; advisory passes never auto-block |
| GSD orchestrates the build | Use the GSD plan→converge→execute→verify flow; don't build outside the orchestrator | ✓ Good — all 11 phases shipped via GSD; 0-HIGH convergence + per-phase verification |
| Accept v0.1.0 tech-debt, roll into v0.2.0 | Generative seams (Tier-2 transport, live research, citation-at-export) scaffolded not wired; ship architecture, fix end-to-end next | ✓ Good — v0.2.0 shipped all carried items (25/25 reqs); 3-OS CI green |
| LLM transport routes through `http.ts`, not a vendor SDK's own fetch | Keep the single network chokepoint (D-06) + SSRF guard + rate bucket over every call; import SDK types only | ✓ Good — non-streaming POST via http.ts; no chokepoint bypass; provider-agnostic (anthropic/openai) |
| Verifier gate is `--yolo`-UNskippable (GATE-04) | `--yolo` is for the advisory export-confirmation gate only; citation-integrity is the #1 non-negotiable and must never be bypassable | ✓ Good — code-review caught a --yolo escape; fixed to unconditional hard-block |
| SSRF: fail-closed on private/reserved IP, but document the residuals honestly | Real DNS-resolved range block beats a false "mitigation" comment; the TOCTOU/worker-abort residuals need bigger changes | ⚠️ Revisit — DNS-rebind + worker-PDF residuals documented in SECURITY.md, carried to v0.3.0 |
| Accept v0.2.0 tech-debt (LIBRARY.json→prompt feed), roll into v0.3.0 | The 25 committed reqs are done + CI-green; the discovered-sources→drafting feed is beyond scope but is the natural "truly end-to-end" next step | — Pending — v0.3.0 milestone |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`): requirements invalidated → Out of Scope; validated → Validated; new → Active; decisions → Key Decisions; "What This Is" accuracy.

**After each milestone** (via `/gsd:complete-milestone`): full review of all sections; Core Value check; audit Out of Scope; update Context + Current State.

---
*Last updated: 2026-06-24 after v0.2.0 End-to-End milestone (initialized 2026-05-06 from PRD.md)*
