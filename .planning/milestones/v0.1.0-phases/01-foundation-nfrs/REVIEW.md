---
phase: 01-foundation-nfrs
reviewed: 2026-05-14T00:00:00Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - bin/lib/paths.ts
  - bin/lib/atomic-write.ts
  - bin/lib/lock.ts
  - bin/lib/doi.ts
  - bin/lib/http.ts
  - bin/lib/retry.ts
  - bin/lib/budget.ts
  - bin/lib/pii.ts
  - bin/lib/session-log.ts
  - bin/lib/state.ts
  - bin/lib/library.ts
  - bin/lib/checkpoint.ts
  - bin/lib/runtime.ts
  - bin/lib/pricing.ts
  - bin/lib/cost-fixture.ts
  - bin/lib/schemas/state.ts
  - bin/lib/schemas/library.ts
  - bin/lib/schemas/checkpoint.ts
  - bin/lib/schemas/session-log.ts
  - bin/lib/schemas/runtime-config.ts
  - bin/lib/migrations/loader.ts
  - bin/lib/migrations/state/v1_to_v2.ts
findings:
  block: 2
  flag: 9
  nit: 6
  total: 17
status: issues_found
---

# Phase 1: Code Review — Foundation NFRs

**Reviewed:** 2026-05-14
**Depth:** standard
**Status:** issues_found

## Summary

Foundation slice is solid in architecture and intent — chokepoint enforcement, schema versioning, redaction pipeline, OneDrive-safe path layout, and the load-INSIDE-the-lock pattern are all present and tested. The no-leak property (T-01-07) is correctly implemented in `runtime.ts` and verified by test 8.

Two correctness gaps merit BLOCKER status: (1) `initState` / `initLibrary` perform a TOCTOU existence check OUTSIDE the lock, making the "refuses to overwrite" contract racy across concurrent processes; (2) the loader's `writeBack` path runs `atomicWriteFile` from `loadState` / `loadLibrary` / `loadRuntimeConfig` without any lock, which is dormant today (no v2 schemas) but will silently activate the first time a forward migration lands and immediately produces a read-vs-write race.

Several FLAGs concern dormant correctness traps (cache envelope is not schema-validated; module-global `chain` in session-log; ModelPrice leaf objects are not deep-frozen) and one Windows-portability footgun in oversize-spill `spilled_to` path separator.

## Critical Issues (BLOCKER)

### BLOCKER-01: TOCTOU race in initState / initLibrary lets concurrent inits clobber each other

**File:** `bin/lib/state.ts:121-145` and `bin/lib/library.ts:147-169`
**Issue:** The existence check via `fs.promises.access(file)` happens BEFORE `withLock` is acquired. Two concurrent `initState` (or `initLibrary`) calls — either same-process awaited racily, or cross-process — can both observe ENOENT, both throw their access-check past, both enter `withLock` sequentially, and both write a fresh seed. The second writer silently clobbers the first (since `atomicWriteFile` does a tmp+rename and POSIX rename atomically replaces the target; `fs.access` doesn't reserve anything).

The "refuses to overwrite an existing STATE.json" contract is therefore not actually enforced under contention — only under sequential single-caller scripts. Test "initState refuses to overwrite an existing STATE.json" in `tests/state.test.ts:55` is a sequential test and does not detect this race.

The library variant has the same shape and the same defect.

**Fix:** Move the existence check INSIDE the lock and rely on `'wx'` (O_EXCL) semantics at the write site, or perform the access check after acquiring the lock:

```ts
await withLock(file, async () => {
  try {
    await fs.promises.access(file);
    throw new StateAlreadyExistsError(`STATE.json already exists at ${file}`);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException | null)?.code;
    if (code !== 'ENOENT') throw e;
  }
  await atomicWriteFile(file, JSON.stringify(seeded, null, 2) + '\n');
});
```

Better: have `atomicWriteFile` expose an `exclusive: true` mode that opens the TARGET with `'wx'` so the rename step fails when the target already exists. That makes the race impossible at the syscall level, not just at the application level.

---

### BLOCKER-02: loader writeBack runs atomicWriteFile without a lock — read-path race becomes active when first v2 migration lands

**File:** `bin/lib/migrations/loader.ts:126-128`, called from `bin/lib/state.ts:172-189` (`loadState`), `bin/lib/library.ts:196-213` (`loadLibrary`), `bin/lib/runtime.ts:181-197` (`readOne`).

**Issue:** `loadAndMigrate` is called by `loadState`, `loadLibrary`, and `loadRuntimeConfig` with `writeBack: true` and NO surrounding `withLock`. The write-back branch (`v !== diskVersion && opts.writeBack === true`) is dormant today because no `v2` schema or migration registry entry exists for these three files — but the moment Phase 2+ lands a `state v1 → v2` migration, `loadState` will start producing disk writes that race:

  - Two concurrent `loadState` callers both migrate the in-memory value, both call `atomicWriteFile` without coordination. `atomicWriteFile` itself is crash-safe but two un-coordinated tmp+rename pairs can interleave with each other AND with a concurrent `saveState` / `updateState` (those DO take the lock, but `loadState`'s writeBack does not).
  - The "Concurrency contract" comment in `state.ts:21-23` claims load+mutate+save is inside a single withLock; the comment is correct only for `updateState`. `loadState` violates the same invariant via the loader's writeBack path.

The race is also live for `loadRuntimeConfig` — `readOne` is called from `loadRuntimeConfig` (also without a lock) AND `saveRuntimeConfig` takes a lock that this read path bypasses.

**Fix:** Wrap the writeBack inside the caller's `withLock`, OR add `lock: true` option to `loadAndMigrate` and acquire it internally for the writeBack step only. The cleanest fix is to take `withLock(file, ...)` around the entire `loadAndMigrate` call in `loadState` / `loadLibrary` / `loadRuntimeConfig.readOne` whenever `writeBack: true`. Alternatively, set `writeBack: false` on the read path and force migrations to write back only via explicit save calls — but that loses the "disk tracks latest version" property the comments claim.

The fact that the v1→v2 migration sample (`migrations/state/v1_to_v2.ts`) exists in-tree and is exercised by `tests/migrations.test.ts:105-132` means the writeBack path IS tested — but only in isolation, never under concurrent reader contention, so the latent race is not caught.

---

## Warnings (FLAG)

### FLAG-01: http.ts readCache does not validate the cache envelope — corrupt-but-parseable JSON returns undefined fields to the caller

**File:** `bin/lib/http.ts:285-309`
**Issue:** `JSON.parse(raw) as CacheEnvelope` is a type assertion, not a runtime check. A cache file that parses as JSON but has the wrong shape (e.g. `{savedAt: '...', response: null}`, or an old envelope format from a previous build) will return an `HttpResponse` with `status: undefined`, `headers: undefined`, `body: undefined`. Downstream callers that do `if (r.status === 200)` would treat this as a miss; callers that read `r.body` get `undefined` and crash on `JSON.parse(r.body)`.

Defense-in-depth elsewhere (state/library/checkpoint/runtime all schema-validate on load) is conspicuously absent here.

**Fix:** Validate the envelope minimally before returning. Either define a zod schema (`CacheEnvelopeSchema`) and `safeParse`, or do a structural check:

```ts
if (
  !parsed ||
  typeof parsed.savedAt !== 'string' ||
  !parsed.response ||
  typeof parsed.response.status !== 'number' ||
  typeof parsed.response.body !== 'string' ||
  !parsed.response.headers ||
  typeof parsed.response.headers !== 'object'
) {
  return null;
}
```

---

### FLAG-02: session-log.ts in-flight chain is module-global — cross-handle pollution

**File:** `bin/lib/session-log.ts:251-255`
**Issue:** `let chain: Promise<void> = Promise.resolve()` is module-scope, shared across EVERY `openSessionLog()` call in the process. Two unrelated loggers (e.g., one paper-scope, one global-scope) serialize through the same chain. If logger A is writing to a slow filesystem (e.g., a tmpfs full-up), logger B's `close()` waits on logger A's chain to drain before resolving. The test `logger swallows fs errors (close never rejects)` swallows errors but does NOT verify cross-handle isolation.

This is also why `setMirrorPromptsToStderr(true)` toggles a module-global — any logger handle anywhere in the process starts mirroring. Tests reset the flag in `finally`, but cross-test pollution is one unhandled error away.

**Fix:** Move `chain` into the closure returned by `openSessionLog`, so each handle has its own serialization queue. The cost is that you can no longer guarantee inter-handle ordering, but that wasn't a contract anyway. Document or remove the module-global mirror flag if it must remain module-scope.

---

### FLAG-03: pricing.ts deep-freeze does not freeze the leaf ModelPrice objects

**File:** `bin/lib/pricing.ts:76-81`
**Issue:** The code freezes the outer record and each inner provider record, but the individual `ModelPrice` value objects (`{inputPerMtok, outputPerMtok, currency}`) are NOT frozen. A consumer can still do `MODEL_PRICES.anthropic['claude-opus-4'].inputPerMtok = 99` and it succeeds silently (under strict mode it would throw only if the provider record were frozen AND the leaf were frozen — currently only the provider record is frozen, which prevents adding/removing model keys but not mutating existing leaf values).

The module header claims "MODEL_PRICES is deeply frozen" and the test `MODEL_PRICES is deeply frozen` only checks `Object.isFrozen(MODEL_PRICES)` and `Object.isFrozen(MODEL_PRICES.anthropic)` — it does not check `Object.isFrozen(MODEL_PRICES.anthropic['claude-opus-4'])`. Test passes but the defense is partial.

**Fix:**
```ts
for (const provider of Object.keys(RAW)) {
  for (const model of Object.keys(RAW[provider]!)) {
    Object.freeze(RAW[provider]![model]);
  }
  Object.freeze(RAW[provider]!);
}
Object.freeze(RAW);
```
And extend the test to assert `Object.isFrozen(MODEL_PRICES.anthropic['claude-opus-4'])`.

---

### FLAG-04: session-log oversize spill — spilled_to uses forward slashes, disk uses path.sep

**File:** `bin/lib/session-log.ts:229`
**Issue:** `const spillRel = \`sessions/${run_id}/${seq}.json\`;` hardcodes `/` separators. On Windows the actual on-disk file is at `path.join(spillRoot, run_id, \`${seq}.json\`)` which uses backslashes. Consumers that read the log line and try to verify the spill file by doing `fs.existsSync(line.spilled_to)` will fail on Windows (the relative path is forward-slash, but they'd need to resolve it relative to the log dir).

The test `D-50 oversize` happens to work because it uses `path.join(pensmithDataDir(), String(line.spilled_to))` and `path.join` normalizes separators — but the regex `^sessions\/[^/]+\/\d+\.json$` in the test ASSERTS forward slashes, which contradicts cross-platform "grep-friendly" framing in the source comment.

**Fix:** Either normalize the on-disk path to use `/` (so log lines are portable across platforms) — write `atomicWriteFile(path.join(spillRoot, run_id, \`${seq}.json\`), ...)` but record `sessions/${run_id}/${seq}.json` with forward slash AS A LOG-ONLY DESCRIPTOR (which is what the current code does), and document explicitly that consumers must `path.join(logDir, spilledTo.replace(/\//g, path.sep))`. Today the doc doesn't say this. The cleaner option: use `path.posix.join` for `spilled_to` and document it as POSIX-style.

---

### FLAG-05: state.ts / library.ts / runtime.ts module-singleton logger captures env at first call — stale across tests

**File:** `bin/lib/state.ts:89-95`, `bin/lib/library.ts:118-124`, `bin/lib/checkpoint.ts:103-109`, `bin/lib/runtime.ts:138-144`
**Issue:** Each module lazily initializes a module-scope `_log` singleton. The doc claims "openSessionLog reads paths.ts at call-time, so this singleton resolves the log destination at first use, not at import" — which is true for the FIRST call. But once `_log` is set, subsequent calls return the cached logger, which holds onto the spillRoot / logFile resolved at first-call time. When tests mutate `process.env.LOCALAPPDATA` between tests and dynamically re-import the module, Node's module cache returns the same module instance and the same already-initialized `_log` — pointing at the FIRST test's tmpdir.

This doesn't break current assertions (they read state/library/checkpoint file contents, not session-log output), but session logs from test 3+ of e.g. `tests/state.test.ts` end up in test 1's tmpdir. That's an observable leak across tests and a maintainability hazard the next time a test wants to assert log content.

**Fix:** Either (a) re-resolve the logger on every call (lose the singleton, accept the extra `openSessionLog` cost per state/library/checkpoint call), or (b) provide a test-only `_resetLoggerForTest()` export like `http.ts:115` does for the WARN-once gate, or (c) document the leak as known-and-accepted and ensure no future test depends on log isolation.

---

### FLAG-06: http.ts cache key includes Authorization-style headers verbatim — caches responses bearing protected data on disk unredacted

**File:** `bin/lib/http.ts:265-278` (cacheKey) and `bin/lib/http.ts:311-322` (writeCache)
**Issue:** `cacheKey` filters only `user-agent` from the headers it hashes; all other headers (including `authorization`, `cookie`, `x-api-key`) participate in the hash. That is correct from a "don't serve another user's response from cache" standpoint. HOWEVER, `writeCache` then writes the FULL response body to a JSON file at `pensmithHttpCacheDir()/${key}.json` — including any sensitive data in the response that the caller had to authenticate to obtain.

Phase 1 has no callers that pass auth headers (verified by repo grep), so this is dormant. But the chokepoint will be used by all Phase 3+ research/citation lookups, and once any of those starts passing an authenticated request, the response body lands on disk unredacted. The `runtime.ts` no-leak property is specifically about api-key VALUES on disk; this is the symmetric leak of api-key-PROTECTED RESPONSE BODIES on disk.

**Fix:** Either (a) skip cache when ANY of the SENSITIVE headers from `pii.ts` are present in `opts.headers` (auth-bearing requests are usually request-specific anyway), or (b) run `redactKeys` over `response.headers` and `redactPii` over `response.body` before writing to cache. (a) is simpler and probably correct for v0.x. Document the chosen path in `http.ts` header.

---

### FLAG-07: runtime.ts loadRuntimeConfig with scope='auto' writes back to BOTH files concurrently when migration runs

**File:** `bin/lib/runtime.ts:268-277`
**Issue:** Auto-mode reads global first, then paper. Both use `readOne` with `writeBack: true`. If a v2 migration is registered (Phase 2+), and BOTH files are at v1 on disk, a SINGLE `loadRuntimeConfig({scope: 'auto', paperRoot})` triggers two writeBacks back-to-back, each unlocked (see BLOCKER-02). Two concurrent `loadRuntimeConfig` calls compound this to four unlocked writes touching two files. The `mergeOverlay` then re-validates the merged shape via `RuntimeConfigSchema.parse` — which is good defense-in-depth — but the disk state on either file is no longer guaranteed consistent.

This is a specific instantiation of BLOCKER-02 worth calling out separately because runtime.ts's read-path is the most-called of the four (every provider api-key resolution calls `loadRuntimeConfig`).

**Fix:** As BLOCKER-02. Additionally, consider caching the loaded RuntimeConfig per-process (with an explicit invalidate-on-save) — runtime config doesn't change mid-process except via `saveRuntimeConfig`.

---

### FLAG-08: paths.ts diacritic regex uses literal combining marks instead of escaped Unicode codepoints

**File:** `bin/lib/paths.ts:189`
**Issue:** `s.normalize('NFKD').replace(/[̀-ͯ]/g, '')` — the character class contains LITERAL combining diacritics (U+0300 through U+036F). The intent is clear from the comment but the source is fragile: any tool that re-encodes the file (Prettier with non-UTF8 settings, a copy-paste through a stripping editor, a git config that normalizes whitespace) can silently break the regex without it failing tests if all test inputs happen to be already-ASCII after the prior `replace` step.

**Fix:** Use explicit Unicode escapes:
```ts
const ascii = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
```
The behavior is identical but the source is robust to encoding-strip tools and reviewable in diff.

---

### FLAG-09: doi.ts ARXIV_NEW regex allows pre-2007 5-digit body but accepts 4-digit body too — undocumented loose match

**File:** `bin/lib/doi.ts:128`
**Issue:** `const ARXIV_NEW = /^(?:arxiv:)?(\d{4}\.\d{4,5}(?:v\d+)?)$/i;` accepts 4 OR 5 digits in the suffix. The new format (YYMM.NNNNN) standardized on 5-digit suffix in 2015 (the 4-digit form existed only briefly during the 2007→2014 transition window). The comment says "NNNNN = 4..5 digits" but the comment in the file header says "arxiv:NNNN.NNNNN[vN]" — the canonical was always 5. Accepting 4 digits means `arxiv:2103.0020` (a 4-digit-suffix nonexistent ID) normalizes to a string that LOOKS like a canonical arxiv ID but cannot be resolved.

This is "loose match" rather than "buggy" — it's a normalizer, not a validator — but the verifier in Phase 7 will rely on these canonicalizations to dedupe citations, and a 4-vs-5-digit drift will produce a citation that the Crossref/arXiv API rejects without surfacing the cause.

**Fix:** Tighten to `\d{4}\.\d{5}` and add a test for the previously-accepted 4-digit form returning null. If the 4-digit historical form is intentional, document the rationale.

---

## Info (NIT)

### NIT-01: normalizePmid length guard `s.length >= 1` is redundant

**File:** `bin/lib/doi.ts:202`
**Issue:** `/^\d+$/.test(s) && s.length >= 1 && s.length <= 9` — `+` requires one-or-more, so `>= 1` is dead. Minor readability nit.

**Fix:** Drop the `>= 1` clause.

---

### NIT-02: paths.ts slugify truncation to 64 chars may produce visually misleading slugs

**File:** `bin/lib/paths.ts:197`
**Issue:** `truncated = trimmed.slice(0, 64).replace(/-+$/, '')` — produces silently-truncated section directories for long titles. No visible warning to the caller. Phase 7+ section-renumber on insert (open question per CLAUDE.md) will compound this if two long titles share a 64-char prefix.

**Fix:** Document in the function doc that truncation is silent (caller must not assume `slugify` is injective). Consider returning `{slug, truncated: boolean}` so callers can warn the user. Out-of-scope for v1.

---

### NIT-03: state.ts / library.ts updateState/addEntry could benefit from a passthrough exists check

**File:** `bin/lib/state.ts:237-264`, `bin/lib/library.ts:271-311`
**Issue:** `updateState` translates loader ENOENT to nothing (re-throws via `loadAndMigrate` failing — but loader doesn't translate ENOENT, so it propagates as a raw `ENOENT` errno). Callers expecting `StateNotFoundError` (as documented for `loadState`) won't get it from `updateState`. The error path is asymmetric between `loadState` (catches+translates) and `updateState` (does not).

**Fix:** Translate ENOENT inside `updateState`'s `loadAndMigrate` catch the same way `loadState` does. Same for `addEntry` in library.ts.

---

### NIT-04: budget.ts totalCost reads entire COSTS.jsonl into memory and parses every line

**File:** `bin/lib/budget.ts:82-109`
**Issue:** `fsp.readFile(file, 'utf8')` then `.split('\n')` then `JSON.parse` per line — fine at 100 records, allocates the whole file at 1M. Out-of-scope per v1 (no perf reviews) but worth noting that `assertBudget` reads the FULL ledger every call.

**Fix:** Out-of-scope (perf). Worth a TODO comment near totalCost so the gotcha isn't forgotten when Phase 7 wires real cost streaming.

---

### NIT-05: lock.ts release(resource) is a footgun — no ownership check

**File:** `bin/lib/lock.ts:135-138`
**Issue:** `release(resource)` calls `lockfile.unlock(stub)` without checking that the current process actually holds the lock. proper-lockfile.unlock throws if it doesn't. The doc says "should ONLY be used for cleanup of orphaned locks held by the current process" but the function makes that invariant impossible to enforce at the call site.

**Fix:** Either (a) remove the export from the public API (callers should always use `tryAcquire`'s returned release fn or `withLock`), or (b) wrap in try/catch that swallows the "not held" error.

---

### NIT-06: pii.ts NAME regex token length cap of 20 lowercase chars is generous

**File:** `bin/lib/pii.ts:51`
**Issue:** `[A-Z][a-z]{1,20}` matches names with up to 21 chars per token. Real surnames exceed this (e.g., "Featherstonehaugh") but the cap was chosen for REDOS defense. Documented as such. The 20-char cap is conservative against REDOS but might miss real names. Tradeoff is deliberate per D-49.

**Fix:** None — the choice is documented. Worth surfacing in PRD §17 open-questions if Phase 7 wants better recall.

---

_Reviewed: 2026-05-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
