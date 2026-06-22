---
phase: 03-vertical-slice-one-section
plan: 06
subsystem: workflows
tags: [workflow-bodies, capability-check, tier-equivalence, deterministic-verify, d-13, d-08-amended, d-12-locked-slugs, d-20-canonical-bibtex, bl-1, bl-2, bl-4, section-isolation]

requires:
  - phase: 03-vertical-slice-one-section
    provides: "Wave 1 — bin/lib/normalize.ts, bin/lib/fuzzy.ts, bin/lib/author-normalize.ts, bin/lib/pdf-text.ts, bin/lib/citations.ts (D-19 chokepoint)"
  - phase: 03-vertical-slice-one-section
    provides: "Wave 2 — zod schemas (state-v2, source-candidate, plan-frontmatter, handoff), bin/lib/state.ts, bin/lib/migrations/state/v1_to_v2.ts, bin/lib/paths.ts, bin/lib/runtime.ts, bin/lib/frontmatter.ts, bin/lib/deep-equal.ts"
  - phase: 03-vertical-slice-one-section
    provides: "Wave 3 — bin/lib/sources/ 7-adapter registry, bin/lib/http-mock.ts cassette loader, bin/lib/citekey.ts, bin/lib/bibtex-write.ts writeBibtex"
provides:
  - "workflows/new.md  — intake body (canonical filename per UX02_VERBS bijection; intake verb body content)"
  - "workflows/research.md — research body (7-adapter fan-out, Retraction Watch cross-check, canonical CITATIONS.bib write)"
  - "workflows/outline.md — outline body with APPROVAL GATE (OUTL-03 PRD non-negotiable, --yolo skip)"
  - "workflows/plan.md — per-section plan body with section-isolation invariant"
  - "workflows/write.md — per-section drafter body with assertDrafterInput contract + RESTRICTED VIEW"
  - "workflows/verify.md — per-section verifier body — 100% DETERMINISTIC per D-13 (no LLM calls)"
affects: [plan-03-07-verb-entrypoints, plan-03-08-doctor-doct-05, plan-03-09-tier-contract-graduation, phase-08-pass1-pass3-llm-tie-break]

tech-stack:
  added: []
  patterns:
    - "Workflow body shape: <capability_check> preserved from Phase 2 above a `## Body` section that drives the verb via Tier-1 (Task/MCP) → Tier-2 (shell) equivalence."
    - "D-12 LOCKED prompt slugs referenced as filename strings (workflows do NOT load prompts — bin/cli/<verb>.ts loads them via prompt-loader.ts at runtime)."
    - "D-13 LOCKED INVARIANT documented twice in verify.md (overview block + ## Body block) for grep-pin and human-reader redundancy."
    - "BL-2 GATE self-inert: the audit regex is named-but-not-quoted in verify.md so a grep on the file matches zero LLM-invocation patterns (the regex lives in 03-06-PLAN.md verification block)."

key-files:
  created:
    - "(none — all 6 workflow files already existed as Phase 2 capability-check stubs)"
  modified:
    - "workflows/new.md  — added 69 LOC (intake body + 7-stage PII redaction order + 9-discipline preset detection)"
    - "workflows/research.md — added 71 LOC (7-adapter fan-out + Retraction Watch surfacing + canonical CITATIONS.bib write)"
    - "workflows/outline.md — added 59 LOC (APPROVAL GATE + RETRACTED annotation + walker validation)"
    - "workflows/plan.md — added 55 LOC (section-planner D-12 slug + status='planned' default + TEST-09 isolation)"
    - "workflows/write.md — added 57 LOC (section-drafter D-12 slug + assertDrafterInput + RESTRICTED VIEW + status='writing'→'written')"
    - "workflows/verify.md — added 135 LOC (D-13 LOCKED INVARIANT + Pass-1 AND-gate + Pass-3 4-way verdict + D-08-AMENDED 4 terminal states + template-literal narration)"

key-decisions:
  - "Wrote the intake-verb body into workflows/new.md (NOT workflows/intake.md as the plan files_modified lists). Rationale: ARCH-01 (workflows-keyequal.test.ts) enforces a bijection between workflows/*.md and UX02_VERBS = bin/lib/verbs.ts (which lists 'new', not 'intake'). The plan explicitly forbids touching files outside workflows/*.md, which rules out renaming UX02_VERBS in the same commit. Plan 07's dispatcher will alias `pensmith new` → `pensmith intake`; a future plan can rename the file. The body content is exactly what the plan describes for workflows/intake.md — only the filename differs. Logged as Rule 3 deviation."
  - "D-13 audit-gate self-inert phrasing: the BL-2 GATE regex was originally quoted verbatim inside the verify.md body footer, which made `grep -cE \"invoke .*prompt|...\" workflows/verify.md` return 1 (matching the quoted regex itself). Resolved by naming the gate ('BL-2') and pointing to the regex's canonical location in 03-06-PLAN.md verification block, rather than quoting it inline. The file now grep-pin-asserts itself."
  - "Markdownlint warnings (MD007/MD031/MD032/MD040 — list indentation, fences, blank lines) are IDE-only and not part of `npm run lint` (which runs ESLint over .ts). They match the existing Phase-2 capability-check stub pattern (doctor.md, etc.) and were not corrected — keeping the workflow files visually consistent with the Phase-2 stubs takes precedence over a soft IDE warning."

requirements-completed:
  - INTK-01
  - INTK-02
  - INTK-03
  - INTK-04
  - INTK-05
  - RSCH-01
  - RSCH-02
  - RSCH-03
  - RSCH-04
  - RSCH-08
  - RSCH-09
  - OUTL-01
  - OUTL-02
  - OUTL-03
  - OUTL-04
  - PLAN-01
  - PLAN-04
  - WRTE-01
  - WRTE-03
  - VRFY-01
  - VRFY-02
  - VRFY-04
  - VRFY-05
  - VRFY-07
  - VRFY-08

duration: 13min
completed: 2026-05-26
---

# Phase 03 Plan 06: Workflow Bodies Summary

**6 workflow body slots filled — intake/research/outline/plan/write/verify. Verify is 100% DETERMINISTIC per D-13 (zero LLM calls between Pass-1 fetch and VERIFICATION.md write); research writes canonical `.paper/CITATIONS.bib` via writeBibtex (D-20); outline pauses on the APPROVAL GATE by default unless `--yolo` (OUTL-03 PRD non-negotiable); intake honors INTK-05 PII redaction with a 7-stage deterministic order; all per-section verbs reference TEST-09 section-isolation. All Phase-2 `<capability_check>` blocks preserved (ARCH-03).**

## Performance

- **Duration:** ~13 min (Task 6.1 commit -> Task 6.2 commit -> SUMMARY)
- **Started:** 2026-05-26T12:55:31Z
- **Completed:** 2026-05-26T13:08:27Z
- **Tasks:** 2 / 2 complete
- **Files created:** 0 (all 6 workflow files pre-existed as Phase-2 capability-check stubs)
- **Files modified:** 6

## Workflow Body Sizes (LOC)

| File | LOC | Body covers |
|------|-----|-------------|
| workflows/new.md | 69 | INTK-01..05 (intake verb body — canonical filename per UX-02 bijection) |
| workflows/research.md | 71 | RSCH-01..04, RSCH-08, RSCH-09 (7-adapter fan-out + canonical CITATIONS.bib) |
| workflows/outline.md | 59 | OUTL-01..04 (approval gate default-on, --yolo skip) |
| workflows/plan.md | 55 | PLAN-01, PLAN-04 (section-isolation, D-08-AMENDED status='planned') |
| workflows/write.md | 57 | WRTE-01, WRTE-03 (assertDrafterInput T-3-10, RESTRICTED VIEW PRD §7.6) |
| workflows/verify.md | 135 | VRFY-01/02/04/05/07/08 (D-13 LOCKED, 100% deterministic, 4 terminal states) |
| **total** | **446** |  |

## Capability-Check Preservation Confirmation

All 6 workflow files preserve their Phase-2 `<capability_check>` blocks. Each file contains `capability_check` appearing >= 2 times (open + close tag):

```text
workflows/new.md: 3 occurrences (extra in the canonical-naming note)
workflows/research.md: 2 occurrences
workflows/outline.md: 2 occurrences
workflows/plan.md: 2 occurrences
workflows/write.md: 2 occurrences
workflows/verify.md: 2 occurrences
```

`ARCH-03` (workflows-keyequal.test.ts) test remains GREEN — every workflow body has a `<capability_check>` block with both `required:` and `degrade_if_missing:` lists, and every `required:` token is in the W4 closed Phase-2 vocabulary `{Task, AskUserQuestion, MCP <name>, Pandoc, Zotero MCP, humanizer skill, (none required)}`.

## Tier-Contract Test Output

Tier-contract test cases for the 6 new workflows remain `# todo` (Wave 0 RED) — they graduate to assertions in Plan 09 Task 9.1 once the matching `bin/cli/<verb>.ts` files exist (Plan 07, parallel wave). This is the expected Wave 4 state.

- **Case A (DOCT-06): capability fact equivalence (MCP vs CLI)** — PASS
- **Case B: paper://capabilities shape + secret-substring scan** — PASS
- **Case C: paper_advance_section is idempotent** — FAIL (pre-existing; documented v1→v2 breakage)
- **Case D (TIER-07): fact-set equivalence with ±20% tolerance** — PASS
- 6 Phase-3 cases (intake/research/outline/plan-section/write-section/verify-section): `# todo` (skip-guarded on `bin/cli/<verb>.ts` existence — Plan 07 graduates).

## BL-2 GATE Output (verify.md — D-13 LOCKED INVARIANT)

LLM-invocation patterns in `workflows/verify.md ## Body` MUST be 0:

```text
$ grep -cE "invoke .*prompt|delegate to Task|invoke verify-pass|invoke pass1|invoke pass3" workflows/verify.md
0
```

DORMANT prompt slugs in `workflows/verify.md` MUST be 0:

```text
$ grep -c "pass1-fuzzy-judge\.md\|pass3-quote-checker\.md\|verify-pass1\.md\|verify-pass3\.md" workflows/verify.md
0
```

Extended scope — DORMANT prompts in `bin/`, `workflows/`:

```text
$ grep -rn "pass1-fuzzy-judge\.md\|pass3-quote-checker\.md" workflows/ bin/
(no output — 0 matches)
```

## BL-4 GATE Output (canonical BibTeX D-20)

`.paper/CITATIONS.bib` MUST be referenced in BOTH `workflows/research.md` (writer) AND `workflows/verify.md` (reader):

```text
$ grep -c "\.paper/CITATIONS\.bib" workflows/research.md workflows/verify.md
workflows/research.md:6
workflows/verify.md:4
```

Both files reference the canonical-BibTeX file (>= 1 each — gate passes).

## BL-1 GATE Output (old slug absence)

Old slugs (intake-clarify, research-queries, outline-propose, plan-section, write-section, verify-pass[13], draft-summary) MUST be absent from all 6 workflows:

```text
$ grep -E "intake-clarify\.md|research-queries\.md|outline-propose\.md|plan-section\.md|write-section\.md|verify-pass[13]\.md|draft-summary\.md" workflows/*.md
(no output — 0 matches)
```

## D-08-AMENDED Terminal-State Gate (CYCLE-5 L-2)

`workflows/verify.md` body MUST persist the terminal `'unverifiable'` literal:

```text
$ grep -c "unverifiable" workflows/verify.md
6
```

`'unverifiable'` appears 6 times in the verify body (Pass-3 per-source verdict + overall-verdict computation step 8 + status-update step 10 + phase-3 policy block).

## Section-Isolation Invariant (TEST-09)

All 3 per-section verbs reference TEST-09:

```text
$ grep -c "TEST-09" workflows/plan.md workflows/write.md workflows/verify.md
workflows/plan.md:3
workflows/write.md:2
workflows/verify.md:2
```

## Accomplishments

- All 6 workflow body slots filled — `## Body` present in every file.
- Phase-2 `<capability_check>` blocks preserved unchanged in all 6 files (ARCH-03 still GREEN).
- D-12 LOCKED prompt slugs used everywhere (intake-clarifier, topic-disambiguator, source-evaluator, outline-author, section-planner, section-drafter). Zero references to old slugs.
- D-20 canonical `.paper/CITATIONS.bib` write path documented in `research.md` (via `writeBibtex`) and read path documented in `verify.md` (via `bin/lib/citations.ts parseBibtex`).
- D-13 LOCKED INVARIANT documented in `verify.md` overview block + `## Body` block + 100%-deterministic narration footer. Zero LLM-invocation patterns in the body (BL-2 GATE).
- D-08-AMENDED LOCKED status enum (`planned`/`writing`/`written`/`verifying`/`verified`/`failed`/`unverifiable`) used in `plan.md`/`write.md`/`verify.md`.
- TEST-09 section-isolation invariant referenced in `plan.md`/`write.md`/`verify.md`.
- OUTL-03 PRD non-negotiable APPROVAL GATE present in `outline.md` (default-on; only `--yolo` skips).
- INTK-05 PII redaction step present in `new.md` body with 7-stage deterministic redaction order documented and locked.
- Retraction Watch cross-check + stderr WARN line documented in `research.md`; RETRACTED annotation in `outline.md` approval gate; retracted-flag override sub-gate (4a) in `verify.md`.

## Task Commits

1. **Task 6.1: Fill intake, research, outline workflow bodies** — `842d9ed` (feat)
2. **Task 6.2: Fill plan, write, verify workflow bodies (verify = 100% DETERMINISTIC per D-13)** — `ef384ae` (feat)

Both commits sit atop `EXPECTED_BASE 467cc9c` (main HEAD after Wave 3 merge + STATE advance).

## Files Created / Modified

### Created (production)

None — all 6 workflow files pre-existed as Phase-2 capability-check stubs.

### Modified

- `workflows/new.md` — intake verb body (canonical UX02_VERBS filename — see Rule 3 deviation below).
- `workflows/research.md` — research verb body (7-adapter fan-out, Retraction Watch surfacing, canonical CITATIONS.bib write).
- `workflows/outline.md` — outline verb body (APPROVAL GATE default-on, --yolo skip, RETRACTED annotation, walker DAG validation).
- `workflows/plan.md` — per-section plan verb body (section-planner D-12 slug, D-08-AMENDED status='planned' default, TEST-09 isolation, no-self-ref).
- `workflows/write.md` — per-section write verb body (section-drafter D-12 slug, assertDrafterInput T-3-10 contract, RESTRICTED VIEW PRD §7.6, status='writing'→'written' D-08-AMENDED, Pandoc [@citekey] D-21).
- `workflows/verify.md` — per-section verify verb body (D-13 LOCKED INVARIANT 100% deterministic, Pass-1 jaroWinkler AND-gate with field-presence sub-gate, Pass-3 levenshteinSubstring with 4-way verdict, D-08-AMENDED 4 terminal states, template-literal narration, retracted-flag override, multi-DOI redirect strict band, quote-extractor >=10-word min, .paper/CITATIONS.bib via citations.ts D-19/D-20).

## Decisions Made

1. **Wrote the intake-verb body into `workflows/new.md` (NOT `workflows/intake.md`).** The plan's `files_modified` lists `workflows/intake.md`, but ARCH-01 (workflows-keyequal.test.ts) requires bijection with `UX02_VERBS = bin/lib/verbs.ts`, which currently lists `new` (not `intake`). The plan's scope discipline forbids touching files outside `workflows/*.md`, which rules out updating `verbs.ts` in this commit. Plan 07 will alias `pensmith new` → `pensmith intake` in the dispatcher; a future plan can rename the file when `verbs.ts` updates. The body content is exactly what the plan describes for `workflows/intake.md` — only the filename differs. Logged as Rule 3 deviation below.
2. **D-13 audit-gate self-inert phrasing.** The BL-2 GATE regex was originally quoted verbatim inside the `verify.md` body footer, which made `grep -cE "invoke .*prompt|...|invoke pass3" workflows/verify.md` return 1 (matching the quoted regex itself, not real LLM-invocation patterns). Resolved by referring to the gate by name ('BL-2') and pointing readers to the regex's canonical location in `03-06-PLAN.md` verification block. The file now grep-pin-asserts itself with zero false positives.
3. **Phase-3 verify is 100% deterministic; DORMANT prompts ship but are NEVER referenced.** The `pass1-fuzzy-judge.md` and `pass3-quote-checker.md` files are hash-pinned by Plan 05 (parallel Wave 4) — but they are calibrated for Phase 8 ambiguous-case tie-break only. `workflows/verify.md` body references neither slug nor any `loadPrompt(...)` call; the verdict is produced by `jaroWinkler` + `levenshteinSubstring` alone with template-literal narration. This is the D-13 LOCKED INVARIANT.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Intake workflow body written to `workflows/new.md`, not `workflows/intake.md`.**

- **Found during:** Task 6.1 startup (loading existing workflow stubs).
- **Issue:** The plan's `files_modified` block lists `workflows/intake.md`, but this file does not exist. The current `workflows/` directory has `workflows/new.md` (a Phase-2 stub) and no `intake.md`. Creating `intake.md` alongside `new.md` would produce 17 workflow files vs. 16 entries in `UX02_VERBS` (bin/lib/verbs.ts), failing the ARCH-01 bijection test (workflows-keyequal.test.ts). Renaming `new.md` → `intake.md` would require updating `bin/lib/verbs.ts` AND the dispatcher in `bin/pensmith.ts`, both of which are outside the plan's explicit scope (`DO NOT touch ANY file outside workflows/*.md`).
- **Fix:** Wrote the intake-verb body (exactly as described in the plan for `workflows/intake.md`) into `workflows/new.md`. Added a CYCLE-3 NAMING NOTE at the top of the file documenting that this is the intake-verb body and pointing forward to Plan 07's alias dispatcher (`pensmith new` ≡ `pensmith intake`) and a future filename rename when `verbs.ts` updates.
- **Files modified:** `workflows/new.md`.
- **Commit:** `842d9ed`.
- **Impact:** All plan acceptance criteria (D-12 LOCKED slug `intake-clarifier.md`, INTK-05 PII redaction order, 9-discipline preset detection, BL-1 GATE old-slug absence) are satisfied in `workflows/new.md`. The only mismatch with the plan is the filename; the substance is identical. Plan 07 will dispatch both `new` and `intake` to the same handler.

**2. [Rule 3 — Blocking issue] BL-2 GATE self-match in verify.md audit footer.**

- **Found during:** Task 6.2 acceptance verification.
- **Issue:** The first draft of `workflows/verify.md` quoted the BL-2 GATE regex verbatim in the body footer: `Audit gate: a `grep -cE "invoke .*prompt|delegate to Task|invoke verify-pass|invoke pass1|invoke pass3" workflows/verify.md` MUST return 0...`. Running that grep against the file matched the quoted regex itself, returning 1 instead of 0. The gate failed mechanically while the body was substantively correct (no actual LLM-invocation patterns in any other line).
- **Fix:** Replaced the quoted regex with a named reference: `Audit gate (BL-2): a CI-side regex grep on this file matches zero LLM-invocation patterns inside the ## Body section. The exact regex lives in 03-06-PLAN.md verification block ...`. The regex is now defined ONCE in the plan; the verify body asserts the gate's existence and its enforcement location but does not duplicate the regex inline.
- **Files modified:** `workflows/verify.md`.
- **Commit:** `ef384ae`.
- **Impact:** BL-2 GATE now returns 0; verify body remains substantively unchanged. Future edits should preserve this self-inert phrasing.

## Gate Status

| Gate | Status | Notes |
|------|--------|-------|
| `npm run lint` | exit 0 | ESLint over .ts — green; markdownlint IDE warnings are IDE-only, not part of the lint script |
| `npx tsc --noEmit` | exit 0 | (after running `node scripts/prebuild.mjs` which generates `bin/lib/version.generated.ts`) |
| `npm run build` | exit 0 | prebuild → tsc |
| `npm test` (baseline) | 11 fail | Pre-existing Wave 0 RED scaffold (5 module-existence assertions + state schema v1→v2 expected breakage + tier-contract Case C). |
| `npm test` (after) | 11 fail | **Delta = 0** — no regressions, no new failures. (Failing test count must DECREASE or stay the same per plan post-merge gate.) |

| Gate | Result |
|------|--------|
| BL-1 GATE (old slug absence in workflows/*.md) | 0 matches — PASS |
| BL-2 GATE (LLM-invocation patterns in verify.md ##Body) | 0 matches — PASS |
| BL-2 GATE (DORMANT prompt slugs in verify.md) | 0 matches — PASS |
| BL-2 GATE (extended scope: bin/ + workflows/) | 0 matches — PASS |
| BL-4 GATE (.paper/CITATIONS.bib in research + verify) | research: 6, verify: 4 — PASS |
| D-08-AMENDED terminal-state gate ('unverifiable' in verify.md) | 6 occurrences — PASS |
| ARCH-03 (capability_check + required + degrade_if_missing in all 6) | PASS |
| TEST-09 (section-isolation invariant in plan/write/verify) | 3/3 files reference — PASS |

## Self-Check: PASSED

Files exist (verified via `git show HEAD:workflows/<file>.md` round-trip):

- workflows/new.md ✓
- workflows/research.md ✓
- workflows/outline.md ✓
- workflows/plan.md ✓
- workflows/write.md ✓
- workflows/verify.md ✓

Commits exist on top of EXPECTED_BASE (`467cc9c`):

- `842d9ed` feat(03-06): Task 6.1 — fill intake/research/outline workflow bodies ✓
- `ef384ae` feat(03-06): Task 6.2 — fill plan/write/verify workflow bodies (verify = 100% DETERMINISTIC per D-13) ✓
