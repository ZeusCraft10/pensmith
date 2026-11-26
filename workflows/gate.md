# pensmith gate

> Take back the user's answer to a decision a step stopped for, and finish
> that step. **Approval gates are default-on (CLAUDE.md non-negotiable):** the
> answer always comes from the user. Never choose an option yourself, and
> never add `--yolo` to get past a gate.

<capability_check>
required:
  - AskUserQuestion

degrade_if_missing:
  - if no AskUserQuestion: print the decision's summary and options, ask the user in the conversation, and wait for their reply before running `pensmith gate answer`
</capability_check>

## When

With no terminal to ask in (Claude Code's Bash tool, CI, a pipe), the steps
with an approval gate stop with exit 3 and print one line of JSON:

```json
{"pending":"outline-approval","gate":"outline","ref":"outline-1a2b3c4d5e6f",
 "summary":"Approve this outline of 5 section(s) and write OUTLINE.md?",
 "options":["approve","reject"],"default":"reject","outline":"…",
 "how_to_answer":"…run `pensmith gate answer outline-1a2b3c4d5e6f <option>`…"}
```

| Gate | Step | Options | Shown with it |
| --- | --- | --- | --- |
| `outline` | `pensmith outline` | `approve`, `reject` | `outline`: the proposed outline |
| `research-scope` | `pensmith research` | one scope label | `scopes`: each label with its queries |
| `research-candidates` | `pensmith research` | candidate keys; several, comma-separated, or `all` / `none` | `candidates`: key, title, authors, year, DOI, retracted |
| `revise` | `pensmith plan N --revise` | `approve`, `reject` | `change`: the text before and after, and the replacement work |
| `export` | `pensmith done` | `export`, `cancel` | `issues`: the advisory findings to review first |

The step keeps what it proposed in `.paper/gates/<gate>.json`, bound to the
files it was made from. Running the step again before the answer prints the
same decision and redoes no work (no model call, no search, no audit).

## Steps

1. Show the user the decision: its `summary`, and what came with it (the
   outline, the scopes, the candidates, the change, the issues).
2. Ask with AskUserQuestion, offering exactly the `options` (for
   `research-candidates`, let them pick several). Never answer for them, and
   never treat silence as a choice.
3. Run `pensmith gate answer <ref> <option>` with their choice. It records
   the answer and finishes the step that asked:
   - `outline` `approve` writes exactly the outline shown, checked again
     against the library; `reject` writes nothing (exit 2).
   - `research-scope` searches the chosen scope, then stops again (exit 3)
     for the candidates.
   - `research-candidates` adds exactly the chosen works to the library.
   - `revise` `approve` applies exactly the change shown; `reject` leaves
     DRAFT.md as it is (exit 2).
   - `export` `export` runs every export check again on the same text and
     exports it; `cancel` exports nothing (exit 2).
4. A proposal whose files changed since it was made is never applied: the
   step drops it and works afresh, or (for an outline, a revise or an export
   the user already answered) refuses with exit 2 and says why. An outline
   proposed with `--force` or `--no-counter` is applied under that flag.

`pensmith gate list` prints every decision still waiting, one JSON line
each: the same line the step printed when it stopped, proposal included. An unknown `ref`, or an option the decision does not offer, is refused
with exit 2.

## In Tier 1

The plugin skill runs this loop for every exit 3: show, ask with
AskUserQuestion, then `pensmith gate answer`. Intake's questions are the one
exception: they are free text, answered with `pensmith new --answers <json>`
as its own JSON line says.
