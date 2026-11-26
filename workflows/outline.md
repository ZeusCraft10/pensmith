# pensmith outline

> Propose a section-level outline from INTAKE + LIBRARY, validate the
> dependency DAG, pause for user approval (OUTL-03 — PRD non-negotiable),
> then persist `.paper/OUTLINE.md` + scaffold the per-section subdirs.

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

The implementation lives in `bin/cli/outline.ts` (created by Plan 07). The workflow body
below is the prompt that drives the verb under both Tier 1 (Task/MCP) and Tier 2 (shell).

## Steps

1. (see Body below)

## Outputs

- `.paper/OUTLINE.json`: the paper's section list, the one every verb walks
- `.paper/OUTLINE.md`: the outline rendered for reading: title, thesis, the section table, each section's purpose
- `.paper/STATE.json` `sections`: replaced from the list on every outline write
- `.paper/sections/<NN>-<slug>/PLAN.md`: a stub per section (`status: stub`), written by code from the outline entry

## Body

1. **Read inputs**: `.paper/INTAKE.json` (topic, discipline, length, counterargument), the assignment in `.paper/PROJECT.md`, and the works in `.paper/LIBRARY.json`. When LIBRARY.json cannot be read, outline exits 2 before asking for an outline.

2. **Generate the outline** with `templates/prompts/outline-author.md`, as structured output (`ProposedOutlineSchema` in `bin/lib/outline-store.ts`): `{title, thesis, sections: [{slug, title, purpose, depends_on, word_target, assigned_sources, counterargument}]}`. pensmith numbers the sections in order.

3. **Check it in code** (`outlineProblems`): unique bare slugs; `depends_on` names other sections and forms no cycle; a section marked `counterargument` when the intake says one is required (unless `--no-counter`); every assigned source is a citekey LIBRARY.json holds; no title or heading holds a citation. A failing outline is sent back once with the problems; if it fails again, nothing is written and outline exits 2.

4. **APPROVAL GATE** (PRD non-negotiable): show the rendered outline. Unless `--yolo` was typed by the user, ask for approval (AskUserQuestion in Tier 1, a terminal prompt in Tier 2). With no terminal the CLI keeps the checked proposal in `.paper/gates/outline.json`, prints `{pending: "outline-approval", gate: "outline", ref, summary, options: ["approve","reject"], outline, how_to_answer}` and exits 3; running outline again shows the same proposal with no new model call. `pensmith gate answer <ref> approve` writes exactly that outline (checked again against the library); `reject` writes nothing and exits 2, as a rejection at a terminal does. A proposal kept for an intake that changed since is dropped and a new one made.

5. **Write** `OUTLINE.json`, `OUTLINE.md`, STATE.json's sections and the stub PLAN.md files. A section folder no section names any more is reported and left in place. An existing outline is not regenerated without `--force`; a hand edit of OUTLINE.md (or a hand-written OUTLINE.md) is checked by the same rules and taken in by `pensmith outline`, and until then the router sends the paper back to outline. A hand-written OUTLINE.md with no OUTLINE.json is read with the same structure, heading and source checks.

6. **Shell fallback (TIER-06)**: `pensmith outline [--yolo] [--force] [--no-counter]`.
