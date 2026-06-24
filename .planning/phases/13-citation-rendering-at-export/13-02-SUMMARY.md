---
phase: 13-citation-rendering-at-export
plan: "02"
subsystem: citation-rendering
tags: [citation-rendering, rend, offline, d-19, chokepoint, pandoc-citeproc, zero-trace]
dependency_graph:
  requires: [13-01]
  provides: [REND-01, REND-02, REND-03]
  affects:
    - bin/lib/citations.ts
    - bin/lib/exporter.ts
    - bin/cli/done.ts
    - tests/citation-render.test.ts
tech_stack:
  added: []
  patterns:
    - D-19 chokepoint delegation (exporter imports only parseBib/renderStyle/renderInText from ./citations.js)
    - Memoized Style Template Registration ordering (renderStyle FIRST, then in-text loop)
    - Pitfall-1 guard (one renderInText([entry]) per citekey, not all entries combined)
    - exactOptionalPropertyTypes:true spread-conditional pattern for optional interface fields
    - Never-throw advisory pattern (INTAKE.md read with empty catch)
    - findPkgRoot/PKG_ROOT pattern replicated for CSL path resolution in exporter.ts
key_files:
  created: []
  modified:
    - bin/lib/citations.ts
    - bin/lib/exporter.ts
    - bin/cli/done.ts
    - tests/citation-render.test.ts
decisions:
  - "renderInText delegates through ensureStyleTemplate (same memoized path as renderStyle) — no direct templates.add call"
  - "resolveAndRenderCitations calls renderStyle FIRST to prime template registration before the per-entry renderInText loop (PATTERNS memoized registration ordering)"
  - "exporter.ts imports only parseBib/renderStyle/renderInText from ./citations.js — Cite is NOT imported (D-19 chokepoint strictly enforced)"
  - "style spread-conditional (..style !== undefined ? { style } : {}) required by exactOptionalPropertyTypes:true in tsconfig"
  - "bib-copy block moved before all execFileAsync('pandoc') calls (Pitfall-4 reorder) — guard unchanged"
  - "done.ts uses empty catch to leave style undefined when INTAKE.md is missing — exportDraft defaults to APA"
metrics:
  duration: "~18 minutes"
  completed: "2026-06-24T00:00:00Z"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 4
---

# Phase 13 Plan 02: Citation Rendering at Export Summary

**One-liner:** Wire `renderInText` + `resolveAndRenderCitations` into the export path so every `[@key]` token resolves to a formatted in-text citation and `## References` bibliography in the paper's CSL style (APA/IEEE/MLA/etc.), fully offline on the md/Pandoc-absent path.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Add renderInText(entries, style) to citations.ts (D-19 in-text render path) | 7eea1b0 | bin/lib/citations.ts, tests/citation-render.test.ts |
| 2 | Wire exporter.ts — resolveAndRenderCitations, buildPandocArgs citeproc args, ExportOptions.style, bib-copy reorder | 4998188 | bin/lib/exporter.ts |
| 3 | Resolve discipline→style in done.ts + exactOptionalPropertyTypes fix | d2f7002, 0318d31 | bin/cli/done.ts |

## Wave-0 Skips Flipped GREEN

| Test | Before | After |
|------|--------|-------|
| REND-01/02/03 offline — no raw [@key], APA in-text, ## References, Vaswani present | SKIP | PASS |
| REND-01 APA in-text form pin — (Vaswani et al., 2017) | SKIP | PASS |
| source contains --citeproc, --csl, --bibliography flags (Pitfall-3) | SKIP | PASS |
| bib-copy block precedes docx/pdf pandoc execFileAsync call (Pitfall-4) | SKIP | PASS |
| citation-rendered md export contains no 'pensmith' literal | SKIP | PASS |
| renderInText(entries,'apa') returns "(Vaswani et al., 2017)" + no template collision | NEW PASS | PASS |
| renderInText throws TypeError on non-array input | NEW PASS | PASS |

**Full suite: 901 tests, 901 pass, 0 fail, 0 skip** (was 899 total, 5 skip before plan).

## What Was Built

### Task 1: renderInText in citations.ts

`renderInText(entries, style)` is the per-entry in-text CSL renderer — the D-19-compliant in-text sibling of `renderStyle`. It:
- Validates input with `Array.isArray` guard (throws `TypeError` on non-array — mirrors renderStyle)
- Calls `ensureStyleTemplate(style)` for Pitfall-2 memoization (never throws "template already registered")
- Constructs `new Cite(entries, { forceType:'@csl/object' }).format('citation', { format:'text', template:'pensmith-${style}', lang:'en-US' })`
- Returns `"(Vaswani et al., 2017)"` for APA, `"[1]"` for IEEE (single-entry offline; correct numbering on Pandoc path)
- Is offline + deterministic: no wall-clock, no fetch, byte-stable for identical input

Header comment updated to note renderInText as in-text sibling of renderStyle. Two new tests added to tests/citation-render.test.ts.

### Task 2: exporter.ts wiring

Four coordinated edits:

**(1) Imports + PKG_ROOT:**
- `import { parseBib, renderStyle, renderInText } from './citations.js'` (D-19 only — no `Cite`, no `citation-js`)
- `import path from 'node:path'`, `import { fileURLToPath } from 'node:url'`, `import { statSync } from 'node:fs'`
- `findPkgRoot` + `PKG_ROOT` pattern copied verbatim from citations.ts for CSL path resolution

**(2) ExportOptions.style:** Optional `style?: string` field added after `pandocPresent`

**(3) resolveAndRenderCitations helper:**
- Pitfall-5 guards: missing/empty bib returns md unchanged
- Calls `renderStyle(entries, style)` FIRST (primes pensmith-${style} registration before in-text loop)
- Per-entry `renderInText([entry], style)` loop builds `Map<string,string>` (Pitfall-1: one at a time)
- Regex `/\[(@[^\]]+)\]/g` with ';' split handles multi-cite `[@a; @b]` (Pitfall-6)
- Appends `\n\n## References\n\n` + bibliography only when non-empty (Pitfall-5)
- Zero-trace: heading is `## References`, never any 'pensmith' literal

**(4) buildPandocArgs extended** with optional `citeOpts?: { cslPath: string; bibPath: string }`:
- Appends `--citeproc --csl <path> --bibliography <path>` only when both fields present
- `--citeproc` precedes `--csl`/`--bibliography` (Pitfall-3 ordering)

**(5) exportDraft restructured:**
- Bib-copy block moved BEFORE all format branches (Pitfall-4: --bibliography bibDst resolves at pandoc call time)
- `citeOpts` computed from `opts.style` + `bibCopied` + CSL path existence
- md-only path and Pandoc-absent catch fallback both call `resolveAndRenderCitations` when `style && bibCopied`
- Pandoc latex/docx/pdf paths pass `citeOpts` to `buildPandocArgs` when available
- No `resolveAndRenderCitations` on successful Pandoc path (Pandoc citeproc already resolved citations)

### Task 3: done.ts discipline→style

- Imports `parseIntakeMd` from `../lib/intake-parse.js` and `resolveStyleName` from `../lib/citations.js`
- try/catch block before `exportDraft` reads `INTAKE.md` via `readFileSync`, calls `parseIntakeMd(intakeText).discipline`, resolves to style via `resolveStyleName(discipline)`
- Any error (missing/unreadable/unparseable INTAKE.md) leaves `style` undefined — catch block is empty
- `exportDraft` called with `...(style !== undefined ? { style } : {})` spread pattern (required by `exactOptionalPropertyTypes: true`)
- No new CLI flag, no 17th verb, no change to VALID_FORMATS or format resolution

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript exactOptionalPropertyTypes build failure**
- **Found during:** Task 3 — `npm run build` emitted TS2379
- **Issue:** `{ style: string | undefined }` is not assignable to `{ style?: string }` under `exactOptionalPropertyTypes:true`; assigning `undefined` to an optional key is disallowed
- **Fix:** Changed `style,` to `...(style !== undefined ? { style } : {})` spread conditional in the `exportDraft` call
- **Files modified:** `bin/cli/done.ts`
- **Commit:** 0318d31

## Threat Flag Verification

T-13-02-zt (zero-trace): `## References` heading contains no 'pensmith' — verified by the zero-trace non-regression test (PASS). `zeroTracePatch`/`zeroTracePdf` unchanged and still mandatory on Pandoc docx/pdf path.

T-13-02-d19 (D-19 chokepoint): `exporter.ts` imports only `{ parseBib, renderStyle, renderInText }` from `./citations.js`. No `citation-js` or `Cite` import in exporter.ts. ESLint no-restricted-imports lint clean (0 warnings).

T-13-02-det (determinism): `renderInText` uses `format:'text'` + `lang:'en-US'` (bundled locale, no fetch, no wall-clock). `ensureStyleTemplate` is Map-memoized. Test confirms byte-stable output.

T-13-02-inj (injection): `format:'text'` renders bibliography as plain text. `parseBib` normalizes BibTeX to CSL-JSON. Unknown citekeys emitted as original literal, never executed.

## Known Stubs

None. All citation-rendering paths are fully wired and production-ready.

## Threat Flags

None. No new network endpoints, auth paths, schema changes, or trust boundary crossings beyond those analyzed in the plan's threat model.

## Self-Check: PASSED

- `bin/lib/citations.ts` — FOUND (contains `export async function renderInText`)
- `bin/lib/exporter.ts` — FOUND (contains `resolveAndRenderCitations`, `--citeproc`, `--bibliography`, `bibDst` before `execFileAsync`)
- `bin/cli/done.ts` — FOUND (contains `parseIntakeMd`, `resolveStyleName`)
- `tests/citation-render.test.ts` — FOUND (contains `renderInText` assertions)
- Commit 7eea1b0 — FOUND in git log
- Commit 4998188 — FOUND in git log
- Commit d2f7002 — FOUND in git log
- Commit 0318d31 — FOUND in git log
- `npm run build` — PASS (tsc clean)
- `npm run typecheck` — PASS
- `npm run lint` — PASS (D-19 no-restricted-imports clean, 0 warnings)
- `npm run test:tier-contract` — PASS (48/48)
- `npm test` — PASS (901/901, 0 skip, 0 fail)
- `tests/zero-trace-export.test.ts` — PASS (7/7 unmodified)
