# Phase 13: Citation rendering at export - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey-area defaults auto-accepted, grounded in PROJECT.md non-negotiables, the 2026-06-22 review (milestone-audit MEDIUM-1), and the existing CSL machinery

<domain>
## Phase Boundary

Make exported documents carry FORMATTED citations + a rendered bibliography in the paper's discipline style — `[@key]` tokens must not survive to the final document. Self-contained at the exporter boundary; the verified citations from the verifier finally become real references the reader sees.

- **REND-01:** `[@key]` in-text tokens resolve to formatted in-text citations in the paper's CSL style.
- **REND-02:** every export includes a rendered bibliography / reference list in that style.
- **REND-03:** an automated exporter test asserts a FORMATTED reference appears in output (e.g. "Vaswani et al." / a numeric `[1]`), not merely that a `.bib`/`.ris` sidecar was copied.

Out of scope (deferred): GATE-04 re-verify-before-export (Phase 14); HARD/CI/DOCS (Phase 15-16). The `.bib`/`.ris` sidecar bundling already ships (Phase 10) — Phase 13 makes the cites RENDER, it does not change sidecar bundling.
</domain>

<decisions>
## Implementation Decisions

### Rendering strategy (primary + fallback)
- **Primary (Pandoc present):** `buildPandocArgs` (exporter.ts:453) adds `--citeproc --csl templates/citation-styles/<style>.csl --bibliography <CITATIONS.bib>` for `.docx`/`.pdf`/`.tex`/`.md` so Pandoc resolves `[@key]` from the bundled `.bib` using the CSL — formatted in-text cites + an auto-generated reference list. This is the standard, robust path and reuses the existing 8 bundled CSL files.
- **Style selection:** the CSL is chosen via `resolveStyleName(discipline)` (citations.ts) from the paper's discipline (config.toml `[project]` / STATE), defaulting to APA. This gives the dead `renderStyle`/`resolveStyleName` a production home (milestone-audit MEDIUM-1).
- **Fallback (Pandoc ABSENT — the md-only path):** the existing md fallback must NOT emit literal `[@key]`. Use the citation-js `renderStyle` lib to append a formatted reference list (bibliography) to the markdown and resolve the in-text tokens as best the lib allows; if full in-text CSL formatting is infeasible without Pandoc, at minimum render a formatted bibliography + a clear, deterministic in-text rendering (the researcher determines the exact citation-js capability). Either way: no raw `[@key]` escapes.
- **Offline-testable path (REND-03):** the citation-js renderStyle path is pure-JS/offline — the REND-03 automated assertion targets THAT (a formatted reference string appears in offline-rendered output). The Pandoc-rendered `.docx`/`.pdf` formatted-cite assertion is Pandoc-gated (runs when Pandoc present; manual/CI-conditional otherwise). Never gate the whole requirement on Pandoc being installed in CI.

### Invariants preserved
- **Zero-trace (non-negotiable):** the rendered bibliography + cites are paper content (fine); NO pensmith metadata/trace is introduced. The existing zeroTracePatch / `--metadata title=/author=/date=` blanking stays. The zero-trace test must still pass on the citation-rendered output.
- **Verifier gate:** Phase 13 runs at export, AFTER compile's refuse-gate; it does not weaken or bypass the verifier. Only verified citations are in the `.bib` to render.
- **Determinism:** renderStyle is already Map-memoized + offline; keep citation rendering deterministic (no wall-clock, byte-stable for the same input).
- **16-verb/16-body bijection** unchanged; this is an exporter-internal change, no new verb.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `bin/lib/citations.ts` — `renderStyle(entries, style)` + `resolveStyleName(discipline)` + Map memoization over the 8 bundled CSL files (apa/mla/chicago×2/ieee/ama/vancouver/harvard) in `templates/citation-styles/`. THE renderer to wire in. (`{Cite}` from ./citations.js per D-19.)
- `bin/lib/exporter.ts` — `buildPandocArgs` (line 453, currently only `--metadata` blanking), the Pandoc shellout + md-only fallback, `zeroTracePatch`, the `.bib`/`.ris` bundle copy.
- `templates/citation-styles/*.csl` — the bundled CSL catalog.
- Existing `tests/exporter.test.ts` (+ zero-trace test) — extend with the REND-03 formatted-reference assertion (offline renderStyle path).
- The paper's `CITATIONS.bib` (research output) — the bibliography source for Pandoc/citation-js.

### Established Patterns
- citation-js lazy CSL plugin pattern (D-19, Phase-10 Pitfall 1); all FS reads for CSL inside the citations.ts chokepoint.
- Pandoc-gated tests (existing exporter tests check `pandocPresent` before asserting Pandoc output); offline tests use committed fixtures.

### Integration Points
- `bin/lib/exporter.ts` (buildPandocArgs + md fallback) ← `bin/lib/citations.ts` (renderStyle/resolveStyleName); discipline from config.toml/STATE.
</code_context>

<specifics>
## Specific Ideas

- REND-01: exported docs contain formatted in-text citations in place of every `[@key]`.
- REND-02: every export includes a formatted bibliography in the paper's CSL style.
- REND-03: an automated test asserts a formatted reference (e.g. "Vaswani et al.") appears in output — offline (citation-js path), not Pandoc-gated.
- `resolveStyleName`/`renderStyle` gain a production consumer (closes milestone-audit MEDIUM-1 + the review's "dead renderStyle" finding).
</specifics>

<deferred>
## Deferred Ideas

- Re-verify the humanized FINAL.md before export (GATE-04 → Phase 14).
- Per-style in-text-format edge cases beyond the 8 shipped styles (out of scope — the 8 cover the disciplines).
- Citation-style switching UI / per-section style overrides (not in scope; one style per paper from discipline).
</deferred>
