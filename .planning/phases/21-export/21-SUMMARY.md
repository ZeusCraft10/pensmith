# Phase 21: Compile, Done and Export (EXPORT) — Summary

**Branch:** `akhil/pensive-faraday-qx3o58` · **Base:** plan commit `25e5311` · **Streams:** `export` (`v1/p21-export`, head `c4788be`) and `pipeline` (`v1/p21-pipeline`, head `cbdafc7`), merged `--no-ff` (`66e33c6`, `77cea38`), then the integration pass (§2 below). Stream detail: [21-export-SUMMARY.md](21-export-SUMMARY.md), [21-pipeline-SUMMARY.md](21-pipeline-SUMMARY.md). Acceptance evidence: [21-VERIFICATION.md](21-VERIFICATION.md).

## 1. What Phase 21 delivers

**compile** writes a titled, headed `DRAFT.md`: `# <title>`, then `## <section title>` for each section in outline order. A title holding a citation, quote, identifier or unsupported form is refused (EXP-05). Each section boundary is smoothed through the one rewrite guard: every citation and every Pass-3 quote is masked first, and a boundary is reported as smoothed, unchanged, rejected with a reason, or skipped with a reason (EXP-10). Contradictions across sections are judged by the `claim-consistency` slug over a deterministic heuristic floor (EXP-11). Citation density names the discipline and the band, each with where it came from (EXP-12). COMPILE-REPORT is fully populated, including a new `## Contradictions` section (EXP-13). COMPILE-INPUTS is now v3.

**done**:
- **Style.** One resolution: `--style` > config.toml > the brief > the discipline preset. All 8 bundled styles work, and so does a local `.csl` (EXP-03).
- **Humanizer.** A real model call: the user's SKILL.md is the system prompt, sent one `##` section at a time. `acceptHumanized` is the single acceptance function both tiers call (EXP-14).
- **FINAL.md.** Written once, after the export, and recorded in DONE-RECORD (EXP-15).
- **Detectors.** Honest scores from GPTZero, Originality.ai or Sapling. Consent is asked once and persisted (EXP-16..18).
- **Plagiarism.** A verbatim check that is phrase-ranked and location-tagged (EXP-19, EXP-20).
- **Flags and aliases.** done gains its flags, and `export` / `humanize` / `score` / `plagiarism` become aliases. There are still 16 verbs (EXP-21).

**The exporter** (EXP-01, EXP-02, EXP-04, EXP-06..EXP-09) always produces the requested format:
- `md` always uses the built-in writer.
- `docx`, `pdf` and `latex` use pandoc when it is present. Otherwise they use a real built-in docx writer, a pdf-lib PDF in the OFL Liberation Serif, or a standalone LaTeX article. There is never a Markdown fallback.

Citations are rendered by one citeproc engine over the whole document, and all 8 styles equal pandoc 3.9. `[@k 33]` is page 33. The exporter renders only keys the gate read. The export bibliography and RIS hold exactly the cited keys. Every docx and PDF is scrubbed, and every written file is scanned; a finding deletes what the export wrote.

**Outline-only mode** (GRND-11) ends in a re-verified outline export and an annotated bibliography, recorded in DONE-RECORD v2.

## 2. The integration pass

The plan's integration steps (21-PLAN §7) and every hand-off from the two stream summaries were done:

1. **Merges.**
   - `v1/p21-export`, then `v1/p21-pipeline`.
   - Conflicts:
     - CLAUDE.md "Compile / done": pipeline's paragraph, with export's exporter and outline-only sentences spliced in.
     - PRD §7.9: pipeline's flags bullet plus export's bibliography bullet.
     - `plugin/workflows/done.md`: pipeline's steps 9–10 plus export's two appended subsections.
     - `bin/cli/done.ts`: imports and the outline hook.
     - plugin/dist and plugin.json: regenerated, never hand-merged.
   - Both stream branches and their worktrees were deleted, along with the harness's two placeholder branches for those worktrees.
2. **done.ts outline hook** (§7.2). It now runs after `checkDoneFlags` and `resolveExportStyle`.
   - It prints `style: <name> (from <source>)` and passes the resolved style (a key or a `.csl` path) to `runOutlineDone`.
   - It passes the validated format, so `tex` becomes `latex`. A routed done with no `--format` exports Markdown.
   - `--only humanize|score|plagiarism` on an outline-only paper says the step is skipped (there is no prose) and writes nothing.
3. **Deleted** `runHumanizer`, `TaskRunner`, `__setTaskRunnerForTest` and the `isHumanizerSkillPresent` import from `exporter.ts` (§7.3). `tests/humanizer-task.test.ts` now scans every source file under `bin`, `mcp`, `hooks` and `plugin` (minus the drift-checked bundles) for `TaskRunner`, `no Task transport`, `__setTaskRunnerForTest` and `runHumanizer`.
4. **`recheckUnknownRetractions`** now lives once, in `bin/lib/done-gate.ts`, with `bib` defaulting to the paper's own. It is re-exported from `done.ts` and called by the outline export, which removes the duplicate in `outline-export.ts`.
5. **A DONE-RECORD from a newer pensmith** makes an exporting or humanizing done refuse before any paid or third-party step (`assertDoneRecordWritable`). Before this change, the refusal came after the export.
6. **Estimator.** An outline-only paper projects no plan, write, verify, compile or humanizer rows, and its done is `no model calls`. Before this change, the `--yolo` pre-flight priced a humanizer for it.
7. **`status --config`.** The cache cell of the template-free `humanizer` slug measures the installed skill, or says `no humanizer skill installed`. It no longer says "the prompt template failed its hash check".
8. **The offline banner** (pinned in `tests/net-mode.test.ts`) now says the detector score and the plagiarism check are skipped. They have been skipped since RUN-03, never replayed. RUN-02's text is amended in REQUIREMENTS.md.
9. **Docs that still described a Markdown fallback were corrected:** `done.md` (`<capability_check>`, Outputs, the zero-trace invariant, step 8, the outline-mode lead), the pandoc doctor probe, and `plugin/references/doctor-output.md` (re-pinned in `tests/repo-files.test.ts`).
10. **Found by the acceptance run: the docx scrub added folder entries.** `zeroTracePatch` rewrote parts with JSZip's default `createFolders`, so every scrubbed docx (pandoc's and the built-in writer's) gained `docProps/` and `_rels/` directory entries. These are not OPC parts. The package is now rebuilt from its parts alone, in order and epoch-dated. Tests: `docx-writer` (the built-in writer through `exportDraft`), zero-trace Test B2 (a rewrite adds none) and Test J (pandoc).
11. **Carry-over 1 in the e2e chain.** `tests/e2e-chain.test.ts` asserts that the routed done of the PRD §15 "APA style" assignment resolves APA and that the docx carries author-date citations, never IEEE numbers.
12. **New tests:**
    - `tests/outline-only-mode.test.ts`: outline export after done's flag checks; config and `--style` precedence; `tex` as `latex`; usage errors export nothing; prose-only aliases skipped.
    - `tests/estimator.test.ts`: outline-only projection.
    - `tests/config.test.ts`: the humanizer cache cell, with and without a skill.

## 3. Tests that encoded superseded behaviour (updated, not skipped)

The stream summaries list theirs (export: `exporter`, `zero-trace-export`, `citation-render`, `outline-only-mode`, `pensmith-router`, `ris-write`; pipeline: `compile-*`, `smoother-token-protect`, `humanizer-*`, `honesty`, `plagiarism`, `done-final-*`, `gates-registry`, `config*`, `prompt-layout`, `llm-models`, `estimator`, `cli-aliases`, `unknown-verb`, `show-prompts`, `plumbing-args`, `bom-draft-cli`, `e2e-chain`). The integration added:

- **`tests/net-mode.test.ts`.** The offline banner no longer claims the detector and plagiarism results are recorded fixtures (§2.8).
- **`tests/repo-files.test.ts`.** The doctor-output.md hash was re-pinned (§2.9).
- **`tests/humanizer-task.test.ts`.** The Task-seam grep was widened (§2.3).
- **`tests/done-final-record.test.ts`.** The export stream's one-line edit (`$schemaVersion` 2) is correct: DONE-RECORD is v2.
- **`tests/hooks/hook-logic.test.ts` and `tests/add-identifiers-cli.test.ts`.** The export stream's additive edits were re-checked and pass.

## 4. Merge notes for Phase 23b — every changed or added exported signature

Phase 23b (PLUG-06..12, PLUG-15) shims the compile smoother, the humanizer and done's decisions. Bases are kept unless noted. No file under `mcp/` and no `plugin/skills/` file other than the `argument-hint` lines of `compile` and `done` changed in Phase 21.

**Exporter — `bin/lib/exporter.ts`** (base contract kept, additive):
- `ExportOptions` gains `pdfEngine?: string | null` and `bibliography?: 'cited' | 'none'`. `style?: string` now also takes an absolute `.csl` path. `text?` and `bibText?` are as before.
- `ExportResult` gains `writer: 'pandoc' | 'built-in'` and `notes: readonly string[]`.
- `class ExportFormatError extends PensmithError` (EXIT_ERROR).
- `assertRenderedKeys(prep, gatedKeys, plan): void` (D-21-12).
- `__setScrubForTest(fn | null)`.
- Re-exports `zeroTracePatch`, `zeroTracePdf`, `ZeroTraceError`, `scanExportFile` and type `ZeroTraceFinding`.
- **Removed in the integration:** `runHumanizer`, `TaskRunner`, `__setTaskRunnerForTest`.

**Exporter — `bin/lib/export/` (new modules):**
- `render.ts`:
  - `type PlacedPart`
  - `interface PlacedCitation`
  - `interface PreparedText`
  - `toCslItem(item)`
  - `prepareText(text, entries, style)`
- `md-writer.ts`:
  - `escapeMarkdownText`
  - `runsMarkdown`
  - `markdownBody`
  - `bibEntryMarkdown`
  - `writeMarkdown(prep, { withBibliography })`
- `markdown.ts`:
  - types `Inline`, `Block`, `ListStyle`, `ParsedMarkdown`
  - `parseMarkdown`
  - `parseInlines`
  - `smartText`
- `document.ts`:
  - `DocumentBibEntry`
  - `ExportDocument`
  - `runsToInlines`
  - `buildExportDocument(prep, { withBibliography })`
  - `inlineText`
- `docx-writer.ts`:
  - `xmlEscape`
  - `writeDocx(doc): Promise<Buffer>`
- `pdf-writer.ts`:
  - `pdfFontPaths()`
  - `writePdf(doc): Promise<Buffer>`
- `latex-writer.ts`:
  - `escapeLatex`
  - `declarePdfTexCharacters`
  - `writeLatex(doc)`
- `pandoc.ts`:
  - `PDF_ENGINES`
  - `detectPdfEngine()`
  - `PandocInput`
  - `pandocArgs`
  - `runPandoc`
  - `scrubPandocLatex`
- `zero-trace.ts`:
  - `zeroTracePatch(docxPath)`. Same signature; it now rebuilds the package from its parts with no folder entries.
  - `zeroTracePdf(pdfPath)`
  - `ZeroTraceContext { paperRoot }`
  - `ZeroTraceFinding { file, where, finding }`
  - `ZeroTraceError` (EXIT_ERROR)
  - `scanExportFile(file, ctx)`

**Citations, library and bibliography writers:**
- **`bin/lib/citations.ts`.** `renderStyle`, `renderInText`, `renderCitationItems` and `parseBib*` keep their signatures, and a style may be a `.csl` path. New:
  - `isCslFileStyle`
  - `cslStyleText`
  - `isNoteStyle`
  - `styleLocale`
  - `caseProtectTitle`
  - `caseProtectItems`
  - types `RichRun`, `DocumentCitation`, `RenderedCitation`, `RenderedBibEntry`, `RenderedDocument`
  - `runsText`
  - `citeprocHtmlRuns`
  - `renderDocumentCitations(entries, style, citations)`
- **`bin/lib/citation-token.ts`.** `LOCATOR_TERMS` adds `opus` and `sub verbis`. `LOCATOR_VALUE_RE` changed. `splitLocator` keeps its signature and now follows pandoc's rule (`[@k 33]` is page 33).
- **`bin/lib/library.ts`.**
  - `CitedExportResult` gains `entries`.
  - New `ExportCitationsPlan`.
  - New `planExportCitations(root, citekeys, exportDir, { bibText? })`.
  - New `writeExportCitations(plan, exportDir, stem?)`.
  - `exportCitedCitations` is unchanged.
- **`bin/lib/ris-write.ts`.** New:
  - `risName`
  - `splitPages`
  - `RisOptions`
  - `renderRisFromCsl(items, opts?)`

  The chokepoint row `library-writer` names it.
- **`bin/lib/bibtex-write.ts`.** `CslEntry.abstract?`.

**DONE-RECORD, router and status:**
- **`bin/lib/done-record.ts`.** The signatures of `writeDoneRecord`, `finalMdState`, `editedFinalReason` and `readDoneRecord` are unchanged; `readDoneRecord` returns draft records only. New:
  - `DoneRecordRead`
  - `readDoneRecordFile`
  - `readOutlineDoneRecord`
  - `newerDoneRecordReason`
  - `assertDoneRecordWritable` (draft-mode done now calls it before any paid step)
  - `ANNOTATED_BIBLIOGRAPHY_FILE`
  - `annotatedBibliographyPath`
  - `writeOutlineDoneRecord`
  - `OutlineDoneState`
  - `OutlineDoneRead`
  - `outlineDoneState`
  - `editedAnnotatedReason`
- **`bin/lib/schemas/done-record.ts`.**
  - `DONE_RECORD_SCHEMA_VERSION = 2`.
  - Schemas `DoneRecordSchema`, `OutlineDoneRecordSchema`, `DoneRecordFileSchema` and `OUTLINE_EXPORT_PATH`.
  - Migration `migrations/done-record/v1_to_v2.ts`.
- **`bin/lib/router.ts`.**
  - `OUTLINE_ONLY_DONE` is now built by `outlineOnlyDoneDetail(exports)`.
  - New `isOutlineOnlyDoneDetail(detail)`.
  - `ResolveOptions.stopAfterOutline` keeps its name and now means the D-21-25 route.
- **`bin/lib/status-view.ts`.** `StatusView` gains `mode: 'draft' | 'outline'` and `deliverables: string[]`; `paper://state` carries them.
- **`bin/lib/outline-export.ts`** (new):
  - `isOutlinePaper`
  - `OutlineDoneOptions { paperRoot; format; style; yolo }`
  - `OutlineDoneResult`
  - `ListedSource`
  - `listedSources`
  - `outlineExportText`
  - `abstractExcerpt`
  - `AnnotatedBibliographyInput`
  - `annotatedBibliographyMarkdown`
  - `runOutlineDone`

**Done gate, rewrite guard and humanizer:**
- **`bin/lib/done-gate.ts`** (new; moved from `done.ts` and re-exported there):
  - `doneSections`
  - `runExportBlockingGate`
  - `exportAcceptanceSets`
  - `recomputeExportGate(paperRoot, text, { sections?, bib?, recheck? })`
  - `sectionQuoteIndex`
  - `citedKeySetChange(humanized, draft)`
  - `readUnsupportedClaims`
  - `unjudgedClaimSections`
  - `unjudgedLine`
  - `readSectionAdvisory`
  - types `ExportBlock`, `DoneSection`, `UnsupportedClaim`, `UnjudgedSection`, `SectionAdvisory`
  - **Added in the integration:** `RetractionRecheck` and `recheckUnknownRetractions(paperRoot, text, bib = loadBibliography(paperRoot))`, re-exported from `done.ts` with the same call shape as before.
- **`bin/lib/rewrite-guard.ts`** (new):
  - `RewriteMask`
  - `MaskOptions`
  - `maskForRewrite(text, { namespace?, quoteMinWords? })`
  - `unmaskRewrite`
  - `headingLines`
  - `boundaryAdditions` (moved from `compile.ts` and re-exported there)
  - `compareRewrite`
  - `ValidateRewriteInput`
  - `RewriteVerdict`
  - `validateRewrite`
  - `modelStepSkipReason(paperRoot)`
- **`bin/lib/claim-consistency.ts`** (new):
  - types `ClaimSource`, `ClaimSentence`, `HeuristicFlag`, `ConsistencyPair`, `ConsistencyVerdict`, `ContradictionReport`
  - `contentTerms`
  - `contradictionHeuristic`
  - `collectClaims`
  - `consistencyCandidates(claims, { maxPairs })`
  - `consistencyRequest(pairs)`
  - `applyConsistencyReply(…)`
- **`bin/lib/humanizer.ts`** (new):
  - `HUMANIZER_SLUG`
  - `HUMANIZER_SKILL_DISPLAY`
  - `HumanizerRequest`
  - `HumanizerSkill`
  - `loadHumanizerSkill()`
  - `humanizerContract()`
  - `humanizerRequest(skill, masked, voice)`
  - `DraftSection`
  - `splitDraftSections`
  - `joinDraftSections`
  - `HumanizeInput`
  - `HumanizeResult`
  - `humanizeDraft`
  - `AcceptInput { paperRoot, draft, humanized, sections?, bib?, quoteMinWords? }`
  - `AcceptResult { ok, reasons, gate }`
  - `acceptHumanized`: **the function PLUG-10's humanizer submission must call.**
- **`bin/lib/export-style.ts`** (new):
  - `ExportStyleSource`
  - `ExportStyle { style, source, name, from, cslClass? }`
  - `CSL_MAX_BYTES`
  - `exportStyleChoices()`
  - `CslValidation`
  - `validateCslFile(file)`
  - `resolveExportStyle(paperRoot, flag?)`

**Compile and density:**
- **`bin/lib/compile.ts`.**
  - `RunCompileOpts` adds `smoothSkip?`, `judgeConsistency?`, `consistencySkip?` and `isFatal?`.
  - `CompileResult` adds `transitions`, `smoothingSkipped`, `contradictions` and `title`.
  - New `dropDuplicateTitleHeading` and `headingProblem`.
- **`bin/lib/compile-report.ts`.**
  - `TransitionEntry.status` adds `'unchanged'`, plus `reason?`, `before?` and `after?`.
  - `CompileReportInput` adds `smoothing_skipped?`, `advisory?` and `contradictions?`.
  - `ADVISORY_EMPTY_MARKER` is deleted and `ADVISORY_NO_SECTIONS_MARKER` added.
  - New `readReportContradictions` and `citationDensityForReport(r, { discipline, band })`.
- **`bin/lib/compile-inputs.ts`.**
  - New `CompileHeadings`, `headingsSha256`, `compilePaperTitle` and `currentHeadings`.
  - `writeCompileInputs` takes an optional `headingsSha256`.
  - Schema v3, with migration `v2_to_v3`.
- **`bin/lib/citation-density.ts`.** New `DisciplineLayer`, `DensityResolution` and `resolveDensityBand`. `computeCitationDensity` takes `band?`.

**Honesty and plagiarism:**
- **`bin/lib/honesty.ts`.**
  - New: `measureHonesty`, `HonestyOutcome`, `HonestyNotApplicable`, `HonestyOptions`, `honestyLine`, `renderHonestySection`, `honestyFramingNote`, `disclosureLine`, `configuredBackend`, `backendLabel`, `DETECTOR_KEY_VARS`, `NO_CONSENT_REASON`, `HonestyBackendName`.
  - **Removed:** `renderHonestyReport` and `GptzeroScoringOptions`. A Tier-1 score submission calls `measureHonesty(text, { paperRoot, consentGranted })` after AskUserQuestion.
- **`bin/lib/plagiarism.ts`.**
  - `PlagiarismResult` adds `location?` and `error?`; `PlagiarismMatch` adds `title?` and `snippet?`.
  - **`runPlagiarism(draft, { maxPhrases?, sectionIds? })`** now takes an options object instead of positional options.
  - New: `selectPlagiarismPhrases`, `wordRarity`, `PHRASE_MIN_WORDS`, `PHRASE_MAX_WORDS`, `ddgQueryUrl`, `decodeDdgLink`, `isDdgChallenge`, `normalizeForMatch`, `isVerbatimMatch`, `locationLabel`.
  - `renderPlagiarismSection(results, { skipped? })`.
  - `extractDistinctivePhrases` is kept as a compatibility wrapper.

**Verbs and the `done` command:**
- **`bin/lib/verbs.ts`.**
  - **`VERB_ALIASES: Record<string, VerbAlias>`** (was `Record<string, Ux02Verb>`), with `VerbAlias { verb, args }`.
  - New `verbAlias` and `expandVerbAlias(argv, at)`.
  - `bin/pensmith.ts` exports `rewriteVerbAlias(argv)`.
- **`bin/cli/done.ts`.**
  - New exports:
    - `DoneStep`
    - `DONE_ONLY_STEPS`
    - `DONE_FORMAT_CHOICES`
    - `NO_VERIFY_RAW_REFUSAL`
    - `parseDoneFormat`
    - `parseDoneOnly`
    - `DoneFlags`
    - `checkDoneFlags(args)`
    - `HumanizeStep`
    - `runHumanizeStep(…)`
    - `plagiarismSkipReason`
  - `PaperVerificationReport` adds `plagiarismSkipped?` and `pass4Skipped?`.
  - Kept: `collectGateIssues`, `runDoneGate`, `runWholePaperPass4`, `buildVerificationReport`, `ClaimDecision`, every done-gate re-export, and (now re-exported) `recheckUnknownRetractions` and `RetractionRecheck`.
  - done's args are `yolo, format, style, raw, verify, score, 'plagiarism-check', only`.
  - The outline-only hook runs after the flag checks and the style resolution.

**Models, prompts, estimator and config:**
- **`bin/lib/llm-models.ts`.**
  - `SlugSpec.template: boolean`.
  - Slug `claim-consistency` (judgment, structured).
  - Slug `humanizer` (generation, `template: false`).
- **`llm-contracts.ts`.** `ClaimConsistencySchema` and `ClaimConsistency`.
- **`prompt-request.ts`.** `PROMPT_INPUTS['claim-consistency']`.
- **`bin/lib/estimator.ts`.** `compileCallsFor` and `humanizerCallsFor`. The integration made an outline-only paper project no section, compile or humanizer rows.
- **`bin/lib/paths.ts`.** `humanizerSkillPath(env?)`.
- **`gates.ts`.** The `detector-consent` label is backend-neutral.
- **`bin/lib/schemas/config.ts`.**
  - New: `HONESTY_BACKENDS`, `DEFAULT_CONTRADICTION_PAIRS`, `DEFAULT_PLAGIARISM_MAX_PHRASES`, `isCslPathSpelling`, `CompileSchema`.
  - `CURRENT_CONFIG_VERSION = 4`.
- **`bin/lib/http-mock.ts`.** `offlineBanner()` text: `… sources and verification are recorded fixtures, not live; the detector score and the plagiarism check are skipped`.

## 5. Hand-offs (D-21-29 and items outside this phase)

**Maintainer items:**
- Keyed live runs of GPTZero, Originality.ai and Sapling (no keys here). GPTZero's real 401 on a dummy key was observed live.
- A CI run of this code (CI-06): the pandoc and TeX steps on all three OSes, with tectonic or TeX as a required check (HARDEN-04, Phase 26).

**Assigned to later phases or outside this one:**
- **BRDTH-02 (Phase 25).** The scanner flags metadata in embedded images, but nothing strips it when the image is embedded.
- **Container environment.** lualatex is broken in this container (luaotfload font cache). Engine detection tries pdflatex first.

**Not changed in Phase 21:**
- **pandoc's docx `app.xml` statistics.** The scrub blanks every identifying property (Application, AppVersion, Company, Manager, Template; core creator, lastModifiedBy and so on; dates set to the epoch). It keeps the document statistics pandoc writes from its `reference.docx` (Words, Pages, TotalTime …). This is unchanged by design: EXP-06 says "core.xml and app.xml blanking is unchanged", and the statistics identify no one.
- **Live DuckDuckGo blocking.** DuckDuckGo answers part of the live queries with its bot challenge. The product reports these per phrase, and in the integration's live run it still found the §4 Bleak House passage with its location (21-VERIFICATION).
