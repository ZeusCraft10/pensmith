---
name: compile
description: "Plumbing for scripts: assemble the verified sections into one draft, the same step as `/pensmith compile`."
disable-model-invocation: true
argument-hint: "[--discipline <preset>] [--lintHeadings] [--no-smooth] [--raw]"
---

# /pensmith:compile

Run the pensmith verb `compile $ARGUMENTS` and nothing else.

Use the Skill tool to invoke the `pensmith:pensmith` skill with the arguments
`compile $ARGUMENTS`, and follow it: it knows how each verb runs in this release
(an MCP tool or the pensmith CLI) and how to report the result. Do not pick a
different verb, chain further steps or change the arguments. This command is
the scriptable spelling of `/pensmith compile $ARGUMENTS` (and of
`pensmith compile $ARGUMENTS` in a terminal), for automation such as
`claude -p "/pensmith:compile ..."`. It adds no verb: pensmith keeps exactly 16.

Compile refuses while any section carries a blocking verdict and names the section to fix.
