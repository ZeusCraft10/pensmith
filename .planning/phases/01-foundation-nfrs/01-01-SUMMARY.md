---
phase: 01-foundation-nfrs
plan: 01
subsystem: paths
tags: [paths, chokepoint, cross-platform, sync-folder-detection, slugify]
requires: ['01-00']
provides: ['pensmithDataDir', 'pensmithLockDir', 'pensmithHttpCacheDir', 'paperDir', 'sectionDir', 'projectHash', 'isInsideSyncFolder', 'slugify']
affects:
  - "Wave 2 atomic-write — uses paperDir / pensmithDataDir for tmp file co-location"
  - "Wave 3 lock — uses pensmithLockDir as the lock-file root (NOT inside .paper/)"
  - "Wave 5 http — uses pensmithHttpCacheDir for the undici cache root"
  - "Wave 9 session-log — uses paperDir for SESSION.log + sessions/{run_id}/ overflow"
  - "Wave 10 state — uses paperDir for STATE.md frontmatter persistence"
  - "Wave 11 library — uses pensmithDataDir/library/index.json as the library shard"
  - "Wave 12 checkpoint — uses paperDir for checkpoint envelopes"
  - "Phase 2 doctor — uses isInsideSyncFolder to warn users with .paper/ inside OneDrive/iCloud/Dropbox/GDrive"
tech-stack:
  added:
    - "node:crypto (createHash) — for projectHash sha256 slice"
    - "node:os (homedir) — for HOME fallback when env.HOME is unset"
    - "node:path (resolve, join) — cross-platform path arithmetic"
  patterns:
    - "Injection-point design: localDataDir(platform?, env?) accepts optional overrides for testability; production callers use the no-arg form which reads process.platform / process.env"
    - "Chokepoint-with-exemption: bin/lib/paths.ts is the SOLE call site for os.homedir() and process.env.{LOCALAPPDATA,APPDATA,XDG_DATA_HOME}; eslint.config.js per-file exemption permits these calls only here (D-41)"
    - "Defense-in-depth slug guard: NFKD strip → [^a-z0-9]+ collapse → trim → 64-char truncate → empty/'..' throw, layered so a single regex tweak does not unlock path traversal"
key-files:
  created:
    - "tests/paths.test.ts (23 functional tests)"
    - "tests/lint-paths-chokepoint.test.ts (2-test regression gate for D-41)"
  modified:
    - "(none — bin/lib/paths.ts was already committed at a507cd7 as the WIP recovery from the interrupted prior executor)"
  verified:
    - "bin/lib/paths.ts (208 LoC) — spot-checked: 10 named exports present, imports match, APPDATA never read"
decisions:
  - "Use '.js' emit-form extension in test imports (../bin/lib/paths.js), not '.ts'. NodeNext + verbatimModuleSyntax + no allowImportingTsExtensions require the .js form; tsx resolves to .ts source at runtime. This is the canonical NodeNext idiom and will be reused by every later test/lib import."
  - "slugify('../foo') returns 'foo' (the regex collapse drops '../') rather than throwing. Per PLAN behavior spec line 141, EITHER throws OR returns a string with no '..' is acceptable. The test asserts the property (output never contains '..'), not a specific exception. Period-only inputs ('..', '.', '/') still throw because they collapse to empty."
  - "Inject env into localDataDir via positional arg, not module-level constants. Each call resolves freshly so tests can pass {LOCALAPPDATA:'C:\\X'} on a Linux dev box without monkey-patching process.env. Live callers omit the arg and pay one process.env read per call (negligible)."
metrics:
  duration: "~12 min wall clock (Task 2 only — Task 1 paths.ts was already committed at a507cd7 from the interrupted prior run)"
  duration_minutes: 12
  tasks_completed: 1
  tasks_in_plan: 2
  tasks_resumed_from_prior: 1
  files_created: 2
  files_modified: 0
  tests_added: 25  # 23 functional + 2 chokepoint regression
  tests_passing: 45  # full suite, post-commit
  completed: 2026-05-08
---

# Phase 01 Plan 01: paths.ts (cross-platform path chokepoint) Summary

**One-liner:** Wave 1 lands `bin/lib/paths.ts` as the SOLE call site for `os.homedir()` and the three banned env vars (`LOCALAPPDATA`, `APPDATA`, `XDG_DATA_HOME`), provides a 10-export public API for every later library to compose project paths from, and ships two test files that prove both the per-platform branching and the D-41 lint chokepoint are provably effective.

## Resume Context

This plan executed in two passes due to a prior executor's mid-stream failure (Stream idle timeout #2410, Internal server error). The recovery sequence:

1. **Prior executor** wrote `bin/lib/paths.ts` (208 LoC) but did not commit. Recovery commit `a507cd7` (`wip(01-01): recover bin/lib/paths.ts from interrupted executor`) preserved the file.
2. **Pause snapshot** `aa1de81` (`chore(01-01): pause Wave 1 — handoff snapshot for fresh-session resume`) marked the dispatch point for this run.
3. **This run** spot-checked `bin/lib/paths.ts` against the plan's 10-export contract (PASSED — see verification below), wrote the two test files, and committed at `7b0869e`.

No amendment of the recovery commit; a fresh commit on top, per the resume directive.

## Public API (bin/lib/paths.ts — verified at a507cd7)

```ts
// Cross-platform local data root (parent of pensmith/).
//   win32   → env.LOCALAPPDATA            (throws if unset — Pitfall 4)
//   darwin  → ~/Library/Application Support
//   linux/posix → env.XDG_DATA_HOME ?? ~/.local/share
export function localDataDir(platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv): string;

// pensmith app data root: <localDataDir>/pensmith
export function pensmithDataDir(platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv): string;

// <pensmithDataDir>/locks — proper-lockfile root (Wave 3)
export function pensmithLockDir(): string;

// <pensmithDataDir>/http-cache — undici cache root (Wave 5)
export function pensmithHttpCacheDir(): string;

// path.resolve(cwd ?? process.cwd()) — absolute, normalized.
export function projectRoot(cwd?: string): string;

// 12-char lowercase hex slice of sha256(projectRoot). Disambiguates sibling
// pensmith projects in pensmithDataDir; one-way (T-01-INFO-01: accept).
export function projectHash(root?: string): string;

// <root>/.paper — per-project working dir inside the user's repo.
// (May be inside OneDrive/iCloud — that's why pensmith app state lives in
// pensmithDataDir, not paperDir.)
export function paperDir(root?: string): string;

// <root>/.paper/sections/{NN}-{slugify(slug)} — N in [0,99], else throws.
export function sectionDir(n: number, slug: string, root?: string): string;

// True if absPath is inside a known cloud-sync folder (OneDrive variants,
// iCloud Drive, Dropbox, Google Drive). Used by Phase 2 doctor for warnings.
export function isInsideSyncFolder(absPath: string): boolean;

// NFKD ASCII kebab-case, max 64 chars; throws on empty result or path-
// traversal candidate. Single sanitization between user-supplied section
// names and path.join (T-01-09 mitigation).
export function slugify(s: string): string;
```

## Platform Branching (D-40, D-43, RESEARCH §RQ-7)

| Platform | localDataDir resolution | Why |
|----------|-------------------------|-----|
| **win32** | `%LOCALAPPDATA%` (throws if unset) | LOCALAPPDATA = per-machine; APPDATA = roaming. Roaming locks → corruption when user logs in on a 2nd machine (Pitfall 4). We refuse to silently fall back. |
| **darwin** | `${HOME ?? os.homedir()}/Library/Application Support` | Apple File System Programming Guide standard. |
| **linux + POSIX** | `env.XDG_DATA_HOME ?? ${HOME ?? os.homedir()}/.local/share` | XDG Base Directory Spec. Unknown POSIX (aix, freebsd, etc.) treated as Linux. |

The `env`/`platform` injection points exist for testability — production callers use the no-arg form which reads `process.platform` and `process.env`.

## Sync-Folder Detection (`isInsideSyncFolder`)

Eight regex patterns matched case-insensitively against `absPath`:

| Vendor | Windows pattern | macOS pattern | Linux pattern |
|--------|-----------------|---------------|---------------|
| OneDrive (personal) | `\\OneDrive\\` | `/Library/CloudStorage/OneDrive-` | `/OneDrive/` |
| OneDrive (work/school) | `\\OneDrive - <tenant>\\` (the `(\\\| - )` alternation) | (same as personal — uses CloudStorage) | (same as personal) |
| iCloud Drive | (n/a — Windows uses iCloud Drive\) | `/Library/Mobile Documents/com~apple~CloudDocs/` | (n/a) |
| Dropbox | `\\Dropbox\\` | `/Dropbox/` | `/Dropbox/` |
| Google Drive | `\\Google Drive\\` | `/Google Drive/` | `/Google Drive/` |

The function returns boolean — Phase 2 doctor uses this to warn users with `.paper/` inside one of these roots; Phase 1 callers do not act on the result. NOT used for redirection — pensmith state is already outside the project tree (per `pensmithDataDir`, see D-40).

## slugify Spec

```
input  → NFKD normalize + strip combining diacritics (U+0300..U+036F)
       → toLowerCase
       → replace [^a-z0-9]+ with '-'  (greedy linear; no quadratic regex)
       → trim leading/trailing '-'
       → slice(0, 64) + re-trim trailing '-'
       → throw if empty
       → throw if includes '..'
       → return
```

Behavior matrix:

| Input | Output | Note |
|-------|--------|------|
| `"Hello World"` | `"hello-world"` | basic kebab |
| `"  Methods & Results  "` | `"methods-results"` | trim + collapse |
| `"résumé"` | `"resume"` | NFKD strips diacritic |
| `"naïve"` | `"naive"` | NFKD strips diacritic |
| `"a".repeat(100)` | (length 64) | truncation |
| `""` | **throws** | empty input |
| `"   "` | **throws** | whitespace collapses to empty |
| `"!!!"` | **throws** | punctuation collapses to empty |
| `".."` | **throws** | dots collapse to '-' which trims to empty |
| `"."` / `"/"` | **throws** | same |
| `"../foo"` | `"foo"` | regex collapses `'../'` to `'-'` then trims |
| `"foo/../bar"` | `"foo-bar"` | regex collapses to single `-`; no `'..'` survives |

The "throws OR returns string with no `..`" property is enforced by the test for mixed inputs. Both outcomes block the threat (T-01-09: path traversal in `sectionDir`).

## Tests Added

### `tests/paths.test.ts` (23 tests)

Functional coverage of all 10 exports:

- **localDataDir** (6 tests): win32 with LOCALAPPDATA, win32 throw on missing, darwin, linux-XDG, linux-fallback, aix-as-linux
- **pensmithDataDir / pensmithLockDir / pensmithHttpCacheDir** (2 tests): composition + suffix shape
- **projectRoot / projectHash** (3 tests): relative→absolute, determinism, distinct hashes for distinct roots
- **paperDir / sectionDir** (4 tests): composition, NN-slug format, slugifies free-form names, rejects out-of-range n
- **isInsideSyncFolder** (4 tests): OneDrive (Win + macOS), iCloud, Dropbox + GDrive, non-sync false
- **slugify** (6 tests): kebab, diacritics, 64-cap, determinism, empty-throw, traversal property

All 23 tests pass on Windows (the local box). The use of `path.join` in expected values keeps the tests OS-agnostic — they will pass on Linux/macOS CI matrix entries unchanged.

### `tests/lint-paths-chokepoint.test.ts` (2 tests)

Regression gate for the D-41 chokepoint:

1. **Inline rule test** — constructs the 4 selectors inline, lints `tests/fixtures/lint-paths-chokepoint-fixture.ts` (W0 output), asserts `>=4` `no-restricted-syntax` violations.
2. **Project-config test** — `import('../eslint.config.js')`, filters out global-ignores entries, lints the fixture, asserts `>=4` violations. Proves the rule shape in the **real** `eslint.config.js` is correct (Pitfall B5 mitigation — mirrors the existing pattern in `tests/lint-chokepoint.test.ts`).

The fixture has exactly 4 violations: `os.homedir()`, `process.env.LOCALAPPDATA`, `process.env.APPDATA`, `process.env.XDG_DATA_HOME`. Both tests pass.

## Spot-Check of `bin/lib/paths.ts` (recovered at a507cd7)

Per the resume directive: spot-check the recovered file against the plan's `must_haves.artifacts[0].exports` list and the chokepoint exemption.

| Check | Result |
|-------|--------|
| File exists | yes (208 LoC) |
| 10 named exports present | yes — `localDataDir`, `pensmithDataDir`, `pensmithLockDir`, `pensmithHttpCacheDir`, `projectRoot`, `projectHash`, `paperDir`, `sectionDir`, `isInsideSyncFolder`, `slugify` |
| Imports `node:os` | yes (line 24) |
| Imports `node:crypto` (createHash) | yes (line 23) |
| Calls `os.homedir()` | yes (lines 53, 60) — exemption respected |
| Reads `env.LOCALAPPDATA` | yes (line 44) — exemption respected |
| Reads `env.XDG_DATA_HOME` | yes (line 58) — exemption respected |
| Reads `process.env.APPDATA` (Pitfall 4) | **NEVER** — confirmed via grep |
| win32 throws on missing LOCALAPPDATA | yes (lines 45–49) |
| slugify NFKD + traversal guard | yes (lines 187–207) |

Spot-check **PASSED**. No rewrite needed.

## Quality Gates (Final State)

| Gate | Result |
|------|--------|
| `npm run typecheck` | PASS (0 errors) |
| `npm run lint` | PASS (0 violations) |
| `npm test` | PASS (45/45 tests, including 25 new for this plan) |
| `npm run validate:manifests` | PASS |
| `npm run check` (lint + typecheck + test + validate) | **PASS** |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test import extension `.ts` → `.js`**
- **Found during:** Task 2, first `npm run typecheck` run.
- **Issue:** PLAN sketch (line 330) wrote `from '../bin/lib/paths.ts';` but the project's `tsconfig.json` uses `module: NodeNext` + `verbatimModuleSyntax: true` and does NOT enable `allowImportingTsExtensions`. tsc rejected the `.ts` extension with `TS5097`.
- **Fix:** Changed import to `from '../bin/lib/paths.js';`. NodeNext requires the emit-form extension (`.js`) in source; tsx resolves the `.js` request to the `.ts` source file at runtime, so the test still loads the actual `bin/lib/paths.ts` module without a build step.
- **Impact:** This is the canonical pattern every later test/lib import will use. Worth recording as a project decision (above) so Wave 2+ executors don't re-discover it.
- **Files modified:** `tests/paths.test.ts` (1 line).
- **Commit:** included in `7b0869e`.

**2. [Rule 1 - Bug] `slugify('../foo')` test was over-strict**
- **Found during:** Task 2, first `npm test` run.
- **Issue:** Initial test asserted `slugify('../foo')` throws, but the regex collapse in `slugify` legitimately drops `../` to a single `-` and produces `'foo'` — no `..` survives, which is exactly the threat-model property the test should verify (T-01-09: nothing containing `..` reaches `path.join`). The PLAN behavior spec on line 141 explicitly allows EITHER throws OR returns a string with no `..`.
- **Fix:** Rewrote the test to assert the property (output never contains `..`) rather than a specific exception, and split the throw-asserts to inputs that genuinely collapse to empty (`'..'`, `'.'`, `'/'`).
- **Impact:** Strengthens the test — now matches the actual security invariant rather than a single implementation choice. The threat is correctly caught either way.
- **Files modified:** `tests/paths.test.ts` (one test block).
- **Commit:** included in `7b0869e`.

### Auth Gates

None.

### Architectural Changes

None (Rule 4 not invoked).

## Carry-Forward for Wave 2-13

Every later Phase 1 library may now import from this module:

```ts
import {
  pensmithDataDir, pensmithLockDir, pensmithHttpCacheDir,
  paperDir, sectionDir, projectRoot, projectHash,
  isInsideSyncFolder, slugify,
} from '../lib/paths.js';
```

(Use `.js` emit-form extension — see Decisions above.)

**Permanent bans (D-41 enforcement):**
- `os.homedir()` outside `bin/lib/paths.ts` — chokepoint lint blocks it.
- `process.env.LOCALAPPDATA` outside `bin/lib/paths.ts` — chokepoint lint blocks it.
- `process.env.XDG_DATA_HOME` outside `bin/lib/paths.ts` — chokepoint lint blocks it.
- **`process.env.APPDATA` everywhere — including inside `bin/lib/paths.ts`** (the chokepoint exemption permits the rule to be off, but `paths.ts` deliberately never reads APPDATA per Pitfall 4; the exemption exists only because the rule's selector cannot distinguish "any APPDATA read" from "the wrong-platform fallback APPDATA read").

**Wave 3 (lock):** Use `pensmithLockDir()` (NOT `path.join(paperDir(), 'locks')`). Locks must live outside the project tree per D-40.

**Wave 5 (http):** Use `pensmithHttpCacheDir()` for the undici cache root.

**Wave 9 (session-log) / Wave 10 (state) / Wave 12 (checkpoint):** Use `paperDir()` + `sectionDir(n, slug)` for in-repo per-paper/per-section state.

**Wave 11 (library):** Library index lives at `${pensmithDataDir()}/library/index.json` (NOT `.paper/library.json`).

**Phase 2 (doctor):** Use `isInsideSyncFolder(projectRoot())` to warn users that their `.paper/` is inside OneDrive/iCloud/Dropbox/GDrive. The warning is informational; pensmith does not refuse to run.

## Threat-Model Status (PLAN.md `<threat_model>`)

| Threat | Disposition | Status |
|--------|-------------|--------|
| T-01-09 (path traversal via slugify) | mitigate | **mitigated** — NFKD + regex collapse + trim + 64-cap + empty/`..` throw; tests cover `..`, `../foo`, `/etc/passwd`, empty, whitespace-only, all-punctuation |
| T-01-INFO-01 (projectHash leaks abs path) | accept | accepted — sha256 12-hex slice is one-way; not used as a secret |
| T-01-DOS-01 (long input to slugify) | mitigate | mitigated — `[^a-z0-9]+` is greedy linear, no quadratic regex; truncation runs after collapse |

No new threat surface introduced.

## Self-Check: PASSED

- [x] `bin/lib/paths.ts` exists at the expected path (208 LoC, committed at a507cd7) — verified via Read tool
- [x] `tests/paths.test.ts` exists at the expected path — created and committed at 7b0869e
- [x] `tests/lint-paths-chokepoint.test.ts` exists at the expected path — created and committed at 7b0869e
- [x] Commit `7b0869e` exists in `git log --oneline` — verified
- [x] Commit `a507cd7` (the recovery commit) exists in `git log --oneline` — verified
- [x] `npm run check` exits 0 — verified above
- [x] No modifications to STATE.md, ROADMAP.md, or any file outside this plan's `files_modified` (bin/lib/paths.ts was modified at a507cd7 by the prior recovery commit, NOT this run; the SUMMARY.md is the only file this run adds outside `files_modified` and is the expected output per the plan's `<output>` block)
