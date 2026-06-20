# Pensmith

Structured research-and-drafting assistant for academic papers — verifies every citation against the live source.

**Status:** v0.1.0 in development. See [PRD.md](./PRD.md) for the spec, [.planning/PROJECT.md](./.planning/PROJECT.md) for active scope.

The full v0.1.0 README — including the AI-detection / humanizer / style-match dual-use disclosure required by PRD §3 — ships in Phase 6 alongside the export pipeline.

## Style Match

Style Match is an **opt-in** feature. When you point Pensmith at a folder of your own past writing (`--style-samples <dir>`), it builds a private, per-paper statistical profile of how you write — typical sentence length, vocabulary density, paragraph shape, common sentence openers — and uses it to help new sections **match your own established voice**.

It is dual-use, and we are direct about that. Here is what it does and does not do:

- It **improves prose so it reads like your own past writing**. The profile is built from plain statistics — no external model, no network call — and it stays inside your paper as `.paper/STYLE.json`.
- It **does not claim to make AI authorship invisible to detectors.** A separate honesty check reports an AI-likelihood score as transparency; Style Match does not change what that score means or promise any particular result.
- It is intended for **matching your own voice** — not for passing off someone else's work as your own. The samples you provide should be your own writing.

To keep this honest at the tool level, Pensmith surfaces a transparency notice whenever the same writing samples were already used to style a different paper. That notice always prints; it is not something a flag can silence.
