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
3. Tell the user what the step did, then repeat. `pensmith status` also says
   why the next step is the one it names (for a section that failed
   verification, which citation and how to repair it).

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
| `pensmith add` | Add a source by DOI, arXiv ID, PDF, URL, or a .bib or CSL-JSON file. |
| `pensmith gate` | `pensmith gate answer <ref> <option>` passes the user's answer to a waiting decision back; `pensmith gate list` shows what is waiting. |
| `pensmith list` / `pensmith open` | List papers, switch the active one. |
| `pensmith resume` | Pick up the active paper where it stopped. |
| `pensmith sketch` | Explore a thesis before starting a paper. |

Where a command offers `--json`, use it and read the fields rather than
parsing the prose output.

## Exit codes

Read the exit status of every pensmith command.

- **Exit 0**: the step finished. Continue. If pensmith warned about an
  UNATTRIBUTED quotation (ten or more words with no citation), tell the
  user: they either cite its source or confirm it is their own data or an
  epigraph. If it warned about a work under an expression of concern, or a
  retracted work the user acknowledged, tell the user that too.
- **Exit 1**: unexpected error. Show the user the error text and stop.
- **Exit 2**: blocked or refused. Common causes: the verifier found a
  citation it could not confirm (FABRICATED, MIS-CITED, quote NOT_FOUND,
  RETRACTED, or UNRESOLVED when a registry could not be reached or the entry
  has no DOI, arXiv ID, PMID or ISBN to look up), a citation
  it cannot check at all (RAW_CITATION for a DOI or "(Author, 2020)"
  typed as text, UNPARSEABLE for a broken `[@key]`), an approval
  was refused, or the input was invalid. Report the reason as pensmith states it. Never
  edit `DRAFT.md`, `VERIFICATION.md`, `VERIFICATION.json`, the compiled
  `.paper/DRAFT.md` or the bibliography to make a check pass: compile and
  done check those files against what verify and compile recorded.
  A flagged citation is fixed with `pensmith plan N --revise` (the user
  approves the change), then verify again; `pensmith next` takes these steps
  in turn and says why. UNRESOLVED means retry once the registry is reachable, or,
  for an entry with no identifier, tell the user which source needs one. For
  RAW_CITATION and UNPARSEABLE, revise names what to rewrite; show the user
  and let them decide. For RETRACTED, tell the user the work was retracted;
  the usual fix is another source. Only when the user says the paper must
  cite the retracted work (for example, it discusses the retraction), run
  `pensmith ack N <citekey> --reason "<their reason, in their words>"`, then
  verify again. Never acknowledge a retraction on your own.
- **Exit 3**: pensmith needs a decision or answers from the user before it
  can continue, such as approving the outline, choosing sources, approving a
  citation repair, confirming the export, or answering intake questions. The
  command prints one line of JSON describing what it is waiting for: the
  gate, a `ref`, a summary, the options, and what to show (the outline, the
  candidates, the change). Show that to the user and ask with
  AskUserQuestion, offering exactly those options; then run
  `pensmith gate answer <ref> <option>` with their choice, which finishes the
  step. Intake's questions are free text: pass the answers back the way its
  JSON says. Never choose for the user, and never use `--yolo` to get past a
  gate.

## Flags

- Only add `--yolo` if the user typed it in this conversation. It skips the
  approval gates: the outline approval, research's choice of scope and of
  sources, the approval of a citation repair, and the export confirmation.
  It never waives a citation check, and it never gives GPTZero consent.
- Only add `--score` after the user agrees to send the paper text to GPTZero
  for the AI-likelihood score; never add it yourself. `pensmith done` says
  when that consent is missing.
- `--dry-run` shows what a step would do without network access or writes.
- `--estimate` shows the projected model cost without running anything.

## Honesty

- The AI-likelihood score pensmith can show is there for the user's own
  awareness. Never present pensmith as a way to get past AI detectors.
- The humanizer pass improves prose. Describe it that way.
- Exported documents carry no pensmith marker; do not add one.
