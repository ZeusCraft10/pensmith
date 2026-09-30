---
name: done
description: "Plumbing for scripts: finish and export the paper, the same step as `/pensmith done`."
disable-model-invocation: true
argument-hint: "[--raw]"
---

# /pensmith:done

Run the pensmith verb `done $ARGUMENTS` and nothing else.

Use the Skill tool to invoke the `pensmith:pensmith` skill with the arguments
`done $ARGUMENTS`, and follow it: it knows how each verb runs in this release
(an MCP tool or the pensmith CLI) and how to report the result. Do not pick a
different verb, chain further steps or change the arguments. This command is
the scriptable spelling of `/pensmith done $ARGUMENTS` (and of
`pensmith done $ARGUMENTS` in a terminal), for automation such as
`claude -p "/pensmith:done ..."`. It adds no verb: pensmith keeps exactly 16.

`done` re-checks the verifier gate, runs the optional humanize, plagiarism and AI-likelihood transparency checks, and exports behind an export confirmation gate.
