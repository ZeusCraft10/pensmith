---
phase: 09-educator-tutorial-mode-pii-polish
plan: 01
subsystem: pii
tags: [pii, redaction, ipv4, iban, name-suppression, diff, pure-module, ergo-07]

# Dependency graph
requires:
  - phase: 09-00
    provides: "tests/pii-polish.test.ts RED-by-skip suite + tests/fixtures/pii-polish-corpus.ts (IP/IBAN positives, NAME suppress negatives + two-token positives, DIFF_CASES, PII_EGRESS_SENTINELS)"
  - phase: 01
    provides: "bin/lib/pii.ts Phase-1 classifyPii/redactPii/redactKeys (EMAIL/PHONE/SSN/NAME/DATE) — extended in place"
provides:
  - "classifyPii extended with IP (dotted-quad IPv4) + IBAN-like classes"
  - "NAME suppression via bundled name-suppression.json (~500 curated tokens, no NLP)"
  - "pure deterministic idempotent diffPii(original, _redacted?) -> PiiDiff[] (SC-3 review diff)"
  - "PiiDiff interface { span, kind, raw, tag } exported"
affects:
  - "09-03 (intake PII wiring: diffPii feeds the user-review diff before persist + redacted egress payload H3)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bundled JSON data file (name-suppression.json) via static `import ... with { type: 'json' }` — pure (no runtime fs)"
    - "Two-stage NAME suppression: DROP if all tokens suppressed, else TRIM leading suppressed tokens while >=2 tokens remain"
    - "diffPii derives spans from classifyPii(original) — never char-by-char string diff (determinism under tied spans)"

key-files:
  created:
    - bin/lib/name-suppression.json
  modified:
    - bin/lib/pii.ts

key-decisions:
  - "NAME suppression combines DROP-if-all-suppressed + TRIM-leading-while->=2-remain to satisfy both corpus poles (Author Jane Smith -> Jane Smith; In Smith kept; Results Section dropped)"
  - "diffPii second param is optional and unused (API symmetry only); diff is derived from original via classifyPii"

patterns-established:
  - "Pure-module data dependency: bundle curated JSON and static-import it rather than pulling an NLP/PII runtime dep (PII-V2-01 keeps NLP for v2)"
  - "Reviewable diff (D-49): each new regex carries an inline comment block matching the existing per-pattern convention"

requirements-completed: [ERGO-07]

# Metrics
duration: 14min
completed: 2026-06-20
---

# Phase 9 Plan 01: pii.ts Polish (IP/IBAN + NAME suppression + pure diffPii) Summary

**Extended the pure PII module beyond regex-only — added IPv4 + IBAN-like classes, a ~500-token bundled NAME-suppression dictionary that drops academic/section/month false positives without any NLP dependency, and a deterministic, idempotent `diffPii()` that derives a reviewable structured diff from `classifyPii` — while keeping every Phase-1 export byte-compatible.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-06-20
- **Completed:** 2026-06-20
- **Tasks:** 2 (both TDD: RED suite landed in 09-00, this plan turned it GREEN)
- **Files modified:** 1 modified (`bin/lib/pii.ts`), 1 created (`bin/lib/name-suppression.json`)

## Accomplishments

- `PiiKind` union extended with `'IP' | 'IBAN'`; `RE_IP` (dotted-quad IPv4) and `RE_IBAN_LIKE` (bounded `{4,30}` BBAN, preserving the T-01-REDOS-01 no-nested-quantifier guarantee) inserted BEFORE `NAME` in `PATTERNS` so they win the exact-tie overlap pass.
- `bin/lib/name-suppression.json` — a bundled, curated array of ~500 common capitalized non-name tokens (12 months, weekdays, section/academic headings, sentence-leading function words, common academic terms). Static-imported and frozen into `NAME_SUPPRESSION: ReadonlySet<string>` at module load — pure, no runtime I/O, NOT a dependency (NLP/Presidio deferred to v2 per PII-V2-01).
- `resolveSuppressedName` two-stage filter (RESEARCH Pitfall 6): (1) DROP a NAME match whose every token is suppressed (`Results Section`, `January March`); (2) otherwise TRIM leading suppressed tokens but only while >=2 tokens remain (`Author Jane Smith` -> `Jane Smith`; `In Smith` kept because trimming `In` would leave a lone `Smith`). Span starts are adjusted by the trimmed-prefix byte offset so downstream redaction stays correct.
- Pure deterministic `diffPii(original, _redacted?)` + exported `PiiDiff { span, kind, raw, tag }`. Derived from `classifyPii(original)` (already deterministic + overlap-resolved); each entry tagged `[REDACTED:${kind}]` matching `redactPii`'s splice. Idempotent (already-redacted text yields an empty diff). No `Date.now`/`Math.random`/`randomUUID`/I/O anywhere (grep-confirmed: only comment mentions).

## Task Commits

Each task committed atomically:

1. **Task 1: Extend PiiKind + IP/IBAN patterns + NAME suppression dictionary** - `91e31fa` (feat)
2. **Task 2: Pure deterministic diffPii export** - `aed5fd7` (feat)

_TDD note: the RED suite (`tests/pii-polish.test.ts`) landed in 09-00; this plan's commits are the GREEN step (no separate test commit was needed — RED was pre-staged)._

## Files Created/Modified

- `bin/lib/name-suppression.json` - bundled ~500-token curated common-capitalized non-name dictionary (deterministic data, not a dep)
- `bin/lib/pii.ts` - extended `PiiKind` (+IP/IBAN), `RE_IP`/`RE_IBAN_LIKE`, `NAME_SUPPRESSION` Set + `resolveSuppressedName` two-stage filter wired into `classifyPii`, new `PiiDiff` interface + pure `diffPii` export; pure-module header updated to document the static JSON import and the new pure exports

## Decisions Made

- **NAME suppression rule chosen by corpus reconciliation.** The plan `<behavior>` and the corpus comment described the suppression slightly differently. The corpus pins both poles: `Author Jane Smith` -> exactly `Jane Smith` (leading suppressed token trimmed) AND `In Smith` -> kept whole (trimming would orphan a single token, which the NAME regex never matches). The implemented two-stage rule (DROP-if-all-suppressed, else TRIM-leading-while->=2-remain) is the unique rule satisfying all four corpus cases. Documented inline above `resolveSuppressedName`.
- **`diffPii` second param is optional and unused.** The plan's signature is `diffPii(original, redacted)` for API symmetry, but the RED suite only ever calls `diffPii(x)`. Made `_redacted` optional and derived the diff purely from `original` via `classifyPii` — no char-by-char string diff (which would be non-deterministic under tied spans).

## Deviations from Plan

None - plan executed exactly as written. The two decisions above are clarifications of intentional plan latitude (corpus-pinned suppression semantics; optional symmetry param), not corrections to broken behavior.

## Issues Encountered

- **Initial NAME-suppression filter over-grabbed leading words.** A first pass used a boolean "drop only if ALL tokens suppressed" filter; `Author Jane Smith` then classified as the full 3-token `Author Jane Smith` instead of the corpus-required `Jane Smith`. Resolved within Task 1 by upgrading the filter to the two-stage DROP/TRIM resolver with span-offset adjustment. Verified against all five NAME corpus cases before committing.

## Threat Model Compliance

- **T-09-01-01 (NAME over-suppression):** mitigated — two-stage rule keeps `In Smith`, drops `Results Section`/`January March`; pinned by corpus tests.
- **T-09-01-02 (non-deterministic diff):** mitigated — `diffPii` is pure positional math from `classifyPii`; determinism + idempotence + purity tests all green.
- **T-09-01-03 (ReDoS on new patterns):** mitigated — `RE_IP` fixed-shape, `RE_IBAN_LIKE` bounded `{4,30}`, no nested quantifiers; T-01-REDOS-01 invariant preserved.
- **T-09-01-04 (PII slipping past classifier):** accepted per plan — regex+dictionary recall is bounded; stronger NLP deferred to v2 (PII-V2-01); false-negatives are the documented acceptable failure mode (D-49).

## Verification

- `node --import tsx --test tests/pii.test.ts tests/pii-polish.test.ts` — 19 tests, 19 pass, 0 fail, 0 skipped (pii-polish woke from RED-by-skip and is now fully GREEN; Phase-1 suite unchanged).
- `tsc --noEmit` — clean (static JSON import resolves under `resolveJsonModule`).
- `eslint bin/lib/pii.ts` — clean.
- `npm test` (full suite) — 816 tests, 799 pass, 0 fail, 17 skipped (up from 792 pass / 24 skipped at the 09-00 baseline; the 7 pii-polish tests moved skipped -> pass; remaining 17 skips are later-wave 09-02/09-03 RED-by-skip suites).
- Purity grep: `Date.now` / `Math.random` / `randomUUID` / `fs.` / `fetch(` / `require(` appear ONLY in comments in `pii.ts`.

## Known Stubs

None — both new surfaces (IP/IBAN classify + suppression dictionary, and `diffPii`) are fully wired and pinned by passing tests. The `diffPii` `_redacted` parameter is intentionally unused (API symmetry), not a stub.

## Next Phase Readiness

- `diffPii` + `PiiDiff` are ready for 09-03 (intake PII wiring): the deterministic diff feeds the user-review display before persist (SC-3) and the redacted egress payload (H3). The `intake-pii-ordering` / `intake-pii-egress` RED-by-skip suites remain skipped until 09-03 wires `diffPii` before `loadPrompt('intake-clarifier')`.
- 09-02 (TutorialSubscriber render) is independent of this module; `pii.ts` stays goal-unaware (no educator/learning tokens), preserving the zero-branch invariant.

## Self-Check: PASSED

- `bin/lib/pii.ts` — present, contains `RE_IP`, `RE_IBAN_LIKE`, `NAME_SUPPRESSION`, `export function diffPii`, `export interface PiiDiff`.
- `bin/lib/name-suppression.json` — present.
- Commits `91e31fa`, `aed5fd7` — verified in git log.

---
*Phase: 09-educator-tutorial-mode-pii-polish*
*Completed: 2026-06-20*
