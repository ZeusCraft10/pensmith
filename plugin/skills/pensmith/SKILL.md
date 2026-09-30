---
name: pensmith
description: >-
  Write an academic paper or essay with pensmith, one step at a time, with every
  citation re-checked against its live source before a section can ship. Use it
  whenever the user wants to start, continue, check, fix or finish a paper in this
  folder, even without saying "pensmith": a bare /pensmith, or /pensmith <verb>
  [args] for one of its 16 verbs.
when_to_use: >-
  Phrases (PRD §5.4): "I have an essay to write on X", "research my topic",
  "find sources", "outline the paper", "write the next section", "continue",
  "redo section 3", "section 3 needs work", "check the citations in section 3",
  "make it sound less AI", "compile", "put it all together", "export to Word",
  "where am I?", "what's next?", "what papers do I have?". Also "resume" and
  "continue where I left off". Corrections (PRD §5.6): "make it 1500 words
  instead of 2500", "add a section about counterexamples", "drop the section
  about X", "re-do section 3", "use a different source for the claim about X in
  section 4".
argument-hint: "[verb] [args] — e.g. status, plan 2, verify 3; empty = next step"
allowed-tools: mcp__plugin_pensmith_pensmith__pensmith_status mcp__pensmith__pensmith_status
---

# pensmith

Pensmith turns an assignment into a sourced draft through fixed stages: intake →
research → outline → for each section (plan → write → verify) → compile → done.
Its verifier re-fetches every citation from the registrar that issued its
identifier and blocks a section with a fabricated, mis-cited, unverifiable or
misquoted citation, so compile and export only ever see verified sections.

This skill is the one entry point. Map what the user says to **one of the 16
pensmith verbs**, run that verb, and report what it printed. The verb does the
work; this skill decides nothing about paper state (the pensmith router does),
never writes files under `.paper/` itself, and never invents a verb.

The user's request: `$ARGUMENTS`

## How each verb runs in this release

The plugin's MCP server (`pensmith`) runs four verbs directly. The other twelve
run in the pensmith command-line tool (Tier 2) for now.

| Verb | Run it with |
| --- | --- |
| `status` | the MCP tool `pensmith_status` (read-only; no key needed). Show its text as it is. |
| `plan N` | the MCP tool `pensmith_plan` with `n` = N (for a lettered section such as `1a`, `n` = 1 and `slug` = its slug from status); `revise: true` for `plan N --revise` |
| `write N` | the MCP tool `pensmith_write` (it verifies the new draft itself) |
| `verify N` | the MCP tool `pensmith_verify` (no key needed: the blocking checks are registrar look-ups) |
| `new`, `next`, `resume`, `research`, `outline`, `compile`, `done`, `list`, `open`, `sketch`, `add`, `doctor` | the CLI: run `pensmith <verb> [args]` with the Bash tool when `pensmith --version` answers |

A flag the tool does not take — `plan N --research "<query>"`, `write N
--no-verify`, or a global flag such as `--dry-run` — means the CLI form of that
verb.

`plan` and `write` call the model provider configured for pensmith (an API key
or a local OpenAI-compatible server; `pensmith doctor` checks it), exactly as
the CLI does. In this release pensmith does not generate text through this
Claude Code session, so never claim a step is free or key-free unless the tool
said so, and never write a plan, draft or verification yourself in place of a
verb: the verifier's guarantees hold only for what the verbs wrote.

If the CLI is not installed, say so and point the user to the "Tier 2" part of
the pensmith README's Install section (a clone, `npm install`, `npm run build`,
`npm link`; Node.js ≥ 22.12); the four MCP verbs above still work without it.

Steps that ask the user something — the intake questions, the research picks,
the outline approval, the export confirmation — need a terminal. Without one
the CLI stops at that question with exit code 3. Tell the user what it asked
and suggest running that step in their own terminal. Only when the user
explicitly says so, re-run it with `--yolo`, which accepts the suggested
answers and approves the outline or the export for them (it never lifts the
cost cap or gives detector consent). `pensmith new --answers <file.toml>`
answers intake up front.

## A bare /pensmith, "continue", "what's next?"

1. Call `pensmith_status` first. Its `next:` line names the next step
   (`next: research`, `next: plan §2`, `next: write §2`, `next: status (done)`);
   an `attention:` or `note:` line after it says what needs the user, and names
   the command that fixes a stuck step.
2. Run exactly the verb in the `next:` line, as the table says. Never run
   `pensmith_plan` when it says `write` or `verify`: that would re-plan a
   section that is already planned and bill a model call for nothing.
   (`pensmith_write` verifies the draft it writes.)
3. Only if that verb was `plan N` and it succeeded, call `pensmith_status`
   again and continue with its `next:` step only when it names the same
   section (`write N`). Stop at the first failure.
4. Tell the user what ran and what `pensmith_status` now names next. One
   /pensmith is one step; "continue" is another /pensmith.

If status says there is no paper here, the first step is `pensmith new` (it
reads `assignment.txt`, `.md` or `.pdf` in the folder).

## What the user says → verb

| The user says… | Verb |
| --- | --- |
| "I have an essay to write on X" | `new` |
| "research my topic" / "find sources" | `research` |
| "outline the paper" | `outline` |
| "write the next section" / "continue" | the bare step above (`next`) |
| "resume" / "continue where I left off" | `resume` |
| "redo section 3" / "section 3 needs work" / "re-do section 3" | `plan 3 --revise`, then `write 3` |
| "check the citations in section 3" | `verify 3` |
| "make it sound less AI" | `done` (its humanize step) |
| "compile" / "put it all together" | `compile` |
| "export to Word" | `done` (it exports DOCX, PDF, LaTeX or Markdown) |
| "where am I?" / "what's next?" | `status` |
| "what papers do I have?" | `list` |
| "make it 1500 words instead of 2500" | `plan N --revise` for each section to shorten (its word target), then `write N` |
| "add a section about counterexamples" / "drop the section about X" | edit the table in `.paper/OUTLINE.md` as the user asked, then `outline` (it applies the edited outline; a dropped section is archived, never deleted) |
| "use a different source for the claim about X in section 4" | `plan 4 --revise`, then `write 4` |

All the corrections ride existing verbs: there is no `revise` verb or any other
17th verb. Redoing section 3 never touches the other sections.

## When the pensmith tools are missing

If no `pensmith_status` tool is available, the plugin's MCP server did not
start. It needs Node.js ≥ 22 installed with `node` on the PATH that Claude Code
sees: tell the user to install Node.js 22 or newer, check `node --version` in a
new terminal, and restart Claude Code. `/mcp` shows the server's state.

## Honest framing

"Make it sound less AI" runs the humanizer inside `done`: it improves the
prose. Never describe it, or the AI-likelihood score `done` can show, as a way
to evade or pass a detector; the score is shown for the user's awareness only.
