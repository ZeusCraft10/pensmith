---
phase: 03-vertical-slice-one-section
plan: 02
subsystem: third-party-wrappers
tags: [chokepoint, pdf-parse, citation-js, D-06, D-19, T-3-11, WRTE-04, CITE-01, CITE-04, RSCH-05a]
dependency_graph:
  requires:
    - 03-00 (Wave 0 — ESLint chokepoint rules + per-file exemptions for bin/lib/pdf-text.ts and bin/lib/citations.ts)
    - tests/fixtures/known-good-fixture/CITATIONS.bib (Wave 0 fixture; needed for parseBib smoke test)
  provides:
    - bin/lib/pdf-text.ts → extractPdfText (single PDF byte→text chokepoint per D-06 / T-3-11)
    - bin/lib/citations.ts → parseBib / parseBibtex / renderApa / Cite (single BibTeX-and-APA chokepoint per D-19)
    - tests/fixtures/synthetic-pdf-text.ts → 4 plaintext fixtures for downstream Pass-3 + Unpaywall tests
  affects:
    - tests/citation-render.test.ts (1 test PASS → 2 tests PASS; existence-of-apa.csl still fails — Plan 05's job)
    - tier-contract.test.ts (build-artifact-exists path: now passes because npm run build succeeds end-to-end)
tech-stack:
  added: []
  patterns:
    - findPkgRoot path-walk (mirrored from bin/lib/http.ts IN-03 fix) — locates templates/citation-styles/apa.csl correctly under both tsx and dist depths
    - Memoized lazy CSL-template registration (Pitfall #4 mitigation: register pensmith-apa template exactly once per process)
    - Default-export-only binding for citation-js (real Node ESM does not surface `plugins` as a named export despite tsx accepting it — bind via Cite.plugins instead)
    - Ambient .d.ts sibling shim for untyped npm packages (pdf-parse sub-path + citation-js have no @types and no in-package .d.ts)
key-files:
  created:
    - bin/lib/pdf-text.ts
    - bin/lib/pdf-text-shim.d.ts
    - bin/lib/citations.ts
    - bin/lib/citations-shim.d.ts
    - tests/fixtures/synthetic-pdf-text.ts
  modified:
    - tests/citation-render.test.ts (removed the now-unused @ts-error suppression directive at line 42)
decisions:
  - parseBib (canonical async, matches Wave 0 test contract) + parseBibtex alias (plan-spec name); both names resolve to the same function via identity-equal `const parseBibtex = parseBib`
  - renderApa(entries) takes parsed entries (Wave 0 test signature) — reads apa.csl from disk itself via findPkgRoot so callers do not need to know the path; throws a clear diagnostic naming Plan 05 if apa.csl is missing
  - Default-export-only binding for citation-js (named `plugins` import works under esbuild/tsx but fails under real Node ESM)
  - Ambient .d.ts sibling shim (bin/lib/*-shim.d.ts) chosen over inline `declare module` because TS2665 forbids augmenting a module that resolves to an untyped JS file
  - image-only-PDF heuristic: text.replace(/\s/g,'').length < 50 AND numpages >= 1 → emit one WARN line; function still returns the (possibly empty) string per D-08-AMENDED (verify verb assigns UNVERIFIABLE, does NOT block compile)
  - console.warn as the WARN sink (NOT a new logger module per executor prompt) — TODO comment marks the Phase 4 structured-logger handoff
metrics:
  duration_minutes: 35
  completed_date: 2026-05-26
  tasks_completed: 2
  files_created: 5
  files_modified: 1
  commits: 2
---

# Phase 3 Plan 02: Third-Party Wrapper Chokepoints Summary

**One-liner:** pdf-parse and citation-js are each now imported by exactly ONE file in pensmith; both wrappers expose the narrow surface the rest of the codebase will consume — extractPdfText (bytes → text, image-only detection) and parseBib/renderApa/Cite (BibTeX → entries → APA).

## What Shipped

### Task 2.1 — bin/lib/pdf-text.ts (commit fcae2fa)

`extractPdfText(buf: Buffer | Uint8Array): Promise<string>` is now the single allowed importer of `pdf-parse` in the repo. The import path is the sub-path workaround `pdf-parse/lib/pdf-parse.js` (RESEARCH.md Pitfall #1 — the bare `pdf-parse` index.js has a debug-mode ENOENT shim under ESM). The function:

- accepts only Buffer or Uint8Array (T-3-FS-01 — no filesystem access from this chokepoint)
- catches the debug-shim ENOENT and rethrows with a diagnostic naming the sub-path workaround so a future regression fails loudly
- emits ONE `console.warn` line when the parsed text has fewer than 50 non-whitespace characters across >= 1 pages (image-only / scanned PDFs per the REVIEWS amendment + D-08-AMENDED), then still returns the (possibly empty) string; the verify verb (Plan 06) assigns UNVERIFIABLE per D-08-AMENDED — it does NOT block compile

Sibling `bin/lib/pdf-text-shim.d.ts` declares the narrow `.text` + `.numpages` surface ambient-style — the npm package ships no `.d.ts` for the sub-path entrypoint.

`tests/fixtures/synthetic-pdf-text.ts` exports 4 plaintext constants pretending to be pdf-parse output (D-06 — real PDFs intentionally NOT committed):

| Constant | Purpose |
| --- | --- |
| `SYNTHETIC_VASWANI_FRAGMENT` | Accent-free ASCII baseline (Vaswani 2017 abstract excerpt) |
| `SYNTHETIC_LIGATURE_FRAGMENT` | U+FB01 ligature in 'final' — exercises NFKC normalize step |
| `SYNTHETIC_SOFTHYPHEN_FRAGMENT` | U+00AD soft hyphens at line breaks (typical PDF artifact) |
| `SYNTHETIC_IMAGE_ONLY_FRAGMENT` | Empty string — drives the image-only WARN path in extractPdfText (REVIEWS amendment) |

### Task 2.2 — bin/lib/citations.ts (commit f1b0327)

The single allowed importer of `citation-js` in the repo, exporting four symbols:

| Symbol | Shape | Notes |
| --- | --- | --- |
| `parseBib` | `(bibtex: string) => Promise<Array<Record<string, unknown>>>` | Canonical async; matches Wave 0 test contract (`await parseBib(content)`). Throws on malformed BibTeX rather than returning [] (T-3-04 mitigation). |
| `parseBibtex` | `parseBibtex === parseBib` | Plan-spec alias; identity-equal so both names resolve to the same function. |
| `renderApa` | `(entries: Array<...>) => Promise<string>` | Takes parsed entries (Wave 0 test signature). Reads apa.csl from `templates/citation-styles/apa.csl` lazily via findPkgRoot; throws "Plan 03-05 ships apa.csl" if missing. Memoizes pensmith-apa template registration (Pitfall #4). |
| `Cite` | re-export of the citation-js default-export class | CYCLE-3 NEW-H-1: Plan 04 bibtex-write.ts + Plan 09 bibtex-write.test.ts will `import { Cite } from './citations.js'` to preserve D-19 LOCKED chokepoint singleton. |

Sibling `bin/lib/citations-shim.d.ts` declares the Cite class + static `plugins.config.get('@csl').templates.add(...)` surface — no @types/citation-js and no in-package `.d.ts` exists for the package.

## Verification Output

### Chokepoint singleton grep (verification line 298–299)

```
$ grep "^import .* from 'pdf-parse" --type ts (production paths)
  bin/lib/pdf-text.ts:53  import pdfParse from 'pdf-parse/lib/pdf-parse.js';

$ grep "^import .* from 'citation-js" --type ts (production paths)
  bin/lib/citations.ts:64  import Cite from 'citation-js';
```

Red-team fixture at `tests/fixtures/lint-chokepoint-fixture.ts` (allowed per plan verification line 298) was untouched.

### `export { Cite }` literal pattern (Task 2.2 acceptance criterion)

```
$ grep -nE "^export\s*\{\s*Cite\s*\}" bin/lib/citations.ts
  65:export { Cite };
```

Exactly 1 match — D-19 chokepoint re-export confirmed.

### Smoke test (parseBib against the Wave 0 fixture)

```
count: 1
id: vaswani2017attention
title: Attention is All You Need
note: Test entry with accent: á should render as á
```

The `{\'a}` accent-command in the BibTeX `note` field correctly renders as the literal byte `á` (U+00E1) after parseBib — T-3-04 accent-preservation mitigation verified end-to-end.

### Per-plan gates (post-merge inside worktree)

| Gate | Exit | Notes |
| --- | --- | --- |
| `npm run lint` | 0 | Clean; chokepoint rules pass; pdf-text.ts and citations.ts exemptions both fire correctly |
| `npx tsc --noEmit` | 0 | Strict-mode + noUncheckedIndexedAccess + verbatimModuleSyntax + exactOptionalPropertyTypes all green |
| `npm run build` | 0 | tsc emit succeeds; prebuild generates version.generated.ts + verbs.json |
| `npm test` | 1 | Expected non-zero — 23 RED-by-design tests remain for Wave 2+ modules. Test count delta: 53 → 23 failing (−30); 330 → 375 passing (+45). Required delta was ≥ 1; actual delta is 30. |
| `citation-render` (focused) | 1 | 2 pass / 1 fail (apa.csl missing — Plan 05's job) / 1 skip (render gated on apa.csl `shouldSkip`). Before this plan: 1 pass / 2 fail / 1 skip. Net: −1 failing test in this file. |

### Test-count delta vs baseline

```
                  tests   pass   fail   skipped
baseline (848aebd) 463    330    53     74
this plan (f1b0327) 478    375    23     74
delta             +15    +45   -30      0
```

The +15 in total tests reflects extra suite entries that became reachable once citations.ts existed (the parse-render test moved from "skipped because shouldSkip was true on the missing file" to "skipped because shouldSkip is true on the missing apa.csl" — but the suite registration succeeded in both cases, so the count itself shifted as more downstream files imported into the test plan). The decisive number is −30 failing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocker] No type declarations for `pdf-parse/lib/pdf-parse.js`**
- **Found during:** Task 2.1 typecheck
- **Issue:** `npm i pdf-parse` ships no `.d.ts`; `@types/pdf-parse` exists for the bare path but not the sub-path. TS7016 fired on `import pdfParse from 'pdf-parse/lib/pdf-parse.js'`. Inline `declare module 'pdf-parse/lib/pdf-parse.js'` failed with TS2665 ("module resolves to an untyped module, cannot be augmented").
- **Fix:** Added sibling `bin/lib/pdf-text-shim.d.ts` ambient declaration. Narrow surface (only `.text` + `.numpages`) — widening is a chokepoint-bypass smell.
- **Files modified:** bin/lib/pdf-text-shim.d.ts (created)
- **Commit:** fcae2fa

**2. [Rule 3 — Blocker] No type declarations for `citation-js`**
- **Found during:** Task 2.2 typecheck
- **Issue:** Same shape as #1 — no `@types/citation-js`, no in-package `.d.ts`.
- **Fix:** Added sibling `bin/lib/citations-shim.d.ts` ambient declaration. Narrow surface (Cite class + data + format + static plugins.config.get('@csl').templates.add).
- **Files modified:** bin/lib/citations-shim.d.ts (created)
- **Commit:** f1b0327

**3. [Rule 1 — Bug] Plan's `import { Cite, plugins } from 'citation-js'` fails under real Node ESM**
- **Found during:** Task 2.2 runtime smoke test (after typecheck passed via the shim)
- **Issue:** The plan example imports both `Cite` and `plugins` as named bindings. `citation-js@0.7.22` only ships a default export — `Object.keys(M)` shows `plugins` is a top-level named export under `tsx -e` (esbuild synthesizes it) but real Node ESM rejects with `SyntaxError: The requested module 'citation-js' does not provide an export named 'plugins'`. Earlier `tsx -e` smoke test gave a false positive because esbuild populates default-export named-properties as if they were named exports.
- **Fix:** Bind `plugins` via the default-exported class: `import Cite from 'citation-js'; const plugins = Cite.plugins;`. Tested under both tsx (probe.mjs) and Node ESM (`npm test`); both green.
- **Files modified:** bin/lib/citations.ts, bin/lib/citations-shim.d.ts
- **Commit:** f1b0327

**4. [Rule 1 — Bug] Replacement comment for the removed `@ts-error` directive accidentally re-armed the suppression**
- **Found during:** Task 2.2 typecheck (after removing the directive)
- **Issue:** The first replacement-comment draft contained the literal text "@ts-expect-error" inside a prose explanation; TypeScript treats any `// @ts-expect-error` comment as a fresh directive regardless of surrounding text. Result: TS2578 "Unused @ts-expect-error directive".
- **Fix:** Rephrased the comment to "prior ts-error suppression" so the literal directive substring no longer appears in the file.
- **Files modified:** tests/citation-render.test.ts
- **Commit:** f1b0327

### Reconciliation note (per executor prompt — recorded for transparency)

Plan 03-02 specifies `parseBibtex(bibtex: string): Array<...>` (sync). Wave 0's `tests/citation-render.test.ts` imports `{ parseBib, renderApa }` from `bin/lib/citations.js` and calls `await parseBib(bib)` + `await renderApa(entries)`. The plan's `renderApa(bibtex, csl): string` signature is also incompatible with the test's `renderApa(entries)` shape.

Both contracts are honored simultaneously:
- `parseBib` is the canonical async (matches the test).
- `parseBibtex = parseBib` (identity-equal export; matches the plan's symbol name).
- `renderApa(entries)` takes the parsed entries array (test signature). The CSL template is read from disk inside renderApa via the findPkgRoot pattern — Plan 05 ships apa.csl, and until then renderApa throws a clear diagnostic. The test guards the renderApa call with a `shouldSkip` check on apa.csl's existence so the test does not invoke renderApa before Plan 05 lands.

### Auth gates

None.

### Out-of-scope discoveries (not fixed; logged for awareness)

None. Plan execution remained inside the declared `files_modified` set (bin/lib/pdf-text.ts, bin/lib/citations.ts, tests/fixtures/synthetic-pdf-text.ts) plus two sibling ambient `.d.ts` shims (Rule 3 auto-fixes for missing type declarations) plus the test-file directive removal called out in the executor prompt.

## Known Stubs

None in the files this plan ships. `renderApa` throws when apa.csl is absent, which is the deliberate handoff to Plan 03-05 (D-22) — NOT a stub.

## Threat Flags

None. The threat model in PLAN.md (T-3-11, T-3-04, T-3-FS-01, T-3-DOS-02) is fully addressed by the implementation:

| Threat | Mitigation |
| --- | --- |
| T-3-11 (pdf-parse import sprawl) | ESLint chokepoint enforced; production paths grep returns exactly 1 match. |
| T-3-04 (accent-mark round-trip loss) | parseBib preserves `{\'a}` → `á` (smoke-tested against Wave 0 fixture). |
| T-3-FS-01 (pdf-parse reading wrong file) | extractPdfText accepts only Buffer/Uint8Array; TypeError on string/path. |
| T-3-DOS-02 (huge BibTeX/PDF DoS) | Accepted (low risk per plan threat register — pensmith is single-user CLI). |

## Self-Check: PASSED

Files asserted present:

- `bin/lib/pdf-text.ts` — FOUND
- `bin/lib/pdf-text-shim.d.ts` — FOUND
- `bin/lib/citations.ts` — FOUND
- `bin/lib/citations-shim.d.ts` — FOUND
- `tests/fixtures/synthetic-pdf-text.ts` — FOUND
- `tests/citation-render.test.ts` — FOUND (modified)

Commits asserted present:

- `fcae2fa` — FOUND (Task 2.1)
- `f1b0327` — FOUND (Task 2.2)

Acceptance criteria asserted:

- pdf-text.ts sub-path import: `import pdfParse from 'pdf-parse/lib/pdf-parse.js'` — PRESENT (line 53)
- pdf-text.ts chokepoint grep (bin/): 1 match — PASS
- citations.ts citation-js import — PRESENT (line 64)
- `export { Cite };` literal pattern — PRESENT (line 65)
- citation-js chokepoint grep (bin/): 1 match — PASS
- 4 synthetic fixture exports (incl. SYNTHETIC_IMAGE_ONLY_FRAGMENT) — PRESENT
- citation-render test: 1 prior FAIL flipped to PASS (citations.ts existence) — VERIFIED
- Test-count delta: −30 failing (required ≥ −1) — VERIFIED
- All per-plan gates exit 0 (lint, tsc, build); npm test exits 1 due to RED-by-design tests for later waves (expected) — VERIFIED
