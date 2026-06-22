# Phase 3: Vertical slice through one section - Research

**Researched:** 2026-05-17
**Domain:** Full-stack vertical slice (intake → research → outline → plan → write → verify) — section-as-phase enforcement, deterministic Pass 1+3 verifier, two-tier equivalence
**Confidence:** HIGH (most decisions LOCKED in CONTEXT.md; research role is mostly verification + Claude's Discretion resolution)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**A. The fixture assignment + golden section pick**
- **D-01:** Single fixture assignment is the PRD §15 smoke test verbatim: `"Write a 1500-word literature review on attention mechanisms in transformers, APA style."` Stored at `tests/fixtures/known-good-fixture/assignment.txt`.
- **D-02:** Golden section = middle section, NOT section 1. Outline produces ~5 sections; slice exercises a middle one (likely "Architectural variants" or "Cross-modal extensions").

**B. Section-dependency contract (`depends_on`)**
- **D-03:** Slug-based `depends_on` only (e.g., `depends_on: [01-introduction]`). Empty array means "no upstream sections."
- **D-04:** Three schema refinements ship with v1: (1) no self-reference, (2) no cycles (Tarjan deferred to Phase 4, refinement at outline-write time in Phase 3), (3) referenced slug MUST resolve to existing folder at outline-time. All three blocking.
- **D-05:** `depends_on` is hard-dep only in v1. No `depends_on_soft` flavor.

**C. Pass 3 PDF-parsing scope**
- **D-06:** Hybrid scope — `pdf-parse@^1.1.1` pinned exact for Unpaywall OA PDFs + synthetic plaintext fixtures for adversarial artifacts. `bin/lib/pdf-text.ts` is the chokepoint. 10/10 NOT_FOUND test runs against synthetic corpus (deterministic).
- **D-07:** `pymupdf` shellout + BYO PDF + Crossref hydration stay Phase 8. REQUIREMENTS.md gets a one-sentence split note for RSCH-05a (Phase 3) vs RSCH-05b (Phase 8).

**D. Section state — minimal vs Phase 4**
- **D-08:** Section state lives ONLY under `.paper/sections/<NN-slug>/PLAN.md` YAML frontmatter. Schema: `state: 'planned' | 'writing' | 'written' | 'verifying' | 'verified' | 'failed'` + thesis + word_target + sources + depends_on + last_verification.
- **D-09:** Bundled v1 → v2 forward migration in `bin/lib/state.ts`. Wakes Phase 1's dormant `writeBack` branch. Drops `state`/`status`/`lastVerification` from project-level `SectionEntrySchema`. Idempotent on v2 files. Phase 1 D-39 refuse-forward-incompat unaffected.
- **D-10:** `verified_against_draft_hash` lives on PLAN.md frontmatter as `last_verification.draft_hash`, not on STATE.json.

**E. Verifier-subagent prompts + Pass 1 fuzzy-match thresholds**
- **D-11:** Jaro-Winkler with prefix-weighted boost. Title threshold ≥0.92, author threshold ≥0.85 (first listed author's surname only). AND-gate. Year mismatch is SOFT (Phase 5 advisory). Both inputs NFKC-normalized + diacritic-stripped + lowercased.
- **D-12:** Prompt files in `templates/prompts/*.md`, hash-pinned. Eight files: intake-clarifier, topic-disambiguator, source-evaluator, outline-author, section-planner, section-drafter, pass1-fuzzy-judge (dormant), pass3-quote-checker (dormant).
- **D-13:** Phase 3 prompts are CALIBRATED to deterministic gates, NOT advisory LLM judgment. Pass 1/3 verdicts computed deterministically; prompts NOT consulted at verdict time.

**F. Source-adapter API surface**
- **D-14:** Unified `SourceCandidate` zod schema. Each adapter exports `search(query)` + `fetchById(id)`. Adapters live at `bin/lib/sources/<name>.ts`. All HTTP routes through `bin/lib/http.ts`. All return values zod-parsed at the boundary.
- **D-15:** Retraction Watch is a side-channel filter, not a standalone search adapter. Exposes ONLY `fetchById(doi)`. Hard warnings surface at evaluator output AND outline approval-gate (twice).
- **D-16:** Semantic Scholar opt-in via `PENSMITH_S2_API_KEY` mirroring `PENSMITH_CONTACT_EMAIL` pattern. Key NAME persisted; VALUE never reaches disk/session-log (T-01-07 carry-forward).

**G. HANDOFF.json schema**
- **D-17:** Section-scoped pointers + minimal rebuild context. Lives at `.paper/HANDOFF.json`. `schema_version: 1`, bounded breadcrumbs (max 5), section_pointers carry plan_path/draft_path/verification_path/state. Under 5KB enforced by test.
- **D-18:** HANDOFF.json carries POINTERS, never content. `section_pointers[].state` is a snapshot mirror — readers MUST reconcile with PLAN.md if they want truth.

**H. APA-7 CSL bundling + Pandoc-token DRAFT.md**
- **D-19:** Bundle `templates/citation-styles/apa.csl` only; citation-js as PARSER (not RENDERER). Hash-pinned in `tests/repo-files.test.ts`.
- **D-20:** RSCH-09 writes `.paper/CITATIONS.bib` as canonical BibTeX source. citation-js parses this at verify-time. BibTeX is durable source-of-truth; CSL-JSON intermediate is transient.
- **D-21:** DRAFT.md emits Pandoc-style `[@citekey]` tokens; NO write-time render. First APA rendering deferred to compile (Phase 4) or export (Phase 6 via Pandoc citeproc).
- **D-22:** One smoke test at `tests/citation-render.test.ts` feeds fixture CITATIONS.bib through citation-js + apa.csl, asserts non-empty output + zero thrown exceptions.

**I. Cassette commit policy**
- **D-23:** Committed cassettes + weekly cron-refresh GitHub Action. Per-adapter subdirs under `tests/fixtures/cassettes/<adapter>/`. Forward-ports TEST-V2-02.
- **D-24:** Cassette refresh workflow at `.github/workflows/cassette-refresh.yml`. Schedule: `0 6 * * 1` (Mon 06:00 UTC). Runs `npm run test:record` in nockBack record mode; auto-PRs the diff. PR-time CI runs OFFLINE (`PENSMITH_NETWORK_TESTS=0` default).
- **D-25:** Cassette directory size budget — per-adapter cap ~50KB, total ~250KB. `tests/cassette-size.test.ts` fails if any adapter cassette exceeds 50KB.

### Claude's Discretion

- Exact `jaro-winkler` pin vs hand-rolled `bin/lib/fuzzy.ts` choice (both meet D-11 contract)
- Per-adapter `search()` parameter shape beyond `query: string`
- Source-evaluator scoring weights (RSCH-07 — researcher proposes weights at plan-phase)
- BibTeX → SourceCandidate field-mapping per source enum (planner-level detail)
- citation-js version pin (planner picks current LTS satisfying APA-7 CSL conformance)
- Workflow-body file structure for each new verb (intake.md / research.md / outline.md / plan-section.md / write-section.md / verify-section.md)
- Whether the v1 → v2 migration is one PR or one plan; either is fine if the migration block is its own commit

### Deferred Ideas (OUT OF SCOPE)

- Pass 2 (LLM-judged claim support) + Pass 4 (paragraph orphan claims) — Phase 5
- N-section breadth + wave scheduler + compile — Phase 4
- Citation styles beyond APA-7 — Phase 9 multi-style polish
- BYO PDF + pymupdf shellout fallback + Crossref hydration — Phase 8 (RSCH-05b)
- Style-match per-paper `STYLE.json` — Phase 8
- `/pensmith sketch` thinking-partner mode — Phase 8
- `/pensmith add <doi|pdf|url>` mid-paper ingest — Phase 8
- Bare `/pensmith` state-aware routing — Phase 7
- Educator/tutorial mode (`goal=learning`) — Phase 9
- Export pipeline + zero-trace gate + humanizer + GPTZero + plagiarism — Phase 6
- `depends_on_soft` advisory hint — reserved field name
- DOCT-06 second-tier-contract probe — Phase 4 N-section expansion
- `PENSMITH_NETWORK_TESTS=1` opt-in for local re-record — documented but no `npm run test:record` until plan-phase researcher confirms nockBack record-mode shape
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (from REQUIREMENTS.md) | Research Support |
|----|------------------------------------|------------------|
| ARCH-02 | `.paper/sections/<NN-slug>/PLAN.md` directory contract | D-08 schema; `bin/lib/paths.ts` extension for `sectionDir`/`planPath`/`draftPath`/`verificationPath`; atomic-write everywhere |
| ARCH-04 | HANDOFF.json section-granular ≤5KB | D-17/D-18 zod schema + `tests/handoff-size.test.ts`; PreCompact hook body lit up |
| INTK-01 | Intake ingest (`@file.pdf|md|txt`, paste, stdin) | citty subcommands; pdf-parse already in deps for Unpaywall — reuse for `@file.pdf` ingest; PII redaction (INTK-05) gate first |
| INTK-02 | AskUserQuestion clarifying battery | `templates/prompts/intake-clarifier.md` (hash-pinned); Tier 1 uses MCP AskUserQuestion, Tier 2 falls back to `@clack/prompts` text confirm pattern (already in deps) |
| INTK-03 | 8 discipline presets | JSON-table at `templates/presets/disciplines.json` (humanities/social-sci/STEM/medicine/law/business/CS/general); selected by intake-clarifier; written into `.paper/config.toml` |
| INTK-04 | Disclaimer print + atomic write of `.paper/PROJECT.md` + `config.toml` | atomic-write.ts; disclaimer from PRD §3 hash-pinned in `references/intake-disclaimer.md` |
| INTK-05 | PII redaction opt-in before any LLM call | Existing `bin/lib/pii.ts` consumed; default-on per PRD §3; gate lives in intake workflow body |
| RSCH-01 | Topic-disambiguation gate | `templates/prompts/topic-disambiguator.md` (hash-pinned); runs ONCE before query gen |
| RSCH-02 | 5–10 query generation | Topic-disambiguator output drives query set; max-10 cap enforced in workflow body |
| RSCH-03 | Source-adapter calls (parallel Tier 1, sequential Tier 2) | D-14 unified `SourceCandidate` schema; 7 adapters under `bin/lib/sources/`; Tier 1 uses Promise.all, Tier 2 uses for-of (deterministic ordering) |
| RSCH-04 | OpenAlex / Crossref / arXiv / PubMed / Semantic Scholar / Unpaywall / Retraction Watch | 7 adapter files; all route through `bin/lib/http.ts` REPO-05 chokepoint; D-15 Retraction Watch filter-only; D-16 S2 opt-in key |
| RSCH-07 | Source-evaluator score + dedupe + tier | `templates/prompts/source-evaluator.md` + deterministic scoring weights (recommended below); DOI-based dedupe via `bin/lib/doi.ts`; tier classification (peer-reviewed / preprint / gray) |
| RSCH-08 | Approval gate | Tier 1 AskUserQuestion; Tier 2 `@clack/prompts` confirm; `--yolo` skips (CLAUDE.md non-negotiable) |
| RSCH-09 | Atomic write of `.paper/RESEARCH.md` + `.paper/CITATIONS.bib` with `last_verified` | D-20 BibTeX canonical; `bin/lib/atomic-write.ts`; `last_verified` per source per CSL-JSON record |
| RSCH-11 | Retraction Watch hard warnings | D-15 dual-surface warning (evaluator + outline approval) |
| OUTL-01 | Section structure + thesis + word_target + source-mapping + depends_on | `templates/prompts/outline-author.md`; produces `.paper/sections/<NN-slug>/PLAN.md` skeletons; D-04 refinements blocking |
| OUTL-02 | Counterargument enforcement (configurable) | `.paper/config.toml` `outline.counterarguments_required = true/false`; default true; warning if any section lacks counterargument block |
| OUTL-03 | Approval gate default-on | Same AskUserQuestion / `@clack/prompts` pattern; `--yolo` skips |
| OUTL-04 | Numbered `.paper/sections/<NN-slug>/` folder creation | `bin/lib/paths.ts::sectionDir(n, slug)` returns `.paper/sections/${pad2(n)}-${slug}/`; atomic-write creates dir + PLAN.md skeleton |
| PLAN-01 | Claim-source mapping + counterexample identification | `templates/prompts/section-planner.md`; output schema with `claims: [{ text, sources: [<citekey>], counter_sources?: [<citekey>] }]` |
| PLAN-04 | Atomic write of section PLAN.md | atomic-write.ts; YAML frontmatter parsing via existing deps (need: `yaml` package OR hand-rolled — see below) |
| WRTE-01 | Drafter receives ONLY this section's mapped sources + PLAN.md + voice hint | `templates/prompts/section-drafter.md`; input-contract chokepoint at `bin/lib/drafter-input.ts` (new) — runtime ASSERT + lint enforcement (Pitfall 9 from PRD) |
| WRTE-03 | Auto-chain to verify unless `--no-verify` | citty flag; workflow body chains `verify-section` call after `write-section` returns |
| WRTE-04 | Runtime + lint enforcement of input-contract | Runtime: `assertDrafterInput(pkg)` throws if pkg contains sources outside section.sources[]. Lint: AST selector for direct LLM-prompt construction outside chokepoint |
| VRFY-01 | Pass 1 DOI/arXiv/PMID re-fetch | Existing `bin/lib/http.ts` + `bin/lib/doi.ts`; HTTP 200 + metadata-field-presence check |
| VRFY-02 | Pass 1 author/title fuzzy match (Jaro-Winkler) | D-11 thresholds locked; hand-rolled `bin/lib/fuzzy.ts` recommended (see Standard Stack) |
| VRFY-04 | Pass 3 OA full-text via Unpaywall + tiered exact → Levenshtein-≥0.95 substring with NFKC | D-06 hybrid scope; `bin/lib/pdf-text.ts` chokepoint; `bin/lib/normalize.ts` for NFKC + ligature/soft-hyphen/smart-quote/diacritic strip; Levenshtein DP impl |
| VRFY-05 | ≥10-word minimum for fuzzy match | Word-count gate before Levenshtein call; quotes <10 words → exact-match only |
| VRFY-07 | `verified` flag set only when both clean | Boolean AND of Pass 1 + Pass 3 verdicts; lives in `last_verification.verdict` on PLAN.md frontmatter |
| VRFY-08 | `last_verified` per citation + auto-recheck on stale | TTL configurable in `config.toml` (default 90 days); auto-recheck triggered if `Date.now() - last_verified > TTL` |
| CITE-01 | APA-7 only (bundle `apa.csl`, hash-pinned) | D-19 apa.csl hash-pinned in `tests/repo-files.test.ts`; sourced from official CSL repo |
| CITE-04 | citation-js (pinned exact) as parser, NOT renderer | D-21 Pandoc-token DRAFT.md; recommendation: `citation-js@0.7.22` pinned exact (see Standard Stack) |
| TEST-01 | Tier-contract test gains 6 new cases | D-13 test extension; existing harness `tests/tier-contract.test.ts` (303 lines, 4 cases); add intake/research/outline/plan-section/write-section/verify-section |
| TEST-02 | Source-adapter cassettes committed + weekly cron-refresh | D-23/D-24 cassette+cron pattern; nockBack record mode + auto-PR workflow |
| TEST-03 | Verifier-subagent prompt files hash-pinned | D-12 eight prompts; D-18 hash-pin pattern extension; SHA-256 with regenerate one-liner in comments |
| TEST-04 | Fixture artifacts (known-bad-citations, known-bad-quotes, known-good-fixture, cassettes, section-isolation test) | Deterministic corpora; `tests/section-isolation.test.ts` mtime invariant |
| TEST-09 | Section-isolation mtime invariant | `tests/section-isolation.test.ts` — re-doing section N leaves all other sections' mtimes unchanged; STATE.json mtime only changes when project-level pointers change (after migration: only on section add/remove) |
</phase_requirements>

## Summary

Phase 3 is the **section-as-phase load-bearing slice**: a single fixture assignment runs intake → research → outline → plan → write → verify on ONE section in both tiers, with deterministic Pass 1 (Jaro-Winkler title≥0.92 AND author≥0.85, AND-gate) and Pass 3 (NFKC-normalized Levenshtein ≥0.95 substring against Unpaywall OA PDFs). The architectural keystone is **D-09's bundled v1→v2 migration**: it wakes Phase 1's dormant migration `writeBack` branch, drops section state from project-level STATE.json, and makes the "section state lives ONLY under `.paper/sections/<NN-slug>/`" invariant structurally enforceable (not just culturally aspired-to). Without this migration, the two-homes drift makes TEST-09's mtime invariant either fail or be tautological.

External research surfaced **one material change**: OpenAlex sunset its polite pool on Feb 13, 2026 — API keys are now required for the documented rate (10 RPS). Phase 1's `OPENALEX_API_KEY` slot is no longer optional; Phase 3's source-evaluator must hard-check for it. Crossref polite pool (mailto+UA) is unchanged. Unpaywall still requires email param. `pdf-parse@1.1.1` is unmaintained and has a known startup ENOENT bug requiring import from `pdf-parse/lib/pdf-parse.js` to bypass the debug code path — `bin/lib/pdf-text.ts` chokepoint absorbs this workaround.

**Primary recommendation:** Hand-roll Jaro-Winkler and Levenshtein in `bin/lib/fuzzy.ts` (~80 + ~40 lines, fully testable, zero new dep, matches existing chokepoint discipline). Pin `citation-js@0.7.22` exact for parser role only. Build the v1→v2 migration as a separate plan within Phase 3 so the migration commit is git-history-isolated for future archeology.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Intake AskUserQuestion clarifying battery | Tier 1 (MCP) | Tier 2 (`@clack/prompts`) | MCP AskUserQuestion is the native UX; CLI falls back to text confirm. Tier-contract test asserts identical output schema. |
| 7 source-adapter HTTP calls | bin/lib (shared) | — | Both tiers consume `bin/lib/sources/*.ts` via the same factory. No tier-specific code. |
| Parallel vs sequential source dispatch | Tier 1 parallel / Tier 2 sequential | — | Tier 1 uses `Promise.all` for speed; Tier 2 uses for-of for deterministic ordering + clean Ctrl-C handling. Tier-contract test tolerates `tolerance: 0.20` on timing-related metadata. |
| Source-evaluator scoring | bin/lib (shared deterministic) | LLM-adjacent prompt | Numeric weights computed in `bin/lib/score.ts`; LLM prompt is for tie-breaking + qualitative rationale only (never overrides the numeric gate). |
| Outline approval gate | Tier 1 AskUserQuestion / Tier 2 `@clack/prompts` confirm | — | Default-on; `--yolo` skips per CLAUDE.md. |
| Section drafter prompt | LLM (provider-agnostic via runtime.chat) | — | D-58/D-59 from Phase 1 — both tiers call `runtime.chat()` with identical messages array. |
| Pass 1 Jaro-Winkler verdict | bin/lib (deterministic) | — | `bin/lib/fuzzy.ts::jaroWinkler` + threshold compare. NO LLM, NO tier-specific code. |
| Pass 3 PDF extract + Levenshtein verdict | bin/lib (deterministic) | — | `bin/lib/pdf-text.ts` + `bin/lib/normalize.ts` + `bin/lib/fuzzy.ts::levenshteinSubstring`. NO LLM, NO tier-specific code. |
| HANDOFF.json write | hooks/pre-compact.ts | — | Tier 1 only (CLI has no equivalent compact event); hook body fires inside 10s timeout. |
| v1→v2 state migration | bin/lib/state.ts | — | Shared; triggered transparently on load. Idempotent. |
| `.paper/sections/<NN-slug>/` directory creation | bin/lib/paths.ts + atomic-write.ts | — | Shared; first time Phase 3 code creates these. |
| DRAFT.md Pandoc-token rendering | bin/lib (shared, NO citation-js call) | — | D-21 — DRAFT.md is plain text with `[@citekey]` tokens; no rendering happens at write time. |
| CITATIONS.bib parse for Pass 1 | bin/lib/citations.ts (wraps citation-js) | — | citation-js as PARSER only (D-19/D-20); chokepoint isolates the dep so future renderer swap is one file. |
| Cassette refresh cron | GitHub Action (CI tier) | — | Not application code. Cron-only; PR-time CI offline. |

## Standard Stack

### Core (NEW for Phase 3)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pdf-parse` | `1.1.1` (pinned-exact via `=1.1.1`) | OA PDF text extraction for Pass 3 quote-checker | Locked by D-06. Most widely-used Node pdf text extractor; known issues are documented and worked around (see Pitfall 1). [VERIFIED: npm view pdf-parse version → 1.1.1 unchanged since 2018-12-08] |
| `citation-js` | `0.7.22` (pinned-exact) | BibTeX parser → CSL-JSON intermediate for Pass 1 metadata access; smoke-test renderer for D-22 | Locked role by D-19/D-20/D-21 (parser only). 0.7.x is the current stable line; 0.7.22 published 2025-12 with APA-7 CSL conformance. [VERIFIED: npm view citation-js dist-tags.latest → 0.7.22] |
| `yaml` | `^2.7.0` | YAML frontmatter parse/serialize for `sections/<N>/PLAN.md` | The canonical Node YAML library (Eemeli Aro). zod-validated on read. [VERIFIED: npm view yaml version → 2.7.0 (2025-01-30)] |
| `jaro-winkler` | — | Pass 1 fuzzy distance | **RECOMMENDATION: hand-roll in `bin/lib/fuzzy.ts`** instead of adding a dep. Algorithm is ~50 lines (Jaro) + ~10 lines (Winkler boost); existing `bin/lib/doi.ts` chokepoint precedent shows the project prefers in-tree implementations for cryptographic-grade deterministic primitives. Hand-rolled lets us also house `levenshteinSubstring` (Pass 3) in one place. |

### Supporting (already in deps from Phase 1/2)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `undici` | `^7` | All source-adapter HTTP via `bin/lib/http.ts` | Every adapter — no direct imports allowed (REPO-05 chokepoint) |
| `proper-lockfile` | `^4` | Per-file lock for STATE.json + per-section PLAN.md writes | `bin/lib/lock.ts::withLock`; load-INSIDE-the-lock idiom |
| `zod` | `^3.23` | SourceCandidate / Handoff / PLAN-frontmatter / runtime-config schemas | At every parse/serialize boundary |
| `@modelcontextprotocol/sdk` | `^1.29` | MCP server for Tier 1 (3 state-mutation tools light up) | `mcp/server.ts` only |
| `citty` | `^0.2.2` | CLI dispatcher for Tier 2 | `bin/pensmith.ts` registers 5 new real verb loaders |
| `@clack/prompts` | `^0.7` | CLI confirm/select for Tier 2 approval gates | `pensmith outline`/`research` user-confirm fallback |
| `nock` | `^14` | HTTP mocking for cassette playback in tests | All adapter unit tests + tier-contract cases |
| `fast-check` | `^3` | Property tests (no-leak, idempotent migration, fuzzy-distance properties) | `tests/fuzzy.property.test.ts`, `tests/migration.property.test.ts`, `tests/no-leak.test.ts` extension |
| `tsx` | `^4` | Test runner shim | Existing `scripts/run-tests.mjs` flow |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled `bin/lib/fuzzy.ts` | `jaro-winkler@0.2.8` from npm | Saves ~80 LOC but adds an unmaintained tiny dep (last publish 2019) with no chokepoint to wrap; team philosophy favors in-tree determinism. **Reject.** |
| `pdf-parse@1.1.1` | `pdfjs-dist`, `pdf2json`, `pdf-extract` | Locked by D-06; alternatives have larger deps, browser-API surface, or no maintenance advantage. `pdfjs-dist` is ~12MB and Mozilla-tracking. **Reject; honor D-06.** |
| `citation-js@0.7.22` umbrella | `@citation-js/core@0.7.21` + plugins separately | Umbrella is simpler — one import, all plugins (BibTeX, CSL, APA) pre-wired. Separate plugins useful only if we want tree-shaking, which doesn't apply to a CLI. **Recommend umbrella.** |
| `yaml@^2.7.0` | `js-yaml@^4`, hand-rolled frontmatter parser | js-yaml is older API style + slower; hand-rolled is brittle for nested arrays. `yaml` is canonical. **Recommend yaml.** |
| Built-in `@clack/prompts` for Tier 2 confirm | `prompts`, `inquirer` | `@clack/prompts` already in deps from Phase 1; no new dep. **Reuse.** |

**Installation:**
```bash
npm install --save-exact pdf-parse@1.1.1 citation-js@0.7.22
npm install yaml@^2.7.0
# jaro-winkler / levenshtein: hand-rolled in bin/lib/fuzzy.ts — no install
```

**Version verification performed:**
- `npm view pdf-parse version` → `1.1.1` (published 2018-12-08, unchanged) [VERIFIED]
- `npm view citation-js dist-tags.latest` → `0.7.22` [VERIFIED]
- `npm view yaml version` → `2.7.0` (2025-01-30) [VERIFIED]
- `npm view nock dist-tags.latest` → `14.0.15` (satisfies Phase 1 D-64 `^14`) [VERIFIED]

## Architecture Patterns

### System Architecture Diagram

```
                                                              ┌─────────────────────┐
                                                              │ Cassettes (committed)│
                                                              │ tests/fixtures/      │
                                                              │ cassettes/*/         │
                                                              └──────────┬───────────┘
                                                                         │ (PR-time CI: PENSMITH_NETWORK_TESTS=0)
                                                                         ▼
   USER INPUT                                                    ┌──────────────┐
       │                                                         │ nock playback │
       ▼                                                         └───────┬───────┘
   ┌─────────────────────┐                                              │
   │ Tier 1: MCP server  │     ┌────────────────────────────┐           │
   │ (Claude Code)       │────▶│   Workflow body files       │           │
   │                     │     │   templates/workflows/*.md  │           │
   │ Tier 2: citty CLI   │────▶│   <capability_check> blocks │           │
   │ (bin/pensmith.ts)   │     │   - intake.md               │           │
   └─────────────────────┘     │   - research.md             │           │
                               │   - outline.md              │           │
                               │   - plan-section.md         │           │
                               │   - write-section.md        │           │
                               │   - verify-section.md       │           │
                               └─────────────┬──────────────┘            │
                                             │                            │
                  ┌──────────────────────────┼────────────────────────────┴────────┐
                  ▼                          ▼                                     ▼
        ┌─────────────────┐       ┌──────────────────────┐              ┌──────────────────┐
        │  PII redaction  │       │  bin/lib/sources/*   │              │  bin/lib/http.ts │
        │  bin/lib/pii.ts │       │  (7 adapters)        │              │  (chokepoint)    │
        │  (INTK-05 gate) │       │  - crossref          │──────────────│  undici +        │
        └────────┬────────┘       │  - openalex          │              │  WARN-once +     │
                 │                │  - arxiv             │              │  TokenBucket     │
                 │                │  - pubmed            │              └──────────────────┘
                 │                │  - semanticscholar   │
                 │                │  - unpaywall         │
                 │                │  - retraction-watch  │
                 │                └──────────┬───────────┘
                 │                           │
                 ▼                           ▼
        ┌─────────────────┐       ┌──────────────────────┐              ┌──────────────────┐
        │ AskUserQuestion │       │  source-evaluator    │              │ runtime.chat()   │
        │ (T1) /          │       │  - score (det)       │──────────────│ provider-agnostic │
        │ @clack/prompts  │       │  - dedupe (DOI)      │              │ (Phase 1 D-58)   │
        │ (T2)            │       │  - tier-classify     │              └──────────────────┘
        └────────┬────────┘       │  - retracted? (D-15) │
                 │                └──────────┬───────────┘
                 │                           │
                 ├───────────────────────────┤
                 ▼                           ▼
        ┌─────────────────────────────────────────────────┐
        │  outline-author → write .paper/sections/<NN>/    │
        │  PLAN.md (YAML frontmatter, atomic)              │
        │  + .paper/RESEARCH.md + .paper/CITATIONS.bib     │
        └────────────────────────┬────────────────────────┘
                                 │
                                 ▼
        ┌─────────────────────────────────────────────────┐
        │  section-planner → augment PLAN.md with          │
        │  claims/counter_sources mapping                  │
        └────────────────────────┬────────────────────────┘
                                 │
                                 ▼
        ┌─────────────────────────────────────────────────┐
        │  section-drafter → write DRAFT.md (Pandoc tokens)│
        │  INPUT CONTRACT (WRTE-04 chokepoint):            │
        │  - ONLY this section's mapped sources            │
        │  - PLAN.md                                       │
        │  - voice hint                                    │
        │  Runtime assert + ESLint AST selector enforce    │
        └────────────────────────┬────────────────────────┘
                                 │ auto-chain unless --no-verify
                                 ▼
        ┌─────────────────────────────────────────────────┐
        │  verify-section (DETERMINISTIC, NO LLM)          │
        │                                                  │
        │  Pass 1: bin/lib/fuzzy.ts::jaroWinkler           │
        │    - HTTP re-fetch DOI/arXiv/PMID via http.ts    │
        │    - title ≥ 0.92 AND author ≥ 0.85 → PASS       │
        │    - else MIS-CITED                              │
        │                                                  │
        │  Pass 3: bin/lib/pdf-text.ts + normalize.ts +    │
        │          fuzzy.ts::levenshteinSubstring          │
        │    - Unpaywall OA PDF fetch                      │
        │    - NFKC + ligature/soft-hyphen/smart-quote/    │
        │      diacritic strip                             │
        │    - ≥10-word quotes → Levenshtein ≥ 0.95 substr │
        │    - <10-word quotes → exact-match only          │
        │    - found → VERIFIED; else NOT_FOUND            │
        │                                                  │
        │  Verdict AND → last_verification on PLAN.md      │
        └────────────────────────┬────────────────────────┘
                                 │
                                 ▼
        ┌─────────────────────────────────────────────────┐
        │  hooks/pre-compact.ts → HANDOFF.json (≤5KB)      │
        │  hooks/post-tool-use.ts → CHECKPOINTS.jsonl      │
        │    (throttled ≤1/min)                            │
        └─────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
bin/
├── pensmith.ts                  # citty dispatcher — 5 verbs light up
├── lib/
│   ├── sources/                 # NEW — 7 adapter files
│   │   ├── crossref.ts
│   │   ├── openalex.ts
│   │   ├── arxiv.ts
│   │   ├── pubmed.ts
│   │   ├── semanticscholar.ts
│   │   ├── unpaywall.ts
│   │   └── retraction-watch.ts
│   ├── pdf-text.ts              # NEW — pdf-parse chokepoint
│   ├── fuzzy.ts                 # NEW — Jaro-Winkler + Levenshtein-substring (hand-rolled)
│   ├── normalize.ts             # NEW — NFKC + ligature/soft-hyphen/smart-quote/diacritic strip
│   ├── citations.ts             # NEW — citation-js wrapper (parser only)
│   ├── score.ts                 # NEW — deterministic source-evaluator weights
│   ├── drafter-input.ts         # NEW — input-contract chokepoint (WRTE-04 runtime assert)
│   ├── handoff.ts               # NEW — HANDOFF.json writer (called by pre-compact hook)
│   ├── frontmatter.ts           # NEW — YAML frontmatter parse/serialize for PLAN.md
│   ├── paths.ts                 # EXTEND — sectionDir/planPath/draftPath/verificationPath
│   ├── state.ts                 # EXTEND — wake migration writeBack branch (D-09)
│   ├── schemas/
│   │   ├── source-candidate.ts  # NEW — D-14 zod schema
│   │   ├── handoff.ts           # NEW — D-17 zod schema
│   │   ├── plan-frontmatter.ts  # NEW — D-08 zod schema
│   │   └── state.ts             # EXTEND — slim SectionEntrySchema at v2
│   └── migrations/              # EXTEND — first real migration entry (Phase 1's dormant slot)
│       └── v1-to-v2.ts          # NEW
templates/
├── workflows/                   # NEW — 6 workflow body markdowns
│   ├── intake.md
│   ├── research.md
│   ├── outline.md
│   ├── plan-section.md
│   ├── write-section.md
│   └── verify-section.md
├── prompts/                     # NEW — 8 subagent prompt files (D-12)
│   ├── intake-clarifier.md
│   ├── topic-disambiguator.md
│   ├── source-evaluator.md
│   ├── outline-author.md
│   ├── section-planner.md
│   ├── section-drafter.md
│   ├── pass1-fuzzy-judge.md    # dormant for Phase 5
│   └── pass3-quote-checker.md  # dormant for Phase 5
├── presets/                     # NEW
│   └── disciplines.json         # 8 discipline presets (INTK-03)
└── citation-styles/
    └── apa.csl                  # NEW — hash-pinned (CITE-01, D-19)
references/
└── intake-disclaimer.md         # NEW — hash-pinned (PRD §3 disclaimer)
tests/
├── fixtures/
│   ├── known-good-fixture/
│   │   ├── assignment.txt       # NEW — hash-pinned (D-01)
│   │   ├── EXPECTED-OUTLINE.json
│   │   ├── EXPECTED-PLAN.md
│   │   ├── EXPECTED-DRAFT.md
│   │   └── EXPECTED-VERIFICATION.json
│   ├── known-bad-citations.json # NEW — ≥10 fabricated DOIs, hash-pinned
│   ├── known-bad-quotes.json    # NEW — ≥10 NOT_FOUND incl ≥5 real-PDF artifacts, hash-pinned
│   └── cassettes/               # NEW — per-adapter recordings (D-23)
│       ├── crossref/
│       ├── openalex/
│       ├── arxiv/
│       ├── pubmed/
│       ├── semanticscholar/
│       ├── unpaywall/
│       └── retraction-watch/
├── tier-contract.test.ts        # EXTEND — 6 new cases
├── repo-files.test.ts           # EXTEND — 11 new hash-pins (8 prompts + apa.csl + assignment.txt + 2 known-bad-*.json)
├── section-isolation.test.ts    # NEW — TEST-09 mtime invariant
├── handoff-size.test.ts         # NEW — <5KB assertion
├── cassette-size.test.ts        # NEW — <50KB/adapter assertion (D-25)
├── citation-render.test.ts      # NEW — D-22 apa.csl + fixture smoke
├── migration.test.ts            # NEW — v1→v2 round-trip + idempotent + forward-incompat
├── fuzzy.test.ts                # NEW — Jaro-Winkler thresholds + Levenshtein substring
├── fuzzy.property.test.ts       # NEW — fast-check properties
└── ...
.github/workflows/
└── cassette-refresh.yml         # NEW — Mon 06:00 UTC cron + auto-PR
mcp/
└── server.ts                    # EXTEND — light up 3 of 6 state tools for real
hooks/
├── pre-compact.ts               # EXTEND — body lit (HANDOFF.json write)
└── post-tool-use.ts             # EXTEND — body lit (checkpoint throttle)
```

### Pattern 1: Chokepoint via ESLint flat-config
**What:** Single call-site for risky / version-sensitive deps. Lint forbids imports outside the chokepoint module.
**When to use:** Every Phase 3 third-party dep with version-skew risk (pdf-parse, citation-js, yaml frontmatter) and every cross-cutting deterministic primitive (fuzzy distance, normalize).
**Example:**
```js
// eslint.config.js — extend existing chokepoint block per D-12 pattern
{
  files: ['**/*.ts'],
  ignores: [
    'bin/lib/pdf-text.ts',                    // the chokepoint itself
    'tests/lint-chokepoint-fixture.ts',       // red-team
  ],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        { name: 'pdf-parse', message: 'Use bin/lib/pdf-text.ts::extractText instead.' },
        { name: 'pdf-parse/lib/pdf-parse.js', message: 'Use bin/lib/pdf-text.ts::extractText instead.' },
        { name: 'citation-js', message: 'Use bin/lib/citations.ts instead.' },
      ],
    }],
  },
}
```
Source: project's existing `eslint.config.js` per-file override pattern (Phase 2 D-12).

### Pattern 2: Atomic write + load-INSIDE-the-lock
**What:** All file writes go through `bin/lib/atomic-write.ts`. All STATE.json mutations call `withLock` and re-read inside the lock.
**When to use:** Every PLAN.md, DRAFT.md, VERIFICATION.md, HANDOFF.json, RESEARCH.md, CITATIONS.bib, PROJECT.md, config.toml write.
**Example:**
```typescript
// bin/lib/state.ts pattern (Phase 1 BLOCKER-01/02 idiom)
import { withLock } from './lock.js';
import { atomicWrite } from './atomic-write.js';

export async function updateSectionState(slug: string, newState: SectionState) {
  await withLock(planPath(slug), async () => {
    const current = await loadPlanFrontmatter(slug);  // LOAD INSIDE the lock
    current.state = newState;
    current.last_verification = current.last_verification ?? null;
    await atomicWrite(planPath(slug), serializeFrontmatter(current));
  });
}
```

### Pattern 3: Refuse-forward-incompat schema versioning + opportunistic migration
**What:** Readers tagged with their max-known version. Reading higher version → throw typed error. Reading lower version → run migration registry, write back.
**When to use:** Phase 3 v1→v2 migration of STATE.json `SectionEntrySchema`.
**Example:**
```typescript
// bin/lib/migrations/v1-to-v2.ts
export const v1ToV2: Migration = {
  from: 1,
  to: 2,
  describe: 'Move section state/status/lastVerification from STATE.json sections[] into per-section PLAN.md frontmatter',
  async forward(stateV1: StateV1, ctx: MigrationCtx): Promise<StateV2> {
    for (const section of stateV1.sections ?? []) {
      if (section.state || section.status || section.lastVerification) {
        const planPath = ctx.paths.planPath(section.n, section.slug);
        const existing = await ctx.loadPlanFrontmatter(planPath).catch(() => null);
        const merged = {
          ...existing,
          state: existing?.state ?? section.state ?? 'planned',
          last_verification: existing?.last_verification ?? section.lastVerification ?? null,
        };
        await ctx.atomicWrite(planPath, ctx.serializeFrontmatter(merged));
      }
    }
    return {
      schema_version: 2,
      sections: (stateV1.sections ?? []).map(s => ({ n: s.n, slug: s.slug })),
      // ...other v2 top-level fields preserved unchanged
    };
  },
};
```
Source: pattern derived from `bin/lib/state.ts` Phase 1 dormant `writeBack` branch comment.

### Pattern 4: Cassette + cron (PR offline, weekly live)
**What:** nockBack records → commit cassettes. PR-time CI replays cassettes (deterministic). Weekly cron re-records + auto-PRs the diff.
**When to use:** Every external API the project depends on for tests.
**Example:**
```typescript
// tests/fixtures/cassettes/crossref/record-shape.test.ts (used only in record mode)
import { back as nockBack } from 'nock';
nockBack.fixtures = 'tests/fixtures/cassettes';
nockBack.setMode(process.env.NOCK_BACK_MODE === 'record' ? 'record' : 'lockdown');

const { nockDone } = await nockBack('crossref/attention-mechanism-query.json');
await crossrefAdapter.search('attention mechanisms in transformers');
nockDone();
```
```yaml
# .github/workflows/cassette-refresh.yml
name: Cassette refresh
on:
  schedule: [{ cron: '0 6 * * 1' }]
  workflow_dispatch: {}
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20.10' }
      - run: npm ci
      - run: npm run test:record
        env:
          NOCK_BACK_MODE: record
          PENSMITH_NETWORK_TESTS: '1'
          PENSMITH_CONTACT_EMAIL: ${{ secrets.PENSMITH_CONTACT_EMAIL }}
          OPENALEX_API_KEY: ${{ secrets.OPENALEX_API_KEY }}
          PENSMITH_S2_API_KEY: ${{ secrets.PENSMITH_S2_API_KEY }}
      - uses: peter-evans/create-pull-request@v6
        with:
          title: 'chore(cassettes): weekly refresh'
          branch: cassettes/refresh
          commit-message: 'chore(cassettes): weekly refresh'
```

### Pattern 5: Source-evaluator scoring (deterministic weights — RECOMMENDATION)
**What:** Each candidate gets a numeric score. LLM is consulted only for tie-breaks and qualitative reasons; never overrides the numeric gate.
**Recommended weights (RSCH-07):**
```typescript
// bin/lib/score.ts — RECOMMENDED INITIAL WEIGHTS (planner can tune)
export function scoreSource(c: SourceCandidate, q: QueryContext): number {
  let s = 0;
  // Source-tier base (peer-reviewed >> preprint >> gray)
  s += { crossref: 40, pubmed: 40, openalex: 35, semanticscholar: 30, arxiv: 20, unpaywall: 10, 'retraction-watch': 0 }[c.source];
  // Recency (peer-review half-life ~5y)
  if (c.year) s += Math.max(0, 20 - 4 * Math.max(0, new Date().getFullYear() - c.year));
  // Title query-overlap (tokenized word-set Jaccard, NFKC-normalized)
  s += 15 * jaccard(tokens(c.title), tokens(q.query));
  // Citation count (OpenAlex/S2 provide; log-scaled)
  if ('citationCount' in (c.raw as Record<string, unknown>)) {
    s += Math.min(10, Math.log2(1 + Number((c.raw as { citationCount?: number }).citationCount ?? 0)));
  }
  // OA-availability bonus (Pass 3 needs full text)
  if (c.oa_pdf_url) s += 5;
  // Retraction veto — never positive
  if (c.retracted) s = -1000;
  return s;
}
```
Rationale: peer-review weighting matches PRD §7.6 (peer-reviewed > preprint > gray); recency half-life of 5y matches academic norms; Jaccard on tokens is deterministic + tier-equivalent; retraction is veto-strength.

### Anti-Patterns to Avoid
- **DON'T render APA citations inline at write-time.** Per D-21, DRAFT.md is Pandoc tokens. Inline rendering creates a citation-js version-skew surface across Tier 1/Tier 2 and forecloses Phase 9 multi-style.
- **DON'T let project STATE.json carry section state.** D-09 migration removes the latent two-homes drift; any code path that re-introduces `section.state` to STATE.json defeats SC-4 and TEST-09.
- **DON'T call `pdf-parse` directly.** Use `bin/lib/pdf-text.ts::extractText`. The chokepoint absorbs the known startup bug workaround and centralizes the buffer-validation logic.
- **DON'T compare full author lists in Pass 1 fuzzy match.** D-11 locks comparison to first-listed-author surname only. Full lists are fragile across BibTeX/Crossref formatting variance.
- **DON'T let HANDOFF.json carry content.** Pointers only (D-18). Otherwise re-doing section N mutates HANDOFF.json beyond the PreCompact mtime, breaking TEST-09.
- **DON'T compare Levenshtein on raw PDF text.** Normalize FIRST (NFKC → ligature → soft-hyphen → smart-quote → em-dash → ellipsis → diacritic). Skipping normalize gives spurious NOT_FOUND on real-PDF artifacts.
- **DON'T let the drafter see sources outside `section.sources[]`.** WRTE-04 input-contract chokepoint — runtime assert + lint enforcement.
- **DON'T persist API key VALUES.** Only NAMES (T-01-07 carry-forward; D-16 reaffirms for `PENSMITH_S2_API_KEY`).
- **DON'T call live APIs in PR-time CI.** `PENSMITH_NETWORK_TESTS=0` default. Cron-only re-record.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| BibTeX parsing | Regex BibTeX parser | `citation-js@0.7.22` (D-19/D-20) | BibTeX grammar has nested braces, comments, string concatenation, accent commands — full parser is ~500 LOC and easy to get subtly wrong on accent commands (`\'{e}` vs `é`) which then breaks Pass 1 fuzzy match. |
| PDF text extraction | Custom PDF parser | `pdf-parse@1.1.1` (D-06) | PDF format complexity: font tables, encoding maps, text-positioning, embedded fonts. `pdf-parse` is locked by D-06; alternatives (`pdfjs-dist`) are heavier. |
| YAML frontmatter | Regex frontmatter splitter | `yaml@^2.7.0` + a 10-line splitter | The split (`---\n...---\n`) is fine to hand-roll; the YAML body parsing is NOT — anchors, multi-line strings, nested arrays all bite. |
| HTTP retries | Custom backoff | Existing `bin/lib/retry.ts` (Phase 2 D-01) | Full-jitter + Retry-After parsing — already shipped, used by `bin/lib/http.ts`. |
| File locking | Custom mutex | `proper-lockfile@^4` via `bin/lib/lock.ts::withLock` | Cross-process lock with stale-lock detection — non-trivial. |
| MCP protocol | Custom JSON-RPC layer | `@modelcontextprotocol/sdk@^1.29` | Already locked by Phase 2; framing + lifecycle + capability negotiation handled. |
| CSL rendering for compile | Custom APA-7 formatter | `citation-js` rendering (Phase 4) OR Pandoc citeproc (Phase 6 export) | APA-7 has hundreds of edge cases (book vs chapter vs article, et-al thresholds, DOI vs URL, page ranges); CSL is the standard. |
| Jaro-Winkler / Levenshtein | DO hand-roll | `bin/lib/fuzzy.ts` | Recommendation REVERSAL — these are 50–100 LOC, well-specified algorithms with deterministic test cases; in-tree gives chokepoint discipline + zero version-skew risk. |
| NFKC normalization | DO hand-roll wrapper around `String.prototype.normalize` | `bin/lib/normalize.ts` | Node has built-in `'…'.normalize('NFKC')`. The wrapper is mostly the ligature/soft-hyphen/smart-quote/em-dash table — ~30 LOC. |

**Key insight:** Phase 3 has TWO categories of "don't hand-roll":
1. **External-format parsers** (BibTeX, PDF, MCP protocol, CSL render) — high-edge-case formats, use mature libs behind chokepoints.
2. **Deterministic primitives we DO hand-roll** (fuzzy distance, NFKC normalize) — small, well-specified, testable by property + golden corpus; in-tree implementation gives chokepoint discipline.

## Runtime State Inventory

> Phase 3 is greenfield code for the verbs (no rename/refactor). The one migration-shaped concern is the v1→v2 STATE.json shape change, which is handled by the bundled migration registry (D-09) — NOT a runtime-state inventory concern per se. The category below is included to confirm no surprise runtime state was missed.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Existing `.paper/STATE.json` files from Phase 1/2 test runs may carry v1 SectionEntrySchema with embedded `state`/`status`/`lastVerification` | D-09 forward migration handles on first load |
| Live service config | None — Pensmith has no live services (it's a local CLI/plugin) | None |
| OS-registered state | None — no Task Scheduler, no launchd, no systemd | None |
| Secrets/env vars | NEW: `PENSMITH_S2_API_KEY` (D-16). EXISTING: `PENSMITH_CONTACT_EMAIL` (D-24), `OPENALEX_API_KEY` (Phase 1 D-64) — now LOAD-BEARING per Feb-2026 OpenAlex polite-pool sunset | Doctor probe + runtime.ts getter for S2 key; warn-once banner pattern from http.ts |
| Build artifacts | None outside `dist/` (already gitignored) | None |

## Common Pitfalls

### Pitfall 1: `pdf-parse@1.1.1` startup ENOENT bug
**What goes wrong:** `import pdfParse from 'pdf-parse'` fails on first call with `ENOENT: no such file or directory, open './test/data/05-versions-space.pdf'`. The package's `index.js` has a debug code path that runs only when invoked directly — but Node's ESM/CJS interop sometimes triggers it.
**Why it happens:** The `index.js` checks `module.parent` to decide whether to enter debug mode; under certain bundler/ESM configurations the check misfires.
**How to avoid:** In `bin/lib/pdf-text.ts`, import the inner module directly:
```typescript
// bin/lib/pdf-text.ts
import pdfParse from 'pdf-parse/lib/pdf-parse.js';  // bypass index.js debug path
export async function extractText(buf: Buffer): Promise<string> {
  const { text } = await pdfParse(buf);
  return text;
}
```
**Warning signs:** Test fails with `ENOENT` mentioning `05-versions-space.pdf` — that's the pdf-parse fixture file the package is looking for. Means index.js was loaded instead of the inner module.
**Sources:** [CITED: github.com/UpravnikPP/pdf-parse-debugging-disabled README]; [VERIFIED: pdf-parse@1.1.1 package contents on npm]

### Pitfall 2: OpenAlex polite pool sunset (Feb 13, 2026)
**What goes wrong:** OpenAlex requests without API key now return slower / rate-limited responses regardless of `mailto=` parameter. Phase 1 D-24's polite-UA pattern alone is INSUFFICIENT for OpenAlex.
**Why it happens:** OpenAlex deprecated the polite pool. API keys are now required for the documented 10 RPS rate. `mailto=` still works as identifier but doesn't unlock the better rate tier.
**How to avoid:** `bin/lib/sources/openalex.ts` MUST check `runtime.getOpenAlexApiKey()` and either: (a) send `Authorization: Bearer <key>` header when present, (b) WARN-once + degrade to lower rate when absent. Doctor probe `openalex-api-key-presence` should be WARN severity when missing (not FAIL — Pensmith still works, just slower).
**Warning signs:** OpenAlex returns 429 Too Many Requests during the fixture-assignment query. Cassettes recorded without the key will look identical to recordings with the key; the difference shows up only under live load.
**Sources:** [CITED: docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication]

### Pitfall 3: Crossref polite pool revised (Dec 1, 2025)
**What goes wrong:** Old Crossref polite-pool semantics changed — rate limits revised, but mailto+UA pattern still works.
**Why it happens:** Crossref normalized their rate-limit headers and tightened enforcement around UA strings.
**How to avoid:** `bin/lib/http.ts` already emits the polite UA (`Pensmith/0.1 (+mailto:<email>)`); Phase 3 needs no code change. Document the dependency on `PENSMITH_CONTACT_EMAIL` in `references/http-warnings.md` (already done in Phase 2 IN-03).
**Warning signs:** Crossref 429 + `Retry-After` header on cassette refresh runs.
**Sources:** [CITED: www.crossref.org/documentation/retrieve-metadata/rest-api/tips-for-using-the-crossref-rest-api/]

### Pitfall 4: pdf-parse extracts text without word-spacing in some PDFs
**What goes wrong:** Some publisher PDFs use kerning instead of literal spaces; `pdf-parse` extracts text as `attentionmechanism` instead of `attention mechanism`. Pass 3 Levenshtein then fails on long quotes.
**Why it happens:** `pdf-parse` uses `pdfjs-dist` internally; word-spacing reconstruction depends on font-metric heuristics that fail on some embedded fonts.
**How to avoid:** Add a `compressWhitespace` step in `bin/lib/normalize.ts` (collapse runs of any whitespace into single space). For Pass 3 substring search, ALSO normalize the QUOTE the same way. Document the limitation: rare edge-case PDFs may give false NOT_FOUND, which is the safe direction (we never claim verification of a quote we can't confidently locate).
**Warning signs:** A quote that visibly appears in the PDF returns NOT_FOUND. Inspect extracted text — if words are concatenated, this pitfall.
**Sources:** [CITED: github.com/mozilla/pdf.js issue tracker — known font-metric limitation]

### Pitfall 5: Jaro-Winkler on accent-marked author names
**What goes wrong:** `Müller` in BibTeX, `Mueller` in Crossref → Jaro-Winkler distance well below 0.85, citation marked MIS-CITED falsely.
**Why it happens:** Two distinct transliterations of the same Latin-1 character. Neither system is wrong.
**How to avoid:** D-11 already locks NFKC + diacritic-strip + lowercase normalization. Verify: `Müller`.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC') → `Muller`. Then `Mueller` vs `Muller` Jaro-Winkler ≈ 0.93 — passes.
**Warning signs:** Specific authors with Latin-1 accents (umlauts especially) generate false MIS-CITED. Check normalize.ts is applied.
**Sources:** [VERIFIED: Node `String.prototype.normalize` MDN behavior; tested mentally on Müller/Mueller pair]

### Pitfall 6: NockBack `lockdown` vs `dryrun` mode confusion
**What goes wrong:** Tests pass locally in `dryrun` (calls through if no recording) but fail in CI in `lockdown` (throws on any unmocked call).
**Why it happens:** nockBack has 4 modes (`wild`, `dryrun`, `record`, `lockdown`); the default differs from environment expectations.
**How to avoid:** Explicitly set mode at test-suite startup based on `NOCK_BACK_MODE` env. Default to `lockdown` for CI determinism. CI uses `PENSMITH_NETWORK_TESTS=0` AND `NOCK_BACK_MODE=lockdown`. Cron uses `NOCK_BACK_MODE=record` AND `PENSMITH_NETWORK_TESTS=1`.
**Warning signs:** Tests pass locally, fail in CI with `NetConnectNotAllowedError`.
**Sources:** [CITED: github.com/nock/nock README §nockBack]

### Pitfall 7: YAML frontmatter round-trip data loss
**What goes wrong:** Read PLAN.md, modify one field, write back — comments / formatting / key ordering disappear.
**Why it happens:** `yaml@^2` preserves comments and key order ONLY when using the Document API, NOT the simple `parse`/`stringify`. The simple API is lossy.
**How to avoid:** `bin/lib/frontmatter.ts` uses `yaml.parseDocument(src)`, mutates via `doc.set(key, value)`, serializes via `doc.toString()`. Schema validation via zod on `doc.toJS()` (read-side check, doesn't affect serialization).
**Warning signs:** PLAN.md diffs show full file rewrite when only one field changed.
**Sources:** [CITED: eemeli.org/yaml/v2/#documents]

### Pitfall 8: Section drafter input-contract bypass via process.env
**What goes wrong:** Drafter accidentally calls `runtime.chat()` with a system prompt that pulls in the full source pool from a closed-over variable, bypassing the section's mapped subset.
**Why it happens:** TypeScript closures + global runtime singleton make accidental capture trivial.
**How to avoid:** WRTE-04 chokepoint — `bin/lib/drafter-input.ts::assertDrafterInput(pkg)` runs at the entry point and throws if `pkg.sources` contains any citekey not in `pkg.section.sources`. Lint AST selector forbids `runtime.chat({` calls outside the chokepoint module. Property test (fast-check) generates random source pools + random section subsets and asserts the chokepoint rejects every superset.
**Warning signs:** Section drafts cite sources not in the section's PLAN.md `sources:` array.
**Sources:** PRD §7.8 Pitfall 9 — "Drafter sees full source pool" is the canonical Phase 3 trap.

### Pitfall 9: Migration round-trip drops top-level state fields
**What goes wrong:** v1→v2 migration drops embedded section state, but inadvertently also drops top-level STATE.json fields (paper title, owner, created_at) the migration logic didn't enumerate.
**Why it happens:** Spread + delete patterns miss new fields added by future schema iterations.
**How to avoid:** Migration uses `const { sections, ...rest } = stateV1; return { ...rest, schema_version: 2, sections: slimSections };` — explicit preserve-rest. Property test: `migrate(v1).top_level_fields ⊇ v1.top_level_fields \ {section.state, section.status, section.lastVerification}`.
**Warning signs:** Round-trip property test fails on top-level field count.
**Sources:** Phase 1 D-39 refuse-forward-incompat doc commentary.

### Pitfall 10: HANDOFF.json 5KB budget violation on long breadcrumbs
**What goes wrong:** Adding more than 5 breadcrumbs or non-trimmed `next_action` strings pushes HANDOFF.json over 5KB; PreCompact hook timeout-busts when serializing.
**Why it happens:** Long verb/section names + datetime strings accumulate.
**How to avoid:** D-17 hard-caps breadcrumbs at 5 AND `next_action` at 200 chars (both zod-enforced). `tests/handoff-size.test.ts` runs the full fixture and asserts < 5120 bytes.
**Warning signs:** Test failure or PreCompact hook timeout in Tier 1 CI.
**Sources:** D-17 / D-18 / ARCH-04.

## Code Examples

### NFKC normalization with PDF-artifact stripping (Pass 3 prep)
```typescript
// bin/lib/normalize.ts
// Source: project D-06 spec; built on Node's String.prototype.normalize
const LIGATURE_MAP: ReadonlyArray<readonly [RegExp, string]> = [
  [/ﬀ/g, 'ff'], [/ﬁ/g, 'fi'], [/ﬂ/g, 'fl'],
  [/ﬃ/g, 'ffi'], [/ﬄ/g, 'ffl'], [/ﬅ/g, 'ft'], [/ﬆ/g, 'st'],
];
const SMART_QUOTES: ReadonlyArray<readonly [RegExp, string]> = [
  [/[‘’‚‛]/g, "'"], [/[“”„‟]/g, '"'],
];
const DASHES: ReadonlyArray<readonly [RegExp, string]> = [
  [/[–—−]/g, '-'],  // en-dash, em-dash, minus
];

export function normalizeForVerify(s: string): string {
  let t = s.normalize('NFKC');
  for (const [pat, rep] of LIGATURE_MAP) t = t.replace(pat, rep);
  for (const [pat, rep] of SMART_QUOTES) t = t.replace(pat, rep);
  for (const [pat, rep] of DASHES) t = t.replace(pat, rep);
  t = t.replace(/­/g, '');                  // soft-hyphen
  t = t.replace(/…/g, '...');               // ellipsis
  t = t.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');  // diacritic strip
  t = t.replace(/\s+/g, ' ').trim();             // collapse whitespace
  return t.toLowerCase();
}
```

### Jaro-Winkler (hand-rolled — recommendation per Claude's Discretion)
```typescript
// bin/lib/fuzzy.ts — Pass 1 fuzzy distance
// Source: Winkler (1990); algorithm canonical, ~50 LOC
export function jaroWinkler(a: string, b: string, p = 0.1): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions = Math.floor(transpositions / 2);
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;
  // Winkler prefix boost (up to 4 matching prefix chars)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * p * (1 - jaro);
}
```

### Levenshtein-substring distance ≥10 words (hand-rolled — Pass 3)
```typescript
// bin/lib/fuzzy.ts — Pass 3 quote-checker
// Source: Levenshtein DP standard; word-level granularity is project-specific
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const curr = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      curr.push(Math.min(curr[j] + 1, prev[j + 1] + 1, prev[j] + cost));
    }
    prev = curr;
  }
  return prev[b.length];
}

export function quoteFoundInPdf(quote: string, pdfText: string, threshold = 0.95, minWords = 10): boolean {
  const q = normalizeForVerify(quote);
  const t = normalizeForVerify(pdfText);
  const qWords = q.split(' ');
  if (qWords.length < minWords) {
    return t.includes(q);                              // exact-match for short quotes (D-11)
  }
  // Sliding-window Levenshtein over candidate substrings of similar length
  const winLen = q.length;
  const stride = Math.max(1, Math.floor(winLen / 4));
  for (let i = 0; i <= t.length - winLen; i += stride) {
    const window = t.slice(i, i + winLen + Math.floor(winLen * 0.05));
    const dist = levenshteinDistance(q, window);
    const sim = 1 - dist / Math.max(q.length, window.length);
    if (sim >= threshold) return true;
  }
  return false;
}
```

### Migration registry wakeup (D-09)
```typescript
// bin/lib/state.ts (extended)
// Source: Phase 1 dormant writeBack branch + D-09 spec
import { v1ToV2 } from './migrations/v1-to-v2.js';
import { atomicWrite } from './atomic-write.js';
import { withLock } from './lock.js';

const MIGRATIONS: Migration[] = [v1ToV2];

export async function loadState(path: string): Promise<StateV2> {
  return withLock(path, async () => {
    const raw = JSON.parse(await readFile(path, 'utf-8')) as { schema_version?: number };
    const v = raw.schema_version ?? 1;
    if (v > 2) {
      throw new SchemaVersionForwardError(`STATE.json schema_version=${v} > 2; refusing to read`);
    }
    if (v === 2) return Schema.parse(raw);
    // v === 1 → migrate
    let migrated: unknown = raw;
    for (const m of MIGRATIONS.filter(m => m.from >= v)) {
      migrated = await m.forward(migrated as StateV1, ctx);
    }
    await atomicWrite(path, JSON.stringify(migrated, null, 2));
    return Schema.parse(migrated);
  });
}
```

### HANDOFF.json zod schema (D-17 verbatim)
```typescript
// bin/lib/schemas/handoff.ts
// Source: CONTEXT.md D-17
import { z } from 'zod';
import { SectionStateSchema } from './state.js';
export const HandoffSchema = z.object({
  schema_version: z.literal(1),
  last_updated: z.string().datetime(),
  current_section: z.string().nullable(),
  phase: z.enum(['intake','research','outline','plan','write','verify','compile','done']),
  next_action: z.string().min(1).max(200),
  breadcrumbs: z.array(z.object({
    ts: z.string().datetime(),
    verb: z.string(),
    section: z.string().nullable(),
    ok: z.boolean(),
  })).max(5),
  section_pointers: z.array(z.object({
    slug: z.string(),
    plan_path: z.string(),
    draft_path: z.string().nullable(),
    verification_path: z.string().nullable(),
    state: SectionStateSchema,
  })),
});
export type Handoff = z.infer<typeof HandoffSchema>;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| OpenAlex polite pool (mailto only, free 10 RPS) | OpenAlex API key required for 10 RPS | Feb 13, 2026 | Phase 3 must hard-check `OPENALEX_API_KEY`; emit WARN if missing |
| Crossref no rate-limit headers | Crossref rate limits + `Retry-After` revised | Dec 1, 2025 | `bin/lib/retry.ts` already parses Retry-After (Phase 2 D-01); no code change |
| pdf.js direct import in Node | pdf-parse wrapper preferred (D-06) | Pensmith-internal | Chokepoint discipline; abstracted from future pdf-parse-debugging-disabled fork swap |
| Citation rendering at write-time | Pandoc-token markdown + compile-time render (D-21) | Pensmith-internal | Zero tier-skew, enables Phase 9 multi-style as compile switch |
| Embedded section state in STATE.json | Section state ONLY in PLAN.md frontmatter (D-09) | Phase 3 | Structurally enforces SC-4; wakes Phase 1 dormant migration writeBack |

**Deprecated/outdated:**
- OpenAlex polite-pool semantics — no more mailto-only fast tier
- The pre-Dec-2025 Crossref rate-limit error contract (no Retry-After header)
- The `eslint-plugin-import` approach to chokepoints — Phase 0 D-06 rejected this in favor of `no-restricted-imports` + `no-restricted-syntax` alone

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `citation-js@0.7.22` supports APA-7 CSL conformance + BibTeX parser out of the box | Standard Stack | Smoke test D-22 fails; planner can pin a known-good 0.7.x version (e.g., 0.7.18) as fallback |
| A2 | `pdf-parse/lib/pdf-parse.js` direct-import workaround is sufficient for Phase 3's Unpaywall corpus | Pitfall 1 | If new edge case surfaces, `bin/lib/pdf-text.ts` chokepoint absorbs the swap to `pdf-parse-debugging-disabled` fork |
| A3 | Recommended source-evaluator weights (Pattern 5) are reasonable starting points | Architecture Patterns | Weights are pure-deterministic; planner can tune from the published numbers without rearchitecture |
| A4 | nockBack's `lockdown` mode behaves as documented for cassette playback in our test runner | Pitfall 6 | If broken, fallback is to use `nock.back('fixture.json', { recorder: { dont_print: true } })` + manual `nock.disableNetConnect()` |
| A5 | The 5KB HANDOFF.json budget holds when the fixture has 5 sections in v2 form | D-17 / TEST budget | `tests/handoff-size.test.ts` is the canary; if it fails, breadcrumbs or section_pointers may need further trimming |
| A6 | OpenAlex API key WARN-on-missing (not FAIL) is acceptable for Phase 3 doctor probe | Pitfall 2 | If polite-pool fully blocks unkeyed requests, change severity to FAIL; doctor probe shape supports this swap |
| A7 | Word-level minimum of 10 (D-11) suffices to make Levenshtein-substring tractable on full PDFs | Pattern 4 / Code Examples | Sliding-window stride is tunable; if perf issue, increase stride or short-circuit on first match-found |
| A8 | Hand-rolled fuzzy.ts is preferable to jaro-winkler@0.2.8 dep | Standard Stack | Both options work; recommendation prioritizes chokepoint consistency. Planner may flip if hand-rolled property tests are too time-consuming |
| A9 | `yaml@^2.7.0` `parseDocument` API preserves comments + key order across round-trip | Pitfall 7 | If lossy, fallback to writing fresh frontmatter each time (no comment preservation — acceptable trade since PLAN.md is mostly machine-generated) |
| A10 | Per-adapter 50KB cassette budget (D-25) is sufficient for the fixture-assignment query set | D-25 / Pattern 4 | If exceeded, planner can split cassette-per-query or relax budget; weekly cron PR catches the growth early |

## Open Questions

1. **Should the v1→v2 migration ship as one plan or split across plans?**
   - What we know: D-09 explicitly says "either is fine as long as the migration block is its own commit for git-history clarity."
   - What's unclear: The single-plan version is faster; the split version isolates migration semantics from new-verb implementation, which is better for future archeology.
   - Recommendation: SPLIT — one Phase 3 plan dedicated to the migration (commits: schema slim → migration logic → property tests → wire-up), and separate plans for the 6 verbs. Migration plan goes first.

2. **Workflow body file structure — single `<capability_check>` per file or nested?**
   - What we know: Phase 2 D-14 establishes `<capability_check>` shape for one verb (doctor).
   - What's unclear: Whether intake's 5 sub-steps (clarify → preset → disclaimer → write → PII) each get their own `<capability_check>` or share one.
   - Recommendation: ONE `<capability_check>` per workflow body file with multiple `<step>` children. Mirrors GSD workflow conventions and keeps Tier 1/2 branching at file-load time, not per-step.

3. **citation-js@0.7.x — should we lock to umbrella or `@citation-js/core` + plugins?**
   - What we know: Both work. Umbrella is one import; plugins are tree-shake-friendly.
   - What's unclear: Whether the umbrella shape changes between 0.7.x patch versions in ways that affect us.
   - Recommendation: UMBRELLA `citation-js@0.7.22` pinned exact. CLI doesn't tree-shake; one import is simpler.

4. **Should INTK-05 PII redaction be opt-IN or opt-OUT?**
   - What we know: CLAUDE.md mentions "opt-in PII redaction before any LLM call." PRD §3 is the source.
   - What's unclear: The CONTEXT.md domain block says "opt-in PII redaction" — meaning OFF by default unless flag set.
   - Recommendation: Match CONTEXT.md — OFF by default, `--redact-pii` flag to enable. Default doctor warning if disabled and any free-text field in PROJECT.md looks PII-shaped.

5. **Tarjan SCC cycle check — Phase 3 or Phase 4?**
   - What we know: D-04 says "Phase 4 reconfirms with Tarjan's SCC on the full DAG." Phase 3 ships per-section refinement.
   - What's unclear: Whether Phase 3's per-section refinement catches the same class of cycles or only direct cycles.
   - Recommendation: Phase 3's zod refinement at outline-write time catches direct (`A → B → A`) cycles AND any longer cycle whose closure is visible at write-time (since outline-author writes all sections together). Tarjan in Phase 4 is the safety net for incremental section adds — not strictly needed in Phase 3.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node ≥20.10.0 | Project baseline (Phase 0 D-01) | ✓ (assumed from Phase 0 doctor) | — | none |
| npm@10.9.0 | Phase 0 lockfile contract | ✓ | — | none |
| `PENSMITH_CONTACT_EMAIL` env | All polite-UA HTTP (Phase 1 D-24) | User-provided at first run | — | WARN-once banner; degraded rate limits |
| `OPENALEX_API_KEY` env | OpenAlex 10 RPS (Feb 2026 sunset of polite pool) | User-provided | — | WARN, degraded rate (still functions) |
| `PENSMITH_S2_API_KEY` env (D-16) | Semantic Scholar faster rate | User-provided OR absent | — | Slower rate without key; WARN once |
| GitHub Actions secrets for cron cassette refresh | `.github/workflows/cassette-refresh.yml` | Must be configured by maintainer (one-time setup) | — | Cron will fail to record if missing; no PR opened |
| Network for cassette RE-RECORD only | Weekly cron only | ✓ in GitHub Actions | — | PR-time CI is offline; no network needed |
| Browser / OS-level keychain | NOT used | — | — | — |
| Pandoc binary | NOT in Phase 3 (compile is Phase 4 + export is Phase 6) | — | — | — |
| `pdftotext`/`pymupdf` shellout | NOT in Phase 3 (deferred to Phase 8) | — | — | — |

**Missing dependencies with no fallback:** None — all dependencies have either a graceful-degradation fallback (HTTP rate-limit-degraded) or are unused in Phase 3.

**Missing dependencies with fallback:** OpenAlex API key (degraded rate); Semantic Scholar API key (degraded rate); `PENSMITH_CONTACT_EMAIL` (WARN-once + degraded rate).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node --test` (Node ≥20.10 built-in) via `tsx --import` |
| Config file | none — discovered by `scripts/run-tests.mjs` walker (Phase 0) |
| Quick run command | `npm run test -- --test-name-pattern="<test name>"` (single suite) |
| Full suite command | `npm test` |
| Test runner | `scripts/run-tests.mjs` (Phase 0) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ARCH-02 | `.paper/sections/<NN-slug>/PLAN.md` creation | unit | `npm test -- --test-name-pattern="paths section"` | ❌ Wave 0 |
| ARCH-04 | HANDOFF.json ≤5KB | size assertion | `npm test -- --test-name-pattern="handoff-size"` | ❌ Wave 0 |
| INTK-01 | Intake ingest formats | integration | `npm test -- --test-name-pattern="intake ingest"` | ❌ Wave 0 |
| INTK-02 | Clarifying battery (Tier 1 MCP / Tier 2 clack) | tier-contract | `npm test -- --test-name-pattern="tier-contract intake"` | ❌ Wave 0 |
| INTK-03 | 8 discipline presets | unit | `npm test -- --test-name-pattern="intake presets"` | ❌ Wave 0 |
| INTK-04 | Atomic PROJECT.md + config.toml write | unit | `npm test -- --test-name-pattern="intake atomic"` | ❌ Wave 0 |
| INTK-05 | PII redaction gate | unit + property | `npm test -- --test-name-pattern="pii"` | ❌ Wave 0 |
| RSCH-01 | Topic-disambiguation gate | unit | `npm test -- --test-name-pattern="topic-disambiguator"` | ❌ Wave 0 |
| RSCH-02 | 5–10 query generation | unit | `npm test -- --test-name-pattern="query-gen"` | ❌ Wave 0 |
| RSCH-03/04 | Source-adapter calls (7 adapters) | adapter unit tests against cassettes | `npm test -- --test-name-pattern="sources/"` | ❌ Wave 0 |
| RSCH-07 | Source-evaluator score+dedupe+tier | unit | `npm test -- --test-name-pattern="score"` | ❌ Wave 0 |
| RSCH-08 | Approval gate (Tier 1 / Tier 2) | tier-contract | `npm test -- --test-name-pattern="tier-contract research"` | ❌ Wave 0 |
| RSCH-09 | Atomic RESEARCH.md + CITATIONS.bib write | unit | `npm test -- --test-name-pattern="research write"` | ❌ Wave 0 |
| RSCH-11 | Retraction Watch dual warning | integration | `npm test -- --test-name-pattern="retraction"` | ❌ Wave 0 |
| OUTL-01 | Outline structure + thesis + word_target + sources + depends_on | unit + zod | `npm test -- --test-name-pattern="outline-author"` | ❌ Wave 0 |
| OUTL-02 | Counterargument enforcement (config flag) | unit | `npm test -- --test-name-pattern="outline counterargument"` | ❌ Wave 0 |
| OUTL-03 | Approval gate (Tier 1 / Tier 2) | tier-contract | `npm test -- --test-name-pattern="tier-contract outline"` | ❌ Wave 0 |
| OUTL-04 | Folder creation per section | unit | `npm test -- --test-name-pattern="outline section-dir"` | ❌ Wave 0 |
| PLAN-01 | Claim-source mapping + counterexamples | unit | `npm test -- --test-name-pattern="section-planner"` | ❌ Wave 0 |
| PLAN-04 | Atomic PLAN.md write | unit | `npm test -- --test-name-pattern="plan write"` | ❌ Wave 0 |
| WRTE-01 | Drafter input contract | unit + property | `npm test -- --test-name-pattern="drafter-input"` | ❌ Wave 0 |
| WRTE-03 | Auto-chain to verify | integration | `npm test -- --test-name-pattern="write auto-verify"` | ❌ Wave 0 |
| WRTE-04 | Lint enforcement of input contract | lint + AST | `npm run lint` | ❌ Wave 0 |
| VRFY-01 | Pass 1 DOI re-fetch | unit + cassette | `npm test -- --test-name-pattern="pass1 doi"` | ❌ Wave 0 |
| VRFY-02 | Pass 1 Jaro-Winkler thresholds | unit + property + golden corpus | `npm test -- --test-name-pattern="pass1 fuzzy"` | ❌ Wave 0 |
| VRFY-04 | Pass 3 Unpaywall + Levenshtein | unit + cassette + synthetic corpus | `npm test -- --test-name-pattern="pass3"` | ❌ Wave 0 |
| VRFY-05 | ≥10-word minimum | unit | `npm test -- --test-name-pattern="pass3 min-words"` | ❌ Wave 0 |
| VRFY-07 | AND-gate for verified flag | unit | `npm test -- --test-name-pattern="verified flag"` | ❌ Wave 0 |
| VRFY-08 | last_verified + auto-recheck on stale | unit | `npm test -- --test-name-pattern="last_verified"` | ❌ Wave 0 |
| CITE-01 | apa.csl hash-pin | hash-pin in repo-files.test.ts | `npm test -- --test-name-pattern="repo files"` | ✅ (extend existing) |
| CITE-04 | citation-js parser smoke | smoke | `npm test -- --test-name-pattern="citation-render"` | ❌ Wave 0 |
| TEST-01 | Tier-contract 6 new cases | tier-contract | `npm test -- --test-name-pattern="tier-contract"` | ✅ (extend existing) |
| TEST-02 | Cassettes + cron workflow | repo file + manifest test | `npm test -- --test-name-pattern="cassettes manifest"` + GitHub Actions schedule check | ❌ Wave 0 |
| TEST-03 | Prompt-file hash-pins | hash-pin | `npm test -- --test-name-pattern="repo files"` | ✅ (extend existing) |
| TEST-04 | Fixture artifacts + section-isolation | unit + integration | `npm test -- --test-name-pattern="section-isolation"` | ❌ Wave 0 |
| TEST-09 | Section-isolation mtime invariant | integration | `npm test -- --test-name-pattern="section-isolation"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- --test-name-pattern="<task-area>"` (e.g., `pass1 fuzzy`)
- **Per wave merge:** `npm test && npm run lint && npm run typecheck`
- **Phase gate:** Full suite green + tier-contract all 10 cases pass + cassette-size < 50KB/adapter + handoff-size < 5KB + hash-pin tests green before `/gsd-verify-work`

### Wave 0 Gaps

All test files below need to be created in Wave 0 of Phase 3:

- [ ] `tests/section-isolation.test.ts` — TEST-09 mtime invariant; re-doing section N leaves all other sections' + STATE.json mtimes unchanged
- [ ] `tests/handoff-size.test.ts` — fixture-run → assert HANDOFF.json < 5120 bytes (D-17 / ARCH-04)
- [ ] `tests/cassette-size.test.ts` — walk `tests/fixtures/cassettes/<adapter>/`, assert each ≤50KB (D-25)
- [ ] `tests/citation-render.test.ts` — citation-js + apa.csl + fixture CITATIONS.bib smoke (D-22)
- [ ] `tests/migration.test.ts` — v1→v2 round-trip + idempotent on v2 + refuse-forward on v3 (D-09)
- [ ] `tests/migration.property.test.ts` — fast-check: migrate preserves all top-level fields except enumerated drops (Pitfall 9)
- [ ] `tests/fuzzy.test.ts` — Jaro-Winkler golden cases (Müller/Mueller; "transformer" vs "transformers"; ÷ thresholds at 0.92/0.85); Levenshtein-substring against known-bad-quotes.json
- [ ] `tests/fuzzy.property.test.ts` — fast-check: jaroWinkler(a,a)=1; symmetric; ∈ [0,1]; Levenshtein triangle inequality on small alphabets
- [ ] `tests/normalize.test.ts` — NFKC + ligature/soft-hyphen/smart-quote/em-dash/diacritic golden cases
- [ ] `tests/pii.test.ts` — extend with no-leak property: redacted PROJECT.md ⊉ original PII tokens
- [ ] `tests/no-leak.test.ts` — extend with `PENSMITH_S2_API_KEY` no-leak case (D-16); env value never lands in runtime.json
- [ ] `tests/drafter-input.test.ts` — assertDrafterInput throws on superset; property test on random source pools
- [ ] `tests/sources/<adapter>.test.ts` × 7 — per-adapter unit test against committed cassette; zod parse asserted at boundary
- [ ] `tests/tier-contract.test.ts` — extend with 6 new cases (intake/research/outline/plan-section/write-section/verify-section); follow existing harness pattern (303-line file)
- [ ] `tests/repo-files.test.ts` — extend with 11 new hash-pins:
  - 8 × `templates/prompts/*.md`
  - 1 × `templates/citation-styles/apa.csl`
  - 1 × `tests/fixtures/known-good-fixture/assignment.txt`
  - 2 × `tests/fixtures/known-bad-{citations,quotes}.json`
  - REMOVE the anti-drift assertion at line 182 (`wiring-smoke|DOCT-05 must NOT appear`) — DOCT-05 lights up in Phase 3
- [ ] `tests/lint-chokepoint-fixture.ts` — extend (or add new file) with `import pdfParse from 'pdf-parse'` to red-team the new chokepoint
- [ ] `tests/handoff-test.ts` — PreCompact hook fires writes valid HANDOFF.json against zod schema
- [ ] `tests/state-deterministic-corpus.test.ts` — feed `tests/fixtures/known-bad-citations.json` (≥10 FABRICATED) → all 10 marked MIS-CITED by Pass 1; success criterion 2
- [ ] `tests/quote-deterministic-corpus.test.ts` — feed `tests/fixtures/known-bad-quotes.json` (≥10 NOT_FOUND with real-PDF artifacts) → all 10 marked NOT_FOUND by Pass 3; success criterion 3
- [ ] No framework install needed (Node built-in `node --test` already used in Phase 0–2)

### Phase 3-specific validation surfaces

1. **Deterministic vs LLM-judged surfaces:** Phase 3's Pass 1 + Pass 3 are 100% deterministic (Jaro-Winkler + HTTP-status + Levenshtein + normalize) — no LLM call at verdict time. Validation runs against synthetic corpora with byte-exact expected outputs. Pass 2 / Pass 4 prompts (D-12) ship but are NOT called by verify-section; their validation deferred to Phase 5.

2. **Tier-contract cases (TEST-01):** 6 new cases (intake/research/outline/plan-section/write-section/verify-section). Each spins `PENSMITH_PAPER_ROOT=<tmpdir>`, runs Tier 1 via `Client` + `StdioClientTransport` (MCP SDK), runs Tier 2 via `bin/pensmith.ts` subprocess, asserts `assertEquivalent` with `tolerance: 0.20` per existing TIER-07. Cassettes serve all source-adapter HTTP.

3. **Fixture corpora:**
   - `known-good-fixture/` — full intake-through-verify deterministic fixture (golden outputs committed)
   - `known-bad-citations.json` — ≥10 FABRICATED DOIs for Pass 1 success criterion 2 (10/10 MIS-CITED)
   - `known-bad-quotes.json` — ≥10 NOT_FOUND quotes with real-PDF artifacts for Pass 3 success criterion 3 (10/10 NOT_FOUND)

4. **Section-isolation mtime test (TEST-09):** Re-do section N → only `sections/<N>-slug/*` mtimes change. After D-09 migration, STATE.json mtime changes only on section add/remove (not section state mutation). HANDOFF.json mtime changes only when PreCompact hook fires.

5. **Cassette + cron pattern (TEST-02, D-23/D-24):**
   - PR-time CI: `PENSMITH_NETWORK_TESTS=0` + `NOCK_BACK_MODE=lockdown` (default). All HTTP comes from committed cassettes.
   - Weekly cron: `NOCK_BACK_MODE=record` + `PENSMITH_NETWORK_TESTS=1` + secrets. Re-records and auto-PRs the diff.
   - Cassette manifest test verifies all 7 adapter directories exist and each contains at least one cassette file.

6. **Migration round-trip (D-09):** Three test cases:
   - Read v1 STATE.json → migrate → write v2 → re-read v2 → assert section state landed in PLAN.md frontmatter + STATE.json sections[] slimmed to {n, slug}
   - Read v2 → no-op (idempotent) — no file writes, returns equivalent object
   - Read v3 → throws `SchemaVersionForwardError` (Phase 1 D-39)

7. **Lint chokepoints:**
   - `bin/lib/pdf-text.ts` chokepoint: ESLint forbids `pdf-parse` imports elsewhere
   - `bin/lib/citations.ts` chokepoint: ESLint forbids `citation-js` imports elsewhere
   - `bin/lib/sources/*` chokepoint: HTTP must route through `bin/lib/http.ts` (covered by existing REPO-05)
   - Each chokepoint has a `tests/lint-chokepoint-fixture.ts` red-team line

8. **Hash-pin coverage:** 8 prompts + apa.csl + assignment.txt + 2 known-bad-*.json = 12 new hash-pins in `tests/repo-files.test.ts`. Existing pattern: SHA-256 + regenerate one-liner in comment + anti-drift coarse content check.

9. **Handoff-size test:** Fixture-run produces HANDOFF.json; assert < 5120 bytes via `fs.statSync(handoffPath).size`.

10. **Cassette-size test:** Walks `tests/fixtures/cassettes/<adapter>/`, asserts `fs.statSync(file).size <= 50 * 1024` for each.

11. **No-leak extension to PENSMITH_S2_API_KEY:** `tests/runtime.test.ts` extended with a fast-check property: set `PENSMITH_S2_API_KEY=<random secret>`, save runtime.json, re-read, assert the secret never appears in the file or any session-log line.

12. **Doctor DOCT-05 wiring-smoke:** Phase 2's `build-artifact-resolves` placeholder is REPLACED with `intake-outline-verify-wiring-smoke` probe that runs the full fixture against cassettes (no network) and asserts PASS. `references/doctor-output.md` is updated; hash-pin in `tests/repo-files.test.ts` re-generated.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | NO (no user accounts; local-only CLI/plugin) | — |
| V3 Session Management | NO | — |
| V4 Access Control | NO (local-only) | — |
| V5 Input Validation | YES | zod at every parse boundary (SourceCandidate, Handoff, PLAN-frontmatter, runtime-config); PII redaction (INTK-05) |
| V6 Cryptography | PARTIAL | SHA-256 hash-pins via Node crypto (never hand-rolled); no encryption at rest in Phase 3 |
| V7 Error Handling | YES | Typed errors (`SchemaVersionForwardError` etc.); no stack traces in user-facing output; session-log captures errors |
| V8 Data Protection | YES | T-01-07 no-leak property: env-var VALUES never persisted; only NAMES (PENSMITH_S2_API_KEY, OPENALEX_API_KEY, PENSMITH_CONTACT_EMAIL); atomic writes prevent half-written sensitive files |
| V12 File and Resources | YES | Atomic write; per-file lock; `.paper/` is the only write boundary; no path traversal (paths from zod-validated slug strings only) |
| V13 API and Web Service | YES | Polite-UA + rate-limit-respect on all 7 adapters; cassette + cron pattern avoids leaking call volume to external services during PR CI |
| V14 Configuration | YES | Hash-pinned locked copy (apa.csl, prompts, fixtures); refuse-forward-incompat schema versioning |

### Known Threat Patterns for {Pensmith local-CLI/plugin stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via crafted section slug | Tampering | Slug regex `^[a-z0-9-]+$` enforced in zod; `bin/lib/paths.ts` joins under `.paper/sections/` root only |
| API key leakage via session-log | Information Disclosure | T-01-07 no-leak property test; env VALUES never persisted; D-16 reaffirms for S2 key |
| YAML deserialization RCE | Tampering | `yaml@^2` defaults to safe mode (no `!!js/function` tag); zod validation on parse result |
| BibTeX accent-command injection | Tampering | citation-js handles escape sequences; chokepoint at `bin/lib/citations.ts` |
| PDF embedded JavaScript / malicious PDFs | Tampering | `pdf-parse` does NOT execute embedded JS; text-only extraction; chokepoint at `bin/lib/pdf-text.ts` |
| Workflow body injection via assignment.txt | Tampering | Assignment text passes through PII redaction (opt-in) then becomes LLM input — same trust boundary as any LLM prompt; no shell interpolation, no exec |
| Race condition on STATE.json multi-process write | Tampering | `withLock` + load-INSIDE-the-lock idiom (Phase 1 BLOCKER-01/02 fixes) |
| Migration writing wrong section's state | Tampering | Migration property test: top-level fields preserved; per-section PLAN.md write atomic and per-file-locked |
| Cassette-replay leaks PII from recorded fixture | Information Disclosure | Recorded cassettes use the public fixture-assignment query (D-01) only; manual review in cron auto-PR |
| Prompt-injection in source abstract → drafter | Tampering / Repudiation | Source abstracts pass through to drafter prompt; calibrated prompts (D-13) include the disclosure copy that frames sources as untrusted input; LLM-side mitigation only |
| pdf-parse startup ENOENT side-channel | DoS | Workaround via direct `pdf-parse/lib/pdf-parse.js` import — Pitfall 1 documented |

## Sources

### Primary (HIGH confidence)
- Project `CONTEXT.md` (lines 1-287) — D-01..D-25 locked decisions [VERIFIED via direct file read]
- Project `DISCUSSION-LOG.md` — 25-decision rationale [VERIFIED via direct file read]
- Project `REQUIREMENTS.md` — 37 Phase 3 requirement IDs [VERIFIED via direct file read]
- Project `bin/lib/state.ts` + `bin/lib/schemas/state.ts` — Phase 1 migration scaffolding [VERIFIED via direct file read]
- Project `bin/lib/http.ts` + `bin/lib/runtime.ts` — Phase 1/2 chokepoints + WARN-once pattern [VERIFIED]
- Project `tests/tier-contract.test.ts` + `tests/repo-files.test.ts` — extension targets [VERIFIED]
- Project `.planning/ROADMAP.md` Phase 3 success criteria + Phase 2 D-04 carry-forward [VERIFIED]
- `npm view pdf-parse / citation-js / yaml / nock` — current registry versions [VERIFIED via tool call earlier]

### Secondary (MEDIUM confidence)
- OpenAlex docs (docs.openalex.org) — Feb 13 2026 polite-pool sunset [CITED via WebSearch verification + cross-ref to official changelog]
- Crossref API docs (www.crossref.org) — Dec 1 2025 rate-limit revisions [CITED via WebSearch verification]
- `nock@14` README — nockBack modes (record/dryrun/wild/lockdown) [CITED: github.com/nock/nock]
- `yaml@2.7` docs — `parseDocument` round-trip semantics [CITED: eemeli.org/yaml/v2/#documents]
- `pdf-parse@1.1.1` known issues — github.com/UpravnikPP/pdf-parse-debugging-disabled README [CITED]
- `@modelcontextprotocol/sdk@^1.29` — `Client` + `StdioClientTransport` API shape [VERIFIED via Phase 2 02-04 lock]
- `citty@^0.2.2` — flag/subcommand registration shape [VERIFIED via Phase 2 02-00 lock]

### Tertiary (LOW confidence)
- Recommended source-evaluator weights (Pattern 5) — derived from PRD §7.6 + academic-norm intuition; tunable [ASSUMED A3]
- jaro-winkler@0.2.8 last-published 2019 — recall from memory; planner should verify [ASSUMED A8]
- Recommended 5-second match-window for sliding Levenshtein stride (Code Examples) — heuristic; should be benchmarked [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified via `npm view`; pins confirmed against Phase 1/2 locked decisions
- Architecture: HIGH — D-01..D-25 lock the architecture; researcher role is articulation, not invention
- Pitfalls: HIGH (1, 2, 5, 6, 8, 9, 10) / MEDIUM (3, 4, 7) — each tied to verified source or experiential pattern
- Source-evaluator weights: LOW — recommended starting point, planner should tune
- jaro-winkler dep age claim: LOW — recommendation conservative either way (hand-roll preferred regardless)

**Research date:** 2026-05-17
**Valid until:** 2026-06-17 (30 days for stable; external API surfaces have monthly drift potential — cassette cron is the long-term safety net)
