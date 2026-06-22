---
phase: 01-foundation-nfrs
plan: 03
subsystem: lock
tags: [lock, proper-lockfile, createRequire, CJS-shim, cross-process, OneDrive, sha256, ARCH-06, D-26, D-40, TEST-07]
requires: ['01-00', '01-01', '01-02']
provides: ['withLock', 'tryAcquire', 'release', 'isLocked']
affects:
  - "Wave 10 state — `.paper/STATE.md` read-modify-write wrapped in `withLock(stateResource, async () => {...})`"
  - "Wave 11 library — `${pensmithDataDir()}/library/index.json` read-modify-write wrapped in `withLock(libResource, ...)`"
  - "Wave 12 checkpoint — checkpoint envelope writes wrapped in `withLock(checkpointResource, ...)`"
  - "Wave 13 runtime — runtime config write wrapped in `withLock(runtimeResource, ...)`"
  - "pensmith CLI ↔ Claude Code plugin — both processes touching the same project's state serialize via this lock chokepoint"
tech-stack:
  added:
    - "proper-lockfile@^4 (already installed in W0) — battle-tested file-system advisory lock primitive (used by npm/yarn)"
    - "node:module createRequire — CJS-import shim to load proper-lockfile under TypeScript NodeNext ESM"
    - "node:crypto createHash (sha256) — lock filename derivation from resource string"
  patterns:
    - "createRequire CJS-import shim: `const require_ = createRequire(import.meta.url); const lockfile = require_('proper-lockfile') as typeof import('proper-lockfile');`. The runtime is a real `require()` call (CJS load); the `as typeof import(...)` is purely a type-side annotation that survives `verbatimModuleSyntax: true`. Without this shim, every test that touches lock.ts would die on `ERR_REQUIRE_ESM` under tsx + node:test (RESEARCH §Key Finding #4 — BLOCKING)."
    - "Out-of-tree lock dir (D-40): all locks live in `pensmithLockDir()` (`%LOCALAPPDATA%\\pensmith\\locks` / `~/Library/Application Support/pensmith/locks` / `$XDG_DATA_HOME/pensmith/locks`). NEVER inside `.paper/` — OneDrive / iCloud / Dropbox open-delete-recreate files mid-write, which corrupts active lock files. Verified live on the dev box (`C:\\Users\\akhil\\OneDrive - Roanoke College\\...`): the test suite produced 12-hex stub files under `%LOCALAPPDATA%\\pensmith\\locks` and zero `.lock` files inside `.paper/`."
    - "Stub-file pattern: proper-lockfile.lock(file) requires `file` to exist; we touch a per-resource stub at `pensmithLockDir()/sha256(resource).slice(0,12)` (open with 'a' flag — create-if-missing without truncating) before calling `lockfile.lock(stub, opts)`. proper-lockfile then creates the real lock at `${stub}.lock` alongside it."
    - "Hashed lock-filename (T-01-INFO-03): the 12-hex SHA-256 prefix is one-way and embeds no path information — resources like `'C:\\\\Users\\\\u\\\\OneDrive\\\\repo\\\\.paper\\\\sections\\\\03-methods'` (which contain `:`, `\\\\`, and spaces — all of which break Windows lock-filename rules) hash safely to `8a2f1c3d9b04`."
    - "withLock try/finally: `release` is called inside a `finally` block with a swallow on the release-throw path (proper-lockfile may throw if the lock was already broken as stale). The caller's contract is `fn()`'s return value, not a successful unlock."
key-files:
  created:
    - "bin/lib/lock.ts (175 LoC) — D-26 chokepoint, four exports: withLock + tryAcquire + release + isLocked"
    - "tests/lock.test.ts (207 LoC, 6 tests) — functional + same-process-serialization + cross-process-spawn coverage"
    - "tests/lock-conflict.cjs (81 LoC) — child-process helper for TEST-07; spawned via `child_process.spawn(process.execPath, [helper], { env: {RESOURCE, HOLD_MS} })`"
  modified:
    - "eslint.config.js — extend the existing `scripts/**/*.cjs` `@typescript-eslint/no-require-imports` exemption to also cover `tests/**/*.cjs` (Rule 3 deviation, see below)"
decisions:
  - "Use createRequire(import.meta.url) shim — NOT default-import. RESEARCH §Key Finding #4 documented this as BLOCKING: under tsx + node:test in the project's `\"type\":\"module\"` mode, `import lockfile from 'proper-lockfile'` raises `ERR_REQUIRE_ESM`. The shim isolates the CJS load to one line in lock.ts; downstream callers (W10-W13) just `import { withLock } from '../lib/lock.js'`."
  - "Lock files live in `pensmithLockDir()`, NEVER inside `.paper/` (D-40 OneDrive non-negotiable). The dev box runs from inside `OneDrive - Roanoke College/Documents/Github/pensmith`; placing a lock file inside `.paper/` would let OneDrive's open-delete-recreate sync cycle corrupt it during contention. The platform-local data dir is outside any sync root, so locks remain trustworthy."
  - "Lock filename = `sha256(resource).slice(0,12)` — one-way, deterministic, collision-free for any reasonable resource cardinality, and survives Windows lock-filename rules (no `:`, `\\\\`, or spaces). Threat model T-01-INFO-03 (resource path leakage via lock filename) is mitigated by the hash."
  - "`staleMs = 45_000` default (1.5x of D-26's 30s working-TTL). proper-lockfile considers a lock older than `stale` to be abandoned and lets the next caller take it. The 1.5x ratio gives a healthy heartbeat-free process 45s of grace before another process can steal — well above the longest expected synchronous critical section in W10-W13 (state writes are <100ms; checkpoint envelope writes are <500ms)."
  - "`timeoutMs = 60_000` default — translated into a node-retry exponential schedule via proper-lockfile's `retries: { retries, minTimeout, maxTimeout, factor }` shape. The retry count is computed from `ceil(log(timeoutMs/retryDelayMs) / log(retryFactor))` so the schedule actually spans the requested timeout window."
  - "tests/lock-conflict.cjs is a `.cjs` file (not `.ts`). Reasoning: the parent test runs under tsx; child_process.spawn invokes raw Node with no tsx loader. A `.ts` helper would require either a tsx loader-hook in the spawn args (fragile across Node versions) or pre-compilation. `.cjs` lets the helper `require('proper-lockfile')` natively and dodges package.json's `\"type\":\"module\"` classification entirely."
  - "tests/lock-conflict.cjs duplicates the `pensmithLockDir()` + `stubFor(resource)` logic instead of importing from bin/lib/lock.ts. The duplication is small (~25 LoC) and avoids the tsx-loader-in-spawn complexity. The test's cross-process timing assertion (parent waited ≥ HOLD_MS - 500ms) catches any drift between the two implementations: if the parent and child compute different stub paths, they would not contend on the same lock and the parent would acquire immediately, failing the timing assertion."
  - "`isLocked()` is non-destructive — calls `lockfile.check(stub, { stale })` which inspects the on-disk lock state without taking it. Used in tests to assert pre/post acquisition state; downstream callers should prefer `withLock`/`tryAcquire` for the actual acquire flow."
  - "Top-level `release(resource)` (separate from the per-acquisition release returned from tryAcquire) re-computes the stub and calls `lockfile.unlock(stub)`. This is for orphaned-lock cleanup ONLY; normal flow uses the per-acquisition release function."
metrics:
  duration: "~25 min wall clock (Task 1 + Task 2 sequential, no checkpoints; one Rule 3 deviation for the eslint exemption widening)"
  duration_minutes: 25
  tasks_completed: 2
  tasks_in_plan: 2
  files_created: 3
  files_modified: 1  # eslint.config.js — Rule 3 deviation
  tests_added: 6
  tests_passing: 65  # full suite, post-commit (59 from prior + 6 new)
  completed: 2026-05-08
---

# Phase 01 Plan 03: lock (D-26 / ARCH-06 cross-process advisory lock) Summary

**One-liner:** Wave 3 lands `bin/lib/lock.ts` as the cross-process advisory lock chokepoint per ARCH-06 / D-26, wrapping `proper-lockfile@^4` via a mandatory `createRequire(import.meta.url)` CJS-shim (the BLOCKING fix from RESEARCH §Key Finding #4) and placing all lock files outside the project tree in `pensmithLockDir()` per D-40. Six tests prove withLock semantics, same-process serialization, and cross-process conflict via a `.cjs` helper spawn.

## Public API (bin/lib/lock.ts)

```ts
export interface LockOptions {
  timeoutMs?: number;     // default 60_000  — max wait to acquire
  staleMs?: number;       // default 45_000  — proper-lockfile stale threshold (1.5x of 30s working TTL)
  retryDelayMs?: number;  // default 100     — initial retry delay
  retryFactor?: number;   // default 1.5     — exponential factor between retries
}

// Acquire, run, release — even if fn throws (try/finally). Primary public API.
export async function withLock<T>(
  resource: string,
  fn: () => Promise<T>,
  opts?: LockOptions,
): Promise<T>;

// Acquire and return a release function. Caller manages release(); prefer withLock().
export async function tryAcquire(
  resource: string,
  opts?: LockOptions,
): Promise<() => Promise<void>>;

// Top-level release — recomputes stub and calls lockfile.unlock().
// Use ONLY for orphaned-lock cleanup; normal flow uses per-acquisition release.
export async function release(resource: string): Promise<void>;

// Non-destructive lock-state check. Returns true if held by this or any process.
export async function isLocked(resource: string): Promise<boolean>;
```

## The createRequire CJS Shim (BLOCKING per RESEARCH §Key Finding #4)

```ts
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const lockfile = require_('proper-lockfile') as typeof import('proper-lockfile');
```

**Why this is non-negotiable:** `proper-lockfile@^4` ships only CommonJS. Under the project's `"type":"module"` package + tsx + node:test combination, `import lockfile from 'proper-lockfile'` raises `ERR_REQUIRE_ESM` immediately on import — every test that touches lock.ts would die before its first assertion. The createRequire pattern was identified during the phase RESEARCH cycle as the only stable workaround in the Node 20.x toolchain.

**The cast is type-only:** `require_('proper-lockfile') as typeof import('proper-lockfile')` — the runtime is a real CJS `require()` call returning the module's exports; the `as typeof import(...)` is a TypeScript type expression that evaluates to the proper-lockfile module's type signature without emitting an ESM import. This survives `verbatimModuleSyntax: true` because nothing of the cast remains at runtime.

**Downstream callers do NOT need this shim:** W10-W13 just `import { withLock } from '../lib/lock.js'` — the CJS-load is isolated to one line in lock.ts.

## Lock-Dir Placement Decision (D-40)

**All locks live in `pensmithLockDir()` — NEVER inside `.paper/`.**

| Platform | pensmithLockDir() |
|----------|-------------------|
| Windows  | `%LOCALAPPDATA%\\pensmith\\locks` |
| macOS    | `~/Library/Application Support/pensmith/locks` |
| Linux    | `$XDG_DATA_HOME/pensmith/locks` (fallback `~/.local/share/pensmith/locks`) |

**Why out-of-tree (CLAUDE.md non-negotiable, D-40):** the dev environment is a OneDrive-synced folder (`OneDrive - Roanoke College/Documents/Github/pensmith`). Cloud sync clients (OneDrive, iCloud, Dropbox, Google Drive) open-delete-recreate files mid-write, which corrupts active lock files. By rooting lock storage in the platform-local data dir (which sync clients do not touch), pensmith's mutual exclusion remains trustworthy regardless of where the user's working tree lives.

**Verified live on the dev box during this run:** the test suite produced 12-hex stub files under `C:\\Users\\akhil\\AppData\\Local\\pensmith\\locks\\` (e.g. `0b7f55f64f22`, `13e13f947a22`, `308ec55d8d92`, ...) and Test 6 confirmed zero `.lock` files inside the project's `.paper/` directory.

## Lock Filename Hashing (T-01-INFO-03)

```ts
const hash = createHash('sha256').update(resource).digest('hex').slice(0, 12);
const stub = path.join(pensmithLockDir(), hash);
// proper-lockfile creates `${stub}.lock` alongside.
```

**Why hash, not raw resource:** resources like `'C:\\\\Users\\\\u\\\\OneDrive\\\\repo\\\\.paper\\\\sections\\\\03-methods'` contain `:`, `\\\\`, and spaces — all of which break Windows lock-filename rules and POSIX shell-quoting expectations. The 12-hex prefix:

1. Survives every filesystem (12 lowercase hex chars are valid everywhere).
2. Is one-way — no resource path leaks into the filesystem (T-01-INFO-03 mitigation).
3. Is collision-free for any reasonable cardinality (2^48 ≈ 281 trillion buckets).
4. Is deterministic — the same resource string always hashes to the same stub.

**Stub-file lifecycle:** the stub is touched-on-demand (`fs.open(stub, 'a')` — create-if-missing without truncating) inside `stubFor(resource)`. proper-lockfile then creates `${stub}.lock` alongside it. Stubs accumulate in `pensmithLockDir()` over time; this is fine — they're 0-byte files, and they serve as the proper-lockfile target for any future re-acquisition of the same resource.

## Tests Added

### `tests/lock.test.ts` (6 tests, 207 LoC)

1. **withLock returns inner value** — `withLock(r, async () => 42) === 42`
2. **withLock releases on inner throw (try/finally proof)** — after a withLock that throws, `isLocked(r) === false`
3. **tryAcquire / release / isLocked roundtrip** — explicit acquire/release, isLocked toggles correctly
4. **Same-process serialization** — two parallel withLock calls on the same resource produce ordered output `['A-start', 'A-end', 'B-start']` (B waits for A's 150ms hold)
5. **Cross-process spawn conflict (TEST-07)** — spawn `tests/lock-conflict.cjs` with `RESOURCE` + `HOLD_MS=1500`; child prints `ACQUIRED <ms>` to stdout; parent then attempts `withLock(...timeoutMs: 10_000)` and asserts `parentWaitMs >= HOLD_MS - 500` (i.e. parent actually waited for child's release). Test execution: parent waited 2.26s — child held 1.5s + ~0.5s helper-process startup overhead, well within bounds.
6. **Lock file lives in pensmithLockDir(), NOT inside .paper/** — acquire a lock, stat that either the stub or the `.lock` file exists under `pensmithLockDir()`, then walk `.paper/` recursively and assert zero `*.lock` files anywhere underneath. (D-40 regression gate.)

### `tests/lock-conflict.cjs` (81 LoC)

Child-process helper for TEST-07. Reads `RESOURCE` + `HOLD_MS` from env, mirrors `pensmithLockDir()` + `stubFor(resource)` from `bin/lib/paths.ts` / `bin/lib/lock.ts` in raw CommonJS, calls `lockfile.lock(stub, { stale: 45_000, retries: 0 })`, prints `ACQUIRED <Date.now()>` to stdout, sleeps `HOLD_MS`, prints `RELEASING <Date.now()>`, releases, exits 0. Errors print `CHILD-ERROR <msg>` and exit 3.

The implementation duplication (vs. importing from bin/lib/lock.ts) is intentional and called out in the file header — see "decisions" frontmatter. The cross-process timing assertion in the test catches drift: any divergence in stub-path computation between parent and child would let both sides acquire simultaneously, and the parent would not wait → assertion fails.

## Quality Gates (Final State)

| Gate | Result |
|------|--------|
| `npm run typecheck` | PASS (0 errors) |
| `npm run lint` | PASS (0 violations) |
| `npm test` | PASS (65/65 tests, including 6 new for this plan) |
| `npm run validate:manifests` | PASS |
| `npm run check` (lint + typecheck + test + validate) | **PASS** |
| Task 1 smoke test (plan `<verify>` block) | PASS — withLock returns value, propagates throw, isLocked toggles correctly |
| Cross-process TEST-07 (parent waits ≥ HOLD_MS - 500ms) | PASS — parent waited 2.26s for child's 1.5s hold |
| D-40 lock-dir verification on the dev box | PASS — 12-hex stubs under `%LOCALAPPDATA%\\pensmith\\locks\\`; zero `.lock` files inside `.paper/` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Widen ESLint CJS exemption to cover tests/**/*.cjs**
- **Found during:** Task 2 (after writing `tests/lock-conflict.cjs`)
- **Issue:** The existing `eslint.config.js` exempts `scripts/**/*.cjs` from `@typescript-eslint/no-require-imports` (added in Phase 0 D-17 for `scripts/validate-plugin-manifest.cjs`). The plan mandates a `.cjs` test helper at `tests/lock-conflict.cjs` — this file uses 5 `require()` calls and would fail `npm run lint` without an exemption. The chosen file extension is non-negotiable per the plan (Step 2.1 sketch + my own decision rationale: child_process.spawn invokes Node directly, with no tsx loader, so the helper must be loadable as raw CJS). Therefore the ESLint exemption MUST extend to cover `tests/**/*.cjs`.
- **Fix:** Extended the existing exemption block from `files: ['scripts/**/*.cjs']` to `files: ['scripts/**/*.cjs', 'tests/**/*.cjs']` and updated the explanatory comment to reference both intended use-cases. This is a minimal, scoped widening of an existing exemption — not a new rule.
- **Files modified:** `eslint.config.js` (one block, +1 glob entry, +6 lines of explanatory comment)
- **Commit:** `b250bb0` (folded into Task 2's commit since it's the same logical unit of work — the test helper requires the exemption to land together)
- **Why this isn't out-of-scope:** the plan's `files_modified` explicitly lists `tests/lock-conflict.cjs`. The eslint.config.js widening is a hard prerequisite for that file to land green; reverting it would make `npm run lint` fail. Per `<deviation_rules>` Rule 3 (Auto-fix blocking issues), this is the right call.

**2. [Minor] Removed two unused `eslint-disable-next-line no-console` comments from `tests/lock-conflict.cjs`**
- **Found during:** Task 2 (lint pass after the exemption widening)
- **Issue:** The project's ESLint config does not have `no-console` enabled, so the disable directives fired as "unused" warnings.
- **Fix:** Replaced the two `eslint-disable-next-line` lines with prose comments explaining why the `console.log` calls are load-bearing (parent's signal channel).
- **Files modified:** `tests/lock-conflict.cjs` (in-line within the new file before commit)
- **Commit:** `b250bb0`

### Architectural Changes

None (Rule 4 not invoked).

### Auth Gates

None.

## Threat-Model Status (PLAN.md `<threat_model>`)

| Threat | Disposition | Status |
|--------|-------------|--------|
| T-01-02 (stale lock from crashed process blocks new acquisitions forever) | mitigate | **mitigated** — `staleMs = 45_000` (1.5x of D-26's 30s working TTL). proper-lockfile auto-recovers locks older than `stale` and lets the next caller take them. Crashed-process recovery is implicit in the stale handling — proper-lockfile's `lockfile.lock(file, { stale })` checks the lock's mtime and force-acquires if past stale. |
| T-01-RACE-02 (two processes call lock.lock() at the same instant) | accept | accepted — proper-lockfile's atomic `mkdir`-then-rename approach makes this race-safe; battle-tested in npm/yarn. The same-process and cross-process serialization tests (Tests 4 + 5) prove the contention path serializes correctly. |
| T-01-INFO-03 (lock filename leaks resource path) | mitigate | **mitigated** — lock filename is `sha256(resource).slice(0,12)`, one-way, no path leakage. Tests 6 confirms the filesystem-side filename is exactly the 12-hex hash. |
| T-01-DOS-02 (attacker creates 10000 fake stub files in pensmithLockDir) | accept | accepted — per-user data dir; only the user's own processes can write there (filesystem ACLs on Windows; user-mode unix permissions on POSIX). DoS would be self-inflicted. |

No new threat surface introduced. (`Threat Flags` section omitted — nothing to declare.)

## Carry-Forward for Wave 4-13

Every Phase 1 library that performs read-modify-write on shared state MUST go through this chokepoint:

```ts
import { withLock } from '../lib/lock.js';

// State writes (W10):
await withLock(`pensmith:state:${projectHash()}`, async () => {
  const state = await loadState();
  state.current_section = 3;
  await saveState(state);  // uses atomicWriteFile under the hood (W2)
});

// Library writes (W11):
await withLock('pensmith:library:global', async () => {
  const lib = await loadLibrary();
  lib.papers.push(newPaper);
  await saveLibrary(lib);
});

// Checkpoint envelope writes (W12):
await withLock(`pensmith:checkpoint:${runId}`, async () => {
  await writeCheckpoint(envelope);
});

// Runtime config writes (W13):
await withLock('pensmith:runtime:config', async () => {
  await saveRuntimeConfig(updatedConfig);
});
```

**Composition with Wave 2 (atomic-write):** lock + atomic-write are orthogonal — lock provides cross-process mutual exclusion (so two processes don't simultaneously read-modify-write the same file with last-write-wins clobbering each other); atomic-write provides per-write crash safety (so a process killed mid-write leaves the target either fully old or fully new). Use both: `withLock(resource, async () => { ... atomicWriteFile(target, data) ... })`.

**Resource string convention** (recommended for W10-W13 to avoid namespace collisions):

```
pensmith:state:${projectHash()}        — per-project STATE.md
pensmith:library:global                — global library index (one per user)
pensmith:checkpoint:${runId}           — per-run checkpoint envelope
pensmith:runtime:config                — runtime config (one per user)
pensmith:section:${projectHash()}:${n} — per-section state (Phase 4+)
```

(Hashes hide the user's actual project path from the filesystem; `projectHash()` is from W1 paths.ts.)

## Self-Check: PASSED

- [x] `bin/lib/lock.ts` exists at the expected path (175 LoC) — verified via `git show 2a5bed4 --stat`
- [x] `tests/lock.test.ts` exists at the expected path (207 LoC) — verified via `git show b250bb0 --stat`
- [x] `tests/lock-conflict.cjs` exists at the expected path (81 LoC) — verified via `git show b250bb0 --stat`
- [x] `bin/lib/lock.ts` contains the literal pattern `createRequire(import.meta.url)` AND `require_('proper-lockfile')` — both present
- [x] `bin/lib/lock.ts` exports `withLock`, `tryAcquire`, `release`, `isLocked` — all four present
- [x] `bin/lib/lock.ts` imports `pensmithLockDir` from `./paths.js` (NodeNext convention from Wave 1)
- [x] Lock-file path is `sha256(resource).slice(0,12)` hash, NOT raw resource string — code review confirms
- [x] Commit `2a5bed4` (Task 1: lock.ts impl) exists in `git log --oneline` — verified
- [x] Commit `b250bb0` (Task 2: tests + eslint exemption widening) exists in `git log --oneline` — verified
- [x] `npm run check` exits 0 — verified above (lint + typecheck + 65-test pass + validate-manifests)
- [x] No modifications to STATE.md, ROADMAP.md, or any file outside this plan's `files_modified` aside from the documented Rule 3 deviation on `eslint.config.js` (the SUMMARY.md is the only file this run adds outside `files_modified` and is the expected output per the plan's `<output>` block)
- [x] Cross-process TEST-07 proven green — child held 1.5s, parent waited 2.26s, assertion `waitMs >= 1000` (HOLD_MS - 500) passes
- [x] D-40 verified live on the dev box: 12-hex stubs landed under `%LOCALAPPDATA%\\pensmith\\locks\\`; zero `.lock` files inside the project's `.paper/`
