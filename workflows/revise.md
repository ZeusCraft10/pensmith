# pensmith revise

> Swap or remove a verifier-flagged citation in one section. Per-section verb — touches
> ONLY `.paper/sections/<NN>-<slug>/` (TEST-09 section-isolation invariant).
>
> **D-06 LOCKED INVARIANT — single `bin/lib/revise.ts` chokepoint for both tiers.**
> Tier 1 (slash command) and Tier 2 (CLI) delegate identically to `runRevise`.
> No divergent code paths.

<capability_check>
required:
  - Task
  - AskUserQuestion

degrade_if_missing:
  - if no Task: route LLM call through PENSMITH_NO_LLM=1 stub (no swap attempt)
  - if no AskUserQuestion: degrade to @clack/prompts TTY approval; non-TTY without --yolo → exit code 3 + "use --yolo to auto-accept"
</capability_check>

## Overview

`pensmith revise <N>` is the section-mutation verb. It parses the section's VERIFICATION.md
for the FIRST FABRICATED / MIS-CITED / NOT_FOUND verdict, asks the LLM (via the hash-pinned
`revise-swap.md` prompt — D-05) to propose a citekey swap drawn ONLY from `assigned_sources`,
and routes the proposal through the **default-on approval gate** (PRD §19 non-negotiable).

On accept, DRAFT.md is patched atomically and `verified_against_draft_hash` is reset to null
(invalidating the prior verification). On reject, DRAFT.md is untouched, exit 0.

`--yolo` skips the approval gate and auto-loops the same code path up to **2 retries**
(retry cap = 2 per D-06). On retry exhaustion, `RETRY_EXHAUSTED` is written to
VERIFICATION.md and the user is asked to intervene manually.

`--research <query>` appends new findings to the project `.paper/RESEARCH.md` + bib AND
a provenance entry to `sections/<N>/RESEARCH-LOG.md` — touching NO other section's files
(D-09 / PLAN-03 cross-section isolation invariant).

The implementation lives in `bin/lib/revise.ts` (created by Plan 04-04).

## Approval Gate (PRD §19 — NON-NEGOTIABLE)

The approval gate is **DEFAULT-ON** and is required by PRD §19. The only way to skip it
is `--yolo` (explicit user intent). This gate MUST NOT be bypassed silently.

- **Tier 1 (AskUserQuestion available):** Use `AskUserQuestion` to show the before/after
  diff and collect user confirmation.
- **Tier 2 (TTY):** Use `@clack/prompts` `confirm()` to show the diff and collect confirmation.
- **Tier 2 (non-TTY, no --yolo):** Exit code 3 + stderr message "use --yolo to auto-accept".

## Steps

1. (see Body below)

## Outputs

- `.paper/sections/<NN>-<slug>/DRAFT.md` — patched (on accept)
- `.paper/sections/<NN>-<slug>/PLAN.md` — `verified_against_draft_hash` reset to null (on accept)
- `.paper/sections/<NN>-<slug>/VERIFICATION.md` — `RETRY_EXHAUSTED` appended (on exhaustion)
- `.paper/sections/<NN>-<slug>/RESEARCH-LOG.md` — provenance row (on --research)
- `.paper/RESEARCH.md` — research entry appended (on --research)

## Body

**D-06 LOCKED INVARIANT — NO divergent code path between Tier 1 and Tier 2.**
Both tiers call `runRevise(opts)` from `bin/lib/revise.ts` directly.

1. **Parse VERIFICATION.md**: Find the FIRST failing citation (FABRICATED/MIS-CITED/NOT_FOUND)
   in order of appearance. If no failure exists, exit 0 with "no failing citations found".
   Handle multi-failure one-at-a-time (D-06) — each `pensmith revise` invocation fixes one.

2. **Load context from PLAN.md**: Extract `assigned_sources` (the ONLY valid replacement pool)
   and the per-section voice hint from the `## Brief` body (WRTE-02 consume point).

3. **Call LLM via hash-pinned prompt**: Load `revise-swap.md` via `loadPrompt('revise-swap')`
   (D-05 / WN-3 hash-validated). Interpolate with flagged citekey, claim context, verifier
   reason, voice hint, and available sources. Parse the strict-JSON response with zod.
   **REJECT** if `action ∉ {swap,remove}` or `replacement_citekey ∉ assigned_sources`
   (T-04-14 LLM-injection mitigation — no new citekeys ever enter via this path).

4. **Approval gate (PRD §19 — NON-NEGOTIABLE)**:
   Render before/after diff (`patch.before_excerpt` → `patch.after_excerpt`) + rationale.
   Prompt user. Skip when `--yolo` (exit immediately to step 5). Non-TTY without `--yolo` → exit 3.

5. **On accept**:
   - **`swap`**: locate the `[@flagged_citekey]` token in DRAFT.md. Prefer
     `patch.before_excerpt` context for exact-occurrence disambiguation (handles
     duplicate citekeys). Use `replaceCitekeys` from `bin/lib/citation-token.ts`
     (Plan 01 — the ONLY citekey-swap primitive) as fallback. Write via `atomicWriteFile`.
   - **`remove`**: mechanically delete the bracketed clause containing the token
     (NO LLM prose rewrite — 04-RESEARCH §I). Precision rules:
     - Compound `[@a; @b]` — remove ONLY the targeted key, preserve remaining keys.
     - Sole `[@a]` — strip the entire `[...]` clause (normalize surrounding whitespace).
     - Duplicate citekey — disambiguate via `patch.before_excerpt`.
   - Reset `verified_against_draft_hash → null` in PLAN.md via `updateFrontmatter`
     under `withLock` (D-05).

5a. **On reject**: no-op, exit 0.

6. **--yolo auto-loop (D-06)**:
   - Re-run steps 3-5 up to 2 retries (retry cap = 2) if the LLM response fails
     validation or the proposed swap cannot be located in DRAFT.md.
   - On exhaustion: write `RETRY_EXHAUSTED` to VERIFICATION.md, exit 1.

7. **--research (D-09 / PLAN-03)**:
   - Invoke the research adapters with the query.
   - Append findings to `.paper/RESEARCH.md` (project-level, atomic).
   - Merge new bib entries into `.paper/CITATIONS.bib` via `bin/lib/bibtex-write.ts`
     with a non-standard `from_section: <N>` annotation.
   - Append a provenance row to `sections/<N>/RESEARCH-LOG.md` (query, adapter,
     hit-count, citekeys-added, ISO timestamp).
   - **TOUCH NO OTHER section's files** (PLAN-03 cross-section isolation).

8. **Section-isolation invariant** (TEST-09): this verb MUST NOT touch any file
   outside `.paper/sections/<NN>-<slug>/`, `.paper/RESEARCH.md`, or `.paper/CITATIONS.bib`.

9. **Shell fallback** (TIER-06 equivalence path): `pensmith revise <N> [--yolo] [--research <q>]`.
