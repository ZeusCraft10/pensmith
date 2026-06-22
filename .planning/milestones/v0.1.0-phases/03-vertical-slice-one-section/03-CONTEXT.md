# Phase 3: Vertical slice through one section - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

A **single fixture assignment** runs end-to-end through `intake → research → outline → plan → write → verify` on **ONE section** in both Tier 1 (Claude Code plugin / MCP) and Tier 2 (portable Node CLI), proving the **section-as-phase invariant** before scaling to N sections. **Deterministic Pass 1 + Pass 3 only. APA only.** This is the slice that turns Phase 0–2 scaffolding into a working paper-writer for one cell of the matrix.

**Concretely in scope:**
- Intake pipeline (`pensmith new`): assignment ingest (`@file.pdf|md|txt`, paste, piped stdin), AskUserQuestion clarifying battery, 8 discipline presets, disclaimer print, atomic `.paper/PROJECT.md` + `.paper/config.toml` write, opt-in PII redaction before any LLM call
- Research pipeline (`pensmith research`): topic-disambiguation gate, 5–10 query generation, source-adapter calls to OpenAlex / Crossref / arXiv / PubMed / Semantic Scholar / Unpaywall / Retraction Watch (parallel Tier 1, sequential Tier 2), source-evaluator scoring + dedupe + tiering, approval gate, atomic write of `.paper/RESEARCH.md` + `.paper/CITATIONS.bib` with per-source `last_verified` timestamps
- Outline pipeline (`pensmith outline`): section structure with thesis + word target + per-section source-mapping + `depends_on` slugs, counterargument enforcement (configurable), approval gate (default-on), numbered `.paper/sections/<NN-slug>/` folder creation with stub `PLAN.md`
- Plan-section pipeline (`pensmith plan <N>`): claim-source mapping, counterexample identification, atomic write of `.paper/sections/<N>/PLAN.md`
- Write-section pipeline (`pensmith write <N>`): drafter receives ONLY this section's mapped sources + PLAN.md + voice hint (no full source pool), auto-chains to verify unless `--no-verify`, runtime + lint enforcement of input-contract chokepoint (Pitfall 9)
- Verify-section pipeline (`pensmith verify <N>`): **Pass 1 deterministic** (DOI/arXiv/PMID re-fetch + Jaro-Winkler author/title fuzzy match) + **Pass 3 deterministic** (OA full-text via Unpaywall, tiered exact → Levenshtein-≥0.95 substring with NFKC + ligature/soft-hyphen/smart-quote/diacritic stripping, ≥10-word minimum for fuzzy); `verified` flag set only when both clean; `last_verified` per citation; auto-recheck on stale
- DOCT-05 carry-forward from Phase 2 (per Phase 2 D-04): the build-artifact placeholder is **replaced** with a real intake/outline/verify wiring-smoke probe against a tiny known-good cassette fixture
- APA-7 only: bundle `templates/citation-styles/apa.csl` (hash-pinned); citation-js (pinned exact) as **parser** (BibTeX → CSL-JSON) — **no write-time rendering**; DRAFT.md keeps Pandoc-style `[@citekey]` tokens
- Tier-contract test gains 6 new cases (intake, research, outline, plan-section, write-section, verify-section) — required CI check from Phase 2 forward
- Source-adapter cassettes: `tests/fixtures/cassettes/<adapter>/` committed + weekly cron-refresh workflow (forward-port of TEST-V2-02)
- Verifier-subagent prompt files: `templates/prompts/{intake-clarifier,topic-disambiguator,source-evaluator,outline-author,section-planner,section-drafter,pass1-fuzzy-judge,pass3-quote-checker}.md` — hash-pinned in `tests/repo-files.test.ts`
- Fixture artifacts: `tests/fixtures/known-bad-citations.json` (≥10 fabricated DOIs), `tests/fixtures/known-bad-quotes.json` (≥10 NOT_FOUND, ≥5 with real PDF artifacts), `tests/fixtures/known-good-fixture/` (golden intake-outline-verify fixture), `tests/fixtures/cassettes/` (adapter recordings), `tests/section-isolation.test.ts` (mtime invariant)
- `bin/lib/state.ts` v1 → v2 forward migration: drop embedded `state`/`status`/`lastVerification` from project-level `SectionEntrySchema` so section state lives **only** under `.paper/sections/<NN-slug>/PLAN.md` frontmatter (this becomes the migration registry's first real entry; the dormant `writeBack` branch from Phase 1 line 30 wakes up)
- `bin/lib/http-mock.ts` ships in the production tree so the Phase 2 SKIP-only `http-crossref-ping` probe re-enables PASS/FAIL (closes Codex iter-1 cross-AI review concern from 02-05)

**Explicitly OUT of scope (hard fence for plan-phase):**
- Pass 2 (LLM-judged claim-support) and Pass 4 (paragraph orphan-claim audit) — Phase 5
- N-section breadth, wave scheduler, compile pipeline, cross-section smoothing — Phase 4
- Section-renumbering policy + letter-suffix `03b-` notation — Phase 4 ARCH-20
- Citation styles beyond APA-7 — Phase 9 multi-style polish
- Export pipeline, `.docx`/`.pdf`/`.tex`/`.md` writers, zero-trace export gate, humanizer wrap, GPTZero score, plagiarism check — Phase 6
- BYO PDF ingestion via `pdf-parse` for **arbitrary user PDFs** — Phase 8 (Phase 3 ships `pdf-parse` for **Unpaywall OA PDFs only**; full RSCH-05 BYO + Crossref hydration + `pymupdf` shellout fallback stays Phase 8)
- Style-match (`STYLE.json`) — Phase 8; section drafter Phase 3 only receives PLAN.md + sources + voice hint
- `/pensmith sketch` thinking-partner mode — Phase 8
- `/pensmith add <doi|pdf|url>` mid-paper ingest — Phase 8
- Bare `/pensmith` state-aware routing — Phase 7
- Educator/tutorial mode (`goal=learning` annotated provenance) — Phase 9
- Cassette refresh against live APIs at PR-time — only the weekly cron workflow re-records

</domain>

<decisions>
## Implementation Decisions

### A. The fixture assignment + golden section pick

- **D-01: Single fixture assignment is the PRD §15 smoke test verbatim.** Assignment text: `"Write a 1500-word literature review on attention mechanisms in transformers, APA style."` Stored once at `tests/fixtures/known-good-fixture/assignment.txt`; all six tier-contract cases (intake → verify) consume this same input. Topic chosen because it has dense OA Crossref/arXiv coverage (Vaswani et al. 2017 + downstream), known retracted papers don't pollute the result set, and 1500 words at ~5 sections × 300 words/section gives natural multi-section structure for Phase 4 to scale into.
- **D-02: Golden section = middle section, NOT section 1.** Outline produces ~5 sections; the slice exercises a middle section (likely "Architectural variants" or "Cross-modal extensions"). Section 1 is intro-only — too thin to exercise full claim-source mapping. Middle section catches `depends_on` resolution (must reference an earlier section's thesis) AND exercises the section-isolation invariant non-trivially (re-doing middle leaves both ends untouched). Tier-contract Pass 1/3 fixtures are computed against this section's drafted citations.

### B. Section-dependency contract (`depends_on`)

- **D-03: Slug-based `depends_on` only.** PLAN.md frontmatter declares `depends_on: [<slug>, ...]` referencing other section slug names (e.g., `depends_on: [01-introduction]`). Slug-based — NOT integer-based — so Phase 4's letter-suffix policy (ARCH-20: `03b-validity-threats/`) drops in without contract churn. Empty array means "no upstream sections."
- **D-04: Three schema refinements ship with `depends_on` v1.** (1) No self-reference (zod refinement: `slug` MUST NOT appear in own `depends_on`); (2) No cycles (zod cross-section refinement at outline-write time; Phase 4 reconfirms with Tarjan's strongly-connected-components on the full DAG); (3) Every referenced slug MUST resolve to an existing `.paper/sections/<slug>/` folder at outline-time (fail-fast at OUTL-04, not deferred to wave-schedule time). All three are blocking — outline write refuses on violation.
- **D-05: `depends_on` is hard-dep only in v1.** No `depends_on_soft` flavor. If a Phase 4 use case for advisory hints emerges, the field name is reserved for an additive non-breaking extension. Phase 3 ships exactly one declaration kind to keep the wave-scheduler interface simple.

### C. Pass 3 PDF-parsing scope (the "OA full-text via Unpaywall" verb)

- **D-06: Hybrid scope — `pdf-parse` (pinned exact) for Unpaywall OA PDFs + synthetic plaintext fixtures for adversarial artifacts.** Phase 3 ships:
  - `bin/lib/pdf-text.ts` chokepoint that wraps `pdf-parse@^1.1.1` pinned-exact (matches Phase 1 D-07 chokepoint discipline), with a single `extractText(buffer): Promise<string>` API. Lint forbids direct `pdf-parse` imports outside this module (REPO-05 pattern extension).
  - Unpaywall adapter (in `bin/lib/sources/unpaywall.ts`) returns the OA PDF URL; `bin/lib/http.ts` fetches; `pdf-text.ts` extracts; Pass 3 normalizes (NFKC, soft-hyphen strip, ligature decompose, smart-quote canonical, em-dash/ellipsis canonical, diacritic strip via NFD→strip Mn→NFC); tiered match (exact → Levenshtein ≥0.95 substring, ≥10 words).
  - Adversarial fixtures at `tests/fixtures/known-bad-quotes.json` are **synthetic plaintext** carrying real-PDF artifacts (`ﬁ` U+FB01, `­` soft-hyphen, `‘`/`’` smart quotes, `…` ellipsis, `é` é, em-dash, en-dash). The 10/10 NOT_FOUND requirement (success criterion 3) runs against this synthetic corpus, NOT against parsed PDFs — so the test is deterministic regardless of pdf-parse version, cassette refresh state, or Unpaywall availability.
- **D-07: `pymupdf` shellout fallback + BYO PDF + Crossref hydration stay Phase 8.** RSCH-05 splits in REQUIREMENTS.md: Phase 3 gets the **Unpaywall OA PDF + pdf-parse subset** (RSCH-05a); Phase 8 keeps the **arbitrary BYO PDF + pymupdf shellout fallback + Crossref hydration superset** (RSCH-05b). One sentence added to REQUIREMENTS.md's traceability table; no requirement IDs renumbered.

### D. Section state — minimal vs Phase 4 (resolves the latent two-homes drift)

- **D-08: Section state lives ONLY under `.paper/sections/<NN-slug>/PLAN.md` YAML frontmatter.** Schema (Phase 3 v1): `state: 'planned' | 'writing' | 'written' | 'verifying' | 'verified' | 'failed'`, plus `thesis: string`, `word_target: number`, `sources: <citekey>[]`, `depends_on: <slug>[]`, `last_verification: { verdict, timestamp, draft_hash }?`. Source of truth for one section's state is one file in one directory — section-as-phase non-negotiable enforced structurally (ROADMAP.md SC-4: "section state lives only under `.paper/sections/<NN-slug>/`").
- **D-09: Bundled v1 → v2 forward migration in `bin/lib/state.ts`.** The dormant migration registry (Phase 1 `bin/lib/state.ts` line 30: "Today the migration registry is empty so the writeBack branch is dormant") gets its first real entry. **Drop** `state`, `status`, `lastVerification` from project-level `SectionEntrySchema` (currently lines 28–53 of `bin/lib/schemas/state.ts`). After migration, project-level `STATE.json` `sections[]` carries `{ n, slug }` only — pointers, not state. Reading a v1 `STATE.json` triggers the migration: the loader reads the embedded section state, writes it into the corresponding `sections/<NN-slug>/PLAN.md` frontmatter (atomic-write-protected), then writes back the project-level file with the slimmed schema and `schema_version: 2`. Idempotent on already-migrated files. Phase 1 D-39 refuse-forward-incompat is unaffected: v2 readers see v1 and migrate; v1 readers see v2 and refuse.
- **D-10: `verified_against_draft_hash` field stays on PLAN.md frontmatter, not on project-level STATE.json.** Phase 3 introduces it in `last_verification.draft_hash` so the section-isolation mtime test (TEST-09) doesn't have a side-channel back to STATE.json. Phase 4 compile-staleness detection (ARCH-19) reads frontmatter, not STATE.

### E. Verifier-subagent prompts + Pass 1 fuzzy-match thresholds

- **D-11: Jaro-Winkler with prefix-weighted boost; thresholds locked.** Pass 1 author/title fuzzy match (VRFY-02) uses **Jaro-Winkler** (academic citation industry standard; prefix-weighted handles author-name ordering and title-prefix matches gracefully). Implementation: pure-JS `jaro-winkler@^0.2.8` pinned exact (matches Phase 1 dep-pin discipline) or a hand-rolled ≤80-line implementation at `bin/lib/fuzzy.ts` (decision deferred to plan-phase researcher; both are acceptable). Both inputs NFKC-normalized + diacritic-stripped + lowercased before comparison.
  - **Title threshold: ≥0.92** (Jaro-Winkler distance). Below → MIS-CITED.
  - **Author threshold: ≥0.85** (Jaro-Winkler distance, computed against the **first listed author's surname**; full-author-list comparison is fragile across BibTeX/Crossref formatting variance). Below → MIS-CITED.
  - **AND-gate, not OR-gate**: a citation passes Pass 1 fuzzy only when title ≥ 0.92 AND author ≥ 0.85. DOI integrity (Pass 1 fetch returning 200 + correct metadata field-presence) is necessary; fuzzy match is sufficient over necessity (per PRD §14).
  - Year mismatch is **soft** in Phase 3 (logged as a Pass 2 advisory candidate for Phase 5, never blocks Pass 1).
- **D-12: Prompt files in `templates/prompts/*.md`, one per subagent role, hash-pinned in `tests/repo-files.test.ts`.** Eight prompt files ship:
  1. `intake-clarifier.md` — AskUserQuestion battery + discipline-preset selection
  2. `topic-disambiguator.md` — tiny pre-research subagent (RSCH-01)
  3. `source-evaluator.md` — RSCH-07 score + dedupe + tier
  4. `outline-author.md` — OUTL-01 section-structure + thesis + word_target + source-mapping + depends_on
  5. `section-planner.md` — PLAN-01 claim-source mapping + counterexample identification
  6. `section-drafter.md` — WRTE-01 with input-contract reminder ("you receive ONLY this section's mapped sources + PLAN.md + voice hint")
  7. `pass1-fuzzy-judge.md` — VRFY-02 advisory framing for Pass 5 deferral (Phase 3 uses ONLY the deterministic Jaro-Winkler thresholds from D-11; this prompt ships dormant for Phase 5's LLM-judged Pass 2)
  8. `pass3-quote-checker.md` — VRFY-04 advisory framing (same pattern; Phase 3 Pass 3 is deterministic Levenshtein, prompt dormant for Phase 5)
  Each file follows the SHA-256 hash-pin pattern from D-18 / D-24 / IN-03 (Phase 2 `references/doctor-output.md` + `references/http-warnings.md`). PR diff makes any change visible.
- **D-13: Phase 3 prompts are CALIBRATED to deterministic gates, not advisory LLM judgment.** The eight prompt files capture the **interaction contract** between the workflow body and the subagent (input shape, output shape, verbatim disclosure copy, examples). Pass 1 and Pass 3 verdicts in Phase 3 are computed deterministically from regex/HTTP/string-distance code; the prompts are NOT consulted at verdict time. Phase 5 wires the LLM-judged passes through the same prompts. This split keeps Phase 3 acceptance criteria fully deterministic (success criterion 2 = "10/10 FABRICATED" is byte-exact).

### F. Source-adapter API surface

- **D-14: Unified `SourceCandidate` zod schema; each adapter exports `search(query)` + `fetchById(id)`.** Shape:
  ```ts
  export const SourceCandidateSchema = z.object({
    source: z.enum([
      'crossref', 'openalex', 'arxiv', 'pubmed', 'semanticscholar', 'unpaywall', 'retraction-watch',
    ]),  // matches Phase 1 D-23 discriminator list (subset; 'duckduckgo'/'gptzero'/'generic' stay Phase 6/8)
    id: z.string().min(1),  // DOI / arXiv ID / PMID / Semantic Scholar paperId / OpenAlex W-ID
    title: z.string().min(1),
    authors: z.array(z.string()).min(1),
    year: z.number().int().min(1800).max(2100).optional(),
    doi: z.string().optional(),  // normalized via bin/lib/doi.ts
    abstract: z.string().optional(),
    oa_pdf_url: z.string().url().optional(),  // populated by Unpaywall adapter
    retracted: z.boolean().default(false),  // populated by Retraction Watch adapter
    last_verified: z.string().datetime(),
    raw: z.unknown(),  // per-adapter native shape, for debugging only — NEVER persisted to .paper/CITATIONS.bib
  });
  ```
  Adapters live at `bin/lib/sources/<name>.ts`. Each exports two functions: `search(query: string, opts?): Promise<SourceCandidate[]>` (returns 0..N) and `fetchById(id: string): Promise<SourceCandidate | null>` (returns 1 or null). All adapters route HTTP through `bin/lib/http.ts` (REPO-05 chokepoint). All return values pass through zod parse so the union type is enforced at the boundary.
- **D-15: Retraction Watch is a side-channel filter, not a standalone search adapter.** The Retraction Watch adapter exposes ONLY `fetchById(doi)` (no `search`); the source-evaluator (RSCH-07) calls it for every candidate's DOI to populate the `retracted` flag. Hard warnings (RSCH-11) are surfaced at evaluator output and again at outline approval-gate (OUTL-03), so the user sees retracted-paper warnings TWICE before write-section consumes them.
- **D-16: Semantic Scholar is opt-in via `PENSMITH_S2_API_KEY`** following the same shape as `PENSMITH_CONTACT_EMAIL` (Phase 1 D-24). The adapter calls without the key (lower rate limit + slower) when absent; emits a one-time WARN banner matching the http.ts pattern. Key NAME is persisted in `bin/lib/schemas/runtime-config.ts` providers list; key VALUE never reaches disk or session log (T-01-07 invariant carry-forward).

### G. HANDOFF.json schema

- **D-17: Section-scoped pointers + minimal rebuild context; lives at `.paper/HANDOFF.json`.** Schema:
  ```ts
  export const HandoffSchema = z.object({
    schema_version: z.literal(1),
    last_updated: z.string().datetime(),
    current_section: z.string().nullable(),  // slug, e.g., "02-attention-mechanism" — null at intake/research/outline phase
    phase: z.enum(['intake', 'research', 'outline', 'plan', 'write', 'verify', 'compile', 'done']),
    next_action: z.string().min(1).max(200),  // human-readable hint, e.g., "Run `pensmith verify 02` to validate the section draft"
    breadcrumbs: z.array(z.object({
      ts: z.string().datetime(),
      verb: z.string(),
      section: z.string().nullable(),
      ok: z.boolean(),
    })).max(5),  // last 5 only — bounded so HANDOFF.json stays under 5KB (ARCH-04)
    section_pointers: z.array(z.object({
      slug: z.string(),
      plan_path: z.string(),       // "sections/02-attention-mechanism/PLAN.md"
      draft_path: z.string().nullable(),
      verification_path: z.string().nullable(),
      state: SectionStateSchema,   // mirrored from PLAN.md frontmatter; HANDOFF.json is a snapshot, not the source of truth
    })),
  });
  ```
  PreCompact hook (already wired in Phase 2 02-06) computes and writes this file inside its 10s timeout budget. Phase 3 ships the hook **body** (Phase 2 shipped only the stub). Schema-version 1 from day one; section-granular per ARCH-04; under 5KB enforced by a test (`tests/handoff-size.test.ts` reads + asserts `< 5120` bytes for the fixture run).
- **D-18: HANDOFF.json carries POINTERS, never content.** Drafts, full PLAN bodies, and verification verdict bodies live in their respective files; HANDOFF.json carries paths + minimal state. `section_pointers[].state` is a snapshot mirror — readers MUST reconcile with the per-section PLAN.md if they want truth. This keeps re-doing section N invariant: only `sections/<N>-slug/*` mtimes change; HANDOFF.json's mtime updates only when the PreCompact hook fires.

### H. APA-7 CSL bundling + Pandoc-token DRAFT.md

- **D-19: Bundle `templates/citation-styles/apa.csl` only; citation-js as PARSER, NOT RENDERER.** Single CSL file ships (APA-7, hash-pinned in `tests/repo-files.test.ts` matching D-18 / IN-03 discipline). citation-js pinned exact (matches Phase 1 dep-pin). Its role in Phase 3: parse BibTeX → CSL-JSON, period. Pass 1 fuzzy match (D-11) consumes the parsed CSL-JSON's `title` and `author[0].family` fields.
- **D-20: RSCH-09 writes `.paper/CITATIONS.bib` as canonical BibTeX source.** All adapters' `SourceCandidate` records are serialized to BibTeX (well-defined mapping for each `source` enum value) into one file. citation-js parses this file at verify-time. BibTeX is the durable source-of-truth format — the CSL-JSON intermediate is transient.
- **D-21: DRAFT.md emits Pandoc-style `[@citekey]` tokens; NO write-time render.** Section drafter (WRTE-01) writes `[@vaswani2017]`-style tokens directly. First actual APA rendering is deferred to **compile** (Phase 4) or **export** (Phase 6, via Pandoc citeproc per STACK.md). Three architectural wins from this deferral: (a) tier-contract test compares token-level → trivially equivalent across tiers (no version-skew surface from citation-js between Tier 1 and Tier 2); (b) verifier Pass 1 reads parsed BibTeX metadata not rendered strings → no rendering dependency on the deterministic gate; (c) re-rendering with a different CSL style in Phase 9 multi-style is a pure compile-time change with zero touch to section DRAFT files.
- **D-22: One smoke test asserts apa.csl + fixture CITATIONS.bib renders without error.** Lives at `tests/citation-render.test.ts` — feeds the known-good-fixture CITATIONS.bib through citation-js with apa.csl, asserts non-empty output and zero thrown exceptions. This guards the parser → renderer pipeline integrity even though Phase 3's hot path doesn't render.

### I. Cassette commit policy

- **D-23: Committed cassettes + weekly cron-refresh GitHub Action.** Source-adapter cassettes for the fixture-assignment queries (OpenAlex / Crossref / arXiv / PubMed / Semantic Scholar / Unpaywall / Retraction Watch) are recorded once, committed to `tests/fixtures/cassettes/<adapter>/`, and refreshed by a weekly cron workflow that re-records and auto-PRs the diff. **Forward-ports TEST-V2-02** as named in the user's discuss-phase decision.
- **D-24: Cassette refresh workflow shape.** New file `.github/workflows/cassette-refresh.yml`:
  - Schedule: `0 6 * * 1` (Mon 06:00 UTC)
  - Job: spin up Ubuntu runner, install deps, run `npm run test:record` (new package.json script that runs nockBack in record mode against the fixture-assignment query set), diff `tests/fixtures/cassettes/`, open auto-PR if diff > 0.
  - PR-time CI runs **offline** — `PENSMITH_NETWORK_TESTS` defaults to 0, cassettes serve all source-adapter HTTP, full determinism for the merge gate. Live-network testing happens **only** in the cron workflow.
- **D-25: Cassette directory size budget.** Per-adapter cassette JSON capped at ~50KB; total `tests/fixtures/cassettes/` budget ~250KB. Enforced by `tests/cassette-size.test.ts` (added in Phase 3) that fails if any adapter cassette exceeds 50KB. Rationale: keeps repo small + catches accidental commits of huge response bodies + signals when an adapter response shape grew unexpectedly (a contract-drift early-warning signal independent of the cron refresh job).

### Claude's Discretion

The following are implementation details that fall to the planner / researcher, not the user:
- Exact `jaro-winkler` pin vs hand-rolled `bin/lib/fuzzy.ts` choice (both meet D-11 contract)
- Per-adapter `search()` parameter shape beyond `query: string` (e.g., per-source filter args)
- Source-evaluator scoring weights (RSCH-07 — researcher proposes weights at plan-phase)
- BibTeX → SourceCandidate field-mapping per source enum (planner-level detail)
- citation-js version pin (planner picks current LTS satisfying APA-7 CSL conformance)
- Workflow-body file structure for each new verb (intake.md / research.md / outline.md / plan-section.md / write-section.md / verify-section.md) — exact `<capability_check>` shape derived per Phase 2 D-14
- Whether the v1 → v2 migration is one PR or one plan; either is fine as long as the migration block is its own commit for git-history clarity

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level specs
- `PRD.md` §3 (disclaimer; no metadata trace), §7.5–§7.10 (intake/research/outline/plan/write/verify operational specs), §12 (ARCH-12 free-basics framing), §14 (Pass 1 author/title fuzzy match mandate), §15 (smoke test verbatim), §17 (open questions — Phase 3 resolves verifier prompt wording + section-dependency syntax), §19 (non-negotiables)
- `.planning/PROJECT.md` — Key Decisions table; section-as-phase non-negotiable; verifier-blocks-compile-and-export
- `.planning/REQUIREMENTS.md` ARCH-02/04, ARCH-19 (Phase 3 lights up section state machine for the first time), INTK-01..05, RSCH-01..09/11, OUTL-01..04, PLAN-01/04, WRTE-01/03/04, VRFY-01/02/04/05/07/08, CITE-01/04, TEST-01/02/03/04/09
- `.planning/ROADMAP.md` Phase 3 success criteria (lines 119–124); Phase 4 / Phase 5 / Phase 6 / Phase 8 dependency edges
- `CLAUDE.md` — non-negotiables (verifier blocks compile/export; zero exported-document trace; honest framing on detection; approval gates default-on)

### Phase 0 / 1 / 2 prior decisions (Phase 3 consumes these)
- `.planning/phases/00-repo-skeleton-plugin-manifest/00-CONTEXT.md` D-01..D-22 — TS+ESM, Node ≥20.10, REPO-05 chokepoint pattern
- `.planning/phases/01-foundation-nfrs/01-CONTEXT.md` D-01..D-68 — especially D-23 source discriminator list, D-24 polite UA + WARN-once + PENSMITH_CONTACT_EMAIL, D-39 refuse-forward-incompat, D-54 (state.ts project-level only — Phase 3 is the first to wake up section-state migration), D-58/D-59 runtime.chat() provider-agnostic shape, D-64 dev-deps (nock@^14, fast-check@^3, zod@^3.23, undici@^7), T-01-07 no-leak property
- `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-01..D-24 — D-04 (DOCT-05.v3 first-class plan item carry-forward), D-15 (PASS/WARN/FAIL/SKIP severity), D-19 (kind: deterministic vs prose tier-contract), D-20 (Record-keyed-by-id ProbeReport shape, single shared normalizer), D-21 (CONTRIBUTING.md discipline rule — "make the tiers agree, not add a normalizer"), D-24 (Tier-03 hooks files contract)

### Phase 1 / 2 foundation libs (consumed by Phase 3)
- `bin/lib/paths.ts` — `.paper/` resolution; `sections/<NN-slug>/` path helpers added in Phase 3
- `bin/lib/atomic-write.ts` — every Phase 3 file write routes through this
- `bin/lib/lock.ts` — `withLock` for `.paper/STATE.json` mutations during intake/outline/write/verify
- `bin/lib/http.ts` — all source-adapter HTTP; existing undici + WARN-once banner + 8 cassettes (Phase 1 D-05); Phase 3 adds ~7 source-adapter cassettes
- `bin/lib/retry.ts` — full-jitter + Retry-After parser (Phase 2 D-01)
- `bin/lib/doi.ts` — DOI / arXiv ID / PMID normalization (ARCH-15)
- `bin/lib/state.ts` — Phase 3 wakes up the dormant migration registry (D-09); Phase 1 line 30 `writeBack` branch becomes active
- `bin/lib/schemas/state.ts` — `SectionEntrySchema` lines 28–53 are the v1 → v2 migration target (D-09)
- `bin/lib/runtime.ts` — `loadRuntimeConfig()` consumed by source-evaluator for provider preference; `PENSMITH_S2_API_KEY` slot added (D-16)
- `bin/lib/session-log.ts` — every verb's session line carries phase + section pointer
- `bin/lib/checkpoint.ts` — Phase 3 PostToolUse hook body writes a checkpoint after each verify-section completion
- `bin/lib/pii.ts` — INTK-05 PII redaction; runs before any LLM call when opt-in flag set
- `bin/lib/doctor/probes.ts` — DOCT-05 carry-forward replaces `build-artifact-resolves` with real intake/outline/verify wiring-smoke probe
- `mcp/server.ts` — 5 resources + 6 tools from Phase 2; Phase 3 lights up `paper_init_section` / `paper_advance_section` / `paper_record_verification` for real
- `bin/pensmith.ts` — citty dispatcher from Phase 2; 5 of 15 NotYetImplemented verbs become real (intake/research/outline/plan/write/verify; doctor is already real)
- `tests/tier-contract.test.ts` — Phase 2 harness with 4 cases (A doctor / B capabilities / C state / D length); Phase 3 adds 6 new cases
- `tests/repo-files.test.ts` — hash-pin pattern (Phase 2 D-18 / IN-03); Phase 3 adds prompt-file pins + apa.csl pin + assignment.txt pin
- `CONTRIBUTING.md` Tier contract section (Phase 2 02-08, D-24-locked) — Phase 3 must not violate the four merge-gate layers

### External / forward
- `@modelcontextprotocol/sdk` v1.29 (locked in Phase 2 02-04)
- `citty` ^0.2.2 (locked in Phase 2 02-00)
- `citation-js` (planner picks current pin)
- `pdf-parse` ^1.1.1 pinned-exact (D-06)
- `jaro-winkler` ^0.2.8 pinned-exact OR hand-rolled `bin/lib/fuzzy.ts` (planner decides per D-11)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`bin/lib/state.ts` + `bin/lib/schemas/state.ts`** — Phase 3's bundled v1 → v2 migration (D-09) consumes the dormant migration registry (Phase 1 line 30) and its `writeBack` branch. `SectionEntrySchema` at lines 28–53 of `bin/lib/schemas/state.ts` is the migration target: drop `state`, `status`, `lastVerification` from project-level. Migration logic lives in `bin/lib/state.ts::migrate_v1_to_v2()`; idempotent on already-v2 files.
- **`bin/lib/runtime.ts`** — Source-evaluator (RSCH-07) reads `loadRuntimeConfig().providers` to know which provider is active; per-section prompts (D-12) consume provider-agnostic `chat()` shape (D-58/D-59 from Phase 1).
- **`bin/lib/http.ts`** — All source-adapter HTTP routes through the existing undici + retry + WARN-once stack. No new HTTP code; just adapter modules calling `http.get`.
- **`bin/lib/doctor/probes.ts`** — DOCT-05 carry-forward: replace `build-artifact-resolves` probe with `intake-outline-verify-wiring` probe (still PASS/WARN/FAIL/SKIP per D-15). Uses cassette fixture, never touches network.
- **`tests/repo-files.test.ts`** — Hash-pin pattern (Phase 2 D-18 doctor-output, IN-03 http-warnings). Phase 3 extends with: 8 prompt files (D-12), apa.csl (D-19), fixture assignment.txt (D-01), known-bad-citations.json + known-bad-quotes.json (success criteria 2/3 deterministic-corpus pin).
- **`tests/tier-contract.test.ts`** — Phase 2 harness with 4 cases. Phase 3 adds 6 cases (one per new workflow body: intake/research/outline/plan-section/write-section/verify-section). Cassette fixtures power both tiers' adapter calls.
- **Phase 2 hooks (`hooks/{session-start,stop,pre-compact,post-tool-use}.ts`)** — Phase 2 shipped stubs that emit no stdout (TIER-03). Phase 3 lights up PreCompact (writes HANDOFF.json per D-17/D-18) and PostToolUse (checkpoint after verify completion).

### Established Patterns

- **Chokepoint enforcement via AST-walk + ESLint flat-config** (Phase 0 D-07, Phase 2 D-09/D-10/D-12). Phase 3 adds two more chokepoints: (a) `bin/lib/pdf-text.ts` wraps `pdf-parse` — lint forbids direct imports outside this file; (b) `bin/lib/sources/*` adapters route HTTP through `bin/lib/http.ts` — covered by existing REPO-05 chokepoint, no new lint rule needed.
- **SHA-256 hash-pin pattern for locked copy** (Phase 2 D-18 doctor-output.md, IN-03 http-warnings.md). Phase 3 extends to: 8 prompt files in `templates/prompts/`, `templates/citation-styles/apa.csl`, `tests/fixtures/known-good-fixture/assignment.txt`. Each pin in `tests/repo-files.test.ts` with the regenerate one-liner in the comment (matches existing D-18 / IN-03 format exactly).
- **Refuse-forward-incompat schema versioning** (Phase 1 D-39). Phase 3's v1 → v2 migration is the first non-trivial case — the migration MUST be tested with: (a) read v1, migrate, write v2, re-read v2 — round-trip; (b) read v2 from a v1-only reader → typed `SchemaVersionForwardError`; (c) idempotent on already-v2 files.
- **Load-INSIDE-the-lock idiom** (Phase 1 BLOCKER-01/02 fixes). State-mutation MCP tools (`paper_init_section`, `paper_advance_section`, `paper_record_verification`) delegate to `bin/lib/state.ts` entry points that already follow this idiom; no need to reimplement.
- **Atomic write everywhere** (Phase 1 D-07). PROJECT.md, config.toml, RESEARCH.md, CITATIONS.bib, sections/<N>/PLAN.md, sections/<N>/DRAFT.md, sections/<N>/VERIFICATION.md, HANDOFF.json — every write routes through `bin/lib/atomic-write.ts`.
- **No-leak invariant (T-01-07, D-12 from Phase 2)** — D-16's `PENSMITH_S2_API_KEY` slot persists env-var NAME only; resolved value never reaches disk or session log. Symmetric to OPENALEX_API_KEY (Phase 1 D-64 / 01-13). Tested by extending `tests/runtime.test.ts` no-leak property.

### Integration Points

- **`.paper/sections/<NN-slug>/`** — First time Phase 3 code creates section directories (per ARCH-02). Phase 2 explicitly OUT-of-scope ("No `.paper/` directory creation by Phase 2 code; first creation is Phase 3 intake"). Path helpers in `bin/lib/paths.ts` gain `sectionDir(slug)` / `planPath(slug)` / `draftPath(slug)` / `verificationPath(slug)`.
- **`tests/fixtures/cassettes/`** — New directory tree. Per-adapter subdirectories committed; `.gitattributes` may set `* binary` for cassette JSON to keep diffs from spamming PR view (deferred to planner discretion).
- **`.github/workflows/cassette-refresh.yml`** — New workflow file (D-24). Cron-only; auto-PR opener. Forward-ports the TEST-V2-02 commitment.
- **`mcp/server.ts`** — 3 of 6 state-mutation tools light up for real: `paper_init_section`, `paper_advance_section`, `paper_record_verification`. Remaining 3 (`paper_set_status`, `paper_doi_verify`, `paper_capability_probe`) already shipped real in Phase 2.
- **`bin/pensmith.ts`** — 5 of 15 NotYetImplemented verbs become real: `new` (intake), `research`, `outline`, `plan <N>`, `write <N>`, `verify <N>`. Doctor remains real.
- **`hooks/pre-compact.ts`** — Phase 2 shipped no-stdout stub. Phase 3 lights up the body: read STATE.json + per-section PLAN.md files + last-5 breadcrumbs from session-log; write HANDOFF.json under 5KB inside 10s timeout (T-02-06-02 stdout-silence preserved).
- **`hooks/post-tool-use.ts`** — Phase 2 shipped no-stdout stub. Phase 3 lights up the body: ≤1/min throttled checkpoint via mtime gate, writes CHECKPOINTS.jsonl line on verify completion (Phase 1 D-60 append-only audit log).

</code_context>

<specifics>
## Specific Ideas

- **The latent two-homes drift was real, not hypothetical.** `bin/lib/schemas/state.ts` lines 28–53 embed `state` / `status` / `lastVerification` directly in project-level `SectionEntrySchema`. Without D-09's bundled v1 → v2 migration, Phase 3 would have **both** project-STATE.json AND per-section-PLAN.md frontmatter carrying section state — and the section-isolation mtime test (TEST-09) would either fail (because writing a section also touches STATE.json) or be tautologically true (because we'd ignore STATE.json drift). SC-4 is byte-exact: "section state lives ONLY under `.paper/sections/<NN-slug>/`." The migration is what makes SC-4 true. Phase 1's `writeBack` branch was deliberately left dormant for exactly this moment.
- **Pass 1 is a deterministic AND-gate, sufficient over necessity.** PRD §14's phrasing ("DOI integrity is necessary but not sufficient") makes the algebra explicit: DOI fetch returning 200 with correct metadata field-presence is a precondition; Jaro-Winkler title ≥0.92 AND author ≥0.85 is the actual sufficient gate. Year is soft (Phase 5 advisory). This is what "deterministic + blocking" means in Phase 3 — no LLM judgment, no fuzzy maybe-FABRICATED state, just three numeric thresholds (HTTP status code, JW-title, JW-author).
- **Prompts ship dormant for Phase 5 because the interaction contract is real but the verdict is computed elsewhere.** D-13's `pass1-fuzzy-judge.md` and `pass3-quote-checker.md` aren't dead code — they're the contract that Phase 5 will activate. Writing them in Phase 3 forces us to lock the agent interface NOW (input shape, output shape, disclosure copy), so Phase 5 is "wire up an LLM caller," not "design a verifier from scratch." This is the GSD pattern: when a phase has the context to lock an interface, lock the interface, even if the consumer comes later.
- **DRAFT.md as Pandoc-token markdown is the architectural unlock for both tier-equivalence and Phase 9 multi-style.** Token-level comparison (`[@vaswani2017]` vs `[@vaswani2017]`) is byte-equal across Tier 1 and Tier 2 — zero version-skew surface. Phase 9 multi-style polish (now / future) becomes a compile-time switch, not a section-rewrite. Phase 4 compile is the first place rendering happens.
- **Hybrid Pass 3 PDF scope separates the deterministic test corpus from the live-PDF pipeline.** Success criterion 3 ("10/10 NOT_FOUND") runs against `known-bad-quotes.json` synthetic plaintext with embedded artifacts — fully deterministic regardless of pdf-parse version, Unpaywall availability, or cassette state. The Unpaywall + pdf-parse pipeline is exercised separately by the wiring-smoke probe (DOCT-05 carry-forward) and by the tier-contract verify-section case. Two failure modes, two test surfaces; one cannot mask the other.
- **Cassette + cron pattern preserves PR-merge-gate determinism while still catching API drift.** PR-time CI is offline → no rate-limit flake, no API-outage cascades, deterministic merge gate. Weekly cron is live → catches contract drift in source-adapter responses on a bounded cadence, surfaces drift via auto-PR (human-reviewed) before drift breaks anyone's PR. This is the same shape as Phase 1's HTTP cassettes (D-43); just lifted one layer up to adapter-level for Phase 3.

</specifics>

<deferred>
## Deferred Ideas

- **Pass 2 (LLM-judged claim support) + Pass 4 (paragraph orphan claims)** — Phase 5. Prompts ship dormant in Phase 3 (D-13). VRFY-03 + VRFY-06 sit in Phase 5's requirement bucket.
- **N-section breadth + wave scheduler + compile** — Phase 4. Tarjan's cycle check on the full DAG (D-04 confirms what Phase 3's per-section refinement constraints already encode); letter-suffix `03b-validity-threats/` (ARCH-20) inserts without renumbering.
- **Citation styles beyond APA-7** — Phase 9 multi-style polish. Bundling more CSL files is a compile-time switch (D-21 enables this).
- **BYO PDF + pymupdf shellout fallback + Crossref hydration** — Phase 8 (RSCH-05b after the Phase 3 / Phase 8 split in D-07).
- **Style-match per-paper `STYLE.json`** — Phase 8. Section drafter Phase 3 ONLY receives PLAN.md + mapped sources + voice hint.
- **`/pensmith sketch` thinking-partner mode** — Phase 8.
- **`/pensmith add <doi|pdf|url>` mid-paper ingest** — Phase 8.
- **Bare `/pensmith` state-aware routing + natural-language triggers** — Phase 7.
- **Educator/tutorial mode (`goal=learning` annotated provenance)** — Phase 9.
- **Export pipeline + zero-trace gate + humanizer + GPTZero + plagiarism** — Phase 6.
- **`depends_on_soft` advisory hint** — Reserved field name. If a Phase 4+ use case emerges, additive non-breaking extension.
- **DOCT-06 second-tier-contract probe** — Phase 3 produces equivalent doctor output by virtue of D-13 (deterministic Pass 1/3 + token-level DRAFT.md); Phase 4 expands the probe with N-section cases.
- **Cassette size enforcement of < 50KB per adapter** — Phase 3 ships the test (D-25). Phase 4+ may revisit the budget if adapter response shapes grow legitimately (e.g., abstract embeddings).
- **`PENSMITH_NETWORK_TESTS=1` opt-in for local cassette re-record** — Phase 3 documents the pattern in CONTRIBUTING.md but does NOT ship a one-line `npm run test:record` until plan-phase researcher confirms nockBack's record-mode shape works cleanly with our setup.

</deferred>

---

*Phase: 3 - Vertical slice through one section*
*Context gathered: 2026-05-17*
