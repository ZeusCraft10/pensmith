---
phase: 03-vertical-slice-one-section
plan: 05
subsystem: templates
tags: [prompts, csl, disciplines, hash-pin, d-12, d-13, d-19]
dependency_graph:
  requires:
    - 03-00 (Wave 0 sentinel hash-pin slots in tests/repo-files.test.ts)
    - 03-03 (PlanFrontmatter schema referenced by section-planner output shape)
  provides:
    - templates/prompts/intake-clarifier.md (INTK-01/02/03, D-12 LOCKED slug)
    - templates/prompts/topic-disambiguator.md (RSCH-02, D-12 LOCKED slug)
    - templates/prompts/source-evaluator.md (RSCH-02, D-12 LOCKED slug)
    - templates/prompts/outline-author.md (OUTL-01/02, D-12 LOCKED slug)
    - templates/prompts/section-planner.md (PLAN-01, D-12 LOCKED slug)
    - templates/prompts/section-drafter.md (WRTE-01/03, D-21, D-13, D-12 LOCKED slug)
    - templates/prompts/pass1-fuzzy-judge.md (VRFY-01, D-12 LOCKED slug, DORMANT in Phase 3)
    - templates/prompts/pass3-quote-checker.md (VRFY-04/05, D-12 LOCKED slug, DORMANT in Phase 3)
    - templates/citation-styles/apa.csl (D-19, CITE-04, hash-pin owned by this plan; sentinel still in tests/repo-files.test.ts until Plan 09 final re-pin)
    - templates/presets/disciplines.json (INTK-03 + INTK-04, 9 effective keys)
  affects:
    - bin/lib/citations.ts renderApa() now resolves apa.csl successfully (citation-render test graduated SKIP -> PASS)
    - bin/lib/prompt-loader.ts (Plan 07) — will consume EXPECTED_PROMPT_HASHES seeded from the 8 SHA-256 values below
    - tests/repo-files.test.ts (Plan 09) — will replace __PENDING_HASH_<slug>__ sentinels with the 9 real SHA-256 values below (8 prompts + apa.csl) in one atomic commit
tech-stack:
  added: []
  patterns:
    - SHA-256 hash-pin on locked prompt + CSL bytes (extends D-18 / IN-03 pattern from Phase 2)
    - YAML-frontmatter-in-Markdown prompt format (promptId / decision / requirements + optional dormant_in_phase / dormant_reason)
    - Provenance comment block at the head of bundled-third-party-asset files (apa.csl)
key-files:
  created:
    - templates/prompts/intake-clarifier.md
    - templates/prompts/topic-disambiguator.md
    - templates/prompts/source-evaluator.md
    - templates/prompts/outline-author.md
    - templates/prompts/section-planner.md
    - templates/prompts/section-drafter.md
    - templates/prompts/pass1-fuzzy-judge.md
    - templates/prompts/pass3-quote-checker.md
    - templates/citation-styles/apa.csl
    - templates/presets/disciplines.json
  modified: []
decisions:
  - "Bundled APA 7 CSL pinned to citation-style-language/styles commit 872b2c8f6fda7129807cd3e4d695cf75adf3c15e (REVIEWS CONVERGENCE — concrete SHA in provenance header, not master HEAD). The originally-suggested SHA 3e21d5f3f9c52ec3f3b9c2bd31bd62e8e7a09a30 returned 404 against raw.githubusercontent.com; switched to the latest-reachable HEAD at write time (Rule 3 deviation, see Deviations section)."
  - "disciplines.json ships with 9 effective keys (8 INTK-03 disciplines + explicit 'other' fallback per Task 5.3 REVIEWS amendment). The intake-clarifier prompt surfaces the 8 INTK-03 buckets verbatim; the workflow uses 'disciplines.other' defaults when the user picks Other."
  - "DORMANT prompts (pass1-fuzzy-judge, pass3-quote-checker) encode dormant status in BOTH frontmatter (dormant_in_phase: 3, dormant_reason citing D-13) AND in body (blockquote 'DORMANT IN PHASE 3' + 'calibration band' language in title, role, and Hard Constraints) so the D-13 stance survives any future invocation-site refactor."
  - "section-drafter.md hard-constraints include the literal substrings 'Pandoc [@citekey]' and 'NEVER invent' to satisfy the explicit acceptance criteria; restricted-view enforcement (PRD §7.6) is encoded in both the Role description and the Hard Constraints block."
metrics:
  duration_seconds: 902
  duration_human: "~15 minutes"
  tasks_completed: 3
  files_created: 10
  files_modified: 0
  commits: 3
  completed_date: 2026-05-26
---

# Phase 3 Plan 05: Prompts + apa.csl + disciplines.json Summary

**One-liner:** Landed the 8 D-12 LOCKED prompt files (6 active + 2 DORMANT per D-13) at `templates/prompts/`, plus the bundled APA 7 CSL (provenance-headered, hash-pinned, sourced from citation-style-language/styles commit `872b2c8f`) and the 9-key disciplines.json preset (8 INTK-03 + `other` fallback). The `citation-render: templates/citation-styles/apa.csl exists` test graduated from FAIL to PASS and the citation-js render test graduated from SKIP to PASS; net failing test count dropped from 23 to 21.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 5.1 | Write 6 active prompts at D-12 LOCKED slugs | `a0bc289` | intake-clarifier.md, topic-disambiguator.md, source-evaluator.md, outline-author.md, section-planner.md, section-drafter.md |
| 5.2 | Write 2 DORMANT tie-break prompts per D-13 | `82a0f56` | pass1-fuzzy-judge.md, pass3-quote-checker.md |
| 5.3 | Bundle APA 7 CSL + 9-key disciplines.json preset | `bdf4e38` | apa.csl, disciplines.json |

## D-12 LOCKED Slug Hash-Pin Table

For Plan 07 to seed `bin/lib/prompt-loader.ts::EXPECTED_PROMPT_HASHES` and for Plan 09 to replace the `__PENDING_HASH_<slug>__` sentinels in `tests/repo-files.test.ts` (single atomic re-pin commit).

| Slug | SHA-256 | Size (bytes) | Dormant? |
|------|---------|--------------|----------|
| `intake-clarifier`    | `bc93c546f5853196379c8958b1d8895b3cc3d0c2aabef94858e48638e181ba94` | 3088 | no |
| `topic-disambiguator` | `165e533fa1119ffca44a4876212679207d65501d7b71d0b9ed9de123df84b96e` | 2580 | no |
| `source-evaluator`    | `45488935a0bd44f08b4077978c66767f369b7fb4e72696ef5d17b5c6c453c762` | 2868 | no |
| `outline-author`      | `f5124245f29c71de31ed2c330097d2141bba80c04d8a2d2cef955e0669068f42` | 2699 | no |
| `section-planner`     | `e2991033be0f7e0b28a20ffc0bfa03355e999daf445070b709077c310d5ee5b5` | 3039 | no |
| `section-drafter`     | `baf0172b4e2e96a2d2a1a6c35b5cf548faafd9436f1405e863060c619caa1d34` | 3382 | no |
| `pass1-fuzzy-judge`   | `da4956f0bbc24197739f8bfa75dcf4c29c6dac905dd33ba7c5ea94c48902149e` | 2808 | yes (Phase 3) |
| `pass3-quote-checker` | `8eb5d17d27add7afebeab77f960656229411710baf8ef243a0f9952282e5bfd9` | 2873 | yes (Phase 3) |

All 8 prompts ≤ 4096 bytes (the largest is `section-drafter` at 3382 bytes — well below the cap).

## apa.csl Provenance + Hash-Pin

| Field | Value |
|-------|-------|
| Path | `templates/citation-styles/apa.csl` |
| Size | 86108 bytes |
| SHA-256 | `249341f13df5cff992efdc71e12b9888678f8e4ad69e17fe12bd2c5245681094` |
| Upstream source | github.com/citation-style-language/styles/blob/872b2c8f6fda7129807cd3e4d695cf75adf3c15e/apa.csl |
| Upstream commit | `872b2c8f6fda7129807cd3e4d695cf75adf3c15e` |
| Pin date | 2026-05-26 |

Plan 09 replaces the `__PENDING_HASH_apa-csl__` sentinel in `tests/repo-files.test.ts` with the SHA-256 above.

## disciplines.json — 9 Effective Keys

| Key | defaultTone | defaultCitationStyle |
|-----|-------------|----------------------|
| `psychology`       | academic-formal | apa |
| `computer-science` | technical       | apa |
| `history`          | narrative       | chicago-author-date |
| `philosophy`       | argumentative   | chicago-author-date |
| `biology`          | technical       | apa |
| `sociology`        | academic-formal | apa |
| `economics`        | analytical      | apa |
| `literature`       | interpretive    | mla |
| `other`            | academic-formal | apa |

INTK-03 mapping: `CS → computer-science`, `Bio → biology`, `History → history`, `Lit → literature`, `Psych → psychology`, `Econ → economics`, `Philosophy → philosophy`, `"Other" → other preset` (not a special-case fallback per Task 5.3 REVIEWS amendment). `sociology` rounds out the 8 INTK-03 disciplines that the intake-clarifier prompt surfaces.

## DORMANT Status Confirmation

```
$ grep -c "dormant_in_phase: 3" templates/prompts/*.md | grep -v ":0"
templates/prompts/pass1-fuzzy-judge.md:1
templates/prompts/pass3-quote-checker.md:1
```

Exactly 2 files carry the D-13 DORMANT frontmatter, matching the verification block expectation. Both files additionally encode `DORMANT IN PHASE 3` in body (blockquote), `DORMANT in Phase 3` in the title parenthetical and Hard Constraints, and `calibration band` language in the Role + Hard Constraints sections.

## Gate Results

| Gate | Command | Exit | Notes |
|------|---------|------|-------|
| 1 | `npm run lint` | 0 | clean |
| 2 | `npx tsc --noEmit` | 0 | clean (requires prebuild artifact `bin/lib/version.generated.ts`, generated by `npm run build` upstream) |
| 3 | `npm run build` | 0 | clean — generates `version.generated.ts` + `verbs.json` then runs `tsc` |
| 4 | `npm test` | 1 (expected non-zero) | failing count dropped 23 → 21 (delta −2, exceeds −1 minimum); citation-render apa.csl-exists graduated FAIL→PASS; citation-js APA render graduated SKIP→PASS |

### Failing-test delta (apples-to-apples — both at base SHA `467cc9c` with `dist/` populated):

| Snapshot | Failing | Passing | Skipped |
|----------|---------|---------|---------|
| Base (`467cc9c`, dist built) | 23 | 473 | 36 |
| After plan 03-05 (HEAD `bdf4e38`, dist built) | 21 | 484 | 26 |
| Delta | **−2** | +11 | −10 |

10 of the 11 new passing tests are the SKIP→PASS graduations driven by the apa.csl + 8 prompts now existing (the per-prompt `hash-pin file exists` checks in `tests/repo-files.test.ts` were skip-guarded on file existence at base). The 11th new pass is the citation-render `citation-js parses BibTeX with accent-command and renders APA` test that was previously SKIP and is now PASS.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] apa.csl upstream commit SHA in plan body 404'd**

- **Found during:** Task 5.3
- **Issue:** The plan body specified pinning apa.csl to `github.com/citation-style-language/styles/blob/3e21d5f3f9c52ec3f3b9c2bd31bd62e8e7a09a30/apa.csl`. That commit SHA returns 404 at `raw.githubusercontent.com` (verified via `curl -fsSL`), so the fetch step could not complete as-written. The plan's own Task 5.3 action block anticipated this: *"the SHA must be locked at write time; if upstream is unreachable at write, use the most recent commit that was reachable, pin it, document the date."*
- **Fix:** Resolved current `master` HEAD via `https://api.github.com/repos/citation-style-language/styles/commits/master`, fetched apa.csl from that pinned commit, and recorded the SHA + date in the provenance comment block at the head of the file.
- **Files modified:** `templates/citation-styles/apa.csl` (new file; provenance header references `872b2c8f6fda7129807cd3e4d695cf75adf3c15e` and `Date pinned: 2026-05-26`).
- **Commit:** `bdf4e38` (Task 5.3)
- **Documentation locations:** the apa.csl provenance comment block (lines 1-7), this SUMMARY's apa.csl table above, and the apa.csl section of `decisions:` in this SUMMARY's frontmatter.

### Other Notes

- **Worktree branch advance (no Rule deviation needed):** the worktree branch HEAD started at `ecc8f4b` (a Phase-1 close commit that is an ancestor of `467cc9c`). The plan's EXPECTED_BASE was `467cc9c`. I used a fast-forward `git merge --ff-only 467cc9c` to advance the worktree branch — no commits were rewritten or discarded. The 3 plan-execution commits (`a0bc289`, `82a0f56`, `bdf4e38`) sit on top of `467cc9c`.
- **Files outside `templates/` were not touched.** Per scope discipline directive, `tests/repo-files.test.ts`, `bin/lib/prompt-loader.ts`, and the 5 documented v1→v2 expected-breakage tests remain unchanged. The `__PENDING_HASH_<slug>__` sentinels in `tests/repo-files.test.ts` correctly skip-guard via `isSentinel`, so all 9 hash-pin sentinel tests skip cleanly under this plan's commits; Plan 09 will replace them atomically.

## Authentication Gates Encountered

None.

## Known Stubs

None. All files written are production-grade for their Phase 3 role:
- The 6 active prompts encode the actual production calibration (NEVER invent, Pandoc-tokens-only, restricted-view drafter, 8-INTK-03-bucket discipline surfacing).
- The 2 DORMANT prompts are intentionally non-invocable in Phase 3 (D-13) and that intent is encoded in BOTH frontmatter + body — they are not stubs but Phase-8-targeted interface contracts.
- apa.csl is the verbatim upstream APA 7 CSL with a Pensmith provenance header — it is the production rendering template.
- disciplines.json is the production preset table consumed at intake time.

## TDD Gate Compliance

N/A — plan type is `execute`, not `tdd`. Per-task commits are `feat(...)` for each task (not RED/GREEN/REFACTOR cycle).

## Self-Check: PASSED

**Files created (all present at expected paths):**
- FOUND: templates/prompts/intake-clarifier.md
- FOUND: templates/prompts/topic-disambiguator.md
- FOUND: templates/prompts/source-evaluator.md
- FOUND: templates/prompts/outline-author.md
- FOUND: templates/prompts/section-planner.md
- FOUND: templates/prompts/section-drafter.md
- FOUND: templates/prompts/pass1-fuzzy-judge.md
- FOUND: templates/prompts/pass3-quote-checker.md
- FOUND: templates/citation-styles/apa.csl
- FOUND: templates/presets/disciplines.json

**Commits (all present in `git log`):**
- FOUND: a0bc289 — feat(03-05): Task 5.1 — write 6 active prompts at D-12 LOCKED slugs
- FOUND: 82a0f56 — feat(03-05): Task 5.2 — write 2 DORMANT tie-break prompts per D-13
- FOUND: bdf4e38 — feat(03-05): Task 5.3 — bundle APA 7 CSL + 9-key disciplines.json preset

**Verification commands:**
- `ls templates/prompts/*.md | wc -l` → 8 (correct count, all at D-12 LOCKED slugs)
- `grep -c "dormant_in_phase: 3" templates/prompts/*.md | grep -v ":0"` → exactly the 2 DORMANT files
- `grep -c "Pandoc \[@citekey\]" templates/prompts/section-drafter.md` → 1 (literal substring present)
- `grep -c "NEVER invent" templates/prompts/section-drafter.md` → 1 (literal substring present)
- `node -e "console.log(Object.keys(require('./templates/presets/disciplines.json')).length)"` → 9 (8 INTK-03 + `other` per REVIEWS amendment)
- `node -e "console.log(require('node:fs').readFileSync('templates/citation-styles/apa.csl','utf8').includes('<?xml'))"` → true (valid XML)
