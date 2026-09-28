# pensmith outline

> Propose a section-level outline from the intake brief + LIBRARY, validate
> it, pause for user approval (OUTL-03 — PRD non-negotiable), then persist
> `.paper/OUTLINE.md` and give every section a stub `PLAN.md`.

<capability_check>
required:
  - AskUserQuestion

degrade_if_missing:
  - if no AskUserQuestion: read response from stdin
</capability_check>

## Overview

`pensmith outline` is the third verb (intake → research → **outline** → plan/write/verify).
It is the LAST step before per-section work begins, and the PRD non-negotiable approval
gate (OUTL-03) lives here: an outline is NEVER persisted without explicit user approval
unless `--yolo` is set.

The outline is one validated contract (GRND-07, GRND-08): the model's reply is checked
before anything is written, gets at most one corrective turn, and a reply that is still
invalid is kept for inspection instead of being silently re-requested (no re-billing).
Approval registers every section in STATE.json and writes its stub PLAN.md (GRND-09), so
the router can send the user straight to `plan 1`. Re-outlining a paper matches sections
by slug and never touches a kept section (GRND-10).

The implementation lives in `bin/cli/outline.ts`; validation in `bin/lib/outline-validate.ts`
and `bin/lib/counterargument.ts`; the stubs and re-outline numbering in
`bin/lib/section-stubs.ts`; the table in `bin/lib/outline-parse.ts`. The workflow body
below is the prompt that drives the verb under both Tier 1 (Task/MCP) and Tier 2 (shell).

## Outputs

- `.paper/OUTLINE.md` — the canonical outline: a `Thesis:` line, the 8-column table
  `| # | slug | title | role | depends_on | word target | assigned_sources | voice |`, and a
  `## Sections` list with each section's purpose (a legacy 6-column table is still read)
- `.paper/sections/<NN>-<slug>/PLAN.md` — one stub per section: the outline entry
  (`section`, `suffix`, `slug`, `title`, `purpose`, `role`, `depends_on`, `word_target`,
  `voice`, `assigned_sources`) with `stub: true` and `status: planned`
- `.paper/STATE.json` — every section registered (`{n, suffix?, slug}`)
- `.paper/OUTLINE.rejected.md` — only when the reply was rejected (deleted by the next accepted outline)
- `.paper/sections/_archive/<NN>-<slug>/` — a section a re-outline dropped

## Body

1. **An outline already exists**: when `.paper/OUTLINE.md` is valid and `--force` is not set, register its sections, write a stub PLAN.md for any section without a PLAN.md, and stop — no model call: `OUTLINE.md already present (N section(s)); registered N section(s) in STATE.json. Not regenerating — pass --force to re-outline.`

2. **Re-outlining a paper with drafts** (D-18-18): without `--force` this is a usage error (exit 2). With `--force` the `reoutline` gate asks first (RUN-28); `--yolo` answers it only together with `--force`, and a run that cannot ask refuses with exit 3 — no outline is requested and no section changes.

3. **Approval precheck** (RUN-28): a Tier-2 run that cannot ask (no terminal, no scripted `PENSMITH_PROMPT_MODE=numbered` answers) and has no `--yolo` refuses with exit 3 BEFORE the outline-author call — nothing is sent, billed or written.

4. **Build the request** (FEED-03, D-18-14): the fixed `templates/prompts/outline-author.md` instructions (D-12 LOCKED slug) plus data blocks:
   - `brief` — from `.paper/INTAKE.md`: topic, thesis, discipline and its sectioning convention, paper type, length target in words (config, else the brief, else the assignment, else 1500), sectioning notes, whether a counterargument section is required, and the 3–7 section bounds;
   - `existing_sections` — on a re-outline, the current sections (slug, title, role, whether each has a draft) so the model reuses the slugs it means to keep;
   - `sources` — every LIBRARY.json source as a short record (citekey, title, first author, year, tier, abstract excerpt), fenced as untrusted data (FEED-05).

   **Counterargument rule** (§7.4, D-18-19): required when `--no-counter` is absent and the paper's config says so, else the intake answer, else the paper type (argumentative types require it), else the discipline preset. It is enforced on the reply, before the approval gate.

5. **Validate the reply** (GRND-08): the structured contract (roles are the section roles; `NN-` slug prefixes are normalised), then `outline-validate.ts`: unique slugs, known and acyclic `depends_on`, no self-dependency, every `assigned_sources` citekey in LIBRARY.json, word targets summing to the length target ±20%, at most two body sections without sources (when the library has sources), and a counterargument + rebuttal section when required. Any error gets ONE corrective turn that quotes every error. Still invalid → the replies go to `.paper/OUTLINE.rejected.md`, the command exits 1 with `outline rejected: <errors> — OUTLINE.md and the sections are unchanged; …`, and OUTLINE.md, STATE.json and every section stay byte-identical — even under `--yolo`. `pensmith status` / the router then report the rejection as needing attention instead of calling the model again.

6. **APPROVAL GATE** (OUTL-03 — PRD non-negotiable, `outline-approval` in the gate registry):
   - Print the proposed outline in the canonical table.
   - **Retraction annotation**: for any section whose `assigned_sources` contains a citekey marked `retracted: true` in LIBRARY.json, show a `RETRACTED` annotation line of the literal form:

     ```text
     > ⚠ Section ${n} (${slug}) — ${k} of ${total} assigned sources flagged as RETRACTED. Recommend revising before approval.
     ```

   - Unless `--yolo` is set: ask (AskUserQuestion in Tier 1, the gate prompt in Tier 2) whether to accept the outline. Declining writes nothing; re-run `pensmith outline` to get a new proposal.
   - `--yolo` skips the prompt and proceeds.

7. **Persist** (atomic via `bin/lib/atomic-write.ts`, D-07 chokepoint):
   - A fresh outline is numbered 1..N in order. On a re-outline (GRND-10) sections are matched by slug: a kept section keeps its number, folder, PLAN.md, draft and verification byte-identical (and its PLAN.md `assigned_sources`); an inserted section takes the previous kept section's number plus the next free letter (`1a`, `1b`) or the next free integer at the end; a dropped section's folder moves to `sections/_archive/` and leaves STATE.json. The order kept sections appear in cannot change, so a reordering reply prints one WARN.
   - Write `.paper/OUTLINE.md` rendered from the validated object (never the model's text), register every section in STATE.json, create each new section's folder `sections/<NN>[a]-<slug>/` with its stub PLAN.md, and delete `.paper/OUTLINE.rejected.md`.
   - Print `registered N section(s) in STATE.json.` (and, on a re-outline, the kept / added / archived counts).

8. **Shell fallback** (TIER-06 equivalence path): `pensmith outline [--force] [--no-counter] [--yolo]`.
