---
name: outline
description: "Plumbing for scripts: propose or apply the section outline, the same step as `/pensmith outline`."
disable-model-invocation: true
argument-hint: "[--force] [--no-counter]"
---

# /pensmith:outline

Run the pensmith verb `outline $ARGUMENTS` and nothing else.

Use the Skill tool to invoke the `pensmith:pensmith` skill with the arguments
`outline $ARGUMENTS`, and follow it: it knows how each verb runs in this release
(an MCP tool or the pensmith CLI) and how to report the result. Do not pick a
different verb, chain further steps or change the arguments. This command is
the scriptable spelling of `/pensmith outline $ARGUMENTS` (and of
`pensmith outline $ARGUMENTS` in a terminal), for automation such as
`claude -p "/pensmith:outline ..."`. It adds no verb: pensmith keeps exactly 16.

The outline has an approval gate. Without `--force`, a hand-edited `.paper/OUTLINE.md` is applied as written with no model call.
