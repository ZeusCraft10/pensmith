---
name: verify-section
description: "Plumbing for scripts: re-check one section's citations, the same step as `/pensmith verify N`."
disable-model-invocation: true
argument-hint: "<N> [--slug <slug>] [--accept-quote <qK>]"
---

# /pensmith:verify-section

Run the pensmith verb `verify $ARGUMENTS` and nothing else.

Use the Skill tool to invoke the `pensmith:pensmith` skill with the arguments
`verify $ARGUMENTS`, and follow it: it knows how each verb runs in this release
(an MCP tool or the pensmith CLI) and how to report the result. Do not pick a
different verb, chain further steps or change the arguments. This command is
the scriptable spelling of `/pensmith verify $ARGUMENTS` (and of
`pensmith verify $ARGUMENTS` in a terminal), for automation such as
`claude -p "/pensmith:verify-section ..."`. It adds no verb: pensmith keeps exactly 16.

`N` is the section id as `pensmith status` shows it. A blocking verdict (FABRICATED, MIS-CITED, RETRACTED, UNVERIFIABLE(-NETWORK), an unparseable or unsupported citation form, or a quote NOT_FOUND) stops compile and export until the section is fixed; compile and done recompute every verdict themselves. `--accept-quote qK` accepts one quote VERIFICATION.md lists as UNVERIFIABLE-QUOTE (its source text cannot be checked), and only on the user's own decision: one id at a time, never a blanket acceptance.
