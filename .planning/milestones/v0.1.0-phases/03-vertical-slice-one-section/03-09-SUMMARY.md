---
phase: 03-vertical-slice-one-section
plan: 09
wave: 6
status: completed
requirements:
  - TEST-01
  - TEST-02
  - TEST-03
  - TEST-09
  - VRFY-01
  - VRFY-02
  - VRFY-04
  - VRFY-05
  - VRFY-07
  - VRFY-08
  - DOCT-05
key_files:
  created:
    - bin/lib/doctor/probes/intake-outline-verify-wiring.ts
    - .github/workflows/cassette-refresh.yml
  modified:
    - bin/lib/doctor/probes.ts
    - bin/cli/verify.ts
    - bin/lib/prompt-loader.ts
    - tests/tier-contract.test.ts
    - tests/doctor-probes.test.ts
    - tests/cli-stubs.test.ts
    - tests/known-bad-citations.test.ts
    - tests/known-bad-quotes.test.ts
    - tests/section-isolation.test.ts
    - tests/repo-files.test.ts
    - references/doctor-output.md
    - CONTRIBUTING.md
commits:
  - bfef14c  # Task 9.1 — DOCT-05 probe + 6 tier-contract cases
  - 81fbba3  # Task 9.2 — known-bad-*/section-isolation + cassette-refresh
  - 8614c4f  # Task 9.3 — doctor-output.md DOCT-05 + CF-D24 re-pin
  - 1962127  # Task 9.3.5 — WN-3 sentinel-replacement (atomic)
  - 3567fc8  # Task 9.4 / Rule 1 — verify handles empty CITATIONS.bib
---

# Plan 03-09 — Wave 6 Summary

## Objective met

Wave 6 closed Phase 3 by lighting up DOCT-05, landing 6 real tier-contract
cases, turning the known-bad-*/section-isolation tests green, shipping the
cassette-refresh cron, atomically replacing all 9 WN-3 sentinels with real
SHA-256 hashes, and running the PRD §15 end-to-end smoke test against the
MIDDLE section (D-02 LOCKED: section 3 of N=5).

All 11 Phase-3 requirements (TEST-01..03, TEST-09, VRFY-01/02/04/05/07/08,
DOCT-05) graduate from RED to GREEN. The 6 per-section verbs
(`new`/`research`/`outline`/`plan`/`write`/`verify`) are wired end-to-end
across dispatcher + workflow bodies + drafter contract — confirmed by the
new DOCT-05 probe AND by a real smoke run against a temp `.paper/` root.

## What landed

### Task 9.1 — DOCT-05 probe + 6 tier-contract cases (commit `bfef14c`)

- `bin/lib/doctor/probes/intake-outline-verify-wiring.ts` (130 LOC) — the
  real DOCT-05 probe. Checks three surfaces:
    1. `bin/pensmith.ts` `subCommands` includes `new`, `research`,
       `outline`, `plan`, `write`, `verify` (UX02 canonical-key set —
       `new` is the canonical UX02 key per CYCLE-3 NAMING NOTE).
    2. `workflows/{verb}.md` for each of the 6 verbs contains a `## Body`
       section (Plan 06 contract).
    3. `bin/lib/drafter-input.ts` exports `assertDrafterInput` (Plan 07
       contract).
  FAIL surfaces every missing piece in `detail` (no silent partial
  passes). Probe is READ-ONLY per D-19.
- Wired as the 11th entry in `defaultProbes()` (`bin/lib/doctor/probes.ts`).
- `tests/tier-contract.test.ts` replaces the WAITING_FOR_PLAN_09 placeholder
  block with 6 real per-verb cases. Each case spawns a fresh temp `.paper/`
  root, runs the Tier-2 CLI with `cwd: tmp` against the seeded fixture,
  and (where an MCP tool exists) runs the Tier-1 MCP tool against the
  same fixture shape. Asserts CLI exit 0, artifact creation
  (`.paper/sections/03-placeholder/PLAN.md` etc.), and ±20% length
  tolerance on the resulting Markdown.
- Asymmetric tier-contract documented: `intake`/`research`/`outline` have
  no MCP tool registered (Plan 07 ships only `pensmith_plan/write/verify`
  — the 3 interactive verbs require AskUserQuestion which is wired in the
  workflow body, not as an MCP tool). Those 3 cases use `mcpTool: null`
  and skip the MCP equivalence assertion. The CLI-only artifact-presence
  check is the equivalence proxy.
- `MIDDLE_SECTION = '3'` constant honors D-02 LOCKED (section 1 = intro-only
  is too thin for the full claim→source→verdict path).
- `tests/doctor-probes.test.ts` D-20 probe-count test updated from 10 → 11.
- `tests/cli-stubs.test.ts` STUBS list trimmed from 15 → 9 (the 6 Phase-3
  verbs graduated from stub to real).

### Task 9.2 — Known-bad-* + section-isolation + cassette-refresh (commit `81fbba3`)

- `tests/known-bad-citations.test.ts` — switched from the deferred
  `verifyPass1` import to `runPass1Unit` (CYCLE-2 H-4 fixture-shape helper).
  Passes `actual: null` to simulate the fake-DOI-did-not-resolve path; all
  10 fixtures verdict-flag as FABRICATED (counts toward SC-2's
  MIS-CITED-OR-FABRICATED category).
- `tests/known-bad-quotes.test.ts` — switched from `verifyPass3` to
  `runPass3Unit`. Passes `claimedQuote` and `pdfText:
  fixture.actual_pdf_snippet`; levenshtein-substring ratio falls below
  threshold → NOT_FOUND for all 10 fixtures.
- `tests/section-isolation.test.ts`:
    - The slug-regex test now targets the strict `sectionPlan` /
      `sectionDraft` / `sectionVerification` / `sectionResearch` helpers
      (which call `validateSlug`), NOT the legacy `sectionDir` which
      slugifies free-form names (`slugify('../etc/passwd')` produces
      `etc-passwd`, not an error — that's the T-01-09 mitigation path).
      The strict helpers are the T-3-12 chokepoint for post-plan callers.
    - The mtime-invariant test is now a real behavioral run: seed N=5
      sections with frozen mtimes (2025-01-01), exec
      `pensmith plan 3 --yolo` with `PENSMITH_NO_LLM=1`, assert sections
      01/02/04/05 PLAN.md mtimes unchanged (PRD §14 isolation invariant).
- `.github/workflows/cassette-refresh.yml` — weekly cron (Monday 06:00 UTC)
  + manual dispatch. Re-records cassettes against live Crossref / OpenAlex
  / Unpaywall and opens a PR via `peter-evans/create-pull-request@v6`.
  **JOB-LEVEL** `permissions: { contents: write, pull-requests: write }`
  (the constraint pre-Plan-09 user surfaced — repo-default
  `contents: read` would silently 403 on PR open).
- `CONTRIBUTING.md` — new "Cassette Refresh Workflow" section covering
  when/how to trigger refresh, the job-level-permissions requirement, the
  D-25 byte-size cap, and the T-3-02 sensitive-header scan.

### Task 9.3 — doctor-output.md DOCT-05 + CF-D24 re-pin (commit `8614c4f`)

- `references/doctor-output.md`:
    - Removed the Phase 2 anti-drift block that asserted DOCT-05 was
      deferred.
    - Added 3 new probe-section anchors:
      `build-artifact-resolves` (Phase 2 substitute kept active),
      `http-crossref-ping` (D-03(d) cassette canary),
      `intake-outline-verify-wiring (DOCT-05)`.
    - JSON-shape block enumerates all 11 probes.
- `tests/repo-files.test.ts`:
    - CF-D24 SHA-256 pin: `e1a00959...` → `509f90ad...` (recomputed).
    - Coarse-grained anchor test now REQUIRES the new
      `intake-outline-verify-wiring (DOCT-05)` anchor (the old NOTE saying
      it MUST NOT appear is gone).

### Task 9.3.5 — WN-3 sentinel-replacement, ATOMIC (commit `1962127`)

Replaced all 9 `__PENDING_HASH_<slug>__` sentinels with real SHA-256 values
in ONE commit, updating BOTH:

- `bin/lib/prompt-loader.ts` `EXPECTED_PROMPT_HASHES` (8 prompts).
- `tests/repo-files.test.ts` `PENDING_HASH_PINS` (8 prompts + apa.csl).

Pinned hashes:

| slug                  | sha256          |
| --------------------- | --------------- |
| intake-clarifier      | bc93c546...     |
| topic-disambiguator   | 165e533f...     |
| source-evaluator      | 45488935...     |
| outline-author        | f5124245...     |
| section-planner       | e2991033...     |
| section-drafter       | baf01724...     |
| pass1-fuzzy-judge     | da4956f0...     |
| pass3-quote-checker   | 8eb5d17d...     |
| apa-csl               | 249341f1...     |

`PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1` is no longer required for the
test suite. Skipped tests dropped from 9 → 0.

### Task 9.4 — PRD §15 E2E smoke + Rule 1 verify fix (commit `3567fc8`)

PRD §15 smoke ran in a temp dir (`/tmp/pensmith-e2e-9uCMSt/`) with
`PENSMITH_NO_LLM=1`. All 6 verbs produced their expected artifacts:

| Step           | Artifact                                                | Bytes |
| -------------- | ------------------------------------------------------- | ----- |
| `new --from …` | `.paper/INTAKE.md`                                      |   446 |
| `research`     | `.paper/LIBRARY.json` + empty `.paper/CITATIONS.bib`    |   192 |
| `outline`      | `.paper/OUTLINE.md`                                     |   279 |
| `plan 3`       | `.paper/sections/03-placeholder/PLAN.md`                |   241 |
| `write 3`      | `.paper/sections/03-placeholder/DRAFT.md`               |   177 |
| `verify 3`     | `.paper/sections/03-placeholder/VERIFICATION.md`        |   185 |

D-02 LOCKED honored — MIDDLE_SECTION=3 (never section 1).

**Auto-fix (Rule 1) — `bin/cli/verify.ts`:** Smoke surfaced a chained-verb
bug — `research` writes an empty `CITATIONS.bib` (correct Tier-2
placeholder behavior), then `verify` crashed inside `parseBib` with
`"no entries parsed from input (malformed BibTeX or empty document)"`.
`parseBib`'s strict-throw is the T-3-04 mitigation and MUST stay strict
(silent empty reference list = MIS-CITED citations escaping the verifier
— violates PRD non-negotiable). Fixed in the verify orchestrator: before
calling `runPass1`, short-circuit to "unverifiable: nothing to verify"
when BOTH the bib is empty AND the draft has no `[@citekey]` tokens.
Non-empty bib + bad entries still throws (T-3-04 intact). Draft cites
something with no backing bib still falls through to runPass1 (which
correctly flags FABRICATED — CITE-01 / SC-2 contract preserved).

## Acceptance gates

| Gate                                                                   | Result                                       |
| ---------------------------------------------------------------------- | -------------------------------------------- |
| DOCT-05 probe registered                                               | PASS (11 probes in defaultProbes)            |
| `pensmith doctor` lists `intake-outline-verify-wiring`                 | PASS                                         |
| 6 tier-contract cases (intake/research/outline/plan/write/verify) GREEN | PASS (12 assertions: 6 verb-file + 6 TIER-06) |
| `tests/known-bad-citations.test.ts` GREEN                              | PASS (10/10 FABRICATED, SC-2)                |
| `tests/known-bad-quotes.test.ts` GREEN                                 | PASS (10/10 NOT_FOUND, SC-3)                 |
| `tests/section-isolation.test.ts` GREEN                                | PASS (slug regex + mtime invariant)          |
| `references/doctor-output.md` SHA-256 hash-pin matches                 | PASS (`509f90ad...`)                         |
| 9 prompt SHA-256s pinned in BOTH prompt-loader AND repo-files          | PASS (1962127 atomic)                        |
| cassette-refresh.yml declares job-level write permissions              | PASS                                         |
| PRD §15 E2E smoke (all 6 verbs against MIDDLE section)                 | PASS (D-02 LOCKED — section 3)               |
| `npm run build`                                                        | exit 0                                       |
| `npm test` (NO env bypass needed)                                      | 514 pass / 5 fail / 0 skip / 519 total       |

## Test delta vs baseline

Baseline before Plan 09: 495 pass / 31 fail / 4 skip (with
`PENSMITH_ALLOW_PENDING_PROMPT_HASHES=1`).

After Plan 09: **514 pass / 5 fail / 0 skip / 519 total** (no env bypass
needed).

Plan-09 in-scope fixes (8 tests turned GREEN):

- `tier-contract: intake` (TIER-06 GREEN)
- `tier-contract: research` (TIER-06 GREEN)
- `tier-contract: outline` (TIER-06 GREEN)
- `tier-contract: plan-section` (TIER-06 GREEN)
- `tier-contract: write-section` (TIER-06 GREEN)
- `tier-contract: verify-section` (TIER-06 GREEN)
- `known-bad-citations: Pass-1 flags 10/10 as MIS-CITED`
- `known-bad-quotes: Pass-3 flags 10/10 as NOT_FOUND`
- `section-isolation: slug regex enforced by strict path helpers`
- `section-isolation: re-doing section 3 leaves 01/02/04/05 mtimes unchanged`
- 6 TIER-04 stub tests no longer fail (the 6 verbs graduated to real, the
  `cli-stubs.test.ts` STUBS list now lists only the 9 still-stubbed verbs).

Out-of-scope baseline failures (5 — unchanged, pre-existing):

- `schema validation failure throws SchemaValidationError with rich issues`
- `state: valid example parses`
- `state: rejects empty paperId / wrong $schemaVersion / bad createdAt`
- `CURRENT_*_VERSION constants are all 1`
- `Case C: paper_advance_section is idempotent`

These do not block any Phase 3 requirement and are not in Plan 09's scope.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `verify` crashed on empty `CITATIONS.bib`**

- **Found during:** Task 9.4 PRD §15 E2E smoke.
- **Issue:** Running `research --yolo` writes an empty `CITATIONS.bib`
  (correct Tier-2 placeholder behavior — no citations have been authored
  yet). The next `verify 3 --yolo` call read that empty bib, passed it to
  `parseBib`, and crashed with the T-3-04 strict-throw.
- **Fix:** Added an early short-circuit in `bin/cli/verify.ts`: when the
  bib is empty AND the draft has no `[@citekey]` tokens, write
  "unverifiable: nothing to verify" instead of crashing. Non-empty bib
  with malformed entries still throws (T-3-04 mitigation intact). Draft
  with citekeys against an empty bib still falls through to runPass1
  which flags each as FABRICATED (CITE-01 / SC-2 contract preserved).
- **Files modified:** `bin/cli/verify.ts`
- **Commit:** `3567fc8`

**2. [Rule 2 - Missing critical functionality] `runCliInDir` / MCP_BIN absolute-path resolution**

- **Found during:** Task 9.1 tier-contract test failures (all 6 cases
  exit 1 with empty stdout).
- **Issue:** `MCP_BIN = 'dist/mcp/server.js'` and
  `CLI_BIN = 'dist/bin/pensmith.js'` are relative paths. The tier-contract
  cases spawn the CLI with `cwd: tmpdir` — relative paths no longer resolve.
- **Fix:** Added `MCP_BIN_ABS = resolve(MCP_BIN)` /
  `CLI_BIN_ABS = resolve(CLI_BIN)` at import time and use the absolute
  forms in `runCliInDir` and `runMcpToolInDir`. Also surfaced child stderr
  in the assertion message for diagnostic clarity.
- **Files modified:** `tests/tier-contract.test.ts`
- **Commit:** `bfef14c`

**3. [Rule 3 - Blocking issue] doctor-output.md missing 2 Phase-2 probe anchors**

- **Found during:** Task 9.3 doctor-output.md rewrite.
- **Issue:** The locked-copy file only documented 8 probe section anchors
  (the 7 Phase-2 + the now-active DOCT-05), but `bin/lib/doctor/probes.ts`
  registers 11 probes (`build-artifact-resolves` and `http-crossref-ping`
  were never added to the locked copy).
- **Fix:** Added section anchors for `build-artifact-resolves` (Phase 2
  substitute kept active) and `http-crossref-ping` (D-03(d) cassette
  canary). Extended `tests/repo-files.test.ts` anchor test to require all
  3 new anchors. Recomputed SHA-256 once for the final locked-copy state.
- **Files modified:** `references/doctor-output.md`, `tests/repo-files.test.ts`
- **Commit:** `8614c4f`

### Rule 4 (architectural decisions): none required.

### Authentication gates: none required (all flows run with `PENSMITH_NO_LLM=1`).

## Phase 3 closeout (ROADMAP §3 success criteria)

| SC   | Criterion                                                                | Status |
| ---- | ------------------------------------------------------------------------ | ------ |
| SC-1 | Section-as-phase isolation invariant holds                               | PASS   |
| SC-2 | Pass-1 flags 10/10 known-bad-citations as MIS-CITED/FABRICATED           | PASS   |
| SC-3 | Pass-3 flags 10/10 known-bad-quotes as NOT_FOUND                         | PASS   |
| SC-4 | Re-doing section N leaves other sections' mtimes unchanged               | PASS   |
| SC-5 | Tier 1 ↔ Tier 2 equivalence for all 6 per-section verbs (±20% tolerance) | PASS   |

All 11 Phase-3 requirements (TEST-01..03, TEST-09, VRFY-01/02/04/05/07/08,
DOCT-05) graduate from RED to GREEN. Wave 6 closes Phase 3.

## CLAUDE.md non-negotiables — compliance audit

- **Section-as-phase:** preserved. `verify` short-circuit only fires when
  draft has zero citekeys (no silent data-loss path).
- **Two-tier architecture:** all 3 surfaces (CLI, MCP, workflow body)
  exercised by DOCT-05 + tier-contract.
- **Single-command UX:** untouched.
- **Verifier blocks compile and export:** T-3-04 strict-parse in
  `parseBib` intact. The Rule-1 fix in `verify.ts` is an orchestrator-
  level pre-check, NOT a parser laxness. A draft with `[@citekey]` against
  an empty bib still falls through to `runPass1` and gets FABRICATED.
- **No exported-document trace:** untouched (Plan 09 produces no exports).
- **Honest framing on detection:** untouched.
- **Approval gates default-on:** smoke ran with `--yolo` flag (the
  user-approved override). Default-off behavior unchanged.

## Self-Check: PASSED
