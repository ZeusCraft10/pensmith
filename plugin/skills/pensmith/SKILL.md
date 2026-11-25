---
name: pensmith
description: Writes academic papers with the pensmith CLI — intake, source research, an approved outline, then plan, draft and citation-check each section before compiling and exporting. Use when the user asks to start, continue, revise or export an academic paper, essay or thesis, or when the project has a .paper/ workspace. Not for ordinary coding or general writing.
allowed-tools: Bash(pensmith:*)
---

# pensmith

Pensmith turns an assignment into a paper one section at a time. Each
section gets its own folder under `.paper/sections/`, and every citation in a
section is checked against Crossref and other scholarly registries before the
section can be compiled or exported. This is an alpha release.

The `pensmith` command is on PATH while this plugin is enabled. Run it with
the Bash tool; do not reimplement its steps yourself.

## Before you start

- Drafting, planning and outlining currently run through the pensmith CLI's
  own model calls, so they need `ANTHROPIC_API_KEY` set in the environment
  Claude Code was started from. Without a key those steps stop with an error.
  Tell the user this plainly instead of writing the sections yourself.
- If anything fails unexpectedly, run `pensmith doctor --json` and read the
  `probes` object: each probe has a `severity` (PASS, WARN, FAIL, SKIP), a
  `summary` and usually a `fix`.

## The loop

1. `pensmith status` shows where the paper is and what comes next.
2. `pensmith next` runs that next step: intake, research, the outline, then
   plan, write and verify for each section, then compile and done.
3. Tell the user what the step did, then repeat.

Run one step at a time and report between steps. The user can also ask for a
specific step:

| Command | What it does |
| --- | --- |
| `pensmith new` | Start a paper: capture the assignment and clarify the topic. |
| `pensmith research` | Find and screen sources into the paper's library. |
| `pensmith outline` | Propose a section outline; the user approves it. |
| `pensmith plan N` | Plan section N. `pensmith plan N --revise` repairs a citation the verifier flagged. |
| `pensmith write N` | Draft section N from its assigned sources only. |
| `pensmith verify N` | Check every citation and quote in section N. |
| `pensmith compile` | Assemble the verified sections into one draft. |
| `pensmith done` | Final audit and export; the user confirms. |
| `pensmith add` | Add a source by DOI, PDF or URL. |
| `pensmith list` / `pensmith open` | List papers, switch the active one. |
| `pensmith resume` | Pick up the active paper where it stopped. |
| `pensmith sketch` | Explore a thesis before starting a paper. |

Where a command offers `--json`, use it and read the fields rather than
parsing the prose output.

## Exit codes

Read the exit status of every pensmith command.

- **Exit 0**: the step finished. Continue.
- **Exit 1**: unexpected error. Show the user the error text and stop.
- **Exit 2**: blocked or refused. Common causes: the verifier found a
  citation it could not confirm (FABRICATED, MIS-CITED, quote NOT_FOUND,
  RETRACTED, or UNRESOLVED when a registry could not be reached), a citation
  or quotation it cannot check at all (RAW_CITATION for a DOI or
  "(Author, 2020)" typed as text, UNPARSEABLE for a broken `[@key]`,
  UNATTRIBUTED for a long quotation with no citation), an approval
  was refused, or the input was invalid. Report the reason as pensmith states it. Never
  edit `DRAFT.md`, `VERIFICATION.md` or the bibliography to make a check pass.
  A flagged citation is fixed with `pensmith plan N --revise`, then write and
  verify again; UNRESOLVED means retry once the registry is reachable. For
  RAW_CITATION, UNPARSEABLE and UNATTRIBUTED, revise names what to rewrite;
  show the user and let them decide.
- **Exit 3**: pensmith needs a decision or answers from the user before it
  can continue, such as approving the outline, confirming the export, or answering
  intake questions. The command prints a JSON object describing what it is
  waiting for: the gate, a summary and the options. Ask the user with
  AskUserQuestion, offering exactly those options, and pass their choice back
  the way that output says. Never choose for the user.

## Flags

- Only add `--yolo` if the user typed it in this conversation. It skips the
  outline approval and the export confirmation; it never waives a citation
  check.
- `--dry-run` shows what a step would do without network access or writes.
- `--estimate` shows the projected model cost without running anything.

## Honesty

- The AI-likelihood score pensmith can show is there for the user's own
  awareness. Never present pensmith as a way to get past AI detectors.
- The humanizer pass improves prose. Describe it that way.
- Exported documents carry no pensmith marker; do not add one.
