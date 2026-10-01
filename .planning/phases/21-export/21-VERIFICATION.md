---
phase: 21-export
verified: 2026-10-01
verified_at_commit: 25b758d (the close-out's one product fix, the bounded plagiarism check; everything else in the close-out is .planning)
status: closed — 21 of 22 requirements Complete; EXP-09 Pending (partial); 8 of 8 ROADMAP success criteria met on the user path
score: 21/22 requirements Complete (EXP-01..08, EXP-10..21, GRND-11); EXP-09 met on every local criterion, its CI-compile criterion deferred to HARDEN-04 (Phase 26); 165 of 165 user-path acceptance checks pass on the final code
caveats: [no CI run has exercised Phase 21 code (CI-06), so the pandoc-dependent suites (HARDEN-03, zero-trace Test J, the docx read-back) and macOS / Windows are local evidence until the first green check matrix; keyed live GPTZero / Originality.ai / Sapling scores are maintainer items (no keys here; the real GPTZero's rejection of a dummy key was observed live); TeX compilation is local evidence until HARDEN-04 puts a TeX engine on the CI legs]
---

# Phase 21: Compile, Done and Export (EXPORT): Verification (close-out)

**Goal (ROADMAP):** compile produces a smoothed, checked, correctly cited paper; done humanizes for real, scores honestly and exports every requested format with zero trace; outline-only mode produces a sourced outline and annotated bibliography.

**Result: the goal is met on the user path, with one requirement open.**
- **21 of 22 requirements are Complete.** **EXP-09 stays Pending (partial):** its built-in PDF writer, the pandoc-without-engine fallback and the standalone LaTeX on both paths all work, and both LaTeX paths compile with tectonic 0.15 and pdflatex here. Its acceptance bullet "`--format latex` output compiles with tectonic (or pdflatex) **in the CI export job**" cannot be met until HARDEN-04 (Phase 26) installs a TeX engine on the CI legs (review rounds 2 and 3 recorded the deferral; §2).
- **All 8 ROADMAP success criteria are met** on the user path (§3). Criterion 1 says only "LaTeX compiles", which holds locally on both paths; the CI leg is EXP-09's open bullet.
- **The ROADMAP Phase 21 box stays unticked**, because EXP-09 is not fully met. This follows Phase 17 and Phase 19, which closed with one requirement open.
- **Gate:** green at `25b758d` (§1). The one failing test is the root-only atomic-write case (CLAUDE.md).
- **Defect found and fixed:** the live plagiarism lane found that the DuckDuckGo back-off grew without bound while DuckDuckGo challenged most queries, so `pensmith plagiarism` and a live `done` ran past five minutes. Each wait is now capped and the run has a time budget (`25b758d`; §4).
- **User path:** the integration pass's acceptance drivers were re-run on the final code, with expectations updated where the review rounds deliberately changed behaviour, plus a new driver for the review-round behaviour (§4). 165 of 165 checks pass.

## 1. Gate (the closer, at `25b758d`; Linux, as root, Node 22.22.2, LANG=C.UTF-8, pandoc 3.9 on PATH)

| Step | Result |
|---|---|
| `npm run prebuild`, `npm run build` | exit 0; the build left nothing in `git status --porcelain` (the only entry was the close-out's own `.planning` edit) |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run validate:manifests` | exit 0 (`plugin/ (plugin.json, hooks.json, 8 skills, 16 workflow bodies) + marketplace.json + .mcp.json valid`) |
| `npm run bundle:check` | exit 0 (`plugin/dist and the plugin version match what is committed`; plugin version `0.1.0-dev+bcb7e05066a7`, re-stamped for the done.md change in `25b758d`) |
| `npm run test:tier-contract` (CI=true) | exit 0: **63/63 pass** (also 63/63 at `e800683`) |
| `CI=true npm test` | **3147 tests: 3146 pass, 1 fail, 0 skipped, 0 todo** (1740 s, while the concurrent Phase 23b session kept the load average near 14). The failure is `tests/atomic-write.test.ts` "preserves OLD content on rename/write failure", which is root-only (`chmod 0o500` does not stop root; it passes in CI). HARDEN-03: `1000 drafts checked against pandoc 3.9 (seed 1788553088)`. The runner's real-data-dir fingerprint reported no change. Before the fix, at `e800683`, the same suite ran 3146 tests: 3145 pass, with the same one failure (838 s; seed 611516277). |
| `node scripts/e2e-smoke.mjs` | exit 0: **PASS=17, FINDING=0, FAIL=0** (also at `e800683`) |
| `npm run plugin:smoke` (Claude Code 2.1.286; at `e800683` and again at the close-out's plugin stamp `0.1.0-dev+bcb7e05066a7`) | exit 0 both times, all checks passed: `validate --strict` (plugin, plugin.json, marketplace), the legacy negative control, a fresh clone installs with no build, 8 skills / 4 hooks / 1 MCP server, `mcp list` connected, 11 tools, no-node negative control, the git-marketplace install and update move to the new stamp |

The integration pass recorded the same gate at `c1eb302` on Node 22 and Node 24, with coverage of 93.65 % lines and 84.58 % branches (gate 80 / 66). Every review round re-ran the gate on Node 22 (21-SUMMARY §6–§8).

## 2. Requirements

"Checks" are the user-path acceptance checks of §4 on the final code. "Tests" are the suites that own the requirement, all passing in §1.

| Requirement | Verdict | Evidence |
|---|---|---|
| EXP-01 — compile never prunes the bibliography; the export keeps every cited source | **Met** | §4 EXP-01: compile leaves `.paper/CITATIONS.bib` byte-identical, with the assigned-but-uncited source still in it; the export bib holds the cluster, locator and arXiv-only keys; the 5-section plan 3 → write 3 → verify 3 → compile → done chain exports the newly cited source while §1, §2, §4 and §5 stay byte- and mtime-identical; zero-citation drafts leave the bib unchanged and verify does not crash. Tests: `compile-bib-regen`, `exporter`, `citation-integrity.property`. |
| EXP-02 — locators and multi-cites; bib and RIS agree | **Met** | §4 EXP-02: "(Aspelmeyer, 2009; LeCun et al., 2015)", "(Zhu et al., 2020, p. 4)" (a non-breaking space after `p.`, as pandoc), a References section, LaTeX keeps "p. 4", identical bib/RIS key sets, an independent Python RIS reader re-imports the authors and titles, and `add <doi>` updates `.paper/CITATIONS.ris`. Tests: `exporter`, `ris-write`, `add-identifiers-cli`, `locator-oracle`. |
| EXP-03 — the paper's style is honored; all 8 styles reachable | **Met** | §4 EXP-03: brief → APA; config.toml MLA overrides it; each of the 8 styles via `--style`; `--style bogus` exits 2 listing them; a local `.csl` on the built-in md, built-in docx and pandoc paths; the PRD §15 "APA style" chain exports author-date APA. Review rounds 2–3: a `.csl` named in config.toml is refused by the `csl-style` gate (exit 3, never `--yolo`), the same file on the command line exports, and a `//server/share` path exits 2 before anything opens it. Tests: `export-style`, `csl-style-approval`, `done-flags`, `config-v4`, `e2e-chain`, `gates-registry`. |
| EXP-04 — numeric and note styles are correct without pandoc | **Met** | §4 EXP-04: for each of the 8 styles the built-in md export equals pandoc 3.9 citeproc over the same draft and bibliography (body, notes, bibliography, after the goldens test's normalisation); IEEE `[1] [2] [1] [2], [3]`; Vancouver `(1)`; AMA `^1^`; Chicago notes as footnotes with short subsequent notes and no doubled period; `[@k 41]` is page 41. Tests: `citation-goldens` (8 committed goldens from pandoc 3.9, link targets compared), `citation-render`, `locator-oracle` (5 styles against pandoc). |
| EXP-05 — title and section headings | **Met** | §4 EXP-05: `# <title>` then `## <Section>` in outline order; Heading 1 / Heading 2 in the pandoc and built-in docx; md, tex and pdf from both paths start with the title; the PRD §15 chain's DRAFT.md is headed. Tests: `compile-pipeline`, `docx-writer`, `paper-title`, `compile-recompute`. |
| EXP-06 — pandoc exports record no local paths | **Met** | §4 EXP-06: with the project under `<tmp>/x/Users/bob/School/essay`, the pandoc docx, tex and pdf (tectonic engine) and the export bib/RIS hold no path, `$HOME`, user, "pensmith", `.paper`, `citation-styles`, `.csl`, `CITATIONS.bib` or `.claude/plugins` (an independent Python scan of every ZIP part and decompressed PDF stream, plus the product scanner); no custom.xml, blank identifying core/app fields, no footer, no XMP, no `/PTEX`. Tests: `zero-trace-export` (Test J, real pandoc), `zero-trace-scan`, `exporter`. |
| EXP-07 — every export passes the scan or is deleted | **Met** | §4 EXP-07: md, docx, tex and pdf from the built-in writers pass; an injected scrub failure exits 1 and leaves no .docx (and, with an earlier export present, every earlier file byte-identical — the staging of review round 2); the scanner flags the unpatched custom.xml fixture, pdf-lib's default Producer, an app.xml generator, a PNG `tEXt` chunk and `/PTEX.Fullbanner`. Review round 3: a compiled draft holding the project path is refused before the humanizer (0 calls) and kept in `EXPORT.refused.md`. Tests: `zero-trace-export`, `zero-trace-scan`, `exporter`, `humanizer-task`. |
| EXP-08 — `--format docx` always produces a real .docx | **Met** | §4 EXP-08: with no pandoc, `built-in docx writer — pandoc not found`; well-formed WordprocessingML with Heading-styled title and sections, APA citations and References; `pandoc -f docx -t plain` reads it back; no docx run ends with only a .md. Tests: `docx-writer` (the read-back, required with `CI=true`). |
| EXP-09 — PDF without pandoc; standalone, compilable LaTeX | **Not fully met — Pending (partial)** | Met locally (§4 EXP-09): the built-in PDF's text holds the title, headings and references, and its Info/XMP carry no path or producer; pandoc with no engine falls back to the built-in writer with the one-line note; `--format latex` compiles with tectonic and pdflatex on both the pandoc and the built-in path; pandoc with tectonic as the only engine writes pandoc's PDF; every PDF path prints or names every character (review round 1, `export/glyphs.ts`). **Open:** "compiles with tectonic (or pdflatex) in the CI export job, with and without pandoc". `ci.yml` installs pandoc but no TeX engine, so `tests/latex-standalone.test.ts` skips its compile assertions on CI. HARDEN-04 (Phase 26) owns this: it must install a TeX engine on the three legs, warm tectonic's bundle cache (the exporter runs tectonic `--only-cached` whenever sources are offline, which is every test run), and run the suite with `PENSMITH_REQUIRE_TEX=1`. Tests: `latex-standalone`, `pdf-writer`, `export-unicode`, `exporter`. |
| EXP-10 — the boundary smoother runs | **Met** | §4 EXP-10: `boundary 1→2: smoothed` with only the boundary paragraphs changed, every citation token byte-identical, `sections/*` mtimes unchanged, and only masked text sent to the model; a citation-dropping reply is `rejected (citation set changed)`; `skipped (no LLM)` and `skipped (dry-run)`; the dry run writes no `.paper/` and makes no model call. Tests: `compile-pipeline`, `rewrite-guard` (paragraph count, per-paragraph placeholders, citation anchoring, fence markers), `smoother-token-protect`. |
| EXP-11 — cross-section contradiction check | **Met** | §4 EXP-11: X-causes-Y reports `Contradictions flagged: 1 (target 0)` with both sentences (mock), and the heuristic alone flags it under `PENSMITH_NO_LLM=1`; done's confirmation lists it; a consistent paper reports 0. The `claim-consistency` hash is pinned in `EXPECTED_PROMPT_HASHES` and `tests/repo-files.test.ts`, and the D-12 amendment is D-21-15. Tests: `claim-consistency`, `compile-report-schema`, `compile-pipeline`, `repo-files`. |
| EXP-12 — per-paragraph density against the discipline | **Met** | §4 EXP-12: bare `pensmith next` on a computer-science paper names `computer-science (from INTAKE.md)` and band 1–3 per section; a history paper lists its 5- and 0-citation paragraphs; `citation_density_min = 2` / `max = 5` change the band; a locator-only section has non-zero density. Tests: `citation-density` (every preset slug), `compile-pipeline`, `e2e-chain`. |
| EXP-13 — COMPILE-REPORT fully populated | **Met** | §4 EXP-13: 2 Transitions entries with before/after text, Advisory Findings from Pass 2 / Pass 4, Contradictions and Density sections; `git grep 'Phase 5 will populate' bin` is empty; `smoothing skipped (dry-run)` / `(no LLM)`. Tests: `compile-report-schema`, `compile-pipeline`. |
| EXP-14 — the humanizer runs (Tier 2) and is re-gated | **Met** | §4 EXP-14: the system prompt is the fixture SKILL.md body (one request per `##` section); FINAL.md differs with every citation preserved, and the export derives from it; a reply that drops a citekey or adds `[@fake2099, p. 3]` exits 4 with no export and FINAL.md unchanged; with no skill, `humanizer skill not found (looked for …) — skipping`, exit 0; no "no Task transport". Review rounds 2–3: a rejection is kept in `FINAL.rejected.md`, the router reports attention and a bare run makes 0 humanizer calls, and `done --raw` clears it; the skill is found under `$CLAUDE_CONFIG_DIR` and under `~/.claude/skills/synced/<id>/`. Tests: `humanizer-wrap`, `humanizer-task`, `rewrite-guard`, `done-final-gate`, `done-final-record`. |
| EXP-15 — FINAL.md rebuilt on every successful done | **Met** | §4 EXP-15: DONE-RECORD holds the compiled-draft and FINAL.md hashes; after a section redo, verify and recompile, a second done rewrites FINAL.md and the export, and status says done; `done --raw` sends no humanizer request and says `skipped (--raw)`. Carry-over 6: `pensmith humanize` records `exported: false` (DONE-RECORD v4) and status reports attention naming `pensmith export`, and `pensmith export` renders that FINAL.md and completes the paper. Tests: `done-final-record`, `done-final-gate`, `done-flags`. |
| EXP-16 — honest, timestamped scores or an exact reason | **Met** | §4 EXP-16: the MockAgent lanes (GPTZero 0.61 → 0.37 with ISO time and `gptzero` in the terminal and VERIFICATION.md); offline never prints a bare percentage; the live GPTZero answers a dummy key with `unavailable (GPTZero rejected the API key: API key has no owner)` (the service's own reason after the cause, review round 3); `--no-score` and `honesty_score = false` send nothing and say so; no product path reads a GPTZero cassette; the framing file makes no undetectable / evade claim. Tests: `honesty`, `done-honesty`, `done-flags`. |
| EXP-17 — explicit, persisted consent; exact skip reasons | **Met** | §4 EXP-17 (amended in review round 1, consent stored in the data dir): a non-TTY `--yolo` run with no recorded consent makes 0 detector requests and names the reason; a copied paper whose config.toml says `honesty_consent = true` sends nothing; with the user's consent in `detector-consent.json` a non-TTY score makes one request; under a real pty the first score asks once and records the answer in the data dir (config.toml untouched), and the second does not ask; a failing humanizer gives `humanizer failed: <reason>`. Tests: `honesty-consent`, `honesty`, `gates-registry`. |
| EXP-18 — Originality and Sapling backends | **Met** | §4 EXP-18: `honesty_backend = "foo"` fails validation listing the three; doctor reports the three keys as present/absent only. The MockAgent lanes cover both new backends' request shapes and score mapping, and the service's own reason (Originality.ai's Enterprise-plan 422). Tests: `honesty`, `done-flags`. |
| EXP-19 — distinctive quoted phrases; verbatim matches | **Met** | §4 EXP-19: the MockAgent lane (quoted queries, every section, no heading or title text, verbatim-only matches) and the live lane on the real DuckDuckGo with a Bleak House passage in §4 (§4 records the run). Review round 3 paces the live queries and reports per-section coverage, with INCOMPLETE when most queries go unanswered. The close-out bounds the run: each back-off is capped at 30 s, and the run has 12 s per phrase (`25b758d`). Tests: `plagiarism` (including the close-out's always-refusing DuckDuckGo), `done-honesty`. |
| EXP-20 — real URLs; never faked | **Met** | §4 EXP-20: offline → `plagiarism check skipped (offline)`; `--no-plagiarism-check` → 0 DuckDuckGo requests and the recorded skip; the live VERIFICATION.md holds no `duckduckgo.com/l/?uddg=`. Tests: `plagiarism` (uddg decoding), `done-flags`. |
| EXP-21 — done flags and aliases | **Met** | §4 EXP-21: `done --help` lists the seven flags; `--no-verify --raw` exits 2 with the §7.9 refusal, and with `--yolo` proceeds while a FABRICATED citation still blocks; `--format html` exits 2; `export --format docx`, `score`, `plagiarism` and `humanize` behave as D-21-23 says; `cli-verbs` still asserts 16 verbs and `validate:manifests` passes. Tests: `done-flags`, `cli-aliases`, `unknown-verb`, `plumbing-args`, `cli-verbs`. |
| GRND-11 — outline-only mode | **Met** | §4 GRND-11: `new --mode outline --yolo` then bare `pensmith --yolo` runs research → outline → done and stops; no `sections/*/DRAFT.md`; `status` reports outline only, complete; the annotated bibliography lists each source's styled reference, abstract excerpt, relevance and sections; the routed done writes the `.md` and `.docx` pairs (review round 2), and an explicit `--format docx` run passes the zero-trace scan; a fabricated source exits 4 and exports nothing; the router property test covers the terminus. Tests: `outline-only-mode`, `annotated-bibliography`, `outline-record`, `router-outline.property`, `pensmith-router`, `estimator`. |

**Carry-overs assigned to this phase (all closed):**
1. **EXP-03 style precedence:** `--style` > config.toml > the brief > preset; the e2e chain exports APA (`e2e-chain`, §4 EXP-03).
2. **EXP-04 note style without pandoc:** footnotes, no doubled period (§4 EXP-04, `citation-goldens`).
3. **`[@k 33]` as a page locator:** `locator-oracle` checks the offline renderer against pandoc citeproc over 5 styles, and §4 checks `[@k 41]` on the CLI.
4. **Exporter-made notes never carry an unverified citation:** the exporter renders only the keys the gate read and refuses a rendered identifier no cited entry holds (`assertRenderedIdentifiers`, review round 2), and the outline-only annotated bibliography quotes only registrar-recorded abstracts and omits library values with an unverified attribution (review rounds 1 and 3). Documented in done.md (a note-style footnote is built after the gate, from the engine's rendering of a gated key) and CLAUDE.md ("the exporter renders only keys the gate read").
5. **GRND-11:** met (above).
6. **DONE-RECORD stays current:** v4 with `exported` and `previous_final_sha256`; `humanize`, `export`, rejections and refusals each keep the router's done / attention decision correct (`done-final-record`, `done-final-gate`, §4 EXP-15 and EXP-14).

## 3. ROADMAP success criteria

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | `done --format docx` produces a real .docx with and without pandoc, `--format pdf` produces a PDF, LaTeX compiles, and every export passes the zero-trace scan or is deleted | **Met** (LaTeX locally; the CI compile is EXP-09's open bullet) | EXP-06, EXP-07, EXP-08, EXP-09 rows in §2 and §4 |
| 2 | Exports use the configured style (all 8 reachable, `--style` and intake overrides), number numeric styles correctly, render locators and multi-cites, start with the title and headings; the export bib and RIS hold exactly the cited keys; `.paper/CITATIONS.bib` is never pruned | **Met** | EXP-01..05 |
| 3 | COMPILE-REPORT shows smoothed transitions with citations unchanged, contradictions with both sentences (target 0, capped), per-paragraph density against the discipline band, the advisory findings and skip reasons that name the mode | **Met** | EXP-10..13 |
| 4 | With the humanizer skill installed, done humanizes through the configured LLM, rewrites FINAL.md on every run, and blocks if humanizing changed the citation set | **Met** | EXP-14, EXP-15 |
| 5 | The honesty score is real, before and after, with ISO timestamps and the backend, or explicitly absent with the exact reason; consent is recorded explicitly and never implied by `--yolo`; GPTZero, Originality and Sapling work; `--no-score` is honored | **Met** (keyed live scores are maintainer items) | EXP-16..18 |
| 6 | The plagiarism check sends quoted distinctive phrases from every section, counts only verbatim matches, shows real destination URLs and is labeled when offline | **Met** | EXP-19, EXP-20 |
| 7 | done accepts `--no-verify`, `--no-score`, `--no-plagiarism-check` and `--style`; the four aliases work while `UX02_VERBS` stays at 16 | **Met** | EXP-21 |
| 8 | Outline-only mode stops after the outline and exports a zero-trace annotated bibliography whose sources were re-verified by the gate | **Met** | GRND-11 |

## 4. User-path acceptance checks on the final code

**What ran.** The integration pass's drivers (`scratchpad/p21/integrate/s1..s6`, 150 checks at `c1eb302`) were copied to `scratchpad/p21/close/accept/`, with a seventh driver, `s7-rounds`, for behaviour the review rounds added. A first run at `e800683` (165 checks, 155 pass) found the plagiarism defect below; every other failure was an expectation a review round had changed on purpose (listed below). The tables are the final run at `25b758d`. Each driver:
- spawns the built `node dist/bin/pensmith.js` in its own project folder, outside any test context (no `NODE_TEST_CONTEXT` / `PENSMITH_TEST`, no `CLAUDE_CONFIG_DIR`);
- puts HOME, USERPROFILE, XDG_DATA_HOME and LOCALAPPDATA inside the workspace, with `PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org` and a dummy Anthropic key;
- names the RUN-21 mock LLM in the workspace's global `runtime.json`;
- replays recorded sources (`PENSMITH_OFFLINE=1`), except the checks marked live;
- chooses PATH per check: pandoc 3.9 (with pdflatex in /usr/bin), pandoc and tectonic only, or no tools.

Independent checkers: a Python RIS reader, Python ZIP / zlib byte scans of every docx part and decompressed PDF stream, `pandoc -f docx -t plain`, pandoc 3.9 citeproc as the EXP-04 oracle, tectonic 0.15 and pdflatex, and a real pseudo-terminal for the consent question. Each command, with stdout, stderr and exit code, is in `close/accept/EVIDENCE.log`, and each check is in `close/accept/results.jsonl`.

**Defect found and fixed (`25b758d`).** On 2026-10-01 DuckDuckGo challenged about two queries in three from this environment (HTTP 202, its bot challenge). `plagiarism.ts` waited 10 s times the number of challenges in a row before the next query, with no cap, and asked a challenged phrase up to twice more. In the first run, the live `pensmith plagiarism` (17 phrases, 25 queries) and the live `pensmith done` were both still running when the driver killed them at 300 s, and neither printed anything after its start line ("about 1 min"). The two live checks therefore failed: EXP-19's live lane and EXP-20's live VERIFICATION.md. With every query refused, the waits would have summed to hours. The fix:
- caps each back-off wait at 30 s;
- gives the run 12 s per phrase. Once that is spent, no further query is sent, and each phrase still waiting reports its last refusal or `not queried — the check's time budget (N min) ran out …`, so the coverage line reports the run INCOMPLETE;
- names the bound in its start line and says when it stops.

done.md step 2 and the README say so. The new `plagiarism` test runs a DuckDuckGo that refuses every query, and it fails if either the cap or the budget is removed. In the final run, the live `pensmith plagiarism` sent 23 DuckDuckGo requests and said `about 1 min, at most 3 min if DuckDuckGo keeps refusing`. It then stopped at its budget (`plagiarism check stopped at its time budget (3 min): DuckDuckGo kept refusing queries; 3 phrase(s) left unanswered`) and reported `2 found verbatim on the web; 3 query(ies) got no answer`. The Bleak House passage was found at `§4 paragraph 1`, under two phrases, with real destinations (gutenberg.org, en.wikisource.org, victorianweb.org …). The live `done` that followed completed and wrote a VERIFICATION.md with no `uddg` link (EXP-19 and EXP-20 tables; the full output is `close/accept/exp19-live-plagiarism.log`).

**Expectations updated because a review round changed the behaviour on purpose** (each is the fix the round recorded, never a loosened check):
- **EXP-17 consent (round 1).** Consent is recorded in the data dir (`detector-consent.json`), not config.toml. The non-TTY "with consent" check now writes the user's record there, a new check confirms that a copied paper's `honesty_consent = true` sends nothing, the pty check reads the data-dir record and confirms config.toml is untouched, and the skip reason is the new text (`run pensmith score (or pensmith done) once in a terminal and answer the detector question`).
- **EXP-02 locators (round 1).** The label and locator are joined by a non-breaking space, as pandoc does. The locator regex accepts U+00A0.
- **EXP-04 oracle (rounds 2 and 3).** The comparison uses the goldens test's normalisation at the close (soft line breaks fold to spaces; U+00A0 folds to a space), and the oracle's list heading comes from `referencesHeading` ("Works Cited" for MLA, review round 3).
- **EXP-14 skip line (round 3).** The skill is looked for in three places, and the line names them: `humanizer skill not found (looked for ~/.claude/skills/humanizer/SKILL.md, ~/.claude/skills/synced/*/humanizer/SKILL.md or an installed plugin's skills/humanizer/SKILL.md) — skipping`.
- **EXP-16 reason (round 3).** An unavailable score carries the service's own short reason after the cause. The live GPTZero line is now `unavailable (GPTZero rejected the API key: API key has no owner)`, and the check accepts an optional `: <reason>`, as `tests/honesty.test.ts` does.
- **Tectonic (round 1).** With sources offline, the exporter runs tectonic `--only-cached`. The two pandoc + tectonic runs point `XDG_CACHE_HOME` at this container's warm bundle cache, because the workspace HOME has none.

**New checks** (`s7-rounds`, and one in `s6-chains`): the `csl-style` gate (refused at exit 3 from config.toml, accepted from `--style`, UNC refused at exit 2); MLA "Works Cited" with the md already in `export/` rebuilt; a refused export leaving the previous set byte-identical; `humanize` → attention → `export` → done (DONE-RECORD v4); a rejected humanization kept, reported and never re-billed, then cleared by `done --raw`; the zero-trace prescan before any paid step; the skill resolver's `$CLAUDE_CONFIG_DIR` and `synced/` layouts; and the routed outline-only done writing the `.md` and `.docx` pairs.

Paths in the evidence column read `<accept>` for `scratchpad/p21/close/accept`.

**165 of 165 checks pass.**

### EXP-01 — 7/7 checks pass

| Check | Result | Evidence |
|---|---|---|
| the arXiv preprint is in the library as an arXiv-only entry (eprint, archivePrefix, no journal DOI) | PASS | @misc{vaswani2017, author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N. and Kaiser, Lukasz and Polosukhin, Illia}, title = {Attention Is All You Need} |
| (1) `pensmith compile` leaves .paper/CITATIONS.bib byte-identical | PASS | compile exit 0; sha 5dcc33df8771 → 5dcc33df8771 |
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

### EXP-03 — 20/20 checks pass

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
| --style ./my-style.csl renders on the built-in path (md, no pandoc) | PASS | style: my-style.csl (Angle-Bracket Test Style) (from --style); \<\<Zhu 2020\>\>; ZHU, Na: [A Novel Coronavirus from Patients with Pneumonia in China, 2019](https://doi.org/10.1056/NEJMoa2001017). |
| --style ./my-style.csl renders in the built-in docx writer | PASS | &lt;&lt;Zhu 2020&gt;&gt; |
| --style ./my-style.csl renders on the pandoc path (docx) | PASS | &lt;&lt;Zhu 2020&gt;&gt; |
| a missing .csl is a usage error (exit 2) naming why | PASS | pensmith: --style: <accept>/ws/s2-styles/paper/missing.csl cannot be read (ENOENT) |
| the PRD §15 assignment ("… APA style") reaches done and exports author-date APA, not IEEE | PASS | 8 runs; style: apa (from config.toml [project] citation_style); (Cai et al., 2024) |
| a non-TTY `done --yolo` with a .csl named in config.toml exits 3 (csl-style gate, never answered by --yolo) and exports nothing | PASS | pensmith: Use the citation style file this paper's config.toml names? Its text is printed in every citation and reference of the export. (<accept>/ws/s7-csl/paper/shared-style.csl — or pass it yourself with --s |
| the same file given by the user on the command line (--style ./shared-style.csl) exports (exit 0) | PASS | style: shared-style.csl (Angle-Bracket Test Style) (from --style) |
| a UNC-style //server/share .csl in config.toml is refused (exit 2) before anything opens it | PASS | pensmith: config.toml [project] citation_style: "//fileserver/share/style.csl" is a network path — a style file a paper's config.toml names must be on this machine (pass a file yourself with --style) |
| an MLA export titles its list "Works Cited" (built-in docx), and the md already in export/ is rebuilt in the same run with the same list | PASS | pensmith export: DRAFT.docx — built-in docx writer — pandoc not found / pensmith export: DRAFT.md — built-in Markdown writer |

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
| the chain's compiled DRAFT.md starts with "# <title>" and carries "## <section>" headings | PASS | # Attention Mechanisms in Transformers / ## Introduction / ## Discussion / ## Conclusion |

### EXP-06 — 5/5 checks pass

| Check | Result | Evidence |
|---|---|---|
| docx (pandoc docx writer) holds no path, $HOME, user, pensmith, .paper, citation-styles, .csl, CITATIONS.bib or .claude/plugins; no custom.xml, core/app identifying fields blank (statistics only), no footer; the product scanner agrees | PASS | exit 0; independent hits []; scanner findings 0; core [["dcterms:created","1970-01-01T00:00:00Z"],["dcterms:modified","1970-01-01T00:00:00Z"]]; app [["Words","83"],["SharedDoc","false"],["HyperlinksChanged","false"],["Lines","12"],["LinksUpToDate","false"],… |
| tex (pandoc LaTeX writer) holds no path, $HOME, user, pensmith, .paper, citation-styles, .csl, CITATIONS.bib or .claude/plugins; the product scanner agrees | PASS | exit 0; independent hits []; scanner findings 0 |
| pdf (pandoc PDF writer) holds no path, $HOME, user, pensmith, .paper, citation-styles, .csl, CITATIONS.bib or .claude/plugins; no XMP, no /PTEX; the product scanner agrees | PASS | exit 0; independent hits []; scanner findings 0 |
| export/CITATIONS.bib carries no path or tool trace | PASS | [] |
| export/CITATIONS.ris carries no path or tool trace | PASS | [] |

### EXP-07 — 13/13 checks pass

| Check | Result | Evidence |
|---|---|---|
| md (built-in Markdown writer) holds no path, $HOME, user, pensmith, .paper, citation-styles, .csl, CITATIONS.bib or .claude/plugins; the product scanner agrees | PASS | exit 0; independent hits []; scanner findings 0 |
| docx (built-in docx writer — pandoc not found) holds no path, $HOME, user, pensmith, .paper, citation-styles, .csl, CITATIONS.bib or .claude/plugins; no custom.xml, core/app identifying fields blank (statistics only), no footer; the product scanner agrees | PASS | exit 0; independent hits []; scanner findings 0; core [["dcterms:created","1970-01-01T00:00:00Z"],["dcterms:modified","1970-01-01T00:00:00Z"]]; app [] |
| tex (built-in LaTeX writer — pandoc not found) holds no path, $HOME, user, pensmith, .paper, citation-styles, .csl, CITATIONS.bib or .claude/plugins; the product scanner agrees | PASS | exit 0; independent hits []; scanner findings 0 |
| pdf (built-in PDF writer — pandoc not found) holds no path, $HOME, user, pensmith, .paper, citation-styles, .csl, CITATIONS.bib or .claude/plugins; no XMP, no /PTEX; the product scanner agrees | PASS | exit 0; independent hits []; scanner findings 0 |
| an injected zeroTracePatch failure leaves no .docx in .paper/export/ and exits 1 | PASS | exit 1; export/ = []; pensmith: export refused: DRAFT.docx (scrub) could not be scrubbed (Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.h |
| the failed run wrote no FINAL.md change and no DONE-RECORD for it | PASS |  |
| the scanner flags the unpatched path-bearing custom.xml fixture | PASS | [{"file":"<accept>/controls/unpatched.docx","where":"_rels/.rels","finding":"holds a generator comment"},{"fil |
| the scanner flags a PDF with pdf-lib's default Producer | PASS | [{"file":"<accept>/controls/pdflib-default.pdf","where":"/Info","finding":"sets /Producer (\"pdf-lib (https:// |
| the scanner flags an app.xml naming a generator | PASS | [{"file":"<accept>/controls/app-generator.docx","where":"_rels/.rels","finding":"holds a generator comment"},{ |
| the scanner flags a docx embedding a PNG with a tEXt chunk | PASS | [{"file":"<accept>/controls/png-text.docx","where":"_rels/.rels","finding":"holds a generator comment"},{"file |
| the scanner flags /PTEX.Fullbanner | PASS | [{"file":"<accept>/controls/ptex.pdf","where":"object 2","finding":"has the key /PTEX.Fullbanner (a TeX engine |
| a scrub failure (a pandoc that writes a broken docx) exits 1 and every file already in export/ is byte-identical; no staging folder is left in export/ | PASS | exit 1; export/ = CITATIONS.bib, CITATIONS.ris, DRAFT.docx, DRAFT.md |
| a compiled draft holding the project folder path: done exits 1 before the humanizer (0 calls), writes no export, keeps EXPORT.refused.md, and status reports attention | PASS | exit 1; humanizer calls 0; pensmith done: the compiled draft holds text no export may carry — nothing was sent or exported; the reasons are kept in .paper/EXPORT.refused.md (remove it fro |

### EXP-08 — 4/4 checks pass

| Check | Result | Evidence |
|---|---|---|
| without pandoc, done --format docx writes export/DRAFT.docx and says "built-in docx writer — pandoc not found" | PASS | DRAFT.docx — built-in docx writer — pandoc not found |
| it unzips to well-formed WordprocessingML (every XML part parses) with heading-styled title and sections, body text, APA in-text citations and a References list | PASS | 10 paragraphs; Heading1:Citations Across Fields, Heading2:Introduction, Heading2:Discussion, Heading2:References |
| `pandoc -f docx -t plain` reads it back (title, citations, references) | PASS | Citations Across Fields / / Introduction |
| no --format docx run ends with only a .md in export/ | PASS |  |

### EXP-09 — 6/6 local checks pass (the CI-compile criterion is open until HARDEN-04; §2)

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
| PENSMITH_NO_LLM=1 gives "skipped (no LLM)" (stdout and each boundary in COMPILE-REPORT) | PASS | pensmith compile: wrote <accept>/ws/s3-smooth/paper/.paper/DRAFT.md and <accept>/ws/s3-smooth/paper/.paper/COMPILE-REPORT.md (3 sections, 0 stale resolved). / pensmith compile: smoothing skipped (no LLM) — the section boundaries are the verified text. |
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

### EXP-14 — 11/11 checks pass

| Check | Result | Evidence |
|---|---|---|
| without the skill, done prints "humanizer skill not found … skipping" and exits 0 | PASS | humanizer skill not found (looked for ~/.claude/skills/humanizer/SKILL.md, ~/.claude/skills/synced/*/humanizer/SKILL.md or an installed plugin's skills/humanizer/SKILL.md) — skipping |
| a humanizer reply that drops a citekey makes done exit 4 with no export and FINAL.md byte-identical | PASS | - §1 (Learning Representations): citation set changed |
| a humanizer reply that adds [@fake2099, p. 3] makes done exit 4 with no export and FINAL.md byte-identical | PASS | - §1 (Learning Representations): citation set changed |
| with the fixture SKILL.md under the temp HOME, done sends humanizer requests whose system prompt is the SKILL.md body | PASS | 3 humanizer requests (one per ## section) |
| FINAL.md differs from DRAFT.md with every citation preserved, and the export derives from FINAL.md | PASS | FINAL.md sha 827dc008d445 vs DRAFT.md 1d5b22c79e43 |
| `git grep "no Task transport" bin` is empty | PASS |  |
| a humanizer reply that drops a citation: done exits 4, FINAL.rejected.md keeps the reasons, and status reports attention naming `pensmith done --raw` | PASS | exit 4; next: status (attention) |
| a bare `pensmith --yolo` then makes no humanizer call (attention, not a re-billed done) | PASS | 0 humanizer calls; pensmith: ran status (needs attention — see above); next: do what it names, then run pensmith again |
| `pensmith done --raw` then exports the verified draft, removes FINAL.rejected.md, and the paper is done | PASS | next: status (done) |
| a skill at $CLAUDE_CONFIG_DIR/skills/humanizer/SKILL.md is found, named, and runs (one request per ## section) | PASS | 3 humanizer calls; pensmith done: humanizer skill: <accept>/ws/s7-skill-config-dir/claude-config/skills/humanizer/SKILL.md |
| a skill at ~/.claude/skills/synced/<id>/humanizer/SKILL.md is found, named, and runs (one request per ## section) | PASS | 3 humanizer calls; pensmith done: humanizer skill: <accept>/ws/s7-skill-synced/home/.claude/skills/synced/abc123/humanizer/SKILL. |

### EXP-15 — 5/5 checks pass

| Check | Result | Evidence |
|---|---|---|
| DONE-RECORD.json records the compiled draft and FINAL.md hashes | PASS |  |
| after a section redo, verify and recompile, a second done --yolo rewrites FINAL.md and the exports with the new text, and DONE-RECORD.json matches (status: done) | PASS | before redo: next: compile; after: next: status (done) |
| `pensmith done --raw --yolo` sends no humanizer request and reports "skipped (--raw)" | PASS | humanizer skipped (--raw) |
| `pensmith humanize` records exported: false (DONE-RECORD v4) and `pensmith status` reports attention naming `pensmith export` | PASS | done → v4 exported=true; humanize → exported=false; next: status (attention) |
| `pensmith export` renders that FINAL.md, records exported: true, and the router then reports the paper done | PASS | next: status (done); export carries "Put simply: Neural networks with many la" |

### EXP-16 — 11/11 checks pass

| Check | Result | Evidence |
|---|---|---|
| tests/done-honesty.test.ts (MockAgent lane) | PASS | # pass 1 # fail 0; EXP-16 / EXP-14 / EXP-19 (in process, test lane): done scores before (61%) and after (37%) the humanizer — terminal and VERIFICATION.md, with timestamps and the backend |
| tests/honesty.test.ts (MockAgent lane) | PASS | # pass 12 # fail 0; honesty: the synthetic GPTZero cassette is still the documented response shape (DONE-04) / EXP-16: GPTZero 0.61 before and 0.37 after → "61% … (gptzero, <ISO>)" and "37% …", then the framing note verbatim / EXP-16: no key → skipped (no G… |
| tests/honesty-consent.test.ts (MockAgent lane) | PASS | # pass 2 # fail 0; EXP-17: in a terminal the first score asks once; "yes" is recorded and the second score sends without asking / EXP-17: "no" is recorded too — nothing is sent, now or on the next score |
| tests/gates-registry.test.ts (MockAgent lane) | PASS | # pass 15 # fail 0; RUN-28: GATES is one table of unique gates; --yolo never skips cost-cap, estimate-proceed, detector-consent, paper-pointer or the own-source gates |
| nothing reads tests/fixtures/cassettes/gptzero (the directory does not exist) | PASS |  |
| references/honesty-framing.md makes no undetectable / evade claim | PASS | The framing is TRANSPARENCY-ONLY. It states what the score means and what the |
| PENSMITH_OFFLINE=1 never shows a bare percentage (terminal and VERIFICATION.md) | PASS | honesty check (before humanize): unavailable (offline) / honesty check (after humanize): N/A (humanize skipped with --raw) |
| --no-score reports the skip | PASS |  |
| with GPTZERO_API_KEY=dummy the real GPTZero answers and the line is "unavailable (GPTZero rejected the API key[: <the service's own reason>])" | PASS | honesty check: unavailable (GPTZero rejected the API key: API key has no owner) |
| --no-score makes no detector request and reports the skip | PASS |  |
| honesty_score = false makes no detector request and reports the skip | PASS | honesty check: skipped (config: honesty_score = false) |

### EXP-17 — 6/6 checks pass

| Check | Result | Evidence |
|---|---|---|
| with the skill present and the humanizer call failing, the report says "humanizer failed: <reason>" | PASS | humanizer failed: anthropic (model claude-opus-5) failed with HTTP 500 api_error after retries — re-run later — exporting the compiled draft |
| a non-TTY --yolo run without recorded consent makes 0 detector requests and says why | PASS | before humanize): skipped (no consent recorded — run pensmith score (or pensmith done) once in a terminal and answer the detector question) |
| a paper whose config.toml says honesty_consent = true (a copied paper) sends nothing and says no consent is recorded | PASS | honesty check: skipped (no consent recorded — config.toml's honesty_consent = true is not your consent (a paper file cannot give it); run pensmith score (or pensmith done) once in a terminal and answer the detector question) |
| a non-TTY score with the user's consent recorded in the data dir makes one detector request | PASS | 1 request(s) to api.gptzero.me |
| under a pty the first score asks once and the data dir (detector-consent.json) records the answer; config.toml is untouched | PASS | asked 2 time(s) on screen (a redraw repeats it); detector-consent.json: { "$schemaVersion": 1, "papers": { "<accept>/ws/s5-live/paper": { "gptzero": true } } } |
| the second score in a terminal does not ask again | PASS |  |

### EXP-18 — 2/2 checks pass

| Check | Result | Evidence |
|---|---|---|
| honesty_backend = "foo" fails config validation listing gptzero, originality and sapling | PASS | pensmith: .paper/config.toml: humanizer.honesty_backend: honesty_backend must be one of: gptzero, originality, sapling |
| doctor reports GPTZERO_API_KEY, ORIGINALITY_API_KEY and SAPLING_API_KEY as present or absent, never their values | PASS | ✓ [PASS] runtime-config-presence: provider anthropic (global), model claude-opus-5 (default), key ANTHROPIC_API_KEY (global): present; endpoint GET http://127.0.0.1:33755/v1/models → 200: PASS; optional keys: OPENALEX_API_KEY absent, PENSMITH_S2_API_KEY abs… |

### EXP-19 — 2/2 checks pass

| Check | Result | Evidence |
|---|---|---|
| tests/plagiarism.test.ts (MockAgent lane) | PASS | # pass 13 # fail 0; EXP-19: every section contributes a phrase, in paper order, each 6–10 words of body prose — never the title, a heading, a citation, a quote, a list item or the references / EXP-19: the budget (plagiarism_max_phrases) caps the phrases; ra… |
| live lane: the Bleak House passage in §4 is reported with its location, or DuckDuckGo blocking is reported honestly | PASS | 23 DuckDuckGo request(s); FOUND with location: pensmith: plagiarism check: 17 distinctive phrase(s), one query at a time (DuckDuckGo refuses bursts) — about 1 min, at most 3 min if DuckDuckGo keeps refusing / pensmith: plagiarism check stopped at its time b… |

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
| `pensmith humanize` writes FINAL.md only after the gate (no export) | PASS | pensmith done: humanizer skill: <accept>/ws/s3-human/home/.claude/skills/humanizer/SKILL.md / pensmith done: humanizer: the improved text kept every heading, citation and quote and passed re-verification / pensmith done: wrote .paper/FINAL.md (humanized; `p… |
| tests/cli-verbs.test.ts still asserts 16 verbs (pass) | PASS | # pass 3 # fail 0 |

### GRND-11 — 9/9 checks pass

| Check | Result | Evidence |
|---|---|---|
| `new --mode outline --yolo` then bare `pensmith --yolo` runs research, outline and done, then stops | PASS | ran: research → outline → done |
| the routed done (no --format) writes the outline and annotated bibliography as both .md and .docx (review round 2) | PASS | export/ = ANNOTATED-BIBLIOGRAPHY.docx, ANNOTATED-BIBLIOGRAPHY.md, CITATIONS.bib, CITATIONS.ris, OUTLINE.docx, OUTLINE.md |
| a further bare run stops at status (done) and makes no model call | PASS | pensmith: ran status (done: outline only — complete: export/OUTLINE.md, export/ANNOTATED-BIBLIOGRAPHY.md, export/OUTLINE.docx and export/ANNOTATED-BIBLIOGRAPHY.docx — to draft the paper, set mode = "draft" under [project] in .paper/config.toml, or run a sec… |
| no sections/*/DRAFT.md is ever created | PASS |  |
| `pensmith status` reports outline only, complete, with the deliverables | PASS | mode: outline only / current: complete / next: status (done) / note: outline only — complete: export/OUTLINE.md, export/ANNOTATED-BIBLIOGRAPHY.md, export/OUTLINE.docx and export/ANNOTATED-BIBLIOGRAPHY.docx — to draft the paper, set mode = "draft" under [pro… |
| .paper/ANNOTATED-BIBLIOGRAPHY.md lists per source the styled reference, an abstract excerpt, why it is relevant and the sections it supports | PASS | 6 sources; first: Cai, J., Kaleem, M. A., Genov, R., Azghadi, M. R., & Amirsoleimani, A. (2024). In-Memory Transformer Self-Attention Mechanism Using Passive Memristor Crossbar. *2024 IEEE International Symposium on Circuits and Systems (ISCAS)*, 1–5. <http… |
| export/ holds OUTLINE and ANNOTATED-BIBLIOGRAPHY as .md and (with --format docx) .docx, all passing the zero-trace scan | PASS | export/ = ANNOTATED-BIBLIOGRAPHY.docx, ANNOTATED-BIBLIOGRAPHY.md, CITATIONS.bib, CITATIONS.ris, OUTLINE.docx, OUTLINE.md; scans clean |
| with a fabricated source in the library (listed by the outline), outline-mode done exits 4 and exports nothing | PASS | - citation [@fake2024a] is FABRICATED — DOI 10.99999/fake.001 did not resolve via Crossref (no registration agency holds its prefix 10.99999) |
| tests/router-outline.property.test.ts covers the outline-only terminus (pass) | PASS | # pass 1 # fail 0 |

## 5. Review history

The phase had three review rounds after the integration pass, with 75 reported findings in all, several of them duplicates (21-SUMMARY §6–§8 lists each fix and its tests). The close-out then found and fixed one more defect, the unbounded plagiarism back-off (§4; 21-SUMMARY §9):
- **Round 1: 28 findings, all fixed.** These were the rewrite guard (boundary moves, claim swaps, fence markers), the zero-trace scope (author URLs, docx `.rels` targets), the pandoc sandbox and images, PDF characters on every path, notes in tables and headings, consent moved to the data dir, strict config for `score` / `plagiarism`, the `humanize` record (`exported`), outline-only record and write order, the annotated bibliography's unverified attributions, locator and note-punctuation parity with pandoc, the `--style` working directory, an unparseable INTAKE.md, dead code and docs.
- **Round 2: 24 findings fixed.** Three suggestions inside findings were not adopted, each with its reason: `isNoteStyle` is not dead; the TeX CI step is deferred to HARDEN-04 instead; and `llm-port.ts` exists only on the 23b branch. The fixes covered short-root and generator-comment false positives, the PDF text scan, note placement and soft breaks, SICI autolinks, reference-style links, the rejected-humanization loop, anchor false positives, the `humanize` write order (DONE-RECORD v4), the four-part skill reply, the `csl-style` gate and the rendered-identifier defence, staging, stale formats, the outline md+docx pair, heading demotion, dead exports and docs.
- **Round 3: 23 findings, all fixed** (EXP-09 kept open). These were the invented-claim anchor check plus Pass 2 on rewritten sentences, the RIS `<…>` regression, the `.csl` opened before approval, the abstract excerpt, affix emphasis, braced locators, the PDF long-token speed, plagiarism headings, the staging folder, the skill resolver, DuckDuckGo pacing and coverage, `--only export` keeping the scores, MLA "Works Cited", the Originality.ai reason, the title from the topic, the outline stub, registrar-only abstracts, the zero-trace prescan, `plan` / `verify` routing in outline mode, workflow docs, the merge notes and the 21-CONTEXT amendments.

## 6. Open items and follow-ups

| Item | Owner | Detail |
|---|---|---|
| EXP-09: LaTeX compiles in the CI export job, with and without pandoc | HARDEN-04 (Phase 26) | Install tectonic (or TeX Live) on the three CI legs, warm tectonic's bundle cache (`--only-cached` under offline sources), and run `tests/latex-standalone.test.ts` with `PENSMITH_REQUIRE_TEX=1`; then mark EXP-09 Complete and tick Phase 21. |
| The first CI run of Phase 21 code (macOS, Windows; the pandoc steps) | CI-06 (maintainer push) | `zero-trace-export` Test J, `docx-writer`'s read-back and HARDEN-03 require pandoc when `CI=true`; ci.yml installs pandoc 3.9 on all three OSes. |
| Keyed live GPTZero, Originality.ai (Enterprise plan) and Sapling scores | maintainer / HARDEN-02 live lane (Phase 26) | Built and tested against MockAgent lanes; the real GPTZero's 401 on a dummy key was observed live. |
| Stripping image metadata on embed | BRDTH-02 (Phase 25) | The scanner flags EXIF, XMP and PNG text chunks in embedded media and refuses such an export; nothing strips them yet. |
| The Phase 23b merge | Phase 23b | 21-SUMMARY §4, the round 1–3 merge notes and the close-out's note (`PlagiarismPacing` gains `maxBackoffMs` and `budgetPerPhraseMs`; new `budgetSpentReason`) list every changed exported signature. Two points matter most. First, done.ts and compile.ts import `anthropic.js` and must switch to `llm-port.js`. Second, the Tier-1 smoother, humanizer and done tools must call `validateRewrite` / `acceptHumanized` and keep the record order (DONE-RECORD before FINAL.md), `FINAL.rejected.md`, `EXPORT.refused.md` and the `csl-style` gate. |
| Live DuckDuckGo coverage | none (the product reports it) | The bot challenge varies by day; on the close-out day it refused about two queries in three. The run is bounded (each back-off at most 30 s, 12 s per phrase in all; `25b758d`), and the report names unanswered phrases, uncovered sections and an INCOMPLETE run. |
| lualatex in this container | environment | Its luaotfload font cache is broken here. Engine detection tries pdflatex first. |
