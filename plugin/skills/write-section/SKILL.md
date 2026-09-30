---
name: write-section
description: "Plumbing for scripts: draft one section and verify it, the same step as `/pensmith write N`."
disable-model-invocation: true
argument-hint: "<N> [--no-verify]"
---

# /pensmith:write-section

Run the pensmith verb `write $ARGUMENTS` and nothing else.

Use the Skill tool to invoke the `pensmith:pensmith` skill with the arguments
`write $ARGUMENTS`, and follow it: it knows how each verb runs in this release
(an MCP tool or the pensmith CLI) and how to report the result. Do not pick a
different verb, chain further steps or change the arguments. This command is
the scriptable spelling of `/pensmith write $ARGUMENTS` (and of
`pensmith write $ARGUMENTS` in a terminal), for automation such as
`claude -p "/pensmith:write-section ..."`. It adds no verb: pensmith keeps exactly 16.

`N` is the section id as `pensmith status` shows it. The section must be planned first; `write` verifies the new draft unless `--no-verify`.
