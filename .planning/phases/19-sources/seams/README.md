# Phase 19 seam S-B

`19-seam-S-B.patch` holds the contracts several Phase 19 streams consume before any of them merges (D-19-01). It applies on top of Phase 18's seam S-A. It was built and verified on a scratch worktree of the base commit `20f2641c346a23cd8a6b1d01946b436b5d7e9167` with `18-seam-S-A.patch` applied:

- `git apply --check` passes on base + S-A;
- with both applied, `npm run prebuild`, `npm run lint`, `npm run typecheck` and `npm run build` pass, and the full `npm test` passes 1538 of 1539 tests — the one failure is the documented root-only `tests/atomic-write.test.ts` "preserves OLD content on rename/write failure" case (CLAUDE.md gotcha; it passes in CI).

Patch sha256: `b97be02bf4af6adf5917c7981ecc2f308f54fcc5853fe9ee508103247e82a480`.

## How every stream applies it

As the stream's first two commits, before any other change:

```bash
sha256sum .planning/phases/18-ground/seams/18-seam-S-A.patch   # 0bfce1f99e2cc6763527dcff50c07b9f9d6f7cdee196ff249b3870d6499d2e80
git apply .planning/phases/18-ground/seams/18-seam-S-A.patch
git add -A
git commit -m "chore(18): apply seam S-A" -m "<the two trailer lines>"

sha256sum .planning/phases/19-sources/seams/19-seam-S-B.patch  # must print the hash above
git apply .planning/phases/19-sources/seams/19-seam-S-B.patch
git add -A
git commit -m "chore(19): apply seam S-B" -m "<the two trailer lines>"
```

(`git add -A` must not stage an untracked `node_modules` symlink or directory; `git status --short` before committing shows only the patch's files.)

Then do not edit any file, or any hunk of a file, the patch adds or changes until Phase 19 closes, except where 19-PLAN.md §6 names a region of a hot file outside the seam hunks. Identical changes on every branch merge cleanly; a second copy of a seam API is a merge conflict and a review finding. If a seam defect blocks a stream, the stream stops and reports it; the orchestrator issues one corrective patch that every stream applies identically.

## What it contains

| Status | File | sha256 (first 16) after applying S-A + S-B |
|---|---|---|
| M | `PRD.md` (§7.20: the `plan-research` row, no longer planned) | `776efc31ca4ac9bd` |
| A | `bin/lib/contact-email.ts` | `a3076e3255d5f5e3` |
| M | `bin/lib/gates.ts` (`plan-research`) | `cc9dfb31a0ac205d` |
| M | `bin/lib/http.ts` (host-availability and redirect errors, `formatRetryAfter`; `HttpSource` books / zotero with TTL and rate rows; `FetchOptions.validate` and the no-cache / no-record rule) | `f8ccb7fa97bc7b83` |
| M | `bin/lib/library.ts` (v2 → v3 registration; Zotero-key match; v3 merge rules) | `1e4952b6a5f8b264` |
| M | `bin/lib/migrations/library/shape.ts` (`LibraryCandidate` v3 fields; `candidateToEntry`) | `18c78b51dde59aac` |
| A | `bin/lib/migrations/library/v2_to_v3.ts` | `384648880d302765` |
| A | `bin/lib/pdf-response.ts` | `726b0d2e9565d45c` |
| A | `bin/lib/research-md.ts` | `40422b2635929fb2` |
| M | `bin/lib/schemas/library.ts` (v3) | `50e42c1b1d706107` |
| M | `bin/lib/schemas/source-candidate.ts` (new fields; sources books / zotero / byo) | `fec49769e2d6808a` |
| A | `bin/lib/schemas/source-types.ts` | `7bea3d5f80a6e1f6` |
| A | `bin/lib/sources/lookup.ts` | `c412e1a81b17fc1c` |
| M | `bin/lib/sources/search-failure.ts` (`fromYear`, `doiPrefix`; transport refusal reasons) | `1d967a2aaf768254` |
| M | `tests/gates-registry.test.ts` (GRND-17 no longer a planned gate) | `14e44c3926507b38` |
| A | `tests/http-validate-cache.test.ts` | `40a62deb7074560f` |
| A | `tests/library-v3.test.ts` | `2c25dc8cfaf3f8fe` |
| M | `tests/library-writer.test.ts` (v1 → v2 → v3 chain; current-version assertions) | `48cd4f5b193c701e` |
| M | `tests/library.test.ts` (current-version assertions) | `9f32ca4eec71f990` |
| A | `tests/research-md.test.ts` | `4ff4894f79cb0112` |
| M | `tests/schemas.test.ts` (library = 3) | `16b58d84f251b766` |
| A | `tests/seam-s-b-contracts.test.ts` | `358a3eaa1bfba34f` |

## API summary

- `schemas/source-types.ts`: `SOURCE_TYPES` / `SourceType` / `SourceTypeSchema` (CSL types), `SOURCE_TIERS` / `SourceTier` / `SourceTierSchema` (`peer-reviewed | preprint | book | gov-report | other`), `RETRACTION_STATUSES` / `RetractionStatus` / `RetractionStatusSchema` (`unchecked | clear | retracted | unknown`), `ZoteroRefSchema` / `ZoteroRef` (`{library: users/<id> | groups/<id> | local, key: 8 chars}`), `OaLocationSchema` / `OaLocation`.
- `schemas/library.ts`: `CURRENT_LIBRARY_VERSION = 3`; entry fields added: `type`, `publisher`, `volume`, `issue`, `pages`, `editors[]`, `tier`, `relevance` (0–1), `why_relevant`, `hydrated` (default true), `retraction_status` (default `unchecked`; must agree with `retracted`), `zotero`. Author strings: `Family, Given`, `Given Family`, or `{Corporate Name}`.
- `migrations/library/v2_to_v3.ts`: `migrate(input)` — defaults; `retraction_status` from `retracted` (fail closed both ways); idempotent on v3.
- `migrations/library/shape.ts`: `LibraryCandidate` gains the v3 fields plus `byo`; `candidateToEntry` validates each (invalid → null / default).
- `library.ts`: `LIBRARY_MIGRATIONS[2]`; `MatchKind` adds `zotero` (same library + item key); merge: bibliographic fields follow the version-of-record rule and a hydrated record replaces an unhydrated BYO entry's local metadata; the latest non-null evaluation (tier, relevance, why_relevant) wins; `retracted` is sticky, otherwise the newest non-`unchecked` retraction outcome wins; `zotero` and `byo` keep the first value.
- `schemas/source-candidate.ts`: optional `pmid`, `pmcid`, `venue`, `volume`, `issue`, `pages`, `publisher`, `type`, `editors`, `oa_locations`, `retraction_status`, `zotero`; `source` also `books`, `zotero`, `byo`.
- `sources/lookup.ts`: `LookupResult` (`found | not-found | failed`), `lookupFound`, `lookupNotFound`, `lookupFailed(reason, {status?, retryAfterMs?})`, `SourceLookupError` (a `PensmithError`, exit 1: `<source> lookup of <id> failed: <reason>`), `isSourceLookupError`, `unwrapLookup(result, source, id)`.
- `sources/search-failure.ts`: `SearchOptions.fromYear`, `SearchOptions.doiPrefix`; `errorFailureReason` renders `RateLimitExhaustedError` (`rate limit exhausted (retry after ~6 h)`), `CircuitOpenError` (`skipped after 3 consecutive HTTP 503 responses`), `RedirectError`, `SsrfBlockedError`, `ResponseTooLargeError`.
- `http.ts`: `formatRetryAfter(ms)`, `RateLimitExhaustedError(host, retryAfterMs, status?)`, `CircuitOpenError(host, lastStatus, failures)`, `isHostUnavailableError`, `RedirectErrorKind`, `RedirectError(kind, url, detail)`; `HttpSource` `books` (7 d, 1/s) and `zotero` (1 h, 5/s); `FetchOptions.validate(res) → reason | null` — a reason, or a 200 whose body is an API error document, keeps the response out of the cache and out of recordings (the response is still returned). The error classes are thrown once stream `net` lands the redirect loop, the exhausted-host marker and the breaker.
- `contact-email.ts`: `contactEmail(root?) → {email, envName, source}`, `DEFAULT_CONTACT_EMAIL_ENV`, `isAllowedContactEnvName`, `isPlausibleEmail`, `_resetContactEmailForTest`.
- `pdf-response.ts`: `checkPdfResponse({status, headers, bodyBytes}) → {ok: true, bytes} | {ok: false, reason}` (`HTTP 404`, `empty response body`, `not a PDF (got text/html)`), `hasPdfMagic(bytes)`.
- `research-md.ts`: `RESEARCH_LOG_END` (equal to research-orchestrator's), `SOURCES_START`, `SOURCES_END`, `provenanceTags(entry)`, `formatReference(entry)`, `renderSourcesBlock(entries)`, `upsertSourcesBlock(existing, block)`, `refreshResearchSources(root) → {path, changed, count}`.
- `gates.ts`: `plan-research` — label "Add these research hits to the section?", `--yolo` adds every hit, non-TTY refuses with exit 3 (GRND-17).
