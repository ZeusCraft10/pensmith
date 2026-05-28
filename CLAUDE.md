# Pensmith — Claude project memory

This file orients any Claude session opened against this folder. Read it first before answering questions about pensmith.

## What this is

Pensmith is a Claude Code plugin (Tier 1) + portable Node CLI (Tier 2) that helps with academic paper writing. Structured workflow: intake → research → outline → for each section { plan → write → verify } → compile → done. Modeled architecturally on the [Get Shit Done](https://github.com/gsd-build/get-shit-done) plugin and the [gsd-plugin](https://github.com/jnuyens/gsd-plugin) repackaging.

The full spec lives in `PRD.md` — that's the source of truth. When asked anything specific, check the PRD first.

## The one mental model that drives everything

**A paper is a project. A section is a phase. The outline is the roadmap. Compile is milestone completion.** GSD's primitives map 1:1 onto academic writing.

Every section gets its own `.paper/sections/<N>/` folder with its own PLAN.md, DRAFT.md, VERIFICATION.md. State isolation is enforced by directory structure, not careful prompting. Re-doing section 3 never touches sections 1, 2, 4, 5. The verifier runs bounded per-section.

**This is the load-bearing design choice.** If a question or change request would weaken it, push back before agreeing.

## Things that are non-negotiable (per PRD §14, §19)

- **Section-as-phase.** See above.
- **Two-tier architecture.** Both Claude Code plugin AND portable Node CLI must work from the same workflow files. Workflow bodies use `<capability_check>` blocks to degrade gracefully when Task/MCP/AskUserQuestion are unavailable.
- **Single-command UX.** `/pensmith` is the only command in the README quick start. Everything else is a power-user fallback.
- **Verifier blocks compile and export.** No FABRICATED, MIS-CITED, or quote-NOT_FOUND citation ever escapes a section. Author/title fuzzy match is part of Pass 1 (DOI integrity is necessary but not sufficient).
- **No exported-document trace.** Zero metadata stamp, zero footer, zero pensmith fingerprint in exported docs. The README disclaimer (PRD §3) is the only disclosure mechanism.
- **Honest framing on detection.** GPTZero score is shown as transparency, never as "we make it undetectable." The humanizer "improves prose," it does not "evade detection."
- **Approval gates default-on.** Outline approval and export confirmation only skip with `--yolo`.

## Things that are deliberate user-facing choices (don't second-guess)

- No metadata in exports (user explicitly chose zero trace, against my recommendation — we honor it)
- Style-match to past writing IS shipped (opt-in, with honest dual-use disclosure in README)
- Free-only plagiarism check (distinctive phrases via DuckDuckGo); paid services were rejected
- `--yolo` flag exists but defaults off
- The user's installed `humanizer` skill (at `~/.claude/skills/humanizer/`) is the humanize backend; pensmith wraps it

## Build approach

The user is building this with **GSD itself** — they'll run `/gsd:new-project --auto @PRD.md` from this directory. GSD will generate REQUIREMENTS, ROADMAP, and per-phase plans. Don't try to "help Claude build it from scratch" outside that flow — let GSD orchestrate.

When asked development questions during the build, the user will likely:
1. Ask conceptual questions ("why did we decide X?") → answer from PRD
2. Ask GSD-mechanic questions ("how should the plan-phase output look for the verifier?") → reference PRD plus the cloned GSD repos at `/tmp/refs/gsd-original` and `/tmp/refs/gsd-plugin` if they exist
3. Ask "is this drifting from the design?" → check against the non-negotiables above

## Reference repos to clone if needed

```bash
git clone --depth 1 https://github.com/gsd-build/get-shit-done /tmp/refs/gsd-original
git clone --depth 1 https://github.com/jnuyens/gsd-plugin     /tmp/refs/gsd-plugin
```

Already studied: their plugin manifest, skill format, agent format, MCP server pattern, hooks (SessionStart/PreCompact/PostToolUse), workflow body delegation pattern, and HANDOFF.json schema. Pensmith adapts these patterns; doesn't copy code.

## Open questions GSD will resolve at discuss-phase (PRD §17)

These were intentionally left for GSD's per-phase discussion. Don't try to answer them definitively in chat — they need GSD's research-phase context:

- Exact prompt wording for verifier subagents (drives recall/precision)
- Section-dependency declaration syntax
- Wave scheduling algorithm for parallel sections
- MCP SDK choice
- PDF parsing library choice
- Style-match implementation (LLM featurization vs. embeddings)
- Library index format (JSON / SQLite / sidecar files)
- Section renumbering policy (stable vs. renumber on insert)

## Style for answering during development

- Be direct. The user appreciates "no, that conflicts with X" over diplomatic hedging.
- Cite the PRD section when you reference a decision: "per §7.6, the section drafter only sees its mapped sources."
- If a question reveals a real ambiguity in the PRD, say so and propose an edit rather than papering over it.
- Don't drift the architecture in conversation — if a request would, surface that explicitly and ask.
