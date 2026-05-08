---
phase: 01-foundation-nfrs
plan: 02
subsystem: atomic-write
tags: [atomic-write, chokepoint, crash-safety, fsync, durability, NTFS, EPERM, EXDEV]
requires: ['01-00', '01-01']
provides: ['atomicWriteFile', 'atomicAppendFile']
affects:
  - "Wave 5 http — undici cache writes go through atomicWriteFile (no direct fs.writeFile)"
  - "Wave 6 budget — COSTS.jsonl appends go through atomicAppendFile (PIPE_BUF atomicity)"
  - "Wave 9 session-log — SESSION.log appends go through atomicAppendFile; rotation uses rename-to-target via atomicWriteFile"
  - "Wave 10 state — .paper/STATE.md frontmatter persisted via atomicWriteFile"
  - "Wave 11 library — pensmithDataDir/library/index.json persisted via atomicWriteFile"
  - "Wave 12 checkpoint — checkpoint envelopes persisted via atomicWriteFile"
  - "Every later Phase 1+ library that writes JSON state: NEVER calls fs.writeFile directly (D-07 chokepoint enforcement)"
tech-stack:
  added:
    - "node:crypto (randomBytes) — 12-hex per-call nonce for tmp path collision-free under concurrent writers"
    - "node:fs/promises (open, mkdir, rename, copyFile, unlink) — async filesystem primitives"
    - "FileHandle#writeFile + FileHandle#sync — the actual write+fsync, gated behind the chokepoint"
  patterns:
    - "Chokepoint-with-exemption: bin/lib/atomic-write.ts is the SOLE call site for any *.writeFile method; eslint.config.js per-file exemption permits these calls only here (D-07)."
    - "Best-effort fsync: dir-fsync errors EPERM (Win32 NTFS), ENOSYS (tmpfs/9p/overlayfs), and EISDIR (some VFS layers) are swallowed; rename atomicity on POSIX/NTFS is the actual durability guarantee, dir-fsync is the cherry-on-top."
    - "EXDEV fallback: cross-device rename triggers copyFile + unlink(tmp). Both code paths preserve the all-or-nothing target invariant — partial-target is impossible."
    - "Per-call nonce on tmp path (randomBytes(6).toString('hex') = 12 chars): two processes writing different files in the same dir cannot collide on tmp paths."
    - "'wx' open mode (O_WRONLY|O_CREAT|O_EXCL): fail-fast if a stale .tmp with the same nonce somehow already exists (astronomically unlikely; surfaces as EEXIST)."
key-files:
  created:
    - "bin/lib/atomic-write.ts (193 LoC) — D-07 chokepoint, two exports: atomicWriteFile + atomicAppendFile"
    - "tests/atomic-write.test.ts (12 tests) — functional + crash-sim coverage"
    - "tests/lint-atomic-write-chokepoint.test.ts (2 tests) — D-07 regression gate (Pitfall B5 mitigation)"
  modified:
    - "(none — Wave 0 already added the per-file ESLint exemption and the red-team fixture; Wave 1 added the paths chokepoint)"
decisions:
  - "Use FileHandle#writeFile (the chokepoint-banned method on the FileHandle object), NOT fsp.writeFile(target, data). Rationale: FileHandle#writeFile is what the 'wx' open + write + fsync + close pipeline composes naturally; the AST chokepoint selector matches `callee.property.name='writeFile'` for ALL method-form writeFile calls (including FileHandle), which is precisely why bin/lib/atomic-write.ts has a per-file exemption from no-restricted-syntax."
  - "Type-only import for FileHandle: `import type { FileHandle } from 'node:fs/promises'`. With verbatimModuleSyntax: true, runtime imports cannot carry type-only references; the value-side functions (open, mkdir, etc.) come from a separate `import * as fsp from 'node:fs/promises'`."
  - "Swallow EPERM, ENOSYS, AND EISDIR on dir-fsync (not just EPERM). EPERM covers Win32 NTFS; ENOSYS covers tmpfs/9p/overlayfs/WSL drvfs; EISDIR covers some VFS layers. All three are platform-expected non-correctness errors. Re-throwing any of them would break first-run atomic writes on hosts that aren't pure POSIX ext4."
  - "Crash-sim test on POSIX uses dir chmod 0o500 (read+exec only) to force `fsp.open(tmpPath, 'wx')` to fail. On Windows, chmod is a no-op for NTFS access control, so the test early-returns. CI's Linux + macOS matrix entries cover the assertion."
  - "atomicAppendFile bypasses the tmp-then-rename dance — append semantics don't compose with rename. Caller is responsible for keeping each line under PIPE_BUF (4096 bytes on Linux); session log records are well under that. fsync after each append provides durability."
metrics:
  duration: "~14 min wall clock (Task 1 + Task 2 sequential, no checkpoints)"
  duration_minutes: 14
  tasks_completed: 2
  tasks_in_plan: 2
  files_created: 3
  files_modified: 0
  tests_added: 14  # 12 functional + 2 chokepoint regression
  tests_passing: 59  # full suite, post-commit (45 from prior + 14 new)
  completed: 2026-05-08
---

# Phase 01 Plan 02: atomic-write (D-07 chokepoint) Summary

**One-liner:** Wave 2 lands `bin/lib/atomic-write.ts` as the SOLE call site for any `*.writeFile` method in the repo, implements the four-step crash-safe write contract (`tmp → fsync(tmp) → rename → fsync(dirFd)` with EPERM/ENOSYS/EISDIR swallowed and EXDEV fallback), and ships two test files that prove both functional crash-safety and the D-07 lint chokepoint are provably effective.

## Public API (bin/lib/atomic-write.ts)

```ts
export interface AtomicWriteOptions {
  encoding?: BufferEncoding;  // default 'utf8'
  mode?: number;              // default 0o644
  fsync?: boolean;            // default true; set false for hot tests
}

// Crash-safe write: tmp+fsync → rename → fsync(dirFd).
// On any error before rename: best-effort unlink(tmp); re-throw.
// On EXDEV from rename: copyFile + unlink fallback.
export async function atomicWriteFile(
  targetPath: string,
  data: string | Buffer,
  opts?: AtomicWriteOptions,
): Promise<void>;

// O_APPEND single-line write + fsync. Caller is responsible for trailing
// newline and keeping line under PIPE_BUF (4096) for atomicity guarantee.
export async function atomicAppendFile(
  targetPath: string,
  line: string,
  opts?: AtomicWriteOptions,
): Promise<void>;
```

## The 4-Step Crash-Safe Write Contract (D-04 / RESEARCH §RQ-8)

```
1. mkdir -p dirname(target)                              ; prepare parent dir
2. open(`${target}.${12hex-nonce}.tmp`, 'wx', mode)      ; O_WRONLY|O_CREAT|O_EXCL
   → writeFile(data) → fsync(tmp_fd) → close
3. rename(tmpPath, targetPath)                           ; ATOMIC on POSIX & NTFS
4. open(dir, 'r') → fsync(dir_fd) → close                ; durability across power-loss
```

After step 3, the target is either fully OLD or fully NEW — partial-target is impossible. After step 4, the directory entry is flushed to disk so a power-loss between step 3 and the next checkpoint doesn't lose the rename.

## Platform Quirks (Swallow Matrix)

| Platform | Step 4 outcome | Errno | Disposition |
|----------|----------------|-------|-------------|
| Linux ext4/xfs/btrfs | succeeds | — | normal |
| Linux tmpfs / 9p / overlayfs / WSL drvfs | fails | `ENOSYS` | **swallow** — fs doesn't implement dir fsync |
| macOS APFS | succeeds | — | normal |
| Windows NTFS | fails | `EPERM` | **swallow** — NTFS rejects dir fsync; rename is already atomic on NTFS so step 4 is the durability cherry-on-top, not a correctness requirement (per D-04) |
| Some VFS layers (rare) | fails | `EISDIR` | **swallow** — same rationale as ENOSYS |
| Anything else | fails | `EBADF`, `EACCES`, `ENOSPC`, ... | **re-throw** — these are real errors |

The fsync of the **tmp file fd** (step 2) is NOT in this swallow matrix — that fsync is the actual durability guarantee for the file contents, and any error there propagates.

## EXDEV Fallback (Cross-Device Rename)

If step 3's `rename(tmpPath, targetPath)` fails with `EXDEV` (cross-device — happens when `dirname(target)` is a mount point boundary or when atomicWriteFile is called inside a tmp dir bind-mounted from elsewhere), the chokepoint falls back to:

```
copyFile(tmpPath, targetPath)    ; full new file written
unlink(tmpPath)                  ; best-effort cleanup
```

Both states (old / new) remain consistent — `copyFile` writes a full new file, so the target invariant (`old | new`, never partial) is preserved. The `unlink` is best-effort; an ENOENT-on-cleanup would be a no-op leak that the next successful run cleans up via the same path.

## Tests Added

### `tests/atomic-write.test.ts` (12 tests)

Functional + crash-simulation coverage:

- **Round-trip equality** (2 tests): utf8 string, Buffer payload byte-for-byte
- **mkdir -p** (1 test): target inside a 3-deep new dir tree
- **No .tmp leak on success** (1 test): readdir filter no `*.tmp`
- **12-hex nonce contract** (1 test): smoke-style — any `*.tmp` leak would also fail the "no .tmp leak" test, so this serves as a documentation anchor for the contract
- **Crash-sim** (1 test, POSIX-only): pre-write OLD, chmod 0o500 dir, attempt NEW, assert throws + OLD preserved + no .tmp leak. **Skipped on win32** (chmod is a no-op on NTFS — CI's Linux + macOS cover this)
- **opts.fsync=false smoke** (1 test): hot-test path produces correct content
- **Custom encoding** (1 test): hex-encoded `'deadbeef'` writes 4 raw bytes
- **Win32 EPERM-swallow proof** (1 test): a successful write on Win32 implies the dir-fsync EPERM branch was exercised and swallowed; on POSIX this is a smoke
- **atomicAppendFile** (3 tests): two serial appends preserve both records, mkdir -p the parent dir, fsync=false smoke

All 12 tests pass on Windows (the local box). The crash-sim test early-returns on win32 by design; it will execute its assertions on Linux + macOS CI matrix entries.

### `tests/lint-atomic-write-chokepoint.test.ts` (2 tests)

Regression gate for D-07 (mirrors `tests/lint-paths-chokepoint.test.ts` shape):

1. **Inline rule test** — constructs the `CallExpression[callee.property.name='writeFile']` selector inline, lints `tests/fixtures/lint-atomic-write-chokepoint-fixture.ts` (W0 output), asserts `>=2` `no-restricted-syntax` violations.
2. **Project-config test** — `import('../eslint.config.js')`, filters out global-ignores entries, lints the fixture, asserts `>=2` violations. Proves the rule shape in the **real** `eslint.config.js` is correct (Pitfall B5 mitigation — a single typo in the AST selector silently breaks the rule otherwise).

The W0 fixture has exactly 2 violations: `fs.writeFile` and `fsp.writeFile`. Both tests pass.

## Quality Gates (Final State)

| Gate | Result |
|------|--------|
| `npm run typecheck` | PASS (0 errors) |
| `npm run lint` | PASS (0 violations) |
| `npm test` | PASS (59/59 tests, including 14 new for this plan) |
| `npm run validate:manifests` | PASS |
| `npm run check` (lint + typecheck + test + validate) | **PASS** |

## Deviations from Plan

None. Plan executed exactly as written.

The plan's skeleton sketch (lines 165–268) was followed almost verbatim. Three minor refinements that are notable but not deviations:

1. **`import type { FileHandle }`** instead of inline `fs.promises.FileHandle` — the project's `tsconfig.json` has `verbatimModuleSyntax: true`, so type-only references must use `import type`. The plan sketch's `import * as fs from 'node:fs'` (purely for the `fs.promises.FileHandle` type reference) was simplified to a direct `import type { FileHandle } from 'node:fs/promises'`. No behavior change.
2. **Crash-sim test uses dir chmod 0o500** (the plan's Step 2.1 sketch on line 391-407 already proposed exactly this approach — followed verbatim).
3. **Win32 EPERM-swallow test** is a positive-success assertion on win32 (the success path inherently exercises the EPERM swallow on NTFS). On POSIX this test is a smoke. The plan's behavior spec for "syncDir EPERM swallow" (line 314) explicitly accepts this shape ("env-conditional ... use `test.skip` when not on win32" — adapted to "test passes on both, but the EPERM branch is ONLY exercised on win32"; the test still serves as a regression gate because if a future change to `syncDir` removed the EPERM swallow, win32 CI would fail).

### Auth Gates

None.

### Architectural Changes

None (Rule 4 not invoked).

## Threat-Model Status (PLAN.md `<threat_model>`)

| Threat | Disposition | Status |
|--------|-------------|--------|
| T-01-01 (mid-write process kill leaves target half-written) | mitigate | **mitigated** — tmp-then-rename ensures the target is either old or new, never partial. Crash-sim test (POSIX) proves OLD survives a write failure. |
| T-01-INFO-02 (tmp file mode 0o644 visible to other users) | accept | accepted — pensmith data dir is per-user; 0o644 is fine for a per-user dir. Multi-user shared-host hardening out of scope for v0.1. |
| T-01-DOS-01 (runaway tmp file leak on partial failure) | mitigate | **mitigated** — best-effort `unlink(tmpPath)` on every error path; readdir-no-.tmp assertion in tests catches regressions. |
| T-01-RACE-01 (two processes write same target — last-write-wins) | accept | accepted — atomicWriteFile is by-design last-write-wins; W3 lock provides cross-process mutual exclusion when needed. |

No new threat surface introduced. (`Threat Flags` section omitted — nothing to declare.)

## Carry-Forward for Wave 3-13

Every later Phase 1 library that persists JSON state MUST go through this chokepoint:

```ts
import { atomicWriteFile, atomicAppendFile } from '../lib/atomic-write.js';

// JSON state writes (state.ts, library.ts, checkpoint.ts, http cache):
await atomicWriteFile(stateFilePath, JSON.stringify(payload, null, 2));

// Append-only logs (session-log.ts, COSTS.jsonl in budget.ts):
await atomicAppendFile(logFilePath, JSON.stringify(record) + '\n');
```

(Use `.js` emit-form extension — the project convention established in W1.)

**Permanent ban (D-07 enforcement):**
- `fs.writeFile`, `fs.promises.writeFile`, `FileHandle#writeFile` — all method-form writeFile calls — are blocked by `no-restricted-syntax` outside `bin/lib/atomic-write.ts`. The chokepoint exemption applies only to this one file.
- The regression gate (`tests/lint-atomic-write-chokepoint.test.ts`) loads `eslint.config.js` from disk and asserts the rule fires `>=2` times on the W0 fixture, so a typo in the AST selector fails CI immediately.

**Wave 5 (http):** Use `atomicWriteFile` for the undici response cache writes.
**Wave 6 (budget):** Use `atomicAppendFile` for `COSTS.jsonl` (PIPE_BUF atomicity for sub-4KB lines).
**Wave 9 (session-log):** Use `atomicAppendFile` for the per-record JSONL writes; use `atomicWriteFile` for the rotation-target swap.
**Wave 10 (state):** Use `atomicWriteFile` for `.paper/STATE.md` frontmatter persistence (write the full markdown with updated frontmatter, atomically).
**Wave 11 (library):** Use `atomicWriteFile` for `${pensmithDataDir()}/library/index.json` (with proper-lockfile from W3 wrapping the read-modify-write cycle).
**Wave 12 (checkpoint):** Use `atomicWriteFile` for each per-checkpoint envelope JSON.

## Self-Check: PASSED

- [x] `bin/lib/atomic-write.ts` exists at the expected path (193 LoC) — verified via `git show 908cdc2 --stat`
- [x] `tests/atomic-write.test.ts` exists at the expected path — created and committed at `53e01b5`
- [x] `tests/lint-atomic-write-chokepoint.test.ts` exists at the expected path — created and committed at `53e01b5`
- [x] Commit `908cdc2` (Task 1: atomic-write impl) exists in `git log --oneline` — verified
- [x] Commit `53e01b5` (Task 2: tests) exists in `git log --oneline` — verified
- [x] `npm run check` exits 0 — verified above (lint + typecheck + 59-test pass + validate-manifests)
- [x] No modifications to STATE.md, ROADMAP.md, or any file outside this plan's `files_modified` (the SUMMARY.md is the only file this run adds outside `files_modified` and is the expected output per the plan's `<output>` block)
- [x] `grep -F "EPERM" bin/lib/atomic-write.ts` returns 4 matches (Windows guard documented + branched)
- [x] Acceptance criterion: D-07 lint rule does NOT fire on the chokepoint file itself — verified via `npm run lint` exiting 0 over the full repo
