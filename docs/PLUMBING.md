# Plumbing: the `/pensmith:*` commands

`/pensmith` is the only command you need (see the [README quick start](../README.md#quick-start)). It reads your paper's state, takes the next step, and understands plain requests such as "check the citations in section 3".

The plugin also ships seven **plumbing** commands for automation: one per pipeline stage, each pinned to one pensmith verb. They exist so that a script, an alias or a saved prompt can name the exact stage it wants, the way `git` plumbing sits under its porcelain (PRD §5.5). They are not taught in the quick start, and you never need them for normal use.

## The commands

| Command | Runs the verb | Same as, in a terminal | Arguments |
| --- | --- | --- | --- |
| `/pensmith:research` | `research` | `pensmith research` | `[--scope <n\|text>] [--queries <n>]` |
| `/pensmith:outline` | `outline` | `pensmith outline` | `[--force] [--no-counter]` |
| `/pensmith:plan-section` | `plan` | `pensmith plan <N>` | `<N> [--revise] [--research "<query>"]` |
| `/pensmith:write-section` | `write` | `pensmith write <N>` | `<N> [--no-verify]` |
| `/pensmith:verify-section` | `verify` | `pensmith verify <N>` | `<N>` |
| `/pensmith:compile` | `compile` | `pensmith compile` | none |
| `/pensmith:done` | `done` | `pensmith done` | `[--raw]` |

`<N>` is a section id as `pensmith status` shows it: `3`, or `1a` for a section a re-outline inserted.

Each command forwards `<verb> <your arguments>` to the `pensmith` skill and adds nothing of its own: no routing, no extra steps, no new verb. Pensmith has exactly 16 verbs in both tiers (`pensmith --help` lists them); the plumbing names are Claude Code aliases for seven of them (`plan`, `write` and `verify` get a `-section` name because they act on one section). The Tier-2 CLI has no `pensmith:` names — use the verbs.

## How each command runs in this release

The `pensmith` skill decides how a verb runs, so the plumbing commands behave exactly like `/pensmith <verb>`:

- `plan-section`, `write-section` and `verify-section` call the plugin's MCP tools `pensmith_plan`, `pensmith_write` and `pensmith_verify`. `plan` and `write` call the model provider configured for pensmith — the same API key or local OpenAI-compatible server the CLI uses ([Model runtimes](../README.md#model-runtimes)). `verify` needs no key: its blocking checks are registrar look-ups.
- `research`, `outline`, `compile` and `done` run through the Tier-2 CLI, which the skill calls with the Bash tool when `pensmith` is on your PATH ([Install](../README.md#install)).
- A flag the MCP tool does not take (`plan-section 2 --research "…"`, `write-section 2 --no-verify`) also goes through the CLI.

Generation through your Claude Code session with no API key is not part of this release.

## Scripting with `claude -p`

Claude Code expands a user-invoked skill named at the start of a `-p` prompt. Run it in the folder that holds the paper's `.paper/`, and pre-approve the tools the command will use, because nobody is there to answer a permission prompt:

```bash
cd ~/papers/remote-work
claude -p "/pensmith:verify-section 3" \
  --allowedTools "Skill(pensmith:pensmith),mcp__plugin_pensmith_pensmith__pensmith_status,mcp__plugin_pensmith_pensmith__pensmith_verify"
```

- For a stage that runs through the CLI, allow that command too, for example `Bash(pensmith compile *)` next to `Skill(pensmith:pensmith)` for `/pensmith:compile`.
- `claude -p` exits 0 when the Claude Code run itself succeeded — a blocked section is reported in the reply, not in the exit code. When a script must branch on the verdict, run the CLI: `pensmith verify 3` exits `4` when the verifier blocks the section, `3` when a gate needs an answer, `5` at the cost cap (the [exit codes](../README.md#exit-codes)).
- The gates stay on. `/pensmith:outline` and `/pensmith:done` stop at their approval gate when there is no terminal; pass `--yolo` in the arguments only when you mean to approve the outline or the export unattended (it never lifts the cost cap or grants detector consent).

## Scheduled tasks

The plumbing commands are user-invoked only (`disable-model-invocation: true`): Claude never picks one on its own, their descriptions stay out of Claude's context, and Claude Code does not run them when a scheduled task fires with one as its prompt. Schedule `/pensmith <verb> …` (for example `/pensmith verify 3`) or the CLI instead.

## Troubleshooting

If a command says the pensmith tools are missing, the plugin's MCP server did not start: install Node.js 22 or newer, make sure `node --version` works in the environment Claude Code starts from, and restart Claude Code. `/mcp` shows the server's state.
