# pensmith

## What This Is

`pensmith` is a structured research-and-drafting assistant for academic papers. It runs an opinionated workflow — intake → research → outline → for each section { plan → write → verify } → compile → done — using only verifiable peer-reviewed and configurable academic sources, and ships in two tiers from one source of truth: a Claude Code plugin (Tier 1, with parallel subagents and MCP-backed state) and a portable Node CLI (Tier 2, against any OpenAI-compatible endpoint). It's for students, grad students, and researchers who already use LLMs for academic writing and want a structured workflow that pulls from real citable sources, verifies every citation against the live source, and doesn't pollute their writing with obvious AI tells.

## Core Value

Every citation in every exported paper is real and supports the claim it's attached to — verified by re-fetching the live DOI/quote. The verifier blocks compile and export; no FABRICATED, MIS-CITED, or quote-NOT_FOUND ever escapes.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward v0.1.0. -->

#### Architecture & foundation
- [ ] Two-tier source-of-truth: workflow bodies + templates shared between Tier 1 plugin and Tier 2 CLI
- [ ] Section-as-phase directory layout (`.paper/sections/<N>/{PLAN,DRAFT,VERIFICATION}.md`)
- [ ] `<capability_check>` blocks in every workflow body (Task / MCP / AskUserQuestion / Pandoc / Zotero / humanizer detection)
- [ ] HANDOFF.json schema (section-granular) + atomic write-then-rename for all state files
- [ ] Concurrent-run lock file (`bin/lib/lock.js`) with stale-lock auto-clear
- [ ] Schema versioning + migrations directory from day one
- [ ] Cross-platform paths (Windows %APPDATA%, macOS Application Support, Linux XDG)
- [ ] Hard cost cap (`cost_cap_usd`, default $5/session) with abort + running cost meter
- [ ] HTTP client with response cache (TTL per source), exponential backoff with jitter, polite User-Agent
- [ ] Replayable session log (`.paper/SESSION.log` jsonl), `--show-prompts` flag

#### Single-command UX
- [ ] `/pensmith` bare command resolves state-aware behavior (intake / research / outline / next section / compile / done / resume)
- [ ] Verb shortcuts (`/pensmith new|next|status|research|outline|plan <N>|write <N>|verify <N>|compile|done|resume|list|open|sketch|add|doctor`)
- [ ] Hidden plumbing namespace (`/pensmith:plan-section`, etc.) for scripting
- [ ] Natural-language skill triggers ("redo section 3", "make it sound less AI", "where am I?")
- [ ] Inline conversational corrections (length change, add/drop section, swap source, redo section)

#### Library mode (multi-paper)
- [ ] Global library at `~/.pensmith/library/index.json` (or platform equivalent)
- [ ] `/pensmith list` with class grouping; `/pensmith open <name>` to switch active paper
- [ ] Class assignment at intake (free-form strings; defaults to "Unfiled")
- [ ] Status values: intake / research / outline / sectioning (X/Y) / compile / done / archived

#### Intake
- [ ] Accept assignment as `@file.{pdf,md,txt}`, pasted text, or piped stdin
- [ ] AskUserQuestion clarifying questions (or stdin fallback in Tier 2): discipline preset, mode, goal, class, counterargument, style-match opt-in, PII redaction opt-in
- [ ] Discipline presets (CS, Bio, History, Lit, Psych, Econ, Philosophy, Other) — citation style + source preference + sectioning + counterargument default + density target
- [ ] Print disclaimer; write `.paper/PROJECT.md` and `.paper/config.toml`
- [ ] PII redaction option (intake-time) before any LLM call

#### Research
- [ ] Topic disambiguation gate (tiny subagent for ambiguous terms)
- [ ] Generate 5–10 focused queries from assignment
- [ ] Parallel `pensmith-source-researcher` per query (Tier 1) / sequential (Tier 2)
- [ ] BYO PDF ingestion (pdf-parse, GROBID/heuristic metadata, Crossref hydration)
- [ ] Zotero MCP source provider when detected and authenticated
- [ ] `pensmith-source-evaluator` scores, dedupes, tiers candidates
- [ ] Approval gate to prune/approve/add sources
- [ ] Write `.paper/RESEARCH.md` and `.paper/CITATIONS.bib` with `last_verified` timestamps

#### Outline
- [ ] Produce section structure with thesis, target word count, source mapping per section, dependencies
- [ ] Counterargument enforcement for argumentative/persuasive papers (configurable per intake / `--no-counter`)
- [ ] Approval gate before any section is written
- [ ] Create numbered `.paper/sections/<NN-slug>/` folders with stub PLAN.md per section

#### Plan section
- [ ] `pensmith plan <N>` reads stub PLAN.md, maps claims → sources, identifies counterexamples
- [ ] `--revise` flag for re-planning based on verification feedback
- [ ] `--research <query>` for section-scoped additional research
- [ ] Write `.paper/sections/<N>/PLAN.md` with claim-source mapping, paragraph structure, voice hints

#### Write section
- [ ] Section drafter receives ONLY this section's mapped sources (source isolation by directory)
- [ ] Style-match consumption per-section (when enabled at intake)
- [ ] Auto-chain to verify after write (unless `--no-verify`)

#### Verify section (bounded)
- [ ] Pass 1: DOI/arXiv/PMID integrity — re-fetch via Crossref/arXiv/PubMed; 404 → FABRICATED
- [ ] Pass 1 (cont.): author/title/year fuzzy match → MIS-CITED on mismatch
- [ ] Pass 2: claim support (LLM-judged) — verdict ∈ {SUPPORTED, PARTIAL, UNSUPPORTED, UNCLEAR}, prompt biased to UNCLEAR
- [ ] Pass 3: quotation verification — fetch OA full text, PASS/NOT_FOUND/FUZZY_MATCH
- [ ] Pass 4: per-paragraph claim audit (orphan claims flagged)
- [ ] Section marked `verified` only when Pass 1 + Pass 3 are clean
- [ ] DOI / arXiv ID / PMID normalization in `bin/lib/doi.js`
- [ ] Last-verified timestamps + auto-recheck after `recheck_after_days`
- [ ] Retraction Watch hard warnings

#### Compile
- [ ] Refuse if any section has FABRICATED / MIS-CITED / quote NOT_FOUND
- [ ] Concatenate sections in outline order
- [ ] Cross-section smoothing pass (last/first paragraph of adjacent sections only)
- [ ] Cross-section claim consistency check (flag contradictions)
- [ ] Citation density check vs. discipline preset target
- [ ] Write `.paper/DRAFT.md` and `.paper/COMPILE-REPORT.md`

#### Done (export)
- [ ] Whole-paper Pass 4 audit on compiled draft
- [ ] Free distinctive-phrase plagiarism check (DuckDuckGo HTML)
- [ ] Humanizer pass (wraps user's installed `humanizer` skill; skip cleanly if absent)
- [ ] Detection-aware honesty score (GPTZero/Originality/Sapling) before AND after humanize, framed as "improves prose, not evades detection"
- [ ] Export to `.docx` / `.pdf` / `.tex` / `.md` (pandoc when present)
- [ ] **Zero metadata, zero footer, zero pensmith trace in exported document**
- [ ] Bundle `.paper/CITATIONS.bib` in configured citation style

#### Workflow ergonomics
- [ ] `/pensmith --dry-run` (cached fixtures, no external calls)
- [ ] `/pensmith --estimate` (project tokens + cost before executing)
- [ ] `--yolo` flag (skips outline + export approval; default off)
- [ ] `/pensmith doctor` health check (API connectivity, keys, ecosystem detection, fixture E2E)
- [ ] `/pensmith sketch` thinking-partner mode for thesis discovery
- [ ] `/pensmith add <doi|pdf|url>` with "remap sections?" prompt
- [ ] Educator/tutorial mode (intake choice: draft / learning / both)

#### Resume / hooks (Tier 1)
- [ ] PreCompact hook writes section-granular HANDOFF.json
- [ ] SessionStart hook auto-invokes resume
- [ ] PostToolUse mid-session checkpoint (≤1/min)

#### Style match (opt-in)
- [ ] Intake folder of past writing samples → `.paper/STYLE.json` profile
- [ ] Section drafter consumes profile; per-section voice hints override

#### Testing & determinism
- [ ] `tests/fixtures/known-bad-citations.json` — 10+ fabricated DOIs; verifier flags 10/10 as FABRICATED
- [ ] `tests/fixtures/known-bad-quotes.json` — 10+ NOT_FOUND in cited source
- [ ] `tests/tier-contract.test.js` — every workflow body runs in both Tier 1 and Tier 2 against same fixtures, equivalent outputs (modulo prose)
- [ ] Cassette-based source tests; live-network gated behind `PENSMITH_NETWORK_TESTS=1`
- [ ] DOI normalization, HTTP cache, lock, budget, paths, migrations all unit-tested

### Out of Scope

- Inline LaTeX equation rendering — export to `.tex`; user runs LaTeX themselves
- Paywalled full-text parsing — only legitimate OA via Unpaywall, arXiv, PubMed Central
- Automatic Turnitin/GPTZero submission for certification — score for honesty display only
- Cross-paper "literature comparison" mode — scope creep beyond v0.1.0
- Multi-author / collaboration features — local single-user tool
- Cloud-hosted state — everything is local-only
- Paid plagiarism services — free distinctive-phrase check only
- Voice/speech UI — text-only
- Per-section research as primary mode — research is whole-paper upfront; sections can request additions via `plan <N> --research <query>`
- Metadata stamp / visible footer / any pensmith trace in exported documents — explicit user-facing choice; README disclaimer is the only disclosure mechanism

## Context

**Inspiration:** Architecturally modeled on [Get Shit Done](https://github.com/gsd-build/get-shit-done) by TÂCHES and the [gsd-plugin](https://github.com/jnuyens/gsd-plugin) repackaging by Jasper Nuyens. The skill / agent / MCP / workflow-body / HANDOFF.json patterns are theirs; pensmith adapts (not copies) them to academic writing. Required README credit per PRD §18.

**Load-bearing mental model:** A paper is a project, a section is a phase, the outline is the roadmap, compile is milestone completion, done is ship. State isolation is enforced by directory structure (`.paper/sections/<N>/`), not careful prompting. Re-doing section 3 never disturbs sections 1, 2, 4, 5. The verifier runs bounded per-section (~20–40 LLM calls instead of ~200 across the whole paper). This is the load-bearing design choice — every architectural decision flows from it.

**Two-tier requirement:** Both Claude Code plugin (Tier 1, parallel subagents + MCP) and portable Node CLI (Tier 2, sequential, OpenAI-compatible endpoint) must work. Workflow bodies and templates are the shared source of truth. `tests/tier-contract.test.js` gates drift between tiers.

**External APIs (all free, no keys for basics):** OpenAlex (primary), Crossref (DOI verification), arXiv, PubMed, Semantic Scholar, Unpaywall (OA full-text), GPTZero (honesty score, free tier), Retraction Watch, DuckDuckGo HTML (free plagiarism check). Polite User-Agent with `PENSMITH_CONTACT_EMAIL`.

**Ecosystem composition:** Pensmith probes for and adapts to Zotero MCP (with auth check), Pandoc (better exports), and the user's installed `humanizer` skill at `~/.claude/skills/humanizer/`. Detection cached in `.paper/CAPABILITIES.json` per run.

**Build approach:** GSD will orchestrate this build. PRD §17 leaves several decisions for per-phase discuss-phase: verifier subagent prompt wording, section-dependency syntax, wave scheduling algorithm, MCP SDK choice, PDF parsing library, style-match implementation, library index format, section renumbering policy.

## Constraints

- **License**: MIT — open-source from day one
- **Two-tier**: Both Tier 1 (Claude Code plugin) and Tier 2 (portable Node CLI) must work from the same workflow files. Non-negotiable.
- **Single-command UX**: README quick start teaches `/pensmith` and only `/pensmith`. Verbs are power-user fallback.
- **Verifier gates compile and export**: No FABRICATED, MIS-CITED, or quote-NOT_FOUND ever escapes a section. Author/title fuzzy match is part of Pass 1, not optional.
- **No exported-document trace**: Zero metadata stamp, zero footer, zero pensmith fingerprint in exported docs. Explicit user choice.
- **Honest framing on detection**: GPTZero score is transparency, never "we make it undetectable." Humanizer "improves prose."
- **Approval gates default-on**: Outline approval and export confirmation only skip with `--yolo`.
- **Local-only state**: No cloud, no telemetry. Documented in PRIVACY.md.
- **No paywall bypass**: Full-text only via legitimate OA channels.
- **Hard cost cap**: `cost_cap_usd` default $5/session aborts overruns.
- **Cross-platform paths**: Windows / macOS / Linux must all resolve data dir correctly via `bin/lib/paths.js`.
- **Schema versioning from day one**: Every state file has `schema_version`; migrations live in `bin/lib/migrations/<from>-to-<to>.js`.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Section-as-phase as load-bearing model | Maps GSD's structured-workflow primitives 1:1 onto academic writing; enables bounded verification, isolated re-do, parallel writing | — Pending |
| Two-tier from one source of truth | Avoid duplicate logic between plugin and CLI; workflow bodies + templates are shared and use `<capability_check>` blocks | — Pending |
| Single-command UX (`/pensmith`) | User remembers one thing; tool tracks state. Verb shortcuts are fallback, not primary | — Pending |
| Free-only plagiarism check (DuckDuckGo distinctive phrases) | Paid services rejected; lower recall acceptable; free + no API key + demonstrably about catching plagiarism not enabling evasion | — Pending |
| No exported-document metadata or footer | Deliberate user-facing choice (against initial recommendation); README disclaimer is the only disclosure | — Pending |
| Style-match shipped (opt-in) with dual-use disclosure | Legitimate uses (consistency across thesis/dissertation); user takes responsibility per README | — Pending |
| GSD orchestrates the build | Use `/gsd-new-project --auto @PRD.md` flow; don't try to build outside the orchestrator | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-06 after initialization from PRD.md (auto mode)*
