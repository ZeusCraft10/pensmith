# Phase 12: Live research + intake bootstrap + humanizer Task - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey-area defaults auto-accepted, grounded in PROJECT.md non-negotiables, the 2026-06-22 review, and the Phase-11 transport that now exists

<domain>
## Phase Boundary

Three related "make the pipeline real" workstreams that all build on the Phase-11 transport:
- **GEN-03 — Live research source discovery:** `pensmith research` queries the registered adapters, aggregates + dedupes + tiers candidates, runs the retraction cross-check, and writes a REAL `LIBRARY.json` + `.bib`/`.ris` — replacing the zero-candidate placeholder. The transport (`complete()`) drives the LLM steps (query generation, candidate evaluation); the 7 adapters already exist.
- **GEN-04 — Intake paper-level bootstrap:** `pensmith intake` writes a paper-level `.paper/STATE.json` with a `paperId` so global-library registration and the style-match producer run in the real flow instead of WARN-skipping.
- **GEN-05 — Humanizer Task (Tier 1):** the `done`/export humanizer wrap invokes the user's `humanizer` skill via Claude Code Task and records a real before/after honesty score; clean skip with a banner when the skill (or Task) is absent.

Out of scope (Phase 13+): citation rendering at export (REND), fail-closed gate hardening (GATE), security/foundation hardening (HARD). Live discovery here populates the library; making the verified cites *render* at export is Phase 13.
</domain>

<decisions>
## Implementation Decisions

### GEN-03 — Live research discovery
- Flow: generate focused queries from the assignment via `complete()` (the LOCKED `topic-disambiguator` prompt) → fan out across the registered adapters in `bin/lib/sources/index.ts` (all 7: crossref, openalex, arxiv, pubmed, semanticscholar, unpaywall, retraction-watch; OpenAlex primary per PRD) → aggregate `SourceCandidate[]` → DOI-normalize + fuzzy-dedup (reuse `bin/lib/doi.ts` + `bin/lib/fuzzy.ts`) → evaluate/tier via `complete()` (the LOCKED `source-evaluator` prompt) → `crossCheckRetractions` (D-15, BEFORE writeBibtex) → `writeBibtex` + `writeRis` + real `LIBRARY.json`.
- All adapter network goes through `bin/lib/http.ts` (already true) and is cassette-backed offline; the LLM steps honor `PENSMITH_NO_LLM` (deterministic mock) so CI never makes a live call. The Phase-11 transport's offline seam is the model side; the existing source cassettes are the network side.
- Tier 1 fans out adapters/queries in parallel (subagents/bounded parallel); Tier 2 runs them sequentially. Keep the existing `tier-contract` parity (research is CLI-only at the contract layer — two CLI runs, ±20%).
- Research approval gate stays default-ON (prune/approve/add candidates); only `--yolo` skips (CLAUDE.md). In non-TTY it follows the same ApprovalUnavailableError/exit-3 pattern outline/revise use.
- Degenerate case: if discovery genuinely yields zero candidates (all adapters empty), WARN + write an EMPTY-but-real LIBRARY.json — never a `tier2-placeholder` / `PLACEHOLDER_LIBRARY` marker (GEN-02 already removed those in Phase 11).

### GEN-04 — Intake STATE.json bootstrap
- Intake writes `.paper/STATE.json` (the paper-level state, distinct from `.planning/STATE.md`) conforming to the existing v2 `StateSchema` (`$schemaVersion: 2`, `paperId`, status, slim `sections: [{n, slug}]`), via the `state.ts` + `atomic-write.ts` chokepoints.
- `paperId` is stable per paper (generated once at intake; the planner picks uuid vs content-hash — prefer a stable id that the global-library registry keys on). Re-running intake on an existing paper does NOT regenerate the id (idempotent).
- With STATE.json present, the existing global-library registration (`bin/lib/library.ts`) and the style-match opt-in producer run instead of WARN-skipping (the Phase-8 producers were gated on STATE/paperId presence). Confirm the WARN-skip guards flip to active when STATE.json exists.

### GEN-05 — Humanizer Task (Tier 1)
- The `done`/export humanizer wrap (`bin/lib/exporter.ts` `runHumanizer` currently returns null) invokes the user's `humanizer` skill at `~/.claude/skills/humanizer/` via Claude Code **Task** — Tier-1 only (Task is a Claude Code capability; Tier-2 has no Task → clean skip banner, never a failure).
- Records a REAL before/after honesty (GPTZero) score around the humanize step, rendered with the LOCKED honest-framing copy ("improves prose, does not evade detection" — never "undetectable"). Absent skill OR absent Task → skip banner + continue (export never fails on humanizer absence).
- The Task invocation needs an INJECTABLE seam (a function param / module seam, mirror the Phase-11 transport's offline pattern) so the wrap is testable offline without a real Task runtime. No live Task call in CI.
- **Scope note for verification (Phase 14):** GEN-05 wires humanize; the *re-verification* of the humanized FINAL.md before export (Pass-3 + citekey diff) is GATE-04 / Phase 14 — do not implement that here, but leave the FINAL.md output shape ready for it.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `bin/lib/anthropic.ts` (Phase 11) — `complete()` transport + `resolveProviderId()`; drives query-gen + candidate-eval offline via `PENSMITH_NO_LLM`.
- `bin/lib/sources/index.ts` — the `sources` registry (7 adapters) + `AdapterName`; each adapter already routes through `http.ts` + has committed cassettes.
- `bin/lib/doi.ts` + `bin/lib/fuzzy.ts` — DOI normalization + fuzzy match for dedup.
- `bin/cli/research.ts` — already carries the Phase-12 / GEN-03 swap-seam comments + the `topic-disambiguator`/`source-evaluator` LOCKED prompt slugs; the placeholder path is already removed (Phase 11).
- `bin/lib/state.ts` (+ v2 `StateSchema`) + `bin/lib/atomic-write.ts` — for the GEN-04 STATE.json write.
- `bin/lib/library.ts` — global-library registration (currently WARN-skips without paperId).
- `bin/lib/exporter.ts` `runHumanizer` (returns null today) + `bin/lib/honesty.ts` (GPTZero before/after, locked framing) + `bin/cli/done.ts` — the GEN-05 wiring points.
- `bin/lib/http-mock.ts` cassette seam + `PENSMITH_NO_LLM` — offline determinism for both the adapters and the transport.

### Established Patterns
- crossCheckRetractions BEFORE writeBibtex (D-15); citation-js via `./citations.js` (D-19); all writes via atomic-write (D-07).
- Approval gates: @clack/prompts TTY + non-TTY ApprovalUnavailableError/exit-3 (outline/revise precedent).
- Injectable offline seams for runtime-only capabilities (Phase-11 transport; humanizer Task mirrors this).

### Integration Points
- `bin/cli/research.ts` (GEN-03), `bin/cli/intake.ts` + `bin/lib/state.ts`/`library.ts` (GEN-04), `bin/lib/exporter.ts`/`done.ts`/`honesty.ts` (GEN-05).
- `tests/tier-contract.test.ts` parity must stay green; offline cassettes + PENSMITH_NO_LLM throughout.
</code_context>

<specifics>
## Specific Ideas

- GEN-03 success: `pensmith research` returns ≥1 real deduplicated candidate (with retraction check) on a fixture assignment under offline cassettes + PENSMITH_NO_LLM; zero-candidate placeholder library is gone.
- GEN-04 success: `pensmith intake` writes `.paper/STATE.json` with a `paperId`; global-library registration + style-match proceed (no WARN-skip) in the real flow.
- GEN-05 success: Tier-1 humanizer wrap calls the skill via Task (injectable seam in tests), records a real before/after score; absent skill/Task → clear skip banner, export continues.
</specifics>

<deferred>
## Deferred Ideas

- Citation rendering at export / `[@key]` resolution (REND → Phase 13).
- Re-verify humanized FINAL.md before export (GATE-04 → Phase 14).
- Reference dedup ACROSS BYO/add/Zotero/live-search as a unified pass (RDUP-01 → v2/Future) — Phase 12 dedups within a single research run only.
- Live-path smoke CI for a real adapter round-trip (LIVE-01 → v2/Future).
</deferred>
