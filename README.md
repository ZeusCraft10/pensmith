# Pensmith

Pensmith is a structured research-and-drafting assistant for academic papers. It guides you through a complete paper-writing workflow — intake → research → outline → (plan → write → verify per section) → compile → done — using only verifiable peer-reviewed and configurable academic sources. Every cited DOI is re-fetched and verified by the built-in citation verifier; unsupported claims are flagged for human review. Pensmith ships as two tiers that share the same workflow files: a Claude Code plugin (Tier 1) and a portable Node.js CLI (Tier 2).

## Install

**Tier 1 — Claude Code plugin (recommended)**

Add pensmith to Claude Code as a slash command:

```bash
claude mcp add pensmith npx pensmith@latest --mcp
```

Once installed, `/pensmith` is available in any Claude Code session.

**Tier 2 — portable Node CLI**

```bash
npm install -g pensmith
# or, without installing globally:
npx pensmith
```

Requires Node.js >=20.10.0.

## Quick start

```
/pensmith
```

That is the only command you need. Pensmith reads your paper's current state and dispatches the next step automatically. The first run starts intake; subsequent runs advance the workflow.

## Power-user reference

The 16 verbs below let you jump to any workflow stage directly. In normal use, `/pensmith` (bare) handles dispatch automatically.

| Verb | What it does |
|------|-------------|
| `doctor` | Ecosystem self-check: 11 probes across runtime, MCP wiring, and ecosystem presence. Exits 1 on FAIL. |
| `new` / `intake` | Start a new paper project — capture the assignment, run the clarifying battery, detect discipline, persist `INTAKE.md`. |
| `next` | Advance to the next workflow step based on current paper state (the bare `/pensmith` flow). |
| `status` | Report current paper state: per-section progress table + resolved next action. |
| `research` | Generate a sourced research map — fetch and rank candidate papers from OpenAlex, Crossref, arXiv, PubMed, Unpaywall. |
| `outline` | Draft and approve a section outline from the research map. Approval gate (skippable with `--yolo`). |
| `plan` | Generate a section-level plan for one section (`--section <n>`). |
| `write` | Draft one section using only its mapped sources (`--section <n>`). |
| `verify` | Run the three-pass citation verifier on one section: DOI re-fetch, author/title fuzzy match, quote exact-match. |
| `compile` | Assemble all verified sections into a single document and export (DOCX / PDF / LaTeX). |
| `done` | Mark the paper complete after compile. |
| `resume` | Resume an interrupted workflow: summarize the last handoff, compute the next work verb, and dispatch it. |
| `list` | List all papers managed by pensmith in the current workspace. |
| `open` | Open an existing paper project by slug or number. |
| `sketch` | Quick-draft mode: produce a lightly sourced outline without the full research phase (for early ideation). |
| `add` | Add a section to an existing outline after initial outline approval. |

## Credits

pensmith is heavily inspired by [Get Shit Done](https://github.com/gsd-build/get-shit-done) by TÂCHES (Lex Christopherson) and the [gsd-plugin](https://github.com/jnuyens/gsd-plugin) repackaging by Jasper Nuyens. The skill / agent / MCP / workflow-body / HANDOFF.json patterns are theirs, and the section-as-phase mental model is a direct application of GSD's structured-workflow philosophy to academic writing. Domain (academic writing instead of code), command UX (single-command vs. per-stage), and implementation are independent.

## Style Match

Style Match is an **opt-in** feature. When you point Pensmith at a folder of your own past writing (`--style-samples <dir>`), it builds a private, per-paper statistical profile of how you write — typical sentence length, vocabulary density, paragraph shape, common sentence openers — and uses it to help new sections **match your own established voice**.

It is dual-use, and we are direct about that. Here is what it does and does not do:

- It **improves prose so it reads like your own past writing**. The profile is built from plain statistics — no external model, no network call — and it stays inside your paper as `.paper/STYLE.json`.
- It **does not claim to make AI authorship invisible to detectors.** A separate honesty check reports an AI-likelihood score as transparency; Style Match does not change what that score means or promise any particular result.
- It is intended for **matching your own voice** — not for passing off someone else's work as your own. The samples you provide should be your own writing.

To keep this honest at the tool level, Pensmith surfaces a transparency notice whenever the same writing samples were already used to style a different paper. That notice always prints; it is not something a flag can silence.

## Disclaimer

pensmith is a structured research-and-drafting assistant for academic writing. It helps you turn an assignment prompt into a sourced outline or, optionally, a full draft, using only verifiable peer-reviewed and configurable academic sources. It includes a citation verifier that re-fetches every cited DOI and flags unsupported claims for human review, and a humanizer pass that improves readability.

This tool is for your own writing, research, and learning. It is not a guarantee against AI detectors and it is not a substitute for doing the reading. Submitting fully tool-generated work as your own is, in many institutions, a violation of academic integrity policy. You are responsible for the work you submit.
