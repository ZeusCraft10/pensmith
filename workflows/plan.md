# pensmith plan

> Plan one section's content + sources. Per-section verb — touches ONLY
> `.paper/sections/<NN>-<slug>/` (TEST-09 section-isolation invariant).

<capability_check>
required:
  - MCP state.read
  - MCP library.read
  - AskUserQuestion

degrade_if_missing:
  - if no MCP tools: direct file reads from .paper/
  - if no AskUserQuestion: render the --revise citation-swap diff via @clack/prompts in a TTY; in a non-TTY without --yolo, exit code 3 with "use --yolo to auto-accept" (PRD §19 approval gate stays default-on)
</capability_check>

## Overview

`pensmith plan <N>` is the first of the three per-section verbs (plan → write → verify).
It turns the section's stub PLAN.md (written when the outline was approved) into a planned
PLAN.md: claims, the sources each claim rests on, a paragraph structure, the word target and
the voice. `N` is a section id: a number, or a number and a letter for a section a re-outline
inserted (`1a`).

The planner is fed the paper brief, the section's own OUTLINE row, short summaries of the
claims its `depends_on` sections already planned, and ONLY the section's own sources
(FEED-01, GRND-12). Its reply is validated (GRND-13): one corrective turn, and a reply that
is still invalid writes nothing.

**Section-isolation invariant (TEST-09 / ARCH-02 / SC-4 — locked)**: this verb MUST NOT
mutate any file outside `.paper/sections/<NN>-<slug>/`. The `tests/section-isolation.test.ts`
mtime invariant gate enforces this — any cross-section write is a CI-blocking failure.

The implementation lives in `bin/cli/plan.ts`; the source records in
`bin/lib/source-context.ts`, validation in `bin/lib/plan-validate.ts`, rendering in
`bin/lib/plan-render.ts`.

## Outputs

- `.paper/sections/<NN>-<slug>/PLAN.md` — the v2 frontmatter (validated by `PlanFrontmatterSchema`) with the outline entry kept, `stub` dropped, `status: planned` and the validated `assigned_sources`; the body `## Claims` / `## Structure` / `## Word target` / `## Voice`

## Body

1. **Parse args**: `pensmith plan <N>` — `N` is the section id (`3`, or `1a`). Resolve the slug for `N` from its STATE.json registration (the one authority on section identity, D-18-38; OUTLINE.md's rows only while no section is registered); the section's folder is found by slug. An `N` that is not a section id from 1 to 99 (optionally with one letter), a section the paper does not have, or a `--slug` that is not the section's slug is a usage error (exit 2) before any model call or write — a paper with an outline never gets a `NN-placeholder` section folder (RUN-09). A registered section whose OUTLINE.md row disagrees (a renamed slug, a renumbered or deleted row) is refused (exit 1) naming `pensmith outline`, which applies the edited outline — `plan` never creates a second folder for a registered section number.

2. **Read inputs** (read-only file accesses, no mutation):
   - `.paper/INTAKE.md` (+ `.paper/config.toml`) → the brief: topic, thesis (the outline's `Thesis:` line, else the brief's), discipline and its tone, paper type.
   - `.paper/OUTLINE.md` → the section's row: id, slug, title, purpose, role, `depends_on`, word target, voice (the stub PLAN.md's values fill anything the row lacks).
   - The **allowed set** (FEED-01, FEED-04): the OUTLINE row's `assigned_sources` ∪ the section's current PLAN.md `assigned_sources` (the outline allocation plus `add --section` remaps) ∪ the LIBRARY.json sources whose provenance is `plan-research:§<N>` (this section's `plan <N> --research` additions) — never only the previous plan's pick — **minus the sources the citation verifier cannot check yet** (`source-context.ts` `verifierBlindSpot`: no DOI, a DataCite DOI such as arXiv `10.48550`, or a synthetic dry-run DOI outside a dry run; D-18-37), which get one WARN naming them (`pensmith plan: WARN — section N leaves out …: the citation verifier cannot check them`). `.paper/LIBRARY.json` → one source-context record per allowed citekey (citekey, title, authors, year, venue, abstract, tier, `full_text`). A source assigned only to another section never appears (FEED-01). A section with no sources gets one WARN naming how to add some.
   - The planned PLAN.md of each `depends_on` section → a short summary of its claims (without their citekeys). A stub is not summarised.

3. **Run the planner**: the fixed `templates/prompts/section-planner.md` instructions (D-12 LOCKED slug) plus the data blocks `brief`, `section`, `upstream` (when any) and `sources` (fenced as untrusted data, FEED-05) → a structured object `{frontmatter: {section, slug, title, depends_on, assigned_sources}, claims: [{claim, sources, evidence, counterexamples}], structure: [{paragraph, purpose, claims}], voice}`.

4. **Validate** (`plan-validate.ts`, GRND-13): the echoed `section`, `slug` and `depends_on` equal the OUTLINE row; `assigned_sources` ⊆ the allowed set ⊆ LIBRARY.json; every claim's sources ⊆ `assigned_sources`; every structure paragraph names existing claims. Any problem gets ONE corrective turn naming it (e.g. `assigned_sources has citekeys that are not this section's sources: X, Y`). Still invalid → exit 1 with `planner output invalid: <problems> — nothing was written; <PLAN.md> is unchanged`: the stub stays byte-identical and the router still sends the section to `plan`.

5. **Write `<sectionPlan(n, slug)>`** = `.paper/sections/<NN>-<slug>/PLAN.md` via `bin/lib/atomic-write.ts` (D-07 chokepoint), under the file's lock, rendered from the validated object (never the model's text): the outline entry kept, a `wave:` override carried over, `stub` dropped, `status: 'planned'`, `verified_against_draft_hash: null`. A planned section routes to `write`; only `write` sets `writing`.

6. **Section-isolation invariant** (TEST-09): this verb MUST NOT touch any file outside `.paper/sections/<NN>-<slug>/`. The `tests/section-isolation.test.ts` mtime gate enforces this in CI.

7. **Shell fallback** (TIER-06 equivalence path): `pensmith plan <N> [--revise] [--research <query>] [--yolo]`.

## Revise body (PLAN-02 / D-05 / D-06 — citation repair behind the approval gate)

> **Surface note**: `revise` is NOT a separate UX-02 verb (the locked 16 are
> bijective with `workflows/*.md`). The canonical revise surface is
> `pensmith plan <N> --revise`; both it and the thin `bin/cli/revise.ts`
> CommandDef delegate to the SAME `bin/lib/revise.ts::runRevise` chokepoint
> (D-06 — no divergent Tier-1/Tier-2 path). WRTE-02 is satisfied here.

When invoked with `--revise` (or `--research <query>`), `pensmith plan <N>`
repairs ONE verifier-flagged citation rather than authoring a fresh PLAN.md:

1. **Parse the verdict** — read `<sectionVerification(n, slug)>` and take the
   FIRST `FABRICATED` / `MIS-CITED` / `NOT_FOUND` citation in order of
   appearance (one-at-a-time; re-run until clean).
2. **Load `assigned_sources` + voice hint** from `<sectionPlan(n, slug)>`
   frontmatter and `## Brief` (WRTE-02 per-section voice consume point — the
   voice line is threaded into the swap prompt vars).
3. **Propose a swap** — invoke the hash-pinned `revise-swap` prompt (D-05).
   Parse the strict-JSON response and REJECT it if `action ∉ {swap, remove}`
   or `replacement_citekey ∉ assigned_sources` (T-04-14 — no new citekeys ever
   reach DRAFT.md).
4. **Approval gate (default-on, PRD §19)** — render the before/after citation
   diff and ask via `AskUserQuestion`; degrade to `@clack/prompts` in a TTY.
   `--yolo` skips the gate and auto-loops the SAME path up to 2 retries, then
   writes a `RETRY_EXHAUSTED` verdict to VERIFICATION.md (D-06). A non-TTY
   without `--yolo` exits code 3.
5. **On accept** — `swap` substitutes the flagged `[@k]` (via the Plan 01
   `replaceCitekeys` token locator); `remove` mechanically deletes the bracketed
   citation clause (NO LLM prose rewrite). The patched DRAFT.md is written via
   `bin/lib/atomic-write.ts` and `verified_against_draft_hash` is reset to
   `null` (D-05), so the next `pensmith verify <N>` re-runs from scratch.
6. **`--research <query>`** (PLAN-03 / D-09) — merge the findings into the
   paper library through the one library writer (`upsertSources` in
   `bin/lib/library.ts`, BRDTH-01: `.paper/LIBRARY.json`, deduped, provenance
   tag `plan-research:§<N>`, with `.paper/CITATIONS.bib` / `.ris` re-rendered
   from it), append them to the project-level `.paper/RESEARCH.md`, and append a provenance row to `sections/<N>/RESEARCH-LOG.md` (query,
   adapter, hit-count, citekeys-added, timestamp). This is the ONLY
   section-level file `--research` creates — NO other section's files are
   touched (section-as-phase isolation, TEST-09).
