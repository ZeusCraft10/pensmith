---
name: plan-section
description: "Plumbing for scripts: plan one section, the same step as `/pensmith plan N`."
disable-model-invocation: true
argument-hint: "<N> [--slug <slug>] [--revise] [--research \"query\"]"
---

# /pensmith:plan-section

Run the pensmith verb `plan $ARGUMENTS` and nothing else.

Use the Skill tool to invoke the `pensmith:pensmith` skill with the arguments
`plan $ARGUMENTS`, and follow it: it knows how each verb runs in this release
(an MCP tool or the pensmith CLI) and how to report the result. Do not pick a
different verb, chain further steps or change the arguments. This command is
the scriptable spelling of `/pensmith plan $ARGUMENTS` (and of
`pensmith plan $ARGUMENTS` in a terminal), for automation such as
`claude -p "/pensmith:plan-section ..."`. It adds no verb: pensmith keeps exactly 16.

`N` is the section id as `pensmith status` shows it (`3`, or `1a` for a section a re-outline inserted). `--revise` repairs a citation the verifier flagged (a row naming a citekey: FABRICATED, MIS-CITED, RETRACTED, UNASSIGNED, UNRESOLVABLE, a quote NOT_FOUND, or UNPARSEABLE on a bibliography entry), one a run, and `verify N` then re-checks the section; on a clean section it changes nothing — `plan N` then `write N` re-plans and redrafts a section, which is also the fix for every other blocking verdict (a row keyed `(L<line>)`, `doi:…`, `arXiv:…`, `PMID:…` or `(unattributed)`, or a draft check (`- draft:`), names text in the prose, not a citekey: an unreadable or unsupported citation form, an identifier written in the prose, an unattributed quote, a draft with no citations — edit the section's DRAFT.md and run `verify N`, or re-draft). A quote no source text could check (UNVERIFIABLE-QUOTE) is paraphrased by `write N`, never by `--revise`.
