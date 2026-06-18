---
phase: 06-done-export-pipeline-zero-trace-gate
plan: 02
subsystem: export-pipeline
tags: [plagiarism, duckduckgo, n-gram, advisory, http-chokepoint, cassette, offline, DONE-02, SSRF, wave-1]

# Dependency graph
requires:
  - phase: 06-done-export-pipeline-zero-trace-gate
    provides: "tests/plagiarism.test.ts RED suite + tests/fixtures/cassettes/duckduckgo/html-search.json + pinned contract symbol names (runPlagiarism / extractDistinctivePhrases / renderPlagiarismSection)"
  - phase: 01-foundation
    provides: "bin/lib/http.ts fetch chokepoint (source 'generic', noCache); bin/lib/http-mock.ts isOfflineMode + loadCassetteFile; bin/lib/budget.ts Semaphore fan-out cap"
  - phase: 04-breadth
    provides: "bin/lib/verify/freshness.ts advisory-never-throws contract (the exact analog copied: offline-mode guard, transport-error swallow, Semaphore(5), render-table shape)"
provides:
  - "bin/lib/plagiarism.ts — extractDistinctivePhrases + runPlagiarism + parseDdgHtml + renderPlagiarismSection (DONE-02)"
  - "PlagiarismResult { phrase; matches: string[] } + PlagiarismMatch { url; title? } result types for the DONE-09 gate (06-05) and Wave-2 done.ts"
affects:
  - "06-05 (DONE-09 export-confirmation gate reads plagiarismResults: Array<{ phrase; matches: string[] }> as one of its three issue sources)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Advisory-never-throws module mirrored verbatim from verify/freshness.ts: offline-mode guard before any network, transport errors swallowed to a PENSMITH_DEBUG-gated stderr noise line, no blocking verdict (returns an array; empty == no signal)"
    - "Single shared pure parser (parseDdgHtml) used by BOTH the offline-cassette and live-network branches so they cannot diverge"
    - "SSRF mitigation by construction: hard-coded DDG host + encodeURIComponent on the sole dynamic query component"
    - "HTML parsed regex/String only (no DOM, no eval, no innerHTML); malformed HTML → empty matches, never a crash"

key-files:
  created:
    - bin/lib/plagiarism.ts
  modified: []

key-decisions:
  - "PlagiarismResult.matches typed as string[] (URLs) to honor the LOCKED Wave-0 RED contract in tests/plagiarism.test.ts + the DONE-09 gate input in tests/export-gate.test.ts — diverges from the plan's draft matches: PlagiarismMatch[]. PlagiarismMatch { url; title? } is still exported (it is parseDdgHtml's return) for downstream richness; runPlagiarism maps .url into the string array."
  - "parseDdgHtml matches the exact result__a class token via word boundaries so sponsored result--ad__a and result__snippet anchors are excluded; dedupes URLs within a page"
  - "Offline cassette lookup prefers an entry whose path contains q=<encoded-phrase>, falling back to the single committed entry — deterministic offline behavior with the one-entry cassette"

requirements-completed: [DONE-02]

# Metrics
duration: 4min
completed: 2026-06-18
---

# Phase 6 Plan 02: Free Distinctive-Phrase Plagiarism Check (DONE-02) Summary

**Landed `bin/lib/plagiarism.ts` — a free, advisory, offline-cassette-backed DuckDuckGo distinctive-phrase plagiarism check: deterministic >=5-word n-gram extraction, a single shared regex parser for both offline and live branches, http.ts-chokepointed live queries (source 'generic', noCache, browser headers, Semaphore(5) cap), and a `## Plagiarism Check (DONE-02)` VERIFICATION.md render — never throws, never blocks export, turning the Wave-0 RED plagiarism suite fully GREEN (6/6).**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-18T08:41:24Z
- **Completed:** 2026-06-18T08:45:18Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- **Task 1 — `extractDistinctivePhrases` (deterministic n-gram extraction):** splits the draft into sentences on terminal punctuation, slides overlapping >=5-word windows, filters via an `isDistinctive` heuristic (rejects all-stop-word windows; requires >=2 words longer than 4 chars), dedupes via a Set preserving first-seen order, and caps at `maxPhrases` (default 10). Strips `[@citekey]`/inline `@key` tokens and markdown punctuation before windowing so citation keys are never searched. Deterministic by construction (no `Math.random`, no `Date`). Exports `PlagiarismMatch` + `PlagiarismResult` result types for downstream consumers.
- **Task 2 — `runPlagiarism` + `parseDdgHtml` + `renderPlagiarismSection`:** `runPlagiarism` extracts phrases, queries DDG per phrase under a `Semaphore(5)` fan-out cap, and returns one `PlagiarismResult` per phrase (including zero-match phrases). The offline branch reads `tests/fixtures/cassettes/duckduckgo/html-search.json` via `loadCassetteFile` and never touches the network; the live branch uses `httpFetch(ddgUrl, { source: 'generic', noCache: true, headers })` with browser-like headers. Both branches feed the SAME `parseDdgHtml` pure parser, so they cannot diverge. `renderPlagiarismSection` emits the `## Plagiarism Check (DONE-02)` advisory table.
- **Advisory contract held exactly** (mirrors `verify/freshness.ts`): `runPlagiarism` never throws — transport/parse errors are swallowed to a `PENSMITH_DEBUG`-gated stderr noise line and yield an empty `matches` array for that phrase. There is no blocking verdict; the result is an array.
- **Plagiarism RED suite is fully GREEN (6/6)** and the full suite stays green (681 tests, 666 pass, 0 fail, 15 skip — the 15 remaining skips are the 06-03/06-04 exporter/honesty/done/humanizer RED-by-skip tests, which remain RED-by-design until those waves land).

## Task Commits

Each task was committed atomically:

1. **Task 1: deterministic distinctive-phrase n-gram extraction** - `25316ad` (feat)
2. **Task 2: DDG plagiarism check via http.ts + offline cassette + render** - `00d009e` (feat)

**Plan metadata:** final docs commit — this SUMMARY + STATE + ROADMAP + REQUIREMENTS.

## Files Created/Modified

- `bin/lib/plagiarism.ts` (created) — `extractDistinctivePhrases`, `runPlagiarism`, `parseDdgHtml` (exported pure parser), `renderPlagiarismSection`, plus the `PlagiarismResult` / `PlagiarismMatch` result types.

## Decisions Made

- **`PlagiarismResult.matches` is `string[]` (URLs), not `PlagiarismMatch[]`.** The LOCKED Wave-0 RED contract (`tests/plagiarism.test.ts` lines 66-67, 96) and the DONE-09 gate input (`tests/export-gate.test.ts` line 37) both type `matches` as `string[]`. Those tests are the GREEN target and could not be edited, so the public shape honors them. The richer `PlagiarismMatch { url; title? }` type is still exported — it is exactly what `parseDdgHtml` returns — and `runPlagiarism` maps `.url` into the string array. See Deviations below.
- **`parseDdgHtml` is the single shared parser** for offline + live, matching the exact `result__a` class token via word boundaries (excludes `result--ad__a` sponsored anchors and `result__snippet` anchors) and deduping URLs within a page. Regex/String only — no DOM, no eval, no innerHTML (T-06-02-02 mitigation).
- **SSRF mitigation by construction (T-06-02-01):** `ddgUrl` hard-codes `https://html.duckduckgo.com/html/` and `encodeURIComponent`-escapes the phrase as the sole dynamic component — no caller-supplied host can be reached.
- **Offline cassette lookup** prefers an entry whose `path` contains `q=<encoded-phrase>`, falling back to the single committed entry, keeping offline behavior deterministic against the one-entry cassette.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Contract reconciliation] `PlagiarismResult.matches` typed as `string[]` instead of `PlagiarismMatch[]`**

- **Found during:** Task 2 (before wiring `runPlagiarism`, reconciling the locked test against the plan's draft type).
- **Issue:** The plan's `<action>` specifies `export interface PlagiarismResult { phrase; matches: PlagiarismMatch[] }`. The LOCKED Wave-0 RED tests — which this plan exists to turn GREEN and which must not be edited — type `matches` as `string[]` (`tests/plagiarism.test.ts` lines 66-67 / line 96, and `tests/export-gate.test.ts` line 37, the DONE-09 gate input). A `PlagiarismMatch[]` public shape would have left the locked RED suite RED.
- **Fix:** Public `PlagiarismResult.matches` is `string[]` (the result URLs), satisfying both locked test suites. The plan's `PlagiarismMatch { url; title? }` type is still exported (it is `parseDdgHtml`'s return type) so Wave-2 `done.ts` retains access to richer hit metadata; `runPlagiarism` maps `.url` into the string array. Same kind of plan-vs-test reconciliation precedent as 01-12.
- **Files modified:** `bin/lib/plagiarism.ts`
- **Commit:** `00d009e`

This is the only deviation. Everything else executed as written.

## Authentication Gates

None. The check is offline-by-default (`isOfflineMode()` true unless `PENSMITH_NETWORK_TESTS=1`); no credentials are involved.

## Known Stubs

None. The offline cassette branch is the test seam (not a stub) — the live `httpFetch` path is real production code routed through the http.ts chokepoint and is exercised when `PENSMITH_NETWORK_TESTS=1`. `parseDdgHtml` is shared by both branches.

## Verification Results

- `node --import tsx --test tests/plagiarism.test.ts` — **6 pass / 0 fail / 0 skip** (cassette-exists, module-presence, extraction <=10/>=5-words, offline >=2 URLs, never-throws, render `## Plagiarism Check`).
- `npm test` (full suite) — **681 tests, 666 pass, 0 fail, 15 skipped.** (Pre-plan baseline was 662 pass / 19 skip; the 4 plagiarism behavioral tests un-skipped and pass. The remaining 15 skips are the 06-03/06-04 exporter / zero-trace B-F / honesty / done-gate / humanizer RED-by-skip tests, RED-by-design until those waves land.)
- `npm run lint` — clean (no direct `fetch`/`undici`; the only network import is `fetch as httpFetch` from `./http.js` — chokepoint honored).
- `npm run typecheck` (`tsc --noEmit`) — clean.

## Threat Surface

No new threat surface beyond the plan's `<threat_model>`. The only network egress is the hard-coded DDG host already covered by T-06-02-01/-02/-03; all four threat-register `mitigate` dispositions are implemented (hard-coded host + encodeURIComponent; regex-only parsing; maxPhrases + Semaphore(5) + generic TokenBucket + browser headers; advisory-by-construction no-blocking-verdict). No new endpoints, auth paths, file access, or schema changes. No package installs (T-06-02-SC satisfied — nothing to slopcheck).

## Next Phase Readiness

- DONE-02 lands GREEN: `runPlagiarism` returns `Array<{ phrase; matches: string[] }>`, the exact shape the DONE-09 export-confirmation gate (06-05) consumes as one of its three issue sources (alongside UNSUPPORTED Pass-2 + orphan Pass-4).
- `renderPlagiarismSection` is ready to append a `## Plagiarism Check (DONE-02)` section to VERIFICATION.md.
- No blockers. The 15 remaining skips are the 06-03 (exporter / zero-trace / honesty) and 06-04 (done-gate / humanizer) GREEN targets for the next waves.

---
*Phase: 06-done-export-pipeline-zero-trace-gate*
*Completed: 2026-06-18*

## Self-Check: PASSED

`bin/lib/plagiarism.ts` and `06-02-SUMMARY.md` verified present on disk. Both task commits (`25316ad`, `00d009e`) verified in git log.
