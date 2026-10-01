# pensmith done

> Finalize the paper — re-verify, plagiarism check, honesty score, humanize,
> and a trace-free export (DOCX / PDF / LaTeX / MD).
>
> **NON-NEGOTIABLE (CLAUDE.md / PRD §3, §14): no exported document carries a
> pensmith metadata trace, in ANY format** — not the .docx ZIP entries
> (`docProps/core.xml` + `app.xml` + every non-binary part), not the .pdf
> `/Info` dictionary or its XMP stream, not the .tex preamble, not the .md body.
> Exports are written to a DISTINCT export dir (default `.paper/export/`),
> separate from the source artifacts — the source `.paper/DRAFT.md` is never
> overwritten and is never the file a downstream reader receives.

<capability_check>
required:
  - Pandoc
  - humanizer skill

degrade_if_missing:
  - if no Pandoc: the built-in writer of the requested format (a real .docx, a real PDF, a standalone LaTeX article; `md` is always the built-in writer) — never a Markdown fallback; stdout says `built-in <format> writer — pandoc not found`. Citations are rendered in the paper's style by the same whole-document citeproc engine as with pandoc (every citation form the gate accepts; notes numbered across the document; numeric styles in first-citation order; `[@k 33]` as page 33)
  - if no PDF engine (pandoc present, no pdflatex / xelatex / lualatex / tectonic): the built-in PDF writer, with a one-line note (never an ENOENT crash, never a Markdown fallback)
  - if no humanizer skill: print `humanizer skill not found at ~/.claude/skills/humanizer/SKILL.md — skipping`, export the compiled draft (FINAL.md = DRAFT.md) and report the after score as `N/A (humanizer not installed)` — never fail
  - if no model transport (no model configured, PENSMITH_NO_LLM, --dry-run, offline with a non-loopback endpoint): skip the humanizer with the reason, as above
  - if no detector key (GPTZERO_API_KEY / ORIGINALITY_API_KEY / SAPLING_API_KEY for the configured backend): the score line says `skipped (no <KEY> set)` — never a number
</capability_check>

## Overview

`pensmith done` is the milestone-completion verb (intake → research → outline →
for each section { plan → write → verify } → compile → **done**). Over the
compiled `.paper/DRAFT.md` it re-runs the blocking gate, checks for copied
phrases, scores the text with the configured AI detector (with consent),
humanizes it through the user's humanizer skill, audits the exact text to be
exported, asks for the export decision and writes a trace-free deliverable,
then `.paper/FINAL.md` and the record of what it exported.

The implementation lives in `bin/lib/*` — `done-gate.ts` (the export gate),
`export-style.ts` (the citation style), `plagiarism.ts`, `honesty.ts`,
`humanizer.ts` (`humanizeDraft`, and `acceptHumanized`, the one acceptance
function both tiers call, PLUG-10), `verify/pass4.ts` and `exporter.ts`; the
verb is `bin/cli/done.ts` — a thin orchestrator. Both tiers run the SAME
`bin/cli/done.ts` → `bin/lib` path; there is no `pensmith_done` MCP tool (the
Tier-1 surface is THIS workflow body delegating to the same code, the compile
precedent — a documented asymmetry that keeps the locked 16 verbs bijective
with the 16 workflow bodies). The Tier-1 humanizer submission (Phase 23b,
PLUG-10) runs the skill in the host and hands its text to `acceptHumanized`.

**Aliases, not verbs (EXP-21, D-21-23; PRD §5.3).** `pensmith export`,
`pensmith humanize`, `pensmith score` and `pensmith plagiarism` are rewritten
before argument validation to `pensmith done --only export|humanize|score|plagiarism`
(`bin/lib/verbs.ts` VERB_ALIASES): the 16 verbs stay locked and no workflow
file is added. Every `--only` runs the blocking gate (step 1) first.

**LOCKED INVARIANT — done trusts no local file (VRFY-26).** Before any paid or
third-party step it recomputes the gate with the one gate core over the exact
text it exports — `.paper/DRAFT.md`, and again over the humanized text — and
refuses (EXIT_BLOCKED, whatever `--yolo`, `--raw`, `--no-verify` or `--only`)
on any blocking row, a section record that refuses, a section changed since its
verification, or a compiled draft changed since compile (VRFY-27). Pass 2
(claim support) and Pass 4 (orphan claims) are advisory and NEVER auto-block
(VRFY-07); the Core Value ("every citation supports its claim") is honored by
REQUIRING an explicit decision before export: the `unsupported-claims` gate
when any UNSUPPORTED claim is present (each listed with its evidence; `--yolo`
records it as auto-accepted), else the generic export confirmation — only
`--yolo` skips it. The Pass-2 UNSUPPORTED feed is read from each section
`VERIFICATION.md` and FAILS SAFE: a present-but-unparseable `## Pass-2` table is
treated as issues-present, never a silent clean. A section compile re-verified
after an edit (advisory passes off) has no claim-support judgment of its
current draft: done names it with `pensmith verify N`, and records no claim or
decision for it.

## Flags

- `--format md|docx|pdf|latex|tex` (default docx; `tex` = latex); anything else
  is EXIT_USAGE listing them.
- `--style <name|path.csl>` — the citation style (EXP-03, D-21-24): `--style` >
  config.toml `[project] citation_style` > the intake brief's style > the
  discipline preset's default. One of the 8 bundled styles (any alias: "APA 7",
  "Chicago") or a local `.csl` file (absolute, or relative to the folder the
  command is typed in; config.toml's relative path is the project root's) that
  is a well-formed, independent CSL 1.0 style. An unknown name or a bad file
  is EXIT_USAGE with the reason. done prints `style: <name> (from <source>)`.
- `--raw` — skip the humanizer (`humanizer skipped (--raw)`; no request is sent).
- `--no-verify` — skip ONLY the whole-paper Pass 4 audit, with a warning; the
  blocking re-verification always runs. `--no-verify --raw` without `--yolo` is
  EXIT_USAGE (PRD §7.9).
- `--no-score` — no detector request (`skipped (--no-score)`).
- `--no-plagiarism-check` — no search request (`plagiarism check skipped
  (--no-plagiarism-check)`).
- `--only export|humanize|score|plagiarism` — one step after the gate (below).
- `--yolo` — answers the export confirmation; never the blocking gate, the cost
  cap, the detector consent or the quote acceptances.

## Outputs

- The exported deliverable in the DISTINCT export dir (default `.paper/export/`):
  `DRAFT.docx` / `DRAFT.pdf` / `DRAFT.tex` / `DRAFT.md` per `--format` — always
  the requested format, by pandoc or by the built-in writer (below, "Export
  writers and zero trace") — named after the compiled draft whichever text it
  holds, carrying ZERO pensmith trace (scanned).
- `.paper/export/CITATIONS.bib` and `.paper/export/CITATIONS.ris` — the bundled
  bibliography (DONE-08): ONLY the sources the exported document cites (never
  the whole research library). The `.bib` holds those entries filtered from the
  exact `.paper/CITATIONS.bib` bytes the gate judged; the `.ris` is rendered from
  the same parsed entries (D-21-11), never taken from `.paper/CITATIONS.ris`.
  A document that cites nothing gets neither file.
- `.paper/VERIFICATION.md` — a SOURCE artifact (not in the export dir) carrying
  `## Gate` (the exported text's file and sha256 and the summary of the
  recomputed rows), `## Decisions` (`| Section | Row | Claim | Decision |` —
  each UNSUPPORTED claim `Confirmed by user <time>` or
  `Auto-accepted under --yolo <time>`, VRFY-22), the accepted quotes and the
  quotes verified against the user's own files, `## Honesty` (the before and
  after lines and the framing note, verbatim), the plagiarism section (each
  probed phrase with its `§<id> paragraph <k>` location and its verbatim
  matches, or the line saying why the check was skipped) and the whole-paper
  Pass-4 table over the exported text (DONE-01, VRFY-23; or `skipped
  (--no-verify)`).
- `.paper/FINAL.md` — the finished paper (EXP-15, D-21-19): exactly the text
  this done exported — the accepted humanized text, else the compiled draft —
  written ONCE, after the export and VERIFICATION.md. `.paper/DONE-RECORD.json`
  (v4) then records the sha256 of the compiled draft the gate judged and of
  FINAL.md, and that an export rendered it (`exported`; `bin/lib/done-record.ts`).
- `.paper/FINAL.rejected.md` — only when the humanizer's text was rejected
  (step 4): the reasons, bound to the sha256 of the compiled draft it was made
  from. While that draft is unchanged the router reports attention naming
  `pensmith done --raw` and `pensmith done` instead of sending the paper back
  to the paid humanizer on every bare run; any done that exports, and an
  accepted `pensmith humanize`, removes it.
- `.paper/LIBRARY.json` — `last_verified` of the citations a registrar
  confirmed during done's gate, and the retraction statuses re-checked, through
  the one library writer (VRFY-28, VRFY-15).
- The detector-consent answer, recorded the first time it is asked (EXP-17) —
  in the pensmith data dir for this paper and this detector
  (`bin/lib/detector-consent.ts`), never in `.paper/`: config.toml travels with
  a shared paper, so it can carry an opt-out (`[humanizer] honesty_consent =
  false`) but never the reader's consent.
- done never writes under `.paper/sections/`.
- stdout: `pensmith done: style: <name> (from <source>)`, the step lines, the
  honesty lines and `pensmith done: exported <path>`.
- **Under `--dry-run`** (GRND-19, D-18-29) the paper is the dry-run workspace
  `./.paper-dry-run/` (seeded from `.paper/`, which is never written): the
  deliverable is `.paper-dry-run/export/DRAFT.dry-run.<ext>` (`.dry-run` before
  the extension), its bibliography sits beside it as `CITATIONS.dry-run.bib` /
  `CITATIONS.dry-run.ris` (every exported file is named `.dry-run`), FINAL.md and VERIFICATION.md
  are written in the workspace, and done prints the path plus one line saying it
  is a dry-run export (synthetic sources, stub text) and the real paper was not
  touched. The humanizer, the detector and the plagiarism check say
  `skipped (dry-run)` / `unavailable (dry-run)` (the humanizer says so before
  it looks for the skill: `humanizer skipped (dry-run)` whether or not one is
  installed). The document itself stays
  zero-trace: the name and place disclose it.

## Body

> **LOCKED INVARIANT — zero exported trace + always-confirm gate.** Every
> per-format export ends with the MANDATORY scrub (`zeroTracePatch` for docx,
> `zeroTracePdf` for pdf) and the zero-trace scan of every written file
> (`scanExportFile`; a finding deletes what the export wrote, `ZeroTraceError`). The export-confirmation gate ALWAYS prompts (generic
> confirm even on a clean paper); only `--yolo` skips it.

0. **Flags** — every check above that is EXIT_USAGE (`--format`, `--only`,
   `--style`, `--no-verify --raw`, an `--only` step its own skip flag cancels,
   an alias given `--only` again) fails before anything is read, written or sent.
   An export run (no `--only`, or `--only export`) prints `style: <name> (from
   <source>)`.

1. **Export blocking gate** (audit #3/#14, VRFY-26, VRFY-27 — unconditional;
   every `--only` runs it first; D-20-24): every reason is collected, then the
   run is refused with EXIT_BLOCKED (4) before any paid or third-party step,
   writing nothing:
   - the sections are the ones STATE.json registers (OUTLINE.md must list the
     same; a paper whose STATE.json registers none uses OUTLINE.md's rows, as
     compile does) — never a directory listing; a paper with no section refuses;
   - each section's record can only add refusals (D-20-04): a missing PLAN.md,
     DRAFT.md or VERIFICATION.md, a failed write, a Status-less or
     `Status: failed` VERIFICATION.md, a failed PLAN.md, or — outside
     `--dry-run` — a verification written under `--dry-run` (RUN-27); a section
     whose DRAFT.md changed since its verification is `stale: §N changed since
     verification — re-verify and recompile`;
   - the compiled `.paper/DRAFT.md` must be the one compile wrote from those
     verifications (`COMPILE-INPUTS.json` v3: `compiled_draft_sha256`, each
     section's verified hash and the headings' hash): a hand edit is `stale:
     .paper/DRAFT.md changed since compile` (VRFY-27) — the edit belongs in the
     section drafts; an older record is stale ("recompile");
   - a `.paper/FINAL.md` done did not leave (edited or written by hand) is
     refused, naming the remedy (move it out of the paper folder);
   - the gate core recomputes every row over `.paper/DRAFT.md`'s exact bytes
     (`bin/lib/verify/gate.ts`): a cited key outside the union of the sections'
     `assigned_sources` is UNASSIGNED, and every blocking row (FABRICATED,
     MIS-CITED, RETRACTED, UNVERIFIABLE-NETWORK, UNVERIFIABLE, UNPARSEABLE,
     UNSUPPORTED-FORM, NOT_FOUND, an UNVERIFIABLE-QUOTE the user did not accept
     for the current draft, …) is listed with the
     staleness reasons — so a hand-appended fake citation is named as both.
   Citations whose `last_verified` is older than `[verification]
   recheck_after_days` are re-checked past the HTTP cache (VRFY-28), and a
   cited source whose `LIBRARY.json` retraction status is `unknown` because a
   lookup failed is re-checked live first (VRFY-15, D-20-13; no DOI HEAD): a
   retraction found now blocks as RETRACTED; a DOI whose agency publishes no
   retraction data stays `unknown` with that reason and is never asked again;
   the decided answers are recorded through the library writer only when done
   exports (a refused done writes nothing). With no
   `.paper/DRAFT.md` at all, the section records are checked first: when a
   section's verification blocks (compile refused, so there is no draft), done
   prints those reasons and exits EXIT_BLOCKED (4); only a paper that has not
   reached compile yet is "run `pensmith compile` first" (exit 1). An export
   run without a terminal and without `--yolo` then refuses at once
   (EXIT_APPROVAL, 3) because the export decision (step 7) needs an answer —
   before the paid steps.

2. **Plagiarism check** (DONE-02, EXP-19, EXP-20, D-21-22; advisory — a basic
   check, not a substitute for an institutional service): 6–10-word windows of
   the body paragraphs (never the title, a heading, a citation, a quoted
   passage, a block quote, a list item or the reference list), ranked by rarity
   against the shipped SCOWL word tiers (`templates/wordfreq/`), at least one
   per paragraph in paper order, up to `[verification] plagiarism_max_phrases`
   (default 30). Each is one quoted DuckDuckGo HTML query through the egress
   gate; a result is a match only when the normalised phrase appears verbatim in
   its title or snippet, and its link is decoded from DuckDuckGo's `/l/?uddg=`
   redirect. A DuckDuckGo bot challenge is reported per phrase, never read as
   "no match". `--no-plagiarism-check` and `[verification] plagiarism_check =
   false` send nothing (`plagiarism check skipped (--no-plagiarism-check)` /
   `(config)`); offline and `--dry-run` say `skipped (offline)` /
   `(dry-run)`. Matches feed the confirmation; the check never blocks.

3. **Honesty score — before** (DONE-04, EXP-16..EXP-18, D-21-20, D-21-21):
   `measureHonesty(draft)` with the configured `[humanizer] honesty_backend`
   (GPTZero, Originality.ai or Sapling; each through the egress gate with its
   key in a header only). The backend's disclosure line (verbatim from
   `references/honesty-framing.md`) is printed before anything is sent.
   Consent is the user's, per paper and per detector: asked once in a terminal
   through the `detector-consent` gate and the answer — yes or no — recorded in
   the pensmith data dir (`detector-consent.ts`), never in config.toml, which a
   shared paper carries to its next reader; `[humanizer] honesty_consent =
   false` in config.toml is an opt-out (never send) and `true` there grants
   nothing; `--yolo` never answers it; without a terminal and without a
   recorded answer nothing is sent. A config.toml this build cannot read
   refuses every done (`score` and `plagiarism` included) with its one-line
   error, before anything is sent. A score is `<n>% AI-generated (<backend>, <ISO time>)`; an absent
   one gives one exact reason (`skipped (no <KEY> set)`, `skipped (no consent
   recorded — …)`, `skipped (consent declined in config.toml)`, `skipped
   (--no-score)`, `skipped (config: honesty_score = false)`, `unavailable
   (offline)` / `(dry-run)`, `unavailable (<backend> rejected the API key)`,
   `unavailable (rate limited)`, `unavailable (network: …)`). Transparency
   only — never a claim about detectability.

4. **Humanize** (DONE-03, EXP-14, D-21-18): `humanizeDraft` sends the compiled
   draft one `##` section at a time — the title and the headings never reach
   the model — through the `humanizer` model slug: the skill's SKILL.md body
   (frontmatter stripped) is the system prompt, the user message is the
   hash-pinned contract (`references/humanizer-contract.md`), the voice to keep
   and the section text with every citation and every direct quote masked as a
   placeholder (the rewrite guard, `bin/lib/rewrite-guard.ts`), inside the
   FEED-05 fence. Each reply must pass `validateRewrite` — every placeholder
   once, in its own paragraph and on its own claim (a citation moved to another
   sentence's claim is rejected), the paragraph count kept (a preamble or
   closing chatter paragraph is rejected), no fence marker and no added
   "pensmith"; then `acceptHumanized`
   — the rewrite guard over the whole text, the cited-key diff and the gate
   core over the humanized bytes (GATE-04) — must pass it. A reply that
   follows the skill's own multi-part output format (a draft rewrite, an
   audit, a final rewrite, a summary of changes) is judged by its final
   rewrite when the whole reply is not accepted; the contract asks for the
   final rewrite alone. A rejection exits
   EXIT_BLOCKED (4) with every reason, exports nothing, leaves FINAL.md
   untouched and keeps the reasons in `.paper/FINAL.rejected.md` (`pensmith
   done --raw` is the way out; a bare `/pensmith` reports attention instead of
   asking the humanizer again for the same compiled draft). A provider failure prints
   `humanizer failed: <reason>` and done exports the compiled draft; the cost
   cap's refusal propagates (exit 5). Skips: the skill missing, `[humanizer]
   enabled = false`, `--raw`, PENSMITH_NO_LLM, `--dry-run`, offline with a
   non-loopback endpoint, no model configured — each named.

5. **Honesty score — after**: scored again over the accepted humanized text
   (no second consent question); otherwise `N/A (humanize skipped with
   --raw)`, `N/A (humanizer not installed)`, `N/A (humanizer failed: …)`,
   `N/A (humanizer disabled)` or the before line's reason. Both lines and the
   framing note are printed and written to `.paper/VERIFICATION.md`.

6. **Whole-paper Pass 4** (DONE-01, VRFY-23): `runPass4` over the exact text to
   be exported (the accepted humanized text, else `.paper/DRAFT.md`) unless
   `--no-verify`. The per-paragraph orphan counts feed the confirmation and the
   per-paragraph table of `.paper/VERIFICATION.md`.

7. **DONE-09 export decision** (`runDoneGate`): print each UNSUPPORTED claim
   with its evidence, the sections Pass 2 did not judge, the contradictions
   compile flagged (COMPILE-REPORT `## Contradictions`, EXP-11), the orphans,
   the plagiarism matches with their locations, the quotes accepted without a
   source check and the quotes verified against the user's own files FIRST;
   then ALWAYS require an explicit answer: the `unsupported-claims` gate
   ("Export the paper with these UNSUPPORTED claims?") when an UNSUPPORTED
   claim is present, else the generic confirm (even when clean — PRD §7.9).
   `--yolo` skips it and records each UNSUPPORTED claim as `Auto-accepted under
   --yolo <time>`; a confirmation records `Confirmed by user <time>`. A
   declined gate cancels the export (exit 3) and writes nothing.

8. **Export + mandatory scrub** (DONE-06/07/08): `exportDraft` into the DISTINCT
   export dir (`outputDir` LEFT UNSET so the md export never overwrites the
   source `DRAFT.md`), from the exact text and bibliography bytes the gate
   checked (a temporary copy — an edit made while done ran is not exported;
   done warns and names the checked text's sha256), in the resolved style.
   The writer is pandoc or the built-in writer of the format (md: always
   built-in); docx → `zeroTracePatch`; pdf → `zeroTracePdf`; then every written
   file is scanned (a finding deletes what the export wrote and exits 1,
   `ZeroTraceError`). The cited-only `.paper/export/CITATIONS.bib` / `.ris`
   (library.ts `planExportCitations`, planned and checked before anything is
   written — a citing text whose keys the bibliography lacks is an error that
   writes nothing — then `writeExportCitations`) carry the same keys. Then record
   `last_verified` and the re-checked retraction statuses, write the source
   `.paper/VERIFICATION.md`, then `.paper/FINAL.md` (the exported text) and
   `.paper/DONE-RECORD.json`. FINAL.md is never replaced before this point, so
   a refused, declined, failed or capped done leaves it byte-identical. The
   router's terminus is "FINAL.md and DRAFT.md hold the bytes DONE-RECORD.json
   recorded", so a recompile sends the paper back to `done` (which rewrites
   FINAL.md and the export with the new text), and the bare loop settles at
   `status (done)`. A FINAL.md done did not leave — edited or written by hand —
   is refused in step 1 (exit 4, never exported, never replaced; moving it out
   of the paper folder is what unblocks done — the moved copy keeps the edit,
   and an edit meant for the paper itself is made in the section drafts first)
   and is attention for the router, never "complete". With no record (a paper
   an older pensmith finished, or a done stopped after its export), a FINAL.md
   whose sha256 the paper-level VERIFICATION.md names on its `Text checked:`
   line is done's own export — replaced by the next done, never "edited".

9. **`--only`** (D-21-23): each runs step 1 first.
   - `--only plagiarism` (`pensmith plagiarism`): step 2, the matches printed
     with their locations; nothing written.
   - `--only score` (`pensmith score`): step 3 (the consent rules apply), the
     line and the framing note printed; nothing written.
   - `--only humanize` (`pensmith humanize`): steps 4–5 without a score, then
     DONE-RECORD.json with `exported: false` and `previous_final_sha256` (the
     FINAL.md it replaces), then FINAL.md — record first, so a stop between
     the two leaves done's own earlier text, which the next done replaces,
     never one the router calls edited — no export, no
     confirmation (FINAL.md is the finished paper; an export renders it). Until
     an export renders that FINAL.md the router reports attention naming
     `pensmith export` — never "complete" while `export/` may hold an older
     text. A skipped humanizer writes nothing; a failed one exits 1.
   - `--only export` (`pensmith export`): the confirmation (step 7) applies;
     exports FINAL.md when it is done's own and current (or the humanized text
     `pensmith humanize` left unexported) — re-gated through `acceptHumanized`
     — else the compiled draft (writing FINAL.md and the record as a raw done
     does, `exported: true`); VERIFICATION.md says the plagiarism and honesty
     steps were skipped (`--only export`).
   A DONE-RECORD.json written by a newer pensmith is never overwritten: an
   exporting or humanizing done refuses before any step (exit 1), and the router
   reports it as attention.

10. **Shell fallback** (TIER-06 equivalence path): `pensmith done [--yolo]
   [--format md|docx|pdf|latex|tex] [--style <name|path.csl>] [--raw]
   [--no-verify] [--no-score] [--no-plagiarism-check]
   [--only export|humanize|score|plagiarism]`, or the aliases `pensmith export
   | humanize | score | plagiarism`.

### Export writers and zero trace

(Phase 21: EXP-01 … EXP-09, D-21-02 … D-21-12.)

- **The requested format is always produced** (EXP-09). `md` is always the
  built-in Markdown writer — never pandoc, so its bytes never depend on what is
  installed. `docx`, `pdf` and `latex` use pandoc when it is on PATH (a PDF also
  needs a TeX engine: the first of pdflatex, xelatex, lualatex or tectonic), and
  otherwise the built-in writer of that format: a real `.docx` (Word styles,
  numbered lists, page footnotes), a real PDF (an embedded subset of the OFL
  Liberation Serif family shipped in `templates/fonts/`, footnotes at the foot
  of the page, page numbers) or a standalone LaTeX article that compiles under
  pdfLaTeX and XeTeX. A pandoc failure falls back to the built-in writer of the
  same format, never to Markdown, and the note names the failure by its TeX or
  pandoc error line (never pandoc's argv). stdout names the writer —
  `pensmith export: DRAFT.docx — pandoc docx writer` or
  `… — built-in docx writer — pandoc not found` — and a `note —` line names
  anything the built-in writer wrote as text (it reads a Markdown subset).
- **Every character is shown or named** (EXP-09, review round 1): pandoc with
  pdfLaTeX gets a header declaring each character of the document its set-up
  cannot print (Greek and the common symbols as math, sub- and superscript
  digits), a XeTeX-family engine gets the shipped Liberation Serif as its main
  font, and the built-in PDF writer folds a character its font lacks to one it
  has (U+2011 to a hyphen, the thin spaces to a space). A character no path can
  show (CJK in Liberation Serif) is printed as `?` and named in a
  `pensmith export: note —` line with its code point — on every path, the
  built-in LaTeX included — never dropped silently. A note cited in a table
  cell or a heading reaches the foot of the page (the built-in LaTeX writes it
  as `\footnotemark` / `\footnotetext`).
- **Citations are rendered in the paper's style by one citeproc engine over the
  whole document** (D-21-03): notes numbered across the document for a note
  style, numbers in first-citation order for a numeric style, and every form the
  gate accepts — clusters, locators (`[@k, p. 5]`, and `[@k 33]` as page 33, as
  pandoc reads it), prefixes and suffixes, `[-@k]`, `@{k}` and narrative `@k`.
  Titles are case-protected, so "China" stays capitalised in every style
  (D-21-06). A `.csl` file path works wherever a style key does (D-21-07). As
  pandoc does, a note marker moves past the punctuation after its citation
  (`claim [@k]...` → `claim...¹`; under en-US a period after a closing quote
  goes inside it), a locator is read with the terms of the style's own locale
  (Harvard's en-GB keeps `chap. 2` as text), `--` in a locator is a range and
  a label is joined to its value by a non-breaking space (the goldens and the
  locator oracle check them against pandoc 3.9). On
  the pandoc path pandoc runs in a fresh temporary directory on neutral names
  only (`input.md`, `references.json`, `style.csl`, `out.<ext>`, D-21-09), so
  nothing it records can name a local path, and with `--sandbox`, no implicit
  figures and a Lua filter that prints every image as its Markdown text (as the
  built-in writers do): pandoc fetches or embeds no URL and no file the gate did
  not read — a PDF build fetched an image even under `--sandbox` — and tectonic
  runs `--only-cached` while sources are offline or under `--dry-run`.
- **Nothing is rendered that the gate did not read** (D-21-12): the exporter
  renders only keys the checked text cites, the bibliography holds exactly the
  rendered keys, and the export bibliography exactly the cited keys — a note
  built from a citation carries nothing the gate did not check, or the export
  is refused before anything is written.
- **The bibliography** (EXP-01, EXP-02): `export/CITATIONS.bib` holds only the
  cited entries, and `export/CITATIONS.ris` is rendered from the same parsed
  entries (same keys; one `TAG  - value` per line, never wrapped; `AU  -
  Family, Given`; page ranges as `SP`/`EP`; a journal article's journal as
  `JO`). A text that cites keys none of which the bibliography holds is an
  error (EXIT_ERROR) that writes nothing.
- **Zero trace is checked, not assumed** (D-21-08): every docx and PDF is
  scrubbed (the docx core and app properties blanked, `docProps/custom.xml`
  removed, ZIP dates fixed; the PDF `/Info` emptied, its XMP and pdfTeX's
  `/PTEX.*` keys removed), then EVERY written file — the document and both
  bibliography files — is scanned (`bin/lib/export/zero-trace.ts`): a pensmith
  name, an offline or stub marker, a generator comment, a local home path, an
  author or producer field, an XMP packet or a metadata-bearing embedded image
  is a finding (in author content — the text, the references, link targets —
  only this machine's paths count: the paper's folder, `$HOME`, the OS user's
  home path, outside web addresses; a source's URL holding `/home/x/` is not a
  trace), and so is an untrusted-data fence marker. Any finding, or a scrub
  that fails, deletes everything the export wrote and refuses with
  `ZeroTraceError` (EXIT_ERROR) — never a Markdown fallback. A docx hyperlink's
  target is never rewritten by the scrub (it is what the link's text shows).
- **Nothing the exporter adds carries an unverified citation** (carry-over 4):
  a note-style footnote is built after the gate, but its text is the engine's
  rendering of a citation the gate read, of an entry the gate verified — the
  same keys D-21-12 asserts.

### Outline-only mode

(GRND-11, D-21-25 — amends the GRND-02 stop.) A paper whose intake chose
"outline only" (`[project] mode = "outline"`) never plans, drafts or verifies a
section: once the outline is approved the router names `done`, and done runs
the outline export (`bin/lib/outline-export.ts` `runOutlineDone`) after step 0
(the flags, and the style resolved and printed as `style: <name> (from
<source>)`) instead of steps 1–9. `--only humanize`, `--only score` and `--only
plagiarism` (and their aliases) say they are skipped — there is no prose — and
write nothing; `--only export` is the outline export:

1. The listed sources are the citekeys the outline assigns (section order, each
   once). The outline document — title, thesis, each section's heading with its
   role, word target, purpose and its sources as one citation — is checked by
   the same gate core, with the listed keys allowed: every listed source is
   Pass-1 re-verified at its registrar, every `unknown` retraction status is
   re-checked live, and any blocking row (a FABRICATED, MIS-CITED or RETRACTED
   source, an unreadable or unsupported citation form) refuses with
   EXIT_BLOCKED (4), writing nothing.
2. The `export-confirm` gate (`--yolo` skips it; without a terminal it refuses
   with exit 3).
3. `.paper/ANNOTATED-BIBLIOGRAPHY.md`: per source, its reference in the paper's
   style, its tier, the abstract's leading sentences up to 60 words labelled
   "Summary (abstract excerpt)" (no model call; "no abstract available" without
   one), why it is relevant (the research evaluator's reason) and the sections
   it supports. Every value read from the library is escaped: the file holds no
   citation and no markup. A value that carries an attribution, a direct quote
   or an identifier no section verified (an abstract's `Smith et al. (2019)`, a
   `why_relevant` that names `[3]`) is left out of the file — "left out — it
   holds an attribution, a quotation or an identifier no section verified" —
   and done names it in a `pensmith done: note —` line.
4. `export/OUTLINE.<ext>` (its citations rendered, a References list, and
   `export/CITATIONS.bib` / `.ris` of the listed sources) and
   `export/ANNOTATED-BIBLIOGRAPHY.<ext>`, through the same writers, scrub and
   scan. A routed done (bare `/pensmith`) exports Markdown; `pensmith done
   --format docx` adds the `.docx` pair.
5. `DONE-RECORD.json` (v4) records the outline export — written before
   ANNOTATED-BIBLIOGRAPHY.md, naming the text it replaces, so a done stopped
   between the two leaves a paper done again, never an "edited" one: the sha256
   of OUTLINE.md, CITATIONS.bib and ANNOTATED-BIBLIOGRAPHY.md and the files
   exported (an earlier format's export still on disk stays listed; one removed
   since is dropped). The
   router reports `status (done)` — `outline only — complete:
   export/OUTLINE.md and export/ANNOTATED-BIBLIOGRAPHY.md` — while they hold
   those bytes, and routes to done again when the outline or its sources change.
   An ANNOTATED-BIBLIOGRAPHY.md done did not write (edited by hand) is never
   replaced: done refuses (exit 4) and the router reports attention, naming the
   remedy (move it out of the paper folder).

No humanizer, detector score or plagiarism check runs in outline mode: there is
no prose. To go on to a full draft, set `mode = "draft"` under `[project]` in
`.paper/config.toml`, or run a section yourself (`pensmith plan 1`).
