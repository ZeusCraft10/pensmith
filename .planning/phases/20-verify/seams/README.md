# Phase 20 seam S-C

`20-seam-S-C.patch` holds the contract every Phase 20 stream consumes before any of them merges (D-20-01): the verifier's one verdict vocabulary and section-status rule, the existing readers routed through it, and the cross-stream fields of Pass 1 and Pass 3. It was built and verified on a scratch worktree of the base commit `c8f28e3e9f48945361a5e6290cf3020026e96a61`:

- `git apply --check` passes on the base commit;
- with it applied, `npm run prebuild`, `npm run lint`, `npm run typecheck`, `npm run build` and `npm run validate:manifests` pass and the build leaves the tree clean; `npm test` passes 2423 of 2424 tests — the one failure is the documented root-only `tests/atomic-write.test.ts` "preserves OLD content on rename/write failure" case (CLAUDE.md gotcha; it passes in CI); `npm run test:tier-contract` passes 57/57.

Patch sha256: `0afbe502104b6a698f6279dabfe0e70e4df05cc5df06f364c45193e929848cc2`.

## How every stream applies it

As the stream's first commit, before any other change:

```bash
sha256sum .planning/phases/20-verify/seams/20-seam-S-C.patch   # must print the hash above
git apply .planning/phases/20-verify/seams/20-seam-S-C.patch
git add -A bin tests
git commit -m "chore(20): apply seam S-C" -m "<the two trailer lines>"
```

Then do not edit any file the patch adds, or any hunk it changes, until Phase 20 merges (20-PLAN.md §6 names who owns the rest of each touched file). Identical changes on every branch merge cleanly; a second copy of a seam API is a merge conflict and a review finding. `tests/verdicts.test.ts` is the seam's own contract test: keep every API it imports (`readSectionUnsupported` from `bin/cli/done.ts` included) and every behaviour it asserts.

## What it contains

| Status | File | sha256 (first 16) after applying |
|---|---|---|
| A | `bin/lib/verify/verdicts.ts` — the vocabulary, the sets, `sectionOutcome`, `blocksCompile`, `quoteTextSha256`, `quoteId`, `QUOTE_ID_RE`, `TextFinding`, the Pass-2 headers | `8fa34ac95fb59456` |
| M | `bin/lib/verify/verdict-rows.ts` — `BLOCKING_VERDICTS` from verdicts.ts; `blockingRowReason` for UNVERIFIABLE-NETWORK and UNVERIFIABLE-QUOTE | `6b285aca0b385181` |
| M | `bin/cli/verify.ts` — the status through `sectionOutcome` | `80a9a42441ba9d49` |
| M | `bin/lib/verify/pass1.ts` — `Pass1Verdict = Pass1RowVerdict`; `Pass1Result.checkedAt?`; `Pass1Options.bibEntries?` (used), `.refresh?` (declared) | `7fdbe2de21ae0832` |
| M | `bin/lib/verify/pass3.ts` — `Pass3Result.id`, `.quoteSha256`, `.localFile?` (filled) | `f25a188f6639e5d6` |
| M | `bin/cli/compile.ts` — `productionReVerify` through `blocksCompile` | `46e65cddde597cc0` |
| M | `bin/cli/done.ts` — GATE-04 through `blocksCompile`; the Pass-2 reader accepts both headers and reads Evidence | `68f07cbf91c3f666` |
| M | `bin/lib/router.ts` — the retry-online one-liner counts UNVERIFIABLE-NETWORK | `c01b97f7cb982c5d` |
| A | `tests/verdicts.test.ts` — the seam contract (7 tests) | `53c2242de0904510` |

## API summary

- `verdicts.ts`: `PASS1_VERDICTS` / `Pass1RowVerdict` (`OK`, `OK-BYO`, `FABRICATED`, `MIS-CITED`, `RETRACTED`, `UNASSIGNED`, `UNPARSEABLE`, `UNSUPPORTED-FORM`, `UNRESOLVABLE`, `UNVERIFIABLE-NETWORK`, `UNVERIFIABLE`); `PASS3_VERDICTS` / `Pass3RowVerdict` (`PASS`, `FUZZY`, `NOT_FOUND`, `UNVERIFIABLE-QUOTE`, `UNVERIFIABLE-NETWORK`, `UNATTRIBUTED`); `DRAFT_VERDICTS` / `DraftVerdict` (`PLACEHOLDER`, `NO-CITATIONS`); `PASSING_VERDICTS` (`OK`, `OK-BYO`, `PASS`, `FUZZY`); `FAILING_VERDICTS`; `UNVERIFIABLE_VERDICTS` (`UNVERIFIABLE-NETWORK`, `UNVERIFIABLE`, `UNVERIFIABLE-QUOTE`, `PLACEHOLDER`); `BLOCKING_VERDICTS`; `ACCEPTABLE_QUOTE_VERDICT` (`UNVERIFIABLE-QUOTE`); `RETRY_ONLINE_VERDICTS` (`UNVERIFIABLE-NETWORK`); `LEGACY_UNAVAILABLE_VERDICTS` (`PDF_UNAVAILABLE`, `TEXT_UNAVAILABLE`: read from older files only); `UNATTRIBUTED_CITEKEY` (`(unattributed)`); `VerdictRowLike {verdict, accepted?}`; `SectionStatus`; `SectionOutcome {status, blocked}`; `blocksCompile(verdict, accepted = false)`; `sectionOutcome(rows)`; `quoteTextSha256(text)` (sha256 of NFKC text with whitespace collapsed); `quoteId(index)` (`q1`…); `QUOTE_ID_RE`; `TextFinding {verdict: 'UNPARSEABLE' | 'UNSUPPORTED-FORM', form, text, line, reason}`; `PASS2_TABLE_HEADER` (`| Citekey | Claim Sentence | Verdict | Rationale | Evidence |`); `PASS2_TABLE_HEADER_V1` (without Evidence).
- `pass1.ts`: `Pass1Options.bibEntries` — parsed entries used instead of reading `citationsBibPath`; `Pass1Options.refresh` — citekeys whose lookups bypass the HTTP-cache read (stream `registrar` implements it); `Pass1Result.checkedAt` — when the registrar answer was obtained (stream `registrar` fills it).
- `pass3.ts`: `Pass3Result.id` (`q<N>` in extraction order), `.quoteSha256`, `.localFile` (the BYO file a quote was verified against).
