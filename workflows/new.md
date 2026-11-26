# pensmith new

> Start a new paper project: keep the assignment word for word, ask the six intake
> questions, and store the answers as data (`.paper/INTAKE.json`) for the later verbs.
>
> CYCLE-3 NAMING NOTE: per Plan 06 REVIEWS CONVERGENCE, the canonical user-facing verb is
> `pensmith intake`; `pensmith new` is a friendly alias mapped by the bin/cli/index.ts
> dispatcher (Plan 07). This workflow file is named `new.md` to remain bijective with the
> UX-02 16-verb canonical list (bin/lib/verbs.ts) that ARCH-01 (workflows-keyequal.test.ts)
> enforces; when Plan 07 renames the verb in `verbs.ts`, this file will move to
> `workflows/intake.md`. Until then, this file *is* the intake workflow body.

<capability_check>
required:
  - AskUserQuestion

degrade_if_missing:
  - if no AskUserQuestion: read response from stdin in Tier 2
</capability_check>

## Overview

`pensmith new` (canonical alias: `pensmith intake`) bootstraps a paper project from an
assignment text + a discipline-aware clarifying battery. It is the front door of the
workflow: intake → research → outline → (plan → write → verify)* → compile.

The implementation lives in `bin/cli/intake.ts` (created by Plan 07). The workflow body
below is the prompt that drives the verb's behavior under both Tier 1 (Task/MCP) and
Tier 2 (shell) — the `<capability_check>` block above degrades the Tier-1 affordances
to a Tier-2 shell invocation when those tools are unavailable, preserving TIER-06
equivalence.

## Steps

1. (see Body below — `## Body` is the executable prompt; the steps above are just an overview)

## Outputs

- `.paper/PROJECT.md`: the assignment, word for word, under `## Assignment` (redacted when PII redaction is on)
- `.paper/INTAKE.json`: the answers: `topic`, `discipline`, `length_words`, `citation_style`, `audience`, `counterargument`; `INTAKE.md` is a readable copy
- `.paper/config.toml`: `[project] citation_style` (and the other settings whose flags are given), edited in place
- `.paper/INTAKE.raw.local`: the unredacted assignment when PII redaction is on (kept out of git by `.paper/.gitignore`)

## Body

1. **Print the §3 disclaimer** before any question or model call.

2. **Find the assignment**: `--from <file>` (`-` reads stdin), else `assignment.txt`, `.md` or `.pdf` in the folder, else `--thesis` (from `sketch`), else the one an earlier run kept in `.paper/PROJECT.md`, else ask for it. With no terminal and no assignment, the CLI exits 3 and prints the pending question as one JSON line.

3. **Keep it**: write `.paper/PROJECT.md` before any model sees the text. With PII redaction on, the raw text goes only to `.paper/INTAKE.raw.local` and everything else, the model included, gets the redacted text.

4. **Get the questions**: one structured call to the `intake-clarifier` prompt returns `{topic, questions: [{id, question, suggested}]}`. It is made only when an answer is still missing, and its questions are kept for the answering run, so that run calls no model.

5. **Ask them**: every one of the six questions is asked; a suggestion is only a default. Tier 1: ask the user with AskUserQuestion, then run `pensmith new --answers '<JSON object of id to answer>'`. Tier 2 on a terminal: the CLI asks. With no terminal, the CLI exits 3 and prints `{pending: "intake-questions", questions, answered, how_to_answer}`; nothing is guessed. Answers already given are kept for that assignment until intake completes, so the next run need send only the questions listed; the options given with them (`--pii-redact`, `--thesis`, `--style-samples` and the others) are kept too, so PII redaction asked for on the first run still applies to the answering run. An answer pensmith cannot use (an unknown style, a length that is not a number) is refused with exit 2, or asked again on a terminal.

6. **Save**: `.paper/INTAKE.json` and `INTAKE.md`, then `.paper/STATE.json`, then `[project] citation_style` in `.paper/config.toml`. Only settings given to this intake (on this run, or on a run that stopped for answers) are written; a file that does not parse is left as it is, with a warning.

7. **Shell fallback (TIER-06)**: `pensmith new [--from <file>] [--answers <file|json>] [--citation-style <style>] [--pii-redact]` (alias `pensmith intake`).
