---
phase: 21-export
verified: 2026-10-01
verified_at_commit: c1eb302 (code); this file adds .planning only
status: passed (integration); the closer still updates ROADMAP.md, REQUIREMENTS.md and STATE.md
score: 22/22 requirements met on the user path (EXP-01..21, GRND-11) — 150 of 150 acceptance checks pass
caveats: [no CI run has exercised Phase 21 code on macOS / Windows (CI-06); keyed live GPTZero / Originality.ai / Sapling scores are maintainer items (no keys here — GPTZero's real 401 on a dummy key was observed live); TeX compilation is local evidence only until HARDEN-04 (Phase 26) makes it a required CI step]
---

# Phase 21: Compile, Done and Export (EXPORT): Verification (integration pass)

**Goal (ROADMAP):**
- compile produces a smoothed, checked, correctly cited paper with a title and section headings;
- done humanizes for real, scores honestly with explicit, persisted detector consent, runs a real plagiarism check, and exports every requested format — with or without pandoc — in the paper's citation style with zero trace;
- outline-only mode ends in a re-verified, zero-trace sourced outline and annotated bibliography.

**Result: met.**
- **Integration.** The two streams were merged and the integration hand-offs done (21-SUMMARY §2).
- **Gate.** Green (§1). The one failing test is the root-only atomic-write case.
- **Acceptance.** Every §9 acceptance check of 21-PLAN was run on the built CLI in scratch folders (§2), and all 150 individual checks pass. The runs took place outside any test context:
  - The workspace's global `runtime.json` names the RUN-21 mock LLM.
  - Sources replay recorded fixtures (`PENSMITH_OFFLINE=1`), except the live checks, which say so.
  - `PATH` is chosen per check: pandoc 3.9, pandoc and tectonic only, or no tools at all.
- **Defect found and fixed.** The acceptance run found one product defect, which is now fixed and tested: every scrubbed docx carried stray `docProps/` and `_rels/` folder entries (21-SUMMARY §2.10).

## 1. Gate (Linux, as root, pandoc 3.9 on PATH, LANG=C.UTF-8, CI=true)

| Step | Result |
|---|---|
| `npm run prebuild`, `npm run build` | exit 0; `git status --porcelain` empty after the build |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run validate:manifests` | exit 0 (`plugin/ (plugin.json, hooks.json, 8 skills, 16 workflow bodies) + marketplace.json + .mcp.json valid`) |
| `npm run bundle:check` | exit 0 (`plugin/dist and the plugin version match what is committed`; plugin version `0.1.0-dev+3e786fc7d7e1`) |
| `npm run test:tier-contract` | exit 0: **63/63 pass** |
| `node scripts/e2e-smoke.mjs` | exit 0: **PASS=17, FINDING=0, FAIL=0** |
| `CI=true npm test` (Node 22.22.2, at `d937b70`, after the merge and the first integration fixes) | **3081 tests: 3080 pass, 1 fail**, 0 skipped, 0 todo (909 s). The failure is `tests/atomic-write.test.ts` "preserves OLD content on rename/write failure", which is root-only (`chmod 0o500` does not stop root; CLAUDE.md gotcha). |
| `CI=true npm run test:coverage` (Node 22.22.2, at `c1eb302`, the final code) | **3082 tests: 3081 pass, 1 fail** (the same root-only case), 0 skipped, 0 todo. HARDEN-03: `1000 drafts checked against pandoc 3.9 (seed 1371899446)`. Coverage: **93.65 % lines and statements, 84.58 % branches, 90.05 % functions** (gate 80 / 66). c8 exits 1 only for that one root-only test. No data-dir change was reported. |
| `CI=true npm test` on Node 24.21.0 (at `c1eb302`) | **3082 tests: 3081 pass, 1 fail** (the same root-only atomic-write case), 0 skipped, 0 todo (867 s); HARDEN-03 `1000 drafts checked against pandoc 3.9 (seed 1508434231)` |
| `npm run plugin:smoke` (Claude Code at `/opt/node22/bin/claude`) | exit 0, every check passed: validate --strict (plugin, plugin.json, marketplace), the legacy negative control, a fresh clone installs with no build, 8 skills / 4 hooks / 1 MCP server, `mcp list` connected, 11 tools, the git-marketplace update moves to the new stamp |
| `claude plugin validate plugin` and `--strict` | `√ Validation passed` (both) |
| `tests/latex-standalone.test.ts` with tectonic | covered in §2 (EXP-09): both LaTeX paths compile with tectonic 0.15 and pdflatex through the CLI |

## 2. Acceptance checks (21-PLAN §9) on the built CLI

**Drivers.** `scratchpad/p21/integrate/s{1..6}-*.mts`, through `lib.mts`:
- Each spawns `node dist/bin/pensmith.js` in a project folder of its own, with HOME, USERPROFILE, XDG_DATA_HOME and LOCALAPPDATA inside the workspace, `PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org`, a dummy Anthropic key and no `NODE_TEST_CONTEXT` / `PENSMITH_TEST`.
- Each command, with its stdout, stderr and exit code, is in `EVIDENCE.log`, and each check in `results.jsonl`.

**Independent checkers** (none shares code with pensmith):
- a python RIS reader;
- python zip / zlib byte scans of every docx part and every decompressed PDF stream;
- `pandoc -f docx -t plain` read-back;
- pandoc 3.9 citeproc as the EXP-04 oracle over the same compiled draft;
- tectonic 0.15 and pdflatex compiling both LaTeX paths;
- a real pseudo-terminal for the consent question.

**Sources:**
- **Library.** Built through `pensmith add` for EXP-01 / EXP-02, or seeded with the recorded works lecun2015, aspelmeyer2009 and zhu2020.
- **The PRD §15 and outline-only chains.** These ran from `assignment.txt` over the recorded e2e corpus, with the mock LLM scripted from `tests/fixtures/e2e-corpus/mock-script.json`.

**Live runs** (marked "live" in the table): the real GPTZero and DuckDuckGo, and the real Crossref / Unpaywall / Retraction Watch for the gate. All paper text was synthetic, and the GPTZero key was a dummy.

Notes on individual checks:
- **EXP-04: built-in vs pandoc.** Each style's built-in md export (no pandoc on PATH) was compared with pandoc 3.9's citeproc. pandoc ran over the same compiled DRAFT.md and the paper's bibliography, with the exact inputs the export's pandoc path uses (case-protected CSL JSON). The comparison is after the goldens test's documented normalisation (`tests/citation-goldens.test.ts`), and body, notes and bibliography are equal for all 8 styles. The committed goldens over the fixture paper are checked by `tests/citation-goldens.test.ts`, whose 8 style cases pass in the full suite (§1).
- **EXP-06: pandoc's app.xml statistics.** pandoc's docx keeps its `reference.docx` document statistics in app.xml (Words, Pages, TotalTime …). Every identifying property is blank, which is what EXP-06 means by "core.xml and app.xml blanking is unchanged" (21-SUMMARY §5).
- **EXP-07: the injected scrub failure.** It used a `pandoc` on PATH that answers `--version` and writes a broken .docx, so the real CLI's mandatory scrub fails. The scanner's negative controls were built in process and fed to `scanExportFile`.
- **EXP-16..EXP-20: the test lane.** The MockAgent lane is the suites that own it, re-run here: `tests/done-honesty.test.ts`, `honesty.test.ts` (including EXP-18's Sapling and Originality.ai request shapes and scores), `honesty-consent.test.ts` and `plagiarism.test.ts`.
- **EXP-16..EXP-20: the live lane.**
  - GPTZero answered the dummy key with a rejection, and the line is `unavailable (GPTZero rejected the API key)`.
  - DuckDuckGo answered 4 of 17 quoted queries and refused 13 with its bot challenge; each refusal is reported per query.
  - It found the §4 Bleak House sentence ("Fog up the river where it flows among") verbatim at four quotation sites, with its location (`§4 paragraph 1`). An earlier run during the integration answered 9 of 17 and found the same sentence.
- **EXP-17: consent under a real pty.** In the clack prompt, "Yes" was chosen once, and `[humanizer] honesty_consent = true` was written to config.toml. The second run in a terminal did not ask.

**150 of 150 checks pass.**

### EXP-01 — 7/7 checks pass

| Check | Result | Evidence |
|---|---|---|
| the arXiv preprint is in the library as an arXiv-only entry (eprint, archivePrefix, no journal DOI) | PASS | @misc{vaswani2017, author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N. and Kaiser, Lukasz and Polosukhin, Illia}, title = {Attention Is All You Need} |
| (1) `pensmith compile` leaves .paper/CITATIONS.bib byte-identical | PASS | compile exit 0; sha 81d056faf8ed → 81d056faf8ed |
| (1) the bib still holds the assigned-but-uncited source | PASS | encode2012 assigned to §3, cited nowhere |
| (2) export/CITATIONS.bib holds every cited key — cluster, locator and the arXiv-only preprint — and only those | PASS | aspelmeyer2009, lecun2015, vaswani2017, zhu2020 |
| (4) plan 3 → write 3 → verify 3 → compile → done: the redrafted §3 cites the newly used assigned source and the export includes it | PASS | exits 0,0,0,0,0; §3 cites encode2012: true |
| (4) sections 1, 2, 4 and 5 stay byte- and mtime-identical | PASS |  |
| (3) compiling zero-citation drafts leaves CITATIONS.bib unchanged and a following verify does not crash | PASS | verify exit 4, compile exit 4, verify exit 4; bib unchanged; no stack trace |

### EXP-02 — 7/7 checks pass

| Check | Result | Evidence |
|---|---|---|
| APA renders a multi-cite cluster as one parenthetical | PASS | (Aspelmeyer, 2009; LeCun et al., 2015) |
| APA renders a page locator | PASS | (Zhu et al., 2020, p. 4) / (LeCun et al., 2015, p. 436) |
| the md export has a References section | PASS |  |
| export/CITATIONS.ris holds the same key set as the export bib | PASS | aspelmeyer2009, lecun2015, vaswani2017, zhu2020 |
| the RIS re-imports with an independent parser with the bib's authors and titles | PASS | aspelmeyer2009: JOUR Aspelmeyer, Markus — Measured measurement / lecun2015: JOUR LeCun, Yann — Deep learning / vaswani2017: GEN Vaswani, Ashish — Attention Is All You Need / zhu2020: JOUR Zhu, Na — A Novel Coronavirus from Patients with Pneumonia in China, … |
| --format latex keeps the locator "p. 4" | PASS | Zhu et al., 2020, p. 4) |
| `pensmith add <doi>` updates .paper/CITATIONS.ris | PASS | 5 → 6 records |

### EXP-03 — 16/16 checks pass

| Check | Result | Evidence |
|---|---|---|
| an intake brief with "computer science … Citation style: APA" exports author-date APA, not IEEE | PASS | style: apa (from INTAKE.md) |
| config.toml citation_style = "MLA" overrides the brief | PASS | style: mla (from config.toml [project] citation_style); (Zhu) |
| --style bogus exits 2 listing the valid styles | PASS | pensmith: --style: unknown citation style "bogus" — use one of APA, MLA, Chicago (Notes-Bibliography), Chicago (Author-Date), IEEE, AMA, Vancouver, Harvard (or their keys: apa, mla, chicago-notes-bib, chicago-author-date, ieee, ama, vancouver, harvard), or … |
| --style apa exports (exit 0, "style: apa (from --style)") | PASS |  |
| --style mla exports (exit 0, "style: mla (from --style)") | PASS |  |
| --style chicago-author-date exports (exit 0, "style: chicago-author-date (from --style)") | PASS |  |
| --style chicago-notes-bib exports (exit 0, "style: chicago-notes-bib (from --style)") | PASS |  |
| --style ieee exports (exit 0, "style: ieee (from --style)") | PASS |  |
| --style ama exports (exit 0, "style: ama (from --style)") | PASS |  |
| --style vancouver exports (exit 0, "style: vancouver (from --style)") | PASS |  |
| --style harvard exports (exit 0, "style: harvard (from --style)") | PASS |  |
| --style ./my-style.csl renders on the built-in path (md, no pandoc) | PASS | style: my-style.csl (Angle-Bracket Test Style) (from --style); \<\<Zhu 2020\>\>; ZHU, Na: A Novel Coronavirus from Patients with Pneumonia in China, 2019. |
| --style ./my-style.csl renders in the built-in docx writer | PASS | &lt;&lt;Zhu 2020&gt;&gt; |
| --style ./my-style.csl renders on the pandoc path (docx) | PASS | &lt;&lt;Zhu 2020&gt;&gt; |
| a missing .csl is a usage error (exit 2) naming why | PASS | pensmith: --style: <integrate>/ws/s2-styles/paper/missing.csl cannot be read (ENOENT) |
| the PRD §15 assignment ("… APA style") reaches done and exports author-date APA, not IEEE | PASS | 8 runs; style: apa (from config.toml [project] citation_style); (Cai et al., 2024) |

### EXP-04 — 14/14 checks pass

| Check | Result | Evidence |
|---|---|---|
| apa: the built-in md export equals pandoc 3.9 citeproc (body, notes, bibliography) after the golden normalisation | PASS | Sequencing found the new virus within weeks of the first cases (Zhu, 2020). Deep networks learn layered representations (LeCun et al., 2015). The same sequencing effort recurs in later outbreaks (Zhu, 2020). / Several studies agree that data shape what a model |
| apa: [@k 41] (a bare number) renders as page 41, as pandoc reads it | PASS | 41) |
| mla: the built-in md export equals pandoc 3.9 citeproc (body, notes, bibliography) after the golden normalisation | PASS | Sequencing found the new virus within weeks of the first cases (Zhu). Deep networks learn layered representations (LeCun et al.). The same sequencing effort recurs in later outbreaks (Zhu). / Several studies agree that data shape what a model can learn (LeCun |
| chicago-author-date: the built-in md export equals pandoc 3.9 citeproc (body, notes, bibliography) after the golden normalisation | PASS | Sequencing found the new virus within weeks of the first cases (Zhu 2020). Deep networks learn layered representations (LeCun, Bengio, and Hinton 2015). The same sequencing effort recurs in later outbreaks (Zhu 2020). / Several studies agree that data shape wh |
| chicago-notes-bib: the built-in md export equals pandoc 3.9 citeproc (body, notes, bibliography) after the golden normalisation | PASS | Sequencing found the new virus within weeks of the first cases.[^1] Deep networks learn layered representations.[^2] The same sequencing effort recurs in later outbreaks.[^3] / Several studies agree that data shape what a model can learn.[^4] Measurement limit |
| Chicago notes are footnotes with short subsequent notes and no doubled period | PASS | [^1]: Na Zhu, "A Novel Coronavirus from Patients with Pneumonia in China, 2019," *New England Journal of Medicine*, 2020, https://doi.org/10.1056/NEJMoa2001017. / [^2]: Yann LeCun, Yoshua Bengio, and Geoffrey Hinton, "Deep Learning," *Nature*, 2015, https:/… |
| ieee: the built-in md export equals pandoc 3.9 citeproc (body, notes, bibliography) after the golden normalisation | PASS | Sequencing found the new virus within weeks of the first cases [1]. Deep networks learn layered representations [2]. The same sequencing effort recurs in later outbreaks [1]. / Several studies agree that data shape what a model can learn [2], [3]. Measurement |
| IEEE numbers in first-citation order: [1] [2] [1] [2], [3] | PASS | [1] [2] [1] [2], [3] [2] |
| ieee: [@k 41] (a bare number) renders as page 41, as pandoc reads it | PASS | 41\] |
| ama: the built-in md export equals pandoc 3.9 citeproc (body, notes, bibliography) after the golden normalisation | PASS | Sequencing found the new virus within weeks of the first cases^1^. Deep networks learn layered representations^2^. The same sequencing effort recurs in later outbreaks^1^. / Several studies agree that data shape what a model can learn^2,3^. Measurement limits |
| AMA superscripts (^1^) | PASS | ^1^ ^2^ ^1^ ^2,3^ ^2^ |
| vancouver: the built-in md export equals pandoc 3.9 citeproc (body, notes, bibliography) after the golden normalisation | PASS | Sequencing found the new virus within weeks of the first cases (1). Deep networks learn layered representations (2). The same sequencing effort recurs in later outbreaks (1). / Several studies agree that data shape what a model can learn (2,3). Measurement lim |
| Vancouver numbers as (1) | PASS | (1) (2) (1) (2,3) (3) (3) (2) |
| harvard: the built-in md export equals pandoc 3.9 citeproc (body, notes, bibliography) after the golden normalisation | PASS | Sequencing found the new virus within weeks of the first cases (Zhu, 2020). Deep networks learn layered representations (LeCun, Bengio and Hinton, 2015). The same sequencing effort recurs in later outbreaks (Zhu, 2020). / Several studies agree that data shape |

### EXP-05 — 9/9 checks pass

| Check | Result | Evidence |
|---|---|---|
| the compiled .paper/DRAFT.md starts with "# <title>" and has "## <Section title>" per section in outline order | PASS | # Citations Across Fields / ## Introduction / ## Discussion |
| the pandoc docx uses Heading 1 for the title and Heading 2 for the sections, the title first | PASS | DRAFT.docx — pandoc docx writer; H1 ["Citations Across Fields"]; H2 ["Introduction","Discussion","References"] |
| the built-in docx uses Heading 1 for the title and Heading 2 for the sections, the title first | PASS | DRAFT.docx — built-in docx writer — pandoc not found; H1 ["Citations Across Fields"]; H2 ["Introduction","Discussion","References"] |
| the md export (built-in) starts with the title | PASS | DRAFT.md — built-in Markdown writer; # Citations Across Fields |
| the tex export (pandoc) starts with the title | PASS | DRAFT.tex — pandoc LaTeX writer; \title{Citations Across Fields} |
| the tex export (built-in) starts with the title | PASS | DRAFT.tex — built-in LaTeX writer — pandoc not found; \title{Citations Across Fields} |
| the pdf export (pandoc) starts with the title | PASS | DRAFT.pdf — pandoc PDF writer; Citations Across Fields Introduction Sequencing found the ne |
| the pdf export (built-in) starts with the title | PASS | DRAFT.pdf — built-in PDF writer — pandoc not found; Citations Across Fields Introduction Sequencing found the ne |
| the chain's compiled DRAFT.md starts with "# <title>" and carries "## <section>" headings | PASS | # attention mechanisms in transformers / ## Introduction / ## Discussion / ## Conclusion |

### EXP-06 — 5/5 checks pass

| Check | Result | Evidence |
|---|---|---|
| docx (pandoc docx writer) holds no path, $HOME, user, pensmith, .paper, citation-styles, .csl, CITATIONS.bib or .claude/plugins; no custom.xml, core/app identifying fields blank (statistics only), no footer; the product scanner agrees | PASS | exit 0; independent hits []; scanner findings 0; core [["dcterms:created","1970-01-01T00:00:00Z"],["dcterms:modified","1970-01-01T00:00:00Z"]]; app [["Words","83"],["SharedDoc","false"],["HyperlinksChanged","false"],["Lines","12"],["LinksUpToDate","false"],… |
| tex (pandoc LaTeX writer) holds no path, $HOME, user, pensmith, .paper, citation-styles, .csl, CITATIONS.bib or .claude/plugins; the product scanner agrees | PASS | exit 0; independent hits []; scanner findings 0 |
| pdf (pandoc PDF writer) holds no path, $HOME, user, pensmith, .paper, citation-styles, .csl, CITATIONS.bib or .claude/plugins; no XMP, no /PTEX; the product scanner agrees | PASS | exit 0; independent hits []; scanner findings 0 |
| export/CITATIONS.bib carries no path or tool trace | PASS | [] |
| export/CITATIONS.ris carries no path or tool trace | PASS | [] |

### EXP-07 — 11/11 checks pass

| Check | Result | Evidence |
|---|---|---|
| md (built-in Markdown writer) holds no path, $HOME, user, pensmith, .paper, citation-styles, .csl, CITATIONS.bib or .claude/plugins; the product scanner agrees | PASS | exit 0; independent hits []; scanner findings 0 |
| docx (built-in docx writer — pandoc not found) holds no path, $HOME, user, pensmith, .paper, citation-styles, .csl, CITATIONS.bib or .claude/plugins; no custom.xml, core/app identifying fields blank (statistics only), no footer; the product scanner agrees | PASS | exit 0; independent hits []; scanner findings 0; core [["dcterms:created","1970-01-01T00:00:00Z"],["dcterms:modified","1970-01-01T00:00:00Z"]]; app [] |
| tex (built-in LaTeX writer — pandoc not found) holds no path, $HOME, user, pensmith, .paper, citation-styles, .csl, CITATIONS.bib or .claude/plugins; the product scanner agrees | PASS | exit 0; independent hits []; scanner findings 0 |
| pdf (built-in PDF writer — pandoc not found) holds no path, $HOME, user, pensmith, .paper, citation-styles, .csl, CITATIONS.bib or .claude/plugins; no XMP, no /PTEX; the product scanner agrees | PASS | exit 0; independent hits []; scanner findings 0 |
| an injected zeroTracePatch failure leaves no .docx in .paper/export/ and exits 1 | PASS | exit 1; export/ = []; pensmith: export refused: DRAFT.docx (scrub) could not be scrubbed (Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.h |
| the failed run wrote no FINAL.md change and no DONE-RECORD for it | PASS |  |
| the scanner flags the unpatched path-bearing custom.xml fixture | PASS | [{"file":"<integrate>/controls/unpatched.docx","where":"_rels/.rels","finding":"holds a generator comment"},{"file": |
| the scanner flags a PDF with pdf-lib's default Producer | PASS | [{"file":"<integrate>/controls/pdflib-default.pdf","where":"/Info","finding":"sets /Producer (\"pdf-lib (https://git |
| the scanner flags an app.xml naming a generator | PASS | [{"file":"<integrate>/controls/app-generator.docx","where":"_rels/.rels","finding":"holds a generator comment"},{"fi |
| the scanner flags a docx embedding a PNG with a tEXt chunk | PASS | [{"file":"<integrate>/controls/png-text.docx","where":"_rels/.rels","finding":"holds a generator comment"},{"file":" |
| the scanner flags /PTEX.Fullbanner | PASS | [{"file":"<integrate>/controls/ptex.pdf","where":"object 2","finding":"has the key /PTEX.Fullbanner (a TeX engine re |

### EXP-08 — 4/4 checks pass

| Check | Result | Evidence |
|---|---|---|
| without pandoc, done --format docx writes export/DRAFT.docx and says "built-in docx writer — pandoc not found" | PASS | DRAFT.docx — built-in docx writer — pandoc not found |
| it unzips to well-formed WordprocessingML (every XML part parses) with heading-styled title and sections, body text, APA in-text citations and a References list | PASS | 10 paragraphs; Heading1:Citations Across Fields, Heading2:Introduction, Heading2:Discussion, Heading2:References |
| `pandoc -f docx -t plain` reads it back (title, citations, references) | PASS | Citations Across Fields / / Introduction |
| no --format docx run ends with only a .md in export/ | PASS |  |

### EXP-09 — 6/6 checks pass

| Check | Result | Evidence |
|---|---|---|
| without pandoc, --format pdf writes a PDF whose pdf-text.ts text holds the title, headings and references | PASS | DRAFT.pdf — built-in PDF writer — pandoc not found |
| its Info and XMP carry no path or producer trace | PASS | Info: Title= Author= Subject= Keywords= Creator= Producer= CreationDate=D:19700101000000Z ModDate=D:19700101000000Z; XMP: none |
| with pandoc but no PDF engine, --format pdf uses the built-in writer with a one-line note | PASS | DRAFT.pdf — built-in PDF writer — pandoc found but no PDF engine (pdflatex, xelatex, lualatex or tectonic) |
| --format latex (pandoc) compiles with tectonic (and pdflatex) | PASS | DRAFT.tex — pandoc LaTeX writer; tectonic true; pdflatex true |
| --format latex (built-in) compiles with tectonic (and pdflatex) | PASS | DRAFT.tex — built-in LaTeX writer — pandoc not found; tectonic true; pdflatex true |
| with pandoc and tectonic as the only engine, --format pdf is pandoc's PDF | PASS | DRAFT.pdf — pandoc PDF writer |

### EXP-10 — 9/9 checks pass

| Check | Result | Evidence |
|---|---|---|
| compile --yolo with a placeholder-preserving mock reports "boundary 1→2: smoothed" | PASS | pensmith compile: boundary 1→2: smoothed / pensmith compile: boundary 2→3: smoothed |
| only the last paragraph of §1 and the first of §2 (and of §2/§3) differ from the raw concatenation | PASS | changed paragraph indexes [3,5,6,8] of 10 |
| every citation token is byte-identical | PASS | [@aspelmeyer2009] [@aspelmeyer2009] [@lecun2015] [@lecun2015] [@zhu2020] [@zhu2020] |
| sections/* mtimes are unchanged | PASS |  |
| the smoother sees masked text only (no raw [@key] reaches the model) | PASS | 2 smoother requests |
| a mock that drops a citation gives "rejected (citation set changed)" | PASS | pensmith compile: boundary 1→2: rejected (citation set changed) |
| PENSMITH_NO_LLM=1 gives "skipped (no LLM)" (stdout and each boundary in COMPILE-REPORT) | PASS | pensmith compile: wrote <integrate>/ws/s3-smooth/paper/.paper/DRAFT.md and <integrate>/ws/s3-smooth/paper/.paper/COMPILE-REPORT.md (3 sections, 0 stale resolved). / pensmith compile: smoothing skipped (no LLM) — the section boundaries are the verified text. |
| --dry-run gives "skipped (dry-run)" for each boundary | PASS | _smoothing skipped (dry-run) — every boundary keeps the section text as verified._ / - boundary 1→2: skipped (dry-run) (before=575 chars, after=575 chars) |
| the dry run never writes .paper/ and makes no model call | PASS | model calls 0; export CITATIONS.dry-run.bib, CITATIONS.dry-run.ris, DRAFT.dry-run.docx |

### EXP-11 — 4/4 checks pass

| Check | Result | Evidence |
|---|---|---|
| the X-causes-Y fixture reports "Contradictions flagged: 1 (target 0)" citing both sentences (mock LLM) | PASS | ## Contradictions / / Contradictions flagged: 1 (target 0) / / Candidate pairs (cross-section claims sharing content terms): 1; 1 pair(s) judged by the claim-consistency model (cap 20). / |
| the heuristic alone flags it under PENSMITH_NO_LLM=1 | PASS | ## Contradictions / / Contradictions flagged: 1 (target 0) / / Candidate pairs (cross-section claims sharing content terms): 1; model check skipped (no LLM) — the deterministic heuristic ran alone. / |
| done's confirmation lists the contradiction | PASS | pensmith done: Contradictions flagged at compile: 1 (target 0) — see .paper/COMPILE-REPORT.md (EXP-11): / - §2 (Screen Time and Sleep) "Heavy screen time causes sleep loss in adolescents across the schools we surveyed [@aspelmeyer2009]." ↔ §3 (A Second Look… |
| a consistent paper reports "Contradictions flagged: 0 (target 0)" | PASS |  |

### EXP-12 — 4/4 checks pass

| Check | Result | Evidence |
|---|---|---|
| a computer-science paper compiled through bare `pensmith next` names "computer-science (from <source>)" and band 1–3 with each section's value | PASS | ## Citation Density / / Discipline: computer-science (from INTAKE.md) · band 1–3 citations per paragraph (from computer-science preset) · paper-wide 1 per paragraph (within) / / - 1 (learning): 1 citations/paragraph over 2 paragraph(s) (within 1–3); 62.5 ci… |
| a history paper lists its 5-citation and 0-citation body paragraphs as out of band | PASS | ## Citation Density / / Discipline: history (from INTAKE.md) · band 0.5–2 citations per paragraph (from history preset) · paper-wide 1.8 per paragraph (within) / / - 1 (crowded): 2 citations/paragraph over 3 paragraph(s) (within 0.5–2); 113.2 citations/1000… |
| citation_density_min = 2 / max = 5 change the reported band | PASS | ## Citation Density / / Discipline: history (from INTAKE.md) · band 2–5 citations per paragraph (from config.toml [verification] citation_density_min and citation_density_max) · paper-wide 1.8 per paragraph (BELOW) |
| a locator-only section has non-zero density | PASS | - 1 (loc): 1 citations/paragraph over 2 paragraph(s) (within 1–3); 125 citations/1000 words |

### EXP-13 — 4/4 checks pass

| Check | Result | Evidence |
|---|---|---|
| COMPILE-REPORT has 2 Transitions Changed entries with before/after text | PASS |  |
| Advisory Findings rows from Pass 2 / Pass 4, and the Contradictions and Density sections | PASS | ## Advisory Findings / / - §1 (learning): / - claim support (Pass 2): 2 claim(s) not SUPPORTED |
| `git grep "Phase 5 will populate" bin` is empty | PASS |  |
| compile --dry-run says "smoothing skipped (dry-run)" | PASS | pensmith compile: smoothing skipped (dry-run) — the section boundaries are the verified text. |

### EXP-14 — 6/6 checks pass

| Check | Result | Evidence |
|---|---|---|
| without the skill, done prints "humanizer skill not found … skipping" and exits 0 | PASS | humanizer skill not found at ~/.claude/skills/humanizer/SKILL.md — skipping |
| a humanizer reply that drops a citekey makes done exit 4 with no export and FINAL.md byte-identical | PASS | - §1 (Learning Representations): citation set changed |
| a humanizer reply that adds [@fake2099, p. 3] makes done exit 4 with no export and FINAL.md byte-identical | PASS | - §1 (Learning Representations): citation set changed |
| with the fixture SKILL.md under the temp HOME, done sends humanizer requests whose system prompt is the SKILL.md body | PASS | 3 humanizer requests (one per ## section) |
| FINAL.md differs from DRAFT.md with every citation preserved, and the export derives from FINAL.md | PASS | FINAL.md sha 827dc008d445 vs DRAFT.md 1d5b22c79e43 |
| `git grep "no Task transport" bin` is empty | PASS |  |

### EXP-15 — 3/3 checks pass

| Check | Result | Evidence |
|---|---|---|
| DONE-RECORD.json records the compiled draft and FINAL.md hashes | PASS |  |
| after a section redo, verify and recompile, a second done --yolo rewrites FINAL.md and the exports with the new text, and DONE-RECORD.json matches (status: done) | PASS | before redo: next: compile; after: next: status (done) |
| `pensmith done --raw --yolo` sends no humanizer request and reports "skipped (--raw)" | PASS | humanizer skipped (--raw) |

### EXP-16 — 11/11 checks pass

| Check | Result | Evidence |
|---|---|---|
| tests/done-honesty.test.ts (MockAgent lane) | PASS | # pass 1 # fail 0; EXP-16 / EXP-14 / EXP-19 (in process, test lane): done scores before (61%) and after (37%) the humanizer — terminal and VERIFICATION.md, with timestamps and the backend |
| tests/honesty.test.ts (MockAgent lane) | PASS | # pass 11 # fail 0; honesty: the synthetic GPTZero cassette is still the documented response shape (DONE-04) / EXP-16: GPTZero 0.61 before and 0.37 after → "61% … (gptzero, <ISO>)" and "37% …", then the framing note verbatim / EXP-16: no key → skipped (no G… |
| tests/honesty-consent.test.ts (MockAgent lane) | PASS | # pass 2 # fail 0; EXP-17: in a terminal the first score asks once; "yes" is recorded and the second score sends without asking / EXP-17: "no" is recorded too — nothing is sent, now or on the next score |
| tests/gates-registry.test.ts (MockAgent lane) | PASS | # pass 15 # fail 0; RUN-28: GATES is one table of unique gates; --yolo never skips cost-cap, estimate-proceed, detector-consent, paper-pointer or the own-source gates |
| no product path reads a GPTZero cassette: offline, honesty.ts returns 'unavailable (offline)' before any request; the only readers of tests/fixtures/cassettes/synthetic/gptzero are two tests that use it as the MockAgent reply shape | PASS | readers: tests/honesty.test.ts, tests/show-prompts.test.ts; bin/mcp/hooks/plugin readers: none; offline short-circuit present: True |
| references/honesty-framing.md makes no undetectable / evade claim | PASS | The framing is TRANSPARENCY-ONLY. It states what the score means and what the |
| PENSMITH_OFFLINE=1 never shows a bare percentage (terminal and VERIFICATION.md) | PASS | honesty check (before humanize): unavailable (offline) / honesty check (after humanize): N/A (humanize skipped with --raw) |
| --no-score reports the skip | PASS |  |
| with GPTZERO_API_KEY=dummy the real GPTZero answers and the line is "unavailable (GPTZero rejected the API key)" | PASS | honesty check: unavailable (GPTZero rejected the API key) |
| --no-score makes no detector request and reports the skip | PASS |  |
| honesty_score = false makes no detector request and reports the skip | PASS | honesty check: skipped (config: honesty_score = false) |

### EXP-17 — 5/5 checks pass

| Check | Result | Evidence |
|---|---|---|
| with the skill present and the humanizer call failing, the report says "humanizer failed: <reason>" | PASS | humanizer failed: anthropic (model claude-opus-5) failed with HTTP 500 api_error after retries — re-run later — exporting the compiled draft |
| a non-TTY --yolo run without recorded consent makes 0 detector requests and says why | PASS | before humanize): skipped (no consent recorded — run pensmith done interactively once, or set honesty_consent = true) |
| a non-TTY score with honesty_consent = true makes one detector request | PASS | 1 request(s) to api.gptzero.me |
| under a pty the first score asks once and config.toml records the answer | PASS | asked 2 time(s) on screen (a redraw repeats it); config: honesty_consent = true |
| the second score in a terminal does not ask again | PASS |  |

### EXP-18 — 2/2 checks pass

| Check | Result | Evidence |
|---|---|---|
| honesty_backend = "foo" fails config validation listing gptzero, originality and sapling | PASS | pensmith: .paper/config.toml: humanizer.honesty_backend: honesty_backend must be one of: gptzero, originality, sapling |
| doctor reports GPTZERO_API_KEY, ORIGINALITY_API_KEY and SAPLING_API_KEY as present or absent, never their values | PASS | ✓ [PASS] runtime-config-presence: provider anthropic (global), model claude-opus-5 (default), key ANTHROPIC_API_KEY (global): present; endpoint GET http://127.0.0.1:45955/v1/models → 200: PASS; optional keys: OPENALEX_API_KEY absent, PENSMITH_S2_API_KEY abs… |

### EXP-19 — 2/2 checks pass

| Check | Result | Evidence |
|---|---|---|
| tests/plagiarism.test.ts (MockAgent lane) | PASS | # pass 10 # fail 0; EXP-19: every section contributes a phrase, in paper order, each 6–10 words of body prose — never the title, a heading, a citation, a quote, a list item or the references / EXP-19: the budget (plagiarism_max_phrases) caps the phrases; ra… |
| live lane: the Bleak House passage in §4 is reported with its location, or DuckDuckGo blocking is reported honestly | PASS | 17 DuckDuckGo request(s); FOUND with location: pensmith done: plagiarism check: 17 distinctive phrase(s) searched as exact quotes; 1 found verbatim on the web; 13 query(ies) got no answer (DuckDuckGo refused the query (its bot challenge) — retry later) / - … |

### EXP-20 — 3/3 checks pass

| Check | Result | Evidence |
|---|---|---|
| offline, the plagiarism section says skipped (offline) | PASS |  |
| `done --no-plagiarism-check --yolo` makes 0 DuckDuckGo requests and records "plagiarism check skipped (--no-plagiarism-check)" | PASS |  |
| .paper/VERIFICATION.md (live run) contains no duckduckgo.com/l/?uddg= | PASS | Plagiarism Check (DONE-02) / / A basic check, not a substitute for an institutional plagiarism service: distinctive phrases of the paper searched as exact quotes on DuckDuckGo; a result counts only when it holds the phrase verbatim. Advisory only — never bl… |

### EXP-21 — 10/10 checks pass

| Check | Result | Evidence |
|---|---|---|
| `pensmith done --help` lists --yolo, --format, --style, --raw, --no-verify, --no-score and --no-plagiarism-check | PASS |  |
| `done --no-verify --raw` without --yolo exits 2 with the §7.9 refusal | PASS | pensmith done: --no-verify cannot be combined with --raw without --yolo (PRD §7.9): together they skip both the whole-paper verify pass and the humanizer — drop one of them, or pass --yolo to accept that (the blocking citation gate still runs) |
| `--format html` exits 2 listing md, docx, pdf, latex (tex) | PASS |  |
| with --yolo, `done --no-verify --raw` proceeds | PASS | exit 0 |
| with --no-verify --raw --yolo a FABRICATED citation still blocks (exit 4) | PASS | - .paper/DRAFT.md: citation [@fake2017] is FABRICATED — DOI 10.5555/pensmith-no-such-work-2017 did not resolve via Crossref |
| `pensmith export --format docx` runs the gate and writes the docx | PASS | DRAFT.docx — pandoc docx writer |
| `pensmith score` prints the honesty score line without exporting | PASS | Pensmith honesty check: skipped (no GPTZERO_API_KEY set) |
| `pensmith plagiarism` prints the check only (writes nothing) | PASS | plagiarism check skipped (offline) |
| `pensmith humanize` writes FINAL.md only after the gate (no export) | PASS | pensmith done: humanizer: the improved text kept every heading, citation and quote and passed re-verification / pensmith done: wrote .paper/FINAL.md (humanized; `pensmith export` renders it) |
| tests/cli-verbs.test.ts still asserts 16 verbs (pass) | PASS | # pass 3 # fail 0 |

### GRND-11 — 8/8 checks pass

| Check | Result | Evidence |
|---|---|---|
| `new --mode outline --yolo` then bare `pensmith --yolo` runs research, outline and done, then stops | PASS | ran: research → outline → done |
| a further bare run stops at status (done) and makes no model call | PASS | pensmith: ran status (done: outline only — complete: export/OUTLINE.md and export/ANNOTATED-BIBLIOGRAPHY.md — to draft the paper, set mode = "draft" under [project] in .paper/config.toml, or run a section yourself (`pensmith plan 1`)); next: status (done: o… |
| no sections/*/DRAFT.md is ever created | PASS |  |
| `pensmith status` reports outline only, complete, with the deliverables | PASS | mode: outline only / current: complete / next: status (done) / note: outline only — complete: export/OUTLINE.md and export/ANNOTATED-BIBLIOGRAPHY.md — to draft the paper, set mode = "draft" under [project] in .paper/config.toml, or run a section yourself (`… |
| .paper/ANNOTATED-BIBLIOGRAPHY.md lists per source the styled reference, an abstract excerpt, why it is relevant and the sections it supports | PASS | 6 sources; first: Cai, J., Kaleem, M. A., Genov, R., Azghadi, M. R., & Amirsoleimani, A. (2024). In-Memory Transformer Self-Attention Mechanism Using Passive Memristor Crossbar. *2024 IEEE International Symposium on Circuits and Systems (ISCAS)*, 1–5. <http… |
| export/ holds OUTLINE and ANNOTATED-BIBLIOGRAPHY as .md and (with --format docx) .docx, all passing the zero-trace scan | PASS | export/ = ANNOTATED-BIBLIOGRAPHY.docx, ANNOTATED-BIBLIOGRAPHY.md, CITATIONS.bib, CITATIONS.ris, OUTLINE.docx, OUTLINE.md; scans clean |
| with a fabricated source in the library (listed by the outline), outline-mode done exits 4 and exports nothing | PASS | - citation [@fake2024a] is FABRICATED — DOI 10.99999/fake.001 did not resolve via Crossref (no registration agency holds its prefix 10.99999) |
| tests/router-outline.property.test.ts covers the outline-only terminus (pass) | PASS | # pass 1 # fail 0 |

## 3. Success criteria (ROADMAP Phase 21)

Every requirement above is met on the user path, and the eight ROADMAP success criteria follow from them:
- **Titled, smoothed, checked compile.** Covered by EXP-05 and EXP-10..13.
- **Style precedence and all 8 styles.** Covered by EXP-03 and EXP-04.
- **Every requested format, with or without pandoc.** Covered by EXP-08 and EXP-09.
- **Zero trace, checked.** Covered by EXP-06 and EXP-07.
- **A real humanizer with one acceptance function.** Covered by EXP-14 and EXP-15.
- **Honest detector scores with persisted consent.** Covered by EXP-16..18.
- **A real verbatim plagiarism check.** Covered by EXP-19 and EXP-20.
- **Outline-only mode.** Covered by GRND-11.

## 4. Items outside this verification

These are maintainer items or later-phase items, listed in 21-SUMMARY §5:
- **Keyed detector runs.** Live runs of GPTZero, Originality.ai and Sapling with real keys.
- **CI.** The CI run across the three OSes (CI-06).
- **TeX in CI.** TeX compilation as a required CI step (HARDEN-04).
- **Image metadata.** Stripping embedded-image metadata on embed (BRDTH-02).
