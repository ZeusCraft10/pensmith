---
phase: 03-vertical-slice-one-section
plan: 04
subsystem: research
tags: [adapters, cassettes, bibtex, citation-js, undici, source-candidate, nock, citekey]

requires:
  - phase: 03-vertical-slice-one-section
    provides: "SourceCandidate zod schema (Plan 03-03 Task 3.1), getS2ApiKey runtime helper (Plan 03-03 Task 3.3), author-normalize firstAuthorSurname (Plan 03-01), citations.Cite re-export and atomicWriteFile chokepoint (Phase 2)"
provides:
  - "7 source adapters (crossref, openalex, arxiv, pubmed, semanticscholar, unpaywall, retraction-watch) in bin/lib/sources/"
  - "Typed adapter registry at bin/lib/sources/index.ts with AdapterName union"
  - "bin/lib/citekey.ts — deterministic citekey generator (D-14) with CITEKEY_RE export"
  - "bin/lib/http-mock.ts — offline-mode cassette loader (loadCassetteFile) + nock-based recorder (loadCassettes/recordCassettes/finalizeRecording) + SENSITIVE_HEADERS deny-list"
  - "bin/lib/bibtex-write.ts — SourceCandidate[] -> .paper/CITATIONS.bib serializer (D-19 + D-07 chokepoints, D-15 retracted-flag persistence, base-26 collision suffixing)"
  - "8 cassette fixtures under tests/fixtures/cassettes/ (all ≤51200 B per D-25)"
  - "tests/cassette-no-leak.test.ts — SENSITIVE_HEADERS deny-list sentinel"
  - "tests/bibtex-write.test.ts (8 cases) + tests/citekey.test.ts (6 cases)"
affects: [plan-06-research, plan-06-verify, plan-09-tier-contract, plan-09-cron-refresh]

tech-stack:
  added: [nock (moved from devDependencies to dependencies for runtime recorder access)]
  patterns:
    - "adapter offline path = loadCassetteFile(); online path = httpFetch via bin/lib/http.ts chokepoint"
    - "retraction-watch is fetchById-only (D-15 LOCKED — no search export, ESLint backstop on bin/lib/sources/retraction-watch.ts)"
    - "citekey-rewrite post-process step works around citation-js auto-labeling so deterministic collision suffixes survive into the .bib"
    - "SENSITIVE_HEADERS deny-list as single source of truth (imported by both recorder and the leak-scan sentinel)"

key-files:
  created:
    - "bin/lib/sources/crossref.ts (153 LOC)"
    - "bin/lib/sources/openalex.ts (139 LOC)"
    - "bin/lib/sources/arxiv.ts (188 LOC) — regex-based Atom XML parser, zero new deps"
    - "bin/lib/sources/pubmed.ts (202 LOC) — two-step esearch -> esummary"
    - "bin/lib/sources/semanticscholar.ts (192 LOC) — conditional x-api-key header, WARN-once keyless fallback"
    - "bin/lib/sources/unpaywall.ts (140 LOC) — search() returns [] by design"
    - "bin/lib/sources/retraction-watch.ts (127 LOC) — fetchById ONLY (D-15)"
    - "bin/lib/sources/index.ts (30 LOC) — typed registry"
    - "bin/lib/citekey.ts (62 LOC)"
    - "bin/lib/http-mock.ts (312 LOC)"
    - "bin/lib/bibtex-write.ts (185 LOC)"
    - "tests/bibtex-write.test.ts (8 cases)"
    - "tests/citekey.test.ts (6 cases)"
    - "tests/cassette-no-leak.test.ts"
    - "8 cassette JSON fixtures (520–3085 bytes each, all ≤51200 B)"
  modified:
    - "package.json — moved nock from devDependencies to dependencies (recorder runs in CI too)"
    - "bin/lib/http.ts — Rule 3 deviation: extended HttpSource union, TTL_MS_BY_SOURCE, RPS_BY_SOURCE to cover 'semanticscholar' and 'retraction-watch' (required to type-check adapters)"

key-decisions:
  - "loadCassetteFile() two-tier API: adapters use it directly in offline mode (bypassing nock+undici architectural mismatch). nock is reserved for the cron-refresh recorder path. Documented in http-mock.ts header."
  - "citekey-rewrite post-process step: citation-js auto-generates BibTeX labels (e.g. Wu2017Foo) regardless of CslEntry.id. We rewrite headers in-place by iterating sorted entries to honor the deterministic citekey contract AND collision-suffix policy."
  - "Extending HttpSource union (and the matching TTL/RPS records) to include 'semanticscholar' and 'retraction-watch' rather than punting to a follow-up plan — adapters couldn't type-check without it. Treated as Rule 3 (blocking issue)."

patterns-established:
  - "Per-source TokenBucket budgets: S2 = 1 RPS (matches anonymous rate-limit floor), retraction-watch = 10 RPS (side-channel, mirrors unpaywall)."
  - "WARN-once degradation on missing API key: emit to stderr, never throw, never log the value."
  - "Cassette path conventions: search cassette = <verb>-attention.json; fetchById direct match by path substring + first-result fallback."

requirements-completed:
  - RSCH-01
  - RSCH-02
  - RSCH-03
  - RSCH-04
  - RSCH-07
  - RSCH-09
  - RSCH-11
  - VRFY-04

duration: 17min
completed: 2026-05-26
---

# Phase 03 Plan 04: Source Adapters Summary

**7 source adapters + cassette loader + bibtex serializer landed: every search/fetchById path round-trips through bin/lib/http.ts, all PR-time CI runs offline against committed cassettes, and the verifier now has a deterministic citekey-sorted .paper/CITATIONS.bib emitter ready for Plan 06.**

## Performance

- **Duration:** ~17 min (Task 4.1 commit 17:57 IST -> Task 4.4 commit 18:14 IST)
- **Started:** 2026-05-26T17:57:48+05:30
- **Completed:** 2026-05-26T18:14:44+05:30
- **Tasks:** 4 / 4 complete
- **Files created:** 24 (11 production .ts + 13 test/fixture/cassette)
- **Files modified:** 2 (package.json, bin/lib/http.ts)

## Accomplishments

- 7 source adapters with offline-first cassette path + online HTTP path through the D-06 chokepoint.
- Cassette-no-leak sentinel + cassette-size sentinel both green; SENSITIVE_HEADERS deny-list shared between recorder and scanner.
- bibtex-write.ts: writeBibtex serializes through citation-js with deterministic citekey-sorted output, base-26 collision suffixing (1..26 -> a..z, 27 -> aa, 53 -> ba, 702 -> zz), and D-15 retracted-flag persistence (`note = {RETRACTED}`).
- D-14 SourceCandidate contract honored by every toCandidate(): all required fields populated (id, title, authors, last_verified, citekey matching `/^[a-z][a-z0-9_-]*$/`, raw), discriminated-union `source` tag set per adapter.
- D-15 LOCKED retraction-watch side-channel discipline: zero `export.*search` matches, ESLint chokepoint + behavioral test both enforce.
- D-16 / T-3-12 semanticscholar API-key handling: WARN-once on stderr, value flows only into header bytes, never logged/persisted, recorder scrubs `x-api-key` via SENSITIVE_HEADERS.

## Task Commits

1. **Task 4.1: http-mock.ts cassette loader + 8 cassette JSON fixtures** — `aa6de79` (feat)
2. **Task 4.2: crossref, openalex, arxiv, pubmed adapters + citekey generator** — `272b694` (feat)
3. **Task 4.3: semanticscholar, unpaywall, retraction-watch adapters + index registry** — `bf271ae` (feat)
4. **Task 4.4: bibtex-write.ts (SourceCandidate[] -> .bib serializer) + 8 tests** — `c4bc940` (feat)

## Files Created/Modified

### Created (production)

- `bin/lib/sources/crossref.ts` — REST adapter, User-Agent polite-pool, authors as "Family, Given"
- `bin/lib/sources/openalex.ts` — REST adapter, `&mailto=` polite-pool (sunsets Feb 2026), DOI normalization
- `bin/lib/sources/arxiv.ts` — Atom XML adapter, regex-based extractor (no new deps), year from ISO published
- `bin/lib/sources/pubmed.ts` — two-step esearch -> esummary, pubdate year extraction
- `bin/lib/sources/semanticscholar.ts` — Graph v1, conditional x-api-key header, WARN-once keyless fallback
- `bin/lib/sources/unpaywall.ts` — DOI lookup only, search() returns [] (protocol-shaped inert)
- `bin/lib/sources/retraction-watch.ts` — fetchById ONLY (D-15), retracted=true on every return
- `bin/lib/sources/index.ts` — typed registry { crossref, openalex, arxiv, pubmed, semanticscholar, unpaywall, 'retraction-watch' } + AdapterName
- `bin/lib/citekey.ts` — deterministic citekey generator (D-14), exports CITEKEY_RE
- `bin/lib/http-mock.ts` — isOfflineMode + loadCassetteFile + nock recorder (loadCassettes/recordCassettes/finalizeRecording) + SENSITIVE_HEADERS deny-list
- `bin/lib/bibtex-write.ts` — writeBibtex + suffixForCollision

### Created (tests / fixtures)

- `tests/bibtex-write.test.ts` — 8 cases (round-trip, no-id drop, empty array, sorted, retracted note, suffix boundary, suffix overflow, 3-collision)
- `tests/citekey.test.ts` — 6 cases (simple, particle, diacritic+hyphen, anon, noyear, 100x idempotency)
- `tests/cassette-no-leak.test.ts` — recursive SENSITIVE_HEADERS scan
- `tests/fixtures/cassettes/crossref/works-attention.json` (2091 B)
- `tests/fixtures/cassettes/openalex/works-attention.json` (1997 B)
- `tests/fixtures/cassettes/arxiv/query-attention.json` (2125 B)
- `tests/fixtures/cassettes/pubmed/esearch-attention.json` (520 B)
- `tests/fixtures/cassettes/pubmed/esummary-attention.json` (2426 B)
- `tests/fixtures/cassettes/semanticscholar/search-attention.json` (3085 B)
- `tests/fixtures/cassettes/unpaywall/doi-vaswani2017.json` (739 B)
- `tests/fixtures/cassettes/retraction-watch/fetchById-fake.json` (552 B)

### Modified

- `package.json` — nock moved from `devDependencies` to `dependencies` (recorder runs at CI time too)
- `bin/lib/http.ts` — `HttpSource` union extended with `'semanticscholar'` and `'retraction-watch'`; matching `TTL_MS_BY_SOURCE` (S2: 7d, RW: 1d) and `RPS_BY_SOURCE` (S2: 1 RPS, RW: 10 RPS) entries added.

### Cassette Sizes

| Cassette | Size (B) |
|----------|----------|
| pubmed/esearch-attention.json | 520 |
| retraction-watch/fetchById-fake.json | 552 |
| unpaywall/doi-vaswani2017.json | 739 |
| openalex/works-attention.json | 1997 |
| crossref/works-attention.json | 2091 |
| arxiv/query-attention.json | 2125 |
| pubmed/esummary-attention.json | 2426 |
| semanticscholar/search-attention.json | 3085 |

All cassettes ≤51200 B (D-25 budget). Total cassette bytes on disk: 13,535 B.

## Decisions Made

1. **nock-vs-undici architectural workaround (Task 4.1):** nock@14 only intercepts node:http/https; pensmith http.ts uses undici exclusively. Resolved by adding `loadCassetteFile(adapter, basename)` direct-read API and routing adapters to it in offline mode. nock+recorder code is retained for the Plan 09 cron-refresh path where it does work (recorder uses node:http for outbound).
2. **Citekey-rewrite post-process step (Task 4.4):** citation-js auto-generates labels (e.g. `Wu2017Foo`) regardless of CslEntry.id. To honor D-14 + collision policy, rewrite `@<type>{<autokey>,` headers in-place by iterating sorted entries. Output preserves citation-js's spelling for everything else (fields, escaping, retracted-note round-trip).
3. **Extending HttpSource union (Rule 3 deviation, Task 4.3):** semanticscholar and retraction-watch adapters cannot type-check without their `source: HttpSource` literal being part of the union. Treated as blocking. TTL/RPS values picked conservatively (S2: 1 RPS matches anonymous-rate-limit floor; RW: 10 RPS mirrors unpaywall side-channel budget).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] nock@14 cannot intercept undici outbound calls**

- **Found during:** Task 4.1 (http-mock.ts wiring)
- **Issue:** Plan specified `loadCassettes(adapter)` reading cassettes and calling `nock().get().reply()` to intercept HTTP. But pensmith http.ts uses undici (`fetch as httpFetch` from undici) which is NOT routed through node:http — nock cannot see those requests. Adapters in offline mode would have made real network calls.
- **Fix:** Designed a two-tier API: adapters use `loadCassetteFile(adapter, basename)` directly in `isOfflineMode()` branch, bypassing nock + undici entirely. nock-based path retained for the Plan 09 cron-refresh recorder which runs against node:http-driven requests (record-mode only).
- **Files modified:** `bin/lib/http-mock.ts` (added loadCassetteFile + isOfflineMode exports)
- **Verification:** All 16 adapter tests green; cassette-size + cassette-no-leak sentinels green.
- **Committed in:** `aa6de79`

**2. [Rule 3 - Blocking] HttpSource union missing 'semanticscholar' and 'retraction-watch'**

- **Found during:** Task 4.3 (first typecheck of semanticscholar.ts + retraction-watch.ts)
- **Issue:** `httpFetch(url, { source: 'semanticscholar' })` failed with `TS2322: Type '"semanticscholar"' is not assignable to type 'HttpSource | undefined'`. Same for 'retraction-watch'. Without the type extension, neither adapter could compile.
- **Fix:** Extended `HttpSource` union in `bin/lib/http.ts` to include both literals, plus matching entries in `TTL_MS_BY_SOURCE` (S2: 7d cache, RW: 1d) and `RPS_BY_SOURCE` (S2: 1 RPS to match S2's anonymous-rate-limit floor; RW: 10 RPS to mirror unpaywall side-channel budget).
- **Files modified:** `bin/lib/http.ts` (touched outside files_modified scope — Rule 3 unblock)
- **Verification:** typecheck green; all 7 adapter tests green; lint green.
- **Committed in:** `bf271ae`

**3. [Rule 3 - Blocking] citation-js auto-generates BibTeX labels regardless of CslEntry.id**

- **Found during:** Task 4.4 (3-collision wu2017 test failure: actual `Wu2017Foo, Wu2017Foo, Wu2017Foo` vs expected `wu2017, wu2017a, wu2017b`)
- **Issue:** citation-js >=0.7 ignores CslEntry.id when rendering BibTeX text format — it autoderives a label from `<FirstAuthor><Year><FirstTitleWord>`. This breaks the D-14 deterministic citekey contract AND the CYCLE-2 collision policy.
- **Fix:** Added a post-process step that iterates sorted entries and rewrites each `@<type>{<autokey>,` header in-place. Input order is preserved by citation-js so this is safe. Output still goes through citation-js for everything else (field escaping, the retracted-note round-trip, etc.).
- **Files modified:** `bin/lib/bibtex-write.ts` writeBibtex()
- **Verification:** All 8 bibtex-write tests green including the 3-collision case and the retracted-flag round-trip.
- **Committed in:** `c4bc940`

## Verification Gates

| Gate | Exit Code | Notes |
|------|-----------|-------|
| `npm run lint` | 0 | ESLint chokepoints (D-06, D-07, D-19) all hold |
| `npx tsc --noEmit` | 0 | Strict mode + exactOptionalPropertyTypes |
| `npm run build` | 0 | dist/ rebuilt cleanly |
| `npm test` | nonzero (expected) | 473 pass / 11 unique fail — all 11 are documented-breakage tests for future plans (bin/cli/plan.ts, bin/cli/verify.ts, bin/lib/drafter-input.ts, bin/lib/handoff.ts, templates/citation-styles/apa.csl) |

### Failing-test delta vs baseline

- **Baseline (pre-plan):** 25 failing tests
- **After Plan 04:** 11 failing tests (unique)
- **Delta:** −14 (matches plan target "≤11 failing")

### Grep gates (D-06 / D-07 / D-15 / D-16 / D-19 chokepoints)

| Gate | Expected | Actual |
|------|----------|--------|
| `grep -rn "from 'undici'\|from 'node:http'" bin/lib/sources/` | empty | empty ✓ |
| `grep -rn "PENSMITH_S2_API_KEY" bin/lib/sources/` | only semanticscholar.ts | only semanticscholar.ts (5 hits, all in that file) ✓ |
| `grep -E "^export.*\bsearch\b" bin/lib/sources/retraction-watch.ts` | 0 matches | 0 matches ✓ |
| `grep -c "from 'citation-js'" bin/lib/bibtex-write.ts` | 0 | 0 ✓ |
| `grep -c "writeFile\|writeFileSync\|appendFile" bin/lib/bibtex-write.ts` | 0 | 0 ✓ |
| `grep -c "from './citations" bin/lib/bibtex-write.ts` | ≥1 | 2 ✓ |
| `grep -c "from './atomic-write" bin/lib/bibtex-write.ts` | ≥1 | 2 ✓ |
| `grep -rn "from '../bibtex-write" bin/lib/sources/` | empty | empty ✓ |
| Every cassette ≤51200 B | yes | yes (max 3085 B) ✓ |
| `nock` in `dependencies` (not devDependencies) | yes | yes ✓ |

## Self-Check: PASSED

- `bin/lib/sources/crossref.ts` FOUND
- `bin/lib/sources/openalex.ts` FOUND
- `bin/lib/sources/arxiv.ts` FOUND
- `bin/lib/sources/pubmed.ts` FOUND
- `bin/lib/sources/semanticscholar.ts` FOUND
- `bin/lib/sources/unpaywall.ts` FOUND
- `bin/lib/sources/retraction-watch.ts` FOUND
- `bin/lib/sources/index.ts` FOUND
- `bin/lib/citekey.ts` FOUND
- `bin/lib/http-mock.ts` FOUND
- `bin/lib/bibtex-write.ts` FOUND
- `tests/bibtex-write.test.ts` FOUND
- `tests/citekey.test.ts` FOUND
- `tests/cassette-no-leak.test.ts` FOUND
- All 8 cassette JSON fixtures FOUND
- Commit `aa6de79` FOUND (Task 4.1)
- Commit `272b694` FOUND (Task 4.2)
- Commit `bf271ae` FOUND (Task 4.3)
- Commit `c4bc940` FOUND (Task 4.4)
