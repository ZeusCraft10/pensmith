---
phase: 16-ci-dx-parity-docs-packaging
reviewed: 2026-06-24T12:00:00Z
depth: deep
files_reviewed: 9
files_reviewed_list:
  - bin/lib/http-mock.ts
  - package.json
  - .github/workflows/ci.yml
  - .c8rc.json
  - bin/cli/intake.ts
  - workflows/doctor.md
  - workflows/next.md
  - workflows/resume.md
  - workflows/status.md
  - README.md
  - PRIVACY.md
  - references/doctor-output.md
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: fixed
# Disposition: WR-01 FIXED (isOfflineMode guard added to clearCassettes before the lazy nock import).
# WR-02 ACCEPTED-AS-INTENDED: the explicit `npm run prebuild &&` in `check` is REQUIRED for CI-01 —
#   lint+typecheck run before build's prebuild hook, so on a fresh checkout the generated sources must
#   be produced first. The double-run (explicit + build hook) is idempotent + instant; the reviewer's
#   "drop the explicit prebuild" fix would re-break CI-01. Kept by design.
# IN-01 NOTED: porcelain gate relies on all c8 reporters writing to gitignored paths (text+lcov do today).
---

# Phase 16: Code Review Report

**Reviewed:** 2026-06-24T12:00:00Z
**Depth:** deep
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Phase 16 ships the DOCS-03 lazy-nock refactor, a CI-02 porcelain gate, a CI-03 coverage gate with c8, disclaimer copy (DOCS-01), four workflow body stubs filled (DOCS-02), and packaging updates (nock moved to devDependencies). The implementation is largely sound. Two WARNING-level findings and one INFO-level finding are documented below.

The highest-risk item (DOCS-03 lazy-nock) is structurally correct: no top-level `import nock` remains in `bin/lib/http-mock.ts`, all four nock-using functions use `await import('nock')` inside their bodies, and the seven production adapters (crossref, arxiv, openalex, pubmed, retraction-watch, semanticscholar, unpaywall) plus honesty.ts, plagiarism.ts, and freshness.ts import only the three nock-free functions (`isOfflineMode`, `loadCassetteFile`, `loadCassetteDir`). The `nock.Body -> as any` cast loses no real type guarantee because `nock.Body` was already `string | Record<string, any>`. The CI-02 porcelain gate correctly exits 1 on a dirty tree. The `< /dev/null` stdin redirect on the Windows runner works because GitHub Actions uses Git Bash for `shell: bash` steps.

The two WARNING-level findings involve: (1) `clearCassettes()` unconditionally importing nock without an `isOfflineMode()` guard — a structural inconsistency that would throw in a production install if that function were ever called from production code, and (2) the `check` npm script invoking `prebuild` twice (once explicitly, once as the npm lifecycle pre-hook for `build`). Neither causes a current runtime failure, but both are latent traps.

## Warnings

### WR-01: `clearCassettes()` imports nock unconditionally — no `isOfflineMode()` guard

**File:** `bin/lib/http-mock.ts:230-234`

**Issue:** `loadCassettes()` has an early-return guard `if (!isOfflineMode()) return;` before it calls `await import('nock')`. `clearCassettes()` has no such guard — it unconditionally runs `const { default: nock } = await import('nock')` every time it is called. Because `nock` is now a `devDependency`, any code path that calls `clearCassettes()` in a production install (where `npm install --omit=dev` is used) will throw `ERR_MODULE_NOT_FOUND`. No current production adapter calls `clearCassettes()`, but the exported function is part of the public API surface of `http-mock.ts`. A future caller added to bin/ code would silently introduce a prod-throw regression, and there is no structural guard preventing it. The asymmetry between the two "pair" functions (`loadCassettes` guards nock, `clearCassettes` does not) is a correctness trap.

**Fix:**

```typescript
export async function clearCassettes(): Promise<void> {
  // Only meaningful when nock interceptors are active (offline mode).
  // Skip unconditionally in online mode — avoids ERR_MODULE_NOT_FOUND on
  // production installs (nock is a devDependency).
  if (!isOfflineMode()) return;
  const { default: nock } = await import('nock');
  nock.cleanAll();
  nock.enableNetConnect();
}
```

### WR-02: `check` npm script runs `prebuild` twice — explicit invocation + npm lifecycle pre-hook

**File:** `package.json:26`

**Issue:** The `check` script is:

```
npm run prebuild && npm run lint && npm run typecheck && npm run build && ...
```

`prebuild` is both an explicit first step AND the npm lifecycle pre-hook that npm automatically runs before `npm run build`. When `check` calls `npm run build`, npm runs `prebuild` a second time. This means `version.generated.ts` and `verbs.json` are written twice per `npm run check` invocation. The double-write is currently harmless (deterministic, idempotent content), but:

1. It wastes CI time (prebuild runs `tsc` parsing of verbs.ts and `readFileSync` of package.json twice).
2. The explicit `npm run prebuild` in `check` is now redundant — the lifecycle hook already covers it.
3. More importantly, if `prebuild.mjs` ever gains a non-idempotent side effect (e.g., incrementing a counter, recording a timestamp), the double-run would become a correctness bug with no obvious root cause.

The CI workflow correctly runs `npm run prebuild` as an explicit separate step (before `lint` and `tsc --noEmit`) because the workflow does NOT call `npm run build` at that point — so the CI workflow is NOT affected. The double-run only affects local developers running `npm run check`.

**Fix:** Remove the explicit `npm run prebuild &&` prefix from the `check` script and rely solely on the npm lifecycle hook. Alternatively, rename the pre-hook to something that is not an npm lifecycle keyword (e.g., `gen`) to make execution order explicit:

```json
// Option A — rely on the lifecycle hook (npm run build triggers prebuild automatically):
"check": "npm run lint && npm run typecheck && npm run build && npm run test:tier-contract && npm test && npm run validate:manifests",

// Option B — keep explicit but rename the lifecycle script to not double-trigger:
"gen": "node scripts/prebuild.mjs",
"prebuild": "npm run gen",
"check": "npm run gen && npm run lint && npm run typecheck && npm run build && npm run test:tier-contract && npm test && npm run validate:manifests"
```

Option A is the minimal fix. Option B makes intent explicit and is defensive against future npm version changes.

## Info

### IN-01: CI-02 porcelain gate is the last step — test artifacts from `test:coverage` that survive to disk will cause a false-fail if they are not gitignored

**File:** `.github/workflows/ci.yml:60-69`

**Issue:** The porcelain gate (`git status --porcelain`) runs after `test:coverage`. c8 writes `coverage/lcov.info` (lcov reporter configured in `.c8rc.json`) and possibly `.nyc_output/` (V8 intermediate data). Both `coverage/` and `.nyc_output/` are gitignored (`.gitignore:20-21`), so the current configuration does not false-fail. Three lint tests (`lint-capabilities-noleak`, `lint-mcp-no-network`, `lint-thin-shim`) create `mcp/__fixtures__/` and write temporary files to it, then `unlink` the files in `finally` blocks. The directory itself (`mcp/__fixtures__/`) may persist as an empty directory after tests complete; git ignores empty directories by design and `git status --porcelain` will not report it. This is safe as of the current implementation.

The finding is listed because the chain `test → coverage artifacts → porcelain check` is load-bearing. Any future addition of a reporter (e.g., `html` reporter for c8, or a JUnit XML reporter) that writes to an unignored path would silently break CI in a confusing way (the `check-coverage` step passes, then the porcelain gate fails with a cryptic "untracked files" message).

**Fix:** No immediate action required. As a preventive measure, consider adding a comment in `.c8rc.json` or `.github/workflows/ci.yml` noting that the reporters must only write to gitignored paths:

```yaml
# CI-02 NOTE: 'reporter' in .c8rc.json must only write to gitignored paths
# (coverage/ and .nyc_output/ are in .gitignore). Adding 'html' or 'json'
# reporters without verifying .gitignore coverage will false-fail this step.
- name: Assert working tree is clean after build (stale-derived-file guard — CI-02)
```

---

## Non-findings (confirmed clean)

The following concerns were explicitly checked and found to have no defect:

**DOCS-03 lazy-nock production safety:** No top-level `import nock from 'nock'` remains in `bin/lib/http-mock.ts`. All four nock-using functions (`loadCassettes`, `clearCassettes`, `recordCassettes`, `finalizeRecording`) use `await import('nock')` inside their function bodies. The test in `tests/http-mock.test.ts` now runs (the `skip` guard was conditioned on the top-level import being present; it is now absent). Production adapters (crossref, arxiv, openalex, pubmed, retraction-watch, semanticscholar, unpaywall, honesty, plagiarism, freshness) import only `isOfflineMode`, `loadCassetteFile`, and/or `loadCassetteDir` — all three are nock-free synchronous/pure functions. A production install without nock will load `http-mock.ts` without error.

**`nock.Body` -> `as any` type change:** `nock.Body` is defined as `string | Record<string, any>` — it already contains `any`. The cast to `as any` loses no meaningful type guarantee for the call site (`.reply(status, response as any, headers)`). The `eslint-disable` comment is appropriate given the dynamic import pattern.

**CI-02 porcelain gate correctness:** The `git status --porcelain` check correctly exits 1 on any dirty tree. The shell variable `$status` is correctly quoted. `build` (tsc) writes only to `dist/` (gitignored). `test:coverage` writes to `coverage/` and `.nyc_output/` (both gitignored). Tests write to `os.tmpdir()` or `mcp/__fixtures__/` (gitignored). No unignored file is written after `actions/checkout`.

**`< /dev/null` on Windows runner:** GitHub Actions' `shell: bash` on Windows uses Git Bash (not cmd.exe), which provides `/dev/null`. The redirect is portable across all three OS runners (ubuntu, macos, windows). Tests that use prompts (`prompts-shape.test.ts`, `prompts-numbered.test.ts`) supply synthetic `PassThrough` streams via the `ask()` `stdin` option and do not read from `process.stdin`, so the EOF stdin does not affect them.

**CI-01 double-prebuild in `check` script (local only):** The explicit `npm run prebuild` in `check` plus the npm lifecycle hook both run `prebuild.mjs` before `build`. The double-run is idempotent and harmless for the current implementation. CI is unaffected (CI does not run `npm run check`; it runs individual steps).

**DOCS-01 disclaimer:** The disclaimer in `bin/cli/intake.ts` is printed unconditionally at the top of `run()` via `process.stdout.write`, before any `ask()`, model call, or key probe. The text is semantically identical to the `## Disclaimer` section in `README.md` (line-wrapped differently but character-for-character equivalent content). No "undetectable" or "evade detection" language appears anywhere in the reviewed files.

**DOCS-02 workflow bodies:** All four stub workflows (`doctor.md`, `next.md`, `status.md`, `resume.md`) contain `<capability_check>` blocks with correct `required` and `degrade_if_missing` entries. The zero-branch invariant (`lint-tutorial-no-branch.test.ts`) was verified: the FORBIDDEN pattern `/(educator_mode|TutorialSubscriber|\bgoal|learning|educator)/i` does not match any code-tier content in these workflow bodies after comment stripping. `TUTORIAL.md` in `workflows/resume.md:35` is a filename reference, not a vocabulary token.

**DOCS-03 async signature change and callers:** `loadCassettes`, `clearCassettes`, `recordCassettes`, and `finalizeRecording` were previously `void`/`async`. The only callers are in the recorder tooling (Plan 09 bin/cli/refresh-cassettes.ts, not yet shipped) and tests — no production adapter calls any of these four functions. The signature change from sync to async for `clearCassettes` and `finalizeRecording` does not break any existing caller.

**No committed generated files or secrets:** `git status --porcelain` is clean. No `bin/lib/version.generated.ts`, `bin/lib/verbs.json`, `dist/`, or `coverage/` files appear in the commit. No secrets or credentials detected.

**Broken relative links:** The stale `[PRD.md](./PRD.md)` and `[.planning/PROJECT.md](./.planning/PROJECT.md)` links from the old README stub were removed in this phase. No broken relative links remain in `README.md`, `PRIVACY.md`, or `references/doctor-output.md`.

---

_Reviewed: 2026-06-24T12:00:00Z_
_Reviewer: Claude Sonnet 4.6 (gsd-code-reviewer)_
_Depth: deep_
