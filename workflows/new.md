# pensmith new

> Start a new paper project — take in the assignment, clarify it, detect the
> discipline, and persist a structured `.paper/INTAKE.md` for the verbs that follow.
>
> `new` is the intake step (UX-02 verb; its implementation is `bin/cli/intake.ts`).
> There is no `intake` verb: `pensmith intake` is an unknown command (RUN-11, exit 2).

<capability_check>
required:
  - AskUserQuestion

degrade_if_missing:
  - if no AskUserQuestion: read response from stdin in Tier 2
</capability_check>

## Overview

`pensmith new` bootstraps a paper project in the current folder from an assignment
text and a discipline-aware clarification. It is the front door of the workflow:
new → research → outline → (plan → write → verify)* → compile → done.

The workflow body below drives the verb under both Tier 1 (Task/MCP) and Tier 2
(shell); the `<capability_check>` block above degrades the Tier-1 affordances to the
Tier-2 shell invocation when those tools are unavailable, preserving TIER-06
equivalence.

## Outputs

- `.paper/STATE.json` — the paper's state (the one STATE.json location, RUN-13)
- `.paper/INTAKE.md` — the clarified assignment: topic, discipline and the clarifying
  questions (rendered from the validated `intake-clarifier` object, never copied from
  model prose)
- `.paper/config.toml` — the paper's `[project]` settings (`pii_redaction` when `--pii-redact` is given)
- `.paper/INTAKE.raw.local` — ONLY with PII redaction on: the raw, un-redacted text
  (gitignored via `.paper/.gitignore`, never committed, never sent to a model)

## Body

1. **Print the §3 disclaimer** (DOCS-01): before any prompt or model call, print the
   PRD §3 dual-use disclaimer verbatim to stdout, so CLI-only users who never read the
   README still see it.

2. **Get the assignment** (GRND-01): `--from <file>` (.txt, .md or .pdf), else an
   `assignment.{txt,md,pdf}` in the paper folder, else — in a terminal — the user pastes
   it. `--thesis <text>` (supplied by `sketch`) seeds it too. With no assignment and no
   terminal the verb exits 2 (EXIT_USAGE) and writes nothing.

3. **PII redaction — opt-in only** (ERGO-07 / SC-3): when `--pii-redact` is given (or
   `[project] pii_redaction = true` in `.paper/config.toml`; the flag wins), the
   assignment text is redacted by `bin/lib/pii.ts` BEFORE anything reaches the model:
   each detected span is printed as a reviewable `[kind] "raw" → tag` line, the raw
   text goes to `.paper/INTAKE.raw.local`, and the redacted text is what the model
   sees and what `INTAKE.md` keeps. With redaction off (the default), the assignment
   text is used as given — nothing is redacted.

4. **Clarify** (INTK-02): the `intake-clarifier` prompt (D-12 LOCKED slug) is sent
   through `complete()` as a STRUCTURED call that returns `{topic, discipline,
   questions[]}` validated against its contract (one corrective retry on a schema
   miss, RUN-25). The discipline is named from the preset list (computer-science,
   biology, history, literature, psychology, economics, philosophy, sociology), with
   `other` as the fallback.
   - Tier 1 with `AskUserQuestion`: put the clarifying questions to the user and fold
     the answers into the assignment context before writing.
   - Tier 2: the questions (each with a suggested answer) are recorded under
     `## Clarifying questions` in `INTAKE.md` for the user to review.

5. **Write the paper** (atomic writes via `bin/lib/atomic-write.ts`): `.paper/STATE.json`
   (idempotent — an existing paper keeps its paperId), then `.paper/INTAKE.md`, the
   paper's `[project]` settings in `.paper/config.toml` (through `bin/lib/config.ts`),
   and the paper's entry in the global paper registry.
   With `--style-samples <dir>` (opt-in), a statistical style profile is written to
   `.paper/STYLE.json`.

6. **Shell fallback** (TIER-06 equivalence path): `pensmith new [--from <file>]
   [--thesis <text>] [--pii-redact] [--style-samples <dir>] [--yolo]`.
