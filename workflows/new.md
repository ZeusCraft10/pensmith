# pensmith new

> Start a new paper project: take in the assignment, ask the intake questions,
> and write `.paper/INTAKE.md` — the paper's structured, versioned brief that
> every later step reads.
>
> `new` is the intake step (UX-02 verb; its implementation is `bin/cli/intake.ts`).
> There is no `intake` verb: `pensmith intake` is an unknown command (RUN-11, exit 2).

<capability_check>
required:
  - AskUserQuestion

degrade_if_missing:
  - if no AskUserQuestion: the CLI asks the same questions in the terminal (@clack/prompts), reads scripted numbered answers from stdin with PENSMITH_PROMPT_MODE=numbered, or takes them from flags or --answers <file.toml>
</capability_check>

## Overview

`pensmith new` bootstraps a paper project in the current folder. It is the front
door of the workflow: new → research → outline → (plan → write → verify)* →
compile → done. A bare `pensmith` in a folder with an assignment file (or, when no
`pensmith open` pointer is set, with an assignment piped on stdin) runs it.

The intake asks a fixed battery of questions (PRD §7.1) and makes ONE model call,
the `intake-clarifier`, which only *suggests*: a topic phrase, a discipline preset,
the paper type, a working thesis, the length and citation style the assignment
states, sectioning instructions, and at most three follow-up questions specific
to this assignment. The suggestions are the defaults the user is offered; the
brief is built from the user's answers — the clarifier's reply is never written
as INTAKE.md.

## Outputs

- `.paper/INTAKE.md` — the brief (GRND-03): versioned YAML frontmatter (`topic`,
  `thesis`, `discipline`, `paper_type`, `mode`, `class`, `counterargument`,
  `length_target_words`, `citation_style`, `sectioning_notes`, `pii_redaction`,
  `style_match`, `assignment_source`, `follow_ups`, and the answer to the
  "what is this paper for" question), then the assignment (verbatim, or redacted
  when PII redaction is on) and a "Questions and answers" section that says
  where each answer came from.
- `.paper/config.toml` — `[project]` mirrors the answers (mode, class,
  discipline_preset, citation_style, length_target_words,
  counterargument_required for a yes/no answer, pii_redaction, and the purpose
  answer) and `[style]` the style-match opt-in (match_past_writing, samples_dir).
- `.paper/STATE.json` — the paper's state (idempotent: an existing paper keeps its paperId).
- `.paper/STYLE.json` — only with the style-match opt-in (a folder of writing samples).
- `.paper/INTAKE.raw.local` — only with PII redaction on: the raw text before
  redaction (gitignored via `.paper/.gitignore`, never committed, never sent to a model).
- The paper's entry in the global paper registry, under the answered class
  (`pensmith list`).
- With `--pdfs <dir>`: `[sources] byo_pdf_dir` in `.paper/config.toml`, and
  `.paper/LIBRARY.json`, `.paper/CITATIONS.bib` / `.ris`, `.paper/RESEARCH.md` and
  `.paper/sources/<citekey>.pdf` for the bring-your-own PDFs.

## Body

1. **Get the assignment** (GRND-01), in this order:
   - `--from <file>` or a positional `@<file>` — `.txt`, `.md` or `.pdf` (a PDF is
     reduced to its text; no PDF bytes are stored);
   - an assignment piped on stdin (`printf '…' | pensmith new`, `pensmith new <
     assignment.txt`) — read only when no file was named and stdin is a pipe or a
     file, never in numbered-answer mode, and given up after 2 s of silence; piped
     text of fewer than 3 words (a confirmation such as `y`) is refused;
   - an `assignment.txt` / `assignment.md` / `assignment.pdf` in the folder, through
     the `assignment-pickup` gate: a terminal confirms it; `--yolo` or a run without
     a terminal uses it and names it; several such files need a choice (a terminal
     selects; otherwise name one with `--from` or `@`, exit 2);
   - otherwise, in a terminal, the user pastes it (end with a line holding only `.`).
   A `--thesis` seed from `sketch` may stand in for the assignment. A missing,
   unsupported, unreadable or empty input fails with one line; no assignment at
   all in a run that cannot prompt is exit 2 (`no assignment found`) with nothing
   written.

2. **Collect the answers given up front** (GRND-02): flags of `pensmith new`
   (a bare `pensmith` takes only the global flags and refuses an intake flag,
   naming `pensmith new`), or `--answers
   <file.toml>` (keys are the question ids below, plus `thesis` and a
   `[follow_ups]` table keyed by follow-up id). `pensmith new --questions` prints
   the battery — id, question, options, flag, answers-file key — as JSON. An
   invalid value or an unknown key is a usage error naming the valid ones.

3. **Refuse what cannot be answered**: a run with no terminal, no `--yolo` and an
   unanswered question stops at the `intake-defaults` gate (exit 3), naming each
   unanswered question and its flag — before any model call or write.

4. **Print the §3 disclaimer** (DOCS-01), then check that a model is configured
   (RUN-07: with none, exit 1 and nothing written).

5. **PII redaction — opt-in, asked first** (GRND-05): "Redact personal
   information (names, IDs, emails, phone numbers, dates) before any model
   call?" (`--pii-redact` / `--no-pii-redact`, default no). When on, the
   assignment, the thesis seed, the class and the follow-up answers are redacted
   by `bin/lib/pii.ts` before the clarifier call and before INTAKE.md is
   written; each redaction is printed as a reviewable `[KIND] "raw" → tag` line;
   the raw text goes only to `.paper/INTAKE.raw.local`. Entity phrases ("French
   Revolution", "Treaty of Versailles"), month fragments ("Due March"), the
   assignment's labelled `Topic:` line, and identifiers (DOIs, ISBNs, arXiv ids,
   UUIDs, timestamps) are never redacted.

6. **Clarify** (one structured call): the `intake-clarifier` template is the
   fixed system prompt (the same bytes on every call, so it is cached); the data
   is one user message of tagged blocks — `<disciplines>` (the presets),
   `<answers>` (what flags or the answers file already fixed) and
   `<assignment>` (fenced as untrusted data). The reply is validated against the
   contract (one corrective retry). A reply that copies the template's own
   example is discarded, and a suggested topic that shares no word with the
   assignment gives way to the assignment's own topic phrase.

7. **Ask the battery** (GRND-02), each unanswered question with the suggestion
   (or the preset's default) as its default:
   1. PII redaction (asked in step 5);
   2. discipline preset — the presets of `templates/presets/disciplines.json`;
   3. mode — full draft, or outline only (`[project] mode = "outline"`: bare
      `pensmith` / `next` / `resume` stop once the outline is approved and plan,
      draft and verify no section; an explicit `pensmith plan N` still runs);
   4. what the paper is for (the question, its options and its flag come from the
      question list);
   5. class (default Unfiled);
   6. counterargument and rebuttal section — yes, no or auto;
   7. style-match — a folder of your writing samples, or no;
   8. length target — the assignment's stated length ("1500-word", "6 pages" ×
      300) else the clarifier's else 1500;
   9. citation style — a plain-English instruction in the assignment ("Use MLA
      for this paper", "APA 7") else the clarifier's suggestion else the preset's
      default; names are matched through the alias table (Chicago →
      chicago-notes-bib), an unknown style is refused listing the 8.
   Then the clarifier's follow-ups (≤ 3). Tier 1 asks each question with
   `AskUserQuestion`, writes the answers to a TOML file, and runs
   `pensmith new --answers <file>`; Tier 2 asks in the terminal. Under `--yolo`
   the suggestions are accepted and printed; follow-ups that cannot be asked
   record the clarifier's suggested answer and say so. Scripted numbered answers
   that run out part-way through the battery end in the `intake-defaults`
   refusal (exit 3), nothing written. Sectioning instructions ("I need a
   literature review section before methods") in the assignment or any answer go
   into the brief's `sectioning_notes` and on to the outline.

8. **Write the paper** (atomic writes): `.paper/STATE.json`, `.paper/INTAKE.md`,
   the config.toml mirror (through `bin/lib/config.ts`), `.paper/STYLE.json` when
   opted in (a notice is printed, unconditionally, when the same samples styled
   an earlier paper), and the registry entry.

9. **Bring-your-own PDFs** (SRC-15, PRD §7.15 / §9): with `--pdfs <dir>` — checked
   before anything is sent or written (a missing folder is exit 2) — the folder is
   recorded as `[sources] byo_pdf_dir` in `.paper/config.toml` (relative to the paper
   folder when it lies inside it), and every PDF in it is ingested after `INTAKE.md`
   and config.toml exist (`bin/lib/byo-ingest.ts`): hashed (sha256; re-ingest is
   idempotent), read in the SEC-02 worker, identified from its metadata, the
   identifiers on its first pages, or its title and first author (only an identifier
   or the title leaves the machine, one lookup per registrar consulted), copied to
   `.paper/sources/<citekey>.pdf`, and added to `.paper/LIBRARY.json` tagged
   bring-your-own with the PDF's and its text's sha256. A PDF no registrar matches
   confidently is kept with its own metadata, flagged unhydrated, with a warning.
   One line per PDF; a PDF that cannot be ingested never fails `new`. RESEARCH.md's
   source list shows them with the bring-your-own tag, and the next step is still
   research.

10. **Shell fallback** (TIER-06 equivalence path): `pensmith new [@<file>]
   [--from <file>] [--answers <file.toml>] [--discipline <preset>] [--mode
   draft|outline] [--class <name>] [--counterargument yes|no|auto]
   [--style-samples <dir>] [--pii-redact] [--length <words>] [--citation-style
   <style>] [--thesis <text>] [--pdfs <dir>] [--yolo]` — give the assignment once (`@<file>` or
   `--from`); `--no-pii-redact` answers the PII question with no,
   `--style-samples no` the style-match question; the purpose flag and every
   answers-file key are listed by `pensmith new --questions`.
