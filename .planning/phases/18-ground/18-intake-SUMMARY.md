---
phase: 18-ground
stream: intake
branch: v1/p18-intake
base_commit: 20f2641 (docs(18): plan phase 18 GROUND) + 812a8b5 (seam S-A, byte-identical)
requirements_closed: [GRND-01, GRND-02, GRND-03, GRND-04, GRND-05, GRND-06]
requirements_handed_to_integration: [GRND-05 chain egress (tests/pii-chain-egress.test.ts, §7 step 3)]
---

# Phase 18, stream `intake`: Summary

## What shipped

### Assignment sources (GRND-01, D-18-08)
- `bin/lib/assignment.ts` `resolveAssignment()` returns `{text, source: {kind, name}}` in this order: `--from <file>`, a positional `@path`, piped stdin, the folder's `assignment.{txt,md,pdf}` through the `assignment-pickup` gate, a multi-line paste in a terminal, and a `--thesis` seed standing in. `--from` and `@path` together are refused ("give the assignment once").
- Types are `.txt`, `.md` and `.pdf`. A PDF goes through `pdf-text.ts`, so only its text reaches `.paper/`. A missing file, an unsupported type (the error lists the supported types), an empty file and a file over 1 MiB each fail with one line that names the path as the user typed it.
- Piped stdin has a 2 s first-byte timeout and a 1 MiB cap. A silent or empty pipe counts as "no assignment", so the run never hangs. It is never read in `PENSMITH_PROMPT_MODE=numbered`.
- `bin/lib/stdin-source.ts` `stdinMayCarryAssignment()` is the fstat test with no read. `assignment.ts` and `paths.ts resolvePaperRoot` share it, so a bare run with a piped assignment starts a new paper (hot region, RUN-14 row 3; `ResolvePaperRootOptions.stdinAssignment` lets tests inject it).
- With several `assignment.*` files, a terminal selects one. Otherwise the run exits 2 naming them. With no assignment in a run that cannot prompt, it exits 2 with `no assignment found` and writes nothing.
- A new `multiline` prompt kind (`prompts/schema.ts`, `numbered.ts`, `clack.ts`) reads lines until a lone `.` or EOF.

### The §7.1 battery (GRND-02, D-18-09)
- `bin/lib/intake-questions.ts` holds the ordered list: `pii_redaction`, discipline, mode, the tutorial.ts question (composed without being named), class, counterargument, `style_samples`, length, `citation_style`. Each entry has an id, flag, answers-file key, kind, options (from `disciplines.ts` and the style alias table), a parser and a display.
- `pensmith new --questions` prints the list as JSON; D-18-32 reuses it in Phase 23.
- `bin/lib/intake-answers.ts` collects answers from flags, then `--answers <file.toml>` (read by `config.ts readIntakeAnswersFile`; also accepts `thesis` and `[follow_ups]`). An unknown key or invalid value is a usage error that names the valid ones.
- If the run cannot prompt, has no `--yolo` and leaves questions unanswered, the `intake-defaults` gate refuses with exit 3. The message names each question and its flag, and the refusal happens before `assertLlmConfigured`, any model call or any write.
- In a terminal, or with numbered answers, each unanswered question is asked with the clarifier's or the preset's suggestion as its default (3 tries). If scripted answers run out, the same refusal applies. `--yolo` accepts the suggestions and prints them.
- The clarifier suggests up to 3 follow-ups. A run that can prompt asks them. A run that cannot records the suggested answer and says so in the Q/A section.
- The default length is the assignment's stated length (`N-word`, ranges, pages × 300), else the clarifier's, else 1500. The default citation style is a plain-English override, else the clarifier's, else the preset's.

### Overrides and style aliases (GRND-04, D-18-11)
- `bin/lib/intake-overrides.ts` parses the assignment and every answer deterministically. It extracts style instructions ("Use MLA for this paper", "APA 7", "do not use APA" is not an override, and the last instruction wins), sectioning notes, the stated length, the paper type, the topic phrase and a discipline mention.
- Ambiguous aliases (chicago, harvard, vancouver, turabian, ama) need a strong cue.
- `schemas/config.ts` has the alias table: `citationStyleKey`, `normalizeStyleName`, `citationStyleChoices`. Chicago maps to `chicago-notes-bib`. An unknown style is refused with a list of the 8.

### Clarifier v2 (GRND-02, D-18-10, D-18-03/04)
- `IntakeClarifierSchema` v2 (llm-contracts hot region) has `{topic, discipline, paper_type, thesis, length_target_words, citation_style, sectioning_notes, follow_ups≤3}`. It tolerates a free-text paper type, a null length and more than 3 follow-ups. `intakeFromText` is the labelled-Markdown fallback.
- The `intake-clarifier` stub (llm-stubs hot region) reads `hints.assignment`.
- `templates/prompts/intake-clarifier.md` is now data-last. Its inputs are `disciplines`, `answers` and `assignment`, and it has the verbatim fence paragraph and a JSON example. It is re-pinned in `EXPECTED_PROMPT_HASHES` and `tests/repo-files.test.ts` (`7700947a…`).
- The request is built with `buildPromptRequest('intake-clarifier', …)` and `stubHint: requestHints(req)`.
- A reply that copies the template example is discarded (`isTemplateExample`, WARN). A topic with no content word in common with the assignment gives way to `topicFromAssignment` (`topicIsGrounded`).

### The brief (GRND-03, D-18-07)
- `bin/cli/intake.ts` was rewritten. The `_interpolate` seam is gone. It writes the brief with `renderIntakeDocument`, with an offline marker line after `# Intake` under `--dry-run`.
- It also writes STATE.json, the config.toml mirror (`config.ts writeIntakeConfig`: `[project]` mode, the fragment, class, discipline_preset, citation_style, length_target_words, `counterargument_required` only for yes/no, pii_redaction; `[style]` match_past_writing and samples_dir), STYLE.json when opted in, and the registry entry with the answered class.
- `intake-parse.ts parseIntakeMd` wraps the brief. Frontmatter goes through the CONF-04 migration and `parseIntakeFrontmatter`. Raw text uses the legacy heuristics and `topicFromAssignment`. `DISCIPLINE_MAP` was removed. `escapeTemplateTokens` stays for the integration pass.

### PII (GRND-05, D-18-12)
- `bin/lib/pii.ts` now covers:
  - names with middle initials, hyphens, particles, O'/Mc and a surname after a title;
  - a labelled-ID class (`ID`);
  - textual dates in MDY and DMY order;
  - international phone numbers.
- It excludes entity head nouns (Revolution, Treaty, Empire, University…), entity openers, month fragments, and a `keep` list (the assignment's labelled topic lines).
- Protected spans pass through unchanged in `redactPii` and in `deepRedactPii` (the SESSION.log path): UUIDs, DOIs, ISBNs, arXiv ids, ISO timestamps and long hex strings.
- The PII question comes first in the battery. When it is on, intake redacts the assignment, the thesis seed, the class and the follow-up answers before the clarifier call and before INTAKE.md is written. Each redaction is printed as a `[KIND] "raw" → tag` line, and the raw text goes to the gitignored `INTAKE.raw.local`.

### One preset loader (GRND-06, D-18-13)
- `citations.ts resolveStyleName` returns `defaultCitationStyleFor(d)`, so History is now `chicago-notes-bib` and Biology `ama`, per PRD §8.
- `citation-density.ts` measures citations per prose paragraph against `densityBandFor(normalizeDisciplineSlug(d))`, per section and paper-wide, and keeps the D-14 per-1000-words figures. `compile-report.ts` renders the band, each section and any out-of-band paragraphs. In `compile.ts`, only the call to `citationDensityForReport` changed.
- The new chokepoint row `discipline-literals` (string-literal) is allowed only in `bin/lib/disciplines.ts`. It comes with a failing fixture and a replaced CLAUDE.md row. `tests/disciplines-consumers.test.ts` greps the tree for discipline tables.

### Docs
- `workflows/new.md` was rewritten and contains no tutorial vocabulary. `workflows/sketch.md` step 3 was updated.
- PRIVACY.md: the PII section (what is redacted, what is left alone, where it applies, the raw copy) and the INTAKE.md bullet.
- PRD:
  - §7.1: sources, 9 questions, the clarifier only suggests, the brief is INTAKE.md;
  - §7.2: reads the brief;
  - §8: sociology row, the one loader, source-preference ids, precedence;
  - §10: `[project]` and `[style]` comments;
  - §13: INTAKE.md and INTAKE.raw.local replace PROJECT.md.

## Commits
- `577d4eb` feat(18-intake): precise opt-in PII redaction with identifier passthrough (GRND-05)
- `9069986` feat(18-intake): assignment sources, the §7.1 battery, overrides, clarifier v2 and the INTAKE.md brief (GRND-01..04, GRND-06)
- `8c5193b` docs(18-intake): the intake workflow, PII scope and PRD amendments
- `69ec788` fix(18-intake): a trailing "for my History class" is not part of the topic phrase
- this summary

## Tests

**Added**
- `intake-assignment` (7)
- `intake-battery` (10)
- `intake-clarifier` (7)
- `intake-cli` (11, built CLI + mock)
- `intake-overrides` (7)
- `gates-intake` (6)
- `disciplines-consumers` (5)
- `research-topic-seed` (1)
- `pii-gold` (7, including the 10 000-UUID fast-check property and the gold set `tests/fixtures/pii/gold.json`)
- fixture `tests/fixtures/assignment.pdf` (generated by `scripts/gen-assignment-pdf.mjs`, byte-stable)

The new parsers have LF and CRLF cases.

**Updated, in owned paths**
- `intake-bootstrap`: skip guards removed; asserts the brief.
- `intake-pii-egress`: the `_interpolate` seam is replaced by mock capture over new → research.
- `intake-pii-ordering`: redaction comes before the call; `INTAKE.raw.local`.
- `intake-style-producer`: in-process with every question answered; missing folder.
- `intake-parse-security`: brief-based parse.
- `citation-density`: per-paragraph bands.
- `noninteractive-prompts`: sketch → new now asks the numbered battery; answers that run out are refused.
- `prompts-numbered`, `prompts-schema`: the multiline kind.

**Updated, outside owned paths (superseded behaviour, D-18-34)**
- `citation-render`: History → `chicago-notes-bib` per PRD §8; philosophy and biology cases added.
- `cli-exit-codes`, `flags` (C2-H1): the message is now `no assignment found: …`.
- `cost-cap`: an answers file, so the run reaches the cost-cap gate instead of stopping at intake-defaults.
- `llm-transport` T-11-05/06: intake args plus `--yolo`.
- `replay` and `installed-offline`: a replay never inherits the logged `--yolo` (RUN-28). Replaying the intake step without `--yolo` now stops at intake-defaults (exit 3, asserted, nothing written). With the replaying invocation's own `--yolo`, the output is byte-identical and the mock is not called.
- `paper-root-resolver`: `stdinAssignment: false` is set explicitly (the test runner's stdin may be a pipe), plus a `true` case.
- `repo-files`: the intake-clarifier hash.

No test was skipped or loosened.

## Deviations (with D-ids)
- **D-18-09 order.** PII redaction is the first entry of the battery list, not the seventh. It must be settled before the clarifier call, and the list order is the asking order. Every other question keeps D-18-09's order.
- **D-18-09 / D-18-13: config.toml is intake output, never an answer source.** If intake read config.toml, the clarifier request would change between a run and its `resume --replay`, and replay requires byte-identical requests. Answers come from flags, `--answers` or asking. The precedence preset < intake < config.toml < flag still holds for every downstream consumer.
- **D-18-08 stdin.** A UNIX socket counts as a pipe, alongside FIFOs and non-empty regular files. Node's `child_process` `'pipe'` stdin, which a Tier-1 host would use, is a socket, not a FIFO. A character device such as `/dev/null` or a TTY is never read.
- **Addition: `pensmith new --questions`** prints the battery (id, question, options, flag, answers-file key) as JSON. Tier 1 needs it to ask with AskUserQuestion and write the `--answers` file (D-18-32).
- **Additions outside the listed owned paths:**
  - `bin/lib/stdin-source.ts`: the shared fstat test, so `paths.ts` does not import `assignment.ts`.
  - `scripts/gen-assignment-pdf.mjs`: the sibling generator for `assignment.pdf`.
  - `compile.ts`: the one call to `citationDensityForReport`.
  - `tutorial.ts` exports `TUTORIAL_INTAKE_QUESTION` (id, key, flag, label, options, parse).
- **D-18-10 guard.** Besides discarding a verbatim template reply, a suggested topic sharing no content word with the assignment is replaced by the assignment's own topic phrase. The WARN names the reason.

## Verification done
- `npm run build`, `npm run lint`, `npm run typecheck`: clean.
- `npm test`: 1588 tests, 1587 pass. The one failure is the root-only `atomic-write` chmod case. After the last topic fix, the intake suites were rerun (48/48).
- `npm run test:tier-contract`: 54/54.
- `npm run validate:manifests`: valid.
- User path: built CLI in `scratchpad/p18/intake/`, isolated `XDG_DATA_HOME`/`HOME`, a scratch RUN-21 mock with a promptHints-driven clarifier, `PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org`.
  - **A1 files and stdin:**
    - `new --yolo` beside A1: topic `attention mechanisms in transformers`, apa, 1500; the config mirror is right; the request has a fixed system prompt and fenced tagged blocks.
    - A piped History assignment: stdin, MLA from "Use MLA for this paper", 1800 words from 6 pages, topic `the causes of the French Revolution`.
    - `@assignment.pdf`: the known sentence is stored and no `%PDF-` appears under `.paper/`.
  - **Refusals:**
    - `@missing.txt`, `@file.docx`, an empty `--from` file, and `--from` plus `@`: one line each, exit 2, nothing written.
    - `new --yolo < /dev/null` in an empty folder: exit 2, `no assignment found`, nothing written, no model request.
    - Non-TTY without `--yolo`: exit 3 naming all 9 questions and flags, nothing written, no model request.
  - **Battery and grouping:**
    - `PENSMITH_PROMPT_MODE=numbered` walk through the battery and 2 follow-ups: every answer lands in INTAKE.md ("answered") and config.toml.
    - `--class "PHIL 101" --discipline psychology --yolo` with A1 piped, then `list` from another folder with the same data dir: shows `[PHIL 101]`.
  - **Styles and style-match:**
    - `--citation-style nonsense`: exit 2 listing the 8. `--citation-style Chicago`: `chicago-notes-bib`.
    - A Biology assignment with "Use MLA" and "literature review section before methods": biology, mla, the sectioning note is in the brief.
    - `--style-samples samples`: STYLE.json and `[style]` written; a missing folder is one line, exit 2.
  - **PII:** `--pii-redact` on a named assignment: the name is redacted in INTAKE.md, the clarifier request and SESSION.log; the raw text is only in INTAKE.raw.local, which is gitignored. The paperId UUID appears intact in SESSION.log.
  - **Downstream:** `research --yolo --show-prompts` (`PENSMITH_OFFLINE=1`) after the redacted intake: the disambiguator request carries the brief's topic and discipline and the redacted assignment, and no clarifier text.
  - **Dry run:** `new --dry-run --yolo` makes 0 mock requests, and the INTAKE.md offline marker sits under `# Intake`.

## Handed on
- **llm stream:**
  - `tests/helpers/local-servers/mock-llm.ts` `hintsFrom` should use `promptHints` for the data-last templates. The intake-clarifier stub reads `hints.assignment`. The repo mock currently passes no `assignment` hint: it derives `topic` by running `parseIntakeMd` over the whole tagged message. Intake's grounded-topic guard keeps the brief right either way.
  - The topic-disambiguator template is still the old layout. The repo mock derives the query `pipeline (RSCH-02 first half)` from its backticks.
- **workflow stream:**
  - README: document the intake flags, `--answers` and `--questions` for the power-user fallback.
  - D-18-29 `.paper-dry-run/`: the INTAKE.md dry-run marker line stays harmless there.
- **Integration pass:**
  - `tests/pii-chain-egress.test.ts` (new → … → write).
  - Remove `escapeTemplateTokens` once no caller is left.
  - `done.ts` EXP-03 style precedence should read the brief's `citation_style` (config.toml already mirrors it).
- **Expected merge conflicts (§6 hot regions):**
  - `llm-contracts.ts`: imports and the IntakeClarifier region.
  - `llm-stubs.ts`: imports and the intake-clarifier entry.
  - `paths.ts`: `resolvePaperRoot`, the bare-run clause and the import.
  - The prompt-loader and repo-files hash lines.
  - The CLAUDE.md Discipline-literals row.
  - Test files edited outside owned paths: `flags`, `llm-transport`, `replay`, `installed-offline`, `paper-root-resolver`, `cost-cap`, `cli-exit-codes`, `citation-render`.
