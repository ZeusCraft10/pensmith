# Project Research Summary

**Project:** pensmith
**Domain:** Claude Code plugin (Tier 1) + portable Node CLI (Tier 2) for AI-assisted academic paper writing with citation verification
**Researched:** 2026-05-06
**Confidence:** HIGH on architecture, foundation NFRs, and feature taxonomy; MEDIUM on PDF parsing, source-API tier classification, and HANDOFF schema timing; LOW on style-match dual-use guardrails (no industry precedent — novel territory)

## Executive Summary

Pensmith is a near-direct architectural adaptation of `jnuyens/gsd-plugin` to academic paper authoring, with three substantive twists: **section-as-phase** (the load-bearing primitive — each section gets its own `.paper/sections/<NN-slug>/` directory, isolating state by directory contract rather than careful prompting), **two-tier from one source of truth** (workflow bodies + agents + templates shared between the Claude Code plugin and a portable Node CLI, with `<capability_check>` blocks generalizing gsd-plugin's `--text` overlay pattern to six capabilities: Task, MCP, AskUserQuestion, Pandoc, Zotero MCP, humanizer), and **verifier as hard gate** (Pass 1 deterministic DOI/identifier integrity + author/title fuzzy match, Pass 3 deterministic OA full-text quote presence — both blocking; Pass 2 + Pass 4 LLM-judged and advisory). No tool currently in the market combines structured per-section drafting + real citation re-fetch + author/title fuzzy match + quote verification + free-only plagiarism + honest detection framing in one workflow — that is pensmith's open lane.

The recommended approach is rigorously prescriptive on build order: **Foundation NFRs first** (paths, atomic-write, lock, http, doi, budget, migrations, pii, session-log, state, library, checkpoint, runtime — all unit-tested before any feature work begins), **both tier shells in parallel as Phase 2** gated by `tier-contract.test.js`, **a vertical slice through ONE section as Phase 3** as the architectural proof, then breadth widens. Stack: TypeScript + ESM, Node 20 LTS minimum, `@modelcontextprotocol/sdk` for the MCP server (rejecting hand-rolled JSON-RPC), `citty` + `@clack/prompts` for the CLI, native `fetch` + `undici` + hand-rolled per-source TTL cache (no community OpenAlex/Crossref/arXiv/PubMed clients are seriously maintained — raw adapters in `bin/lib/sources.ts` are the right call), `pdf-parse` pinned with `pymupdf` shellout fallback, `citation-js` + bundled CSL files (resolving PRD §17's citation-style open question), `node:test` + `c8` + `nock` for testing, JSON files + `proper-lockfile` for the v0.1 library index (SQLite deferred).

Key risks are well-understood and controllable. The verifier "grades its own homework" trap is sidestepped by deterministic Pass 1/Pass 3; DOI normalization edge cases (non-ASCII case-folding, trailing punctuation, arXiv old/new formats, PMID/PMCID separation) are concentrated in `bin/lib/doi.ts` as a single chokepoint; quote drift through PDF artifacts (ligatures, soft hyphens, smart quotes, ellipsis variants, diacritics) is handled by Unicode-normalize-both-sides + tiered exact→fuzzy match + diff visibility; OneDrive/sync corruption is critical and must ship in v0.1.0 doctor (the user's own dev folder is in OneDrive, so devs hit it first); cost overruns are gated by per-step budgets, not just per-session. Schema versioning ships day-one on every state file. The two-tier contract is enforced by `tier-contract.test.js` as a hard merge gate from Phase 2 onward, not a wrap-up task. Style-match dual-use is novel territory with no precedent — per-paper profile only, no global cache, sample-set fingerprint stored, cross-paper reuse surfaced; flag for milestone-close review.

## Key Findings

### Recommended Stack

Stack picks are concrete and opinionated. Where the PRD §17 leaves open questions, this research resolves several with HIGH confidence; others are flagged for discuss-phase.

**Core technologies:**
- **TypeScript 5.6+ / ESM / Node ≥20.10 LTS (target 22 features where useful)** — Node 18 is EOL April 2025; Node 22 ships native TS strip + `node:sqlite`. All modern Claude Code plugins ship TS in 2026.
- **`@modelcontextprotocol/sdk` ^1.29** — official, current, full MCP spec. Hand-rolled JSON-RPC explicitly rejected.
- **`citty` ^0.2** — UnJS, ESM-only, zero-deps, native `parseArgs`; fits pensmith's ~15 verbs + plumbing namespace better than commander/yargs.
- **`@clack/prompts` ^0.7** — modern stdin-fallback prompt library replacing inquirer (Tier 2 fallback for AskUserQuestion).
- **Native `fetch` + `undici` ^7 + `p-retry` ^6 + hand-rolled per-source TTL disk cache** — undici v7 ships RFC-9111 caching; pensmith wants per-source TTL keyed on normalized DOI, so hand-rolled cache (~50 LOC) wins over undici's `CacheStore`. All HTTP through `bin/lib/http.ts` chokepoint (lint-enforced).
- **Raw fetch adapters in `bin/lib/sources.ts` for OpenAlex / Crossref / arXiv / PubMed / Semantic Scholar / Unpaywall / Retraction Watch / GPTZero** — no actively maintained Node clients exist for any of these; centralized adapter pattern gives full control over polite UA, cache, retry, and DOI normalization (which PRD §14 mandates anyway). MEDIUM confidence on sparse ecosystem; HIGH on the pattern.
- **`pdf-parse` ^2.4.5 (pinned exact)** with shell-out to `pymupdf` fallback when extraction looks suspect. Pinned because patch versions have shipped breaking changes historically. MEDIUM confidence — the most actively churning area of the stack.
- **`citation-js` ^0.7.22 + `@citation-js/plugin-bibtex` + bundled CSL files in `templates/citation-styles/`** — resolves PRD §17 hand-rolled-vs-CSL open question with HIGH confidence. CSL via citeproc-js unlocks 10,000+ styles for free.
- **JSON file + `proper-lockfile` ^4** for the v0.1 library index — git-friendly, ~thousands of entries fine. SQLite deferred to v0.2.
- **`zod` ^3.23 + `smol-toml` + `fuse.js` + `tinyglobby` + `doi-regex` + `fast-xml-parser` + `cheerio`** — schema validation, TOML config, fuzzy author/title match, glob, DOI extraction, arXiv/PubMed XML, DDG HTML parsing.
- **Tier 2 LLM clients: `openai` ^4 (covers OpenAI / Ollama / vLLM / Together / OpenRouter via baseURL override) + `@anthropic-ai/sdk` ^0.93** (native, when provider=anthropic). Both wrapped behind `bin/lib/runtime.ts`.
- **Testing: `node:test` + `c8` + `nock`** — `nockBack` cassette pattern for source-API fixtures; live tests gated behind `PENSMITH_NETWORK_TESTS=1`.

**Critical version notes:**
- Pin `pdf-parse` exact (history of patch-version breaks).
- `OPENALEX_API_KEY` config slot must exist NOW even if unused — OpenAlex email-only polite pool sunsets Feb 13, 2026.
- Claude Code hook timeout is 60s default (not 30s as feared); HANDOFF.json must stay <5KB pointers, not content.
- Node 18 explicitly excluded (EOL April 2025).

### Expected Features

PRD §15 success criteria == v0.1.0 MVP. Research validates every PRD-listed feature; the four push-back additions below are the only deltas. The strong differentiators are section-isolated state, in-loop DOI re-fetch, quote verification (Pass 3), two-tier from one source of truth, honest detection framing, free-only plagiarism, local-only positioning, and hard cost cap — none of these is shipped well by any single competitor (Elicit, SciSpace, Consensus, Scite, Paperpal, Jenni, Yomu, Citely all fail at least one).

**Must have (table stakes — PRD §15):**
- Section-as-phase directory layout `.paper/sections/<NN-slug>/{PLAN,DRAFT,VERIFICATION}.md` (load-bearing).
- Two-tier source-of-truth + `<capability_check>` blocks + `tier-contract.test.js`.
- HANDOFF.json (section-granular, <5KB pointers) + atomic write-then-rename + concurrent-run lock.
- Schema versioning + migrations dir from day one.
- Cross-platform paths (Windows %APPDATA%, macOS Application Support, Linux XDG) — including OneDrive/iCloud/Dropbox detection.
- Hard cost cap + meter; per-step budgets, not only per-session.
- HTTP client with per-source TTL cache, exponential backoff w/ jitter, polite User-Agent (refuse to start without `PENSMITH_CONTACT_EMAIL`).
- DOI / arXiv / PMID normalization in `bin/lib/doi.ts` as single chokepoint.
- Replayable session log + `--show-prompts`.
- Single `/pensmith` command, state-aware, with verb shortcuts as fallback and natural-language triggers.
- Intake with discipline presets + research with parallel source-researchers (T1) / sequential (T2) + outline with approval gate + per-section plan→write→verify loop.
- Verifier Pass 1 (DOI integrity + author/title fuzzy match — blocking), Pass 3 (quote verification, OA full-text — blocking); Pass 2 (claim support — advisory), Pass 4 (per-paragraph orphan-claim audit — advisory).
- Last-verified timestamps + Retraction Watch flag.
- Compile (refuses on FABRICATED/MIS-CITED/NOT_FOUND; cross-section smoothing read-only on section files; claim consistency; density check).
- Done: whole-paper Pass 4, free distinctive-phrase + DDG plagiarism check, humanizer wrap (skip cleanly if absent), GPTZero score before/after framed honestly, export to .docx/.pdf/.tex/.md, **zero pensmith trace in exports**.
- Library mode (`/pensmith list`, `/pensmith open`, class grouping).
- BYO PDFs + Zotero MCP integration when detected and authenticated.
- Style-match opt-in (per-paper, with dual-use disclosure).
- Educator/tutorial mode + `/pensmith sketch` + `/pensmith doctor` + `--dry-run` + `--estimate` + `--yolo` (default off).
- Citation styles APA 7 / MLA / Chicago (notes-bib + author-date) / IEEE / AMA / Vancouver.
- Test fixtures: `known-bad-citations.json` (10+ fabricated DOIs, 10/10 flagged), `known-bad-quotes.json` (10+ NOT_FOUND, of which ≥5 carry PDF artifacts: ligature / soft hyphen / smart quotes / ellipsis variant / diacritic).

**Should have (competitive — push-back additions to PRD):**
- **Add Harvard citation style** (table stakes for UK/AU; cheap; missing from PRD §8 table).
- **Add RIS export** (Mendeley/EndNote interop; ~30 lines; expected by reference-manager users).
- **Default honesty backend = GPTZero** (lowest false-positive rate ~0.24% per recent comparisons; PRD already lists it as an option, make it the default).
- **CSL via citeproc-js** for the citation formatter (resolves PRD §17 open question; unlocks 10,000+ styles for free).

**Defer (v0.1.x and later):**
- More citation styles via the same CSL pipeline (cheap once the engine is in).
- SQLite library index (only when JSON gets slow; node:sqlite path on Node 22+).
- Wave scheduling visualization in `/pensmith status`.
- Per-step / per-section cost-breakdown reporting.
- Granular cassette-refresh job + schema tests + weekly live smoke.
- Per-discipline source DBs (PhilPapers, JSTOR, NBER, APA PsycNET) once auth flows are documented.
- Multi-author / collaboration / cloud sync / voice UI / inline LaTeX rendering / cross-paper literature comparison — explicit anti-features per PRD §16.

### Architecture Approach

Three concentric rings: **Foundation NFRs** (paths, atomic-write, lock, http, doi, budget, pii, migrations, session-log) → **Domain libraries** (state, library, checkpoint, ecosystem, runtime, sources, pdf-ingest, verifier, plagiarism, style-match, citations, disciplines, honesty, doctor, estimator) → **Workflow surface** (skills + workflow bodies + agents + MCP server + hooks + templates). Build order is strictly outside-in on dependency, inside-out on user value: Foundation first, then a vertical slice through one section, then breadth.

**Major components:**
1. **Workflow bodies (`workflows/*.md`)** — the only place prose-instructions live; both tiers read these. `<capability_check>` blocks declare the six capabilities (Task, MCP, AskUserQuestion, Pandoc, Zotero MCP, humanizer) and provide inline fallbacks. Generalizes gsd-plugin's `--text` overlay pattern.
2. **Domain libraries (`bin/lib/*.ts`)** — the only place business logic lives. MCP server, hooks, Tier-2 CLI, and the umbrella skill all call into the same modules. No logic in `mcp/server.ts` (anti-pattern); MCP tools are ~30-line shims.
3. **MCP server (`mcp/server.ts`)** — Tier-1-only; exposes read-only resources (`paper://state`, `paper://outline`, `paper://section/{N}`, `paper://library`, `paper://capabilities`) and idempotent state-mutation tools (`paper_init_section`, `paper_advance_section`, `paper_record_verification`, `paper_set_status`, `paper_doi_verify`, `paper_capability_probe`).
4. **Hooks (`hooks/hooks.json`)** — Tier-1-only; SessionStart auto-resume, PreCompact section-granular HANDOFF.json (configured to 10s timeout explicitly even though Claude Code default is 60s), PostToolUse mid-session checkpoint (≤1/min, mtime gate), Stop releases lock + flushes session log.
5. **Tier-2 CLI (`bin/pensmith-cli.ts`)** — verb dispatcher; reads workflow bodies, executes sequentially against OpenAI-compatible endpoint; stdin numbered-prompt fallback for AskUserQuestion (matching gsd-plugin's `--text` mode JSON question schema).
6. **Section-isolated state on disk** — `.paper/sections/<NN-slug>/{PLAN,DRAFT,VERIFICATION}.md` per section + per-section state field `∈ {planned, writing, written, verifying, verified, failed}` + `verified_against_draft_hash` for compile-staleness detection. Cross-paper library at `~/.pensmith/library/index.json`. Lock file lives outside `.paper/` in platform local-only data dir to sidestep OneDrive entirely.
7. **Schema-versioned state files** — every state file (`STATE.md`, `config.toml`, `HANDOFF.json`, `sections/<N>/*.md`) declares `schema_version: 1` from day one; migrations directory ships empty in v0.1.0 with README explaining the contract; refuse-forward-incompat read behavior.
8. **Verifier as deterministic-first, LLM-second** — Pass 1 (Crossref/arXiv/PubMed HTTP fetch + Jaro-Winkler / Fuse.js fuzzy match) and Pass 3 (Unpaywall full-text + tiered exact→fuzzy substring match with Unicode normalization both sides) are pure-Node code. Pass 2 (claim support) and Pass 4 (per-paragraph audit) are LLM-judged with calibrated UNCLEAR-bias prompts and wave-size cap (≤5 default).

### Critical Pitfalls

Top pitfalls drawn from PITFALLS.md categories CRITICAL + MODERATE; full list of 18 pitfalls plus debt patterns / integration gotchas / performance traps / security mistakes / UX pitfalls in `.planning/research/PITFALLS.md`.

1. **Verifier "grades its own homework"** — LLM-only citation verification defaults to looks-legit-to-me. **Avoid:** Pass 1 must be deterministic HTTP fetch against Crossref/arXiv/PubMed (no LLM in the loop); DOI existence is necessary but not sufficient — author/title/year fuzzy match is required; calibrate Pass 2 prompts toward UNCLEAR; test against fabricated fixtures (10+ in `known-bad-citations.json` flagged 10/10).
2. **DOI normalization edge cases bite** — non-ASCII case-folding (DOI handbook says case-folding is ASCII-only; `10.123/ABÇ` ≠ `10.123/abç`); trailing punctuation from citation strings (`.`, `,`, `)`, `]`, `>`) is the #1 false-FABRICATED source; arXiv old/new format split (`cs.CL/0501001` vs `2401.12345v3`); PMID/PMCID are different namespaces. **Avoid:** single chokepoint in `bin/lib/doi.ts` (lint against `/^10\./` regex anywhere else); store both `doi_canonical` and `doi_as_cited`; ASCII-only case folding; round-trip property test for idempotence.
3. **Quote drift via PDF artifacts** — paraphrase-presented-as-quote escapes verification because of ligatures (`fi`/`fl`), soft hyphens (U+00AD), hyphenated line breaks, smart vs straight quotes, ellipsis variants, two-column flow, diacritics. **Avoid:** NFKC Unicode normalize both sides; smart-quotes/em-dash/ellipsis canonicalization; strip soft hyphens; decompose known ligatures; tiered exact→Levenshtein-≥0.95 match with diff shown; minimum quote length (≥10 words) for fuzzy. Fixtures must include real PDF artifacts, not just clean paraphrases.
4. **State corruption — atomic write done wrong, lock files race, OneDrive eats the file** — atomic write is `write tmp` → `fsync(tmp)` → `rename` → `fsync(dir)` (skipping dir-fsync allows zero-length state on crash); lock files need PID+timestamp+hostname+heartbeat (PID-only is unsafe with reuse and across-machine sync). **Critical:** **this very project's dev folder is in OneDrive** — devs hit OneDrive corruption first. Lock file must live in `~/.pensmith/locks/<project-hash>.lock` (platform local-only data dir), not inside `.paper/`. Doctor command must detect OneDrive/iCloud/Dropbox/Google Drive at intake and warn — ship in v0.1.0, not polish.
5. **Schema migration regrets** — adding `schema_version` later is painful; not handling old HANDOFF.json after `/compact` is worse. **Avoid:** day-one schema versioning on every state file; empty migrations directory in v0.1.0 but the loader exists; migrate-on-read in-memory only (never write back without lock + user ack); refuse forward-incompat reads.
6. **Cost overruns** — uncapped LLM loops, runaway parallel subagent waves, retry storms. **Avoid:** hard $5/session default cap with abort *before* the call (not after billing); per-step budgets (e.g., $0.50/section for Pass 2); retry caps (max 3 attempts per LLM call); parallel fan-out cap (`--max-parallel`, default 5); live cost meter banner; refuse `--yolo` if estimate exceeds 50% of cap.
7. **HTTP client gotchas** — banned User-Agents (Crossref polite pool requires `mailto:`), thundering herd retries (full jitter required, not "equal jitter"), cache key collisions (key on `(method, url, sorted relevant headers, body hash)`), per-source rate limits ignored (Crossref 50 req/s, OpenAlex 15K/hr + API key required mid-2026, arXiv 1 req/3s, PubMed 3 req/s without key). **Avoid:** All HTTP through `bin/lib/http.ts` chokepoint; refuse to start without `PENSMITH_CONTACT_EMAIL`; honor Retry-After / X-Rate-Limit headers; circuit-break on 429 storms; cassette tests must include 429/503/Retry-After fixtures.
8. **Cross-platform path landmines** — Windows MAX_PATH (260 chars) hit easily under `OneDrive - <Org>` paths; case sensitivity (Linux differs from macOS/Windows); `~/.pensmith` vs `%APPDATA%` vs `$XDG_DATA_HOME`. **Avoid:** all path resolution through `bin/lib/paths.ts` (lint against direct `os.homedir()`); always quote shell-out paths; section folders ASCII lowercase hyphen-separated; CI matrix on linux-x64 + macos-arm64 + windows-x64.
9. **Two-tier drift** — capability blocks rot; new feature touches only one tier; Tier 2 sequential drifts subtly from Tier 1 parallel because section drafter saw "previous sections" as context. **Avoid:** `tier-contract.test.js` is a hard merge gate from day one (Phase 2); test what's checkable (verdicts, citation lists, structure) and accept what's not (prose, length within ±20%); capability check schema with machine-validated declarations; section drafter prompt has a hard input contract — only PLAN.md + mapped sources + STYLE.json + voice hint.
10. **Section-as-phase invariant violations** — cross-section coupling, smoothing corruption, renumbering chaos. **Avoid:** section drafter sees only its own PLAN + mapped sources (lint the agent's input map); compile is read-only on `sections/<N>/DRAFT.md`; smoothing writes only to `.paper/DRAFT.md`; consistency check produces flags, not edits; **stable numbering with letter suffixes** (`03b-validity-threats/`) — never renumber on insert; `verified_against_draft_hash` for staleness detection.

(Moderate pitfalls, debt patterns, integration gotchas, performance traps, security mistakes, UX pitfalls, and a "Looks Done But Isn't" checklist live in PITFALLS.md.)

## Implications for Roadmap

Build order is **prescriptive**, derived from architecture's ring structure and pitfall mitigation. Phases 1–3 are non-negotiable; later phases widen breadth.

### Phase 0: Repo skeleton & manifest (1–2 days)
**Rationale:** Establish discipline (lint, CI, plugin manifest validation) before any code that needs it.
**Delivers:** `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.mcp.json`, README skeleton, LICENSE, PRIVACY skeleton. Empty `bin/`, `mcp/`, `hooks/`, `skills/`, `agents/`, `workflows/`, `templates/`, `references/`, `schema/`, `tests/`. CI scaffolding (`node:test` + lint + tsc --noEmit).
**Acceptance:** `npm run lint` and `npm test` (zero tests) green; plugin manifest validates.

### Phase 1: Foundation NFRs (PRD §19 "early phase" made concrete)
**Rationale:** Ring 1 of the architecture. Every subsequent layer depends on these. PRD §19 explicitly says NFRs get their own early phase. Without this, the build collapses into circular dependencies.
**Delivers, in strict order:** `paths.ts` → `atomic-write.ts` → `lock.ts` → `doi.ts` → `http.ts` → `budget.ts` → `migrations/` loader → `pii.ts` → `session-log.ts` → `state.ts` + `library.ts` + `checkpoint.ts` → `runtime.ts`. Each with unit tests.
**Addresses:** Foundation for every Pitfall (1, 2, 4, 5, 6, 7, 8 directly; rest indirectly).
**Avoids:** State corruption (Pitfall 4), DOI normalization regrets (Pitfall 2), HTTP gotchas (Pitfall 7), cross-platform landmines (Pitfall 8), schema migration regrets (Pitfall 5), cost overruns (Pitfall 6).
**Acceptance:** every Foundation lib has unit tests green; cassette HTTP tests reproducible; lock conflict test passes; budget abort fires *before* the call (verified with fixture); CI green offline (network gated by `PENSMITH_NETWORK_TESTS=1`); lint bans `fetch`/`http`/`https`/`undici` outside `http.ts` and `/^10\./` regex outside `doi.ts`.
**Critical:** **`OPENALEX_API_KEY` config slot must exist NOW** even if unused initially (sunset Feb 13, 2026). Lock file location is platform local-only data dir, NOT `.paper/` (OneDrive sidestep).

### Phase 2: Tier-1 plugin shell + Tier-2 CLI shell + tier-contract test (parallel work)
**Rationale:** Both tier shells must work from day-2-of-feature-work, gated by `tier-contract.test.js` from the start. Adding the contract test late is how two-tier drift happens.
**Delivers:** `mcp/server.ts` (read-only resources only — no tools yet), `hooks/hooks.json` (SessionStart + Stop wired to `bin/pensmith-tools.ts`), `bin/pensmith-cli.ts` (`--version`, `status`, `list` verbs only), `bin/lib/ecosystem.ts` (Zotero MCP auth check, Pandoc, humanizer detection), `bin/lib/doctor.ts` + `pensmith doctor` end-to-end against fixtures (**including OneDrive/iCloud/Dropbox detection**), `references/runtime-contract.md` (defines `<capability_check>` semantics), `templates/*.md` skeletons, `tests/tier-contract.test.js` framework with `doctor` as the first contract case.
**Implements:** Two-tier source-of-truth (Architecture pattern 1), MCP-as-state-surface (pattern 3), capability_check generalization to six capabilities.
**Avoids:** Two-tier drift (Pitfall 9), tier-contract test as merge gate from this phase forward.
**Acceptance:** `/pensmith doctor` PASS in T1; `pensmith doctor` PASS in T2; both produce equivalent output (modulo prose); doctor warns when `.paper/` is inside a sync folder; `tier-contract.test.js` exists and is wired into CI as a merge block.

### Phase 3: Vertical slice through ONE section (architectural proof)
**Rationale:** End-to-end intake → research → outline → plan → write → verify on a single fixture assignment. This phase delivers PRD §15 success criterion #1 in miniature; proves the section-as-phase contract works before scaling to N sections.
**Delivers:** `bin/lib/sources.ts` (OpenAlex + Crossref first; arXiv/PubMed/Unpaywall later), `bin/lib/citations.ts` (APA only first), `bin/lib/disciplines.ts`, `bin/lib/verifier.ts` Pass 1 + Pass 3 (deterministic only; Pass 2/4 stubbed), agents (`source-researcher`, `source-evaluator`, `outliner`, `section-planner`, `section-writer`, `doi-verifier`, `quote-verifier`), workflows (`pensmith`, `pensmith-new`, `pensmith-research`, `pensmith-outline`, `pensmith-plan-section`, `pensmith-write-section`, `pensmith-verify-section`) with `<capability_check>` blocks, corresponding skills, `tests/fixtures/known-bad-citations.json` (10 fabricated DOIs + verifier acceptance test), `tests/fixtures/known-bad-quotes.json` (≥5 PDF-artifact-bearing fixtures: ligature, soft hyphen, smart quotes, ellipsis variant, diacritic).
**Implements:** Section-isolated state (Architecture pattern 2), verifier deterministic-first (pattern 5), atomic state writes (pattern 6).
**Avoids:** Verifier grades-own-homework (Pitfall 1), quote drift (Pitfall 3), section invariant violations (Pitfall 10) via `tier-contract.test.js` mtime-snapshot test asserting re-do-section-3 doesn't touch other sections.
**Acceptance:** PRD §15 smoke test runs end-to-end through verify-section on one section in both tiers; verifier flags 10/10 known-bad citations and 10/10 known-bad quotes (≥5 with PDF artifacts); `tier-contract.test.js` green for all workflows in this slice.

### Phase 4: Breadth — remaining sections + compile
**Rationale:** Once one section works end-to-end, scale to N. Wave scheduling, compile, cross-section consistency.
**Delivers:** Wave scheduling in `state.ts.computeWaves()` (T1 parallel), `workflows/pensmith-compile.md` + `agents/pensmith-compiler.md`, cross-section claim-consistency check (LLM, calibrated for false-positive rate, **produces flags only, not edits**), citation-density check, **section renumbering policy locked: stable numbering with letter suffixes** (`03b-validity-threats/`), `verified_against_draft_hash` for staleness detection.
**Implements:** Section-granular HANDOFF.json (Architecture pattern 7), wave-based parallel writing (data flow §4.4).
**Avoids:** Section invariant violations (Pitfall 10), renumbering chaos.

### Phase 5: Verifier completeness (Pass 2 + Pass 4)
**Rationale:** Advisory passes added once blocking passes are stable.
**Delivers:** `agents/pensmith-claim-verifier.md`, `pensmith-paragraph-auditor.md`, LLM-judged passes with calibrated UNCLEAR-bias prompts, expanded fixtures.

### Phase 6: Done / finishing
**Rationale:** Export pipeline. Plagiarism + honesty + humanizer + Pandoc.
**Delivers:** `bin/lib/plagiarism.ts` (distinctive-phrase n-grams + DDG HTML), `bin/lib/honesty.ts` (default = GPTZero), `agents/pensmith-humanizer-wrapper.md`, `pensmith-honesty-scorer.md`, `pensmith-plagiarism-scanner.md`, `workflows/pensmith-done.md`, Pandoc export wiring, **zero-trace export verification test** (grep `.docx` ZIP entries for "pensmith" — must be zero).
**Avoids:** Detection-framing creep (Pitfall 12) via locked copy + CONTRIBUTING.md rule.

### Phase 7: Single-command UX layer
**Rationale:** Polish. `/pensmith` umbrella state machine, natural-language triggering, inline corrections, resume hooks, flags.
**Delivers:** `workflows/pensmith.md` umbrella, skill descriptions optimized for natural-language triggering, inline conversational corrections, `pensmith-resume` skill + PreCompact hook (configured to 10s explicitly) + PostToolUse throttled checkpoint, `--yolo`, `--dry-run`, `--estimate`, `--show-prompts` flags.

### Phase 8: Style match + sketch + add + library polish
**Rationale:** Differentiated features after core is solid. Style-match is novel-territory dual-use — flag for milestone-close review.
**Delivers:** `bin/lib/style-match.ts` + `agents/pensmith-style-analyzer.md` (per-paper profile, no global cache, sample-set fingerprint, cross-paper reuse detection), `workflows/pensmith-sketch.md` + `agents/pensmith-sketch-partner.md`, `workflows/pensmith-add.md`, library polish (class grouping, archived status).
**Avoids:** Style-match dual-use drift (novel-territory pitfall).

### Phase 9: Educator/tutorial + PII redaction polish + plagiarism polish
**Rationale:** Wrapping layers + best-effort PII.
**Delivers:** Educator-mode event/wrapper architecture (no `if (educator_mode)` blocks in workflow bodies), tutorial-mode end-state for `goal=learning`, PII regex pass + opt-in Microsoft Presidio shellout, plagiarism polish (n-gram tuning).

### Phase 10: Discipline preset breadth + citation-style breadth + Zotero MCP integration
**Rationale:** Breadth that doesn't gate v0.1.0 launch.
**Delivers:** Remaining disciplines, full CSL style catalog (citeproc-js + bundled CSL files), Zotero MCP source provider polish (auth check already in Phase 2 ecosystem.ts).

### Phase Ordering Rationale

- **Foundation outside-in.** Architecture's ring structure: every layer above depends on Foundation; Foundation must be green before any feature work begins. PRD §19 explicit.
- **Both tier shells in parallel as Phase 2.** Two-tier drift is the most dangerous slow-burn failure mode; `tier-contract.test.js` is a hard merge gate from the moment workflow bodies exist, not a v0.1.0 wrap-up task. Every workflow body added in any phase must add a contract-test entry.
- **Vertical slice as Phase 3.** Architectural proof — exercises the load-bearing section-as-phase invariant on a single section before fanning out. PRD §15 smoke test fits in this phase.
- **Breadth widens after the proof.** Wave scheduling, compile, additional verifier passes, finishing pipeline, polish — each phase widens one axis at a time, never multiple.
- **Style-match late.** Novel territory with no industry precedent for dual-use guardrails; ship after the rest of the v0.1.0 surface is stable so it can be reviewed at milestone close.
- **OneDrive/sync detection in Phase 2 doctor**, not Phase 9 polish — the user's own dev folder is inside OneDrive, so devs hit it first.

### Research Flags

Phases likely needing deeper research during planning (`/gsd-research-phase` candidates):
- **Phase 1 (`http.ts` + `sources.ts`):** Per-source rate limits + 2026 API contract changes (OpenAlex API key sunset Feb 13, 2026). Cassette refresh strategy needs design. **Likely needs research.**
- **Phase 1 (`doi.ts`):** DOI handbook ASCII-only case-folding edge cases + arXiv old/new format + PMID/PMCID separation. Has well-documented spec; research needed only on test-fixture variety.
- **Phase 3 (verifier Pass 3 + PDF parsing choice):** PRD §17 open question (`pdf-parse` vs `pymupdf`). Needs adversarial-fixture survey before locking. **Likely needs research.**
- **Phase 4 (wave scheduling algorithm + section-dependency declaration syntax):** PRD §17 open questions; needs prior-art survey (Quarto's `_quarto.yml`, Pandoc's project files). **Likely needs research.**
- **Phase 5 (verifier subagent prompt wording for UNCLEAR-bias calibration):** PRD §17 open question; needs adversarial-prompt testing. **Likely needs research.**
- **Phase 6 (humanizer wrapping contract for user's installed `~/.claude/skills/humanizer/`):** Skill schema needs concrete contract. May need research depending on humanizer skill's own format.
- **Phase 8 (style-match implementation: LLM featurization vs embeddings):** PRD §17 open question; novel-territory guardrails have no industry precedent. **Likely needs research and milestone-close review.**

Phases with standard patterns (skip research-phase if budget tight):
- **Phase 0** — repo skeleton, plugin manifest format is fully documented.
- **Phase 1 (`paths.ts`, `atomic-write.ts`, `lock.ts`, `budget.ts`, `migrations` loader, `pii.ts`, `session-log.ts`, `state.ts`, `library.ts`, `checkpoint.ts`, `runtime.ts`)** — gsd-plugin's `bin/lib/core.cjs` provides the patterns (lift atomic-write verbatim).
- **Phase 2 shells** — gsd-plugin's MCP server pattern + hooks pattern + CLI pattern transfer directly.
- **Phase 7 UX layer** — single-command UX pattern is well-documented; flags are mechanical.
- **Phase 9 educator-mode** — event/wrapper architecture is a standard observer pattern.
- **Phase 10 breadth** — mechanical once Phase 6 is in.

### Push-back on PRD (must reach the roadmapper)

Research surfaced these recommendations that the roadmapper should treat as first-class deltas, not chat-trim:

1. **Add Harvard citation style** to PRD §8 table (table stakes for UK/AU; cheap).
2. **Add RIS export** alongside BibTeX (~30 lines; expected by Mendeley/EndNote users).
3. **Default honesty backend to GPTZero** (lowest false-positive rate ~0.24%; PRD already lists it as an option).
4. **Resolve PRD §17 citation-style open question NOW: CSL via citeproc-js + bundled CSL files** (unlocks 10,000+ styles).
5. **Per-step cost cap, not just per-session** (runaway parallel waves can blow budget without per-step gating).
6. **Sync-folder detection in `/pensmith doctor` ships in v0.1.0**, not polish (dev folder is in OneDrive).
7. **Section state machine with `verified_against_draft_hash`** for compile-staleness detection (not in PRD; surfaced by pitfalls research).
8. **`OPENALEX_API_KEY` config slot ships in v0.1.0** even if unused (sunset Feb 13, 2026).
9. **HANDOFF.json must stay <5KB pointers**, not content (Claude Code hook timeout 60s default but configure PreCompact to 10s explicitly; large HANDOFF defeats the budget).
10. **`tier-contract.test.js` is a Phase 2 hard merge gate**, not a v0.1.0 wrap-up. Every workflow body in every phase adds a contract-test entry.
11. **Verifier acceptance test specifics:** PRD §14 says 10+ fabricated DOIs in `known-bad-citations.json`; pitfalls research adds: ≥5 PDF-artifact-bearing fixtures in `known-bad-quotes.json` (ligature, soft hyphen, smart quotes, ellipsis variant, diacritic).
12. **MCP server is a thin shim** (~30-line tool wrappers around `bin/lib/*`); business logic in `mcp/server.ts` is an explicit anti-pattern.
13. **Style-match guardrails (per-paper profile, no global cache, sample-set fingerprint, cross-paper reuse detection)** — novel territory, flag for milestone-close review.

### Open Questions for Discuss-Phase (do NOT resolve in synthesis)

These remain genuine ambiguities that should surface in the relevant phase's discuss-phase, not be papered over here. Recommendations are noted where research has a strong leaning; final decision is the discuss-phase's call.

1. **MCP SDK choice** — recommended: `@modelcontextprotocol/sdk` over hand-rolled JSON-RPC (HIGH confidence in research, but PRD §17 explicitly defers).
2. **Section-numbering policy on insert** — recommended: stable with letter-suffix `03b-foo/` (PRD §17 also recommends; lock at Phase 4).
3. **Wave scheduling algorithm** — recommended starting point: topological sort by `depends_on` with `--max-parallel` cap (default 5).
4. **Section-dependency declaration syntax in OUTLINE.md** — recommended: simple `depends_on: [1, 2]` per section.
5. **PDF parsing library final pick** — recommended: `pdf-parse` pinned + `pymupdf` shellout when detected (PRD §17 also defers).
6. **Style-match implementation: LLM featurization vs embeddings** — recommended: embeddings with LLM fallback when sample folder is small.
7. **Library index format: JSON vs SQLite** — recommended: JSON for v0.1, SQLite path swappable in `bin/lib/library.ts`.
8. **PII redaction backend** — recommended: hand-rolled regex pass for v0.1; opt-in shellout to Microsoft Presidio in v0.2.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Foundational layer (plugin schema, Node ecosystem, MCP SDK) is well-documented and verified against current 2026 versions. MEDIUM on source-API clients (sparse Node ecosystem; verdict is "skip community libs, raw fetch is right"). MEDIUM-LOW on PDF parsing (active churn; recommendation is intentionally defensive — pin `pdf-parse`, fall back to `pymupdf`). |
| Features | HIGH | Category structure and table-stakes verified across 10+ competitor reviews and 2025/2026 product pages. MEDIUM on specific competitor behaviors (verified via official docs, not all hands-on). PRD's instinct is generally correct; research validates and adds 4 specific push-backs. |
| Architecture | HIGH | gsd-plugin source inspected directly; PRD §4/§13/§14 are explicit; section-as-phase load-bearing model already locked. Build order recommendation is structural, not opinion. |
| Pitfalls | HIGH on verifier / HTTP / PDF / path categories (multi-source verified); MEDIUM on hook/MCP timing details (single-source from official docs); LOW on style-match dual-use guardrails (no industry precedent — novel territory; revisit at milestone close). |

### Gaps to Address

- **Cassette refresh cadence + schema-test framework** — a weekly CI job that re-records cassettes and surfaces diffs is in Phase 1's "should have" but not strictly v0.1.0 scope. Decide at Phase 1 discuss whether to ship in v0.1.0 or v0.1.x.
- **Style-match dual-use guardrails** — research flagged LOW confidence; no precedent. Phase 8 must include explicit milestone-close review of guardrails before shipping.
- **Predatory-journal flag** — needs a maintained list (Beall's List successors); deferred to v0.1.x but research needed at Phase 4 to decide format.
- **Educator-mode event architecture** — design decision deferred to Phase 9; need to confirm event-emit pattern doesn't leak into Foundation in earlier phases.
- **Smoothing pass concrete contract** — Phase 4 must lock that compile is read-only on `sections/<N>/DRAFT.md` and that smoothing writes only to `.paper/DRAFT.md`. Test asserting this invariant must ship with Phase 4.
- **PostToolUse checkpoint race conditions** — design needs Phase 7 to confirm async/best-effort semantics; currently described in Architecture §4 but not test-covered.

## Sources

Aggregated from STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md research files. See those files for full citation lists. Selected high-confidence anchors:

- Claude Code Plugin reference docs, Skills docs, Hooks reference (code.claude.com/docs)
- `@modelcontextprotocol/sdk` on npm — current 1.29.0
- `unjs/citty`, `@clack/prompts`, `picocolors`
- `undici` v7 caching announcement
- `pdf-parse` on npm; pkgpulse comparison of PDF libs 2026
- `citation-js` homepage
- DOI Handbook §case-insensitivity
- Crossref REST API rate limits & auth docs
- OpenAlex rate limits & authentication — API key required from ~Mar 2026
- arXiv API user manual — 1 req per 3 seconds
- compdf — PDF text extraction issues; Freiburg dehyphenation guide; Zotero soft-hyphen forum
- abraunegg/onedrive #3439 — OneDrive atomic-rename interaction
- jnuyens/gsd-plugin GitHub — direct source inspection (architectural reference)
- Citely AI Citation Hallucination guide; GPTZero vs Copyleaks vs Originality; Paperpal AI Humanizers in Academic Writing: Risks

---
*Research synthesis for: pensmith — Claude Code plugin + portable Node CLI for academic paper writing*
*Synthesized: 2026-05-06*
