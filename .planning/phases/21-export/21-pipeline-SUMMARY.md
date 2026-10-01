# Phase 21 — stream `pipeline` summary

Branch `v1/p21-pipeline`, from the plan commit `25e5311`. Requirements EXP-03
(resolution), EXP-05 (compile), EXP-10..EXP-21; carry-overs 1 (style
precedence) and 6 (draft mode: DONE-RECORD kept current). Decisions
D-21-13..D-21-24, D-21-26, D-21-27 (21-CONTEXT.md); tasks 21-PLAN §5.2 1–16.

## What changed

### compile (EXP-05, EXP-10..EXP-13)

- **Title and headings (EXP-05, D-21-13).** `bin/lib/compile.ts` writes
  `# <title>` (OUTLINE.md's H1, else the brief's title — `compile-inputs.ts`
  `compilePaperTitle`) and `## <section title>` per section in outline order. A
  draft's leading heading that repeats its title is dropped
  (`dropDuplicateTitleHeading`). The headings are text no section gate judged,
  so a title that is empty, spans lines or holds a citation, a direct quote, an
  identifier or an unparseable/unsupported form is refused naming the fix
  (`headingProblem`). COMPILE-INPUTS **v3** (`headings_sha256`;
  `migrations/compile-inputs/v2_to_v3.ts`): the router and done treat a
  headings change as stale; `currentHeadings` is total (an unparseable outline
  hashes as empty headings, so the router never throws).
- **One rewrite guard (EXP-10, D-21-14).** `bin/lib/rewrite-guard.ts`:
  `maskForRewrite` (every citation → `{{cite_K_M}}`, every Pass-3 quote →
  `{{quote_K_M}}`), `unmaskRewrite`, `validateRewrite` (placeholder multiset,
  headings byte-identical, only the allowed paragraphs changed, no unknown
  placeholder, then `compareRewrite`), `compareRewrite` (headings, every citation
  as written + cited-key multisets, every quote with its attribution,
  `boundaryAdditions`), `modelStepSkipReason`. `boundaryAdditions` moved here
  (re-exported from compile.ts). Tier 2 smooths through `complete()` with the
  `smoother` prompt (N−1 calls, cost cap before each); a rejected boundary
  keeps the raw text with the reason; an accepted reply identical to the
  window is `unchanged`, not `smoothed`. Skip reasons: `--no-smooth`, `--raw`,
  `config`, `no LLM`, `dry-run`, `offline`, `no model configured`.
- **Contradictions (EXP-11, D-21-15).** New prompt slug `claim-consistency`
  (`plugin/templates/prompts/claim-consistency.md`, `inputs: [pairs]`, fenced;
  sha256 `0b62ae20…4231` pinned in `EXPECTED_PROMPT_HASHES` and
  `tests/repo-files.test.ts`), `PROMPT_INPUTS`, zod contract + structured stub,
  judgment tier. `bin/lib/claim-consistency.ts`: claims from each plan's
  `## Claims` and the drafts' claim sentences (Pass 4's lexicon, deduped by
  containment), cross-section pairs ranked by shared content terms, the
  negation/direction heuristic (the offline floor), the cap
  (`[compile] contradiction_pairs`, default 20), and the reply counting rules
  (model CONTRADICTS + unjudged heuristic flags; heuristic pairs the model
  cleared listed with rationale; UNCLEAR listed, not counted).
- **Density (EXP-12, D-21-16).** `citation-density.ts` `resolveDensityBand`:
  the discipline preset's band, overridden by `[verification]
  citation_density_min/max`, and `--discipline` overrides both; the report
  names the discipline and the band with their sources.
- **COMPILE-REPORT (EXP-13, D-21-17).** Transitions with status, reason and
  before/after text; Advisory Findings from each section's VERIFICATION.md
  (the Pass-2 reader moved to `bin/lib/done-gate.ts`, fail-safe kept; a section
  whose Pass 2 did not judge its current draft says so); new 8th section
  `## Contradictions`; frontmatter `title`; `ADVISORY_EMPTY_MARKER` ("Phase 5
  will populate") deleted. `git grep 'Phase 5 will populate' bin` is empty.

### done (EXP-03, EXP-14..EXP-21)

- **Flags and aliases (EXP-21, D-21-23).** `bin/cli/done.ts`: `--format
  md|docx|pdf|latex|tex` (`parseDoneFormat`), `--style`, `--raw`,
  `--no-verify` (skips only the whole-paper Pass 4, with a stderr warning),
  `--no-score`, `--no-plagiarism-check`, `--only export|humanize|score|plagiarism`
  (`parseDoneOnly`); `checkDoneFlags` refuses `--no-verify --raw` without
  `--yolo` (PRD §7.9) and an `--only` step its own skip flag cancels — all
  EXIT_USAGE before anything is read. `bin/lib/verbs.ts` `VERB_ALIASES` is now
  alias → `{ verb, args }` (`export`/`humanize`/`score`/`plagiarism` → `done
  --only <step>`), `expandVerbAlias`, `verbAlias`; `bin/pensmith.ts`
  `rewriteVerbAlias` runs before `validateArgv` (an alias given `--only` again
  is EXIT_USAGE). `pensmith --help` and every verb's help list the aliases;
  `UX02_VERBS` stays 16, no workflow file added.
- **Style (EXP-03, D-21-24, D-21-07).** `bin/lib/export-style.ts`
  `resolveExportStyle(paperRoot, flag?)`: `--style` > config.toml `[project]
  citation_style` > the intake brief > the discipline preset (through
  `resolveDiscipline`), a bundled key or a validated absolute `.csl` path
  (`validateCslFile`: well-formed XML, CSL 1.0 namespace and version, `<style
  class="in-text|note">`, `<citation>` + `<bibliography>`, no
  `independent-parent`; ≤ 2 MB). done prints `style: <name> (from <source>)`
  and passes the key/path to `exportDraft`.
- **Humanizer (EXP-14, D-21-18).** `paths.ts` `humanizerSkillPath` (under a
  test context only a home inside `os.tmpdir()` counts);
  `ecosystem-presence.ts` / the doctor probe check the SKILL.md file.
  `bin/lib/humanizer.ts`: `loadHumanizerSkill`, `humanizerContract` (the
  `## Contract` section of the new pinned `references/humanizer-contract.md`),
  `humanizerRequest`, `splitDraftSections`/`joinDraftSections`,
  `humanizeDraft` (one `##` section at a time; title and headings never sent;
  every reply through `validateRewrite`; the model call injected — the module
  never imports the transport) and `acceptHumanized` (the ONE acceptance
  function: `compareRewrite` over the whole text + `citedKeySetChange` +
  `recomputeExportGate`). Model slug `humanizer` (verb done, generation tier,
  `template: false` — S-06; `SlugSpec.template` is new). Mock text stub
  (`text-stubs.json` `humanizer`: a fixed replacement table, else the
  `Put simply:` prefix; placeholders, headings, block quotes kept). done:
  rejection → EXIT_BLOCKED with every reason, no export, FINAL.md untouched,
  `--raw` named; provider failure → `humanizer failed: <reason>` and the
  compiled draft exported; fatal errors (cost cap, exit 5) propagate. Skip
  lines: skill missing (`humanizer skill not found at
  ~/.claude/skills/humanizer/SKILL.md — skipping`), `[humanizer] enabled =
  false`, `--raw`, no LLM, dry-run, offline, no model configured. done no
  longer imports `runHumanizer`; the `no Task transport` banner is gone from
  done (the exporter block itself is the integration pass's deletion).
- **FINAL.md + DONE-RECORD (EXP-15, D-21-19).** FINAL.md is written once per
  successful run, after the export and the paper VERIFICATION.md; the
  put-back path is removed. `writeDoneRecord` unchanged (`humanized` is true
  only when the exported text is the accepted humanized one). `--only
  humanize` writes FINAL.md + record without exporting; `--only export`
  re-gates a current FINAL.md through `acceptHumanized` and exports it, else
  exports DRAFT.md and writes FINAL.md + record as a raw done does. Exports
  are always named `DRAFT.<ext>`.
- **Honesty (EXP-16..EXP-18, D-21-20, D-21-21).** `bin/lib/honesty.ts`
  rewritten: `measureHonesty(text, { paperRoot, backend, yolo, noScore,
  consentGranted })` → a score with ISO time, or one exact reason;
  `honestyLine`, `renderHonestySection(before, after)`; consent via
  `[humanizer] honesty_consent` (config v4), the backend-neutral
  `detector-consent` gate (label = `GATES` / PRD §7.20 row), the answer
  recorded through `updatePaperConfig`; `--yolo` never answers; non-TTY
  without a recorded answer sends nothing. Adapters (all through `http.ts`,
  key only in a header): GPTZero (`x-api-key`, `documents[0].class_probabilities.ai`),
  Originality.ai (`POST /api/v3/scan`, `X-OAI-API-KEY`, AI-only, `storeScan:
  false`, `results.ai.confidence.AI` — docs.originality.ai, fetched
  2026-10-01), Sapling (`POST /api/v1/aidetect`, `Authorization: Bearer`,
  `score` — sapling.ai/docs, fetched 2026-10-01). 401/403 → `unavailable
  (<Backend> rejected the API key)`, 429 (after http.ts's retries, or
  `RateLimitExhaustedError`) → `unavailable (rate limited)`. The disclosure
  sections for all three are in `references/honesty-framing.md` (re-pinned,
  transparency-only). `notImplementedBackend`, `renderHonestyReport` and
  `GptzeroScoringOptions` are gone; `scoreHonesty`, `scoreHonestyWithOptions`,
  `selectBackend`, `GPTZERO_MAX_BYTES`, `__truncateForGptzeroTest` kept. doctor
  reports `GPTZERO_API_KEY`, `ORIGINALITY_API_KEY`, `SAPLING_API_KEY` as
  present/absent.
- **Plagiarism (EXP-19, EXP-20, D-21-22).** `plugin/templates/wordfreq/`:
  `scowl-tiers.txt` (59,537 words, SCOWL size levels 10–50 from npm
  `wordlist-english@1.2.1`), `COPYRIGHT-SCOWL.txt`, `README.md`; credited in
  README. `bin/lib/plagiarism.ts` rewritten: body-paragraph 6–10-word windows
  ranked by rarity (`wordRarity`), one per paragraph round-robin across
  sections in paper order up to `plagiarism_max_phrases` (default 30;
  `selectPlagiarismPhrases`), quoted queries (`ddgQueryUrl`), verbatim matching
  (`normalizeForMatch`, `isVerbatimMatch`, title or snippet, `<b>` stripped),
  `decodeDdgLink` (`/l/?uddg=`), `isDdgChallenge` (a bot challenge is an error
  per phrase, never "no match"), locations (`§<id> paragraph <k>`), skip lines.
- **Cost (D-21-27).** `estimator.ts` `compileCallsFor` (N−1 smoother + 1
  claim-consistency, honouring `[compile]`) and `humanizerCallsFor` (one per
  section when the skill is installed and enabled); `compile --estimate` is
  priced.

### Docs

`plugin/workflows/compile.md`, `plugin/workflows/done.md` (flags, `--only`,
aliases, humanizer, honesty and consent, plagiarism, FINAL.md; the export
stream appends its two subsections), PRD §5.3, §7.8, §7.9 (title, order and
Flags bullet), §7.10, §7.11, §7.17, §7.20 row, §10; README (compile and done
rows, a "Finishing a paper" section with the plagiarism "basic check, not a
substitute" wording, the detector keys, the offline row, SCOWL credit);
CLAUDE.md (verb aliases, COMPILE-INPUTS v3, the Compile / done and Prompts
paragraphs, the honest-framing and humanizer lines); docs/PLUMBING.md and the
compile/done skills' `argument-hint`; PRIVACY.md and docs/SOURCES.md (the three
detectors as data recipients, their keys and headers, the humanizer's data
flow through the configured model provider); `pensmith --help` (aliases,
detector keys, an accurate PENSMITH_OFFLINE line).

### Config v4 (D-21-26)

`[humanizer] honesty_consent`, `[compile] smooth_transitions` / 
`contradiction_pairs`, `[verification] plagiarism_max_phrases`,
`[project] citation_style` accepting a `.csl` path; `honesty_backend` errors
list the three backends; `migrations/config/v3_to_v4.ts`; PRD §10 block.

## Merge notes for Phase 23b

Every changed or added exported signature (bases kept unless noted):

- `bin/lib/done-gate.ts` (new; moved from done.ts and re-exported there):
  `doneSections`, `runExportBlockingGate`, `exportAcceptanceSets`,
  `recomputeExportGate(paperRoot, text, { sections?, bib?, recheck? })`,
  `sectionQuoteIndex`, `citedKeySetChange(humanized, draft)`,
  `readUnsupportedClaims`, `unjudgedClaimSections`, `unjudgedLine`,
  `readSectionAdvisory(paperRoot, section): SectionAdvisory`, types
  `ExportBlock`, `DoneSection`, `UnsupportedClaim`, `UnjudgedSection`,
  `SectionAdvisory`.
- `bin/lib/rewrite-guard.ts` (new): `RewriteMask`, `MaskOptions`,
  `maskForRewrite(text, { namespace?, quoteMinWords? })`,
  `unmaskRewrite(text, mask)`, `headingLines`, `boundaryAdditions` (moved from
  compile.ts, still re-exported there), `compareRewrite(original, rewritten, {
  quoteMinWords? }): string[]`, `ValidateRewriteInput { original, mask,
  rewritten, allowedParagraphs?, quoteMinWords? }`, `RewriteVerdict { ok,
  text, reasons }`, `validateRewrite`, `modelStepSkipReason(paperRoot)`.
- `bin/lib/claim-consistency.ts` (new): `ClaimSource`, `ClaimSentence`,
  `HeuristicFlag`, `ConsistencyPair`, `ConsistencyVerdict`,
  `ContradictionReport`, `contentTerms`, `contradictionHeuristic(a, b)`,
  `collectClaims`, `consistencyCandidates(claims, { maxPairs }) → { pairs, sent }`,
  `consistencyRequest(pairs)` (a `buildPromptRequest('claim-consistency', …)`),
  `applyConsistencyReply({ pairs, sent, verdicts, cap, skipped })`.
- `bin/lib/humanizer.ts` (new): `HUMANIZER_SLUG`, `HUMANIZER_SKILL_DISPLAY`,
  `HumanizerRequest`, `HumanizerSkill`, `loadHumanizerSkill()`,
  `humanizerContract()`, `humanizerRequest(skill, masked, voice)`,
  `DraftSection`, `splitDraftSections`, `joinDraftSections`, `HumanizeInput {
  draft, skill, preserveVoice?, quoteMinWords?, call(req, i) }`,
  `HumanizeResult { text, sectionsSent, rejected }`, `humanizeDraft`,
  `AcceptInput { paperRoot, draft, humanized, sections?, bib?, quoteMinWords? }`,
  `AcceptResult { ok, reasons, gate }`, `acceptHumanized` — the function
  PLUG-10's humanizer submission must call.
- `bin/lib/export-style.ts` (new): `ExportStyleSource`, `ExportStyle { style,
  source, name, from, cslClass? }`, `CSL_MAX_BYTES`, `exportStyleChoices()`,
  `CslValidation`, `validateCslFile(file)`, `resolveExportStyle(paperRoot, flag?)`.
- `bin/lib/compile.ts`: `RunCompileOpts` adds `smoothSkip?`, `judgeConsistency?`,
  `consistencySkip?`, `isFatal?` (`smoothBoundary` kept); `CompileResult` adds
  `transitions`, `smoothingSkipped`, `contradictions`, `title`; new
  `dropDuplicateTitleHeading`, `headingProblem`.
- `bin/lib/compile-report.ts`: `TransitionEntry.status` adds `'unchanged'`,
  fields `reason?`, `before?`, `after?`; `CompileReportInput` adds
  `smoothing_skipped?`, `advisory?`, `contradictions?`; `ADVISORY_EMPTY_MARKER`
  deleted, `ADVISORY_NO_SECTIONS_MARKER` added; `readReportContradictions`;
  `citationDensityForReport(r, { discipline, band })`.
- `bin/lib/compile-inputs.ts`: `CompileHeadings`, `headingsSha256`,
  `compilePaperTitle`, `currentHeadings`; `writeCompileInputs` takes an
  optional `headingsSha256`; COMPILE-INPUTS schema v3.
- `bin/lib/citation-density.ts`: `DisciplineLayer`, `DensityResolution`,
  `resolveDensityBand`; `computeCitationDensity` opts `band?`.
- `bin/lib/honesty.ts`: see above — `measureHonesty`, `HonestyOutcome`,
  `HonestyNotApplicable`, `HonestyOptions`, `honestyLine`,
  `renderHonestySection`, `honestyFramingNote`, `disclosureLine`,
  `configuredBackend`, `backendLabel`, `DETECTOR_KEY_VARS`,
  `NO_CONSENT_REASON`, `HonestyBackendName`; **removed** `renderHonestyReport`,
  `GptzeroScoringOptions` (a Tier-1 score submission should call
  `measureHonesty(text, { paperRoot, consentGranted })` after AskUserQuestion).
- `bin/lib/plagiarism.ts`: `PlagiarismResult` adds `location?`, `error?`;
  `PlagiarismMatch` adds `title?`, `snippet?`; `runPlagiarism(draft, {
  maxPhrases?, sectionIds? })` (was positional options); new
  `selectPlagiarismPhrases`, `wordRarity`, `PHRASE_MIN_WORDS/MAX`,
  `ddgQueryUrl`, `decodeDdgLink`, `isDdgChallenge`, `normalizeForMatch`,
  `isVerbatimMatch`, `locationLabel`; `renderPlagiarismSection(results, {
  skipped? })`; `extractDistinctivePhrases` kept as a compat wrapper (6–10
  words now).
- `bin/lib/verbs.ts`: **`VERB_ALIASES: Record<string, VerbAlias>`** (was
  `Record<string, Ux02Verb>`), `VerbAlias { verb, args }`, `verbAlias`,
  `expandVerbAlias(argv, at)`; `canonicalVerb` unchanged in behaviour.
  `bin/pensmith.ts` exports `rewriteVerbAlias(argv)`.
- `bin/cli/done.ts` (new exports): `DoneStep`, `DONE_ONLY_STEPS`,
  `DONE_FORMAT_CHOICES`, `NO_VERIFY_RAW_REFUSAL`, `parseDoneFormat`,
  `parseDoneOnly`, `DoneFlags`, `checkDoneFlags(args)`, `HumanizeStep`,
  `runHumanizeStep({ paperRoot, draft, raw, sections, bib, sectionIds? })`,
  `plagiarismSkipReason(paperRoot, noPlagiarismCheck)`;
  `PaperVerificationReport` adds `plagiarismSkipped?`, `pass4Skipped?`.
  Kept: `collectGateIssues`, `runDoneGate`, `runWholePaperPass4`,
  `buildVerificationReport`, `recheckUnknownRetractions`, `ClaimDecision`,
  `RetractionRecheck` and every done-gate re-export. done's args are now
  `yolo, format, style, raw, verify, score, 'plagiarism-check', only`.
- `bin/lib/llm-models.ts`: `SlugSpec.template: boolean`; slugs
  `claim-consistency` (judgment, structured) and `humanizer` (generation,
  `template: false`). `llm-contracts.ts`: `ClaimConsistencySchema`,
  `ClaimConsistency`. `prompt-request.ts` `PROMPT_INPUTS['claim-consistency']`.
- `bin/lib/estimator.ts`: `compileCallsFor`, `humanizerCallsFor`.
- `bin/lib/paths.ts`: `humanizerSkillPath(env?)`. `gates.ts`: the
  `detector-consent` label is backend-neutral.
- `bin/lib/schemas/config.ts`: `HONESTY_BACKENDS`, `DEFAULT_CONTRADICTION_PAIRS`,
  `DEFAULT_PLAGIARISM_MAX_PHRASES`, `isCslPathSpelling`, `CompileSchema`;
  `CURRENT_CONFIG_VERSION = 4`.
- `plugin/skills/{compile,done}/SKILL.md`: only the `argument-hint` lines
  changed (tests/plumbing-args.test.ts holds them to the verbs' options). No
  file under `mcp/` changed.

## Tests updated, and why

- `honesty.test.ts` — rewritten: Phase-6 skip guards and the
  `notImplementedBackend` / `renderHonestyReport` assertions replaced by the
  real adapters (V5 MockAgent, test lane): 61 %/37 % with ISO times and the
  verbatim note, every absent-score reason, consent from config (one request)
  and never from `--yolo` (zero), Sapling and Originality shapes, the size cap.
- `humanizer-wrap.test.ts`, `humanizer-task.test.ts` — the Task-transport seam
  and `runHumanizer` are replaced by `humanizer.ts`; the wrap test covers the
  module in process, the task test the built CLI with the mock LLM and the
  fixture skill (every outcome on one paper, EXP-15's second done included).
- `done-final-gate.test.ts` — the injected FINAL.md is replaced by
  `acceptHumanized` over every forbidden form; the "put back" message becomes
  byte assertions on FINAL.md (D-21-19).
- `done-final-record.test.ts`, `done-terminal.test.ts` — header comments only
  (no Task transport any more).
- `plagiarism.test.ts` — first-10-windows extraction and any-hit matching are
  replaced (quoted queries, verbatim matches, locations, uddg, challenge).
- `show-prompts.test.ts` — the DDG query is now the quoted phrase.
- `unknown-verb.test.ts` — the Phase-17 "alias table is empty" check becomes
  "the four done sub-step aliases"; the dynamic alias uses `{ verb, args }`.
- `plumbing-args.test.ts` — the `--format` check reads `parseDoneFormat`
  instead of the Phase-6 description string (`tex` added).
- `estimate-proceed.test.ts` — compile now makes model calls (2 for two
  sections; "no model calls" with both steps off); a new §15 case with the
  skill installed.
- `bom-draft-cli.test.ts` — compile writes `## <title>` and drops the
  BOM-prefixed duplicate `# Mirrors` heading (EXP-05).
- `e2e-chain.test.ts` — the density line now names the discipline's source
  (`Discipline: computer-science (from …) · band`, EXP-12).
- `compile-pipeline.test.ts` — also asserts an accepted reply identical to the
  window is `unchanged`, not `smoothed`.
- The fixture skill is `tests/fixtures/humanizer-skill/humanizer-skill.md`
  (installed as `SKILL.md` in the temp home): a tracked file named `SKILL.md`
  outside `plugin/` fails PLUG-02's layout test, which keeps no exemption for it.
- `compile-recompute`, `compile-report-schema`, `citation-density`,
  `prompt-layout`, `llm-models`, `prompt-cache`, `config`, `repo-files`,
  `helpers/paper-cli-harness.ts` (v3 record), `helpers/e2e-chain.ts` (drops
  the two new detector keys; sets USERPROFILE) — config v4, COMPILE-INPUTS v3,
  the new slug and the template-free humanizer slug.
- New: `compile-pipeline`, `rewrite-guard`, `claim-consistency`, `config-v4`, `humanizer-stub`,
  `done-gate-advisory`, `done-flags`, `done-honesty`, `export-style`,
  `honesty-consent` (+ `helpers/honesty-consent-child.ts`),
  `helpers/pipeline-paper.ts`; fixtures `tests/fixtures/humanizer-skill/`,
  `tests/fixtures/contradictions/`, `tests/fixtures/cassettes/synthetic/duckduckgo/{results-page,challenge-page}.json`.

## User-path evidence (built CLI, `scratchpad/p21/pipeline/`)

`ev/` — a 3-section paper, the mock LLM on 127.0.0.1:18321 named in the global
runtime.json of an isolated data dir, the fixture skill in the isolated HOME,
`PENSMITH_OFFLINE=1` (recorded Crossref fixtures), pandoc 3.9 on PATH
(`evidence1.sh` → `evidence1.log`):

- `verify 1..3` → verified; `compile --yolo` → `# Deep Learning and
  Measurement` + three `## …` headings; both boundaries went through the
  smoother (the standalone mock's default reply returns the window as it was,
  reported `boundary 1→2: unchanged (the model returned the boundary text as
  it was)`; a changed, placeholder-preserving reply is `smoothed` and a
  citation-dropping one `rejected (citation set changed)` — compile-pipeline
  tests, scripted mock); `Contradictions flagged: 0 (target 0)`; density
  `computer-science (from INTAKE.md) · band 1–3 (from computer-science
  preset)`; Advisory Findings list each section's Pass-2 rows.
- flag errors exit 2 before anything runs (`--no-verify --raw`, `--format
  html`, `--style bogus`, `export --only score`).
- `score` → `skipped (no GPTZERO_API_KEY set)` + the note; `plagiarism` →
  `plagiarism check skipped (offline)`; both write nothing.
- `done --yolo --format md` → `style: apa (from INTAKE.md)` (an "APA"
  computer-science intake, not IEEE), the humanizer accepted, FINAL.md the
  humanized text with every citation, `DONE-RECORD.json` `humanized: true`,
  VERIFICATION.md `Text checked: .paper/FINAL.md`, the export in APA
  author-date with References.
- `export --format docx --yolo --style mla` → `style: mla (from --style)`,
  `export/DRAFT.docx` (pandoc). `done --yolo --raw --format tex
  --no-plagiarism-check --no-score` → `humanizer skipped (--raw)`, `skipped
  (--no-score)`, `N/A (humanize skipped with --raw)`, `export/DRAFT.tex`.
  `humanize` → FINAL.md + record, no export.
- `doctor` → `GPTZERO_API_KEY present, ORIGINALITY_API_KEY absent,
  SAPLING_API_KEY absent` (booleans only).
- `evidence2.sh` → `evidence2.log`: with the skill moved away, `done --yolo`
  prints `humanizer skill not found at ~/.claude/skills/humanizer/SKILL.md —
  skipping`, exits 0, `after humanize: N/A (humanizer not installed)`, FINAL.md
  = DRAFT.md. With §2's draft edited after verification, `humanize`, `score`,
  `plagiarism` and `export` each exit 4 at the blocking gate naming §2 (stale)
  before anything else. (A `--dry-run` on this paper refuses at compile, by
  design: its real DOIs are UNVERIFIABLE-NETWORK under `--dry-run`; the dry-run
  skip lines are covered by `compile-pipeline`'s dry-run chain on the synthetic
  corpus.)
- `--estimate` (`estimate/estimate-with-skill.txt`): the PRD §15 paper
  (1,500 words, 3 sections) with the humanizer skill installed projects
  **$2.83** of the $5.00 cap (43 % under): compile 3 calls $0.51 (2 smoother +
  1 claim-consistency), done 18 calls $0.43 (3 humanizer + 15 Pass-4 audits).
  No `max_tokens`/p90 tuning was needed.
- In process (test lane, `tests/done-honesty.test.ts`): done with GPTZero
  answering 0.61 then 0.37 prints and records `61% AI-generated (gptzero,
  <ISO>)` / `37% …`, Crossref answered from the recorded cassettes, the
  humanizer through the mock LLM, DuckDuckGo with the synthetic page (0
  verbatim matches).
- **Live plagiarism lane** (`live_plagiarism.sh` → `live-plagiarism.log`,
  2026-10-01T03:56Z): a 5-section paper with the opening of A Tale of Two
  Cities in §4. DuckDuckGo answered **every** query from this environment with
  its bot challenge (HTTP 202, "Unfortunately, bots use DuckDuckGo too."), so
  the Dickens passage could not be found live here; the product reported
  `DuckDuckGo refused the query (its bot challenge) — retry later` for each
  phrase with its location (`§4 paragraph 1 | "of foolishness it was the epoch
  of belief"`) instead of "no match". The scrubbed challenge page is the
  `challenge-page.json` fixture. A live run from an unblocked network is a
  maintainer item.

## Verification (2026-10-01, Node 22.22.2, as root in the cloud container)

- `npm run prebuild && npm run lint && npm run typecheck && npm run build &&
  npm run validate:manifests` — all exit 0 (lint and typecheck re-run on the
  final source).
- `node_modules` was a symlink into the main checkout; it was replaced by a
  local `npm ci` before bundling (CLAUDE.md). `npm run bundle` re-stamped
  `plugin.json` to `0.1.0-dev+020fb9c18760`; `npm run bundle:check` — see
  below.
- `LANG=C.UTF-8 CI=true npm test` with pandoc 3.9 on PATH, run 1 (at
  `5fbec84`…`ba99da7` + docs): 3013 tests, 3008 pass, 5 fail — the root-only
  `atomicWriteFile preserves OLD content` case (expected as root) and four this
  stream then fixed: the BOM compile test and the e2e chain's density regex
  (both asserted the pre-EXP-05/EXP-12 output), `cassette-no-leak` (the
  challenge fixture held DuckDuckGo's feedback address — scrubbed) and
  PLUG-02's layout test (the fixture skill was named `SKILL.md` — renamed).
  The affected files re-run green against a rebuilt CLI (30/30).
- Run 2 (at `5c15edb`, the final source but the doctor-wording commit
  `ee5c9f0`, whose doctor tests re-ran green after a rebuild): 3013 tests,
  **3012 pass, 1 fail — only the root-only atomic-write case**; the data-dir
  fingerprint check reported no change. (`humanizer-stub.test.ts`, added during
  the run, passes on its own: 2/2.)
- `npm run test:tier-contract`: 63/63 pass.
- `npm run bundle:check`: "plugin/dist and the plugin version match what is
  committed"; `npm run validate:manifests`: exit 0.
- Stream tests (all green individually): compile-pipeline, rewrite-guard,
  claim-consistency, config-v4, done-gate-advisory, done-flags, done-honesty,
  done-final-gate, export-style, honesty, honesty-consent, humanizer-wrap,
  humanizer-task, humanizer-stub, plagiarism, estimate-proceed, plumbing-args,
  unknown-verb, show-prompts.
- Not run here: `npm run test:coverage`, `scripts/e2e-smoke.mjs`,
  `plugin:smoke` and the Node 24 gate (integration pass, 21-PLAN §7.5).

## Open items / for the integrator

- **exporter.ts (export stream):** delete `runHumanizer`, `TaskRunner`,
  `__setTaskRunnerForTest` and the `isHumanizerSkillPresent` import (21-PLAN
  §7.3); then tighten `tests/humanizer-task.test.ts`'s last case to grep all of
  `bin mcp hooks plugin`. A `.csl` path (`ExportStyle.style` absolute) must
  render through `exportDraft` (the base exporter here only looks up bundled
  keys) — the `--style ./custom.csl` end-to-end check is §7.4.
- **done.ts outline hook (export stream):** move it after `checkDoneFlags` and
  `resolveExportStyle`, pass `style.style` to `runOutlineDone` (21-PLAN §7.2).
- **status-view.ts (export-owned):** its prompt-cache cell would call the
  template-free `humanizer` slug's missing template a failed hash check; use
  `SlugSpec.template === false` to show `n/a (no template)`.
- **http-mock.ts offline banner** (not owned): "sources, verification,
  detector and plagiarism results are recorded fixtures" has been inaccurate
  since RUN-03 for the detector and plagiarism (they are skipped offline, never
  replayed); `tests/net-mode.test.ts` pins the string. README, `pensmith
  --help` and the doctor `network-mode` probe (owned here) now say it correctly.
- The §7.4 cross-stream check `pensmith export --format docx` without pandoc
  (the export stream's built-in writer) is not covered here: this branch's
  base exporter falls back to markdown without pandoc; the evidence above ran
  with pandoc 3.9 on PATH.
- Keyed live detector runs (GPTZero, Originality.ai, Sapling) and the live
  plagiarism lane from an unblocked network are maintainer items (D-21-29).
