---
phase: 01-foundation-nfrs
plan: 00
subsystem: infra
tags: [ci, eslint, chokepoints, fast-check, nock, undici, p-retry, proper-lockfile, zod, fixtures]

# Dependency graph
requires:
  - phase: 00-repo-skeleton-plugin-manifest
    provides: ESLint flat config + chokepoint pattern (D-06/D-07/D-08), CI matrix (D-19), red-team fixture pattern, test runner (scripts/run-tests.mjs), engines.node ≥20.10
provides:
  - CI matrix Node version bumped to 20.18 (unblocks undici@7 / nock@14 / @clack/prompts@1)
  - 10 runtime deps + 4 dev deps installed and locked (Phase 1's full dep set lands now so W1-W13 install offline from lockfile)
  - D-07 atomic-write chokepoint (no-restricted-syntax CallExpression selector banning fs.writeFile outside bin/lib/atomic-write.ts) with forward-declared exemption
  - D-41 paths chokepoint (4 no-restricted-syntax MemberExpression selectors banning os.homedir() and process.env.{LOCALAPPDATA,APPDATA,XDG_DATA_HOME} outside bin/lib/paths.ts) with forward-declared exemption
  - Two new red-team fixtures (lint-atomic-write-chokepoint-fixture.ts, lint-paths-chokepoint-fixture.ts) added to global-ignores for Wave 1/2 programmatic regression tests
  - references/http-warnings.md (locked WARN copy for missing PENSMITH_CONTACT_EMAIL — D-24 single source of truth shared by W5 http.ts and Phase 2 doctor)
  - tests/fixtures/doi-corpus.ts (10 fast-check generators for W4 DOI property test + Phase 3 verifier reuse)
  - 3 scaffold directories with .gitkeep (tests/fixtures/http-cassettes/, bin/lib/schemas/, bin/lib/runtime/) for W5/W7/W13 to drop files into without git noise
  - coverage script (`npm run coverage`) wrapping the existing test runner with c8
affects: [01-01-paths, 01-02-atomic-write, 01-03-lock, 01-04-doi, 01-05-http, 01-06-budget, 01-07-migrations, 01-08-pii, 01-09-session-log, 01-10-state-library-checkpoint, 01-13-runtime, phase-02-tier-shells, phase-03-vertical-slice]

# Tech tracking
tech-stack:
  added:
    - undici@^7 (HTTP client — W5)
    - p-retry@^6 (jittered retry — W5)
    - proper-lockfile@^4 (concurrent-run lock — W3)
    - zod@^3.23 (schema validation — W7+)
    - smol-toml@^1.6.1 (config.toml parser)
    - doi-regex@^0.1.17 (DOI extraction from prose — Phase 3 verifier)
    - "@anthropic-ai/sdk@^0.93 (Anthropic provider — W13)"
    - openai@^4 (OpenAI/openai-compatible provider — W13)
    - "@modelcontextprotocol/sdk@^1.29 (Phase 2 MCP server — pre-pinned)"
    - "@clack/prompts@^0.7 (Phase 2 doctor UI — pre-pinned)"
    - "@types/proper-lockfile@^4 (dev — TypeScript types)"
    - c8@^11.0.0 (dev — coverage runner)
    - fast-check@^3 (dev — property testing for DOI corpus)
    - nock@^14 (dev — HTTP cassette tests for W5)
  patterns:
    - Phase-1 chokepoints follow Phase-0 pattern (rule + per-file exemption + red-team fixture in global-ignores)
    - D-41 enforced via no-restricted-syntax MemberExpression selectors (NOT no-restricted-globals — the latter cannot ban member access patterns like process.env.X)
    - Forward-declared exemptions (lib files don't exist yet but exemption block ships with the rule) so W1/W2 contributors cannot land "just fs.writeFile for now" without the lint rule firing
    - Locked-string contracts live in references/*.md as single sources of truth (consumed by both runtime code and tests / Phase 2 doctor)

key-files:
  created:
    - tests/fixtures/lint-atomic-write-chokepoint-fixture.ts
    - tests/fixtures/lint-paths-chokepoint-fixture.ts
    - tests/fixtures/doi-corpus.ts
    - tests/fixtures/http-cassettes/.gitkeep
    - references/http-warnings.md
    - bin/lib/schemas/.gitkeep
    - bin/lib/runtime/.gitkeep
  modified:
    - .github/workflows/ci.yml (Node 20.10 → 20.18, single value bump)
    - package.json (+10 runtime deps, +4 dev deps, +1 coverage script)
    - package-lock.json (regenerated)
    - eslint.config.js (no-restricted-syntax expanded from 1 selector to 6; +2 per-file exemptions; +2 entries in global-ignores)

key-decisions:
  - "CI Node bumped to 20.18 (not 20.19, not 21, not 22 LTS) — minimum needed to satisfy undici@7 (>=20.18.1), nock@14 (>=20.12.1), @clack/prompts@1 (>=20.12). Conservative pin avoids dragging in unrelated runtime changes."
  - "engines.node stays >=20.10.0 unchanged — that's the runtime contract for users who install pensmith. CI Node version is the dev/test floor and may exceed engines.node."
  - "zod pinned at ^3.23 (not ^4) per CONTEXT.md D-38. zod@4 is current latest with breaking changes; Phase 1 uses 3.x intentionally. RESEARCH.md §Summary explicitly flagged this and Phase 1 honored the pin."
  - "D-41 paths chokepoint enforced via no-restricted-syntax MemberExpression selectors only — no-restricted-globals: process is the obvious-but-wrong approach (B5) because it bans every legitimate process.* access. The MemberExpression selector pattern targets only the chokepointed env vars."
  - "Forward-declared per-file exemptions for bin/lib/atomic-write.ts and bin/lib/paths.ts — files don't exist yet but exemption blocks ship now so W1/W2 don't have to revisit eslint.config.js and accidentally drift the rule."
  - "doi-corpus.ts has NO @ts-nocheck (deviates from PLAN.md fixture style) — typescript-eslint ban-ts-comment rule fires; the file is genuine TypeScript with sound types from fast-check, so the comment was redundant and harmful."

patterns-established:
  - "Pattern: Forward-declared chokepoint exemption — when introducing a chokepoint rule for a file that doesn't exist yet, ship the per-file exemption block in the same commit so the rule cannot inadvertently block its own implementation."
  - "Pattern: Single-source-of-truth for locked user-facing strings — references/*.md files are read at module load by runtime code AND referenced by tests/Phase 2 doctor. Drift = test failure."
  - "Pattern: fast-check arbitrary modules in tests/fixtures/ — pure, side-effect-free, exported as named arbitraries; reusable across phases. tests/fixtures/ is excluded from tsconfig (Phase 0 D-13) so fixtures don't slow tsc, but they ARE consumed as TypeScript by tests."

requirements-completed: [TEST-11, TEST-05, ARCH-05, ARCH-08, ARCH-12]

# Metrics
duration: ~12min
completed: 2026-05-08
---

# Phase 1 Plan 00: Wave 0 Foundation Prep Summary

**CI Node bumped to 20.18, 14 deps installed and locked, two new chokepoint lint rules (atomic-write D-07 + paths D-41) plus their red-team fixtures land — every Wave 1-13 plan can now execute without revisiting build infrastructure.**

## Performance

- **Duration:** ~12 minutes (start to commit)
- **Started:** 2026-05-08T04:17:30Z (approximate, from npm-install file timestamps)
- **Completed:** 2026-05-08T04:29:00Z
- **Tasks:** 2
- **Files modified:** 11 (3 modified + 7 created + 1 lockfile regenerated)

## Accomplishments

- CI matrix Node version bumped from 20.10 → 20.18 (RESEARCH §Key Finding #1 — BLOCKING for undici@7, nock@14, @clack/prompts@1)
- 10 runtime deps + 4 dev deps installed (undici, p-retry, proper-lockfile, zod, smol-toml, doi-regex, @anthropic-ai/sdk, openai, @modelcontextprotocol/sdk, @clack/prompts, @types/proper-lockfile, c8, fast-check, nock) — all 14 verified in lockfile
- Coverage script (`npm run coverage`) added (D-67) — c8 wraps the existing test runner; not a CI gate at Phase 1
- D-07 atomic-write chokepoint shipped: no-restricted-syntax CallExpression selector banning `fs.writeFile` / `fs.promises.writeFile` outside `bin/lib/atomic-write.ts`, with forward-declared per-file exemption for the not-yet-existing implementer
- D-41 paths chokepoint shipped: 4 no-restricted-syntax MemberExpression selectors banning `os.homedir()` and `process.env.{LOCALAPPDATA,APPDATA,XDG_DATA_HOME}` outside `bin/lib/paths.ts`, with forward-declared per-file exemption
- Two red-team fixtures (`lint-atomic-write-chokepoint-fixture.ts`, `lint-paths-chokepoint-fixture.ts`) created and added to ESLint global-ignores so project lint stays green; Wave 1/2 will land programmatic ESLint tests against these fixtures
- Locked-string artifact `references/http-warnings.md` created (D-24) — single source of truth for the missing-`PENSMITH_CONTACT_EMAIL` WARN banner shared by W5 `http.ts` and Phase 2 doctor (DOCT-03)
- 10 fast-check arbitraries (validDoi, doiWithTrailingPunct, doiWithPrefix, arxivNew, arxivOld, pmid, pmcid, garbage, doiMixedCase, doiNonAscii) shipped in `tests/fixtures/doi-corpus.ts` for W4 DOI round-trip property test (D-19) and Phase 3 verifier reuse
- 3 scaffold directories created with .gitkeep files (`tests/fixtures/http-cassettes/`, `bin/lib/schemas/`, `bin/lib/runtime/`) so W5/W7/W13 can drop in their files without git churn
- `npm run check` (lint + typecheck + test + validate-manifests) stays green at 18/18 tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Bump CI Node 20.10 → 20.18 + install all 11 new deps** - `2e109dc` (feat)
2. **Task 2: Add D-07 atomic-write + D-41 paths chokepoint rules + red-team fixtures + http-warnings.md + doi-corpus.ts + scaffold directories** - `f3569c3` (feat)

## Files Created/Modified

### Modified
- `.github/workflows/ci.yml` — single line edit: matrix `node: ['20.10']` → `node: ['20.18']`. The `Verify macos runner is arm64` step (Pitfall C from Phase 0) and all other workflow shape preserved.
- `package.json` — added `dependencies` block (10 entries: undici@^7, p-retry@^6, proper-lockfile@^4, zod@^3.23, smol-toml@^1.6.1, doi-regex@^0.1.17, @anthropic-ai/sdk@^0.93, openai@^4, @modelcontextprotocol/sdk@^1.29, @clack/prompts@^0.7); extended `devDependencies` (4 new: @types/proper-lockfile@^4, c8@^11.0.0, fast-check@^3, nock@^14); added `coverage` script wrapping `c8 node scripts/run-tests.mjs`. `engines.node` stays at `>=20.10.0` unchanged.
- `package-lock.json` — regenerated by `npm install`, includes 181 new packages (transitive closure of 14 added).
- `eslint.config.js` — `no-restricted-syntax` rule expanded from a single-object form (1 DOI selector) to an array of 6 selector objects (DOI + atomic-write + 4 paths). Two new per-file exemption blocks added for `bin/lib/atomic-write.ts` and `bin/lib/paths.ts`. Global-ignores list expanded with the two new red-team fixtures. The Phase-0 comment block is preserved verbatim; Phase-1 additions are commented inline.

### Created
- `tests/fixtures/lint-atomic-write-chokepoint-fixture.ts` — red-team fixture violating D-07 with `fs.writeFile()` and `await fsp.writeFile()`. Wave 2 will run ESLint programmatically against it and assert both selector instances fire.
- `tests/fixtures/lint-paths-chokepoint-fixture.ts` — red-team fixture violating D-41 with `os.homedir()`, `process.env.LOCALAPPDATA`, `process.env.XDG_DATA_HOME`, and `process.env.APPDATA`. Wave 1 will run ESLint programmatically against it and assert all 4 selector instances fire.
- `tests/fixtures/doi-corpus.ts` — 10 fast-check generators for the DOI/arXiv/PMID round-trip property test (D-19, lands W4). Reused by Phase 3 verifier tests.
- `tests/fixtures/http-cassettes/.gitkeep` — empty file marking directory; W5 fills with 8 nock JSON cassettes.
- `references/http-warnings.md` — locked WARN copy for missing `PENSMITH_CONTACT_EMAIL` (D-24). Single blockquote line is the literal string; W5 `http.ts` reads this at module load, Phase 2 doctor (DOCT-03) reuses verbatim.
- `bin/lib/schemas/.gitkeep` — empty file marking directory; W7 drops 5 zod schema files (D-38).
- `bin/lib/runtime/.gitkeep` — empty file marking subdirectory; W13 drops `pricing.ts` (D-60).

## Decisions Made

- **CI Node version: 20.18 (not later LTS)** — RESEARCH §Key Finding #1 said "minimum needed". Picking the smallest bump that satisfies all dep engines avoids dragging in unrelated runtime/V8 behavior changes. If a Phase 2-13 dep later requires a newer Node, it's a separate, conscious bump.
- **`engines.node` stays `>=20.10.0` unchanged** — that's the runtime contract for users who install pensmith. The CI Node version is the dev/test floor; users may run on any Node ≥20.10. This split is intentional per Plan task 1 step 1.5.
- **D-41 paths chokepoint via `no-restricted-syntax` MemberExpression, not `no-restricted-globals`** — explicit Pitfall B5 from PATTERNS.md (revision iteration 1). `no-restricted-globals: process` would ban every legitimate `process.cwd()`, `process.exit()`, `process.argv` etc. in the codebase. The MemberExpression selector targets only the chokepointed env vars.
- **`@ts-nocheck` removed from `tests/fixtures/doi-corpus.ts`** — see deviation below. PLAN.md specified `@ts-nocheck` in step 2.5; lint flagged it via typescript-eslint `ban-ts-comment`; the file is genuine TypeScript with sound types from fast-check, so the comment was redundant and harmful. Auto-fixed under deviation Rule 3 (blocking issue) with explanatory header note preserved.
- **Forward-declared per-file exemptions** — both `bin/lib/atomic-write.ts` and `bin/lib/paths.ts` exemption blocks ship in this commit even though the files don't exist yet. The alternative (land lib + exemption together in W1/W2) leaks the chokepoint rule into the implementing PR, where reviewers might reflexively turn the rule off rather than land the implementation that way. Forward declaration locks the contract before W1/W2 starts.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed `@ts-nocheck` from `tests/fixtures/doi-corpus.ts`**
- **Found during:** Task 2 (Step 2.5) — `npm run check` exited 1 after creating doi-corpus.ts with the plan's specified `@ts-nocheck` header
- **Issue:** The plan's step 2.5 fixture content included `// @ts-nocheck` matching the lint-chokepoint-fixture style. But `lint-chokepoint-fixture.ts` is in eslint global-ignores (so its `@ts-nocheck` is invisible to lint), whereas `doi-corpus.ts` is a normal exported module that tests import — it MUST be lintable. The typescript-eslint `ban-ts-comment` rule then flagged the `@ts-nocheck` and lint exited 1.
- **Fix:** Replaced the `@ts-nocheck` line with a comment block explaining the file's relationship to tsconfig and noting that types are kept honest because Wave 4's property test consumes the file as real TypeScript. The file content (10 fast-check arbitraries) is unchanged.
- **Files modified:** `tests/fixtures/doi-corpus.ts`
- **Verification:** `npm run check` passes (lint + typecheck + test + validate-manifests all green; 18/18 tests pass)
- **Committed in:** `f3569c3` (part of Task 2 commit — fix landed in same commit as the file creation)

---

**Total deviations:** 1 auto-fixed (1 Rule 3 blocking)
**Impact on plan:** Single-file deviation; the plan's file shape is preserved (same exports, same generators, same fast-check usage). Carry-forward note for future fixture work: tests/fixtures/ files that are *imported by tests* (e.g., doi-corpus.ts) must be lintable; only fixtures that are *static input to programmatic ESLint* (e.g., lint-*-chokepoint-fixture.ts) can carry `@ts-nocheck` — and those should always be in global-ignores.

## Issues Encountered

- **Stray empty file `=20.18.0` after `npm install`** — npm@10.9 produced a 0-byte file named `=20.18.0` in the repo root, likely from shell parsing of an unquoted `>=20.18.0` engines warning. Deleted before the Task 1 commit so it didn't enter git history. Not a real issue, just shell-environment noise.
- **No chokepoint hits on existing source** — `npm run lint` after the rule additions found zero violations in existing Phase 0 source files, confirming D-07 / D-41 introductions are clean (no Phase 0 file already does direct `fs.writeFile` or reads the chokepointed env vars). This was the success path the plan specified ("If `npm run lint` flags a real source file, STOP and investigate"); no investigation needed.

## User Setup Required

None — Wave 0 is build-time prep only. No `.paper/` directory, no environment variables, no external service config touched. Future waves (W5 http.ts) will document `PENSMITH_CONTACT_EMAIL` setup, but that's a Wave 5 / Phase 2 doctor concern, not Wave 0.

## Threat Flags

None — Wave 0 introduces no new network surface, no new auth paths, no new file access patterns at trust boundaries. The threat model declared in PLAN.md (T-01-W0-01 through T-01-W0-05) was honored:
- T-01-W0-01 (npm supply chain): mitigated by lockfile checksums; `npm audit` deferred per Phase 0 D-12
- T-01-W0-02 (chokepoint rule rot): mitigated — both new chokepoints have red-team fixtures shipped this wave; W1+W2 ship the programmatic regression tests
- T-01-W0-03 (locked WARN copy drift): mitigated — `references/http-warnings.md` is single source of truth; future drift will be caught by W5 + Phase 2 doctor reading the same file
- T-01-W0-04 (DOI corpus PII): accepted — synthetic generators only, no real DOIs, no PII
- T-01-W0-05 (CI matrix DoS): mitigated — bumped to stable LTS 20.18

## Next Phase Readiness

Wave 1 (Plan 01-01 `paths.ts`) and Wave 2 (Plan 01-02 `atomic-write.ts`) can now execute autonomously without touching build infrastructure:

- Both lib files have forward-declared exemption blocks in `eslint.config.js` ready to receive their implementations.
- Both lib files have red-team fixtures in `tests/fixtures/` ready to receive their programmatic ESLint regression tests (`tests/lint-paths-chokepoint.test.ts` for W1, `tests/lint-atomic-write-chokepoint.test.ts` for W2).
- All 14 deps the rest of Phase 1 needs are installed and in lockfile — no more `npm install` calls between W1 and W13 unless a new dep is discovered (deviation Rule 4 territory if so).
- The doi-corpus generators are imported by the future W4 property test (`tests/doi.test.ts`).
- The locked WARN copy is consumed by future W5 `bin/lib/http.ts` at module load.
- The 3 scaffold directories are ready to receive W5 cassettes, W7 zod schemas, W13 pricing.ts.

### Carry-forward notes

1. **W1 must land `tests/lint-paths-chokepoint.test.ts`** — programmatic ESLint test against `tests/fixtures/lint-paths-chokepoint-fixture.ts`, asserting all 4 D-41 selector messages fire (one per banned MemberExpression).
2. **W2 must land `tests/lint-atomic-write-chokepoint.test.ts`** — programmatic ESLint test against `tests/fixtures/lint-atomic-write-chokepoint-fixture.ts`, asserting the D-07 `CallExpression[callee.property.name='writeFile']` selector fires on both `fs.writeFile` and `fsp.writeFile` invocations.
3. **W4 (DOI property test) imports from `tests/fixtures/doi-corpus.ts`** — the 10 generators are stable; the property test (`tests/doi.test.ts`) consumes them via named imports.
4. **W5 (`bin/lib/http.ts`) reads `references/http-warnings.md` at module load** — the locked WARN string must be parsed (strip leading `> `) and used verbatim in the one-time WARN banner.
5. **`@ts-nocheck` cannot be used on tests/fixtures/ files that are imported by tests** — see deviation 1. Apply this lesson if any future fixture is consumed-as-TypeScript rather than passed-to-ESLint-as-static-input.

## Self-Check: PASSED

- `.github/workflows/ci.yml` — node: ['20.18'] verified by Read
- `package.json` — 10 runtime deps + 4 new dev deps + coverage script verified
- `package-lock.json` — all 14 packages confirmed in lockfile via Bash node script
- `eslint.config.js` — 17/17 chokepoint config + fixture + scaffold checks PASS via .tmp-verify-task2.cjs (now deleted) including the negative check `!cfg.includes("'no-restricted-globals'")` (Pitfall B5)
- All 7 created files exist on disk (verified via fs.existsSync in same script)
- Both commits exist in git log: `2e109dc` (Task 1), `f3569c3` (Task 2)
- `npm run check` exits 0 with 18/18 tests passing

---
*Phase: 01-foundation-nfrs*
*Completed: 2026-05-08*
