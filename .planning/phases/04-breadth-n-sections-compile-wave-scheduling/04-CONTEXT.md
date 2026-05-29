# Phase 4: Breadth — N sections + compile + wave scheduling - Context

**Gathered:** 2026-05-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 makes pensmith scale from one section (Phase 3's vertical slice) to N sections plus end-to-end compile.

**Delivers:**
1. **Wave scheduler** — honors `depends_on` slug graph, runs siblings in parallel under a `--max-parallel` cap, persists no state of its own (reads from `PLAN.md` frontmatter).
2. **Section mutation** — `/pensmith --revise <N>` rewrites a section's citations after a verification failure; auto-loop on FABRICATED/MIS-CITED/NOT_FOUND is gated behind `--yolo` (PRD §19 approval-gate non-negotiable).
3. **Compile-time staleness** — `verified_against_draft_hash` on `PLAN.md` frontmatter; compile warns and auto-re-verifies stale sections (Phase 3 deterministic Pass 1+3 are HTTP+CPU bound, cheap to re-run).
4. **Compile pipeline** — concatenate sections in **outline order** (not wave order), N-1 per-boundary smoothing passes (read-only on citation markers via placeholder substitution), produce `COMPILE-REPORT.md` with stable schema, refuse on any Pass 1 or Pass 3 deterministic failure.
5. **ARCH-20 path scheme reservation** — letter-suffix directories (`NNl-slug`) reserved as the canonical insertion path. Phase 4 does **not** ship insertion entry points; that belongs to Phase 8.

**Does not deliver:**
- LLM-judged Pass 2 (claim support) or Pass 4 (uncited-load) — those ship in Phase 5 as advisory.
- `/pensmith add` insertion command — Phase 8.
- Export to .docx/.pdf — Phase 6.
- Style-match featurization, GPTZero check, humanizer wrapping — Phase 6/7.

</domain>

<decisions>
## Implementation Decisions

### A. Wave Scheduler (PLAN-02, PLAN-03, ARCH-19)

- **D-01: Wave assignment = hybrid Kahn-with-depth default + per-section OUTLINE.md override.**
  - Default: Kahn's algorithm computes `wave = max(deps.wave) + 1` per section node.
  - Override: a section may declare `wave: N` in its `OUTLINE.md` entry to force a specific wave.
  - **Validation rule:** an explicit override is rejected at outline-write time if `N < max(deps.wave) + 1`. The scheduler refuses to start until the outline is fixed; it does not silently bump.

- **D-02: `--max-parallel` semantics = per-wave concurrency cap with full drain.**
  - Default: `--max-parallel 5`.
  - Tier 1 (Claude Code plugin): honors the flag as-given.
  - Tier 2 (Node CLI): forces `--max-parallel 1` and emits a single WARN log ("Tier 2 runs sections serially; --max-parallel ignored"). The flag is parsed, not error'd, so the same invocation works in both tiers.
  - Each wave drains fully (all started sections reach a terminal state) before the next wave begins. No cross-wave pipelining in Phase 4.

- **D-03: Within-wave failure policy = continue siblings, rollup at wave end.**
  - A failing section does not abort its wave-peers.
  - Wave-end rollup is written to in-memory state, surfaced to the user, and persisted by the per-section verifier (failure verdicts already land in `VERIFICATION.md`).
  - Downstream waves block **only on transitive dep failure** — if a section's `depends_on` includes a section that failed, that downstream section is marked `blocked` and skipped; sections whose deps all passed proceed normally.

- **D-04: Wave-state persistence = read-only from PLAN.md frontmatter; in-memory wave progress only.**
  - Source of truth for "is section N done?" is `state:` in `sections/<N>/PLAN.md` frontmatter (Phase 3 D-08 carry-forward).
  - The scheduler holds an in-memory map of wave → section-list → status during a run; nothing is written to disk by the scheduler itself.
  - Crash recovery: on restart, re-read all `PLAN.md` frontmatter; sections at `state: verified` are skipped, others enqueued by wave. No wave-checkpoint file.

### B. Section Mutation + Staleness (PLAN-02/03, ARCH-19, COMP-04, RSCH-10)

- **D-05: `/pensmith --revise <N>` = LLM-driven citation-swap with outline approval gate.**
  - Input: the section's `VERIFICATION.md` (FABRICATED / MIS-CITED / NOT_FOUND verdicts), its existing source pool from `PLAN.md` frontmatter `sources[]`, and live access to the research adapters (`arxiv`, `crossref`, `pubmed`, `openalex`, `retraction_watch`) so the swap can pull a fresh source if needed.
  - The LLM proposes a citation-set diff (`-citekey_old, +citekey_new`). The diff goes through the **outline approval gate** (PRD §19 non-negotiable). `--yolo` skips the user approval but does not skip the diff write to `VERIFICATION.md`'s audit slot.
  - On approval: section `state:` resets from `verified` → `planned`. `verified_against_draft_hash` is cleared. Writer + verifier re-run for that section only (same code path as a normal section run).

- **D-06: Intra-section auto-loop on FABRICATED/MIS-CITED/NOT_FOUND = `--yolo`-gated only, retry cap = 2.**
  - Default behavior: surface the failure to the user, do nothing. User decides whether to `/pensmith --revise <N>` manually.
  - `--yolo` mode: auto-invoke the **same `--revise` code path** (not a divergent path) up to 2 retries. On retry exhaustion, emit a `RETRY_EXHAUSTED` verdict to `VERIFICATION.md` and surface to user.

- **D-07: `verified_against_draft_hash` input = SHA-256(DRAFT.md raw bytes + sorted JSON of PLAN.md frontmatter `sources[]`).**
  - Concatenation order: DRAFT.md bytes, then a single newline separator, then `JSON.stringify(sources.slice().sort())`.
  - Hash is computed at verifier-write time and stamped on `PLAN.md` frontmatter (Phase 3 D-10 carry-forward — this lock pins the *input shape*).

- **D-08: Compile-staleness policy = warn + auto-re-verify affected sections only.**
  - Compile recomputes each section's hash from current `DRAFT.md` + current `sources[]`. If `verified_against_draft_hash` mismatches, the section is stale.
  - Compile emits `WARN: section <N> stale — re-verifying` and runs Pass 1 + Pass 3 (Phase 3 deterministic, no LLM cost) on that section.
  - **All re-verifications pass:** compile continues; `COMPILE-REPORT.md` records the re-verify event in the "Compile-Staleness Resolved" section.
  - **Any re-verification fails:** compile refuses with the new verdict surfaced. Behaves identically to a fresh Pass 1/3 failure at compile time.

- **D-09: `/pensmith --research` output = project-level append + per-section provenance log.**
  - Project-level: append findings to `.paper/RESEARCH.md` and merge new entries into `.paper/CITATIONS.bib` (Phase 3 D-19/D-20 carry-forward — single project bib).
  - Per-section: each invocation appends a provenance entry to `sections/<N>/RESEARCH-LOG.md` (query, adapter, hit-count, citekeys-added, timestamp). This is the only section-level file `--research` creates.
  - BibTeX entries gain a `from_section: <N>` annotation in a non-standard field so future tooling can attribute discovery without breaking standard parsers.

### C. Compile Contract (COMP-01..07, WRTE-02)

- **D-10: COMP-01 refuse-logic scope = Pass 1 OR Pass 3 deterministic failure only.**
  - "Bad citation" at compile time means: any section has a FABRICATED, MIS-CITED, or quote-NOT_FOUND verdict in `VERIFICATION.md` from Pass 1 (DOI/author/title fuzzy match) or Pass 3 (deterministic quote-presence).
  - Pass 2 (LLM claim support) and Pass 4 (LLM uncited-load) ship in Phase 5 as **advisory** verdicts. They populate the COMPILE-REPORT advisory slot. They do **not** block compile in Phase 4 or Phase 5.

- **D-11: COMP-02 concatenation order = outline order.**
  - Sections are concatenated in the order defined by `.paper/OUTLINE.md`, not in wave order. Wave order is an execution detail; outline order is the reader's experience.
  - The compiler reads `OUTLINE.md`, validates that every outline entry has a matching `sections/<N>/DRAFT.md`, then concatenates.

- **D-12: COMP-03 smoothing = N-1 per-boundary LLM calls.**
  - For an N-section paper, the smoother makes N-1 calls. Each call receives: last paragraph of section K, first paragraph of section K+1, and a section-role metadata tuple `{role_K, role_K+1}` pulled from `OUTLINE.md` (e.g., `{intro, lit_review}`, `{methods, results}`).
  - Output: a replacement for the last-para(K) and a replacement for the first-para(K+1). The compiler stitches the replacements back in. No cross-boundary state is shared between smoother calls.

- **D-13: COMP-03 citation-marker invariant = placeholder substitution + deterministic post-validation.**
  - Pre-call: every Pandoc citation token (`[@citekey]`) in the smoother's input is replaced with `{{cite_K_M}}` placeholders where K is the section index and M is the within-section marker index.
  - The smoother prompt is told these are opaque tokens that must be preserved exactly.
  - Post-call: deterministic check that the output token-set equals the input token-set. **Any mismatch** (added, removed, reordered, or rewritten) → smoothing is rejected for that boundary, the original prose is kept, and a `SMOOTHING_REJECTED` flag is written to `COMPILE-REPORT.md` for that boundary. Compile does not refuse on smoothing rejection — smoothing is best-effort prose; citations are the invariant.
  - Mutations to citation identity, count, or order are out of scope for compile and route exclusively through `--revise`.

- **D-14: COMP-07 COMPILE-REPORT.md schema = stable v1, additive-forward.**
  - **YAML frontmatter (reserved keys):**
    - `schema_version: 1`
    - `compiled_at: <ISO-8601>`
    - `sections_count: <N>`
    - `stale_resolved_count: <int>`
    - `refuse_reasons: [<list>]` — empty array on success
    - **Pandoc-reserved keys** (Phase 6 export reads these directly, Phase 4 writes empty strings): `title`, `author`, `abstract`
  - **Body — 5 sections, fixed order:**
    1. `## Transitions Changed` — one entry per N-1 boundary: `{boundary: K→K+1, status: smoothed|rejected|skipped, before_chars, after_chars}`
    2. `## Cross-Section Consistency Flags` — terminology drift, abbreviation collisions, tense shifts; populated by a deterministic post-concat scan (lock the scan rules at plan-phase)
    3. `## Citation Density` — per-section `{citations_per_1000_words}` plus paper-wide mean and stdev
    4. `## Compile-Staleness Resolved` — one entry per stale section: `{section, prior_hash, new_hash, re_verify_passed: bool}`
    5. `## Advisory Findings` — **reserved slot for Phase 5's Pass 2/4 output.** Phase 4 writes the header and an explicit empty marker (`_No advisory passes ran — Phase 5 will populate._`).
  - **Forward-compatibility rule:** Phase 5 and Phase 6 append new entries inside the reserved slots; they do **not** bump `schema_version`. A version bump means a breaking change to a reserved key's *shape*, not the addition of content.

### D. Path Scheme Reservation (ARCH-20)

- **D-15: Letter-suffix path scheme reserved; no insertion entry points ship in Phase 4.**
  - Reserved directory naming: `sections/NN<letter>-<slug>/` (e.g., `03b-related-work-addendum`).
  - Lexicographic sort: `03b` sorts between `03` and `04` (verified: `'03' < '03b' < '04'` under standard string compare).
  - **Phase 4 obligations:** any path-walking code (`OUTLINE.md` reader, compile section discovery, scheduler dep-resolver) must tolerate letter-suffix directory names without error. No special-case logic — they sort correctly by default under lexicographic ordering.
  - **Phase 4 non-obligations:** no `/pensmith add` command, no outline-mutation entry points, no renumber-on-insert vs. stable-numbering decision. Those defer entirely to Phase 8.

### Claude's Discretion

The user delegated four sub-decisions to me during the discussion. These are locked above:
- D-02 `--max-parallel` exact default → set to 5 (matches typical N for academic papers)
- D-09 `--research` output shape → project-level append + per-section provenance
- D-12 Smoothing strategy granularity → per-boundary (not whole-paper) for token-cost and isolation
- D-14 COMPILE-REPORT schema → 5-section body + Pandoc frontmatter

Areas remaining where Claude has flexibility during plan-phase:
- Exact LLM prompt wording for the smoother (must enforce placeholder-token invariant)
- Exact LLM prompt wording for `--revise` citation-swap (must produce a parseable diff)
- Cross-section consistency scan rules (terminology, abbreviation, tense)
- Wave-state in-memory data structure
- Concurrency primitive choice (Promise.all + p-limit, async queue, etc.)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Source of truth
- `PRD.md` §7.7 — Verifier passes (Pass 1 deterministic DOI+fuzzy, Pass 2 LLM advisory, Pass 3 deterministic quote, Pass 4 LLM advisory). Pass 1+3 deterministic; Pass 2+4 ship Phase 5.
- `PRD.md` §7.8 — Compile semantics. Concatenate, smooth read-only, refuse on bad citations, emit COMPILE-REPORT.
- `PRD.md` §14 — Pass 1 fuzzy mandate. Author/title fuzzy match is part of Pass 1.
- `PRD.md` §17 — Open questions GSD resolves at discuss-phase (this document closes several for Phase 4).
- `PRD.md` §19 — Non-negotiables: verifier-blocks-compile-and-export, single-command UX, approval-gates-default-on, section-as-phase, two-tier, no exported-document trace, honest detection framing.
- `CLAUDE.md` — Project mental model and non-negotiables. Section-as-phase is load-bearing.

### Requirements
- `.planning/REQUIREMENTS.md` — ARCH-19 (wave scheduler), ARCH-20 (letter-suffix path scheme), PLAN-02 (depends_on slug graph), PLAN-03 (--revise mutation), WRTE-02 (DRAFT.md Pandoc tokens), RSCH-10 (research adapter access from --revise), COMP-01..07 (compile contract).

### Roadmap + state
- `.planning/ROADMAP.md` Phase 4 — confirms scope: "Wave scheduler honors depends_on; compile concatenates sections in outline order, runs cross-section smoothing read-only on section files, produces consistency flags (never edits), refuses on FABRICATED/MIS-CITED/quote-NOT_FOUND. Stable section numbering with letter suffixes is locked."
- `.planning/STATE.md` — current progress and Phase 3 close-out.

### Phase 3 carry-forward decisions (load-bearing)
- `.planning/phases/03-vertical-slice-one-section/03-CONTEXT.md` — read in full. Specifically:
  - **D-03/04/05** — depends_on uses **slugs**, not numeric IDs. Wave scheduler resolves slugs against OUTLINE.md.
  - **D-08** — section state lives **only** in `sections/<N>/PLAN.md` frontmatter. Scheduler is read-only against it.
  - **D-10** — `verified_against_draft_hash` lives on PLAN.md frontmatter. D-07 above pins its input shape.
  - **D-11** — Jaro-Winkler thresholds (title ≥ 0.92, author ≥ 0.85). Pass 1 fuzzy match definition.
  - **D-12/D-13** — All 8 verifier prompt files are hash-pinned at `templates/prompts/*.md`. Phase 3 ships Pass 1+3 deterministic only; Pass 2+4 prompts ship dormant.
  - **D-17/D-18** — HANDOFF.json schema is for **project-level** intake → research → outline. **No** intra-section HANDOFF; PLAN.md frontmatter + DRAFT.md + VERIFICATION.md are the contract.
  - **D-19/D-20** — single project-level `.paper/CITATIONS.bib`. No per-section bib files.
  - **D-21** — DRAFT.md uses Pandoc tokens `[@citekey]`. Rendering happens at compile (which is *this* phase).
  - **D-23/D-24/D-25** — cassette + weekly cron-refresh + ≤50KB/adapter testing pattern.

### Existing code (Phase 3 outputs to reuse, not re-design)
- `bin/lib/state.ts` — PLAN.md frontmatter read/write with `withLock`. Scheduler reads via this module.
- `bin/lib/sources/{arxiv,crossref,pubmed,openalex,retraction_watch}.ts` — research adapters. `--revise` calls these.
- `bin/lib/verify/pass1.ts`, `bin/lib/verify/pass3.ts` — deterministic verifiers. Compile-staleness re-verify uses these directly (no Pass 2/4 invocation in Phase 4).
- `bin/lib/handoff.ts` — project-level HANDOFF.json reader/writer. **Not** consumed inside sections.
- `mcp/server.ts` — Tier 1 MCP surface. Wave scheduler is exposed here for `/pensmith` orchestration.
- `hooks/` — SessionStart / PreCompact / PostToolUse. May need a hook for wave-progress streaming.
- `bin/pensmith.ts` — Tier 2 CLI entry. Adds `--revise` and `--research` subcommands; forces `--max-parallel 1`.
- `templates/prompts/*.md` — Phase 3-hash-pinned. Phase 4 adds smoother prompt and `--revise` swap prompt, both hash-pinned at plan-phase.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `bin/lib/state.ts` `withLock()` — atomic PLAN.md frontmatter writes. Scheduler and `--revise` use it; no new locking primitive needed.
- `bin/lib/verify/pass1.ts` + `bin/lib/verify/pass3.ts` — already deterministic, already idempotent. Re-running them during compile-staleness resolution is a single function call per section, no state ceremony.
- `bin/lib/sources/*.ts` — five adapters already wired with cassette playback. `--revise` reuses them; no new adapter code in Phase 4 unless RSCH-10 plan-phase research surfaces a gap.
- `bin/lib/handoff.ts` atomic-write helper — pattern reusable for COMPILE-REPORT.md and RESEARCH-LOG.md appends.
- Pandoc citation token convention from D-21 — smoothing placeholder substitution can be implemented as a regex pass over the same `[@citekey]` tokens.

### Established Patterns
- **State isolation by directory.** `sections/<N>/` is the unit. Scheduler and compile orchestrate across N folders but never reach into another section's folder during a single section's run. Inter-section coordination is via OUTLINE.md (read-only) and PLAN.md frontmatter (read-only from scheduler's perspective).
- **Atomic-write-with-lock for every state-bearing file.** PLAN.md, VERIFICATION.md, DRAFT.md (when writer touches it), COMPILE-REPORT.md, RESEARCH-LOG.md all follow the same pattern. No partial writes on crash.
- **Hash-pinned prompts.** Any new LLM-calling code (smoother, `--revise`) adds a prompt file at `templates/prompts/*.md` with content hash recorded. Prompts loaded at runtime by hash, not by name.
- **Tier-divergence at the entry point only.** Wave scheduler logic is single-implementation; tier difference is forced via `--max-parallel 1` cap. Tier-contract test (Phase 2) is the merge gate.
- **Cassette + cron-refresh testing.** Phase 4 tests against `tests/cassettes/`; weekly cron refreshes them; per-adapter cassette ≤50KB.

### Integration Points
- **OUTLINE.md ↔ Scheduler.** Scheduler reads outline, resolves `depends_on` slugs to wave indices, validates `wave:` overrides at outline-write time (D-01).
- **PLAN.md frontmatter ↔ Scheduler.** Read-only source of section state and `verified_against_draft_hash` (D-04, D-07).
- **VERIFICATION.md ↔ `--revise`.** `--revise` input = the section's most recent VERIFICATION.md verdict set + sources[] (D-05).
- **Pass 1/3 ↔ Compile.** Compile-staleness resolver invokes `verify/pass1.ts` + `verify/pass3.ts` per stale section (D-08).
- **`templates/prompts/smoother.md` (NEW) ↔ Compile.** Hash-pinned at plan-phase. Smoother prompt enforces placeholder-token invariant (D-13).
- **`templates/prompts/revise-swap.md` (NEW) ↔ `--revise`.** Hash-pinned at plan-phase. Produces a parseable citekey diff.
- **`.paper/CITATIONS.bib` ↔ `--research`.** Project-level append with `from_section:<N>` annotation (D-09; Phase 3 D-19/D-20 carry-forward).
- **MCP surface ↔ Wave scheduler.** Tier 1 exposes scheduler progress through MCP; Tier 2 runs serially in-process.

</code_context>

<specifics>
## Specific Ideas

- **Smoother must never see citekeys.** Placeholder substitution `[@key]` → `{{cite_K_M}}` is a hard invariant. The post-call token-set equality check is the trip-wire; failure = reject smoothing, keep original prose, flag in report. This is *the* mechanism that makes "smoothing is read-only on citations" a code-enforceable property instead of a prompt-engineering hope.

- **Compile order ≠ wave order.** A common implementation mistake is to compile in wave order because that's what the scheduler emitted. The reader experiences outline order. Two distinct iterators.

- **Scheduler holds no on-disk state.** Resist the temptation to write `wave-progress.json`. PLAN.md frontmatter is the truth; a crash mid-wave should leave the project in a state that re-reading frontmatter recovers exactly.

- **`--yolo` cap of 2 retries.** Not 3, not "until success." Two retries is the budget for "the verifier flagged a citekey typo the LLM can swap." Anything more is a structural problem that wants human eyes.

- **`schema_version: 1` is a contract.** Phase 5 (advisory passes) and Phase 6 (export) extend the schema by populating reserved slots — they do not bump the version. Bumping the version is reserved for breaking changes to a reserved key's shape.

- **Letter-suffix sort is free.** `'03' < '03b' < '04'` is true under string compare with no special-case code. Any reader that uses lexicographic directory ordering inherits insertion-correctness for free. Verify in plan-phase that no path-walking code does `parseInt(dirname)` anywhere.

</specifics>

<deferred>
## Deferred Ideas

- **Pass 2 (LLM claim support) and Pass 4 (LLM uncited-load) wiring** — Phase 5. Phase 4 reserves the COMPILE-REPORT advisory slot but does not invoke these passes. Prompts are already hash-pinned dormant (Phase 3 D-12/D-13).
- **`/pensmith add` insertion command** — Phase 8. Phase 4 only reserves the letter-suffix path scheme.
- **Section-renumber-vs-stable-numbering policy choice** — Phase 8 (with insertion).
- **Export to .docx/.pdf** — Phase 6. Compile produces a Markdown manuscript + COMPILE-REPORT; export consumes both.
- **Style-match featurization, GPTZero scoring, humanizer wrapping** — Phase 6/7.
- **RSCH-10 exact auto-recheck timing** — surfaced at plan-phase. Question: does `--revise` re-fetch every adapter the original section used, or only adapters relevant to the failed citation's discipline? Deferred to research/planning.
- **Cross-section consistency scan rules** — Phase 4 writes the COMPILE-REPORT section header and a deterministic scan implementation; the *exact rules* (which terminology checks, which abbreviation conflict heuristics, which tense-shift detector) are locked at plan-phase, not here.
- **Wave-progress streaming via hooks** — possibly via a PostToolUse hook for Tier 1. Plan-phase decides whether it's a hook, an MCP notification, or stdout-only.

</deferred>

---

*Phase: 4-Breadth-N-Sections-Compile-Wave-Scheduling*
*Context gathered: 2026-05-29*
