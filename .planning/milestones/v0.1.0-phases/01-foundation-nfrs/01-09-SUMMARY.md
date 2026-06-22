---
phase: 01-foundation-nfrs
plan: 09
subsystem: session-log
wave: 9
tags: [logging, telemetry, jsonl, redaction-chokepoint, rotation]
requires:
  - bin/lib/atomic-write.ts (W2 — atomicAppendFile + atomicWriteFile)
  - bin/lib/pii.ts (W8 — redactPii + redactKeys)
  - bin/lib/paths.ts (W1 — paperDir + pensmithDataDir)
provides:
  - bin/lib/session-log.ts (openSessionLog, setMirrorPromptsToStderr, types Kind + SessionLogger + OpenSessionLogOptions)
affects:
  - W10 state.ts — will import openSessionLog and emit state-change records via .event(...)
  - W11 library.ts — will emit library mutation records via .event(...) / .warn(...)
  - W12 checkpoint.ts — will emit checkpoint advance/restore records via .event(...)
  - W13 lock.ts — will emit lock acquire/release records via .event(...)
  - Phase 7 CLI flag --show-prompts wires setMirrorPromptsToStderr(true)
tech-stack:
  added: []
  patterns:
    - "JSONL one-line-one-record per D-49 — record shape `{at, kind, run_id, ...payload}` with payload spread inline (no `ctx`/`msg` wrapper)"
    - "8-kind discriminator union (prompt/response/tool_call/tool_result/cost/event/warn/error) — replay reader (D-53) reconstructs transcript by filtering kind"
    - "run_id from crypto.randomUUID() (D-64 — no `ulid` dep) — generated once per openSessionLog handle, captured in closure, shared by child loggers"
    - "Method-name camelCase → wire-form snake_case mapping for `toolCall`/`toolResult` only — keeps the JS API ergonomic while the persisted form is grep-friendly"
    - "Single in-flight Promise chain serializes appends per handle; `.then(work, work)` ensures one rejection doesn't break the chain"
    - "Redaction order: merge bindings + payload → redactKeys clones structurally → top-level string leaves run through redactPii → emit"
    - "D-50 truncation: oversize records spill the full record via atomicWriteFile to `sessions/${run_id}/${seq}.json`, then a TRUNCATED line carrying head/tail/truncated:true/spilled_to is appended to the main log"
    - "D-51 rotation: 50 MB threshold, 3-backup depth, highest-numbered-first algorithm (unlink .3 first → rename .2→.3 → .1→.2 → current→.1) — Windows-rename safe + ENOENT/EACCES/EPERM swallowed"
    - "D-52 stderr mirror: module-scope flag, defaults false, only kind:'prompt' mirrors, mirror is IN ADDITION to file write, runs synchronously before async append"
    - "All errors swallowed — logger never throws, ever (validated by collide-directory test)"
key-files:
  created:
    - bin/lib/session-log.ts
    - tests/session-log.test.ts
  modified:
    - eslint.config.js (per-file exemption for tests/session-log.test.ts to allow LOCALAPPDATA/XDG_DATA_HOME env-var override — same pattern as tests/http.test.ts)
decisions:
  - "run_id source = crypto.randomUUID() (UUIDv4, D-64). PLAN says D-49 'ULID-like' but RESEARCH §V3 line 972 explicitly accepts UUIDv4. No `ulid` dep added — Node built-in is uniqueness-equivalent for our per-handle identifier (not a secret, no sortable requirement)."
  - "'auto' scope detection: PLAN snippet wraps paperDir(cwd) in try/catch on the assumption it throws when not in a paper. paperDir() does NOT throw — it just joins cwd + '.paper'. Switched to `fs.statSync(candidate).isDirectory()` with try/catch around the stat. Rule 3 deviation (blocking — without this fix the auto-mode would always pick paperDir and write SESSION.log to a non-paper cwd)."
  - "Top-level string redaction only — buildRecord runs redactPii on top-level string leaves of the merged-and-key-redacted record. Nested-object string fields (e.g. `headers.authorization`) are still covered because redactKeys recursively walks the sensitive-key set on the whole tree. Non-sensitive nested strings are intentionally NOT auto-redacted (would corrupt non-PII telemetry like { method: 'POST' })."
  - "Rotation test accepts current-absent OR current<=margin. After the LAST write that triggers rotation, current has been renamed to .1 and there is no subsequent write to re-create it via O_APPEND. Both states are correct."
  - "eslint.config.js exemption added for tests/session-log.test.ts. Without it the test cannot override pensmithDataDir() to land in a per-test tmpdir (it'd write into the developer's real %LOCALAPPDATA%\\pensmith). Same exemption pattern was already in place for tests/http.test.ts / tests/http-cache.test.ts (Wave 5)."
metrics:
  duration: "~30 minutes wall (single-session)"
  completed: 2026-05-08
  tasks: 2
  files_changed: 3 (1 new code + 1 new test + 1 modified eslint config)
  tests_added: 8
  tests_total_passing: 179
  commits: 2 (plus 1 pending for this SUMMARY)
---

# Phase 1 Plan 09: Session Log Summary

JSONL session logger with D-49 record shape, D-50 oversize spillover, D-51 size rotation, D-52 stderr mirror — single chokepoint for all phase-1 logging output. Every emit goes through W8 redaction primitives; no bypass path. 8 method-per-kind API. Logger never throws.

## What was built

**bin/lib/session-log.ts (~330 lines)** — five exports, one module-scope state cell.

| Export | Purpose |
| ------ | ------- |
| `openSessionLog(opts?)` | Returns a SessionLogger. Generates run_id via `crypto.randomUUID()`. Resolves log path per scope. Initializes per-handle seq counter. |
| `setMirrorPromptsToStderr(enabled)` | D-52 module-scope toggle. Phase 7's `--show-prompts` flag will wire this. |
| `type Kind` | Union of 8 wire-form discriminators: `prompt`, `response`, `tool_call`, `tool_result`, `cost`, `event`, `warn`, `error`. |
| `type SessionLogger` | 8 per-kind methods + `child(bindings)` + `close()`. |
| `type OpenSessionLogOptions` | `scope`, `cwd`, `maxBytes`, `maxBackups`, `maxRecordBytes`. All optional. |

**tests/session-log.test.ts (~230 lines)** — 8 tests, all passing.

**eslint.config.js (~15 added lines)** — per-file path-chokepoint exemption for the test file (same pattern as tests/http.test.ts / tests/http-cache.test.ts). The test file legitimately needs to mutate `process.env.LOCALAPPDATA` / `XDG_DATA_HOME` / `HOME` to redirect `pensmithDataDir()` into a per-test tmpdir.

## Final log path resolution per platform

| scope | platform | resolved log file |
| ----- | -------- | ------------------ |
| `'paper'` | any | `<cwd>/.paper/SESSION.log` |
| `'global'` | win32 | `%LOCALAPPDATA%\pensmith\session.log` |
| `'global'` | darwin | `~/Library/Application Support/pensmith/session.log` |
| `'global'` | linux/posix | `$XDG_DATA_HOME/pensmith/session.log` (fallback `~/.local/share/pensmith/session.log`) |
| `'auto'` | any | `<cwd>/.paper/SESSION.log` if `<cwd>/.paper/` exists as a directory; else falls back to the global path on the host platform |

**Filename-case note:** `SESSION.log` (uppercase) for paper-scoped logs is the OnlyDocuments-style convention users see; `session.log` (lowercase) for global-scoped logs follows POSIX convention because the global path lives in OS-managed dirs that users don't typically browse. PLAN must_haves bullet at line 19 explicitly specified this split.

**Spillover root** (D-50 oversize destination): `<root>/sessions/${run_id}/${seq}.json` where `<root>` is the parent of the log file (so paper-scoped spills under `.paper/sessions/...` and global spills under `<pensmithDataDir>/sessions/...`). The `spilled_to` field in the truncated log line stores the path **relative to `<root>`** for grep-friendliness.

## Record shape (D-49) — confirmation

Every line on disk has shape:

```jsonc
{
  "at": "2026-05-08T12:34:56.789Z",
  "kind": "tool_call",
  "run_id": "5b7d…",
  // payload spreads inline below — no `ctx`/`msg` wrapper
  "tool": "Read",
  "input": { ... }
}
```

**Banned legacy field names** — verified absent at top level by both grep on the source and runtime assertion in the D-49 shape test:

- `ts` — D-49 uses `at`
- `level` — D-49 uses `kind`
- `msg` — payload spreads inline
- `ctx` — payload spreads inline

The D-49 shape test in `tests/session-log.test.ts` line ~70 asserts these four field names are `undefined` on every parsed line.

## Method-name → wire-form mapping

| Method (camelCase) | Wire `kind` (on-disk) |
| ------------------ | --------------------- |
| `prompt` | `'prompt'` |
| `response` | `'response'` |
| `toolCall` | `'tool_call'` |
| `toolResult` | `'tool_result'` |
| `cost` | `'cost'` |
| `event` | `'event'` |
| `warn` | `'warn'` |
| `error` | `'error'` |

Two methods get camelCase→snake_case translation (`toolCall`, `toolResult`). The other six are identical. The test "all 8 kind methods emit the matching wire-form discriminator" asserts the full mapping in order.

## Rotation algorithm final form (D-51)

```text
constants:
  MAX_LOG_BYTES = 50 * 1024 * 1024   // 50 MB
  MAX_BACKUPS   = 3

after each successful append:
  st = stat(logFile)
  if st.size <= maxBytes: return
  for i in [maxBackups .. 1]:        // highest-numbered first
    src = (i == 1) ? logFile : `${logFile}.${i-1}`
    dst = `${logFile}.${i}`
    if i == maxBackups:
      try unlink(dst)                // ENOENT swallowed
    try rename(src, dst)             // ENOENT swallowed
```

For maxBackups=3 the rotation sequence is:

1. `unlink .3` (drop oldest)
2. `rename .2 → .3`
3. `rename .1 → .2`
4. `rename current → .1`

Highest-numbered-first ordering is **Windows-rename safe** — Windows rejects a rename whose target exists, so we must clear the highest slot first before shifting. ENOENT/EACCES/EPERM are all swallowed because rotation must never throw. After step 4 the current file is missing; the next emit recreates it via `open(target, 'a')` (W2 atomicAppendFile).

**Disk usage cap:** with maxBackups=3 and maxBytes=50 MB, the worst-case footprint is ~200 MB per log (current up to 50 MB plus three 50-MB backups). Mitigates T-01-LOG-01 (unbounded log growth fills disk).

## Oversize handling final form (D-50)

```text
constants:
  MAX_RECORD_BYTES = 16 * 1024   // 16 KB
  HEAD_TAIL_BYTES  = 4 * 1024    // 4 KB head + 4 KB tail

per emit:
  line = JSON.stringify(record) + '\n'
  if Buffer.byteLength(line, 'utf8') <= MAX_RECORD_BYTES:
    append line to log
    return
  // Oversize path:
  spillFile = `${spillRoot}/${run_id}/${seq}.json`
  atomicWriteFile(spillFile, JSON.stringify(record, null, 2) + '\n')   // best-effort
  truncated = {
    at, kind, run_id,
    head: stringify(payload).slice(0, 4 KB),
    tail: stringify(payload).slice(-4 KB),
    truncated: true,
    spilled_to: `sessions/${run_id}/${seq}.json`
  }
  append truncated as one line
  seq++
```

`seq` is a per-**handle** monotonic counter. Child loggers share the parent counter via the same `seqRef` reference cell — no two spillovers under the same `run_id` collide on `seq`.

The spilled file is built from the **already-redacted** record (the spill happens AFTER `buildRecord` returned a redacted shape). Mitigates T-01-LOG-03 — full payloads on disk go through the same redaction the truncated line did.

## D-52 stderr mirror semantics

- Module-scope flag `mirrorPromptsToStderr` defaults to `false`.
- `setMirrorPromptsToStderr(enabled)` flips it; coerces with `!!enabled`.
- Only records with `kind === 'prompt'` mirror — every other kind silently bypasses the mirror.
- The mirror runs **synchronously, before the async file write enqueues**. This guarantees the user sees the prompt immediately rather than after the queue drains.
- The mirror format is `[prompt ${at} ${run_id}] ${JSON.stringify(record, null, 2)}\n` — pretty-printed JSON for human readability, prefixed with a one-line header containing the timestamp and run_id so multiple concurrent sessions are distinguishable.
- Phase 7 wires the CLI flag `--show-prompts` to call `setMirrorPromptsToStderr(true)`. Phase 1 only ships the setter.

## run_id implementation note (D-64)

Per D-49 the spec says "ULID-like." Per RESEARCH §V3 line 972, `crypto.randomUUID()` is explicitly accepted as a substitute. We use the Node built-in for these reasons:

1. **No new dep.** Phase 1 dep budget per D-64 forbids adding `ulid`.
2. **Uniqueness-equivalent.** UUIDv4 has 122 bits of randomness; collision is astronomically unlikely for a per-process per-handle identifier.
3. **Not a secret.** `run_id` appears in plaintext on disk; no cryptographic property is needed.
4. **Not sortable.** ULID's main advantage is lexicographic sort by time. Pensmith's logs are already chronologically ordered by file position; no sortable property is needed on `run_id` itself.

The decision is documented inline in `bin/lib/session-log.ts` near the `randomUUID()` call.

## Verification

- `npx tsc --noEmit` — clean (0 errors)
- `npm run lint` — clean (0 errors, 0 warnings)
- `node scripts/run-tests.mjs` — **179 tests pass / 0 fail / 0 skip** (was 171 before this plan; +8 new tests)
- Grep-confirmed: no `ts:` / `level:` / `msg:` / `ctx:` field-name occurrences in `bin/lib/session-log.ts`
- Grep-confirmed exports: `openSessionLog`, `setMirrorPromptsToStderr`, `type Kind`, `type SessionLogger`, `type OpenSessionLogOptions` (5 names — `OpenSessionLogOptions` is the trailing one not in the success-criteria list but required for callers to type their own opts)
- Imports confirmed: `node:fs`, `node:path`, `node:crypto`, `./atomic-write.js`, `./pii.js`, `./paths.js` — nothing else

## Test coverage matrix

| Test | D-tag | Covers |
| ---- | ----- | ------ |
| D-49 shape | D-49 | record shape `{at, kind, run_id, ...payload}`; banned `ts`/`level`/`msg`/`ctx` absent; same handle ⇒ same run_id |
| 8 kind methods | D-49 | every method emits matching wire-form discriminator (snake_case for tool_call/tool_result) |
| redaction integration | D-49 / W8 | string field with email → `[REDACTED:EMAIL]`; nested object with authorization header key-redacted |
| D-51 rotation | D-51 | injected maxBytes=1024; .1 exists, .4 absent; current absent OR ≤ ~1KB+512 framing margin |
| D-50 oversize | D-50 | 100 KB payload truncates to ≤16KB line with `truncated:true`/`head`/`tail`/`spilled_to`; spillover JSON contains the full original payload |
| D-52 stderr mirror | D-52 | toggle on; kind:'prompt' mirrors with `[prompt` header; kind:'event' does not mirror; flag reset in finally |
| child bindings | — | child shares parent run_id; bindings carry into every line; child bindings themselves redacted |
| error swallow | T-01-LOG-02 | pre-create directory at log path; close() does not reject |

## Carry-forward notes for downstream waves

**W10 state.ts** — import openSessionLog and call as a singleton OR per-module child. State-change events (workflow position change, decision recorded, blocker added/cleared) emit via `.event({ ... })`. Validation failures via `.warn({ ... })`. Schema migrations via `.event({ kind: 'schema_migrate', from, to })`.

**W11 library.ts** — citation-add / citation-update / citation-remove via `.event({ ... })`. Library validation rejects via `.warn({ ... })`. Library JSON read/write errors via `.error({ ... })`.

**W12 checkpoint.ts** — checkpoint create / restore / clear via `.event({ ... })`. Checkpoint corruption detected via `.warn({ ... })`.

**W13 lock.ts** — lock acquire / release / contention via `.event({ ... })`. Stale-lock cleanup via `.warn({ ... })`. Lock acquisition timeout via `.error({ ... })`.

**Wiring pattern** — preferred form is one logger per top-level entrypoint, then `.child({ module: 'state' })` (or similar) to scope downstream. The child loggers share parent run_id automatically, so all records from one session correlate even when emitted from different modules.

**Cost telemetry** (W?) — model-spend records (token counts × prices) emit via `.cost({ provider, model, input_tokens, output_tokens, cost_usd })`. Aggregation is downstream concern — the logger only persists individual records.

**Phase 7 CLI flag wiring (`--show-prompts`)** — at startup, after parsing argv, call `setMirrorPromptsToStderr(true)` if the flag is present. Then any subsequent `openSessionLog().prompt(...)` call mirrors to stderr in addition to the file write. The toggle is process-global; tests must reset it in `finally`.

## Self-Check: PASSED

- `bin/lib/session-log.ts` exists (verified at HEAD with `git ls-tree`)
- `tests/session-log.test.ts` exists
- Commit `f605207` (feat) found in git log
- Commit `1334691` (test) found in git log
- 179/179 tests pass
- 0 lint errors, 0 typecheck errors
