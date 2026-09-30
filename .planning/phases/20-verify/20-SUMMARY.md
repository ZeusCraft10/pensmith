---
phase: 20-verify
status: integrated on akhil/pensive-faraday-qx3o58 (streams merged, cross-stream wiring and acceptance done); close-out (20-VERIFICATION.md, REQUIREMENTS / ROADMAP / STATE) pending
requirements: [VRFY-09, VRFY-10, VRFY-11, VRFY-12, VRFY-13, VRFY-14, VRFY-15, VRFY-16, VRFY-17, VRFY-18, VRFY-19, VRFY-20, VRFY-21, VRFY-22, VRFY-23, VRFY-24, VRFY-25, VRFY-26, VRFY-27, VRFY-28, VRFY-29, HARDEN-03]
streams: [grammar (v1/p20-grammar 857d26c), registrar (v1/p20-registrar 2bab275), quotes (v1/p20-quotes 8ebdbf0), gate (v1/p20-gate 95959e2)]
---

# Phase 20: Verifier Completeness (VERIFY) — Summary

Four streams built Phase 20 in parallel on seam S-C, then an integration pass merged them, wired the cross-stream paths (20-PLAN §7.2), added the cross-stream acceptance suites (§7.3), ran the live lanes and swept the docs. The stream write-ups are [20-grammar-SUMMARY.md](20-grammar-SUMMARY.md), [20-registrar-SUMMARY.md](20-registrar-SUMMARY.md), [20-quotes-SUMMARY.md](20-quotes-SUMMARY.md) and [20-gate-SUMMARY.md](20-gate-SUMMARY.md).

## What the phase delivers

- **One citation grammar, and every other form refused (grammar).** `citation-token.ts` is the only citation parser (chokepoint row `citation-grammar`); text it cannot read is UNPARSEABLE and every other attribution (author-date prose, footnotes, a typed reference list, `\cite`, `<cite>` / `<sup>`, numbered markers) is UNSUPPORTED-FORM; Pass 2 judges every (sentence, key) pair on the source's text with evidence; Pass 4 has a deterministic floor plus a per-paragraph audit; HARDEN-03's pandoc-oracle property test.
- **Every identifier at its registrar (registrar).** DataCite, doi.org content negotiation, the metadata search for identifier-less entries, UNVERIFIABLE-NETWORK for every no-answer path, the name/title/year match, relation-asserted aliases, OK-BYO, RETRACTED, bare identifiers, PubMed abstracts, `last_verified` and `FetchOptions.refresh`, the live lane `npm run live:verify`.
- **Quotes against real text (quotes).** The extractor rewrite (ids, `quote_min_words`, UNATTRIBUTED), the source order (the user's PDF, every Unpaywall PDF, Europe PMC, arXiv), the extracted-text cache, PASS / FUZZY / NOT_FOUND / UNVERIFIABLE-QUOTE / UNVERIFIABLE-NETWORK, the known-bad-quotes production-path suite.
- **One gate core, three callers (gate).** `verify/gate.ts` recomputes every blocking row for one text; verify, compile and done run it over the exact bytes they process and trust no local file; per-quote acceptance (`--accept-quote`, the `quote-accept` gate, QUOTE-ACCEPTANCES.json); the summary-first VERIFICATION.md; UNASSIGNED, NO-CITATIONS, PLACEHOLDER; COMPILE-INPUTS v2 and stale refusals; the `unsupported-claims` gate and the paper-level decisions; the recheck clock.

## Integration pass (a0bac6d..HEAD, after the four merge commits)

**Merges** (`--no-ff`, in the order grammar, registrar, quotes, gate). Conflicts: `CLAUDE.md` (each stream's Write / Verify / Compile paragraphs combined), `bin/lib/verify/pass3.ts` (quotes' rewrite over the seam), `bin/cli/verify.ts`, `compile.ts`, `done.ts`, `verdict-rows.ts` (gate's versions over the seam — no other stream edited them outside the seam hunks), and five tests two streams had edited (`bare-chain`, `dry-run-chain`, `pass3-byo-cli`, `tier-contract`, `verify-retraction-cli`; both intents kept).

**Cross-stream wiring (§7.2).**
- gate ← grammar: `TEXT_SCANNERS` = `findUnparseableCitations` + `findUnsupportedForms`; their rows (key slot `L<line>`) block in section drafts, the compiled DRAFT.md and FINAL.md.
- gate ← quotes: the recheck set reaches `runPass3` (`Pass3Options.refresh`), and Pass 3's Unpaywall lookup honours it (`lookupOaPdfUrls(doi, { refresh })`).
- verify ← grammar/quotes: `runPass2(…, { fullText: sourceTextPassage })`, only when a model is configured (no key: nothing is downloaded for skipped pairs).
- verify ← registrar: `runFreshnessForDraft(…, { bibEntries, root })` (the parsed entries; the live re-check of `unknown` retraction statuses).
- `blockingRowReason` / `gateRowReason` / the router's attention: UNVERIFIABLE-NETWORK says "re-run online"; UNVERIFIABLE (an answer that cannot be compared) and RETRACTED name the row's own reason (the verdict-row parser keeps each row's reason).
- write ← quotes: GRND-14 containment counts quotes at `[verification] quote_min_words`.
- The extractor's code probe replaced by the grammar's `provableCodeSpans`.
- write ← grammar: containment reports a citation form the verifier cannot check (`uncheckable-citation-form`, the same scanners) — one corrective turn asking for `[@citekey]` tokens, then the FEED-04 failure path — so a model that adds a reference list or author-date citations is corrected at write instead of being blocked at verify.

**Found and fixed during integration.**
- `done` with no compiled draft (compile refused) exited 1 for an unverifiable or retracted section: it now lists the sections' recorded blocking rows and exits 4 (RUN-09), naming e.g. `citation [@wakefield1998] is RETRACTED — …` (VRFY-15).
- done's advisory summary names the uncited claims (VRFY-23), not only their count.
- `add` refused every DataCite DOI ("this version adds DOIs registered with Crossref only"): it now reads a DataCite DOI at DataCite and an mEDRA / JaLC / KISTI DOI through content negotiation, as Pass 1 does (VRFY-11); the withheld-source wording no longer names Zenodo / figshare / Dryad (source-context.ts remedy, README, PRD §7.3, workflows, skill).
- `done.ts reCheckFinalMd` was dead code after the gate core replaced it; removed, and its three test files moved to what done runs (`citedKeySetChange` + `recomputeExportGate`).
- VERIFICATION.md's summary labelled an unanswered freshness probe `unknown`; it is `not probed`, and a DOI whose agency publishes no retraction data is counted as `retraction status unknown` (D-20-13).
- `--accept-quote` on an unattributed quote said `([@(unattributed)])`; it says `(no citation)`.
- HARDEN-03's generator made a clean draft only ~1 time in 10, so its coverage assertion (> 10% clean) failed on some seeds (seed 1645320681); a quarter of the drafts now come from clean blocks.
- "an Europe PMC answer" → "a Europe PMC answer".
- With a missing or empty CITATIONS.bib the gate core rewrote every FABRICATED row to "the bibliography is missing / has no entries", including a bare identifier found in the prose, whose verdict came from its registrar; only cited keys' rows are rewritten now (`tests/gate-core.test.ts`).
- The live e2e recording found two IEEE records that Crossref holds with the family and given names swapped ("Qi, Lin", "Xiulian, Du"), which Pass 1 called MIS-CITED. `name-match.ts` `authorSimilarity` now also reads the two names crosswise; both parts must match, and an initial matches the name it begins, so a different person still fails (`tests/name-match.test.ts`).
- A **verified** section whose DRAFT.md was deleted still let the walk go on to compile, which could only refuse it (`missing … DRAFT.md — run \`pensmith write 1\``), and every bare run then said `ran compile (exit 4); next: compile`. The router now sends it to write like a written, verifying or unverifiable section without its draft (VRFY-16; `tests/pensmith-router.test.ts`, `tests/verify-malformed-bib.test.ts` through the built CLI). `workflows/next.md` still described the pre-S-13 routing (an unverifiable section as attention naming `verify N`, and "compile accepts" an unverifiable section); it now says the walk goes past it and compile refuses it with its options.
- The test runner leaked every test's mkdtemp dir into the system temp dir (the streams filled a disk with ~85k of them): `scripts/run-tests.mjs` points `TMPDIR` / `TEMP` / `TMP` at the per-run dir (the data dir is its `data/`), deleted with the run.

**Cross-stream acceptance suites (§7.3).**
- `tests/verify-quote-flow-cli.test.ts` (built CLI): UNVERIFIABLE-QUOTE q1 and compile's refusal naming the three remedies; `add <pdf>` → NOT_FOUND for the fabricated quote, PASS "verified against your local file" for a real one, listed by COMPILE-REPORT.md and done; `--accept-quote q1` → compile, COMPILE-REPORT and done list it with its timestamp, one changed byte voids it; VRFY-23's orphan sentences at done.
- `tests/verify-cache-recheck.test.ts` (in process, MockAgent counting requests): a wave verify of three sections stamps every `last_verified`; compile and two dones recompute with zero registrar / Unpaywall / PDF requests and leave LIBRARY.json and CITATIONS.bib byte-identical; the export bib carries no `last_verified`; the test clock re-checks at 31 days (not at 1) and `recheck_after_days = 7` moves the threshold.
- `tests/done-final-gate.test.ts` (in process, the humanizer seam): every citation form a humanizer adds to FINAL.md (`[@Fake2021]`, `[@fake2021, p. 4]`, `@fake2019`, `[-@fake2019]`, author-date prose, a footnote, a reference list) is refused; a prose-only change exports.
- `tests/citation-integrity.property.test.ts`: Property C through `recomputeGate`.
- `tests/done-recompute.test.ts`: the `unsupported-claims` gate answered (yes → `Confirmed by user <ISO>`, no → nothing exported).
- `tests/quote-acceptance-cli.test.ts` runs the production passes (its stand-in seams are gone).

**Tests updated for the merged behaviour** (each asserting the new behaviour, none skipped or loosened): `bare-chain` (the D-18-43 quote case asserts S-13: the section blocks, the others go on, compile names the quote remedies), `offline-fail-closed` (an offline row is UNVERIFIABLE-NETWORK), `pass3-cache` (the refreshed Unpaywall lookup is counted), `verdict-rows` / `compile-done-gate-parity` / `bare-identifiers` (rows carry their reason; UNVERIFIABLE names it), `add-identifiers` (a Zenodo DOI is added from DataCite; an mEDRA DOI through content negotiation), `source-context-verifiable` (the remedy wording), `europepmc` (the article), `verify-summary` (`not probed`), `done-recheck` / `citation-clusters` / `citekey-grammar-gates` (reCheckFinalMd removed).

## Files under the folders Phase 23a moves (re-apply after PLUG-02)

Edited in place, no new files there:

| File | Stream | What |
|---|---|---|
| `templates/prompts/claim-support.md` | grammar | "source text" wording; input tag `source_text`; re-pinned in `EXPECTED_PROMPT_HASHES` and `tests/repo-files.test.ts` (44727c65…) |
| `templates/prompts/orphan-label.md` | grammar | the per-paragraph audit (input `paragraph`, output `{claims}`); re-pinned (c1d45a9f…) |
| `workflows/verify.md` | gate + integration | S-13, `--accept-quote`, the summary; Pass 1 / Pass 3 / the status rule rewritten to the Phase 20 verifier |
| `workflows/compile.md` | gate + integration | the recomputation; the full verdict list |
| `workflows/done.md` | gate + integration | the recomputation, the `unsupported-claims` gate; the full verdict list |
| `skills/verify-section.md` | gate + integration | the `--accept-quote` route; the verdict list |
| `workflows/add.md` | integration | DataCite / content-negotiation DOIs are added |
| `workflows/write.md` | integration | containment also refuses citation forms the verifier cannot check; the quote floor is `quote_min_words` |
| `workflows/next.md` | integration | S-13 routing (an unverifiable section does not stop the others; compile refuses it with its options); a section whose DRAFT.md is gone is re-drafted (VRFY-16) |
| `workflows/outline.md`, `workflows/plan.md`, `skills/plan-section.md` | integration | Zenodo / figshare / Dryad DOIs are no longer withheld |

## Hand-offs

- Phase 23 (PLUG-07 / PLUG-10): the MCP tools call `bin/lib/verify/gate.ts` `recomputeGate` and `bin/lib/quote-acceptance.ts` `recordQuoteAcceptances` (after an AskUserQuestion confirmation) as they stand.
- Phase 21/22 (EXP-03 / EXP-04): note-style footnotes are produced by the exporter after the gate and never re-enter it.
- The recorded e2e corpus (D-20-16) was re-recorded after the merge with `npm run cassettes:refresh -- --corpus e2e` (`PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org`). It has six kept sources, each OK at live Pass 1. The OpenAlex searches (keyless daily budget) and some Semantic Scholar searches were rate-limited and are recorded as expected misses. PubMed `efetch` answers exceed the 51200-byte cassette cap and stay unrecorded; this is named in the adapter's status and is never fatal. Re-record the corpus once OpenAlex has keyless budget again if you want those searches in it.

## Verification (integration, 2026-09-30, Node 22, as root in the cloud container)

- `npm run prebuild`, `lint`, `typecheck`, `build`, `validate:manifests`: green; the build leaves the tree clean.
- `CI=true npm test` with pandoc 3.9 on `PATH`: 2661 tests, 2660 pass — the one failure is the root-only `tests/atomic-write.test.ts` "preserves OLD content on rename/write failure" (CLAUDE.md gotcha). HARDEN-03 ran 1000 drafts against pandoc in ~4 s.
- `npm run test:coverage`: 93 % lines and statements, 84.41 % branches, 90.12 % functions (gate 80 / 66).
- `npm run test:tier-contract`: 58 / 58. `node scripts/e2e-smoke.mjs`: 17 PASS, 0 FINDING, 0 FAIL.
- `PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org npm run live:verify` (live): every VRFY-11 identifier OK and `10.99999/fake.001` FABRICATED; the metadata search names the DOI it found and an unknown work is UNRESOLVABLE; 12 / 12 known-bad FABRICATED; 7 / 7 known mis-cited MIS-CITED; Wakefield RETRACTED (VERIFICATION.md, stderr, exit 4); self-consistency 0 of 65 (computer science) and 0 of 56 (medicine) blocked; Pass 3 live — the NumPy sentence PASS and the penguin sentence NOT_FOUND, the PLOS PDF 49,906 characters, arXiv 1706.03762 through its redirect, a second run from the caches with 0 connections. (OpenAlex's keyless budget was exhausted and Semantic Scholar answered 429 during the research half; both are reported, not counted.)
- The PRD §15 assignment ("Write a 1500-word literature review on attention mechanisms in transformers, APA style.") reached done unaided with the RUN-21 mock LLM as the model and live sources: 8 bare `pensmith --yolo` runs (new, research, outline, three sections planned → written → verified, compile, done); every section `verified` (98 citations OK, 7 of them "retraction status unknown" for DataCite DOIs), `last_verified` on every source in LIBRARY.json and `.paper/CITATIONS.bib`, `export/DRAFT.docx` with no pensmith trace and `export/CITATIONS.bib` with no `last_verified`.
- User-path checks with the built CLI in scratch folders (offline fixture lane): every VRFY-09 key form FABRICATED and every UNPARSEABLE form refused by verify, compile and done; the VRFY-10 bare identifiers and every unsupported form; a DataCite DOI verified at DataCite with "retraction status unknown" in its row and the summary; the VRFY-20 flow; VRFY-23 at done; VRFY-25's key shapes over forged records; an empty bibliography with a stale section refused without a stack; a written section with its DRAFT.md deleted routes to write; under a real pty, `pensmith done` lists the UNSUPPORTED claim with its evidence and a "y" records `Confirmed by user <ISO>`.
