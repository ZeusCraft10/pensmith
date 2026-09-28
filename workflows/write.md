# pensmith write

> Draft one section, then verify it. Per-section verb — touches ONLY
> `.paper/sections/<NN>-<slug>/` (TEST-09 section-isolation invariant).
> The drafter request is built only from the validated `DrafterInput`
> (`assertDrafterInput`, T-3-10 / FEED-02) and every draft is checked for
> containment before it is kept (FEED-04).

<capability_check>
required:
  - MCP state.update

degrade_if_missing:
  - if no MCP tools: direct file writes via atomicWriteFile
  - wave mode — if no parallel capability (Task / MCP scheduler): invoke
    bin/lib/write-orchestrator.ts in-process and drain waves SERIALLY
    (Semaphore(1) === --max-parallel 1) — same code path, just a
    concurrency cap of 1
</capability_check>

## Overview

`pensmith write <N>` is the second of the three per-section verbs (plan → **write** → verify).
It is the only verb that produces narrative prose for the paper. The drafter sees a
RESTRICTED VIEW of the library: only the `assigned_sources` citekeys from the section's
PLAN.md, never the full LIBRARY.json (PRD §7.6 — Pitfall 7 chinese-wall). `N` is a section
id: a number, or a number and a letter for a section a re-outline inserted (`1a`).

After a draft is kept, `write` chains straight into `verify` for that section (GRND-15) and
exits with verify's code, so one command takes a planned section to `verified` (or to the
blocking verdict that stops it). `--no-verify` leaves the section `written`.

`pensmith write` with NO section id runs **wave mode**: it loads the outline, builds the
dependency wave graph (`bin/lib/scheduler.ts::buildWaveGraph`, from `depends_on` plus `wave:`
overrides), and drains the waves one at a time via
`bin/lib/write-orchestrator.ts::runAllSections`, writing each wave's sections in bounded
parallel. Every node routes through the SAME single-section writer, so the `assertDrafterInput`
chokepoint and the containment check run per section — never bypassed.

The implementation lives in `bin/cli/write.ts`; the drafter input in `bin/lib/drafter-input.ts`,
the containment check in `bin/lib/draft-containment.ts`. The workflow body below is the prompt
that drives the verb under both Tier 1 and Tier 2.

## Outputs

- `.paper/sections/<NN>-<slug>/DRAFT.md` — Markdown body with Pandoc `[@citekey]` citation tokens (D-21)
- `.paper/sections/<NN>-<slug>/PLAN.md` — frontmatter `status: 'writing'` → `'written'` (then verify's status)
- `.paper/sections/<NN>-<slug>/VERIFICATION.md` — written by the chained verify (absent with `--no-verify`)
- `.paper/sections/<NN>-<slug>/DRAFT.rejected.md` — only when containment rejected the draft (see step 6)

## Body

1. **Parse args**: `pensmith write <N>` — `N` is the section id (`3`, or `1a`). Resolve the slug from the section's STATE.json registration (OUTLINE.md's rows only while nothing is registered; a registered section whose OUTLINE.md row disagrees is refused naming `pensmith outline`, D-18-38); the section's folder is found by slug, and a registered lettered section with no folder yet is `NN<letter>-<slug>/`. An `N` that is not a section id from 1 to 99 (optionally with one letter), a section the outline does not have, or a `--slug` that is not the outline's slug for `N` is a usage error (exit 2) before any model call or write — a paper with an outline never gets a `NN-placeholder` section folder (RUN-09).

2. **Refuse an unplanned section**: the section's PLAN.md must be a planned file. The stub outline approval writes (`stub: true`) or a missing PLAN.md is a usage error (exit 2): `section N is not planned yet — run \`pensmith plan N\` first`. A PLAN.md that does not parse is one line naming the file and what is wrong with it — fix the file, or re-plan with `pensmith plan N`.

3. **Build the drafter input** (`bin/lib/drafter-input.ts::assembleDrafterInput`, validated by `assertDrafterInput` — T-3-10 / WRTE-04 / FEED-02). The strict `DrafterInput` holds exactly:
   - `paper` — topic, thesis, discipline and tone from the intake brief;
   - `section` — id, slug, title, role and word target from the PLAN.md outline entry;
   - `sources` / `sourceRecords` — the section's `assigned_sources` and their source-context records (citekey, title, authors, year, venue, abstract, tier, `full_text`) built by `bin/lib/source-context.ts` from LIBRARY.json — the RESTRICTED VIEW (PRD §7.6);
   - `plan` — the PLAN.md body (claims, structure, word target, voice);
   - `voiceHint` — the section's `voice` (PLAN.md, else its OUTLINE row), else a legacy explicit direction, else the style-match render of `.paper/STYLE.json`, else the discipline preset's tone — never empty;
   - `styleProfile` — only when style-match is on.
   `assertDrafterInput` THROWS on any extra or missing field and on a source record outside `sources`. The request (`buildDrafterRequest`) is built from this object only: the fixed `section-drafter` template as the system prompt and one user message of data blocks, the sources fenced as untrusted data. A section with no sources is drafted without citations, with one WARN on stderr.

4. **Set status to `'writing'`** (D-08-AMENDED LOCKED enum value) via `bin/lib/frontmatter.ts updateFrontmatter()`.

5. **Run the drafter** (`templates/prompts/section-drafter.md`, D-12 LOCKED slug) → Markdown body. The body MUST use Pandoc `[@citekey]` citation tokens (D-21 — citation tokens are the only way to reference sources).

6. **Containment** (`bin/lib/draft-containment.ts::checkDraft`, FEED-04): every citekey the draft cites — in any form Pandoc renders as a citation: `[@k]`, clusters, locators, `[-@k]`, `@{k}` or narrative `@k` (D-18-40) — must be one of the section's `assigned_sources`. A violation gets ONE corrective turn naming the citekeys it may use. If the second draft still cites outside the section, it is NOT kept: it goes to `DRAFT.rejected.md`, PLAN.md becomes `status: failed` with a `failure_reason` (`citekey X not assigned to section N`), and the command exits 4 (EXIT_BLOCKED) — `section N failed: … — the draft was not kept (it is in …/DRAFT.rejected.md); adjust the plan or sources, then run \`pensmith write N\``. No other section is touched, and an older DRAFT.md of this section is left as it was. Until `write N` succeeds, the router reports the failure as needing attention instead of verifying the older draft, and `verify N`, compile and the export gate refuse the section (exit 4) naming `pensmith write N`.

7. **Write `<sectionDraft(n, slug)>`** = `.paper/sections/<NN>-<slug>/DRAFT.md` via `bin/lib/atomic-write.ts` (D-07 chokepoint), remove a stale `DRAFT.rejected.md`, and set `status: 'written'` (clearing `failure_reason`). `write` never sets `verified_against_draft_hash` — verify owns it, so a re-write always forces re-verification (D-08-AMENDED cycle-break).

8. **Verify** (GRND-15): run verify for the section (`bin/cli/verify.ts::verifySection`, the same code as `pensmith verify N`), print `pensmith write: section N verify: <STATUS>`, and exit with verify's code (4 when a blocking verdict — FABRICATED, MIS-CITED, UNVERIFIABLE, quote NOT_FOUND — stops the section). `--no-verify` skips this step and prints `section N left written (--no-verify); run \`pensmith verify N\` next`.

9. **Section-isolation invariant** (TEST-09): this verb MUST NOT touch any file outside `.paper/sections/<NN>-<slug>/`. The mtime gate enforces.

10. **Wave mode** (`pensmith write` with NO `<N>`): load the outline, build the wave graph,
   and drain `graph.waves` serially — each wave's sections run in bounded parallel under
   `--max-parallel` (default 5). The orchestrator persists NO wave state (ARCH-20 / D-04);
   it only invokes the per-section writer, which performs the existing atomic writes and the
   chained verify (each `section_done` line carries its `verify` status).
   - Both tiers honor `--max-parallel` as given; `--max-parallel 1` is a plain serial run and
     prints no warning. Parallel sections contend only on per-file locks, which queue with
     backoff (RUN-22) — 10 sections at `--max-parallel 10` never surface ELOCKED.
   - The outline's stubs are skipped, each with one stderr line
     `pensmith write: section N (slug) is not planned yet — skipped; run \`pensmith plan N\``.
   - A malformed PLAN.md never aborts the run with a schema dump: it is ONE stderr line naming
     the file and the field (`pensmith write: section N (slug) skipped — .paper/sections/…/PLAN.md:
     invalid field "section": Required`), the independent sections still draft, and the run
     exits non-zero.
   - Within-wave failures do NOT cancel siblings; a section whose dependency failed is marked
     `blocked` and skipped, while orthogonal subtrees still complete (D-03).
   - Every failed section is ONE stderr line, `pensmith write: section N (slug) failed: <reason>`
     (classified like a single-section run), and the run exits with the failures' documented
     code: 5 when the session cost cap refused a call, the shared code when every failure has
     the same one, else 1 (RUN-09, RUN-12). A failure every later section would repeat — the
     cost cap, a missing key, an invalid runtime config — stops the run: sections not yet
     started are reported `skipped` (never attempted), with one line saying how many.
   - Progress streams as structured JSON lines to stdout (`section_start` / `section_done` /
     `wave_complete`); diagnostics go to stderr to keep the MCP stdio frame clean.
   - Approval gates are NOT prompted per section here — wave runs are batched; section-level
     citation approval lives in `--revise`.

11. **Shell fallback** (TIER-06 equivalence path): `pensmith write [<N>] [--max-parallel K] [--no-verify] [--yolo]`.
