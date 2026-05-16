# Requirements: pensmith

**Defined:** 2026-05-06
**Core Value:** Every citation in every exported paper is real and supports the claim it's attached to — verified by re-fetching the live DOI/quote. The verifier blocks compile and export; no FABRICATED, MIS-CITED, or quote-NOT_FOUND ever escapes.

## v1 Requirements

Requirements for v0.1.0 (initial release). 132 atomic, testable requirements. Each maps to exactly one phase in `.planning/ROADMAP.md`. IDs are stable — once assigned, never renumber. Push-back additions surfaced by research are flagged `[research]`.

### Repo & Plugin Manifest

- [x] **REPO-01**: Repository ships `package.json` (TypeScript + ESM, Node ≥20.10), `tsconfig.json`, ESLint config, `.gitignore`, MIT `LICENSE`, README skeleton, `PRIVACY.md` skeleton
- [x] **REPO-02**: `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` validate against Claude Code plugin schema
- [x] **REPO-03**: `.mcp.json` declares the pensmith MCP server entry point
- [x] **REPO-04**: CI runs `npm run lint`, `tsc --noEmit`, and `npm test` (which discovers and runs `tests/**/*.test.ts` via `scripts/run-tests.mjs` + `node --import tsx --test`) on linux-x64, macos-arm64, windows-x64
- [x] **REPO-05**: Lint forbids direct `fetch`/`http`/`https`/`undici` imports outside `bin/lib/http.ts`, and bans `/^10\./` regex outside `bin/lib/doi.ts` `[research]`

### Architecture & Foundation

- [ ] **ARCH-01**: Two-tier source-of-truth: workflow bodies + templates + agents shared between Tier 1 (Claude Code plugin) and Tier 2 (portable Node CLI)
- [ ] **ARCH-02**: Section-as-phase directory layout — `.paper/sections/<NN-slug>/{PLAN,DRAFT,VERIFICATION}.md` per section
- [ ] **ARCH-03**: `<capability_check>` blocks in every workflow body declare presence/absence of Task, MCP, AskUserQuestion, Pandoc, Zotero MCP, humanizer with inline fallbacks
- [ ] **ARCH-04**: HANDOFF.json schema is section-granular and stays under 5KB (pointers, not content) `[research]`
- [ ] **ARCH-05**: All state-file writes are atomic — `write tmp` → `fsync(tmp)` → `rename` → `fsync(dir)` (via `bin/lib/atomic-write.ts`)
- [ ] **ARCH-06**: Concurrent-run lock file in platform local-only data dir (NOT inside `.paper/`) with PID + timestamp + hostname + heartbeat; stale-lock auto-clear `[research]`
- [ ] **ARCH-07**: Every state file declares `schema_version: 1` from day one; empty `migrations/` directory ships with v0.1.0 plus loader; refuse-forward-incompat on read
- [ ] **ARCH-08**: Cross-platform path resolution via `bin/lib/paths.ts` (Windows %APPDATA%, macOS Application Support, Linux XDG); lint bans direct `os.homedir()` use elsewhere
- [ ] **ARCH-09**: Per-session hard cost cap (`cost_cap_usd`, default $5) aborts *before* an LLM call — not after billing — with running cost meter banner
- [ ] **ARCH-10**: Per-step cost cap (e.g., $0.50/section for Pass 2) gates runaway parallel waves, separate from session cap `[research]`
- [ ] **ARCH-11**: `--max-parallel` flag (default 5) caps parallel subagent fan-out; refuses `--yolo` when estimate exceeds 50% of session cap
- [ ] **ARCH-12**: HTTP client (`bin/lib/http.ts`) provides per-source TTL disk cache, full-jitter exponential backoff, polite User-Agent. When `PENSMITH_CONTACT_EMAIL` is unset the client emits a one-time WARN banner and proceeds with a generic User-Agent (free basics still work per PRD §12); the doctor-level warning is owned by `DOCT-03`. The client only hard-refuses when an external source explicitly requires identification (e.g., a future API key requirement) — never by default.
- [ ] **ARCH-13**: HTTP client honors `Retry-After` and `X-Rate-Limit` headers; circuit-breaks on 429 storms; per-source rate-limit floors enforced (Crossref 50/s, OpenAlex 15K/hr, arXiv 1/3s, PubMed 3/s) `[research]`
- [ ] **ARCH-14**: `OPENALEX_API_KEY` config slot exists in v0.1.0 even if unused (OpenAlex polite-pool email-only sunset Feb 13, 2026) `[research]`
- [ ] **ARCH-15**: DOI / arXiv ID / PMID normalization concentrated in `bin/lib/doi.ts` — ASCII-only case-folding, trailing punctuation stripped, arXiv old/new format handled, PMID/PMCID kept separate; round-trip property test for idempotence
- [ ] **ARCH-16**: Replayable session log at `.paper/SESSION.log` (jsonl); `--show-prompts` flag dumps every LLM prompt
- [ ] **ARCH-17**: PII redaction option (intake-time, before any LLM call) via `bin/lib/pii.ts` — hand-rolled regex pass for v0.1
- [ ] **ARCH-18**: MCP server (`mcp/server.ts`) is a thin shim — tool handlers ≤30 lines, all business logic in `bin/lib/*` `[research]`
- [ ] **ARCH-19**: Section state machine field `state ∈ {planned, writing, written, verifying, verified, failed}` plus `verified_against_draft_hash` for compile-staleness detection `[research]`
- [ ] **ARCH-20**: Stable section numbering — never renumber on insert; letter-suffix policy (e.g., `03b-validity-threats/`) `[research]`

### Tier Shells & Doctor

- [ ] **TIER-01**: `mcp/server.ts` exposes read-only resources `paper://state`, `paper://outline`, `paper://section/{N}`, `paper://library`, `paper://capabilities`
- [ ] **TIER-02**: `mcp/server.ts` exposes idempotent state-mutation tools `paper_init_section`, `paper_advance_section`, `paper_record_verification`, `paper_set_status`, `paper_doi_verify`, `paper_capability_probe`
- [ ] **TIER-03**: `hooks/hooks.json` wires SessionStart (auto-resume), Stop (release lock + flush session log), PreCompact (HANDOFF.json, configured to 10s explicitly), PostToolUse (≤1/min throttled checkpoint)
- [x] **TIER-04**: Tier 2 CLI (`bin/cli/pensmith.ts`) is a `citty`-based verb dispatcher reading workflow bodies and executing sequentially against any OpenAI-compatible endpoint
- [ ] **TIER-05**: Tier 2 fallback for AskUserQuestion uses `@clack/prompts` with stdin numbered-prompt mode matching gsd-plugin's `--text` JSON question schema
- [ ] **TIER-06**: `tests/tier-contract.test.js` exists from Phase 2 onward and is a hard merge gate; every workflow body added in any later phase adds a contract-test entry `[research]`
- [ ] **TIER-07**: Tier-contract test asserts equivalent output (modulo prose) for verdicts, citation lists, structure; tolerates ±20% length difference
- [x] **DOCT-01**: `/pensmith doctor` reports plugin presence, MCP server reachable, hooks wired, Node version, disk paths writable
- [x] **DOCT-02**: Doctor probes ecosystem (Zotero MCP authenticated, Pandoc on PATH, humanizer skill at `~/.claude/skills/humanizer/`)
- [x] **DOCT-03**: Doctor verifies `PENSMITH_CONTACT_EMAIL` set; warns if missing
- [x] **DOCT-04**: Doctor warns when `.paper/` lives inside OneDrive / iCloud / Dropbox / Google Drive sync folders — ships in v0.1.0, not polish `[research]`
- [ ] **DOCT-05**: Doctor runs end-to-end fixture probe (intake → outline → verify on a tiny known-good fixture) with cassettes; reports PASS/FAIL per stage — **scope deferred to Phase 3** when vertical-slice intake/outline/verify lands (per phase-2 CONTEXT D-04). Phase 2 ships a `build-artifact-resolves` probe in its place (asserts `dist/bin/pensmith.js` + `dist/mcp/server.js` are present and `--version` exits 0).
- [ ] **DOCT-06**: Both tiers produce equivalent doctor output (first contract-test case)
- [x] **DOCT-07**: Doctor `runtime-config-presence` probe iterates `loadRuntimeConfig().providers` and emits per-provider `{name, apiKeyEnv, present:boolean}` — env-var NAME and presence flag only; the resolved value never reaches the probe output, log, or report (symmetric to T-01-07 / D-12). WARN if no provider has its key set; PASS otherwise.

### Single-Command UX

- [ ] **UX-01**: `/pensmith` bare command resolves state-aware behavior (intake / research / outline / next section / compile / done / resume)
- [ ] **UX-02**: Verb shortcuts work: `new`, `next`, `status`, `research`, `outline`, `plan <N>`, `write <N>`, `verify <N>`, `compile`, `done`, `resume`, `list`, `open`, `sketch`, `add`, `doctor`
- [ ] **UX-03**: Hidden plumbing namespace `/pensmith:plan-section` etc. for scripting
- [ ] **UX-04**: Skill descriptions optimized for natural-language triggering — "redo section 3", "make it sound less AI", "where am I?"
- [ ] **UX-05**: Inline conversational corrections handled — length change, add/drop section, swap source, redo section without leaving the chat

### Workflow Ergonomics

- [ ] **ERGO-01**: `--dry-run` flag uses cached fixtures with no external API calls
- [ ] **ERGO-02**: `--estimate` flag projects tokens + USD before executing
- [ ] **ERGO-03**: `--yolo` flag skips outline + export approval gates; default off
- [ ] **ERGO-04**: `--show-prompts` flag echoes every LLM prompt to stdout/log
- [ ] **ERGO-05**: `/pensmith sketch` thinking-partner mode for thesis discovery before intake
- [ ] **ERGO-06**: `/pensmith add <doi|pdf|url>` ingests a new source mid-paper with "remap sections?" prompt
- [ ] **ERGO-07**: Educator/tutorial mode — intake choice `goal ∈ {draft, learning, both}`; `learning` triggers tutorial-mode end-state with annotated provenance

### Library Mode

- [ ] **LIB-01**: Global library at `~/.pensmith/library/index.json` (or platform equivalent), JSON file + `proper-lockfile` for v0.1
- [ ] **LIB-02**: `/pensmith list` shows all papers grouped by class
- [ ] **LIB-03**: `/pensmith open <name>` switches active paper
- [ ] **LIB-04**: Class assignment at intake (free-form string; defaults to "Unfiled")
- [ ] **LIB-05**: Status values per paper: `intake | research | outline | sectioning (X/Y) | compile | done | archived`

### Intake

- [ ] **INTK-01**: Accept assignment as `@file.{pdf,md,txt}`, pasted text, or piped stdin
- [ ] **INTK-02**: AskUserQuestion clarifying questions (or stdin fallback in Tier 2): discipline preset, mode, goal, class, counterargument, style-match opt-in, PII redaction opt-in
- [ ] **INTK-03**: Discipline presets ship for CS, Bio, History, Lit, Psych, Econ, Philosophy, Other — each setting citation style + source preference + sectioning + counterargument default + density target
- [ ] **INTK-04**: Print disclaimer to stdout; write `.paper/PROJECT.md` and `.paper/config.toml` atomically
- [ ] **INTK-05**: Run PII redaction before any LLM call when opted in

### Research

- [ ] **RSCH-01**: Topic disambiguation gate (tiny subagent) for ambiguous terms before query generation
- [ ] **RSCH-02**: Generate 5–10 focused queries from the assignment
- [ ] **RSCH-03**: `pensmith-source-researcher` runs in parallel per query (Tier 1) / sequentially (Tier 2)
- [ ] **RSCH-04**: Source adapters in `bin/lib/sources.ts` for OpenAlex, Crossref, arXiv, PubMed, Semantic Scholar, Unpaywall, Retraction Watch
- [ ] **RSCH-05**: BYO PDF ingestion — `pdf-parse` (pinned exact) with `pymupdf` shellout fallback; metadata via Crossref hydration
- [ ] **RSCH-06**: Zotero MCP source provider when detected and authenticated
- [ ] **RSCH-07**: `pensmith-source-evaluator` scores, dedupes, tiers candidates
- [ ] **RSCH-08**: Approval gate to prune / approve / add sources before research is locked
- [ ] **RSCH-09**: Write `.paper/RESEARCH.md` and `.paper/CITATIONS.bib` with `last_verified` timestamps per source
- [ ] **RSCH-10**: Auto-recheck sources older than `recheck_after_days` (default 30)
- [ ] **RSCH-11**: Retraction Watch hard warnings on any retracted DOI

### Outline

- [ ] **OUTL-01**: Produce section structure with thesis, target word count, source-mapping per section, and `depends_on` declarations
- [ ] **OUTL-02**: Counterargument enforcement for argumentative/persuasive papers (configurable per intake; `--no-counter` to disable)
- [ ] **OUTL-03**: Approval gate before any section is written (skipped only with `--yolo`)
- [ ] **OUTL-04**: Create numbered `.paper/sections/<NN-slug>/` folders with stub `PLAN.md` per section

### Plan Section

- [ ] **PLAN-01**: `pensmith plan <N>` reads stub PLAN.md, maps claims → sources, identifies counterexamples
- [ ] **PLAN-02**: `--revise` flag re-plans based on verification feedback
- [ ] **PLAN-03**: `--research <query>` triggers section-scoped additional research without disturbing other sections
- [ ] **PLAN-04**: Write `.paper/sections/<N>/PLAN.md` with claim-source mapping, paragraph structure, voice hints

### Write Section

- [ ] **WRTE-01**: Section drafter receives ONLY this section's mapped sources + PLAN.md + STYLE.json (when enabled) + voice hint — never the full source pool
- [ ] **WRTE-02**: Style-match consumed per-section when enabled at intake; voice hint can override
- [ ] **WRTE-03**: Auto-chain to verify after write unless `--no-verify`
- [ ] **WRTE-04**: Lint / runtime check enforces section-drafter input contract (Pitfall 9 mitigation) `[research]`

### Verify Section (Bounded)

- [ ] **VRFY-01**: Pass 1 — DOI / arXiv / PMID re-fetch via Crossref / arXiv / PubMed; 404 → FABRICATED (deterministic, blocking)
- [ ] **VRFY-02**: Pass 1 — author / title / year fuzzy match (Jaro-Winkler / Fuse.js); mismatch → MIS-CITED (deterministic, blocking)
- [ ] **VRFY-03**: Pass 2 — claim support (LLM-judged), verdict ∈ {SUPPORTED, PARTIAL, UNSUPPORTED, UNCLEAR}, prompt calibrated UNCLEAR-bias (advisory)
- [ ] **VRFY-04**: Pass 3 — quotation verification, OA full-text via Unpaywall, tiered exact → Levenshtein-≥0.95 substring match with NFKC Unicode normalization both sides; PASS / NOT_FOUND / FUZZY_MATCH (deterministic, blocking)
- [ ] **VRFY-05**: Pass 3 — strip soft hyphens, decompose known ligatures, canonicalize smart quotes / em-dash / ellipsis / diacritics; minimum quote length ≥10 words for fuzzy
- [ ] **VRFY-06**: Pass 4 — per-paragraph orphan-claim audit. The claim-extraction step is deterministic (pure-Node, paragraph→claim regex/grammar pipeline) per PRD §14 "Determinism where it counts." The orphan-vs-cited judgment compares extracted claims to in-text citations deterministically; LLM is used only for *labeling* edge cases (e.g., "is this a claim or a definition?") and remains advisory. Verdict is written to `sections/<N>/VERIFICATION.md` and never auto-blocks compile or export — but presence of any orphan claims feeds the §7.9 export-confirmation gate (`DONE-09`).
- [ ] **VRFY-07**: Section marked `verified` only when Pass 1 + Pass 3 are clean (Pass 2 / Pass 4 verdicts are advisory)
- [ ] **VRFY-08**: `last_verified` timestamps written per citation; auto-recheck on stale

### Compile

- [ ] **COMP-01**: Compile refuses if any section has FABRICATED, MIS-CITED, or quote NOT_FOUND
- [ ] **COMP-02**: Sections concatenated in outline order
- [ ] **COMP-03**: Cross-section smoothing pass touches only last/first paragraph of adjacent sections; writes to `.paper/DRAFT.md`, never modifies `sections/<N>/DRAFT.md` (read-only invariant)
- [ ] **COMP-04**: Cross-section claim-consistency check produces flags only, never edits
- [ ] **COMP-05**: Citation density check vs. discipline preset target
- [ ] **COMP-06**: Wave scheduling (`state.ts.computeWaves()`) topologically sorts by `depends_on` for parallel section writing in Tier 1
- [ ] **COMP-07**: Compile writes `.paper/DRAFT.md` and `.paper/COMPILE-REPORT.md`

### Done (Export)

- [ ] **DONE-01**: Whole-paper Pass 4 audit on the compiled draft
- [ ] **DONE-02**: Free distinctive-phrase plagiarism check via DuckDuckGo HTML (n-gram extraction in `bin/lib/plagiarism.ts`)
- [ ] **DONE-03**: Humanizer pass wraps user's installed `~/.claude/skills/humanizer/`; skips cleanly with banner if absent
- [ ] **DONE-04**: Detection-aware honesty score before AND after humanize via GPTZero (default), with framing "improves prose, not evades detection" `[research]`
- [ ] **DONE-05**: Honesty backend pluggable to Originality / Sapling via config
- [ ] **DONE-06**: Export to `.docx` / `.pdf` / `.tex` / `.md` (Pandoc when present; markdown-only fallback when absent)
- [ ] **DONE-07**: Zero pensmith trace in exported document — no metadata stamp, no footer, no fingerprint; verified by zero-trace test (grep `.docx` ZIP entries for "pensmith" → must be zero)
- [ ] **DONE-08**: Bundle `.paper/CITATIONS.bib` in configured citation style
- [ ] **DONE-09**: Export confirmation gate. PRD §7.9: when any UNSUPPORTED claim, orphan claim (Pass 4), or plagiarism hit (DONE-02) exists, the user MUST be shown a per-issue summary and confirm before export proceeds. The gate also wraps the generic "ready to export?" approval. Skipped only with `--yolo`. The confirmation is the SOLE escape valve for the Core Value claim "every citation supports the claim it's attached to" when Pass 2 / Pass 4 surface advisory issues — without this gate, the Core Value would force compile/export to block automatically, contradicting `VRFY-07`.

### Resume / Hooks (Tier 1)

- [ ] **HOOK-01**: PreCompact hook writes section-granular HANDOFF.json (configured 10s timeout)
- [ ] **HOOK-02**: SessionStart hook auto-invokes the resume skill
- [ ] **HOOK-03**: PostToolUse mid-session checkpoint, throttled ≤1/min via mtime gate
- [ ] **HOOK-04**: Stop hook releases lock and flushes session log

### Style Match (Opt-in)

- [ ] **STYL-01**: Intake folder of past writing samples → `.paper/STYLE.json` per-paper profile (no global cache) `[research]`
- [ ] **STYL-02**: Sample-set fingerprint stored; cross-paper reuse detected and surfaced to user `[research]`
- [ ] **STYL-03**: Section drafter consumes profile; per-section voice hints override
- [ ] **STYL-04**: README ships dual-use disclosure for style-match feature

### Citation Styles

- [ ] **CITE-01**: APA 7 ships in v0.1.0 vertical slice (Phase 3)
- [ ] **CITE-02**: MLA, Chicago (notes-bib + author-date), IEEE, AMA, Vancouver supported via CSL
- [ ] **CITE-03**: Harvard citation style supported (table stakes for UK/AU readers) `[research]`
- [ ] **CITE-04**: Citation engine is `citation-js` + bundled CSL files in `templates/citation-styles/` — unlocks 10,000+ styles via citeproc-js `[research]`
- [ ] **CITE-05**: RIS export alongside BibTeX for Mendeley/EndNote interop `[research]`

### Testing & Determinism

- [ ] **TEST-01**: `tests/fixtures/known-bad-citations.json` — 10+ fabricated DOIs; verifier flags 10/10 as FABRICATED
- [ ] **TEST-02**: `tests/fixtures/known-bad-quotes.json` — 10+ NOT_FOUND fixtures, of which ≥5 carry PDF artifacts (ligature, soft hyphen, smart quotes, ellipsis variant, diacritic) `[research]`
- [ ] **TEST-03**: Cassette-based source tests via `nock` / `nockBack`; live-network tests gated behind `PENSMITH_NETWORK_TESTS=1`
- [ ] **TEST-04**: Cassette fixtures include 429 / 503 / Retry-After cases for HTTP client `[research]`
- [ ] **TEST-05**: Foundation libs unit-tested: paths, atomic-write, lock, doi, http, budget, migrations loader, pii, session-log, state, library, checkpoint, runtime
- [ ] **TEST-06**: DOI normalization round-trip property test (idempotence)
- [ ] **TEST-07**: Lock conflict test — second runner detects + waits / aborts cleanly
- [ ] **TEST-08**: Budget abort fires *before* the LLM call (verified with cost-fixture test)
- [ ] **TEST-09**: Section-isolation mtime test — re-doing section 3 leaves sections 1, 2, 4, 5 untouched (mtime snapshot)
- [ ] **TEST-10**: Zero-trace export test — every export format scanned for "pensmith" string and metadata fields, must be zero
- [ ] **TEST-11**: CI matrix runs on linux-x64, macos-arm64, windows-x64

## v2 Requirements

Acknowledged but deferred from v0.1.0. Will be re-prioritized at milestone close.

### Library Index Performance

- **LIB-V2-01**: SQLite library index (via `node:sqlite` on Node 22+) when JSON-file performance becomes a bottleneck

### Cassette / Live-Test CI

- **TEST-V2-01**: Weekly CI job that re-records source-API cassettes and surfaces diffs
- **TEST-V2-02**: JSON Schema tests on every state file; weekly live smoke run gated behind a separate workflow

### PII Redaction

- **PII-V2-01**: Opt-in shellout to Microsoft Presidio for stronger PII detection beyond regex pass

### Source Breadth

- **RSCH-V2-01**: Per-discipline source DBs — PhilPapers, JSTOR, NBER, APA PsycNET — once auth flows are documented
- **RSCH-V2-02**: Predatory-journal flag against a maintained list (Beall's List successors)

### Cost & Status Reporting

- **REPT-V2-01**: Per-step / per-section cost-breakdown reporting in `/pensmith status`
- **REPT-V2-02**: Wave-scheduling visualization in `/pensmith status`

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Inline LaTeX equation rendering | Out of scope; user runs LaTeX themselves on exported `.tex` |
| Paywalled full-text parsing | Only legitimate OA channels (Unpaywall / arXiv / PMC); no paywall bypass |
| Automatic Turnitin/GPTZero submission for certification | Honesty score is for transparency, never as a "verified undetectable" claim |
| Cross-paper "literature comparison" mode | Scope creep beyond v0.1.0; library mode is for switching, not joining |
| Multi-author / collaboration features | Local single-user tool by design |
| Cloud-hosted state / sync | Everything is local-only; documented in PRIVACY.md |
| Paid plagiarism services | Free distinctive-phrase check only; deliberate user-facing choice |
| Voice / speech UI | Text-only |
| Per-section research as primary mode | Research is whole-paper upfront; section-scoped additions via `plan <N> --research <query>` |
| Metadata stamp / visible footer / any pensmith trace in exports | Explicit user-facing choice; README disclaimer is the only disclosure |
| Mobile app | Desktop CLI + Claude Code only |
| Hand-rolled citation formatter | Resolved by CITE-04 (CSL via citeproc-js) |

## Traceability

Maps requirements to roadmap phases. Empty initially, populated by the roadmapper.

| Requirement | Phase | Status |
|-------------|-------|--------|
| REPO-01 | Phase 0 | Complete (00-01) |
| REPO-02 | Phase 0 | Complete (00-03) |
| REPO-03 | Phase 0 | Complete (00-03) |
| REPO-04 | Phase 0 | Complete (00-04) |
| REPO-05 | Phase 0 | Complete (00-02) |
| ARCH-05 | Phase 1 | Pending |
| ARCH-06 | Phase 1 | Pending |
| ARCH-07 | Phase 1 | Pending |
| ARCH-08 | Phase 1 | Pending |
| ARCH-09 | Phase 1 | Pending |
| ARCH-10 | Phase 1 | Pending |
| ARCH-11 | Phase 1 | Pending |
| ARCH-12 | Phase 1 | Pending |
| ARCH-13 | Phase 1 | Pending |
| ARCH-14 | Phase 1 | Pending |
| ARCH-15 | Phase 1 | Pending |
| ARCH-16 | Phase 1 | Pending |
| ARCH-17 | Phase 1 | Pending |
| TEST-05 | Phase 1 | Pending |
| TEST-06 | Phase 1 | Pending |
| TEST-07 | Phase 1 | Pending |
| TEST-08 | Phase 1 | Pending |
| TEST-11 | Phase 1 | Pending |
| ARCH-01 | Phase 2 | Pending |
| ARCH-03 | Phase 2 | Pending |
| ARCH-18 | Phase 2 | Pending |
| TIER-01 | Phase 2 | Pending |
| TIER-02 | Phase 2 | Pending |
| TIER-03 | Phase 2 | Pending |
| TIER-04 | Phase 2 | DONE — 02-05 |
| TIER-05 | Phase 2 | Pending |
| TIER-06 | Phase 2 | Pending |
| TIER-07 | Phase 2 | Pending |
| DOCT-01 | Phase 2 | DONE — 02-05 |
| DOCT-02 | Phase 2 | DONE — 02-05 |
| DOCT-03 | Phase 2 | DONE — 02-05 |
| DOCT-04 | Phase 2 | DONE — 02-05 |
| DOCT-06 | Phase 2 | Pending |
| DOCT-07 | Phase 2 | DONE — 02-05 |
| DOCT-05 | Phase 3 | Pending (deferred from Phase 2 — see CONTEXT D-04) |
| ARCH-02 | Phase 3 | Pending |
| ARCH-04 | Phase 3 | Pending |
| INTK-01 | Phase 3 | Pending |
| INTK-02 | Phase 3 | Pending |
| INTK-03 | Phase 3 | Pending |
| INTK-04 | Phase 3 | Pending |
| INTK-05 | Phase 3 | Pending |
| RSCH-01 | Phase 3 | Pending |
| RSCH-02 | Phase 3 | Pending |
| RSCH-03 | Phase 3 | Pending |
| RSCH-04 | Phase 3 | Pending |
| RSCH-07 | Phase 3 | Pending |
| RSCH-08 | Phase 3 | Pending |
| RSCH-09 | Phase 3 | Pending |
| RSCH-11 | Phase 3 | Pending |
| OUTL-01 | Phase 3 | Pending |
| OUTL-02 | Phase 3 | Pending |
| OUTL-03 | Phase 3 | Pending |
| OUTL-04 | Phase 3 | Pending |
| PLAN-01 | Phase 3 | Pending |
| PLAN-04 | Phase 3 | Pending |
| WRTE-01 | Phase 3 | Pending |
| WRTE-03 | Phase 3 | Pending |
| WRTE-04 | Phase 3 | Pending |
| VRFY-01 | Phase 3 | Pending |
| VRFY-02 | Phase 3 | Pending |
| VRFY-04 | Phase 3 | Pending |
| VRFY-05 | Phase 3 | Pending |
| VRFY-07 | Phase 3 | Pending |
| VRFY-08 | Phase 3 | Pending |
| CITE-01 | Phase 3 | Pending |
| CITE-04 | Phase 3 | Pending |
| TEST-01 | Phase 3 | Pending |
| TEST-02 | Phase 3 | Pending |
| TEST-03 | Phase 3 | Pending |
| TEST-04 | Phase 3 | Pending |
| TEST-09 | Phase 3 | Pending |
| ARCH-19 | Phase 4 | Pending |
| ARCH-20 | Phase 4 | Pending |
| PLAN-02 | Phase 4 | Pending |
| PLAN-03 | Phase 4 | Pending |
| WRTE-02 | Phase 4 | Pending |
| RSCH-10 | Phase 4 | Pending |
| COMP-01 | Phase 4 | Pending |
| COMP-02 | Phase 4 | Pending |
| COMP-03 | Phase 4 | Pending |
| COMP-04 | Phase 4 | Pending |
| COMP-05 | Phase 4 | Pending |
| COMP-06 | Phase 4 | Pending |
| COMP-07 | Phase 4 | Pending |
| VRFY-03 | Phase 5 | Pending |
| VRFY-06 | Phase 5 | Pending |
| DONE-01 | Phase 6 | Pending |
| DONE-02 | Phase 6 | Pending |
| DONE-03 | Phase 6 | Pending |
| DONE-04 | Phase 6 | Pending |
| DONE-05 | Phase 6 | Pending |
| DONE-06 | Phase 6 | Pending |
| DONE-07 | Phase 6 | Pending |
| DONE-08 | Phase 6 | Pending |
| DONE-09 | Phase 6 | Pending |
| TEST-10 | Phase 6 | Pending |
| UX-01 | Phase 7 | Pending |
| UX-02 | Phase 7 | Pending |
| UX-03 | Phase 7 | Pending |
| UX-04 | Phase 7 | Pending |
| UX-05 | Phase 7 | Pending |
| ERGO-01 | Phase 7 | Pending |
| ERGO-02 | Phase 7 | Pending |
| ERGO-03 | Phase 7 | Pending |
| ERGO-04 | Phase 7 | Pending |
| HOOK-01 | Phase 7 | Pending |
| HOOK-02 | Phase 7 | Pending |
| HOOK-03 | Phase 7 | Pending |
| HOOK-04 | Phase 7 | Pending |
| LIB-01 | Phase 8 | Pending |
| LIB-02 | Phase 8 | Pending |
| LIB-03 | Phase 8 | Pending |
| LIB-04 | Phase 8 | Pending |
| LIB-05 | Phase 8 | Pending |
| ERGO-05 | Phase 8 | Pending |
| ERGO-06 | Phase 8 | Pending |
| RSCH-05 | Phase 8 | Pending |
| STYL-01 | Phase 8 | Pending |
| STYL-02 | Phase 8 | Pending |
| STYL-03 | Phase 8 | Pending |
| STYL-04 | Phase 8 | Pending |
| ERGO-07 | Phase 9 | Pending |
| RSCH-06 | Phase 10 | Pending |
| CITE-02 | Phase 10 | Pending |
| CITE-03 | Phase 10 | Pending |
| CITE-05 | Phase 10 | Pending |

**Coverage:**
- v1 requirements: 132 total
- Mapped to phases: 132
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-06*
*Last updated: 2026-05-15 — Phase 2 revision iter 1: TIER-04 path amended to bin/cli/pensmith.ts; DOCT-05 deferred to Phase 3 (per CONTEXT D-04); DOCT-07 added for runtime-config-presence; total raised from 131 → 132.*
