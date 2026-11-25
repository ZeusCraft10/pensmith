# Pensmith — Claude project memory

This file orients any Claude session opened against this folder. Read it first before answering questions about pensmith.

## What this is

Pensmith is a Claude Code plugin (Tier 1) + portable Node CLI (Tier 2) that helps with academic paper writing. Structured workflow: intake → research → outline → for each section { plan → write → verify } → compile → done. Modeled architecturally on the [Get Shit Done](https://github.com/gsd-build/get-shit-done) plugin and the [gsd-plugin](https://github.com/jnuyens/gsd-plugin) repackaging.

The full spec lives in `PRD.md` — that's the source of truth. When asked anything specific, check the PRD first. Where the owner decisions below change the PRD, the decisions win until the PRD is edited to match. The audit behind them is `docs/audit/2026-11-24/REPORT.md`, and the PRD edits it implies are in §5 of that report.

**Current status (2026-11-25):** a full audit found the v0.2.0 build not shippable. The plugin can't install, production replayed test cassettes, the LLM transport can't call current models, and the Tier-1 path needs an API key. A hybrid rebuild is under way; see `docs/plans/`.

## The one mental model that drives everything

**A paper is a project. A section is a phase. The outline is the roadmap. Compile is milestone completion.** GSD's primitives map 1:1 onto academic writing.

Every section gets its own `.paper/sections/<N>/` folder with its own PLAN.md, DRAFT.md, VERIFICATION.md. State isolation is enforced by directory structure, not careful prompting. Re-doing section 3 never touches sections 1, 2, 4, 5. The verifier runs bounded per-section.

**This is the load-bearing design choice.** If a question or change request would weaken it, push back before agreeing.

## Things that are non-negotiable (per PRD §14, §19)

- **Section-as-phase.** See above.
- **Two-tier architecture.** Both the Claude Code plugin AND the portable Node CLI must work from one source of truth. *Mechanism (owner decision 2026-11-25):* the engine's step graph (`pensmith next --json` action stream) plus shared prompt templates. The plugin skill and its subagents consume the actions with the user's own Claude session doing the generation (no API key). The Tier-2 runner consumes the same actions through a provider. `<capability_check>` lives in the plugin's SKILL.md, and tier parity is tested as action-trace equivalence. The old `workflows/*.md` bodies are replaced by `skills/pensmith/reference/*.md` in Phase 2.
- **Single-command UX.** `/pensmith` is the only command in the README quick start. Everything else is a power-user fallback.
- **Verifier blocks compile and export.** No FABRICATED, MIS-CITED, or quote-NOT_FOUND citation ever escapes a section. Author/title fuzzy match is part of Pass 1 (DOI integrity is necessary but not sufficient).
- **No exported-document trace.** Zero metadata stamp, zero footer, zero pensmith fingerprint in exported docs. The README disclaimer (PRD §3) is the only disclosure mechanism.
- **Honest framing on detection.** GPTZero score is shown as transparency, never as "we make it undetectable." The humanizer "improves prose," it does not "evade detection."
- **Approval gates default-on.** Outline approval and export confirmation only skip with `--yolo`, and only when the user typed it. `--yolo` never waives an integrity verdict.
- **Live sources, honest verdicts.** Production always talks to the real registries. Test cassettes are reachable only from the test runner (`PENSMITH_TEST_CASSETTES=1`). A registry that can't be reached gives `UNRESOLVED`, never `OK` and never `FABRICATED`.

## Owner decisions (2026-11-25)

- **Path:** hybrid rebuild in 7 phases (`docs/audit/2026-11-24/REPORT.md` §3). Keep the deterministic core; replace the integration layer.
- **No MCP server in v0.x.** Claude reaches the engine through the bundled `pensmith` CLI on the plugin's `bin/` PATH.
- **Claim support:** auto-repair up to 2 rounds, then a per-claim acknowledgement bound to the claim's text hash blocks export. Compile is still allowed, and `--yolo` can't waive it. Hard blocks are unchanged: FABRICATED, MIS-CITED, quote NOT_FOUND, plus RETRACTED (acknowledgeable) and UNRESOLVED.
- **Defaults the owner may revise:**
  - GPTZero runs only with a configured key, after one-time consent that defaults to no.
  - Plagiarism: a local source-overlap check first, DuckDuckGo best-effort, and a blocked check reads "incomplete", never "clean".
  - Direct quotes only from sources with accessible text.
  - Approvals are captured from real user answers.
  - Humanize runs after compile on protected text, followed by a re-verify.
  - Tier 2: the Anthropic SDK plus an OpenAI-compatible adapter (Ollama).
  - Distribution: own marketplace, then npm, then the Anthropic directory.
  - `.planning/` is archived in Phase 7.

## Things that are deliberate user-facing choices (don't second-guess)

- No metadata in exports (user explicitly chose zero trace, against my recommendation — we honor it)
- Style-match to past writing IS shipped (opt-in, with honest dual-use disclosure in README)
- Free-only plagiarism check (distinctive phrases via DuckDuckGo); paid services were rejected
- `--yolo` flag exists but defaults off
- The user's installed `humanizer` skill (at `~/.claude/skills/humanizer/`) is the humanize backend; pensmith wraps it

## Build approach

v0.1.0 and v0.2.0 were built with GSD; `.planning/` is that history and is frozen. **Since 2026-11-25 the owner has chosen direct commits from the phase plans in `docs/plans/`, not GSD.** Practices:
- test first: every fix starts with a failing regression test that drives real behaviour, not structure or hash pins;
- one implementer per task, followed by a task review and a bounded fix loop;
- verification before completion: `npm run check` and `claude plugin validate --strict` are run and read before anything is called done.

When asked development questions:
1. Conceptual ("why did we decide X?") → answer from the PRD and the owner decisions above.
2. "Is this drifting from the design?" → check against the non-negotiables and owner decisions above.

## Reference repos to clone if needed

```bash
git clone --depth 1 https://github.com/gsd-build/get-shit-done /tmp/refs/gsd-original
git clone --depth 1 https://github.com/jnuyens/gsd-plugin     /tmp/refs/gsd-plugin
```

Already studied: their plugin manifest, skill format, agent format, MCP server pattern, hooks (SessionStart/PreCompact/PostToolUse), workflow body delegation pattern, and HANDOFF.json schema. Pensmith adapts these patterns; doesn't copy code.

## PRD §17 open questions — status

- Resolved:
  - MCP: none in v0.x.
  - Dependency syntax: a `depends_on` list.
  - Waves: Kahn layering (`bin/lib/scheduler.ts`).
  - Citation styles: CSL + citeproc.
  - Library index: a JSON pointer index with lazy status.
  - Style-match: deterministic stylometrics.
  - Renumbering: stable folder names.
- Still open, decided per phase:
  - verifier and drafter prompt wording, tuned against an eval set in Phase 3;
  - PDF extraction (pdf.js in a worker is the Phase 3 plan).

## Style for answering during development

- Be direct. The user appreciates "no, that conflicts with X" over diplomatic hedging.
- Cite the PRD section when you reference a decision: "per §7.6, the section drafter only sees its mapped sources."
- If a question reveals a real ambiguity in the PRD, say so and propose an edit rather than papering over it.
- Don't drift the architecture in conversation — if a request would, surface that explicitly and ask.
