---
name: plan-section
description: "Plumbing for scripts: plan one section, the same step as `/pensmith plan N`."
disable-model-invocation: true
argument-hint: "<N> [--revise] [--research \"query\"]"
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

`N` is the section id as `pensmith status` shows it (`3`, or `1a` for a section a re-outline inserted). `--revise` re-plans a section whose draft or verification needs work.
