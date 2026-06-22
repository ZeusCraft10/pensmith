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

### Active

<!-- v0.2.0 scope. From the 2026-06-22 improvement review: connecting the verified machinery to a real end-to-end deliverable. -->

**The unlock (make pensmith actually generate a paper):**
- [ ] **Tier-2 LLM transport** (`bin/lib/anthropic.ts`) — the six generative verbs (intake/research/outline/plan/write/revise) currently emit `tier2-placeholder` artifacts because the transport module doesn't exist; Tier 2 cannot generate anything today (PRD §1/SC-7)
- [ ] **Live research source discovery** wired into `pensmith research` — the 8 adapters + dedup + retraction cross-check exist, but `research.ts` hardcodes zero candidates and writes a placeholder library
- [ ] **Citation style + `[@key]` resolution at export** — wire `resolveStyleName` + `--citeproc/--csl/--bibliography` so exports carry formatted cites + a bibliography instead of literal `[@key]` tokens (the 8-style CSL catalog already exists but has no production consumer)
- [ ] **Intake paper-level bootstrap** — write `STATE.json`/paperId at intake so global-library registration + style-match stop WARN-skipping in the real flow
- [ ] **Humanizer Task transport** in Tier 1 (detection ships; the wrap currently returns null, so no "after" score)

**Fail-closed correctness hardening (the core guarantee, end-to-end):**
- [ ] Missing `VERIFICATION.md` must fail the compile refuse-gate (currently reads as clean)
- [ ] Shared render+parse pair for the refuse-gate verdict rows + writer→parser round-trip test
- [ ] Re-query Retraction Watch at verify time (blocking), not only the WARN-only freshness channel
- [ ] Re-verify humanizer `FINAL.md` (deterministic Pass-3 + citekey diff) before export — it currently bypasses all verification

**Foundation & security hardening:**
- [ ] Canonicalize lock keys (`path.resolve`+`realpath`) before hashing in `lock.ts` (callers pass inconsistent conventions → same file, different lock)
- [ ] Real SSRF guards in `http.ts` (scheme allowlist + DNS-resolved RFC1918/loopback block); the `add <url>` "mitigation" comment is currently false
- [ ] Recursive PII redaction on nested leaves before `SESSION.log` writes (only top-level keys today)
- [ ] Run the deferred secure-phase audit → per-phase SECURITY.md; pin/replace `pdf-parse@1.1.1`; prompt-injection delimiting in advisory Pass 2/4

**CI / DX parity:**
- [ ] `npm run check` prebuild-first so local == CI; fresh-clone CI job + `git status --porcelain` clean assertion (3 of 5 ship breaks were stale-artifact); coverage gate; non-TTY stdin test run
- [ ] Ship the real README (install, `/pensmith` quickstart, PRD §3 disclaimer); fill the 4 stub workflow bodies; refresh stale "Phase 3+/ships in Phase 6" copy

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

**Shipped: v0.1.0 Foundation (2026-06-22).** 11 phases, 73 plans, ~43k LOC TypeScript (ESM/NodeNext strict), 856 tests, 3-OS CI matrix (ubuntu/macos/windows × Node 20.18) green on `origin/main`. Repo: github.com/ZeusCraft10/pensmith.

The full two-tier architecture, the deterministic verifier gate, the compile/export pipeline (zero-trace verified), the single-command UX, and the citation/style libraries all shipped and are green. The known limitation — surfaced by the 2026-06-22 multi-dimension review — is that the **generative pipeline is scaffolded but not yet end-to-end**: the Tier-2 LLM transport doesn't exist, `research` discovers zero live sources, and exports still emit literal `[@key]` tokens. v0.2.0 connects these seams.

**Tech stack:** Node ≥20.10, TypeScript (NodeNext, strict), undici, proper-lockfile, citation-js, pdf-parse/pdf-lib, jszip, Pandoc (optional shellout), MCP SDK. Knowledge graph: 6,398 nodes / 7,606 edges (gitignored, rebuild via `/gsd:graphify build`).

## Current Milestone: v0.2.0

**Goal:** Make pensmith produce a submission-ready, sourced, citation-formatted paper end-to-end — close the generative seams the Foundation milestone scaffolded but left unwired.

**Target features:**
- **Tier-2 LLM transport** (`bin/lib/anthropic.ts`) wired into all six generative verbs — the portable CLI can finally generate intake/research/outline/plan/draft/revision.
- **Live research source discovery** wired into `pensmith research` — real candidates from the 8 existing adapters (dedup + retraction cross-check), replacing the zero-candidate placeholder.
- **Citation rendering at export** — `--citeproc/--csl/--bibliography` so exports carry formatted cites + a bibliography instead of literal `[@key]` tokens.
- **Intake paper-level bootstrap** (STATE.json/paperId) so library registration + style-match stop WARN-skipping.
- **Fail-closed gate hardening** — missing-VERIFICATION refuse, verdict-parser round-trip, blocking live retraction re-query, post-humanize re-verification.
- **Foundation & security hardening** — lock-key canonicalization, real SSRF guards, recursive PII redaction, deferred secure-phase audit.
- **CI/DX parity** — prebuild-first `npm run check`, fresh-clone CI gate, coverage gate, real README + stub-body fill.

**Key context:** Scope is the full 2026-06-22 improvement-review backlog. Sequencing — the Tier-2 transport + live research are the unlock (most other gaps become testable once the CLI can generate and discover); the S-effort fail-closed/lock/CI fixes run in parallel; citation-at-export is the highest-visibility self-contained correctness win.

## Context

**Inspiration:** Architecturally modeled on [Get Shit Done](https://github.com/gsd-build/get-shit-done) by TÂCHES and the [gsd-plugin](https://github.com/jnuyens/gsd-plugin) repackaging by Jasper Nuyens. The skill / agent / MCP / workflow-body / HANDOFF.json patterns are theirs; pensmith adapts (not copies) them to academic writing. Required README credit per PRD §18.

**Load-bearing mental model:** A paper is a project, a section is a phase, the outline is the roadmap, compile is milestone completion, done is ship. State isolation is enforced by directory structure (`.paper/sections/<N>/`), not careful prompting. Re-doing section 3 never disturbs sections 1, 2, 4, 5. The verifier runs bounded per-section (~20–40 LLM calls instead of ~200 across the whole paper). **This proved out across all 11 v0.1.0 phases** — re-doing a section never touched its siblings, and the per-section verifier stayed bounded.

**Two-tier requirement:** Both Claude Code plugin (Tier 1, parallel subagents + MCP) and portable Node CLI (Tier 2, sequential, OpenAI-compatible endpoint) must work. Workflow bodies and templates are the shared source of truth. `tests/tier-contract.test.ts` gates drift. *(v0.1.0 caveat: Tier-2's generative path is a placeholder until the v0.2.0 LLM transport lands.)*

**External APIs (all free, no keys for basics):** OpenAlex, Crossref, arXiv, PubMed, Semantic Scholar, Unpaywall, GPTZero (free tier), Retraction Watch, DuckDuckGo HTML. Polite User-Agent with `PENSMITH_CONTACT_EMAIL`.

**Ecosystem composition:** Probes for and adapts to Zotero MCP (with auth check), Pandoc, and the user's installed `humanizer` skill at `~/.claude/skills/humanizer/`.

## Constraints

- **License**: MIT — open-source from day one
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
| Accept v0.1.0 tech-debt, roll into v0.2.0 | Generative seams (Tier-2 transport, live research, citation-at-export) scaffolded not wired; ship architecture, fix end-to-end next | — Pending — v0.2.0 milestone |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`): requirements invalidated → Out of Scope; validated → Validated; new → Active; decisions → Key Decisions; "What This Is" accuracy.

**After each milestone** (via `/gsd:complete-milestone`): full review of all sections; Core Value check; audit Out of Scope; update Context + Current State.

---
*Last updated: 2026-06-22 after v0.1.0 Foundation milestone (initialized 2026-05-06 from PRD.md)*
