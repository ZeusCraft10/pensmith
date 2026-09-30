---
name: research
description: "Plumbing for scripts: build or refresh the paper's source library, the same step as `/pensmith research`."
disable-model-invocation: true
argument-hint: "[--scope <n|text>] [--queries <n>]"
---

# /pensmith:research

Run the pensmith verb `research $ARGUMENTS` and nothing else.

Use the Skill tool to invoke the `pensmith:pensmith` skill with the arguments
`research $ARGUMENTS`, and follow it: it knows how each verb runs in this release
(an MCP tool or the pensmith CLI) and how to report the result. Do not pick a
different verb, chain further steps or change the arguments. This command is
the scriptable spelling of `/pensmith research $ARGUMENTS` (and of
`pensmith research $ARGUMENTS` in a terminal), for automation such as
`claude -p "/pensmith:research ..."`. It adds no verb: pensmith keeps exactly 16.

Research runs queries from the paper's brief against the discipline's databases and writes `.paper/LIBRARY.json` and `.paper/RESEARCH.md`.
