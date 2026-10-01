# Phase 21: Compile, Done and Export (EXPORT) — Summary

**Branch:** `akhil/pensive-faraday-qx3o58` · **Base:** plan commit `25e5311` · **Streams:** `export` (`v1/p21-export`, head `c4788be`) and `pipeline` (`v1/p21-pipeline`, head `cbdafc7`), merged `--no-ff` (`66e33c6`, `77cea38`), then the integration pass (§2 below), three review rounds (§6–§8) and the close-out (§9). Stream detail: [21-export-SUMMARY.md](21-export-SUMMARY.md), [21-pipeline-SUMMARY.md](21-pipeline-SUMMARY.md). Acceptance evidence: [21-VERIFICATION.md](21-VERIFICATION.md).

**Status (closed 2026-10-01):** 21 of 22 requirements Complete; **EXP-09 stays Pending (partial)** — every local criterion is met, but its "LaTeX compiles in the CI export job, with and without pandoc" criterion waits for HARDEN-04 (Phase 26) to put a TeX engine on the CI legs. 8 of 8 ROADMAP success criteria are met on the user path (criterion 1's LaTeX compile locally, with tectonic and pdflatex). Because one requirement is open, the ROADMAP Phase 21 box stays unticked (§9).

## 1. What Phase 21 delivers (the final state, after the three review rounds)

§2–§8 below are the history: the integration pass and each review round, in order. This section describes what the code does at the close.

**compile** writes a titled, headed `DRAFT.md`: `# <title>` (`[project] title`, else the brief's topic in title case, `paper-brief.ts` `titleFromTopic`), then `## <section title>` for each section in outline order; a heading inside a section draft is demoted below its `##` (`demoteSectionHeadings`). A title holding a citation, quote, identifier or unsupported form is refused (EXP-05). Each section boundary is smoothed through the one rewrite guard: every citation and every Pass-3 quote is masked first, and the reply must keep the paragraph count, each paragraph's own placeholders, each citation on its own claim (`citationAnchorProblem`), and add no fence marker or "pensmith"; a boundary is reported as smoothed, unchanged, rejected with a reason, or skipped with a reason that names the mode (EXP-10). Contradictions across sections are judged by the `claim-consistency` slug (capped, 20 pairs by default) over a deterministic heuristic floor (EXP-11). Citation density names the discipline and the band, each with where it came from (EXP-12). COMPILE-REPORT is fully populated, including `## Contradictions` (EXP-13). COMPILE-INPUTS is v3.

**done**:
- **Style.** One resolution: `--style` > config.toml `[project] citation_style` > the brief (INTAKE.md) > the discipline preset; an INTAKE.md that does not parse is an error naming the fix, never a silent preset. All 8 bundled styles work, and so does a local `.csl` on both paths. A `.csl` that config.toml names (a paper file) is read only after the `csl-style` gate — never answered by `--yolo`, approval stored in the data dir per paper and file sha256 (`style-approvals.ts`) — and a network (UNC / `//host`) path is refused before anything opens it; the exporter also refuses a rendered DOI / arXiv id / PMID that no cited entry holds (EXP-03).
- **Humanizer.** A real model call: the user's SKILL.md (found under `$CLAUDE_CONFIG_DIR` or `~/.claude` `skills/`, `skills/synced/*/`, or an installed plugin's `skills/`) is the system prompt, sent one `##` section at a time with the pinned `humanizer-contract.md`. `acceptHumanized` is the single acceptance function both tiers call: the rewrite guard, the cited-key diff, the gate core and the zero-trace author rule; done then re-runs Pass 2 on every citing sentence the humanizer changed (`rewritten-claims.ts`) and lists an UNSUPPORTED rewrite at the confirmation and in VERIFICATION.md. A rejection exits 4 and is kept in `.paper/FINAL.rejected.md`, which the router reports as attention (never a re-billed humanizer) (EXP-14).
- **FINAL.md.** Written once, after the export, and recorded in DONE-RECORD v4 (`exported`, `previous_final_sha256`). `pensmith humanize` records `exported: false`, and the router reports attention naming `pensmith export` until an export renders it (EXP-15, carry-over 6).
- **Zero trace before any paid step.** The zero-trace author rule runs over the gated DRAFT.md before the plagiarism queries, the detector and the humanizer; a refusal is kept in `.paper/EXPORT.refused.md` and reported by the router as attention.
- **Detectors.** Honest scores from GPTZero, Originality.ai or Sapling, before and after, with the backend and an ISO time, or one exact reason (the service's own, e.g. Originality.ai's Enterprise-plan 422). Consent is asked once in a terminal and recorded per paper and per detector in the data dir (`detector-consent.ts`); config.toml's `honesty_consent = false` is only an opt-out, and `--yolo` never grants consent (EXP-16..18).
- **Plagiarism.** A verbatim check of rarity-ranked 6–10-word phrases from every section, sent one at a time as quoted DuckDuckGo queries (2.5–5 s apart, challenged phrases retried after a back-off capped at 30 s, the whole run bounded at 12 s per phrase), with real destination URLs, per-section coverage and an INCOMPLETE label when most queries got no answer (EXP-19, EXP-20).
- **Flags and aliases.** done gains its flags, and `export` / `humanize` / `score` / `plagiarism` become aliases. There are still 16 verbs (EXP-21).

**The exporter** (EXP-01, EXP-02, EXP-04, EXP-06..EXP-09) always produces the requested format:
- `md` always uses the built-in writer.
- `docx`, `pdf` and `latex` use pandoc when it is present (run blind in a temp folder with `--sandbox` and an image-as-text Lua filter; tectonic `--only-cached` when sources are offline). Otherwise they use a real built-in docx writer, a pdf-lib PDF in the OFL Liberation Serif, or a standalone LaTeX article. There is never a Markdown fallback. Every PDF path prints or names every character (`export/glyphs.ts`).

Citations are rendered by one citeproc engine over the whole document, and all 8 styles equal pandoc 3.9 (the goldens, locators, note placement and affix emphasis included; MLA titles its list "Works Cited"). `[@k 33]` is page 33. The exporter renders only keys the gate read. The export bibliography and RIS hold exactly the cited keys. Every docx and PDF is scrubbed and every written file is scanned; exports are staged in the system temp folder and only a clean, scanned set replaces `export/`, and every format already in `export/` is rebuilt from the new text.

**Outline-only mode** (GRND-11) ends in a re-verified outline export and an annotated bibliography whose abstract excerpts come only from the registrar's record and which omits any library value carrying an unverified attribution; every outline done writes the `.md` pair and the `--format` pair (default docx); the DONE-RECORD outline record is written before the annotated file; a stub outline (no model) is refused.

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

Phase 23b (PLUG-06..12, PLUG-15) shims the compile smoother, the humanizer and done's decisions. Bases are kept unless noted. No file under `mcp/` changed in Phase 21. In `plugin/skills/`, Phase 21 changed the `argument-hint` lines of `compile` and `done` AND one hunk of `plugin/skills/pensmith/SKILL.md` (the `--yolo`-never list gained "or using a citation style file a paper's config names", the `csl-style` gate of review round 2). *(Corrected in review round 3: this note said only the argument-hint lines changed.)* v1/p23b rewrapped that paragraph (its lines 220-235) without the clause, so the merge will conflict there or silently keep 23b's text: **the merged paragraph must list the `csl-style` gate among the gates `--yolo` never answers**, and 23b's Tier-1 done must ask it with AskUserQuestion and record the answer through `style-approvals.ts` `approveCslStyle` (see the round-2 and round-3 notes below).

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

## 6. Review round 1 (fixer)

Every finding of the round-1 review was reproduced (or read in the code) before it was fixed; duplicates are listed once. All were confirmed — none was rejected outright; the two partial rejections are noted inline.

**Fixed:**
1. **The smoother could move a citation across the section boundary, and a reply could swap citations between claims** (rewrite-guard.ts). `validateRewrite` now keeps the paragraph count and each paragraph's own placeholders (for the smoother, the two paragraphs are two sections; compile also re-checks each side's cited keys after restoration), and `compareRewrite` adds `citationAnchorProblem`: a citation whose new sentence is matched better by another original sentence than by its own claim (under half of its claim's content terms kept), or two citations of one sentence swapped, is rejected. A merge with uncited context or a reworded sentence passes. Tests: `rewrite-guard`, `smoother-token-protect` (a cross-boundary smoother), `humanizer-wrap` (a swap).
2. **A reply that echoes the fence, adds "pensmith" or adds chatter** is rejected (`untrusted-fence.ts` `fenceMarkerCount`; the paragraph count). The zero-trace scanner flags a fence marker in author content as a backstop. The humanizer contract says to keep the paragraph breaks and each citation on its claim (re-pinned).
3. **The zero-trace scan refused every export whose source URL held `/home/x/`** — author content is now checked for this machine's paths only (the paper's folder, `$HOME`, the OS user's home path) outside web addresses; the generic home-path and `file://` checks stay for metadata. A docx's external hyperlink target is never swept (it showed `pensmith-dryrun` while its target lost it) and is scanned as author content.
4. **pandoc fetched a draft's image** (even offline): `--sandbox`, `-implicit_figures` and a Lua filter that prints every image as its Markdown text (a PDF build fetched images even under `--sandbox`); tectonic runs `--only-cached` while sources are offline or under `--dry-run`.
5. **PDFs lost characters on every path (EXP-09):** pandoc + pdfLaTeX gets a `--include-in-header` of the document's character declarations (`latex-writer.ts` `latexCharFor` / `pdfTexDeclarations`: Greek and symbols as math, sub/superscript digits, folds); a XeTeX-family engine gets Liberation Serif (`\setmainfont`, `Path=./`) and an active `?` (or fold) per missing character; the built-in PDF writer folds (U+2011 → hyphen, thin spaces, NFKC) before printing `?`. Every path names what it printed as `?` in a `note —` line (`export/glyphs.ts`). A pandoc fallback note shows the TeX error line, never the argv. Test: `export-unicode` (built-in PDF, pdflatex and tectonic PDFs, the headers, the failure line, the sandbox with a loopback server).
6. **Note citations in a table cell or a heading:** the built-in PDF writer places a cell's notes at the foot; the built-in LaTeX writes `\footnotemark` in a cell or a heading (`\section[short]{…}`) and `\footnotetext[n]` after it. Verified by pdflatex compiles.
7. **`pensmith humanize` made the paper "complete" with no or a stale export:** DONE-RECORD v3 (migration `v2_to_v3`) adds `exported`; humanize records `false`, `finalMdState` reads `unexported`, the router reports attention naming `pensmith export`, and `--only export` exports it (then `exported: true`).
8. **A newer DONE-RECORD sent a draft paper round a failing done** — the router reports it as attention, as the outline route did.
9. **Outline-only: a removed earlier export kept the paper at `done` forever** — only exports still on disk are carried; **a stop between the annotated file and the record left "edited"** — the record is written first and names the text it replaces (`previous_annotated_sha256`, v3, optional); **`why_relevant` / abstract attributions reached the export** — `uncheckedAttribution` (TEXT_SCANNERS, the quote reader, bare identifiers) leaves such a value out of the file and done names it.
10. **Detector consent lived in config.toml, which a shared paper carries** — the answer is now recorded per paper (realpath) and per detector in `<data dir>/detector-consent.json` (`detector-consent.ts`); `honesty_consent = false` is only an opt-out and `true` grants nothing. EXP-17, S-14, RUN-28 and HARDEN-02 amended; PRD §7.11/§10, PRIVACY, README, done.md and honesty-framing.md (re-pinned) follow.
11. **`score` / `plagiarism` ignored an invalid config.toml** — done reads it strictly before any `--only` branch (one-line ConfigError, exit 1), and `measureHonesty` / `plagiarismSkipReason` send nothing on a config they cannot read.
12. **Rendering vs pandoc:** a note marker moves past the whole punctuation run (pandoc's mvPunct set: every P* character but the en/em dash), a period goes inside a closing straight quote under en-US (dropped after `?`/`!`); `--` is a locator range, an em dash never is, an en-dash page range is formatted by the style; an in-text rendering ending in a period swallows the sentence's; prefixes/suffixes get smart typography; the locator terms are the style locale's (`styleLocaleFacts`: en-GB Harvard keeps `chap. 2` as text; style-locale terms add to the file's); a label is joined to its locator by a non-breaking space. The goldens fixture gained these forms (regenerated with pandoc 3.9; all 8 styles equal) and the locator oracle runs IEEE and Harvard. *Not matched:* pandoc's reader turns the space after an abbreviation in suffix text (`ch. 2` under AMA, not a locator term there) into a non-breaking space — a reader nuance outside the citation renderer, left as is; and pandoc gives a narrative citation an empty footnote in a note style when the rest is empty (ours emits none).
13. **A single-quoted `<style class='note'>`** was rendered in-text — `cslStyleAttribute` reads either quote and spaced `=` (note class and default locale).
14. **`--style ./x.csl`** resolves against the folder the command was typed in (`paths.ts` `invocationDirectory`); config.toml's relative path stays the project's.
15. **An INTAKE.md this build cannot read** silently gave the preset's style — it is now a one-line error naming the remedy.
16. **Dead code removed:** `renderInText`, `renderCitationItems`, `extractDistinctivePhrases`, `scoreHonesty`, `selectBackend`, `HonestyBackend`.
17. **Docs:** done.md (the export bib/RIS, humanize/export, record v3, consent, PDF characters, sandbox, zero-trace rule, carry-over 4, annotated omissions), the citations.ts header, CLAUDE.md (routing inputs incl. the outline route, DONE-RECORD v3, consent in the data dir), the done-record schema comment, README.

**Tests updated because they encoded the old behaviour:** `rewrite-guard`/`humanizer-wrap` (new rejection reasons), `zero-trace-scan` (another user's example path in prose is not a finding; the OS user's is), `exporter` (pandoc argv: `--sandbox`, the reader without implicit figures, the Lua filter), `outline-record` / `done-final-record` / `outline-only-mode` / `router-outline.property` (DONE-RECORD v3; "newer" is v4), `honesty` / `honesty-consent` / `done-honesty` (consent in the data dir), `export-style` (a typed `--style` path is the typing folder's), `citation-render` / `exporter` / `docx-writer` (the NBSP after a locator label), `citation-goldens` (the fixture's key list), `bibtex-roundtrip` / `citation-render` (renderDocumentCitations instead of renderInText).

### Merge notes for Phase 23b (review round 1) — changed or added exported signatures

- `rewrite-guard.ts`: new `citationAnchorProblem(original, rewritten): string | null`; `validateRewrite` / `compareRewrite` signatures unchanged, new rejection reasons (`a citation crossed the boundary between the paragraphs`, `a citation moved to another paragraph` / `claim`, `paragraph structure changed`, `the reply echoes the untrusted-data fence …`, `the reply adds the word "pensmith" …`). PLUG-07/PLUG-10 submissions get these for free.
- `untrusted-fence.ts`: new `fenceMarkerCount(text)`.
- `content-terms.ts` (new): `contentTerms(sentence)` moved here from `claim-consistency.ts` (which re-exports it), so the rewrite guard does not import `claim-consistency.ts` → `verify/pass4.ts` → `anthropic.ts`. *Corrected in review round 2:* this keeps the rewrite guard (and `humanizer.ts`) out of the provider transport's graph; it does NOT make `claim-consistency.ts` clean — on this branch it still reaches `anthropic.ts` through `verify/pass4.ts`, and only 23b's `pass4.ts` (which imports `llm-port.ts`) makes it clean after the merge. See the round-2 merge notes.
- `export/glyphs.ts` (new): `PDF_FONT_FILES`, `foldCandidates`, `drawableText`, `pdfFontHas`, `documentChars`, `pdfUnprintable`, `unprintableNote`.
- `export/pdf-writer.ts`: `writePdf(doc, missing?: Set<string>)`.
- `export/latex-writer.ts`: new `pdfTexKnows`, `latexCharFor`, `pdfTexUnprintable`, `pdfTexDeclarations`.
- `export/pandoc.ts`: `PandocInput.pdfHeader?: PdfEngineHeader`; new `PdfEngineHeader`, `pdfEngineHeader(engine, chars)`, `pandocFailure(e)`; `pandocArgs` adds `--sandbox`, `-implicit_figures`, `--lua-filter images.lua`, `--include-in-header header.tex`, tectonic `--only-cached`.
- `export/zero-trace.ts`: signatures unchanged (author-content rule and the `.rels` sweep changed).
- `export/render.ts`: `toCslItem(item, terms?)`.
- `citations.ts`: removed `renderInText`, `renderCitationItems`; new `cslStyleAttribute`, `LocaleFacts`, `styleLocaleFacts(style)`; `RenderedDocument.punctuationInQuote`.
- `citation-token.ts`: `splitLocator(suffix, terms = LOCATOR_TERMS)`; `LOCATOR_TERMS` issue terms are `no./nos./issue/issues` (not `number`).
- `export-style.ts`: `resolveExportStyle(paperRoot, flag?, flagBase = invocationDirectory())`; throws `PensmithError` (EXIT_ERROR) for an unreadable INTAKE.md.
- `paths.ts`: new `invocationDirectory()`, `pensmithDetectorConsentPath()`.
- `own-source-approvals.ts`: new `paperApprovalKey(root)`.
- `detector-consent.ts` (new): `recordedDetectorConsent(root, backend)`, `recordDetectorConsent(root, backend, yes)` — **the Tier-1 consent question (AskUserQuestion) must record through this**, `DetectorConsentUnwritableError`, `DetectorConsentSchema`.
- `honesty.ts`: removed `scoreHonesty`, `selectBackend`, `HonestyBackend`; new `CONFIG_CONSENT_REASON`; `NO_CONSENT_REASON` text changed; `HonestyOptions.consentGranted` unchanged (the config opt-out still wins).
- `plagiarism.ts`: removed `extractDistinctivePhrases`.
- `done-record.ts` / `schemas/done-record.ts`: `DONE_RECORD_SCHEMA_VERSION = 3`; `DoneRecord.exported`; `OutlineDoneRecord.previous_annotated_sha256?`; `writeDoneRecord(…, { exported? })` (default true); `writeOutlineDoneRecord(…, { previousAnnotatedSha256? })`; `FinalMdState` adds `'unexported'`; new `unexportedFinalReason(root)`; migration `migrations/done-record/v2_to_v3.ts`.
- `outline-export.ts`: new `uncheckedAttribution(value)`; `AnnotatedBibliographyInput.onOmitted?`.
- `bin/cli/done.ts`: `plagiarismSkipReason` reads config strictly (unchanged signature).
- `migrations/loader.ts`: schema name `'detector-consent'`.

## 7. Review round 2 (fixer)

Every finding was reproduced (or read in the code) first. The duplicate (humanize's FINAL.md / DONE-RECORD write order, listed twice) is fixed once.

**Fixed:**
1. **Zero-trace: a short project root refused every export** (`/app`, `/code`, `/data` against `web/app`, `source/code`, `meta/data`). The paper root and the home folder now match only as whole paths (`zero-trace.ts` `pathOccurs`: not inside a longer segment, a `file://` prefix allowed, ending at a separator or a word end). Test: `zero-trace-scan` (the reviewer's `/app` and `/code` exports in all four formats).
2. **Zero-trace: a `%`/"generated by" line in author content refused md and tex** (a MATLAB code block, wrapped prose). Author content is checked only for pensmith's own markers (`<!-- pensmith`, the offline/stub markers, the fence); generator comments are checked where a tool writes — metadata (docx structural parts, PDF `/Info`, a bib outside its entries) and a .tex's comment lines outside verbatim blocks. `scrubPandocLatex` no longer deletes an author's comment line inside a verbatim block (it did, silently). Tests: `zero-trace-scan`.
3. **Zero-trace: a .tex title naming Pensmith or holding `/r/science` was refused.** `\title`, `\subtitle`, `\author`, `\date` and hyperref's `pdftitle`/`pdfsubject`/`pdfkeywords` are the paper's text: scanned with the author rule, blanked before the metadata rules run on the rest of the preamble. Checked on both writers (pandoc too).
4. **Zero-trace: PDF page text was never scanned** (glyph codes). The exporter runs the author rule on the text the PDF will print before building it (`scanExportText` over `document.ts` `documentPlainText`), so all four formats refuse the same text, before anything is written.
5. **Note placement: a punctuation run swallowed `[@` of an adjacent citation and moved a hard-break backslash** — the run stops at the next citation's start and before a line-ending `\`. **A soft line break before a note or superscript** is dropped as pandoc drops a SoftBreak (`render.ts` `spaceStart`; never a blank line, a hard break, or the break after a heading/table/fence).
6. **Rendering vs pandoc:** a note's first letter is capitalised (`See also`, `E.g.`, `Van Gogh, 33`; a mixed-case word such as `iPhone` is left), a suffix's comma or period goes inside a closing quote under en-US (`"Measured Measurement," emphasis added`), and a bibliography entry whose style prints none of its DOI / PMCID / PMID / URL links its title to the first of them (pandoc's link-bibliography — Vancouver). The goldens fixture gained the prefixed note, the suffix, the soft and hard breaks and `&more`; the goldens were regenerated with pandoc 3.9; the goldens test now also compares each entry's link targets and normalises a soft line break as a space (pandoc writes `--wrap=none`). All 8 styles equal pandoc.
7. **md export: SICI DOIs broke their autolink, and link-destination escaping was a no-op.** An autolink is used only when the target holds no `<`, `>` or white space; otherwise `[text](dest)` with `<`, `>`, `(`, `)` and white space percent-encoded. Verified with pandoc (`-f markdown` and `-f commonmark`).
8. **Reference-style links were printed as text by the built-in writers.** The subset reader takes `[label]: url` definitions out of the text (outside code blocks, at a block start) and resolves `[text][label]`, `[text][]` and `[label]`; differential-tested against `pandoc -t json`.
9. **A rejected humanization re-billed the humanizer on every bare run.** done keeps the reasons in `.paper/FINAL.rejected.md`, bound to the compiled draft's sha256; the router reports attention (fixed wording, naming `pensmith done --raw` and `pensmith done`) while that draft is unchanged; any export or accepted humanize removes the file. Test: `humanizer-task` (bare `pensmith --yolo` and `next --yolo` send no humanizer request).
10. **The citation-anchor check rejected ordinary paraphrases.** A move now needs positive evidence: the citation's new sentence keeps under half of its own claim AND is the home (best-covering rewritten sentence) of another original sentence keeping at least half and at least two of its terms — or citations changed order across sentences without their claims travelling with them. All 10 reviewer paraphrase pairs pass; a citation moved onto an uncited claim and two citations swapped between paraphrased claims are still rejected (`rewrite-guard` tests).
11. **`pensmith humanize` wrote FINAL.md before its record** (a stop left done's text "edited"). The record is written first and names the FINAL.md it replaces — DONE-RECORD v4 `previous_final_sha256` (optional; migration `v3_to_v4.ts`, version only), read as `stale`. Tests: `outline-record` (migration and the stop state).
12. **The user's humanizer skill asks for a four-part answer.** The contract's rule 6 says to leave out a draft, an audit or a summary and give only the final rewrite (re-pinned); `humanizer.ts` `finalRewriteOf` takes the text after a `Final rewrite` / `Final version` label — or the skill's own step-8 prompt line that introduces its final version — up to a summary-of-changes label, when the whole reply is not accepted (prose starting "Final version of …" is not a label). Test: `humanizer-wrap` with the skill's Output Format; the reviewer's `MODE=skillformat` driver now exports the humanized text (exit 0).
13. **A custom `.csl` could add unverified text to every citation.** A `.csl` file config.toml names is used only once the user approved it for this paper — the `csl-style` gate (`--yolo` never answers; no terminal → exit 3 naming `--style`), recorded in the data dir (`style-approvals.json`, `bin/lib/style-approvals.ts`) per paper real path and file sha256 (an edited file asks again). A `--style` value the user types and the bundled styles never ask. Defence in depth: `exporter.ts` `assertRenderedIdentifiers` refuses an export whose rendered citations, notes or bibliography print a DOI / arXiv id / PMID none of the cited entries holds. D-21-12 is qualified in exporter.ts and done.md. PRD §7.20, README, PRIVACY, the skill, docs/PLUMBING and CLAUDE.md name the gate. Tests: `csl-style-approval` (unit, the exporter refusal, and the built CLI: refusal, a scripted yes, the second run, the injected DOI refused even when typed), `gates-registry`.
14. **Exports of other formats went stale; a refused export deleted CITATIONS.\*.** exportDraft stages its files in `export/.staging-*` and only a scrubbed, scanned, clean set replaces the files in export/ (a text that cites nothing removes an earlier bibliography). done rebuilds every format already in export/ from the new text; one that cannot be rebuilt is removed and named. Tests: `zero-trace-scan` (a refused export leaves the previous set byte-identical), `done-final-record` (an APA .md rebuilt as IEEE).
15. **GRND-11: one `done --yolo` did not write both .md and .docx; routed and explicit done exported different formats.** An outline done writes the Markdown pair always, the `--format` pair (default docx) and again every format exported before. Test: `outline-only-mode` (routed and explicit done export the same four files; a removed export is written again).
16. **Headings inside a section draft became siblings of the section titles.** compile shifts a draft's headings so its highest is `###` (setext headings converted, fenced code untouched, capped at `######`; `compile.ts` `demoteSectionHeadings`); the drafter prompt says subheadings start at `###` (re-pinned in `prompt-loader.ts` and `tests/repo-files.test.ts`). Test: `compile-pipeline`.
17. **done.md's dry-run humanizer line** — runHumanizeStep reports `humanizer skipped (dry-run)` before it looks for the skill.
18. **Dead exports removed:** `honesty.ts` `backendLabel`, `DETECTOR_KEY_VARS`, `scoreHonestyWithOptions` (+ `announceAbsent`; `show-prompts` and `offline-fail-closed` now test `measureHonesty`, the function done runs), `done-record.ts` `readOutlineDoneRecord`, `router.ts` `OUTLINE_ONLY_DONE`, `glyphs.ts` `pdfUnprintable`.
19. **Contributor docs:** CONTRIBUTING's locked-copy section (honesty framing detector-neutral; the humanizer contract and its no-evasion rule), a paragraph on the pandoc-oracle suites, the goldens regeneration and `PENSMITH_TEX_ENGINE` / `PENSMITH_REQUIRE_TEX`; CLAUDE.md's hash-pin list; the `v3_to_v4.ts` config migration comment.
20. **EXP-09's CI criterion** is recorded as not met in Phase 21 and deferred to HARDEN-04's export job (REQUIREMENTS.md EXP-09 bullet, 21-VERIFICATION §EXP-09): ci.yml installs no TeX engine, and the exporter's tectonic `--only-cached` (sources offline in every test run) also needs a warmed bundle cache there — HARDEN-04 owns both.
21. **The anthropic.ts import graph vs Phase 23b's `mcp-no-provider` row** — documented below (no code change on this branch, where every verb imports `anthropic.ts`); the round-1 content-terms note is corrected above.

**Partly rejected:**
- `isNoteStyle` (dead-export finding) is kept: `scripts/make-citation-goldens.mjs` uses it to title the goldens' bibliography.
- The EXP-09 CI step itself (installing tectonic in ci.yml) was not added — the finding's alternative (recording the deferral to HARDEN-04) was taken, for the reason in item 20.

**Tests that encoded superseded behaviour (updated, not skipped):** `outline-only-mode` (routed done exported only Markdown; explicit done only docx), `outline-record` / `done-final-record` / `router-outline.property` (DONE-RECORD v4; "newer" is v5), `exporter` (the custom style now links its title to the DOI, as pandoc does), `citation-goldens` (fixture key list, link targets, soft breaks), `humanizer-task` (the rejection is kept; bare runs send no request), `show-prompts` / `offline-fail-closed` (`measureHonesty` instead of the removed wrapper), `handoff` (no `OUTLINE_ONLY_DONE`), `export-unicode` (a local `pdfUnprintable`), `repo-files` (contract and drafter prompt re-pins), `gates-registry` (`csl-style` is never skipped).

### Merge notes for Phase 23b (review round 2) — changed or added exported signatures

- **Model call sites.** `bin/cli/done.ts:83` and `bin/cli/compile.ts:35` import `assertLlmConfigured, complete, isFatalLlmError, MissingApiKeyError, RuntimeConfigError` from `'../lib/anthropic.js'` (as every verb on this branch does). 23b's `mcp/step-tools.ts` and `mcp/role-tools.ts` import `bin/cli/compile.js` and `bin/cli/done.js`, so the merge MUST switch both lines to `'../lib/llm-port.js'` (it exports all five). The other paths from these two files to `anthropic.ts` on this branch — `done.ts` → `verify/pass4.ts`, `compile.ts` → `compile.ts`(lib) → `claim-consistency.ts` → `verify/pass4.ts` — are clean once 23b's `pass4.ts` (llm-port) wins the merge. The humanizer's model call is already injected (`humanizeDraft({ call })`), and `humanizer.ts`, `rewrite-guard.ts`, `exporter.ts`, `outline-export.ts`, `done-gate.ts`, `done-record.ts`, `export-style.ts` and `style-approvals.ts` reach no provider module (checked with a static import walk).
- `export/zero-trace.ts`: new `latexVerbatimMask(lines)`, `scanExportText(file, text, ctx)`.
- `export/document.ts`: new `documentPlainText(doc)`.
- `export/markdown.ts`: `parseInlines(text, literal?, refs?)` (optional reference map).
- `exporter.ts`: new `assertRenderedIdentifiers(prep, entries)`, `exportPathFor(exportDir, inputPath, format)`, `exportedFormats(exportDir, inputPath)`; `exportDraft` stages and commits only a clean set (signature unchanged).
- `compile.ts`: new `demoteSectionHeadings(draft)` (compile applies it to every section body).
- `humanizer.ts`: new `finalRewriteOf(reply)`; `acceptHumanized` unchanged. **PLUG-10's humanize submission** should keep done's order: `writeDoneRecord(…, { exported: false, previousFinalSha256 })` BEFORE writing FINAL.md, `clearHumanizeRejection` on acceptance, and `writeHumanizeRejection` on a refusal (else a routed done loops on a refused Tier-1 humanization).
- `done-record.ts` / `schemas/done-record.ts`: `DONE_RECORD_SCHEMA_VERSION = 4`; `DoneRecord.previous_final_sha256?`; `writeDoneRecord(…, { previousFinalSha256? })`; new `FINAL_REJECTED_FILE`, `finalRejectedPath`, `writeHumanizeRejection(root, { compiledDraftSha256, reasons, at })`, `clearHumanizeRejection(root)`, `humanizeRejectionReason(root)`; migration `migrations/done-record/v3_to_v4.ts`; removed `readOutlineDoneRecord` (use `readDoneRecordFile`).
- `router.ts`: removed `OUTLINE_ONLY_DONE` (build details with `outlineOnlyDoneDetail`); new attention for `FINAL.rejected.md`.
- `style-approvals.ts` (new): `isCslStyleApproved(root, file)`, `approveCslStyle(root, file)` — **the Tier-1 done must ask with AskUserQuestion and record through this** (the MCP server disables prompts, so `assertCslStyleApproved` refuses with exit 3 there), `assertCslStyleApproved(root, style, write)`, `StyleApprovalsSchema`, `StyleApprovalsUnwritableError`, `CURRENT_STYLE_APPROVALS_VERSION`.
- `gates.ts`: new gate `csl-style` (GateId, GATES row; never skipped by `--yolo`, refuse 3/3, EXP-03). 23b's gate list tool and tier-contract gate coverage pick it up from GATES; add a Tier-1 row if that coverage enumerates gates by hand.
- `paths.ts`: new `pensmithStyleApprovalsPath()`; `migrations/loader.ts`: schema name `'style-approvals'`.
- `outline-export.ts`: `runOutlineDone` exports the Markdown pair, the `format` pair and every format exported before (signature unchanged; 23b's `format: a.format ?? 'docx'` now matches the CLI).
- `honesty.ts`: removed `backendLabel`, `DETECTOR_KEY_VARS`, `scoreHonestyWithOptions`. `export/glyphs.ts`: removed `pdfUnprintable`.
- Re-pinned locked files: `plugin/references/humanizer-contract.md` (`7e66fe7d…`), `plugin/templates/prompts/section-drafter.md` (`b3ed7af7…`, both pins). Re-stamp plugin.json after the merge.

## 8. Review round 3 (fixer)

Every finding was reproduced or read in the code first; none was rejected as a false positive.

**Fixed:**
1. **The rewrite guard let a citation move onto a new, invented claim** (major). `citationAnchorProblem` now also rejects (a) a citation whose OWN claim survives — half of its terms, two of them — in a rewritten sentence that no longer carries it, while the citation's sentence keeps under half of that claim: a sentence the model invented, `Results vary [@a].`, `It is false [@a].`; (b) the same across a semicolon (claims are split at `;`, not at an entity's `;`): `…; smoking causes cancer [@a]`; (c) a negation the claim did not have in the sentence that holds its citation (`do not`, `don't`, `never`, …; `not only`, `rather than`, `no doubt` and a negation merged in from an uncited sentence excluded). The reviewer's end-to-end case is rejected in `humanizer-wrap`; all ten round-2 paraphrases still pass. Better still, done now **re-judges claim support (Pass 2) over every citing sentence the humanizer changed** (`bin/lib/rewritten-claims.ts`; `runPass2(…, { only })`): an UNSUPPORTED rewrite is listed at the confirmation as `§N (humanized)` and decided in `.paper/VERIFICATION.md` as `humanized text`; a section record's claim whose sentence the rewrite replaced (and that was judged again) is dropped, any other stands. The estimator prices those `claim-support` calls. Tests: `rewrite-guard` (r3 cases), `humanizer-wrap`, `humanizer-task` (built CLI, mock LLM: one claim-support call, the claim listed and recorded).
2. **RIS deleted text between `<` and `>`** (major, regression). `ris-write.ts` `oneLine` strips only the markup tags citation-js and CSL write (`markup.ts` `stripMarkupTags`, the known-tag allow-list) and decodes entities once; `citations.ts` `linkBibliographyTitle` uses the same, so a Vancouver title with `<5 mg` is linked again. Tests: `ris-write` (title and abstract round-trip), `citation-render`.
3. **A config.toml `.csl` path was opened before approval** (major; on Windows a UNC path leaks NTLM credentials). `resolveExportStyle` resolves a config.toml `.csl` path lexically and returns it `pending` without touching it, and refuses a network path (`\\host\…`, `//host/…`) outright (EXIT_USAGE). `assertCslStyleApproved` asks the `csl-style` gate with the path alone, reads/validates/hashes the file only after a yes (or when an approval for that exact path exists), and returns the validated style; approvals are keyed by the lexical path. Test: `csl-style-approval` spies on every fs call (statSync, readFileSync, openSync, existsSync, realpathSync, accessSync — the builtin ESM exports synced) and asserts none names the file before the approval, with a positive control after it.
4. **The annotated bibliography's excerpt gained a space after every period** (major). `abstractExcerpt` cuts the text at a sentence end (`.`/`!`/`?` and closing marks followed by white space or the end) within the budget — never rebuilds it. Tests: decimals, `U.S.`, `e.g.`, an e-mail address, a URL; every excerpt is a prefix of its text.
5. **The humanizer skill was found only at `~/.claude/skills/humanizer/SKILL.md`** (major; the user's skill is account-synced). `paths.ts` `humanizerSkillPath` looks where Claude Code installs skills: `$CLAUDE_CONFIG_DIR` (else `~/.claude`)`/skills/humanizer/SKILL.md`, then `skills/synced/*/humanizer/SKILL.md`, then each installed plugin's `skills/humanizer/SKILL.md` (`plugins/installed_plugins.json`); done, the estimator, `status --config`, doctor and the capabilities resource share it; done prints `humanizer skill: <path>`; the not-found line and the doctor WARN name every place looked. On this machine it now resolves to the user's synced blader/humanizer 2.2.0. The test sandboxes and `scripts/run-tests.mjs` drop `CLAUDE_CONFIG_DIR`, and under a test context a config dir outside os.tmpdir() is refused (CI-09). Tests: `humanizer-wrap` (synced, plugin, CLAUDE_CONFIG_DIR, precedence, refusal).
6. **DuckDuckGo refused most phrase queries** (major). `runPlagiarism` sends the queries one at a time, 2.5–5 s apart (jittered), every section's first phrase before any second, retries a challenged phrase up to twice after a growing back-off, and reports coverage: `plagiarismCoverage` / `plagiarismCoverageLine` name the sections no answered phrase covers and call a run where most queries got no answer `INCOMPLETE` — in the terminal, VERIFICATION.md's `Coverage:` line and the export confirmation (`GateIssues.plagiarismCoverage`). **Live re-measurement** (this container, 12 phrases over three sections, paced): 12 of 12 answered, 0 refused, the Bleak House line found (9 verbatim results), 158 s (scratch `p21/fix-r3/ddg/EVIDENCE-live-paced.txt`); round 2's unpaced runs had 13–23 of 17–30 refused. In-process MockAgent lanes set no pacing (`_setPlagiarismPacingForTest`, set by `tests/sources/three-way.ts` `liveLane` and `done-honesty`). Tests: `plagiarism` (one query at a time measured by request timestamps, every section first, the retried phrase, coverage lines).
7. **Outline-only done exported LLM-stub text** (major, VRFY-24 for outline mode). `pensmith outline` writes `STUB_OUTLINE_MARKER` (`<!-- stub outline (no model configured) — not a real outline -->`) after OUTLINE.md's title when the outline-author ran stubbed outside `--dry-run`; `runOutlineDone` refuses such an outline (EXIT_BLOCKED) and the router reports attention naming `pensmith outline --force` (never a routed done); deleting the line makes it the user's. A stubbed evaluator's `why_relevant` is printed as `not recorded (no model judged it)`, and the zero-trace author rule now refuses the stub reasons and the stub-outline line. Test: `outline-only-mode` (built CLI: research on the corpus, the outline stubbed, repeated bare runs export nothing, done exits 4, the user-owned outline exports with no stub text).
8. **The annotated bibliography quoted LIBRARY.json abstracts nothing verified** (major, S-17). The excerpt quotes only the abstract the source's registrar records (`outline-export.ts` `registrarAbstract`: a DOI at Crossref else the agency doi.org names, an arXiv id at arXiv, a PMID at PubMed — through the HTTP cache Pass 1 just filled), labelled `Summary (abstract excerpt, from the <registrar> record)`, else `no abstract available (<why>)`. Tests: `annotated-bibliography` (a tampered library abstract never appears), `outline-only-mode` (tampered LIBRARY.json on the real path).
9. **A zero-trace refusal came after the paid and third-party steps, and the router looped** (major). done runs the author-content rule (`scanExportText`) over the gated DRAFT.md before the plagiarism queries, the detector and the humanizer, for every format; a refusal is kept in `.paper/EXPORT.refused.md` bound to the compiled draft's sha256 (`done-record.ts` `writeExportRefusal` / `exportRefusalReason` / `clearExportRefusal`) and the router reports attention while that draft is unchanged. `acceptHumanized` refuses a rewrite that ADDS such text (the humanizer's rejection, kept in FINAL.rejected.md). Test: `humanizer-task` (built CLI: exit 1 before any step, zero humanizer requests, attention, no routed done; after the fix, a humanizer that adds a `.paper` path is rejected).
10. **Affix emphasis printed as literal asterisks** (minor). `render.ts` `affixHtml` reads a prefix/suffix as Markdown inlines (the subset reader) and hands citeproc-js `<i>`/`<b>`/`<sup>`/`<sub>`; `md-writer.ts` `runsMarkdown` writes adjacent superscript runs as one `^…^` span with escaped spaces (AMA). The goldens fixture gained `[*see* @kuhn1962, p. 33, *emphasis added*]` and `[see @okafor2019, pp. 33-35 and *passim*]`; all 8 goldens regenerated with pandoc 3.9 and equal.
11. **A braced locator with no term printed `p.`** (minor). `splitLocator` gives `{33}` / `{iv}` the label `IMPLICIT_LOCATOR_LABEL` (`none`), which citeproc-js prints with no label, as pandoc does. The locator oracle gained `{33}`, `{33 and 34}`, `{p. 33}`, `{iv}`, `{chap. 3}`, `{33}, emphasis added` and now also runs MLA; all five styles equal pandoc.
12. **The built-in PDF writer took minutes on a long token** (minor). `breakLines` cuts a long word from per-character advances summed once and confirms each cut with one measurement: 10,000 characters in ~1.3 s (was > 60 s at 5,000). Test: `pdf-writer` (a 10,000-character token and a 4,000-character code line, every character kept, under 20 s).
13. **The plagiarism check skipped a "Sources and Methods" section and mislabelled later ones** (minor). Every `## ` heading takes the next section id; only a heading that IS a reference-list title (`References`, `Bibliography`, `Works Cited`, `Literature Cited`) is skipped. Test: `plagiarism`.
14. **An interrupted export left an unscanned copy in export/** (minor). Staging is in the system temp folder (`pensmith-export-*`); a stale `export/.staging-*` an older run left is removed by the next export. Test: `exporter`.
15. **`pensmith export` erased the recorded scores and plagiarism results** (minor). An `--only export` of the very text VERIFICATION.md's `Text checked:` line names keeps that record's Honesty body and Plagiarism section (`done.ts` `keptAdvisorySections`). Test: `done-honesty` (a docx `--only export` after the full done: both scores and the plagiarism section kept, no detector request).
16. **MLA titled its list "References"** (minor). `render.ts` `referencesHeading`: `Works Cited` for MLA (and a local `.csl` whose `<id>`/`<title>` names the Modern Language Association), `Bibliography` for a note style, else `References` — every writer and the pandoc path; the goldens generator uses it (mla.md regenerated). Test: `exporter` (md, LaTeX, docx).
17. **Originality.ai's reason was dropped** (minor). `honesty.ts` `serviceReason` puts the service's own short `error`/`message`/`detail` (key masked, markup out, ≤ 160 chars) in the unavailable reason: `unavailable (Originality.ai: Enterprise Subscription Required to use the Originality.ai API (HTTP 422))`. README, PRIVACY and docs/SOURCES.md say the API needs an Enterprise plan. Tests: `honesty` (422 with an error body; a body echoing the key).
18. **`plan`/`verify` with no number ignored outline-only mode** (minor). They route with `routeOptionsFor(paperRoot)`; on an outline-only paper they name the mode and make no model call. Test: `outline-only-mode`.
19. **The title was the lowercase topic** (minor). `paper-brief.ts` `titleFromTopic`: `[project] title`, else the topic in title case (small words lower case inside, words the user capitalised kept); README, compile.md and PRD §7.8 say where the title comes from and how to change it (OUTLINE.md's first line). Test: `paper-title`. (No prompt was re-pinned: an outline-proposed title would be a D-12 amendment — not taken.)
20. **Stale workflow bodies** (minor). compile.md (Outputs and step 6: the title source and heading demotion), next.md (router inputs and every Phase 21 attention state), status.md, CLAUDE.md and PRD §7.8 follow the code.
21. **The 23b merge notes misreported the plugin/skills edits** (minor). Corrected in §4: the `pensmith/SKILL.md` hunk adding the `csl-style` gate is named, with the instruction for 23b's rewrapped paragraph. v1/p23b's worktree was not edited (another session owns it).
22. **21-CONTEXT decisions contradicted the code** (minor). Amendment notes on D-21-07, -09, -14, -18, -19, -20, -22 and -25.
23. **EXP-09's CI criterion** (minor) stays open: REQUIREMENTS.md's traceability row now reads "Pending — partial … until HARDEN-04 adds a TeX engine to the CI legs and runs `tests/latex-standalone.test.ts` with `PENSMITH_REQUIRE_TEX=1`". The CI step was not added here (tectonic needs a warmed bundle cache under the test runner's offline sources; HARDEN-04 owns it, as round 2 recorded).

**Rejected:** none.

**Gate (this container, Node 22, LANG=C.UTF-8, pandoc 3.9 on PATH):** prebuild, lint, typecheck and build clean; `test:tier-contract` 63/63; `npm test` 3144 of 3146 pass, 0 skipped — the two failures were `atomic-write` "preserves OLD content on rename/write failure" (root ignores `chmod 0o500`; passes in CI, CLAUDE.md) and `llm-contracts` RUN-25, whose expected OUTLINE.md title was the lowercase topic (updated to the title-cased topic, then 10/10); `validate:manifests` and `bundle:check` clean (bundles rebuilt, plugin.json re-stamped `0.1.0-dev+94ea9de82086`); `node scripts/e2e-smoke.mjs` PASS=17 FINDING=0 FAIL=0. Extra evidence (scratch `p21/fix-r3/`): the live paced DuckDuckGo run above, and strace of `resolveExportStyle` on a config.toml naming a `.csl` — 0 openat/stat/statx calls name the file.

**Tests that encoded superseded behaviour (updated, not skipped):** `llm-contracts` (RUN-25: the OUTLINE.md title is the topic in title case), `export-style` (a configured missing `.csl` resolves `pending`, it is no longer read at resolve time), `annotated-bibliography` (the excerpt comes from the registrar map, the label names the registrar), `outline-only-mode` (the summary-line regex), `humanizer-task` / `done-final-gate` (the not-found line names every place looked), `honesty` (a 401's reason now carries the service's text), `citation-goldens` (fixture key list; MLA's `Works Cited`), `locator-oracle` / `exporter-invariant` (split on `Works Cited` too), `plagiarism` (`pacing` for the MockAgent lane).

### Merge notes for Phase 23b (review round 3) — changed or added exported signatures

- `rewrite-guard.ts`: signatures unchanged; new rejection reasons `a citation moved off its claim (…)` and `a citation's claim was negated (…)`; claims split at semicolons.
- `rewritten-claims.ts` (new): `rejudgeRewrittenClaims({ paperRoot, compiled, text, claims, bib, sections, sectionIds })` → `{ claims, changedPairs, replaced }`. It reaches the model transport through Pass 2, so only done imports it; **a Tier-1 done that exports a humanized FINAL.md should run the same re-judgement** (or its host-side equivalent) before the confirmation.
- `verify/pass2.ts`: `Pass2Options.only?: (pair) => boolean`; new `pass2SentenceCell(sentence)`.
- `done-gate.ts`: `UnsupportedClaim.rewritten?: boolean`.
- `humanizer.ts`: removed `HUMANIZER_SKILL_DISPLAY` (use `paths.ts` `humanizerSkillSearchDescription()`); `acceptHumanized` (same signature) also rejects a rewrite that adds text the zero-trace author rule refuses.
- `paths.ts`: new `humanizerSkillCandidates(env?)`, `humanizerSkillSearchDescription(env?)`; `humanizerSkillPath(env?)` returns the first existing candidate (else the first candidate, or null under a refused test home).
- `done-record.ts`: new `EXPORT_REFUSED_FILE`, `exportRefusedPath`, `writeExportRefusal(root, { compiledDraftSha256, reasons, at })`, `clearExportRefusal(root)`, `exportRefusalReason(root)`; `router.ts` reports it as attention. **Tier-1 done must run the same pre-scan** (`scanExportText` over the gated DRAFT.md) before any detector/plagiarism/humanizer step and record a refusal the same way.
- `bin/cli/done.ts`: new `keptAdvisorySections(root, sha256)`; `PaperVerificationReport.plagiarismSection?`; `GateIssues.plagiarismCoverage?`.
- `export-style.ts`: new `isNetworkPath(value)`, `CONFIG_STYLE_WHERE`; `ExportStyle.pending?: true` (a config.toml `.csl` not read yet). `style-approvals.ts`: **`assertCslStyleApproved` now returns `Promise<ExportStyle>`** (the validated style — callers must export the returned one); `isCslStyleApproved` reads the file only when an approval for its lexical path exists; approvals are keyed by `path.resolve(file)`.
- `outline-parse.ts`: new `STUB_OUTLINE_MARKER`, `hasStubOutlineMarker(text)`, `stubOutlineReason(folder)`. `outline-export.ts`: new `registrarAbstract(lib, entry)`, type `RegistrarAbstract`; `AnnotatedBibliographyInput.abstracts` (required). `abstractExcerpt` keeps its signature.
- `markup.ts`: new `stripMarkupTags(s)`.
- `plagiarism.ts`: new `DDG_PACING`, `PlagiarismPacing`, `PlagiarismOptions.pacing?`, `plagiarismCoverage(results)`, `plagiarismCoverageLine(results)`, `_setPlagiarismPacingForTest(p)`; `runPlagiarism` is sequential (a Tier-1 memo of results is unaffected).
- `honesty.ts`: new `serviceReason(body, key)`.
- `citation-token.ts`: new `IMPLICIT_LOCATOR_LABEL`. `export/render.ts`: new `referencesHeading(style, noteStyle)`, `affixHtml(affix)`. `export/md-writer.ts`: `runsMarkdown` merges adjacent superscript/subscript runs.
- `paper-brief.ts`: new `titleFromTopic(topic)`; `PaperBrief.title` is title-cased when `[project] title` is unset.
- `exporter.ts`: staging moved to `os.tmpdir()` (signature unchanged).
- Re-stamp plugin.json after the merge.

## 9. Close-out (phase closer, 2026-10-01)

The close-out re-ran the gate and the user path on the final code and updated the planning files. Evidence: [21-VERIFICATION.md](21-VERIFICATION.md). The user path found one product defect, which is now fixed and tested (`25b758d`, below); the gate was then run again at that commit.

**Defect found and fixed: the plagiarism check could stall for many minutes (EXP-19).** In the live lane, DuckDuckGo challenged about two queries in three, and the back-off grew without bound: it was 10 s times the challenges in a row, and a challenged phrase was asked up to twice more. A 17-phrase `pensmith plagiarism` and the plagiarism step of a live `pensmith done` each ran past the driver's five-minute limit with no output after the start line; with every query refused, the waits would sum to hours. `plagiarism.ts` now:
- caps each back-off wait at 30 s (`maxBackoffMs`);
- gives the run 12 s per phrase (`budgetPerPhraseMs`; about 6 min for the default 30). Once the budget is spent, no further query goes out. Each phrase still waiting keeps its last refusal, or carries `not queried — the check's time budget (N min) ran out while DuckDuckGo refused queries; retry later`, so the coverage line reports the run INCOMPLETE;
- names the bound in its start line (for 17 phrases: `about 1 min, at most 3 min if DuckDuckGo keeps refusing`) and prints a line when it stops at the budget.

done.md step 2 and the README say so, and plugin.json was re-stamped; no bundle changed. Test: `plagiarism` (close-out): against a DuckDuckGo that refuses every query, the run stops within its budget, every wait is capped, unasked phrases say so, and the coverage is INCOMPLETE. Making either the cap or the budget a no-op fails the test.

**Merge notes for Phase 23b (close-out):** `plagiarism.ts`: `PlagiarismPacing` gains the required `maxBackoffMs` and `budgetPerPhraseMs` (`DDG_PACING` sets 30 000 and 12 000); new `budgetSpentReason(budgetMs)`; `runPlagiarism` keeps its signature. `PlagiarismOptions.pacing` and `_setPlagiarismPacingForTest` still take a `Partial`, so callers passing zero gaps are unaffected. A Tier-1 plagiarism memo that replays `runPlagiarism` results needs no change.

**Gate (Linux, as root, Node 22.22.2, LANG=C.UTF-8, pandoc 3.9 on PATH), at `25b758d` after the fix:**
- prebuild and build clean; the build left nothing in `git status --porcelain`. Lint, typecheck, `validate:manifests` and `bundle:check` (plugin version `0.1.0-dev+bcb7e05066a7`) all pass.
- `test:tier-contract`: 63/63.
- `CI=true npm test`: 3147 tests, 3146 pass, 0 skipped, 0 todo. The one failure is the root-only atomic-write case. HARDEN-03 ran 1000 drafts against pandoc 3.9, and the real-data-dir fingerprint was unchanged.
- `e2e-smoke`: 17 PASS. `plugin:smoke` (Claude Code 2.1.286) passes every check at the new stamp; a fresh clone installs `0.1.0-dev+bcb7e05066a7`.

Before the fix, at `e800683`, the same gate gave 3146 tests with 3145 passing (the same failure), tier-contract 63/63, `e2e-smoke` 17 PASS, and `plugin:smoke` (Claude Code 2.1.286) with all checks passing.

**User path.** The integration pass's acceptance drivers (s1–s6) were re-run on the final code, together with a new `s7-rounds` driver for the review-round behaviour: 165 of 165 checks pass (21-VERIFICATION §4). Where a review round deliberately changed the behaviour, the expectation was updated, and 21-VERIFICATION §4 names each change and the round that made it. These are consent recorded in the data dir, the non-breaking space after a locator label, the goldens normalisation and the "Works Cited" heading, the three-place skill search line, the service's own reason in an unavailable score, and tectonic `--only-cached`. The one product defect the re-run found, the unbounded plagiarism back-off, is described above. Every other failure in the first run was an expectation the review rounds had changed.

**Requirements.** 21 of 22 are Complete and ticked in REQUIREMENTS.md, and the Coverage line now reads 125 Complete. EXP-09 stays Pending (partial), with its CI-compile bullet handed to HARDEN-04; that hand-off is also noted on HARDEN-04's acceptance. All 8 ROADMAP success criteria are met. The ROADMAP Phase 21 box stays unticked because EXP-09 is open; the progress row, the phase's Plans/Status lines and the footer are updated. STATE.md records the closed phase. The Phase 21 pending todos (the EXP-04 note style, the DONE-RECORD inheritance and the Phase 19 EXP-03 follow-ups) are closed, and the EXP-09 CI leg, the 23b merge and the keyed detector runs are added.

**Follow-ups for later phases:**
- **HARDEN-04 (Phase 26).** EXP-09's CI compile: a TeX engine on the three legs, a warmed tectonic bundle cache, and `PENSMITH_REQUIRE_TEX=1`.
- **CI-06.** The first CI run of this code on macOS and Windows, with the pandoc-dependent suites.
- **HARDEN-02 / maintainer.** Keyed GPTZero, Originality.ai (Enterprise) and Sapling scores.
- **BRDTH-02 (Phase 25).** Stripping image metadata on embed. The scanner already refuses it.
- **Phase 23b merge.** Follow §4, the round 1–3 merge notes and the close-out note above.
- **Phase 22.** It rebuilds compile and export outputs after a revision. The router's staleness rules (COMPILE-INPUTS v3, DONE-RECORD v4, `FINAL.rejected.md`, `EXPORT.refused.md`) are the inputs it must keep current.
