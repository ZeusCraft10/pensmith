---
phase: 21-export
stream: export
branch: v1/p21-export
base_commit: 25e5311 (docs(21): plan phase 21 EXPORT)
requirements_closed: [EXP-01, EXP-02, EXP-03 (rendering half, incl. "china" case protection), EXP-04, EXP-05 (writers), EXP-06, EXP-07, EXP-08, EXP-09, GRND-11]
carry_overs_closed: [2 (EXP-04 notes offline), 3 ([@k 33] = page 33), 4 (footnotes after the gate carry nothing unverified, D-21-12), 5 (GRND-11), 6 (DONE-RECORD v2, outline mode), 1 ("china" half: D-21-06)]
handed_to_integration: [done.ts style from resolveExportStyle (and the outline hook after flag validation), tex→latex mapping, runHumanizer/TaskRunner deletion, done.md capability_check/Outputs/step 7 text reconciliation, estimator $0 for outline-mode done, recheckUnknownRetractions shared via done-gate.ts, assertDoneRecordWritable before the draft-mode export]
---

# Phase 21, stream `export`: Summary

The export always produces the format asked for — `md` by its own writer, `docx` /
`pdf` / `latex` by pandoc when present and otherwise by a real built-in writer of that
format — with every citation rendered in the paper's style by one citeproc engine over
the whole document, the same way on both paths (all 8 bundled styles match pandoc 3.9
byte for byte after normalisation). Nothing is rendered that the gate did not read.
The cited-only bib and an unwrapped RIS of the same entries sit beside the document.
Every written file is scrubbed and scanned for trace; a finding deletes the export.
An outline-only paper ends in a re-verified outline and annotated bibliography,
exported the same way, and its router terminus is a DONE-RECORD v2 outline record.

## Requirements

| Req | What shipped | Where |
|---|---|---|
| EXP-01 | `planExportCitations` computes the cited-only bib and RIS without writing; refuses (PensmithError, EXIT_ERROR) a bib that does not parse, a key defined twice, a filtered bib that reads back with other keys, a RIS with other keys, and a citing text whose cited keys the bib holds none of — nothing written. `writeExportCitations` writes `<stem>.bib/.ris` (or removes a stale pair). | `bin/lib/library.ts` |
| EXP-02 / D-21-11 | `renderRisFromCsl`: one `TAG  - value` per line (never wrapped), `AU  - Family, Given` (particles kept, suffix after given, organisations as written), `A2`/`ED` editors, `SP`/`EP`, `JO` + `T2` for journal articles, `DA`, `SN`, `DO`, `UR` (arXiv page for a preprint), `AB`, `N1` only for the library file. The export RIS is rendered from the SAME parsed entries the export bib keeps; the library RIS from LIBRARY.json (toCsl now carries `abstract`). | `bin/lib/ris-write.ts`, `bin/lib/bibtex-write.ts` (toCsl `abstract`) |
| EXP-03 (rendering) / D-21-03..07 | `renderDocumentCitations(entries, style, citations)`: one engine per document; notes numbered across the document; numeric styles in first-citation order; narrative = author-only + suppress-author (number only for numeric styles, as pandoc); affixed cluster items are sort barriers; style default locale (en-GB for Harvard) from shipped CSL locales, current en-US locale replaces citation-js's 2015 one; `.csl` file styles registered by content hash; `caseProtectTitle` / `caseProtectItems` (D-21-06: "China" stays capitalised); rich-text runs out. `export/render.ts` `prepareText` places every citation (pandoc's punctuation/note-placement rules). Goldens for the 8 styles vs pandoc 3.9, EXCEPTIONS.json empty. | `bin/lib/citations.ts`, `bin/lib/export/render.ts`, `plugin/templates/csl-locales/`, `scripts/make-citation-goldens.mjs`, `tests/fixtures/citation-goldens/` |
| EXP-04 / D-21-04 | `splitLocator` follows pandoc 3.9's Locator.hs: optional comma/space, `{…}` delimited locators, a term + roman/digit words, an implicit page only when it holds a digit (`[@k 33]` → page 33; `, iv` → no locator). Offline notes for note styles, never inline full notes, never `..`. Locator oracle test vs pandoc. | `bin/lib/citation-token.ts` (locator block only) |
| EXP-05 (writers) / D-21-02 / D-21-10 | Built-in writers: `docx-writer.ts` (jszip, Word style ids, numbering, footnotes with their own rels, VerbatimChar/SourceCode, blank core/app, ZIP epoch dates), `pdf-writer.ts` (pdf-lib + @pdf-lib/fontkit, OFL Liberation Serif ×4 subset-embedded, Letter/72pt/11pt, footnotes that continue on the next page, page numbers, no Info/XMP), `latex-writer.ts` (iftex branch for pdfLaTeX/XeTeX, `\textfallback`, escapes, hanging-paragraph references; `declarePdfTexCharacters` for pandoc's LaTeX), `markdown.ts` (the Markdown subset reader, differential-tested against `pandoc -t json`), `document.ts` (AST + smart typography), `md-writer.ts`. | `bin/lib/export/*`, `plugin/templates/fonts/` |
| EXP-06 / D-21-09 | `runPandoc`: fresh temp cwd, relative neutral names only (`input.md`, `references.json` CSL JSON case-protected, `style.csl`, `out.<ext>`), `--from markdown-yaml_metadata_block-raw_attribute-raw_tex`, `--shift-heading-level-by=-1` and `--standalone` for LaTeX/PDF, an explicit unnumbered References/Bibliography heading + `#refs` div, `suppress-bibliography` with `bibliography: 'none'`, engine detection (pdflatex, xelatex, lualatex, tectonic); a pandoc failure falls back to the built-in writer of the same format with a note. | `bin/lib/export/pandoc.ts`, `bin/lib/exporter.ts` |
| EXP-07 / EXP-08 / D-21-08 | `zeroTracePatch` (core/app blanked incl. AppVersion, custom.xml + its rel/override removed, XML comments and "pensmith" stripped from structural parts, DOS-epoch ZIP dates), `zeroTracePdf` (Info emptied, epoch dates, non-standard Info keys incl. `/PTEX.*` deleted, XMP removed), `scanExportFile` over docx/pdf/tex/bib/ris/md (markers, offline/stub markers, generator comments, home paths, author/producer, XMP, media EXIF/XMP/PNG text). Scrub on every docx/PDF (both writers), scan on every written file; a finding or a failed scrub deletes all written files and throws `ZeroTraceError` (EXIT_ERROR). | `bin/lib/export/zero-trace.ts`, `bin/lib/exporter.ts` |
| EXP-09 | The requested format is always produced; md never pandoc; the stdout line names the writer (`pensmith export: DRAFT.docx — pandoc docx writer` / `— built-in docx writer — pandoc not found`); no Markdown fallback after a failed scrub. | `bin/lib/exporter.ts` |
| Carry-over 4 / D-21-12 | `assertRenderedKeys`: rendered keys ⊆ gated keys, bibliography = rendered keys, export bib = cited keys the bib holds — else PensmithError before anything is written. A note style citation with no printed form (`[-@k]` in MLA) is left out as pandoc does, with a note. Property test. | `bin/lib/exporter.ts`, `tests/exporter-invariant.property.test.ts` |
| GRND-11 / D-21-25 | `runOutlineDone`: the outline's listed sources; the gate core (`recomputeGate`, listed keys allowed, VRFY-28 refresh) over the EXACT outline document exported plus the live re-check of `unknown` retraction statuses → EXIT_BLOCKED on any blocking row, nothing written; `export-confirm`; `.paper/ANNOTATED-BIBLIOGRAPHY.md` (reference in style, tier, ≤ 60-word abstract excerpt, why relevant, sections supported; every library value escaped, no citation — asserted); `export/OUTLINE.<ext>` + `ANNOTATED-BIBLIOGRAPHY.<ext>` via `exportDraft`; last_verified + retraction statuses recorded; DONE-RECORD v2 outline record. Router: outline mode → `done` until `outlineDoneState` is current → `status (done)` with `outline only — complete: export/OUTLINE.md and export/ANNOTATED-BIBLIOGRAPHY.md — …`; hand-edited annotated bibliography or a newer record → attention. `status`: `mode: outline only`, `deliverables:`. Handoff quotes the detail only when `isOutlineOnlyDoneDetail` (validated names). done.ts hook: 9 lines + 1 import at the top of `run()`. | `bin/lib/outline-export.ts`, `bin/lib/router.ts`, `bin/lib/done-record.ts`, `bin/lib/schemas/done-record.ts`, `bin/lib/migrations/done-record/v1_to_v2.ts`, `bin/lib/status-view.ts`, `bin/lib/handoff.ts`, `bin/cli/route-options.ts` (comment), `bin/cli/done.ts` (hook) |

## Merge notes for Phase 23b — every changed or added exported signature

**`bin/lib/exporter.ts`** (base contract kept; additive):
- `ExportOptions` gains `pdfEngine?: string | null`, `bibliography?: 'cited' | 'none'`; `style?: string` now also takes an absolute `.csl` path; `text?`, `bibText?` as before.
- `ExportResult` gains `writer: 'pandoc' | 'built-in'`, `notes: readonly string[]`.
- `export class ExportFormatError extends PensmithError` (EXIT_ERROR).
- `export function assertRenderedKeys(prep: PreparedText, gatedKeys: readonly string[], plan: ExportCitationsPlan): void`
- `export function __setScrubForTest(fn: ((file: string, format: ExportFormat) => Promise<void>) | null): void`
- re-exports `zeroTracePatch`, `zeroTracePdf`, `ZeroTraceError`, `scanExportFile`, type `ZeroTraceFinding` (moved to `export/zero-trace.ts`; same signatures for the two scrubbers).
- `runHumanizer`, `TaskRunner`, `__setTaskRunnerForTest` untouched (integration deletes them).

**`bin/lib/export/` (new):**
- `render.ts`: `type PlacedPart`, `interface PlacedCitation`, `interface PreparedText`, `toCslItem(item: CitationItem): CitationItemInput`, `async prepareText(text: string, entries: ReadonlyArray<Record<string, unknown>>, style: string | null): Promise<PreparedText>`.
- `md-writer.ts`: `escapeMarkdownText(s)`, `runsMarkdown(runs)`, `markdownBody(prep)`, `bibEntryMarkdown(entry)`, `writeMarkdown(prep, { withBibliography })`.
- `markdown.ts`: types `Inline`, `Block`, `ListStyle`, `ParsedMarkdown`; `parseMarkdown(text)`, `parseInlines(text, literal?)`, `smartText(text, prev?)`.
- `document.ts`: `DocumentBibEntry`, `ExportDocument`, `runsToInlines(runs)`, `buildExportDocument(prep, { withBibliography })`, `inlineText(nodes)`.
- `docx-writer.ts`: `xmlEscape(s)`, `async writeDocx(doc: ExportDocument): Promise<Buffer>`.
- `pdf-writer.ts`: `pdfFontPaths(): string[]`, `async writePdf(doc: ExportDocument): Promise<Buffer>`.
- `latex-writer.ts`: `escapeLatex(s)`, `declarePdfTexCharacters(tex)`, `writeLatex(doc): string`.
- `pandoc.ts`: `PDF_ENGINES`, `detectPdfEngine(): string | null`, `interface PandocInput`, `pandocArgs(input): string[]`, `async runPandoc(input): Promise<Buffer>`, `scrubPandocLatex(tex): string`.
- `zero-trace.ts`: `zeroTracePatch(docxPath)`, `zeroTracePdf(pdfPath)`, `interface ZeroTraceContext { paperRoot }`, `interface ZeroTraceFinding { file, where, finding }`, `class ZeroTraceError extends PensmithError` (EXIT_ERROR; carries findings and the deleted paths), `async scanExportFile(file, ctx): Promise<ZeroTraceFinding[]>`.

**`bin/lib/citations.ts`** (signatures of `renderStyle`, `renderInText`, `renderCitationItems`, `parseBib*` unchanged; `style` may be a `.csl` path):
- `isCslFileStyle(style): boolean`, `cslStyleText(style): string`, `isNoteStyle(style): boolean`, `styleLocale(style): { locale: string; fallback: string | null }`
- `caseProtectTitle(title): string`, `caseProtectItems(entries): Array<Record<string, unknown>>`
- types `RichRun`, `DocumentCitation`, `RenderedCitation`, `RenderedBibEntry`, `RenderedDocument`; `runsText(runs)`, `citeprocHtmlRuns(html): RichRun[]`
- `async renderDocumentCitations(entries, style, citations: readonly DocumentCitation[]): Promise<RenderedDocument>`

**`bin/lib/citation-token.ts`** (locator block only): `LOCATOR_TERMS` (adds `opus`, `sub verbis`), `LOCATOR_VALUE_RE` (now `/^[^\s.,;&\-–—]+(?:\.[^\s.,;&\-–—]+)*/u`), `splitLocator(suffix): LocatorSplit | null` (same signature; pandoc's rule).

**`bin/lib/library.ts`**: `CitedExportResult` gains `entries`; new `interface ExportCitationsPlan { bibText, risText, exported, missing, entries }`, `async planExportCitations(root, citekeys, exportDir, opts: { bibText? }): Promise<ExportCitationsPlan>`, `async writeExportCitations(plan, exportDir, stem?): Promise<{ bibPath; risPath }>`; `exportCitedCitations` unchanged signature (plan + write).

**`bin/lib/ris-write.ts`**: `risName(n): string`, `splitPages(page): [string, string | undefined]`, `interface RisOptions { notes? }`, `renderRisFromCsl(items, opts?): string`; `renderRis`, `writeRis` unchanged signatures. Chokepoint row `library-writer` names `renderRisFromCsl` too.

**`bin/lib/bibtex-write.ts`**: `CslEntry` gains `abstract?: string` (toCsl fills it).

**`bin/lib/done-record.ts`** (`writeDoneRecord`, `finalMdState`, `editedFinalReason`, `readDoneRecord` signatures unchanged; `readDoneRecord` returns draft records only):
- `type DoneRecordRead`, `readDoneRecordFile(paperRoot): DoneRecordRead`, `readOutlineDoneRecord(paperRoot): OutlineDoneRecord | null`
- `newerDoneRecordReason(paperRoot, version): string`, `assertDoneRecordWritable(paperRoot): void` (writeDoneRecord now refuses to overwrite a newer record)
- `ANNOTATED_BIBLIOGRAPHY_FILE`, `annotatedBibliographyPath(paperRoot)`, `async writeOutlineDoneRecord(paperRoot, { doneAt, outlineSha256, bibSha256, annotatedSha256, exports })`
- `type OutlineDoneState`, `interface OutlineDoneRead`, `outlineDoneState(paperRoot): OutlineDoneRead`, `editedAnnotatedReason(paperRoot): string`

**`bin/lib/schemas/done-record.ts`**: `DONE_RECORD_SCHEMA_VERSION = 2`; `DoneRecordSchema` (draft, `mode?: 'draft'`), `OutlineDoneRecordSchema`, `DoneRecordFileSchema`, `OUTLINE_EXPORT_PATH`; types `DoneRecord`, `OutlineDoneRecord`, `DoneRecordFile`. Migration `migrations/done-record/v1_to_v2.ts` `migrate(input)`.

**`bin/lib/router.ts`**: `OUTLINE_ONLY_DONE` is now `outlineOnlyDoneDetail(['export/OUTLINE.md', 'export/ANNOTATED-BIBLIOGRAPHY.md'])`; new `outlineOnlyDoneDetail(exports): string`, `isOutlineOnlyDoneDetail(detail): boolean`. `ResolveOptions.stopAfterOutline` keeps its name; its meaning is the D-21-25 route.

**`bin/lib/status-view.ts`**: `StatusView` gains `mode: 'draft' | 'outline'` and `deliverables: string[]` (both tiers; `paper://state` carries them).

**`bin/lib/outline-export.ts`** (new): `isOutlinePaper(paperRoot)`, `interface OutlineDoneOptions { paperRoot; format: string; style: string; yolo }`, `interface OutlineDoneResult { ok; exitCode?; blocked?; outputs }`, `interface ListedSource`, `listedSources(outline)`, `outlineExportText(outline)`, `abstractExcerpt(abstract, maxWords = 60)`, `interface AnnotatedBibliographyInput`, `async annotatedBibliographyMarkdown(input)`, `async runOutlineDone(opts): Promise<OutlineDoneResult>`.

**`bin/cli/done.ts`**: hook at the top of `run()` (9 lines, one import): an outline paper returns `runOutlineDone({ paperRoot, format: args.format ?? 'md', style: resolveStyleName(INTAKE discipline), yolo })`.

## Tests

**Added:** `citation-goldens` (8 styles vs pandoc goldens; `scripts/make-citation-goldens.mjs` regenerates), `locator-oracle` (pandoc as oracle; `PENSMITH_ORACLE_SEED`/`RUNS`), `zero-trace-scan` (negative controls per rule), `markdown-subset.property` (1000 generated drafts vs `pandoc -t json`; docx read-back), `exporter-invariant.property` (D-21-12), `docx-writer`, `pdf-writer`, `latex-standalone` (compiles with a found engine or `PENSMITH_TEX_ENGINE`; `PENSMITH_REQUIRE_TEX=1` fails without one), `annotated-bibliography`, `outline-record`, `router-outline.property`; helpers `export-doc.ts`, `pandoc-oracle.ts` (`requirePandoc`: skip locally, fail with `CI=true`), `ris-strict.ts` (independent strict RIS reader). Fixtures `tests/fixtures/citation-goldens/`, `tests/fixtures/export/custom-style.csl`.

**Updated (with reasons — nothing skipped, no assertion loosened):**
- `exporter.test.ts` — rewritten: the old cases asserted the Markdown fallback and a copied `.paper/CITATIONS.ris`, both superseded (D-21-02, D-21-11).
- `citation-token.test.ts` — `splitLocator(' 12')` is page 12 and `', iv'` no locator, as pandoc reads them (D-21-04); `', 33 and passim'` case added.
- `citation-integrity.property.test.ts` (HARDEN-03 Property B) — a text whose cited keys are all missing from the bib is now an EXP-01 refusal; the property asserts the refusal.
- `repo-files.test.ts` — the `sample-zero-trace.docx` pin only (the fixture gains a path-bearing `docProps/custom.xml`; its generator is now reproducible).
- `zero-trace-export.test.ts` — a real-pandoc case appended.
- `citation-render.test.ts` — renderer cases appended.
- `ris-write.test.ts` — the Phase 10 RED-by-skip guards removed (the module exists); strict re-import of both RIS files.
- `add-identifiers-cli.test.ts` (not an owned file; one appended case) — `add` re-renders `.paper/CITATIONS.ris`.
- `outline-only-mode.test.ts`, `pensmith-router.test.ts` (outline case) — D-21-25 amends D-18-45: an outline-only paper goes to done first.
- `hooks/hook-logic.test.ts` (not an owned file) — the SessionStart line of an outline-only paper is "Export the paper" until the record is current, then the quoted deliverables detail.
- `done-final-record.test.ts` (pipeline-owned; one line) — `$schemaVersion` 2 (S-20: the record schema is v2).

## Decisions taken in the stream

- **Pandoc reads CSL JSON, not BibTeX** (`references.json`): pandoc's BibTeX reader sentence-cases titles and lowercases "China"; feeding the same case-protected entries the built-in renderer reads keeps both paths identical (D-21-06).
- **Shipped CSL locales** (`templates/csl-locales/locales-en-US.xml`, `-en-GB.xml`, CC BY-SA 3.0): citation-js bundles a 2015 en-US locale ("Issue" vs pandoc's "Number"); the current file matches pandoc 3.9; en-GB gives Harvard its default-locale quotes.
- **The scrub runs on the built-in writers' docx/PDF too** (a no-op that proves them clean), and the scan on every written file including the bib/RIS.
- **ZIP entry dates are the DOS epoch (1980-01-01)**, `createFolders: false`: deterministic bytes, no build time.
- **The outline-mode gate runs over the exact outline document exported** (it cites every listed key, so it is D-21-25's "citation text of the listed keys" plus the outline's own words): an attribution typed into a title, the thesis or a purpose is read by the text scanners too.
- **A routed outline-mode done exports Markdown**; an explicit `pensmith done` keeps citty's `docx` default. The record lists every format exported from the same inputs (judged by the bibliography the gate read, so done's own `last_verified` stamps never make the earlier files stale).
- **DONE-RECORD v2 is a union**: draft records keep v1's fields (written as v2, no `mode`); outline records carry their own fields; `readDoneRecord` returns draft records only, so `finalMdState` never confuses the two.
- **Preprints in the library RIS** are `GEN` (as the bib's `@misc` reads back on the export path) with their arXiv page as `UR`.

## User-path evidence (built CLI, `scratchpad/p21/export/evidence/`, `EVIDENCE.log`)

- A paper taken from `assignment.txt` to `status (done)` by bare `pensmith --yolo` (mock LLM through the sandbox's global `runtime.json`, recorded e2e corpus, sources offline), then `done --format md|docx|pdf|latex` with pandoc 3.9 on PATH and with PATH stripped of it: every run exit 0; writer lines `pandoc docx writer` / `built-in docx writer — pandoc not found` etc.; every DRAFT.* and both CITATIONS files scan clean; both docx unzipped and read back by pandoc (8903 chars each); `docProps/core.xml` blank; both PDFs: empty Info strings, epoch dates, no XMP, text extracted; both `.tex` files compiled with tectonic (XeTeX) and pdflatex (exit 0).
- Outline-only: `new --mode outline --yolo`, then bare `--yolo` ran research, outline, done → `status (done: outline only — complete: export/OUTLINE.md and export/ANNOTATED-BIBLIOGRAPHY.md — …)`; no `sections/*/DRAFT.md`; OUTLINE.md, ANNOTATED-BIBLIOGRAPHY.md, CITATIONS.bib/.ris scan clean; `done --format docx` added both `.docx` (pandoc writer, scan clean, read back); `status` shows `mode: outline only`, `current: complete` and the five deliverables. A fabricated source (`10.99999/fake.001`) added to the library and listed by §1 → bare `--yolo` exit 4: `citation [@fake2024a] is FABRICATED — DOI 10.99999/fake.001 did not resolve via Crossref (no registration agency holds its prefix 10.99999)`.
- `latex-standalone` with `PENSMITH_TEX_ENGINE=<scratchpad>/tools/tectonic PENSMITH_REQUIRE_TEX=1`: 3/3 pass.

## Handed to the integration pass

- **done.ts style**: replace the hook's INTAKE-discipline style with `resolveExportStyle` and move the hook after pipeline's flag validation; map `--format tex` → `latex` for both modes (runOutlineDone throws ExportFormatError for `tex`).
- **done.md**: its `<capability_check>` `degrade_if_missing` lines, the Outputs bullet "(with the Pandoc-absent markdown fallback)" and step 7 ("latex → the offline md→tex writer", "md-fallback") describe the pre-Phase-21 exporter; the appended "Export writers and zero trace" subsection states the current behaviour. Pipeline owns that text.
- **Estimator**: an outline-mode `done` makes no model call; the `--yolo` pre-flight still projects the draft-mode done (humanizer) for it.
- **`recheckUnknownRetractions`** is mirrored in `outline-export.ts` (done.ts's is not importable from `bin/lib` without a cycle); fold both into pipeline's `done-gate.ts`.
- **`assertDoneRecordWritable`** before the draft-mode export (writeDoneRecord now throws after the export when a newer pensmith wrote the record).
- **runHumanizer / TaskRunner / __setTaskRunnerForTest** deletion once done no longer imports them.
- Cross-stream CLI checks in plan §7 item 4 (goldens through `done --format md --style <s>`, `--style ./custom.csl` end to end, the titled DRAFT.md through the writers).

## Verification (this branch, Linux, Node 22)

- `npm run prebuild && npm run lint && npm run typecheck && npm run build && npm run validate:manifests`: all exit 0.
- `LANG=C.UTF-8 CI=true npm test` with pandoc 3.9 on PATH: 3024 tests, 3023 pass, 0 skipped; the one failure is the root-only `atomicWriteFile preserves OLD content on rename/write failure` (chmod 0o500 does not stop root; passes in CI).
- `npm run test:tier-contract`: 63/63.
- `PENSMITH_TEX_ENGINE=<scratchpad>/tools/tectonic PENSMITH_REQUIRE_TEX=1` `tests/latex-standalone.test.ts`: 3/3.
- `npm run bundle` then `npm run bundle:check`: plugin/dist and the plugin version match what is committed.
