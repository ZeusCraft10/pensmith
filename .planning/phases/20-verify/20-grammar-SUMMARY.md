# Phase 20 — stream `grammar` summary

**Branch:** `v1/p20-grammar` (from the plan commit `1e43b9e`; seam S-C applied first as `1a9ecf0`, hashes checked against `seams/README.md`).
**Requirements:** VRFY-09, VRFY-10 (forms), VRFY-21, VRFY-22 (Pass-2 side), VRFY-23 (Pass-4 side), HARDEN-03 (Properties A, B and the text half of C).
**Decisions implemented:** D-20-06, D-20-07, D-20-08, D-20-09, D-20-28, D-20-29, D-20-30.

## What changed

### VRFY-09 — one grammar, enforced (D-20-06, D-20-07)

- `bin/lib/citation-token.ts`
  - `citationItems` returns, for every Pandoc form, `prefix`, `key`, `suffix` (locator included, as before), `locator` and `label` (when the suffix opens with one), `suppressAuthor` and `narrative`.
  - `LOCATOR_TERMS`, `LOCATOR_VALUE_RE` and the new `splitLocator(suffix)` moved here from `exporter.ts`. The exporter's `toCslItem` now calls `splitLocator`, with the same result: `tests/exporter.test.ts` (the locator, prefix, `-@k` and numeric-style render cases) passes unchanged.
  - `findUnparseableCitations(md): TextFinding[]` reports four forms outside provable code. Each finding has its text (one line, at most 80 characters), a 1-based CRLF-safe line and a one-line reason:
    - `empty-key`: `[@]`, `[@ k]`, `[-@]`, `[@k; @]`;
    - `unbalanced-bracket`: `[@k`, `[see @k …`;
    - `unterminated-braced-key`: `@{x`, `[@{two words}]`;
    - `nested-bracket`: `[@k [see note]]`, `[see [x] @k]`, `[@k, p. [5]]`.
    An `@` Pandoc cannot read as a citation start (`name@host`, `\@k`) and an escaped `\[` are never reported.
  - New exports for the text scanners: `provableCodeSpans`, `offsetInSpans` and `lineOfOffset`.
  - The code proof (`codeSpans`) now looks for the unmodelled constructs (raw HTML, raw TeX, comment openers) outside the interiors of the proven fenced blocks. A bare CR, a BOM or a table rule anywhere still voids it. Without this change, a fenced block holding `\cite{}` would have voided the proof for the whole document, and D-20-08's negative corpus requires that block to report nothing. The change is checked against pandoc 3.9 by six new cases in `pandoc-cites.json`: three `expect: "equal"` cases (TeX, HTML and a comment opener inside a fence) and three where the proof must still turn off.
- The private citation regexes are gone, replaced by grammar calls:
  - `pass2.ts:81` and `pass4.ts:104` were rewritten;
  - `citation-density.ts:147` and `llm-text-stubs.ts:195` now call `replaceCitations`;
  - `plagiarism.ts:102` also carried one; it is not in any stream's owned list, but the new chokepoint row made the edit necessary, and it now calls `replaceCitations`.
- Chokepoint row `citation-grammar` (`scripts/chokepoints/citation-grammar.json`):
  - scope `bin/**`, `mcp/**`, `hooks/**` (`.ts` and `.mjs`); allowed only in `bin/lib/citation-token.ts`;
  - new matcher kind `regex-literal` in `scripts/eslint-rules/chokepoint.mjs` (plus its `MATCH_KINDS` entry and `.d.mts` type). It matches a regex literal's `node.regex.pattern`, or the static text of a `RegExp(…)` / `new RegExp(…)` / `globalThis.RegExp(…)` pattern. Static text means a string, a template, `String.raw`, a `+` concatenation or a same-file const.
  - The pattern covers `\[` optionally followed by whitespace-class or `-` tokens and then `@`, and `@\{` or `@{` (but not `@{2}`).
  - Failing fixture `tests/fixtures/chokepoints/citation-grammar.violation.ts.txt`.
  - `tests/chokepoints.test.ts` gains two things. The first is a harness that re-lints every in-scope file with the rule alone and `allowInlineConfig: false`, so an inline disable cannot hide a violation. The second is a semantics test covering literals, RegExp strings, `String.raw`, const concatenation, `globalThis.RegExp`, dynamic patterns, the allowed module, the mcp/ and hooks/ scope, and tests/ being exempt.
  - The CLAUDE.md table row is now a real row; `regex-literal` is added to the list of row kinds.
  - `npm run lint` passes on the whole tree with the row active.

### VRFY-10 — unsupported forms (D-20-08)

`bin/lib/verify/unsupported-forms.ts` `findUnsupportedForms(md): TextFinding[]` (verdict `UNSUPPORTED-FORM`). Forms:

- `author-date`:
  - parenthetical and bracketed APA / Harvard / Chicago-author-date forms, including two authors, `et al.`, corporate authors with `[WHO]`, prefixes, particles, diacritics, `n.d.` / `in press`, and MLA with two names or `et al.`;
  - narrative author-date with two names or `et al.`, possessive included.
  - Not flagged: a lone "Name (1919)", year ranges, and dates or structural words ("(March 2020)", "(Figure 3)", "(Study 2, 2019)").
- `footnote`: references and definitions.
- `inline-note`: `^[…]`.
- `reference-list`: an ATX, setext or bold/emphasised heading, or a lone label line, naming References, Reference List, Bibliography, Works Cited, Works Consulted, Literature Cited, Notes, Endnotes, Footnotes, Sources, Citations or Further Reading. The heading and each entry under it up to the next heading are reported.
- `tex-cite`: the `\cite` family, starred and bracketed options, `\nocite`, `\bibliography`, `\bibitem`, `thebibliography`.
- `html-cite`: `<cite>`, `<ref>`, and `<sup>` reference markers. An exponent such as `m<sup>2</sup>` is not flagged.
- `numeric-marker`: `[1]`, `[2, 3]`, `[4–6, p. 12]`. Array indexes, reference links, link definitions and math are excluded.
- `superscript-marker`: `^1^` and Unicode superscripts after a word or punctuation.

Only provable code and TeX math are skipped; everything else is scanned (fail closed). A finding nested inside another is reported once, by the outer one. `tests/unsupported-forms.test.ts` covers every case with a CRLF twin, the negative corpus (which yields nothing), the audit's V4 / V6 / V7 draft, and the stub drafter's prose (no UNSUPPORTED-FORM row).

### VRFY-21 / VRFY-22 — Pass 2 on real source text (D-20-28)

`bin/lib/verify/pass2.ts` was rewritten.

- **Pairs.** Pass 2 judges one pair per (citing sentence × `citationItems` key), each once. Sentences come from Pass 4's splitter (`draftSentences`), which never splits inside a citation.
- **Source text.** In order:
  1. the LIBRARY.json abstract, through the new `source-context.ts` `claimSupportAbstract`: one line, surrogate-safe clip at 4000 characters;
  2. otherwise the bib `abstract`;
  3. plus the passage from the optional `fullText(citekey, claim)` provider, when `[verification] fetch_full_text` is not false. The setting is read from config.toml, or from `opts.fetchFullText`. The passage is clipped at 2400 characters, and a provider that throws leaves the abstract;
  4. plus BYO passages, only with `send_byo_passages`.
  Each part is labelled.
- **No text.** A source with no text gives `UNCLEAR` "no source text (no abstract or full text)" and no request.
- **Concurrency.** `Semaphore(5)`; the session cost cap and other fatal errors are rethrown after the requests in flight settle.
- **LLM stubbed.** No request and no full-text or BYO read.
- **Evidence.** Kept only as a verbatim substring of the text sent.
- **Table.** `renderPass2Section` writes `PASS2_TABLE_HEADER` with the Evidence column. Every cell is one line, pipe-free and tag-free; the sentence is clamped at 120 characters, the rationale at 200 and the evidence at 160. `done`'s seam reader (`readSectionUnsupported`) reads the evidence back.
- **API.** `runPass2(draft, bib, { n, root?, shareByoPassages?, fullText?, fetchFullText? })`; `claimSupportRequest(citekey, sentence, bibEntry, sourceText)`; `pass2NotRun` (per pair); `NO_LLM_SKIP_REASON` is kept. `reportAdvisoryFailure` moved to `pass4.ts` and is re-exported from `pass2.ts` (this removes a pass2↔pass4 import cycle).
- **Prompt.** `claim-support.md` now says "source text" and its input tag `abstract` became `source_text`. It was re-pinned in `EXPECTED_PROMPT_HASHES` and `tests/repo-files.test.ts` (`44727c65…`), and `PROMPT_INPUTS` was updated.

### VRFY-23 — the Pass 4 floor and the per-paragraph audit (D-20-29)

`bin/lib/verify/pass4.ts` was rewritten.

- **Paragraphs.** `proseParagraphs` skips headings, fenced code, table rows, rules, setext titles and comment lines, and is CRLF-safe. Paragraphs are numbered from 1.
- **Sentences.** `draftSentences` splits on a terminator plus closing quotes, never inside a citation. A trailing citation that stands alone joins the sentence before it.
- **The floor.** A sentence is a claim when it has at least 8 words (citations not counted), is not a question and not a definition, and holds one strong marker from these classes:
  - causal verbs;
  - universal quantifiers;
  - evidential verbs in every inflection;
  - statistics or percentages;
  - comparative change;
  or two distinct weak markers (the R6 list). A claim is an orphan when the sentence carries no citation of any Pandoc form.
- **The audit.** `orphan-label.md` was rewritten as the per-paragraph audit: input `paragraph`, output `{claims:[{sentence, needs_citation, supported_by}]}`. It runs once per paragraph with a claim or an ambiguous sentence, and it can only add orphans. An added orphan must be marked `needs_citation`, name no key the paragraph cites, match a sentence of the paragraph and carry no citation. The deterministic count is a floor. With no provider key the audit is skipped; any other failure gives one WARN and the floor stands.
- **Contract, stub, inputs, pins.** The contract is the new `OrphanLabelSchema` (claims required; a bare array root of claim objects is coerced). The stub is `{claims: []}`. `PROMPT_INPUTS['orphan-label'] = [paragraph]`. Re-pinned in both hash maps (`c1d45a9f…`).
- **Result.** `Pass4Result` gains `orphans: string[]`.
- **Render.** `renderPass4Section` prints an "Orphan claims: N" line and one row per paragraph: Paragraph, Sentences, Claims, Orphans, and the orphan sentences (quoted, clamped at 140, table-safe, marked `(audit)` when the audit added them).
- **Slug estimates.** `llm-models.ts` and the estimator comment were updated to the new request sizes:
  - orphan-label: max 2000 tokens, p90 500, input 1800;
  - claim-support: input 2200.

### HARDEN-03 — the Pandoc oracle (D-20-09)

- **The test.** `tests/citation-integrity.property.test.ts`:
  - **Generator.** fast-check, `numRuns` 1000 by default, raisable with `PENSMITH_PROPERTY_RUNS`, never below 1000; seed from `PENSMITH_PROPERTY_SEED`, else random and printed. Drafts mix every citation form, the UNPARSEABLE shapes, every unsupported form and noise, with LF or CRLF.
  - **Batching.** Drafts go to pandoc in batches of 250 as fenced Divs. A batch whose Divs do not come back one per draft, or a draft whose footnote labels collide with another draft in the batch, is re-run on its own.
  - **Shrinking.** `fc.sample` and `fc.assert` share the seed, so `fc.assert` looks drafts up in the precomputed Pandoc keys; a shrunk draft goes to pandoc alone.
  - **Properties.** A and B (structural, over every draft), and C's text half (a draft with a flagged form always carries a finding).
  - **Samples.** Pass 1 over an empty bib gives every Pandoc key FABRICATED and a blocked outcome (40 drafts). The real offline exporter renders only Pass-1 keys (25 drafts; a unique author per key, and the test checks it is not vacuous).
  - **Fixed example.** `Claim A [@smith2020 [see note]].`
  - **Pandoc presence.** With pandoc missing, `CI=true` fails; otherwise one loud stderr line and a skip.
- **CI.** `ci.yml` installs pandoc 3.9 (`r-lib/actions/setup-pandoc@v2`) on every runner, then runs `pandoc --version`.
- **Pandoc-checked grammar.** `tests/citation-grammar-pandoc.test.ts`:
  - new fixture `tests/fixtures/citation-grammar/unparseable.json`, 15 cases, with Pandoc's recorded Cite clusters, modes and literal text;
  - each rule must agree with Pandoc, live when pandoc is on PATH:
    - empty and unterminated keys: Pandoc prints them as text;
    - an unbalanced bracket: Pandoc prints the `[` around an AuthorInText citation;
    - a nested bracket: Pandoc reads a NormalCitation that `findCitations` reads as narrative;
  - negatives: Pandoc reads exactly what the grammar reads.
- **Recorder.** `scripts/record-pandoc-cites.mjs` re-records both corpora; it is unowned and was extended in place.

## Tests updated, and why

| Test | Why |
|---|---|
| `tests/known-bad-pass4.test.ts` + `tests/fixtures/pass4-orphan.json` | The expectations came from the old R6-only rule and 500-character proximity. The fixture is now `{ $comment (the rule), cases }` with `expected_orphans` per case. Counts were recomputed by hand from the new rule (walk in each description): the canonical Climate paragraph 1 → 2 and the "Every HIGH claim…" paragraph 0 → 1. New cases: both register sentences (uncited → 2, cited → 0, a CRLF twin), the "demonstrated … 40 percent" and "doubled … because" sentences, every Pandoc form at sentence level, the next-sentence citation that no longer covers a claim, and a trailing citation. The old existence-conditional skip guards are gone. |
| `tests/known-bad-pass2.test.ts` | The skip guards are gone. New mock-LLM cases assert that evidence is kept, is a substring of the abstract and appears in the Evidence cell, and that invented evidence is dropped (VRFY-22). |
| `tests/pass2-injection.test.ts` | The `abstract` block became `source_text`, and the orphan-label request is one `paragraph` block (`orphanAuditRequest`). |
| `tests/llm-contracts.test.ts`, `tests/mock-llm.test.ts` | The orphan-label probe used the `{label}` object; it now uses `{claims}`. In mock-llm's RUN-12 case the bib entry gained an abstract, because Pass 2 with no source text makes no model call (D-20-28). |
| `tests/prompt-request.test.ts`, `tests/prompt-cache.test.ts` | The `source_text` / `[paragraph]` inputs. |
| `tests/repo-files.test.ts` | The two prompt pins. |
| `tests/chokepoints.test.ts` | The regex-literal harness and semantics tests. |
| `tests/citation-token.test.ts`, `tests/citation-density.test.ts`, `tests/citation-grammar-pandoc.test.ts` | New grammar cases. |
| `tests/export-gate.test.ts` (gate's) | Separate commit `test(20-grammar): export-gate …`. Its `Pass4Result` literal gains the new required `orphans` field. No assertion changed. |
| `tests/llm-transport.test.ts` (unowned) | Separate commit `test(20-grammar): llm-transport …`. T-11-01 probed the orphan-label stub for `.label`; it now asserts the stub's `claims` array. |
| `tests/verify-no-llm.test.ts` (gate's) | Separate commit `test(20-grammar): verify-no-llm …`. The seeded bib entry gains an abstract. Three cases (no key → skipped; the MCP tool with no key; the cost cap after the verdict) are about Pass 2's model call, and a source with no text now makes none (D-20-28). No assertion changed. |

New tests: `citation-integrity.property.test.ts`, `unsupported-forms.test.ts`, `citation-unparseable.test.ts`, `pass2-pairs.test.ts`, `pass4-floor.test.ts`.

## Files under the folders Phase 23a moves (re-apply after PLUG-02)

- `templates/prompts/claim-support.md` (re-pinned `44727c65d9ffec142d9d0a8419c4caad551ea0a243efd655b9bc48c069275bf4`)
- `templates/prompts/orphan-label.md` (re-pinned `c1d45a9f9c7d74889a5f476a2f1b2e847e4edfae96ddf6604479da5334979dc0`)

No workflow, skill, agent or reference file was touched.

## Files outside the owned list (minimal edits)

- `bin/lib/plagiarism.ts`: its private `\[@` regex fails the new chokepoint row; it now calls `replaceCitations`.
- `bin/lib/llm-models.ts`: the orphan-label and claim-support request-size estimates.
- `bin/lib/estimator.ts`: one comment line.
- `scripts/record-pandoc-cites.mjs`: now also records `unparseable.json`.
- `tests/export-gate.test.ts`, `tests/llm-transport.test.ts`, `tests/verify-no-llm.test.ts`: see above.
- `CLAUDE.md`: the chokepoint row, the kinds list and the Verify-paragraph grammar sentence.
- `PRD.md`: the §7.7 Pass 2 and Pass 4 bullets.

## Deviations

- **Extra forms (D-20-08).** Besides the listed forms, the scanner also reports `numeric-marker` (`[1]`) and `superscript-marker` (`^1^`, `¹`), both further ways to attribute a source. The plan's negative corpus names `$[1]$`, which only matters if `[1]` is flagged. The `form` strings are outside the seam's comment list; `TextFinding.form` is typed `string`.
- **Code proof refined (D-18-42).** The shared `codeSpans` now ignores unmodelled constructs inside proven fenced blocks, instead of adding a second proof for the unsupported-forms scanner. Pandoc agrees on the new corpus cases.
- **Tag renamed.** claim-support's input tag is renamed `abstract` → `source_text`. D-20-30 only asked for the wording; the tag now says what the block holds.
- **Pass 2 concurrency.** Requests are capped at 5 in flight, but `http.ts` admits at most one model request per host every 200 ms (a one-token bucket at the generic 5/s). Real providers take seconds per answer, so in practice five run at once; `pass2-pairs` shows ≤ 5 and > 1 with an 800 ms mock.
- **Locators unchanged.** `ch.` is not a locator term, as in Pandoc (pandoc 3.9 `--citeproc` prints `ch. 2` as a suffix), and a number with no comma is still a suffix. Pandoc reads `[@k 33]` as page 33; the offline exporter's existing behaviour was kept ("no change to exports"). This is a possible later EXP item.

## Handed to the integration pass (§7)

1. **Gate wiring (gate).** `gate.ts` turns `findUnparseableCitations(text)` and `findUnsupportedForms(text)` findings into Pass-1 rows keyed `L<line>` (verdicts `UNPARSEABLE` / `UNSUPPORTED-FORM`, with the finding's `text` and `reason`), over section drafts, the compiled DRAFT.md and FINAL.md. PRD §7.7's Pass-1 and output paragraphs (registrar / gate regions) should then name the two verdicts.
2. **fullText provider (quotes).** verify passes `runPass2(…, { fullText: (key, claim) => sourceTextPassage(root, key, claim) })`. `runPass2` already honours `[verification] fetch_full_text`; the provider must never return BYO text.
3. **Pass 4 over the export (gate).** done runs `runPass4` whole-paper over the exact exported text (VRFY-23's done-level acceptance) and lists `Pass4Result.orphans` in the confirmation. `renderPass4Section` is ready for the paper-level `.paper/VERIFICATION.md`.
4. **VRFY-22 done side (gate).** The `unsupported-claims` gate reads `evidence` from `readSectionUnsupported` (already parsed by the seam reader).
5. **HARDEN-03 Property C through the gate core.** Run the generated drafts through `recomputeGate`.
6. **Docs (integration docs sweep).** CONTRIBUTING (the property test, pandoc, `PENSMITH_PROPERTY_SEED`, re-recording the corpora) and README (the verdict names).
7. **Phase 23a.** The concurrent `ci.yml` edit (CI-05) must keep the pandoc step before the test steps.
8. **Tests in other streams.** Any test that expects a Pass-2 model call (the "skipped (no LLM configured)" line, a cost-cap stop in Pass 2, a scripted claim-support reply) must seed a source with text — an abstract in the bib or LIBRARY.json. A source with no text is now UNCLEAR "no source text" and makes no request (D-20-28). Three such tests on this branch were updated; the others' tests may hit the same after the merge.

## Verification

All results are on this branch in the worktree.

- **Stream gate.**
  - `npm run prebuild && npm run lint && npm run typecheck && npm run build` are green, and the tree is clean after the build.
  - `npm run validate:manifests` is green.
  - `npm run test:tier-contract`: 57/57.
- **Full suite (`npm test`).**
  - Without pandoc: 2488 tests. Every failure is either the root-only `atomic-write` case or one of the three `verify-no-llm` cases, since fixed and re-run green (6/6). The four HARDEN-03 tests are skipped with the one stderr line.
  - With pandoc 3.9 on PATH and `CI=true` (as CI runs it): 2487/2488. The only failure is the root-only `tests/atomic-write.test.ts` "preserves OLD content on rename/write failure" case.
- **The chokepoint row.** `tests/chokepoints.test.ts` 35/35: the citation-grammar fixture fails lint, and the real tree passes both the ESLint rule and the inline-disable-immune harness.
- **HARDEN-03.** `node scripts/run-tests.mjs tests/citation-integrity.property.test.ts`:
  - with pandoc: 1000 drafts in 6–15 s, with the real-exporter and Pass-1 samples, 4/4; 3 × 4000 drafts (random seeds) also green;
  - without pandoc: one "HARDEN-03 SKIPPED" line, 4 skipped;
  - `CI=true` without pandoc: 4 failures, "CI=true requires it".
- **The pandoc agreement tests.** `tests/citation-grammar-pandoc.test.ts` 6/6 against recorded pandoc 3.9 readings, and live with pandoc 3.9 on PATH (which also drift-checks the recordings).
- **User path.** A scratch paper, built CLI, `PENSMITH_OFFLINE=1` sources, and the RUN-21 mock LLM configured through the isolated global runtime.json; `verify 1 --yolo` exits 0 and VERIFICATION.md shows:
  - the Pass-2 table with the Evidence column (`SUPPORTED` rows quoting the abstract; an `UNSUPPORTED` row with evidence);
  - the per-paragraph Pass-4 table;
  - the two register sentences uncited: "Orphan claims: 2", both sentences listed in paragraph 2;
  - the same sentences cited (`[@lecun2015]`, `[@aspelmeyer2009, p. 4]`): "Orphan claims: 0".
  The captured requests carry the abstract inside the fenced `<source_text>` block.
- **Scanner cost.** On a 180 KB draft the three scanners take 30 ms, 130 ms and 320 ms; pathological inputs (20 000 open brackets, 50 000 `@`, long capitalised runs) stay under 150 ms.

## Environment note

During this stream the container's disk filled up (ENOSPC). The test suites of every stream leak `/tmp/pensmith-*` temp dirs, about 85 000 of them over the session. Leaked dirs older than three hours were removed to finish the runs. The leak itself (tests that never remove their `mkdtemp` dirs) is worth a CI-09 / HARDEN follow-up.
