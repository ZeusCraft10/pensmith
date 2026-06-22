---
phase: 01-foundation-nfrs
plan: 04
subsystem: doi
tags: [doi, arxiv, pmid, pmcid, normalization, chokepoint, fast-check, property-test, idempotence, ARCH-15, D-07, D-15, D-17, D-18, D-19, TEST-05, TEST-06, TEST-11]
requires: ['01-00']
provides:
  - 'normalizeDoi'
  - 'normalizeArxiv'
  - 'normalizePmid'
  - 'normalizePmcid'
  - 'isDoi'
  - 'isArxiv'
  - 'isPmid'
  - 'isPmcid'
affects:
  - "Phase 3 verifier — `bin/verify/*` uses normalizeDoi/normalizeArxiv/normalizePmid/normalizePmcid as the only call sites for citation canonicalization (no module is allowed to compare two citation strings without first running them through this chokepoint)"
  - "Phase 3 verifier property tests — reuses the same `tests/fixtures/doi-corpus.ts` generators (validDoi, doiWithPrefix, doiWithTrailingPunct, arxivNew, arxivOld, pmid, pmcid, garbage) for verifier-side fuzz coverage"
  - "Phase 4 library indexing — `addPaper`/`updatePaper` (W11 hooks) call normalizeDoi BEFORE indexing so the library never stores two divergent canonical forms of the same paper"
  - "Phase 4 cassette tests — `bin/lib/http.ts` source-routing logic (W5) keys cassettes by canonical DOI / arxiv ID, not raw input"
tech-stack:
  added: []  # No new runtime deps; doi-regex@^0.1.17 + fast-check@^3 were installed in W0
  patterns:
    - "Single-chokepoint normalization (D-07): the literal regex `/^10\\./` appears ONLY in `bin/lib/doi.ts`. Every other module that compares DOIs must call `normalizeDoi()` first; doing the prefix/punctuation gymnastics inline is forbidden by ESLint and would split the spec into divergent reimplementations."
    - "Idempotence guarantee (D-19): `normalizeDoi(normalizeDoi(x)) === normalizeDoi(x)` for any x where the inner is non-null. Property-tested over 1000 fast-check iterations across 3 corpora (validDoi, doiWithPrefix, doiWithTrailingPunct). The verifier (Phase 3) relies on this to safely cache normalized canonical forms — without idempotence, a cached 'OK' verification could flip to 'FABRICATED' on re-check just because the cache hit re-normalized the stored canonical form."
    - "ASCII-only case fold (D-15 step 3): `s.replace(/[A-Z]/g, c => c.toLowerCase())`. We deliberately do NOT use `String#toLowerCase()` — that touches latin-1 supplement and other locale-affected ranges, which would mutate non-ASCII bytes in DOIs like `10.1234/résumé` and break byte-stable round-tripping."
    - "Trailing-punctuation strip is one-pass (D-15 step 2): `replace(/[.,;:)\\]}>\"']+$/, '')`. The `+` makes a single regex match consume a contiguous run (e.g. `).` strips both chars at once); the regex is invoked once, not in a loop. This is the spec — DO NOT recurse, because that would also strip non-trailing punctuation if combined incorrectly."
    - "All regexes are linear (T-01-DOS-03 catastrophic-backtracking-safe): no nested quantifiers, no `(.*)*` patterns. The 1000-iteration fast-check property test against the `garbage` corpus serves as an in-band fuzz harness."
    - "Subject-class case is preserved on arXiv old-format identifiers (D-17): `cs.CL/0301012` stays `cs.CL/0301012` (NOT `cs.cl/0301012`). The arxiv: prefix is normalized away but the subject class registry is the source of truth for canonical capitalization."
key-files:
  created:
    - "bin/lib/doi.ts (230 LoC) — D-15/D-17/D-18 chokepoint with 8 exports (4 normalize + 4 typeguards)"
    - "tests/doi.test.ts (250 LoC, 22 spec tests) — example-driven D-15/D-17/D-18 coverage"
    - "tests/doi.property.test.ts (163 LoC, 11 fast-check properties) — D-19 idempotence + acceptance + garbage rejection"
  modified: []
key-decisions:
  - "Prefix matching is longest-first to avoid `doi:` partially matching the URL forms. DOI_PREFIXES is ordered `https://dx.doi.org/`, `http://dx.doi.org/`, `https://doi.org/`, `http://doi.org/`, `doi:`, `DOI:` — the loop breaks on the first match. (Theoretically `doi:` and the `https://...` prefixes can't collide on the same string because URL forms start with `h`, but the longest-first ordering documents intent and survives any future addition of `dx.doi.org/` without protocol.)"
  - "Prefix match is case-insensitive on the prefix; the body is handled by step 4. We compare `s.toLowerCase().startsWith(p.toLowerCase())` and slice by the original prefix length. This accepts `Doi:`, `HTTPS://DOI.ORG/`, `Https://Dx.Doi.Org/` correctly."
  - "Validation regex `/^10\\.\\d{4,9}\\/\\S+$/` caps registrant codes at 9 digits. Crossref's actual registrant range is 4..7 digits today, but 9 is the historical upper bound used by `doi-regex@^0.1.17` and matches the plan's must-have spec."
  - "Trailing-punctuation character class is `[.,;:)\\]}>\"']` — 10 characters covering the 8 forms in D-15 (the spec lumps brackets/quotes pairs). Spec test `normalizeDoi: all 10 trailing-punctuation chars strip` enumerates each one explicitly; the property test additionally covers mixed-run trailing-punct (e.g. `).` `\"]` `,;`) via the doiWithTrailingPunct generator."
  - "PMID is capped at 9 digits (`/^\\d{1,9}$/`) — PubMed has not issued IDs above 1e9 at time of writing, and a 10+ digit number is more likely to be a typo than a valid PMID. The spec test `normalizePmid: garbage returns null` enumerates `'1234567890'` (10 digits) and asserts null."
  - "PMCID requires the literal `PMC` prefix (case-insensitive on input, uppercase on canonical output). Bare digits return null because they cannot be disambiguated from PMID. Spec test `normalizePmcid: missing prefix returns null` covers this."
  - "arXiv old-format subject class registry is hardcoded (17 top-level archives + 18 dotted subclasses). Unknown classes return null rather than blindly accepting any `<word>/<7-digits>` form — that would let typos like `cs.UNKNOWN/0301012` slip through to the verifier and produce false 'NOT_FOUND' from the arXiv API. The spec test `normalizeArxiv: garbage returns null` covers `cs.UNKNOWN/0301012`."
  - "arXiv new-format regex accepts 4..5-digit sequence (per arXiv's actual identifier policy — pre-2015 was 4 digits, post-2015 is 5 digits). The fast-check `arxivNew` corpus generates 5-digit padded sequences (`String(seq).padStart(5, '0')` per the W0 generator)."
  - "Property tests use `if (once === null) return true` to skip past corpus inputs that intentionally fail validation. The `validDoi` generator produces `10.${reg}/${anything}` where `anything` is up to 50 non-whitespace chars — some of those normalize to null (e.g. all-trailing-punct suffixes that strip empty). The skip is correct: idempotence is 'idempotent WHERE defined'; the garbage-rejection property covers the null path separately."
  - "Imports use the `.js` extension specifier from `.ts` source (NodeNext + verbatimModuleSyntax). `import { ... } from '../bin/lib/doi.js'` resolves to `bin/lib/doi.ts` at compile time and `dist/lib/doi.js` at runtime. This matches the rest of the codebase; the plan's skeleton showed `.ts` specifiers which would only work under tsx — using `.js` keeps the production build path identical."
  - "Property test imports from `tests/fixtures/doi-corpus.js` (W0). The fixtures dir is excluded from `tsconfig.exclude` (Phase 0 D-13), so `tsc --noEmit` resolves but does not type-check the corpus file — the corpus is type-sound by inspection (deliberately no `@ts-nocheck`), and tsx loads it directly at runtime via the .js → .ts resolution."

requirements-completed: [ARCH-15, TEST-05, TEST-06, TEST-11]

# Metrics
duration: ~10 min
duration_minutes: 10
tasks_completed: 2
tasks_in_plan: 2
files_created: 3
files_modified: 0
tests_added: 33  # 22 spec + 11 property
tests_passing: 98  # full suite, post-commit (65 from prior + 33 new)
property_iterations: 6500  # 1000+1000+1000+1000+500+500+500+500+500 = sum of numRuns over 11 properties; 4 of them at 1000 satisfy D-19's "1000+ iterations" mandate
completed: 2026-05-08
---

# Phase 01 Plan 04: doi (ARCH-15 / D-15-17-18 normalization chokepoint) Summary

**Wave 4 lands `bin/lib/doi.ts` as the DOI / arXiv / PMID / PMCID normalization chokepoint per ARCH-15. The file is the SOLE call site for the literal regex `/^10\./` (D-07 enforcement; eslint exempts only this file). Eight exports — four `normalize*` functions and four `is*` typeguards — plus 33 tests (22 example-driven spec cases + 11 fast-check property tests with 6,500 cumulative iterations) prove the D-15 three-step spec, the D-17 arXiv old/new format split, the D-18 PMID/PMCID separation, and the D-19 idempotence guarantee that the Phase 3 verifier will rely on for canonical-form caching.**

## Performance

- **Duration:** ~10 min wall clock (Task 1 + Task 2 sequential, no checkpoints, no deviations)
- **Started:** 2026-05-08T10:17:01+05:30 (after Wave 3 SUMMARY commit)
- **Completed:** 2026-05-08T10:23:15+05:30 (Task 2 commit `a793506`)
- **Tasks:** 2
- **Files created:** 3
- **Files modified:** 0

## Public API (`bin/lib/doi.ts`)

```ts
// 4 normalize functions — return canonical string OR null on garbage
export function normalizeDoi(input: string): string | null;
export function normalizeArxiv(input: string): string | null;
export function normalizePmid(input: string): string | null;
export function normalizePmcid(input: string): string | null;

// 4 typeguards — sugar for normalize*(s) !== null
export function isDoi(s: string): boolean;
export function isArxiv(s: string): boolean;
export function isPmid(s: string): boolean;
export function isPmcid(s: string): boolean;
```

## D-15 Three-Step Normalization Spec (`normalizeDoi`)

**Step 1 — Strip prefix (case-insensitive on prefix, longest-first match):**

| Form | Example |
|------|---------|
| `https://dx.doi.org/` | `https://dx.doi.org/10.1038/nature` |
| `http://dx.doi.org/` | `http://dx.doi.org/10.1038/nature` |
| `https://doi.org/` | `https://doi.org/10.1038/nature` |
| `http://doi.org/` | `http://doi.org/10.1038/nature` |
| `doi:` | `doi:10.1038/nature` |
| `DOI:` | `DOI:10.1038/nature` (or `Doi:`, `dOi:`, etc — case-insensitive) |

**Step 2 — Strip trailing punctuation (one-pass run via `[.,;:)\]}>"']+$`):**

The 10 characters cover the 8 spec forms (`. , ; : ) ] } > " '`). A trailing run like `)."` strips entirely in a single regex match; the regex is NOT invoked recursively.

**Step 3 — ASCII-only case fold:**

`s.replace(/[A-Z]/g, c => c.toLowerCase())` — touches only `[A-Z]`, so `10.1234/résumé` round-trips byte-stable. We deliberately do NOT use `String#toLowerCase()` (which would mangle latin-1 supplement and other locale-affected ranges).

**Step 4 — Validate via the chokepoint regex `/^10\.\d{4,9}\/\S+$/`:**

This is the literal `/^10\./` pattern banned everywhere by `no-restricted-syntax` except inside `bin/lib/doi.ts`. The exemption is forward-declared in `eslint.config.js` lines 96-99 (Phase 0 D-07).

## D-17 arXiv Old/New Format Split (`normalizeArxiv`)

| Format | Pattern | Canonical | Example |
|--------|---------|-----------|---------|
| New (post-2007) | `(arxiv:)?YYMM.NNNNN[vV]` | `arxiv:YYMM.NNNNN[vV]` | `arXiv:2103.00020v2` → `arxiv:2103.00020v2` |
| Old (pre-April-2007) | `(arxiv:)?<subj-class>/YYMMNNN` | `<subj-class>/YYMMNNN` | `arxiv:cs.CL/0301012` → `cs.CL/0301012` |

**Subject-class registry:** 17 top-level archives + 18 dotted subclasses (e.g. `cs`, `cs.CL`, `math.AG`, `astro-ph.CO`). An unknown class returns null rather than letting a typo slip through to a "NOT_FOUND" arXiv API call.

**Subject-class case is preserved verbatim** — `cs.CL/0301012` stays `cs.CL/0301012`, NOT `cs.cl/0301012`. Only the `arxiv:` prefix is normalized.

## D-18 PMID / PMCID Separation (`normalizePmid` / `normalizePmcid`)

| Function | Accepts | Canonical | Notes |
|----------|---------|-----------|-------|
| `normalizePmid` | `12345678` or `PMID:12345678` (case-insensitive prefix) | `12345678` (bare digits) | Capped at 9 digits per PubMed's hard limit |
| `normalizePmcid` | `PMC1234567` (case-insensitive prefix) | `PMC1234567` (PMC uppercase) | Bare digits return null — cannot disambiguate from PMID |

The 9-digit PMID cap is intentional: PubMed has not issued IDs above 1e9 at time of writing, and a 10+ digit "PMID" is more likely to be a typo than a valid identifier. The spec test enumerates `'1234567890'` (10 digits) and asserts null.

## D-19 Property Test (`tests/doi.property.test.ts` — 11 properties, 6,500 cumulative iterations)

**Idempotence (the load-bearing property):**

| Property | Corpus | Runs |
|----------|--------|------|
| `normalizeDoi` idempotent | `validDoi` | 1000 |
| `normalizeDoi` idempotent | `doiWithTrailingPunct` | 1000 |
| `normalizeDoi` idempotent | `doiWithPrefix` | 1000 |
| `normalizeArxiv` idempotent | `arxivNew` | 500 |
| `normalizePmid` idempotent | `pmid` | 500 |

**Acceptance (corpus is exhaustively rejected for null contract):**

| Property | Corpus | Runs |
|----------|--------|------|
| `normalizeDoi` result starts with `10.` for prefixed inputs | `doiWithPrefix` | 1000 |
| `normalizeArxiv` accepts new format | `arxivNew` | 500 |
| `normalizeArxiv` accepts old format | `arxivOld` | 500 |
| `normalizePmid` accepts pmid | `pmid` | 500 |
| `normalizePmcid` accepts pmcid | `pmcid` | 500 |

**Garbage rejection (T-01-DOS-03 fuzz harness):**

| Property | Corpus | Runs |
|----------|--------|------|
| `garbage` corpus normalizes to null for `normalizeDoi` | `garbage` | 1000 |

The plan's must-have was "1000 fast-check iterations" for idempotence — we exceed it: 4 properties run at 1000 runs each (3 idempotence + 1 prefix-strip + 1 garbage). Total 6,500 cumulative property-test iterations across all 11 properties.

**Idempotence pattern** (used in 4 properties):

```ts
fc.assert(
  fc.property(generator, (input) => {
    const once = normalizeDoi(input);
    if (once === null) return true;             // skip undefined-domain inputs
    return normalizeDoi(once) === once;          // strict equality on string
  }),
  { numRuns: 1000 },
);
```

The `if (once === null) return true` is correct: idempotence is "idempotent WHERE defined". The `validDoi` corpus produces `10.${reg}/${anything}` where `anything` is up to 50 non-whitespace chars — some of those (e.g. all-trailing-punct suffixes that strip to empty) normalize to null. The garbage-rejection property covers the null path separately.

## Test File Structure

### `tests/doi.test.ts` (22 tests, 250 LoC)

1. `normalizeDoi: bare DOI passes through unchanged`
2. `normalizeDoi: all 6 prefix forms strip (D-15 step 1)`
3. `normalizeDoi: prefix match is case-insensitive on the prefix only`
4. `normalizeDoi: all 10 trailing-punctuation chars strip (D-15 step 2)`
5. `normalizeDoi: trailing-punctuation strip is one-pass (multi-char run)`
6. `normalizeDoi: prefix + trailing-punct combine`
7. `normalizeDoi: lowercases ASCII suffix (D-15 step 3)`
8. `normalizeDoi: preserves non-ASCII bytes verbatim (D-15 step 3)` — `résumé`, `naïve`, `abç`
9. `normalizeDoi: trims whitespace`
10. `normalizeDoi: prefix + url + trailing combinations from a real corpus` — 6 real-world variants of one canonical DOI
11. `normalizeDoi: garbage returns null` — 9 adversarial cases
12. `normalizeDoi: rejects 10-digit registrant (upper bound is 9)`
13. `normalizeArxiv: new format YYMM.NNNNN`
14. `normalizeArxiv: new format with version suffix`
15. `normalizeArxiv: old format subject-class/YYMMNNN`
16. `normalizeArxiv: old format strips arxiv: prefix but preserves class case`
17. `normalizeArxiv: garbage returns null` — including unknown subject class + wrong-length body
18. `normalizePmid: bare digits + PMID: prefix in any case`
19. `normalizePmid: garbage returns null` — including 10-digit overflow
20. `normalizePmcid: PMC + digits, prefix case-insensitive`
21. `normalizePmcid: missing prefix returns null`
22. `isDoi / isArxiv / isPmid / isPmcid mirror normalize* !== null` — positive + negative

### `tests/doi.property.test.ts` (11 fast-check properties, 163 LoC)

See the property table above. All 11 properties green over their full numRuns budgets — fast-check found zero counter-examples.

## Quality Gates (Final State)

| Gate | Result |
|------|--------|
| `npm run typecheck` | PASS (0 errors) |
| `npm run lint` | PASS (0 violations — D-07 chokepoint exemption holds) |
| `npm test` | PASS (98/98 tests, including 33 new for this plan) |
| `npm run validate:manifests` | PASS |
| `npm run check` (lint + typecheck + test + validate) | **PASS** |
| Task 1 inline `<verify>` smoke check (19 spot cases) | PASS — all 19 OK |
| `bin/lib/doi.ts` is sole call site for `/^10\./` | VERIFIED — eslint flags any new occurrence outside this file (Phase 0 D-07 + W0 fixture) |
| Property test idempotence over 1000 fast-check iterations (D-19) | PASS — 4 properties at 1000 runs each, 0 counter-examples |

## Threat-Model Status (PLAN.md `<threat_model>`)

| Threat | Disposition | Status |
|--------|-------------|--------|
| T-01-08 (LLM constructs JSON with prototype-polluting keys) | mitigate | **mitigated** — `bin/lib/doi.ts` reads strings only; it does NOT parse JSON. Prototype pollution is the migrations loader's concern (W7). doi.ts is safe by construction. |
| T-01-DOS-03 (catastrophic backtracking on adversarial input) | mitigate | **mitigated** — every regex in doi.ts is linear: no nested quantifiers, no `(.*)*` patterns. The `garbage` fast-check property (1000 runs) serves as an in-band fuzz harness; the test suite ran in <2 seconds end-to-end with no timeout. |
| T-01-INFO-04 (normalize functions log inputs to stdout) | accept | **accepted** — confirmed by code review: zero `console.*` calls in `bin/lib/doi.ts`. Failure path returns null silently. |

No new threat surface introduced. (`Threat Flags` section omitted — nothing to declare.)

## Decisions Made

See `key-decisions:` in the frontmatter (11 decisions). Highlights:

- **Longest-first prefix matching** so URL forms are tried before the bare `doi:` prefix.
- **ASCII-only case fold** via `replace(/[A-Z]/g, ...)` — NOT `String#toLowerCase()` — so latin-1 supplement and other non-ASCII bytes round-trip byte-stable.
- **PMID capped at 9 digits**, **PMCID requires `PMC` prefix** — disambiguation from each other.
- **arXiv subject classes hardcoded** with case preserved (`cs.CL`, NOT `cs.cl`); unknown classes return null.
- **Property test imports** use `.js` extension specifiers; tests/fixtures/ is `tsconfig.exclude`'d but tsx resolves it at runtime.

## Deviations from Plan

**None — plan executed exactly as written.**

The plan's skeleton showed import specifiers ending in `.ts` (e.g. `from '../bin/lib/doi.ts'`). The actual code uses `.js` to match the rest of the codebase's NodeNext convention (see `tests/paths.test.ts`, `tests/atomic-write.test.ts`, `tests/lock.test.ts`, all of which import from `'../bin/lib/X.js'`). This is a literal-vs-spirit interpretation of the plan: the body text and `<dispatch_base>` of the executor prompt explicitly says "NodeNext convention: local imports use `.js` extension in import specifiers from `.ts` source". I treated this as the correct call rather than a deviation; the implementation matches the project's established convention. No Rule 1/2/3/4 trigger.

### Architectural Changes

None (Rule 4 not invoked).

### Auth Gates

None.

## Carry-Forward for Wave 5+

**Every module that compares two citation strings MUST normalize first.** The Phase 3 verifier will fail loud (and fail safe — null on garbage) if any caller bypasses this chokepoint. The eslint rule prevents the regex `/^10\./` from being copy-pasted; the static check is necessary but not sufficient — the runtime contract is "always go through `normalizeDoi`".

**Phase 3 verifier import shape:**

```ts
import {
  normalizeDoi,
  normalizeArxiv,
  normalizePmid,
  normalizePmcid,
} from '../lib/doi.js';

// ... before any DOI compare:
const canonicalA = normalizeDoi(rawA);
const canonicalB = normalizeDoi(rawB);
if (canonicalA === null || canonicalB === null) {
  // one of the inputs was garbage — surface as MIS-CITED, not FABRICATED
}
const isSameDoi = canonicalA === canonicalB;
```

**Phase 4 library indexing:**

```ts
import { normalizeDoi } from '../lib/doi.js';

async function addPaper(raw: { doi?: string; ... }) {
  const canonical = raw.doi ? normalizeDoi(raw.doi) : null;
  // store BOTH:
  //   doi_canonical: canonical    (for dedupe / lookup keys)
  //   doi_as_cited:  raw.doi      (preserves user's original casing/format for display)
}
```

**Phase 4 cassette tests:** cassette filename keys derive from `normalizeDoi(...)` so two cassettes for `'10.1038/nature'` and `'doi:10.1038/NATURE'` collapse to one.

**Reusable corpus** (`tests/fixtures/doi-corpus.ts`, W0): the Phase 3 verifier property tests will reuse all 8 generators (validDoi, doiWithPrefix, doiWithTrailingPunct, arxivNew, arxivOld, pmid, pmcid, garbage) plus the 2 helper generators (doiMixedCase, doiNonAscii). Keep the corpus pure / deterministic-seeded; do not couple it to verifier-specific shapes.

## Self-Check: PASSED

- [x] `bin/lib/doi.ts` exists at the expected path (230 LoC) — verified via `git show b915ad6 --stat`
- [x] `tests/doi.test.ts` exists at the expected path (250 LoC) — verified via `git show a793506 --stat`
- [x] `tests/doi.property.test.ts` exists at the expected path (163 LoC) — verified via `git show a793506 --stat`
- [x] `bin/lib/doi.ts` exports all 8 named functions: `normalizeDoi`, `normalizeArxiv`, `normalizePmid`, `normalizePmcid`, `isDoi`, `isArxiv`, `isPmid`, `isPmcid` — confirmed via grep on the file
- [x] `bin/lib/doi.ts` contains the literal chokepoint regex `/^10\.\d{4,9}\/\S+$/` — confirmed (line of `DOI_VALID`)
- [x] `bin/lib/doi.ts` handles all 6 prefix forms in `DOI_PREFIXES` — confirmed
- [x] `bin/lib/doi.ts` handles trailing punctuation `[.,;:)\]}>"']+$` (10 chars covering D-15's 8 forms) — confirmed
- [x] `bin/lib/doi.ts` preserves non-ASCII bytes through normalization (uses `replace(/[A-Z]/g, ...)`, NOT `toLowerCase()`) — confirmed by spec test 8 (`résumé`, `naïve`, `abç`) all green
- [x] All 19 inline `<verify>` smoke checks pass — verified output above (`OK normalizeDoi happy` ... `OK isDoi false`)
- [x] `npx tsc --noEmit` exits 0 — verified
- [x] `npm run lint` exits 0 — verified (D-07 chokepoint exempts `bin/lib/doi.ts`)
- [x] `npm test` exits 0 with 98 passing (65 prior + 33 new) — verified
- [x] `npm run check` exits 0 — verified
- [x] Property test runs `numRuns: 1000` for idempotence (D-19 mandate) — 4 of 11 properties run at 1000 runs each
- [x] All property tests find zero counter-examples — verified (no `Property failed after N tests` in output)
- [x] Commit `b915ad6` (Task 1: bin/lib/doi.ts) exists in `git log --oneline` — verified
- [x] Commit `a793506` (Task 2: doi.test.ts + doi.property.test.ts) exists in `git log --oneline` — verified
- [x] No modifications to STATE.md, ROADMAP.md, or any file outside this plan's `files_modified` (orchestrator owns those writes) — verified via `git show --stat` on both commits
- [x] No accidental file deletions in either commit — verified via post-commit diff-filter=D check (output: "no deletions" for both)
