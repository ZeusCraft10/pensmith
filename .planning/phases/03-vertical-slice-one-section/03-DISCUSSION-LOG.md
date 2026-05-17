# Phase 3: Discussion Log

**Discussion date:** 2026-05-17
**Phase goal:** A single fixture assignment runs end-to-end through intake → research → outline → plan → write → verify on ONE section in both tiers, proving the section-as-phase invariant before scaling to N sections. Deterministic Pass 1 + Pass 3 only; APA only.
**Workflow:** `/gsd-discuss-phase 3`
**Outcome:** 25 decisions locked (D-01 through D-25); ready for `/gsd-plan-phase 3`.

---

## Prior context loaded (no re-asking decided questions)

- `PRD.md` §3, §7.5–§7.10, §12, §14, §15, §17, §19
- `CLAUDE.md` non-negotiables
- `.planning/PROJECT.md` Key Decisions table
- `.planning/REQUIREMENTS.md` traceability (35 Phase 3 requirements confirmed)
- `.planning/ROADMAP.md` Phase 3 success criteria (lines 119–124) — anchored SC-4 verbatim drove D-08/D-09
- `.planning/phases/00-repo-skeleton-plugin-manifest/00-CONTEXT.md` D-01..D-22
- `.planning/phases/01-foundation-nfrs/01-CONTEXT.md` D-01..D-68 — especially D-23 source list, D-24 polite UA, D-39 refuse-forward-incompat, D-54 state.ts project-only carry-forward, D-58/D-59 runtime.chat shape, D-64 dev deps, T-01-07 no-leak
- `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-01..D-24 — especially D-04 (DOCT-05.v3 first-class plan item), D-15/D-19/D-20/D-21 tier-contract patterns, D-24 hooks files
- `bin/lib/schemas/state.ts` lines 28–53 (verified: embedded section state in `SectionEntrySchema`)
- `bin/lib/state.ts` line 30 (verified: "migration registry is empty so the writeBack branch is dormant")
- `bin/lib/doctor/probes/build-artifact-resolves.ts` + `mcp-sdk-presence.ts` (verified: `findPkgRoot` pattern for Phase 3 file resolution)
- Phase 2 `tests/repo-files.test.ts` + `tests/doctor-probes.test.ts` (verified: hash-pin discipline + Phase 2 DOCT-05 carry-forward shape)

---

## Gray areas surfaced (9 total)

After loading prior context, the following gray areas remained un-decided. The user selected which to discuss; one ("verifier subagent prompts + Pass 1 fuzzy thresholds") was added via the "Other" channel citing PRD §17 + §14.

| # | Gray Area | Selected for discussion? |
|---|-----------|--------------------------|
| GA-1 | Fixture assignment shape | ✅ Yes |
| GA-2 | Section-dependency contract (`depends_on`) | ✅ Yes |
| GA-3 | Pass 3 PDF-parsing scope | ✅ Yes |
| GA-4 | Section state — minimal vs Phase 4 | ✅ Yes |
| GA-5 | Verifier-subagent prompts + Pass 1 fuzzy thresholds (added by user via "Other") | ✅ Yes |
| GA-6 | Source-adapter API surface | ✅ Yes |
| GA-7 | HANDOFF.json schema | ✅ Yes |
| GA-8 | APA-7 CSL bundling | ✅ Yes |
| GA-9 | Cassette commit policy | ✅ Yes |

All 9 selected. No deferred-to-planner deflections; user wanted full Phase 3 lock before plan-phase.

---

## GA-1: Fixture assignment shape

**Question:** What's the single fixture assignment that exercises the full intake → verify slice? Same as PRD §15 smoke test? Different to stress-test discipline presets?

**Discussion:**
- PRD §15 specifies `"Write a 1500-word literature review on attention mechanisms in transformers, APA style."`
- User picked: **same assignment but with the section choice being a middle section, NOT section 1**
- Rationale: section 1 (intro) is too thin to exercise claim-source mapping; a middle section catches `depends_on` resolution non-trivially AND exercises section-isolation invariant (re-doing middle leaves both ends untouched, not just the tail).
- Topic has dense OA Crossref/arXiv coverage (Vaswani et al. 2017 + downstream); few retraction-watch confounders.

**Locked:**
- **D-01:** Single fixture assignment = PRD §15 verbatim, stored at `tests/fixtures/known-good-fixture/assignment.txt`
- **D-02:** Golden section = middle section of the ~5-section outline (likely "Architectural variants" or "Cross-modal extensions"); used for tier-contract Pass 1/3 fixtures

---

## GA-2: Section-dependency contract (`depends_on`)

**Question:** PRD §17 flags "section-dependency declaration syntax" as open. What's the shape, and what refinements ship in v1?

**Discussion:**
- Three candidate shapes: integer (`depends_on: [1]`), slug (`depends_on: [01-introduction]`), or hybrid.
- User picked **slug-based** explicitly to absorb Phase 4 ARCH-20 letter-suffix policy (`03b-validity-threats/`) without contract churn.
- User added three blocking refinements that ship together: no self-reference, no cycles (zod refinement + Phase 4 Tarjan reconfirm), every referenced slug must resolve to an existing folder at outline time (fail-fast at OUTL-04, not at wave-schedule time).
- User asked: hard-dep-only for v1, or soft-hint flavor too? Locked **hard-only**; field name `depends_on_soft` reserved for non-breaking future extension if Phase 4+ surfaces a use case.

**Locked:**
- **D-03:** Slug-based `depends_on` only
- **D-04:** Three schema refinements — no self-reference + no cycles + must-resolve-at-outline-time, all blocking
- **D-05:** Hard-dep only in v1; `depends_on_soft` reserved name only

---

## GA-3: Pass 3 PDF-parsing scope

**Question:** VRFY-04 mandates OA full-text via Unpaywall + Levenshtein ≥0.95 substring match. Does Phase 3 ship the live Unpaywall + pdf-parse pipeline, or stay on synthetic plaintext for testability?

**Discussion:**
- RSCH-05 in REQUIREMENTS.md currently maps Phase 8 entirely (`pdf-parse` pinned + `pymupdf` shellout fallback).
- But Phase 3 Pass 3 needs PDF text from somewhere — either ship a subset of RSCH-05 early or stay synthetic.
- Three options weighed: (A) live Unpaywall + pdf-parse, (B) synthetic plaintext only, (C) hybrid (live for the wiring-smoke probe; synthetic for the deterministic 10/10 NOT_FOUND corpus).
- User picked **C (hybrid)**. Rationale: synthetic plaintext makes success criterion 3 ("10/10 NOT_FOUND") fully deterministic (no pdf-parse version risk, no Unpaywall availability risk); live pipeline still ships so the wiring-smoke probe (DOCT-05 carry-forward) and the tier-contract verify-section case exercise the real path.
- RSCH-05 splits in REQUIREMENTS.md: Phase 3 ships RSCH-05a (Unpaywall OA PDF + pdf-parse pinned exact); Phase 8 keeps RSCH-05b (BYO arbitrary PDF + pymupdf shellout + Crossref hydration).

**Locked:**
- **D-06:** Hybrid scope — pdf-parse pinned exact for Unpaywall OA PDFs + synthetic plaintext fixtures for the adversarial corpus
- **D-07:** RSCH-05 splits Phase 3 + Phase 8 in REQUIREMENTS.md (update needed)

---

## GA-4: Section state — minimal vs Phase 4

**Question:** Which fields ship on per-section state in Phase 3 vs Phase 4? Where does state physically live?

**Discussion:**
- ROADMAP.md SC-4 (verbatim): "section state lives only under `.paper/sections/<NN-slug>/`"
- BUT `bin/lib/schemas/state.ts` lines 28–53 already embed `state`/`status`/`lastVerification` in project-level `SectionEntrySchema` (additive change from Phase 2 02-04).
- This is latent two-homes drift: without intervention, project-level STATE.json AND per-section PLAN.md frontmatter would both carry state, and the section-isolation mtime test (TEST-09) becomes either failing or tautologically true.
- User cited the exact file paths and line numbers. I verified via Read tool before locking.
- User picked **Option A + bundled v1 → v2 migration**: section state lives ONLY in `.paper/sections/<NN-slug>/PLAN.md` frontmatter; the Phase 1 dormant migration registry (`bin/lib/state.ts` line 30 `writeBack` branch) wakes up; project-level STATE.json `sections[]` after migration carries `{ n, slug }` only.
- `verified_against_draft_hash` (Phase 4 ARCH-19 compile-staleness signal) is introduced in Phase 3 inside `last_verification.draft_hash` on PLAN.md frontmatter — no side-channel back to STATE.json.

**Locked:**
- **D-08:** Section state lives ONLY under `.paper/sections/<NN-slug>/PLAN.md` frontmatter; schema specified
- **D-09:** Bundled v1 → v2 forward migration in `bin/lib/state.ts`; the dormant migration registry gets its first real entry; idempotent
- **D-10:** `verified_against_draft_hash` lives on PLAN.md, not STATE.json

---

## GA-5: Verifier-subagent prompts + Pass 1 fuzzy-match thresholds

**Question (added by user via "Other"):** PRD §17 flags "exact prompt wording for verifier subagents" as open. §14 mandates author/title fuzzy match in Pass 1 but no algorithm specified. What ships?

**Discussion:**
Two sub-questions, locked in sequence.

**Sub-question A: Pass 1 fuzzy-match algorithm and thresholds.**
- Candidates: Jaro-Winkler (prefix-weighted, citation-industry standard), normalized Levenshtein, Fuse.js library.
- User picked **Jaro-Winkler, title ≥0.92 AND author ≥0.85** as an AND-gate (both must pass).
- Author comparison uses the **first listed author's surname only** (full-author-list comparison is fragile across BibTeX/Crossref format variance).
- Both inputs NFKC-normalized + diacritic-stripped + lowercased before comparison.
- Year mismatch is soft in Phase 3 (logged as Pass 2 advisory candidate for Phase 5).

**Sub-question B: Where the prompts live + how they're locked.**
- User picked **`templates/prompts/<role>.md` (one file per agent), hash-pinned in `tests/repo-files.test.ts`** — extends the Phase 2 D-18 / IN-03 hash-pin pattern.
- 8 prompt files ship: intake-clarifier, topic-disambiguator, source-evaluator, outline-author, section-planner, section-drafter, pass1-fuzzy-judge (dormant for Phase 5), pass3-quote-checker (dormant for Phase 5).
- Phase 3 prompts capture the **interaction contract** (input shape, output shape, disclosure copy); Pass 1 and Pass 3 verdicts in Phase 3 are deterministic — prompts NOT consulted at verdict time.

**Locked:**
- **D-11:** Jaro-Winkler; title ≥0.92 AND author ≥0.85 AND-gate; year mismatch is soft (Pass 5 advisory)
- **D-12:** 8 prompt files at `templates/prompts/*.md`, each hash-pinned in `tests/repo-files.test.ts`
- **D-13:** Phase 3 prompts are calibrated to deterministic gates, not advisory LLM judgment; pass1-fuzzy-judge.md + pass3-quote-checker.md ship dormant for Phase 5

---

## GA-6: Source-adapter API surface

**Question:** RSCH-04 ships adapters for 7 sources. What's the shared API surface, and what shape do candidates carry?

**Discussion:**
- Three candidates: per-adapter idiosyncratic types, unified type with adapter modules, abstract base class.
- User picked **unified `SourceCandidate` type; each adapter exports `search(query)` + `fetchById(id)`**.
- The `source` enum matches Phase 1 D-23 discriminator list (subset; duckduckgo/gptzero/generic stay later phases).
- Adapters route HTTP through `bin/lib/http.ts` (REPO-05 chokepoint already enforces).
- Retraction Watch is **side-channel only** — `fetchById(doi)` only, no `search`; source-evaluator calls it for every candidate to populate `retracted` flag.
- Semantic Scholar follows the polite-UA pattern: optional `PENSMITH_S2_API_KEY`, WARN-once banner when absent, value NEVER on disk or in session log (T-01-07 invariant).

**Locked:**
- **D-14:** Unified `SourceCandidate` schema; per-adapter `search()` + `fetchById()`; HTTP routes through `bin/lib/http.ts`
- **D-15:** Retraction Watch is side-channel `fetchById` only; warnings surface twice (evaluator output + outline approval gate)
- **D-16:** Semantic Scholar opt-in via `PENSMITH_S2_API_KEY`; key NAME on disk only, value never persisted

---

## GA-7: HANDOFF.json schema

**Question:** ARCH-04 mandates section-granular HANDOFF.json under 5KB. PreCompact hook stub shipped in Phase 2 02-06 — what does Phase 3 fill in?

**Discussion:**
- Three candidates: full-content snapshot (rejected — blows 5KB), section-scoped pointers only (minimal), section pointers + minimal rebuild context (chosen).
- User picked **Option B+: section-scoped pointers + minimal rebuild context, at `.paper/HANDOFF.json`**.
- Schema includes: `schema_version: 1`, `current_section`, `phase`, `next_action` (≤200 chars), `breadcrumbs[]` (last 5 max), `section_pointers[]` (slug + paths + mirrored state).
- HANDOFF.json carries **pointers, never content**; `section_pointers[].state` is a snapshot mirror — readers MUST reconcile with PLAN.md frontmatter if they want truth.
- 5KB enforced by `tests/handoff-size.test.ts`.
- PreCompact hook body (Phase 3 plan) writes inside its 10s timeout (TIER-03 contract preserved).

**Locked:**
- **D-17:** Section-scoped pointers + minimal rebuild context at `.paper/HANDOFF.json`; schema specified
- **D-18:** HANDOFF.json carries pointers, never content

---

## GA-8: APA-7 CSL bundling

**Question:** CITE-01 mandates APA-7 in Phase 3; CITE-04 says citation-js + bundled CSL. What ships, and when does rendering actually happen?

**Discussion:**
- Three candidates: bundle apa.csl + render at WRITE time (initial proposal); bundle apa.csl + render at COMPILE time; bundle apa.csl + render at EXPORT time only.
- I proposed Option A (render at WRITE); user countered with a sharper architecture: **keep DRAFT.md as Pandoc-token markdown, defer render to compile/export**.
- Rationale: (1) tier-contract test compares token-level → trivially equivalent across tiers, zero version-skew surface from citation-js; (2) verifier Pass 1 reads parsed BibTeX metadata not rendered strings — write-time render adds nothing; (3) re-rendering in Phase 9 multi-style is a compile-time switch with zero touch to section DRAFT files.
- citation-js in Phase 3 is **parser only** (BibTeX → CSL-JSON); apa.csl bundles but isn't consumed until Phase 4 compile or Phase 6 export.
- One smoke test asserts apa.csl + fixture CITATIONS.bib renders cleanly through citation-js — guards parser→renderer pipeline integrity even though Phase 3's hot path doesn't render.

**Locked:**
- **D-19:** Bundle `templates/citation-styles/apa.csl` only (hash-pinned); citation-js pinned exact as PARSER
- **D-20:** RSCH-09 writes `.paper/CITATIONS.bib` as canonical BibTeX source
- **D-21:** DRAFT.md emits Pandoc-style `[@citekey]` tokens; NO write-time render; first render at Phase 4 compile / Phase 6 export
- **D-22:** One smoke test asserts apa.csl + fixture CITATIONS.bib renders through citation-js without error

---

## GA-9: Cassette commit policy

**Question:** TEST-03 + TEST-04 mandate cassettes for source adapters. Phase 1 shipped HTTP-client cassettes only. How are adapter-level cassettes recorded and maintained?

**Discussion:**
- Three candidates: (A) committed + manual refresh on PR review, (B) committed + weekly cron-refresh GitHub Action, (C) live APIs every CI run (rejected — inverts Phase 1 D-43 offline-by-default).
- User picked **B: committed cassettes + weekly cron refresh**, forward-porting TEST-V2-02.
- PR-time CI stays **offline** — `PENSMITH_NETWORK_TESTS=0`, cassettes serve all adapter HTTP, deterministic merge gate.
- Weekly cron (Mon 06:00 UTC) re-records against live APIs, diffs cassettes, opens auto-PR if any cassette drifted. Catches API contract drift on a bounded cadence; the human-reviewed PR is the surface where drift gets evaluated.
- Cassette size budget: ~50KB per adapter, ~250KB total; enforced by `tests/cassette-size.test.ts`.

**Locked:**
- **D-23:** Committed cassettes + weekly cron-refresh GitHub Action; forward-ports TEST-V2-02
- **D-24:** Cron workflow at `.github/workflows/cassette-refresh.yml`; PR-time CI stays offline (`PENSMITH_NETWORK_TESTS=0`)
- **D-25:** Per-adapter cassette ≤50KB; total ≤250KB; enforced by `tests/cassette-size.test.ts`

---

## Cross-cutting outcomes

- **REQUIREMENTS.md update needed:** RSCH-05 splits into RSCH-05a (Phase 3: Unpaywall OA PDF + pdf-parse pinned exact) and RSCH-05b (Phase 8: BYO arbitrary PDF + pymupdf shellout + Crossref hydration). No requirement IDs renumbered.
- **No requirements deferred out of Phase 3.** All 35 originally-mapped requirements stay; RSCH-05 split adds RSCH-05a to Phase 3 with the sub-scope clarified.
- **One Phase 2 carry-forward closed by Phase 3 plan-phase commitment:** Phase 2 D-04 (DOCT-05.v3 must be a first-class plan item in Phase 3) — confirmed in this CONTEXT.md's domain block.
- **One Phase 2 cross-AI-review concern closed:** Codex iter-1 raised "production probes must not import from tests/" for the SKIP-only `http-crossref-ping` probe; Phase 3 ships `bin/lib/http-mock.ts` in the production tree to re-enable PASS/FAIL discrimination (mentioned in 02-CONTEXT.md and now confirmed for Phase 3 plan).
- **One latent codebase drift fixed by Phase 3 migration:** the embedded section state in project-level `SectionEntrySchema` (`bin/lib/schemas/state.ts` lines 28–53) — Phase 3's v1 → v2 migration drops it; SC-4 becomes structurally true.

---

## Next steps

1. ✅ Write `03-CONTEXT.md` — done (`.planning/phases/03-vertical-slice-one-section/03-CONTEXT.md`)
2. ✅ Write `03-DISCUSSION-LOG.md` — this file
3. Update `REQUIREMENTS.md` — RSCH-05 splits Phase 3 / Phase 8 (one-line description amendment + traceability table entries)
4. Update `STATE.md` — Phase 3 discuss complete; next is `/gsd-plan-phase 3`
5. Commit `git add .planning/phases/03-vertical-slice-one-section/ .planning/REQUIREMENTS.md .planning/STATE.md && git commit -m "docs(03): discuss-phase complete — 25 decisions locked"`
6. Route: `/gsd-plan-phase 3`

---

*Discussion completed: 2026-05-17*
