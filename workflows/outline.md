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

- `.paper/OUTLINE.md` — human-readable Markdown outline (committed)
- `.paper/sections/<NN>-<slug>/` — one empty directory per section (PLAN.md lands in the `plan` verb)

## Body

1. **Read `.paper/INTAKE.md` and `.paper/LIBRARY.json`** as inputs (LIBRARY.json includes any `retracted: true` flags from `research` step 5).

2. **Generate outline** (OUTL-01 / OUTL-02): invoke `templates/prompts/outline-author.md` (D-12 LOCKED slug per Plan 03 CONTEXT D-12) → list of sections `{n, slug, title, depends_on, estimated_word_count, assigned_sources: [citekey, ...]}`.

3. **Validate**:
   - `PlanFrontmatterSchema.parse(entry)` for each section (D-04 refinements: slug format, no-self-ref, status enum from D-08-AMENDED).
   - Walker check (OUTL-04): all `depends_on` slugs resolve to an existing section in this outline AND no cycles (Tarjan or simple DFS — `bin/lib/outline-walker.ts` or inline DFS in the verb).

4. **APPROVAL GATE** (OUTL-03 — PRD non-negotiable):
   - Print the outline to stdout in a human-readable table: `| # | slug | title | depends_on | word target | assigned_sources |`.
   - **Retraction annotation (Codex MEDIUM consensus #19 / OpenCode MEDIUM — locked)**: for any section whose `assigned_sources` contains a citekey marked `retracted: true` in LIBRARY.json, append a `RETRACTED` annotation line of the literal form:

     ```text
     > ⚠ Section ${n} (${slug}) — ${k} of ${total} assigned sources flagged as RETRACTED. Recommend revising before approval.
     ```

   - Unless `--yolo` flag is set: pause via `AskUserQuestion` (Tier 1) or `@clack/prompts` (Tier 2) and request user confirmation: `approve / edit / cancel`.
   - If `edit`: loop back to step 2 with the user's feedback appended as additional context to the `outline-author.md` prompt.
   - If `cancel`: exit non-zero, no state mutation.
   - If `--yolo` is set: skip the prompt and proceed (auto-approve — but the RETRACTED annotations are still emitted to stderr for the audit trail).

5. **Persist `.paper/OUTLINE.md`** (atomic via `bin/lib/atomic-write.ts`, D-07 chokepoint) as human-readable Markdown. Create `.paper/sections/<NN>-<slug>/` directory per section (empty — `PLAN.md` lands when `plan` verb runs). Use `bin/lib/paths.ts sectionDir(n, slug)` (Plan 03 Wave 2) for the path.

6. **Shell fallback** (TIER-06 equivalence path): `pensmith outline [--yolo]`.
