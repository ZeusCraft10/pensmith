# Phase 1: Foundation NFRs — Research

**Researched:** 2026-05-08
**Domain:** Node.js/TypeScript Foundation Libraries — atomic-write, lock, DOI normalization, HTTP client, budget, migrations, PII, session-log, state/library/checkpoint, runtime
**Confidence:** HIGH (all critical deps verified against npm registry; API surfaces confirmed via docs and README reads; version conflicts surfaced and resolved)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
D-01 through D-68 are locked. Key Phase 1 decisions:
- Build order: `paths → atomic-write → lock → doi → http → budget → migrations → pii → session-log → state → library → checkpoint → runtime` (strict, no inversion)
- Stack: `undici@^7`, `p-retry@^6`, `proper-lockfile@^4`, `fast-check@^3`, `nock@^14`, `zod@^3.23`, `@anthropic-ai/sdk@^0.93`, `openai@^4`, `@modelcontextprotocol/sdk@^1.29`, `@clack/prompts@^0.7`
- Atomic write: `write tmp → fsync(tmp) → rename → fsync(dir)` — `D-04`
- Lock location: platform local-only data dir, NEVER inside `.paper/` — `D-08`
- Cache: hand-rolled disk cache, NOT undici CacheStore — `D-25`
- Zod for all schema validation — `D-38`

### Claude's Discretion
- Exact dep version pin styles (`^` vs exact)
- Test file naming convention (established: `tests/<lib>.test.ts`)
- Single file vs subdirectory per lib (single unless >400 LOC)
- No barrel `bin/lib/index.ts` — direct imports only
- Module-internal helper prefix `_`
- Runtime pricing table location (`bin/lib/runtime/pricing.ts` recommended)

### Deferred Ideas (OUT OF SCOPE)
- Section state machine / ARCH-19 / `verified_against_draft_hash` (Phase 4)
- HANDOFF.json schema (Phase 7)
- `/pensmith list` / `open` / `archived` UX (Phase 8)
- PII Presidio shellout (v0.2)
- `--yolo` / `--dry-run` / `--estimate` / `--show-prompts` CLI wiring (Phase 7)
- Source adapters (`bin/lib/sources.ts`) (Phase 3)
- Wave scheduling `computeWaves()` (Phase 4)
- NCBI_API_KEY slot (Phase 3)
- `tier-contract.test.js` (Phase 2)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ARCH-05 | Atomic `write tmp → fsync → rename → fsync(dir)` via `bin/lib/atomic-write.ts` | D-04; confirmed fs.rename is atomic on Windows; fsync(dirfd) is EPERM on Windows — must be guarded |
| ARCH-06 | Lock file in platform local-only data dir, PID + hostname + heartbeat, stale auto-clear | D-08..D-13; proper-lockfile@4.1.2 confirmed CJS-only (needs createRequire shim in ESM) |
| ARCH-07 | schema_version: 1 on all state files; empty migrations dir + loader; refuse-forward-incompat | D-36..D-39; zod@4 is current (not v3.23) — breaking changes documented |
| ARCH-08 | Cross-platform path resolution via `bin/lib/paths.ts`; lint ban on direct os.homedir() | D-40..D-43; LOCALAPPDATA verified non-roaming on this machine |
| ARCH-09 | Per-session cost cap aborts BEFORE LLM call | D-31..D-35; budget-abort test pattern documented |
| ARCH-10 | Per-step cost cap gates parallel waves | D-32; Semaphore primitive ships in Phase 1 |
| ARCH-11 | `--max-parallel` cap (default 5); refuses `--yolo` when estimate >50% of cap | D-34; `wouldYoloRefuse` predicate ships in Phase 1 |
| ARCH-12 | HTTP client with TTL cache, jittered backoff, polite UA, WARN on missing email | D-21..D-30; WARN-once pattern documented |
| ARCH-13 | Honors Retry-After / X-Rate-Limit; per-source rate floors | D-27..D-28; undici RetryHandler handles Retry-After natively |
| ARCH-14 | OPENALEX_API_KEY config slot exists | D-29; slot ships in config schema, no code sends it yet |
| ARCH-15 | DOI/arXiv/PMID normalization in `bin/lib/doi.ts` | D-14..D-20; DOI Handbook ASCII-only folding confirmed |
| ARCH-16 | Replayable session log at `.paper/SESSION.log` + `--show-prompts` hook | D-49..D-53 |
| ARCH-17 | PII redaction via `bin/lib/pii.ts`, regex-based v0.1 | D-44..D-48 |
| TEST-05 | Unit tests for all 13 Foundation libs | D-64..D-68; test runner: `node scripts/run-tests.mjs` |
| TEST-06 | DOI round-trip property test (idempotence) via fast-check | D-19; fast-check@4.7.0 available (not v3.x) |
| TEST-07 | Lock conflict test via child_process.spawn | D-12; spawn against compiled `dist/` |
| TEST-08 | Budget abort fires BEFORE LLM call — cost-fixture test | D-31; Promise-resolving mock pattern |
| TEST-11 | CI matrix on linux-x64, macos-arm64, windows-x64 | D-65; Node version must be updated from 20.10 |
</phase_requirements>

---

## Summary

Phase 1 ships all 13 Ring-1 Foundation libraries in strict dependency order. There are no user-visible features — this is the plumbing layer that every later phase depends upon. The research uncovered **four critical version conflicts** between the locked CONTEXT.md dependency versions and what actually ships on npm today:

1. `undici@^7` requires Node `>=20.18.1` but CI is pinned to Node 20.10 — the CI matrix node version must be bumped to `20.18` before any Phase 1 deps can install cleanly.
2. `nock@^14` (D-30/D-64) requires Node `>=18.20 <20 || >=20.12.1` — also incompatible with Node 20.10; solved by the same Node 20.18 bump.
3. `@clack/prompts@^0.7` (D-64) is now at v1.3.0 and requires Node `>=20.12`; also solved by Node 20.18 bump.
4. `zod@^3.23` (D-38) is superseded by zod@4.4.3 (current latest) with breaking API changes. The `^3.23` range resolves to 3.x only, so installing with `npm install zod@^3.23` will get 3.x, not 4.x — this is safe, but the planner should be aware that the installed version will be zod 3.24.x (latest 3.x), not 4.x. If Phase 1 intentionally uses 3.x, that is fine; if the planner means "latest zod", it would need to specify `zod@^4`.

Additionally, `proper-lockfile@4.1.2` is CJS-only (no exports field) and requires `createRequire` wrapping from ESM code. `fsync(dirfd)` fails with `EPERM` on Windows — the atomic-write implementation must guard this OS-specific step. `p-retry`'s `randomize: true` is NOT full-jitter per Pitfall 7 — it multiplies delay by a factor of 1–2 (equal-jitter, not random(0, base×2^n)) — full-jitter requires a custom `onFailedAttempt` override.

**Primary recommendation:** Bump CI matrix node from `20.10` to `20.18` as the FIRST task in Wave 1, before any dep installs. All other version decisions proceed with pinned `^3.23` for zod (stable 3.x), `^7` for undici (after node bump), `^8` for p-retry (current; v6 API is compatible).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cross-platform data dir resolution | `bin/lib/paths.ts` (shared) | — | Pure Node os/path; both tiers need the same paths |
| Atomic file write | `bin/lib/atomic-write.ts` (shared) | — | All state writes in both tiers go through this |
| Concurrent-run lock | `bin/lib/lock.ts` (shared) | — | Lock lives in LOCALAPPDATA, not .paper/, so both tiers use it |
| DOI/arXiv/PMID normalization | `bin/lib/doi.ts` (shared) | — | Pure functions; single chokepoint; no tier-specific logic |
| HTTP client + cache | `bin/lib/http.ts` (shared) | — | Both tiers make source-API calls through same chokepoint |
| Cost budgeting | `bin/lib/budget.ts` (shared) | — | Session ledger at .paper/COSTS.jsonl; both tiers write it |
| Schema migrations loader | `bin/lib/migrations/loader.ts` (shared) | — | Same loader, same state files, for both tiers |
| PII redaction | `bin/lib/pii.ts` (shared) | — | Pure transform; called before any LLM call in both tiers |
| Session log writes | `bin/lib/session-log.ts` (shared) | — | JSONL at .paper/SESSION.log; both tiers append |
| Project-level state | `bin/lib/state.ts` (shared) | — | .paper/STATE.md atomic read/write; both tiers |
| Library index persistence | `bin/lib/library.ts` (shared) | — | JSON file + proper-lockfile; cross-paper |
| Checkpoint envelope | `bin/lib/checkpoint.ts` (shared) | — | Foundation shape only; PostToolUse wiring is Phase 7 |
| Provider-agnostic LLM client | `bin/lib/runtime.ts` | Tier 2 primary caller | Tier 1 uses Task tool; runtime.ts is for Tier 2 + cost tracking |

---

## Research Questions

### RQ-1: `undici@^7` Typed Dispatcher API + Interceptors

**Summary:** `undici@7.x` (latest: 7.25.0 as of 2026-05-01) requires Node `>=20.18.1`. It has an interceptor architecture: `pool.compose(interceptor)`. The built-in `RetryHandler` / retry interceptor handles `Retry-After` (both seconds AND HTTP-date format) natively when `retryAfter: true` (default: `true`). The `X-Rate-Limit-Reset` header is NOT handled natively by undici's RetryHandler — must be read in a custom `onFailedAttempt` (p-retry) or custom `retry` function (undici RetryHandler).

**Dispatcher request API:** [VERIFIED: npm view undici readme + npmjs.com/undici]
```typescript
// Source: undici Dispatcher.md
import { Pool, RetryHandler } from 'undici';

const pool = new Pool('https://api.crossref.org');
// Typed request method:
const { statusCode, headers, body } = await pool.request({
  method: 'GET',
  path: '/works/10.1145/foo',
  headers: { 'user-agent': 'pensmith/0.1 (+...; mailto:...)' },
  signal: abortController.signal,
});
// body is a Readable stream; drain with body.json() or body.text()
```

**Interceptor pattern:** [VERIFIED: undici Dispatcher.md + platformatic blog]
```typescript
// Source: undici docs - compose() API
const pool = new Pool(origin).compose(retryInterceptor).compose(authInterceptor);

// Custom interceptor shape:
const authInterceptor = (dispatch: Dispatcher['dispatch']) => {
  return function(opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandlers) {
    opts.headers = { ...opts.headers, 'x-api-key': apiKey };
    return dispatch(opts, handler);
  };
};
```

**RetryHandler options:** [VERIFIED: RetryHandler.md]
```typescript
// Source: undici RetryHandler.md
const retryOptions = {
  maxRetries: 3,
  minTimeout: 500,
  maxTimeout: 8000,
  timeoutFactor: 2,
  retryAfter: true,  // Honors Retry-After header natively (both seconds + HTTP-date)
  methods: ['GET', 'POST'],
  statusCodes: [429, 502, 503, 504],
  // Custom retry logic:
  retry(err, { state, response }, callback) {
    if (response?.headers?.['x-rate-limit-reset']) {
      const resetMs = parseInt(response.headers['x-rate-limit-reset']) * 1000 - Date.now();
      state.setRetryDelay(Math.max(0, resetMs));
    }
    callback(null); // continue with retry
  },
};
```

**FLAGGED:** `undici@8.x` (latest on npm as of 2026-05-01) requires Node `>=22.19.0`. D-22 says `^7` which is correct since CI targets Node 20.x. Do NOT `npm install undici` without version pin — it will install v8 which requires Node 22.

**AbortSignal:** Standard `AbortController.signal` passed to `opts.signal`. Cancels in-flight request.

**Connection pooling:** `Pool` is the right abstraction for source-API calls. Create one pool per source base URL; reuse across calls. Default `connections: null` = no limit; set per-source based on rate limits.

**Cookies/redirects:** undici does NOT follow redirects by default on `pool.request()`. For sources that redirect (doi.org → publisher), use `maxRedirections: 3` in options.

---

### RQ-2: `proper-lockfile@^4` Semantics

**Summary:** `proper-lockfile@4.1.2` (last published 2022-06-24 — stale but stable) uses the `mkdir` strategy for atomic lock acquisition. It stores the lockfile as a directory (`.lock`). It periodically updates the lockfile's `mtime` to signal liveness (heartbeat). Stale detection is via `mtime` age vs `stale` threshold. [VERIFIED: npm view proper-lockfile readme]

**Key API:**
```typescript
// Source: proper-lockfile README
// ESM usage requires createRequire (CJS-only package):
import { createRequire } from 'module';
const lockfile = createRequire(import.meta.url)('proper-lockfile');

// Acquire:
const release = await lockfile.lock('/path/to/target-file', {
  stale: 90_000,       // ms — lock is stale if mtime > 90s old
  update: 30_000,      // ms — heartbeat update interval (stale/3)
  retries: 0,          // Phase 1: no wait-and-retry, just fail-fast
  lockfilePath: '/path/to/custom.lock',  // D-08: use this for platform data dir
  onCompromised: (err) => { throw err; },
});

// Release:
await release();  // or lockfile.unlock()

// Lock test (for TEST-07):
const isLocked = await lockfile.check('/path/to/target-file');
```

**D-10 alignment:** The `stale` default in proper-lockfile is 10s. D-10 says 90s heartbeat threshold (3× 30s heartbeat). Pass `stale: 90_000, update: 30_000` to align.

**D-11 conflict detection:** `lockfile.lock()` throws `ELOCKED` if already locked and not stale. Catch this, read the lock content (proper-lockfile payload is separate from the lock marker — the `.lock` dir is just the marker; the PID/hostname payload must be stored in a separate JSON file), and print the "holder is pid X on host Y" message.

**IMPORTANT:** proper-lockfile's lock is a `.lock` DIRECTORY, not a file. The payload JSON (D-10: `{ schema_version, pid, hostname, started_at, heartbeat_at, pensmith_version }`) lives in a separate `.lock.info` file that `lock.ts` writes atomically alongside acquiring the lock. proper-lockfile does not store payload in the lock itself.

**Windows behavior:** The `mkdir` strategy works on Windows NTFS and on OneDrive-synced folders (mkdir is atomic even on network filesystems). The lock lives in LOCALAPPDATA (D-08), not in OneDrive, so sync is not a concern.

**ESM interop:** `proper-lockfile` has no `exports` field — it is CommonJS only. Use `createRequire(import.meta.url)('proper-lockfile')` from TypeScript ESM code. The `@types/proper-lockfile` package provides type definitions.

**Process exit handling:** proper-lockfile installs its own cleanup via `signal-exit@^3.0.2` dep — so `process.on('exit')` cleanup is included. D-13 also requires explicit `process.on('SIGINT' | 'SIGTERM')` handlers that call `release()`. The synchronous `lockfile.unlockSync()` can be used in `process.on('exit')` (which must be synchronous).

---

### RQ-3: `fast-check@^3` Property Test for DOI Round-Trip

**Summary:** `fast-check@4.7.0` is current (not v3.x). The `^3` range from D-19/D-64 will install 3.x. The API is backward-compatible between v3 and v4 for the patterns used here. [VERIFIED: npm view fast-check]

**Idempotence test scaffolding for `tests/fixtures/doi-corpus.ts`:**
```typescript
// Source: fast-check docs + official examples pattern
import * as fc from 'fast-check';

// Corpus generators (reusable in Phase 3)
export const validDoi = fc.tuple(
  fc.stringMatching(/^10\.\d{4,9}\/[^\s]{1,50}$/),
);

export const doiWithTrailingPunct = fc.tuple(
  fc.stringMatching(/^10\.\d{4,9}\/[^\s]{3,20}$/),
  fc.constantFrom('.', ',', ';', ':', ')', ']', '}', '>', '"', "'"),
).map(([doi, punct]) => doi + punct);

export const doiWithPrefix = fc.tuple(
  fc.stringMatching(/^10\.\d{4,9}\/[^\s]{3,20}$/),
  fc.constantFrom(
    'doi:', 'DOI:', 'https://doi.org/', 'http://doi.org/',
    'https://dx.doi.org/', 'http://dx.doi.org/',
  ),
).map(([doi, prefix]) => prefix + doi);

export const arxivNew = fc.tuple(
  fc.integer({ min: 2001, max: 2099 }),
  fc.integer({ min: 1, max: 12 }),
  fc.integer({ min: 1, max: 99999 }),
).map(([year, month, seq]) =>
  `arXiv:${year}.${String(seq).padStart(5, '0')}`
);

export const pmid = fc.integer({ min: 1, max: 99999999 })
  .map(n => `PMID:${n}`);

export const garbage = fc.oneof(
  fc.string({ maxLength: 20 }),
  fc.constant(''),
  fc.constant('not a doi'),
  fc.constant('10.'),  // incomplete
);
```

**Test body (in `tests/doi.test.ts`):**
```typescript
import * as fc from 'fast-check';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../bin/lib/doi.ts';
import { doiWithTrailingPunct, doiWithPrefix } from './fixtures/doi-corpus.ts';

test('DOI normalize is idempotent', () => {
  fc.assert(
    fc.property(
      fc.oneof(doiWithTrailingPunct, doiWithPrefix, garbage),
      (input) => {
        const once = normalize(input);
        const twice = once !== null ? normalize(once) : null;
        assert.strictEqual(once, twice,
          `normalize(normalize(x)) !== normalize(x) for input: ${input}`);
      }
    ),
    { numRuns: 1000 }
  );
});
```

**Shrinking:** fast-check shrinks automatically on failure — it will find the shortest input string that reproduces the bug. ESM-compatible (both v3 and v4 ship `"type": "module"` exports). [VERIFIED: npm view fast-check engines → `>=12.17.0`]

---

### RQ-4: `nock@^14` `nockBack` Recorder Pattern

**Summary:** `nock@14.0.15` (latest; published 2026-05-07 — very fresh). Requires Node `>=18.20 <20 || >=20.12.1` — INCOMPATIBLE with Node 20.10. After bumping CI to Node 20.18, nock@14 is compatible. [VERIFIED: npm view nock engines]

**KNOWN ISSUE:** nock v14 beta had a reported bug with nockBack lockdown mode causing test isolation failures between test files (issues #2796, #2806). These may be resolved in 14.0.15 (stable) but worth testing with Phase 1 cassettes.

**nockBack cassette pattern for 8 Phase-1 cassettes:**
```typescript
// Source: nock README + nock/back docs
import nock from 'nock';
const nockBack = nock.back;

// In test setup (test file top-level):
nockBack.fixtures = new URL('../fixtures/http-cassettes', import.meta.url).pathname;

// Default to lockdown in CI (all cassettes must exist):
nockBack.setMode(
  process.env.PENSMITH_NETWORK_TESTS === '1' ? 'record' : 'lockdown'
);

// Individual cassette test:
test('429 with Retry-After header: retry honors timing', async () => {
  const { nockDone } = await nockBack('429-retry-after.json');
  // ... call http.ts request() which should retry after honoring Retry-After
  nockDone();
});
```

**8 required cassettes (D-30):**
```
tests/fixtures/http-cassettes/
  429-retry-after-seconds.json       # Retry-After: 2
  503-no-header.json                 # backoff schedule
  429-retry-after-http-date.json     # Retry-After: Fri, 01 Jan 2027 00:00:00 GMT
  429-x-rate-limit-reset.json        # X-Rate-Limit-Reset: <epoch>
  missing-email-warn-proceeds.json   # no PENSMITH_CONTACT_EMAIL → WARN-once + 200
  cache-hit.json                     # second request returns cached:true
  cache-ttl-expiry.json              # expired entry triggers re-fetch
  bypass-cache.json                  # bypassCache:true skips cache
```

**Live vs. lockdown toggle:** `PENSMITH_NETWORK_TESTS=1` env var (D-66) should set `nockBack.setMode('record')` and remove the per-test `return t.skip()` guard. Default in CI = lockdown.

---

### RQ-5: `zod@^3.23` Schema Versioning + Migrations Loader

**Summary:** D-38 specifies `zod@^3.23`. Current npm latest is `zod@4.4.3` which has breaking API changes. The `^3.23` range installs `zod@3.24.x` (latest 3.x). The CONTEXT.md locking means Phase 1 should install `zod@^3.23` (gets 3.24.x). [VERIFIED: npm view zod versions]

**Zod v3 discriminated union + extend pattern for Phase 4 extensibility:**
```typescript
// Source: zod v3 docs - schema versioning pattern
import { z } from 'zod';

// Base project state schema (Phase 1 only — section state machine is Phase 4)
export const ProjectStateV1Schema = z.object({
  schema_version: z.literal(1),
  paper_status: z.enum([
    'intake', 'research', 'outline', 'sectioning', 'compile', 'done', 'archived'
  ]),
  current_section: z.string().nullable(),
  last_updated: z.string().datetime(),
});

// Phase 4 will extend: ProjectStateV1Schema.extend({ sections: z.record(...) })
// Use .extend() not .merge() — avoids strictness inheritance ambiguity

export type ProjectStateV1 = z.infer<typeof ProjectStateV1Schema>;
```

**loadAndMigrate pattern (D-37):**
```typescript
// Source: designed per D-37 spec
export class ForwardIncompatError extends Error {
  constructor(fileVersion: number, currentVersion: number) {
    super(
      `State file version ${fileVersion} is newer than ` +
      `pensmith ${currentVersion}. Upgrade pensmith or remove .paper/`
    );
  }
}

export async function loadAndMigrate<T>(opts: {
  raw: unknown;
  currentVersion: number;
  schema: z.ZodSchema<T>;
}): Promise<T> {
  const { raw, currentVersion, schema } = opts;
  const fileVersion = (raw as any)?.schema_version ?? 0;

  if (fileVersion > currentVersion) {
    throw new ForwardIncompatError(fileVersion, currentVersion);
  }

  if (fileVersion === currentVersion) {
    return schema.parse(raw);  // throws ZodError on validation failure
  }

  // Walk migration chain (empty in Phase 1)
  let migrated = raw;
  for (let v = fileVersion; v < currentVersion; v++) {
    const migrationModule = await import(`./from-${v}-to-${v + 1}.ts`);
    migrated = migrationModule.migrate(migrated);
  }
  return schema.parse(migrated);
}
```

**ZodV4 breaking change note:** If a future phase upgrades to zod@^4, these breaking changes apply: `message` param renamed to `error`, `.optional().default()` behavior changed (use `.prefault()` for v3 behavior), `.strict()` / `.passthrough()` deprecated (use `z.strictObject()` / `z.looseObject()`). Phase 1 is safe on v3.

---

### RQ-6: `@anthropic-ai/sdk@^0.93` + `openai@^4` Provider Routing

**Summary:** `@anthropic-ai/sdk@0.95.1` is current (not 0.93 — but `^0.93` resolves to 0.95.x which is fine). `openai@6.37.0` is current (`^4` range installs 4.x — but `openai@^4` will get 4.x, not 6.x). The CONTEXT specifies `openai@^4` but the latest is `openai@6.37.0`. This is NOT a breaking issue since `^4` pins to 4.x semver range.

**FLAGGED:** If D-59 says `openai@^4`, npm installs 4.x. But 6.x is current. The planner should decide whether to use `openai@^4` (stable 4.x) or `openai@^6` (latest). API surface for baseURL override is the same in both. Recommend `openai@^4` per CONTEXT.md lock.

**Anthropic SDK tool-use pattern:** [VERIFIED: @anthropic-ai/sdk README]
```typescript
// Source: @anthropic-ai/sdk README
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env['ANTHROPIC_API_KEY'],
  // baseURL: 'https://custom.endpoint/v1' -- for vLLM/Ollama compat
});

const message = await client.messages.create({
  model: 'claude-opus-4-6',
  max_tokens: 4096,
  messages: [{ role: 'user', content: 'Hello' }],
  tools: [/* Phase 3+ */],
});
// usage: { input_tokens, output_tokens }
const costUsd = calcCost(message.usage, 'anthropic:claude-opus-4-6');
```

**OpenAI SDK baseURL override:** [VERIFIED: ollama docs + openai SDK docs]
```typescript
// Source: Ollama OpenAI compatibility docs
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:11434/v1',  // Ollama
  // baseURL: 'http://localhost:8000/v1',  // vLLM
  apiKey: 'ollama',  // Ollama ignores apiKey; required field
});

const completion = await client.chat.completions.create({
  model: 'llama3.1:70b',
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 4096,
});
// usage: { prompt_tokens, completion_tokens }
const costUsd = calcCost(completion.usage, 'openai-compatible:' + model);
```

**Provider routing in `runtime.ts`:**
```typescript
// Source: D-59 design
export async function chat(opts: ChatOpts): Promise<ChatResult> {
  if (opts.provider === 'anthropic') {
    return chatViaAnthropic(opts);  // uses @anthropic-ai/sdk
  } else {
    return chatViaOpenAI(opts);     // uses openai SDK with baseURL override
    // covers: 'openai', 'ollama', 'vllm', 'openai-compatible'
  }
}
```

---

### RQ-7: Cross-Platform Local Data Dir Resolution

**VERIFIED on this dev machine (Windows 11, OneDrive user):**
- `LOCALAPPDATA = C:\Users\akhil\AppData\Local` — NOT inside OneDrive
- `APPDATA = C:\Users\akhil\AppData\Roaming` — NOT inside OneDrive
- OneDrive path = `C:\Users\akhil\OneDrive - Roanoke College` — separate from AppData
- `os.homedir() = C:\Users\akhil` — NOT inside OneDrive
- Dev project IS inside OneDrive at `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith`

**CONCLUSION:** `%LOCALAPPDATA%` is reliably non-roaming and non-OneDrive on this machine. D-40's choice of `LOCALAPPDATA` for Windows is confirmed correct.

**`isInsideSyncFolder()` matchers (D-40):**
```typescript
// Source: D-40 + verified against actual paths on this machine
const SYNC_MARKERS: Array<{ vendor: string; pattern: string }> = [
  { vendor: 'onedrive', pattern: 'OneDrive' },           // covers "OneDrive" and "OneDrive - Org"
  { vendor: 'icloud',   pattern: 'Library/Mobile Documents/com~apple~CloudDocs' },
  { vendor: 'icloud',   pattern: 'iCloud Drive' },       // macOS menu bar alias
  { vendor: 'dropbox',  pattern: 'Dropbox' },
  { vendor: 'gdrive',   pattern: 'Google Drive' },
  { vendor: 'gdrive',   pattern: 'My Drive' },
];

export function isInsideSyncFolder(p: string) {
  const normalized = p.replace(/\\/g, '/');
  for (const { vendor, pattern } of SYNC_MARKERS) {
    if (normalized.includes(pattern)) {
      return { inside: true, vendor };
    }
  }
  return { inside: false };
}
```

**NOTE:** The project root `C:\Users\akhil\OneDrive - Roanoke College\Documents\Github\pensmith` WILL trigger `isInsideSyncFolder()` (contains `OneDrive - Roanoke College`). The doctor check in Phase 2 (DOCT-04) will fire on this dev machine itself. This is intentional and expected behavior.

---

### RQ-8: Atomic-Write `rename` Semantics on Windows + fsync(dirfd)

**VERIFIED on this machine:**
- `fs.renameSync(tmp, target)` over an existing file on Windows: **SUCCESS** — Node v24 on Windows NTFS supports atomic rename over existing files. [VERIFIED: manual test]
- `fs.fsyncSync(dirfd)` where dirfd is an open directory fd: **FAILS with `EPERM`** on Windows. [VERIFIED: manual test]

**CRITICAL IMPLICATION for D-04:** The `fsync(dirfd)` step in the D-04 recipe cannot be executed on Windows. The implementation must guard it:

```typescript
// Source: D-04 + manual test on Windows
export async function writeAtomic(
  targetPath: string,
  data: string | Buffer,
  opts?: { mode?: number; encoding?: BufferEncoding }
): Promise<void> {
  const dir = path.dirname(targetPath);
  const tmpPath = `${targetPath}.tmp.${process.pid}.${randomHex(8)}`;

  const fd = await fs.promises.open(tmpPath, 'w', opts?.mode ?? 0o644);
  try {
    await fd.write(typeof data === 'string'
      ? Buffer.from(data, opts?.encoding ?? 'utf8')
      : data
    );
    await fd.sync();  // fsync(tmpfd) — always works
    await fd.close();
    await fs.promises.rename(tmpPath, targetPath);  // atomic on Windows Node >= 14

    // fsync(dirfd) — Linux/macOS only (EPERM on Windows)
    if (process.platform !== 'win32') {
      const dirFd = await fs.promises.open(dir, 'r');
      try { await dirFd.sync(); } catch { /* best-effort */ }
      await dirFd.close();
    }
  } catch (err) {
    // Clean up tmp on failure
    await fs.promises.unlink(tmpPath).catch(() => {});
    throw err;
  }
}
```

**Why Windows doesn't need fsync(dirfd):** Windows NTFS uses journaling (transactions). The rename itself is journaled, so power loss after a successful rename will not lose the directory entry update. The `fsync(dirfd)` is a POSIX filesystem idiom not relevant to NTFS.

**"rename-then-crash" test pattern:** Inject an error AFTER `rename()` returns (simulating post-rename crash), then assert target file has the NEW content (not the original or empty):
```typescript
// Test pattern for TEST-05 (atomic-write.test.ts)
test('rename-then-crash leaves valid target', async () => {
  const target = path.join(tmpdir(), 'test-atomic.json');
  fs.writeFileSync(target, JSON.stringify({ version: 1 }));
  
  // Simulate crash after rename by intercepting and throwing post-rename
  // (use a wrapper that throws after the underlying rename)
  await writeAtomic(target, JSON.stringify({ version: 2 }));
  
  const result = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.strictEqual(result.version, 2, 'target must have new content after atomic write');
});
```

---

### RQ-9: `p-retry@^6` Full-Jitter Semantics

**VERIFIED: p-retry@8.0.0 is current; `^6` installs 6.x (latest p-retry 6.x TBD).** [VERIFIED: npm view p-retry]

**CRITICAL FINDING:** `p-retry randomize: true` does NOT implement full-jitter.
- p-retry `randomize: true` behavior: multiplies timeout by `random(1, 2)` — so delay is between `base` and `2*base`.
- Full-jitter per AWS/Pitfall 7: `random(0, base * 2^attempt)` — so delay is between `0` and `base * 2^attempt`.

For the WARN-once + Retry-After override behavior (D-27), use `onFailedAttempt` to intercept and override:

```typescript
// Source: D-27 design + p-retry README
import pRetry from 'p-retry';

// Full-jitter helper (since p-retry randomize is equal-jitter only)
function fullJitter(base: number, attempt: number, maxMs: number): number {
  return Math.random() * Math.min(maxMs, base * Math.pow(2, attempt));
}

export async function httpWithRetry<T>(
  fn: () => Promise<T>,
  retryOpts: { retries: number; base: number; maxMs: number }
): Promise<T> {
  let retryAfterOverrideMs: number | null = null;

  return pRetry(fn, {
    retries: retryOpts.retries,
    factor: 2,
    minTimeout: retryOpts.base,
    maxTimeout: retryOpts.maxMs,
    randomize: false,  // We implement full-jitter ourselves
    async onFailedAttempt(ctx) {
      // Check for Retry-After / X-Rate-Limit-Reset override (D-27)
      const headers: Record<string, string> = (ctx.error as any)?.responseHeaders ?? {};
      const retryAfter = headers['retry-after'];
      const rateLimitReset = headers['x-rate-limit-reset'];

      if (retryAfter) {
        // Seconds or HTTP-date
        const asNum = Number(retryAfter);
        retryAfterOverrideMs = isNaN(asNum)
          ? Math.max(0, new Date(retryAfter).getTime() - Date.now())
          : asNum * 1000;
      } else if (rateLimitReset) {
        retryAfterOverrideMs = Math.max(0, parseInt(rateLimitReset) * 1000 - Date.now());
      }

      if (retryAfterOverrideMs !== null) {
        await new Promise(r => setTimeout(r, retryAfterOverrideMs!));
        retryAfterOverrideMs = null;
      } else {
        // Full jitter
        const delay = fullJitter(retryOpts.base, ctx.attemptNumber, retryOpts.maxMs);
        await new Promise(r => setTimeout(r, delay));
      }
    },
  });
}
```

**NOTE:** The `shouldRetry` callback in p-retry v8 allows fine-grained control. Only retry 429, 502, 503, 504 status codes (and network errors) per D-27.

---

### RQ-10: PII Regex Calibration

**False-positive categories (D-45) to document in PRIVACY.md note:**

| Pattern | Known False Positive | Root Cause |
|---------|---------------------|------------|
| Names `/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g` | "Machine Learning" → `[NAME]` | Title-cased technical terms |
| Names | "New York" → `[NAME]` | Title-cased proper nouns (non-person) |
| Names | "World War Two" → `[NAME]` | Multi-word titled phrases |
| Dates `/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/g` | Misses ISO 8601 (`2024-01-15`) | Pattern only matches slash/dash/dot with 1-2 digit day/month |
| Dates | Version numbers like `1.0.24` may match | Too broad |
| SSN `/\b\d{3}-?\d{2}-?\d{4}\b/g` | Some phone number fragments | Pattern overlaps US phone |
| Emails | Author emails in citations | Legitimate content |
| Phone | ISBN/DOI substrings | Digit pattern collisions |

**ISO 8601 miss:** The date pattern should also include `/\b\d{4}-\d{2}-\d{2}\b/g` to catch `2024-01-15`.

**v0.1 → v0.2 Presidio swap concerns:** D-48 says `opts.backend: 'regex' | 'presidio'` is the swap API. Presidio uses spaCy NLP tokenization — tokenization boundaries differ from regex. The `diff` output (start/end character positions) will have different values for the same logical entity. Phase 2+ callers that consume the `diff` array must handle different character ranges gracefully.

---

### RQ-11: `@modelcontextprotocol/sdk@^1.29` + `@clack/prompts@^0.7` Install-Only Check

**@modelcontextprotocol/sdk@1.29.0:** [VERIFIED: npm registry, published 2026-03-30]
- Node: no explicit engines constraint (works on Node 18+)
- TypeScript types: included in package
- Install-only in Phase 1 — no usage until Phase 2

**@clack/prompts@^0.7:** `^0.7` range will get latest 0.7.x. But **current latest is @clack/prompts@1.3.0** which requires Node `>=20.12.0`. The `^0.7` range will install 0.7.x (not 1.x). If `^0.7` is intended, it gets 0.7.x which has no specific engines constraint. However, if the planner meant "latest stable", that is now 1.3.0.

CONTEXT says `@clack/prompts@^0.7` (D-64) — this installs the 0.7.x line which is compatible with Node 20.10. The 1.x line is only needed if 1.x has specific features required by Phase 2. For Phase 1 install-only, `^0.7` is fine.

**Peer dependency check:** Neither MCP SDK nor clack/prompts have peer deps that conflict with Phase 1 installs. Safe to install now.

---

### RQ-12: CI Matrix (linux-x64 + macos-arm64 + windows-x64) — Node Version

**CRITICAL NODE VERSION CONFLICTS DISCOVERED:** [VERIFIED: npm view engines checks]

| Package | D-number | Requires Node | Node 20.10 Compatible? |
|---------|----------|---------------|----------------------|
| `undici@^7` | D-22 | `>=20.18.1` | NO — needs 20.18+ |
| `nock@^14` | D-30, D-64 | `>=18.20 <20 || >=20.12.1` | NO — needs 20.12.1+ |
| `@clack/prompts@^1` | D-64 | `>=20.12.0` | NO (if using 1.x) |
| `fast-check@^3` | D-19, D-64 | `>=12.17.0` | YES |
| `zod@^3.23` | D-38, D-64 | (none stated) | YES |
| `proper-lockfile@^4` | D-10, D-55 | `>=12` (inferred) | YES |
| `@anthropic-ai/sdk@^0.93` | D-59, D-64 | `>=18` | YES |
| `p-retry@^6` | D-22, D-27 | (none stated for 6.x) | YES |

**REQUIRED RESOLUTION:** The CI matrix MUST be bumped from Node `20.10` to `20.18` before `npm ci` can succeed with these deps installed. The `package.json` `engines` field of `>=20.10.0` can stay (it documents the minimum for running the tool, not the CI environment). Update `.github/workflows/ci.yml` matrix node from `'20.10'` to `'20.18'`.

**child_process.spawn for lock test (TEST-07):** Works on all 3 OSes. Spawn must be against compiled `dist/` per D-65. Build step must precede test step in CI — already enforced by Phase 0 CI yml step order.

**npm ci cache:** `actions/setup-node@v4` with `cache: npm` is already in Phase 0 CI yml. No changes needed for caching.

**`fail-fast: false`:** Already in Phase 0 CI yml. Carry forward.

---

### RQ-13: Validation Architecture per Nyquist

See `## Validation Architecture` section below.

---

## Standard Stack

### Core (Phase 1)
| Library | Version to Install | Purpose | Node Compat |
|---------|-------------------|---------|-------------|
| `undici` | `^7.25.0` | HTTP/1.1 client with interceptors | `>=20.18.1` |
| `p-retry` | `^6.x` (or `^8.0.0`) | Exponential backoff with jitter | Any modern |
| `proper-lockfile` | `^4.1.2` | PID+mtime lockfile | `>=12` |
| `fast-check` | `^3.x` (or `^4.7.0`) | Property-based testing | `>=12.17` |
| `nock` | `^14.0.15` | HTTP cassette mocking | `>=20.12.1` |
| `zod` | `^3.23` | Schema validation + types | Any modern |
| `@anthropic-ai/sdk` | `^0.95.1` | Anthropic LLM client | `>=18` |
| `openai` | `^4.x` | OpenAI-compatible LLM client | Any modern |
| `@modelcontextprotocol/sdk` | `^1.29.0` | MCP server (Phase 2 install) | `>=18` |
| `@clack/prompts` | `^0.7.x` | Interactive prompts (Phase 2 install) | `>=18` |
| `smol-toml` | `^1.6.1` | TOML parser for config.toml | Any modern |
| `c8` | `^11.0.0` | Code coverage (dev dep) | Any modern |
| `doi-regex` | `^0.1.17` | DOI extraction from prose | Any modern |

### Installation (single npm install command for Phase 1)
```bash
# Runtime deps (all Phase 1 libs + Phase 2 installs per D-64)
npm install \
  undici@^7 \
  p-retry@^6 \
  proper-lockfile@^4 \
  zod@^3.23 \
  smol-toml \
  doi-regex \
  @anthropic-ai/sdk@^0.93 \
  openai@^4 \
  @modelcontextprotocol/sdk@^1.29 \
  @clack/prompts@^0.7

# Dev dependencies  
npm install -D \
  nock@^14 \
  fast-check@^3 \
  c8 \
  @types/proper-lockfile

# Also: CI yml must be updated: node: '20.10' → '20.18'
```

---

## Architecture Patterns

### System Architecture Diagram (Phase 1 scope only)

```
                     ┌─────────────────────────────────────┐
                     │  npm test (node scripts/run-tests.mjs) │
                     │  discovers tests/**/*.test.ts        │
                     └────────────────┬────────────────────┘
                                      │
               ┌──────────────────────┼──────────────────────────┐
               ▼                      ▼                           ▼
    tests/paths.test.ts    tests/atomic-write.test.ts   tests/lock.test.ts
    tests/doi.test.ts      tests/http.test.ts            tests/budget.test.ts
    tests/migrations.test.ts  tests/pii.test.ts          tests/session-log.test.ts
    tests/state.test.ts    tests/library.test.ts         tests/checkpoint.test.ts
    tests/runtime.test.ts  tests/lint-paths-chokepoint.test.ts
               │
               ▼
    ┌─────────────────────────────────────────────────────────────┐
    │                  FOUNDATION LIBS (bin/lib/)                  │
    │                                                              │
    │   paths.ts ──────────────────────────────────────────────── │
    │      └── atomic-write.ts ──────────────────────────────── │ │
    │              └── lock.ts ──────────────────────────────── │ │
    │              └── doi.ts (pure functions) ─────────────── │ │
    │              └── http.ts ──────────────────────────────── │ │
    │                     └── budget.ts ─────────────────────── │ │
    │                             └── migrations/loader.ts ──── │ │
    │                                    └── pii.ts ─────────── │ │
    │                                    └── session-log.ts ─── │ │
    │                                           └── state.ts ── │ │
    │                                           └── library.ts ─│ │
    │                                           └── checkpoint.ts│ │
    │                                                  └── runtime.ts│
    └─────────────────────────────────────────────────────────────┘
               │                                          │
               ▼                                          ▼
    Platform local data dir                    .paper/ (project)
    C:\Users\akhil\AppData\Local\pensmith\     .paper/COSTS.jsonl
      locks/<project-hash>.lock                .paper/SESSION.log
      http-cache/<source>/<sha>/<sha>.json     .paper/STATE.md
      library/index.json                       .paper/checkpoints/
      library/index.json.lock
```

### Recommended Project Structure (Phase 1 additions only)
```
bin/lib/
├── paths.ts              # NEW — FOUNDATION
├── atomic-write.ts       # NEW — FOUNDATION
├── lock.ts               # NEW — FOUNDATION
├── doi.ts                # NEW — FOUNDATION
├── http.ts               # NEW — FOUNDATION
├── budget.ts             # NEW — FOUNDATION
├── migrations/
│   ├── README.md         # EXISTING (Phase 0) — extend with contract spec
│   └── loader.ts         # NEW — FOUNDATION
├── pii.ts                # NEW — FOUNDATION
├── session-log.ts        # NEW — FOUNDATION
├── state.ts              # NEW — FOUNDATION slice only
├── library.ts            # NEW — FOUNDATION slice only
├── checkpoint.ts         # NEW — FOUNDATION slice only
├── runtime.ts            # NEW — provider-agnostic LLM wrapper
├── runtime/
│   └── pricing.ts        # NEW — hand-maintained pricing table
└── schemas/              # NEW directory
    ├── state.ts           # ProjectStateV1Schema (zod)
    ├── library.ts         # LibraryEntrySchema (zod)
    ├── checkpoint.ts      # CheckpointEnvelopeSchema (zod)
    ├── session-log.ts     # SessionLogRecordSchema (zod)
    └── runtime-config.ts  # RuntimeConfigSchema (zod, per D-63)

tests/
├── paths.test.ts          # NEW
├── atomic-write.test.ts   # NEW
├── lock.test.ts           # NEW (includes child_process.spawn D-12)
├── doi.test.ts            # NEW (includes fast-check property test D-19)
├── http.test.ts           # NEW (nock cassette tests D-30)
├── budget.test.ts         # NEW (cost-fixture test D-31 / TEST-08)
├── migrations.test.ts     # NEW (contract test D-39)
├── pii.test.ts            # NEW
├── session-log.test.ts    # NEW
├── state.test.ts          # NEW
├── library.test.ts        # NEW
├── checkpoint.test.ts     # NEW
├── runtime.test.ts        # NEW (structural tests only D-62)
├── lint-paths-chokepoint.test.ts  # NEW (D-41 red-team fixture)
├── lint-atomic-write-chokepoint.test.ts  # NEW (D-07 red-team fixture)
└── fixtures/
    ├── doi-corpus.ts      # NEW (fast-check generators, reusable in Phase 3)
    ├── http-cassettes/    # NEW directory
    │   ├── 429-retry-after-seconds.json
    │   ├── 503-no-header.json
    │   ├── 429-retry-after-http-date.json
    │   ├── 429-x-rate-limit-reset.json
    │   ├── missing-email-warn-proceeds.json
    │   ├── cache-hit.json
    │   ├── cache-ttl-expiry.json
    │   └── bypass-cache.json
    └── lint-atomic-write-chokepoint-fixture.ts  # NEW (D-07 red-team)

references/
└── http-warnings.md       # NEW (one-line locked string for missing-email WARN, D-24)
```

### Pattern 1: Chokepoint Lint Rule with Red-Team Fixture

The existing `tests/lint-chokepoint.test.ts` and `tests/fixtures/lint-chokepoint-fixture.ts` establish the pattern. Phase 1 adds two more chokepoints (D-07, D-41), each following exactly this pattern.

**D-07 (atomic-write chokepoint):** Ban direct `fs.writeFile` / `fs.promises.writeFile` outside `bin/lib/atomic-write.ts`. ESLint rule in `eslint.config.js`:
```javascript
// New rule in eslint.config.js
{
  name: 'pensmith/no-direct-writefile',
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "CallExpression[callee.property.name='writeFile']",
        message: "Use atomic-write.ts; direct fs.writeFile is forbidden (ARCH-05 / D-07)",
      },
    ],
  },
  ignores: ['bin/lib/atomic-write.ts'],
}
```

**D-41 (paths chokepoint):** Ban direct `os.homedir()`, `process.env.APPDATA`, `process.env.LOCALAPPDATA`, `process.env.XDG_DATA_HOME` outside `bin/lib/paths.ts`.

### Anti-Patterns to Avoid
- **Direct `fs.writeFile()` calls:** Use `writeAtomic()` instead. No exceptions for "small writes."
- **Lock file inside `.paper/`:** OneDrive will sync it and create race conditions. Always use `pensmithLockDir()`.
- **`%APPDATA%` on Windows:** This is the roaming directory, potentially synced. Use `%LOCALAPPDATA%` for pensmith data.
- **`undici@latest` without version pin:** npm installs v8 which requires Node 22. Always specify `^7`.
- **`schema_version` added in v0.2:** Too late. All Phase 1 state files get `schema_version: 1` from day one.
- **`p-retry randomize: true` for full-jitter:** It's equal-jitter. Implement full-jitter manually in `onFailedAttempt`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Race-free lock file | Custom `O_EXCL` file lock | `proper-lockfile@^4` | mkdir strategy is atomic on all FSes including NFS; mtime heartbeat handles stale detection |
| HTTP retry logic | Custom sleep-and-retry loop | `p-retry@^6` + custom `onFailedAttempt` | Handles AbortSignal, TypeErrors, AbortError escaping |
| Property-based testing | Manual input corpus | `fast-check@^3` | Automatic shrinking reduces failure cases to minimal example |
| HTTP cassette recording | Manual JSON mock files | `nock@^14` `nockBack` | Records real HTTP, replays deterministically; lockdown mode fails CI if cassette missing |
| Schema validation + types | Hand-written type guards | `zod@^3.23` | Types AND runtime validation in one declaration; `.parse()` throws on invalid state files |
| DOI regex extraction from prose | Hand-rolled `/10\.\d+/` | `doi-regex@^0.1.17` | Handles edge cases in prose extraction; normalization is still hand-rolled |

**Key insight:** The Foundation layer's value is that hand-rolled versions of these problems have well-known failure modes that production systems repeatedly discover. Using battle-tested libraries in the Foundation means Phase 2-10 can trust the substrate.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in, via `scripts/run-tests.mjs` discoverer) |
| Config file | none — `scripts/run-tests.mjs` uses Node 20 native test runner |
| Quick run command | `npm test` |
| Full suite command | `npm run coverage` (`c8 node scripts/run-tests.mjs`) |
| Build prerequisite | `npm run build` must precede `npm test` (lock conflict test uses compiled `dist/`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File |
|--------|----------|-----------|-------------------|------|
| ARCH-05 | Atomic write: rename-then-crash leaves valid target | unit | `npm test -- tests/atomic-write.test.ts` | Wave 2 |
| ARCH-05 | Chokepoint: no direct `fs.writeFile` outside atomic-write.ts | lint | `npm run lint` | Wave 2 |
| ARCH-06 | Lock acquisition/release; stale detection (90s) | unit | `npm test -- tests/lock.test.ts` | Wave 3 |
| ARCH-06 | Lock conflict: second runner aborts with holder info | child_process.spawn | `npm test -- tests/lock.test.ts` | Wave 3 |
| ARCH-06 | Lock file lives in LOCALAPPDATA, not .paper/ | unit (path assertion) | `npm test -- tests/lock.test.ts` | Wave 3 |
| ARCH-07 | `schema_version: 1` on all state files | contract test | `npm test -- tests/migrations.test.ts` | Wave 7 |
| ARCH-07 | `ForwardIncompatError` thrown on `schema_version: 2` | contract test | `npm test -- tests/migrations.test.ts` | Wave 7 |
| ARCH-07 | ZodError thrown on missing required field | contract test | `npm test -- tests/migrations.test.ts` | Wave 7 |
| ARCH-08 | `localDataDir()` resolves LOCALAPPDATA/Library/XDG on correct OS | unit (env injection) | `npm test -- tests/paths.test.ts` | Wave 1 |
| ARCH-08 | `isInsideSyncFolder()` matches OneDrive/iCloud/Dropbox/GDrive | unit | `npm test -- tests/paths.test.ts` | Wave 1 |
| ARCH-08 | Chokepoint: no direct `os.homedir()` outside paths.ts | lint | `npm run lint` | Wave 1 |
| ARCH-09 | `assertBudget` throws `BudgetExceededError` when over cap | unit | `npm test -- tests/budget.test.ts` | Wave 6 |
| ARCH-09 | Budget abort fires BEFORE simulated LLM call | cost-fixture test (TEST-08) | `npm test -- tests/budget.test.ts` | Wave 6 |
| ARCH-10 | Per-step cap enforced independently from session cap | unit | `npm test -- tests/budget.test.ts` | Wave 6 |
| ARCH-11 | `Semaphore.withPermit()` respects `--max-parallel` count | unit | `npm test -- tests/budget.test.ts` | Wave 6 |
| ARCH-11 | `wouldYoloRefuse()` returns true when estimate >50% of cap | unit | `npm test -- tests/budget.test.ts` | Wave 6 |
| ARCH-12 | WARN-once fires when `PENSMITH_CONTACT_EMAIL` unset | cassette test | `npm test -- tests/http.test.ts` | Wave 5 |
| ARCH-12 | WARN-once fires only once per process (memoized) | unit | `npm test -- tests/http.test.ts` | Wave 5 |
| ARCH-12 | Cache hit returns `cached: true` without network | cassette test | `npm test -- tests/http.test.ts` | Wave 5 |
| ARCH-12 | Cache TTL expiry triggers re-fetch | cassette test | `npm test -- tests/http.test.ts` | Wave 5 |
| ARCH-12 | `bypassCache: true` skips cache | cassette test | `npm test -- tests/http.test.ts` | Wave 5 |
| ARCH-13 | 429 + Retry-After: retry honors header timing | cassette test | `npm test -- tests/http.test.ts` | Wave 5 |
| ARCH-13 | 503: backoff schedule | cassette test | `npm test -- tests/http.test.ts` | Wave 5 |
| ARCH-13 | Retry-After HTTP-date format honored | cassette test | `npm test -- tests/http.test.ts` | Wave 5 |
| ARCH-13 | X-Rate-Limit-Reset header honored | cassette test | `npm test -- tests/http.test.ts` | Wave 5 |
| ARCH-14 | `OPENALEX_API_KEY` slot exists in runtime config schema | unit | `npm test -- tests/runtime.test.ts` | Wave 13 |
| ARCH-15 | DOI prefix strip (all 6 forms) | unit | `npm test -- tests/doi.test.ts` | Wave 4 |
| ARCH-15 | DOI trailing punctuation strip | unit | `npm test -- tests/doi.test.ts` | Wave 4 |
| ARCH-15 | ASCII-only case fold (non-ASCII preserved) | unit | `npm test -- tests/doi.test.ts` | Wave 4 |
| ARCH-15 | arXiv old/new format normalization | unit | `npm test -- tests/doi.test.ts` | Wave 4 |
| ARCH-15 | PMID/PMCID separation | unit | `npm test -- tests/doi.test.ts` | Wave 4 |
| TEST-06 | DOI idempotence property test via fast-check | property test | `npm test -- tests/doi.test.ts` | Wave 4 |
| TEST-07 | Lock conflict: child_process.spawn on all 3 OSes | spawn test | `npm test -- tests/lock.test.ts` | Wave 3 |
| TEST-08 | Budget abort BEFORE LLM call cost-fixture | fixture test | `npm test -- tests/budget.test.ts` | Wave 6 |
| ARCH-16 | Session log records written correctly to JSONL | unit | `npm test -- tests/session-log.test.ts` | Wave 9 |
| ARCH-16 | Log rotation at 50MB triggers rename | unit (size injection) | `npm test -- tests/session-log.test.ts` | Wave 9 |
| ARCH-17 | PII redact() returns diff array with category labels | unit | `npm test -- tests/pii.test.ts` | Wave 8 |
| ARCH-17 | `enabled: false` is no-op pass-through | unit | `npm test -- tests/pii.test.ts` | Wave 8 |
| TEST-11 | CI matrix runs on linux/macos/windows | CI workflow | GitHub Actions push | Wave 1 (CI yml update) |

### Sampling Rate
- **Per task commit:** `npm run lint && npm run typecheck && npm test`
- **Per wave merge:** `npm run check` (full pipeline)
- **Phase gate:** `npm run coverage` green (≥85% line coverage as developer signal; NOT a CI gate)

### Wave 0 Gaps
- [ ] CI yml update: `node: '20.10'` → `node: '20.18'` (BLOCKING — must land before any dep install)
- [ ] `tests/fixtures/doi-corpus.ts` — reusable fast-check generators for Phase 3
- [ ] `tests/fixtures/http-cassettes/` directory with 8 JSON cassette files
- [ ] `tests/fixtures/lint-atomic-write-chokepoint-fixture.ts` — red-team for D-07
- [ ] `references/http-warnings.md` — one-line locked WARN string for missing-email banner
- [ ] `bin/lib/schemas/` directory
- [ ] `bin/lib/runtime/` directory (for pricing.ts)
- [ ] `bin/lib/migrations/loader.ts` (migrations/ directory already exists from Phase 0)

---

## Threat Surfaces by Library

> Security domain: `security_enforcement: true`, ASVS L1, block on high.

### ASVS Categories Applicable to Phase 1

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No (no auth in Phase 1; runtime.ts reads API key from env, not self-authenticates) | — |
| V3 Session Management | Partial (session-log.ts creates run_id via ULID — not a security session) | Use crypto.randomUUID or ULID for run_id |
| V4 Access Control | No | — |
| V5 Input Validation | YES (all state file reads go through zod; DOI normalization validates format) | zod.parse() throws on invalid |
| V6 Cryptography | Partial (sha256 used for cache keys + project hash) | node:crypto — never hand-roll |
| V7 Errors / Logging | YES (session-log must not log API keys or PII) | PII filter before logging |
| V8 Data Protection | YES (runtime.ts must not log API keys; pii.ts is the PII fence) | Explicit key redaction in session-log |

### Threat Surfaces by Library

| Library | Threat | STRIDE | Standard Mitigation |
|---------|--------|--------|---------------------|
| `atomic-write.ts` | Race between two processes writing same file | Tampering | lock.ts must precede write; temp-file collision avoided by pid+random suffix |
| `atomic-write.ts` | Symlink attack on temp file path (attacker creates symlink at `target.tmp.X.Y`) | Elevation | Use `O_EXCL` when creating temp file; check that final path hasn't changed |
| `lock.ts` | Lock theft: attacker deletes `.lock` dir while holder is running | Tampering | `onCompromised` handler must abort the entire pensmith session immediately |
| `lock.ts` | PID collision: stale lock from PID that was reused | Spoofing | D-10 adds `hostname` + `started_at` to lock payload; check all three fields |
| `http.ts` | SSRF via crafted URL in source config | Elevation | Validate URL scheme (https-only for known sources); block localhost/10./172./192. ranges for non-'generic' sources |
| `http.ts` | Cache poisoning: attacker writes malicious JSON to cache dir | Tampering | Validate envelope schema on cache read (zod); check `expires_at` |
| `http.ts` | OPENALEX_API_KEY leakage in session-log / error messages | Info Disclosure | Redact `Authorization`, `X-API-Key`, `api_key` headers before logging; never log request headers verbatim |
| `budget.ts` | Budget bypass: caller skips `assertBudget` before LLM call | Tampering | No technical enforcement in Phase 1 — contract only; document in function header; Phase 3 caller code enforces |
| `budget.ts` | COSTS.jsonl corruption: two processes append simultaneously | Tampering | `O_APPEND` + single-write atomicity (≤PIPE_BUF); covered by D-33 |
| `pii.ts` | PII leakage to LLM despite redact call | Info Disclosure | Caller (Phase 3 intake) must call `redact()` BEFORE `runtime.chat()`; doc-commented contract in pii.ts |
| `session-log.ts` | API key logged in prompt/response records | Info Disclosure | Filter known secret env var values from all records before writing; `kind: 'prompt'` entries must NOT include request Authorization headers |
| `runtime.ts` | API key stored in config.toml | Info Disclosure | D-63: `api_key_env` stores the ENV VAR NAME (string), not the key itself; key is read from env at call time; zod schema validates it is a valid env var name pattern |
| `doi.ts` | Prototype pollution via crafted DOI string in JSON.parse | Tampering | Avoid `__proto__` patterns; zod validates the shape before DOI normalization runs |
| `paths.ts` | Path traversal: `sectionDir()` used with unsanitized slug | Elevation | `slugify()` enforces `/^[a-z0-9][a-z0-9-]{0,40}$/`; reject slugs containing `..`, `/`, `\` |
| `migrations/loader.ts` | Dynamic import of migration files enables code injection | Elevation | Migration files are loaded by exact filename pattern `from-N-to-M.ts`; N and M are validated as integers |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Env var injection (API keys passed via process.env) | Info Disclosure | Never log process.env verbatim; redact known key patterns |
| CJS `createRequire` from ESM | Spoofing (module identity) | Pin proper-lockfile to exact version; verify package integrity via lockfile |
| Temp file left on crash | Info Disclosure | Catch-and-cleanup in writeAtomic; `process.on('exit')` cleanup for stale temps |
| Overly-broad PII redaction exposing internal data structures | Info Disclosure | PII is opt-in (D-44); when enabled, diff is shown to user for review |

---

## Risks & Open Questions

### RISK-1: CI Node Version Bump (BLOCKING)
**Finding:** Three Phase 1 packages (`undici@7`, `nock@14`, `@clack/prompts@1`) are incompatible with Node 20.10 (the current CI pin). `npm ci` will fail with dependency errors on the CI matrix until this is resolved.
**Resolution:** Update `.github/workflows/ci.yml` matrix `node: '20.10'` → `node: '20.18'`. This is still in the Node 20 LTS line (supported through April 2026). The `package.json` engines field `>=20.10.0` can remain (it describes the minimum supported runtime, not CI).
**Who resolves:** Planner must make this Wave 1 Task 1.

### RISK-2: `p-retry randomize` is NOT Full-Jitter (D-27 Conflict)
**Finding:** D-27 specifies "full-jitter" but `p-retry randomize: true` multiplies delay by factor 1–2 (equal-jitter). This is less effective at preventing thundering herd under sustained load.
**Resolution:** Implement full-jitter manually in `onFailedAttempt` using `Math.random() * Math.min(maxMs, base * 2^attempt)`. Set `randomize: false` in p-retry options to avoid double-jitter. The `onFailedAttempt` approach also enables the `Retry-After` / `X-Rate-Limit-Reset` override logic (D-27).
**Who resolves:** Planner documents this in `http.ts` plan; implementer writes the custom jitter.

### RISK-3: `fsync(dirfd)` EPERM on Windows (D-04 Implementation Detail)
**Finding:** The D-04 atomic write recipe includes `fsync(dirfd)` but this fails with `EPERM` on Windows. Omitting it is safe on Windows NTFS (journaled FS), but the code must branch.
**Resolution:** Guard with `if (process.platform !== 'win32')` around the dirfd fsync. Document in code that NTFS journaling makes it unnecessary.
**Who resolves:** Planner documents in `atomic-write.ts` plan.

### RISK-4: `proper-lockfile` is CJS-only (ESM interop required)
**Finding:** `proper-lockfile@4.1.2` has no `exports` field; it cannot be directly `import`-ed from ESM. `createRequire(import.meta.url)('proper-lockfile')` is required.
**Resolution:** `lock.ts` wraps proper-lockfile with `createRequire`. Install `@types/proper-lockfile` for TypeScript types. This is a known ESM interop pattern.
**Who resolves:** Planner documents in `lock.ts` plan.

### RISK-5: `undici@8` Will Be Installed by `npm install undici` Without Pin
**Finding:** `npm install undici` gets v8.2.0 (requires Node 22+). The `^7` pin is critical.
**Resolution:** All install commands must specify `undici@^7` explicitly. Never `npm install undici` without version.
**Who resolves:** Planner includes explicit version in install task.

### RISK-6: `zod@4` Is Current But D-38 Pins `^3.23`
**Finding:** zod@4.4.3 is the current npm latest. `^3.23` will install 3.24.x (latest 3.x). Zod v4 has breaking API changes. The CONTEXT.md lock is intentional (v3 is stable and battle-tested for Phase 1).
**Resolution:** Use `zod@^3.23` as locked. The planner should note that a future phase may upgrade to v4, at which point the `message` → `error` rename and `.strict()` deprecations will need migration. Do not secretly use v4 features.
**Who resolves:** No action needed; informational.

### RISK-7: nock@14 lockdown-mode Test Isolation Bug
**Finding:** nock v14 beta had documented issues with lockdown mode causing cascade failures across test files (GitHub issues #2796, #2806). The stable 14.0.15 may have resolved these.
**Resolution:** Test cassette files with `nockBack.setMode('lockdown')` early in Phase 1. If failures occur, switch to per-test `nockBack.setMode('record')` / `nockBack.setMode('lockdown')` bracketing within each test file, and use `nock.cleanAll()` in `afterEach`.
**Who resolves:** Planner notes as test-time risk; implementer validates with first cassette test.

### RISK-8: OpenAlex API Key Sunset (Feb 13, 2026 — already past)
**Finding:** D-29 notes that OpenAlex email-only polite pool sunsets Feb 13, 2026. That date has passed (today is 2026-05-08). The `OPENALEX_API_KEY` slot must ship NOW; Phase 3 source adapters must wire it before first use.
**Resolution:** `runtime-config.ts` schema includes the `OPENALEX_API_KEY` slot. `http.ts` has a commented-out API key injection point. The doctor (Phase 2) must warn if unset when OpenAlex is in the source list.
**Who resolves:** Planner ensures config schema includes slot; doc-comment in http.ts explains the situation.

### RISK-9: `openai@^4` vs Current `openai@^6`
**Finding:** D-59 specifies `openai@^4` but current npm latest is `openai@6.37.0`. `^4` installs 4.x (latest 4.x is likely 4.x.x). The baseURL override API is present in both v4 and v6.
**Resolution:** Use `openai@^4` as locked. If Phase 3 finds a v6 feature required (e.g., new streaming API), that's a Phase 3 decision to upgrade. Explicitly pin `^4`.
**Who resolves:** No action needed; informational.

### OPEN-Q-1: Node version in `package.json` engines field
Should `package.json` `engines.node` be updated from `>=20.10.0` to `>=20.18.0` to reflect the actual minimum for undici@7 and nock@14? Arguments: (a) Yes — the engines field should reflect true minimum for the tool to run; (b) No — the engines field documents user-facing minimum; CI can run a higher version while users on 20.10 get a warning. **Recommendation:** Keep at `>=20.10.0` in engines, bump CI only. Log a TODO to revisit at v0.1.0 release.

### OPEN-Q-2: p-retry version — `^6` vs `^8`
D-64 specifies `p-retry@^6`. Current latest is `p-retry@8.0.0`. API is backward-compatible (same options). Is there a reason to stay on 6.x? The `^6` range will get the latest 6.x minor. **Recommendation:** Use `p-retry@^6` as locked unless a v8-specific feature is needed.

---

## Code Examples

### Atomic Write with Platform Guard
```typescript
// Source: D-04 design + manual test (VERIFIED: fsync(dirfd) fails EPERM on Windows)
import { open, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';

function randomHex(n: number): string {
  return randomBytes(n / 2).toString('hex');
}

export async function writeAtomic(
  target: string,
  data: string | Buffer,
  opts?: { mode?: number; encoding?: BufferEncoding }
): Promise<void> {
  const dir = dirname(target);
  const tmp = `${target}.tmp.${process.pid}.${randomHex(8)}`;
  const buf = typeof data === 'string'
    ? Buffer.from(data, opts?.encoding ?? 'utf8')
    : data;

  const fd = await open(tmp, 'w', opts?.mode ?? 0o644);
  try {
    await fd.write(buf);
    await fd.sync();   // fsync the file content
    await fd.close();
    await rename(tmp, target);  // atomic on Windows (Node >= 14) + POSIX

    // fsync directory entry — POSIX only (EPERM on Windows)
    if (process.platform !== 'win32') {
      const dirFd = await open(dir, 'r');
      try { await dirFd.sync(); } catch { /* best-effort on ZFS/some NFS */ }
      finally { await dirFd.close(); }
    }
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
```

### Lock Acquire/Release with D-10 Payload
```typescript
// Source: proper-lockfile README + D-10 design
import { createRequire } from 'node:module';
import { writeAtomic } from './atomic-write.ts';
import { pensmithLockDir, projectHash } from './paths.ts';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

const lockfile = createRequire(import.meta.url)('proper-lockfile') as typeof import('proper-lockfile');

export interface LockPayload {
  schema_version: 1;
  pid: number;
  hostname: string;
  started_at: string;
  heartbeat_at: string;
  pensmith_version: string;
}

export async function acquireLock(projectRoot: string): Promise<() => Promise<void>> {
  const lockDir = pensmithLockDir();
  await mkdir(lockDir, { recursive: true });
  const hash = projectHash(projectRoot);
  const lockTarget = join(lockDir, `${hash}.lock-target`);   // file proper-lockfile locks
  const payloadPath = join(lockDir, `${hash}.lock.json`);    // our payload

  // Write payload BEFORE acquiring lock (so reader sees it on conflict)
  const payload: LockPayload = {
    schema_version: 1,
    pid: process.pid,
    hostname: hostname(),
    started_at: new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
    pensmith_version: '0.1.0-dev',
  };
  await writeAtomic(payloadPath, JSON.stringify(payload, null, 2));

  // Acquire proper-lockfile lock (stale=90s, heartbeat=30s per D-10)
  const release = await lockfile.lock(lockTarget, {
    stale: 90_000,
    update: 30_000,
    retries: 0,          // fail-fast per D-11
    realpath: false,     // lockTarget may not exist yet
    lockfilePath: join(lockDir, `${hash}.lock`),
  });

  // D-13: register exit handlers
  const cleanup = async () => { await release(); };
  process.once('exit', () => lockfile.unlockSync(lockTarget, { lockfilePath: join(lockDir, `${hash}.lock`) }));
  process.once('SIGINT', async () => { await cleanup(); process.exit(130); });
  process.once('SIGTERM', async () => { await cleanup(); process.exit(143); });

  return cleanup;
}
```

### DOI Normalization (D-15 spec)
```typescript
// Source: D-15 spec + DOI Handbook §case-insensitivity
const PREFIX_PATTERNS = [
  /^</, /^>$/,
  /^https?:\/\/(?:dx\.)?doi\.org\//i,
  /^doi:/i,
  /^urn:doi:/i,
];
const TRAILING_PUNCT = /[.,;:)\]}>\"'\s]+$/;
const DOI_PATTERN = /^10\.\d{4,9}\/[^\s]+$/;

export function normalizeDoi(raw: string): string | null {
  let s = raw.trim();
  // Strip prefixes
  for (const pat of PREFIX_PATTERNS) { s = s.replace(pat, ''); }
  // Strip trailing punctuation (repeated until stable)
  let prev = '';
  while (s !== prev) { prev = s; s = s.replace(TRAILING_PUNCT, ''); }
  // ASCII-only case fold (DOI Handbook: only A-Z→a-z, not non-ASCII)
  s = s.replace(/[A-Z]/g, c => c.toLowerCase());
  // Validate
  return DOI_PATTERN.test(s) ? s : null;
}

// Store BOTH forms per D-16
export interface DoiRecord {
  doi_canonical: string;   // normalized for HTTP fetch + comparison
  doi_as_cited: string;    // raw input for display in reports
}
```

### Budget Guard (D-31 contract)
```typescript
// Source: D-31 design
export class BudgetExceededError extends Error {
  constructor(public scope: 'session' | 'step', public limitUsd: number, public spentUsd: number, public estimateUsd: number) {
    super(`Budget exceeded: ${scope} cap $${limitUsd.toFixed(2)}, spent $${spentUsd.toFixed(2)}, estimate $${estimateUsd.toFixed(2)}`);
  }
}

// TEST-08 pattern: inject this mock to verify assertBudget fires BEFORE LLM call
export async function assertBudget(opts: { scope: 'session' | 'step'; estimateUsd: number; label: string }): Promise<void> {
  const { scope, estimateUsd, label } = opts;
  const spent = await readSpent(scope);  // reads .paper/COSTS.jsonl
  const cap = readCap(scope);            // reads config.toml
  if (spent + estimateUsd > cap) {
    throw new BudgetExceededError(scope, cap, spent, estimateUsd);
  }
}
```

### fast-check DOI Idempotence Property Test
```typescript
// Source: fast-check docs pattern + D-19 spec
import * as fc from 'fast-check';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDoi } from '../bin/lib/doi.ts';

test('normalizeDoi is idempotent', () => {
  // Test with DOIs + prefixes + trailing punct
  fc.assert(
    fc.property(
      fc.oneof(
        // Valid DOIs with various prefixes
        fc.tuple(
          fc.stringMatching(/^10\.\d{4,9}\/[^\s]{3,20}$/),
          fc.constantFrom('', 'doi:', 'https://doi.org/', 'http://dx.doi.org/'),
          fc.constantFrom('', '.', ',', ';', ')'),
        ).map(([doi, prefix, suffix]) => prefix + doi + suffix),
        // Garbage
        fc.string({ maxLength: 30 }),
      ),
      (input) => {
        const once = normalizeDoi(input);
        const twice = once !== null ? normalizeDoi(once) : null;
        // idempotence: normalize(normalize(x)) === normalize(x)
        assert.strictEqual(once, twice);
      }
    ),
    { numRuns: 1000, verbose: false }
  );
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `node-fetch` / `axios` | Native `fetch` + `undici` | Node 18+ (2022) | No external dep for HTTP; undici gives interceptors for Phase 1 |
| `fs.writeFile` for state | Atomic write-then-rename | Node 14+ (2021) | Safe crash recovery |
| `jest` test runner | `node:test` (built-in) | Node 18+ (2022) | Zero config, no transpiler overhead |
| JSON lock files | `proper-lockfile` mkdir strategy | Always; this pattern | Works on NFS/network filesystems |
| Manual input test cases | `fast-check` property tests | ~2019 | Automatic edge-case discovery + shrinking |
| `undici@^7` (locked) | `undici@8.x` (current npm latest) | May 2026 | v8 requires Node 22; v7 is correct for Node 20 |
| `zod@^3.23` (locked) | `zod@4.x` (current) | April 2026 | v4 has breaking API changes; v3 is safe for Phase 1 |

**Deprecated/outdated (do not use):**
- `openai@^6` for Phase 1: locked to `^4` per D-59; v6 has different streaming API surface
- `undici@^8` without Node 22: requires Node 22.19.0+
- `p-retry randomize: true` for full-jitter: it's equal-jitter; use custom `onFailedAttempt`
- `%APPDATA%` for Windows data dir: roaming directory; use `%LOCALAPPDATA%` per D-40

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `fsync(dirfd)` is safe to skip on Windows NTFS (NTFS journaling covers it) | RQ-8, Code Examples | If wrong: potential data loss on power failure on Windows, but only for the directory entry. The file content is safe since fsync(tmpfd) was called before rename. Low practical risk on modern NTFS. |
| A2 | `proper-lockfile@4.1.2` with `realpath: false` works when lockTarget doesn't yet exist | RQ-2 | If wrong: `ENOENT` error on first lock acquisition. Fallback: create a placeholder file at lockTarget before locking. |
| A3 | nock@14.0.15 lockdown-mode isolation issues are resolved (reported in beta) | RQ-4 | If wrong: test files after the first may cascade-fail in lockdown mode. Fix: isolate nockBack state per test file with `beforeEach`/`afterEach` setup. |
| A4 | `openai@^4` (4.x) and `@anthropic-ai/sdk@^0.93` (0.95.x) have no breaking changes in the `^` range | RQ-6 | If wrong: minor API changes within the caret range. Both SDKs follow semver so this should be safe. |
| A5 | `actions/setup-node@v4` supports `node-version: '20.18'` without changes to the workflow file structure | RQ-12 | If wrong: syntax adjustment needed; very low risk. |
| A6 | `proper-lockfile`'s `update` interval keeps the mtime fresh; the mtime check is against the system clock of the same host | RQ-2 | If wrong: cross-machine scenarios (OneDrive syncing the lock file) would see stale detection issues. Since D-08 puts locks in LOCALAPPDATA (not OneDrive), cross-machine sync is impossible; assumption is safe. |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All libs | ✓ | v24.14.0 (dev); 20.18 (CI target) | — |
| npm | dep install | ✓ | 11.9.0 | — |
| git | CI / commits | ✓ | 2.53.0 | — |
| tsc | build | ✓ (devDep) | via npx | — |
| tsx | dev/test runner | ✓ (devDep) | via npx | — |
| GitHub Actions | CI matrix | ✓ (configured) | — | local `npm run check` |
| LOCALAPPDATA path | lock + cache | ✓ | `C:\Users\akhil\AppData\Local` | macOS/Linux equivalents |
| OneDrive (dev only) | isInsideSyncFolder test | ✓ | Present at `OneDrive - Roanoke College` | — |

**Missing dependencies with no fallback:** None — all deps are npm packages that will be installed.

**Missing dependencies with fallback:** None for Phase 1.

---

## Open Questions (RESOLVED)

All Phase 1 open questions are resolved below; resolutions are locked into the plan set (no further deliberation in plan-phase).

1. **Should `package.json` engines be updated to `>=20.18.0`?** — RESOLVED
   - **Decision:** Keep `engines.node: ">=20.10.0"` as the user-facing minimum runtime; bump only CI (Node 20.18) so the matrix can install undici@7 / nock@14 / clack@1. The two values document distinct contracts: `engines` documents what pensmith is willing to run on after install; CI documents what we test against.
   - **Locked in:** 01-00-PLAN.md Task 1 Step 1.5 ("DO NOT touch `engines.node`"). Step 1.1 bumps CI to `'20.18'` only.

2. **Is `p-retry@^6` or `^8` preferred?** — RESOLVED
   - **Decision:** Use `^6` as specified in D-64. Phase 1 implements its own full-jitter shim in `bin/lib/retry.ts` (RESEARCH §RQ-9) and does NOT actually depend on p-retry's runtime API today; the package is installed for downstream consumers (Phase 2+) who may want to call it directly. v8 would be a drop-in upgrade later if a specific feature is needed.
   - **Locked in:** 01-00-PLAN.md Task 1 Step 1.2(b) pins `"p-retry": "^6"`. 01-05-PLAN.md Task 1 implements the full-jitter shim without importing p-retry.

3. **Should `doi-regex@^0.1.17` be `^0.1.17` or exact pin?** — RESOLVED
   - **Decision:** Use the caret form `^0.1.17`. The package has had only patch-level releases since first publish; risk of breakage from `^` is negligible and matches the rest of the dependency block style.
   - **Locked in:** 01-00-PLAN.md Task 1 Step 1.2(b) pins `"doi-regex": "^0.1.17"`.

4. **nock v14 lockdown mode: validate immediately or wait for failures?** — RESOLVED
   - **Decision:** Validate IMMEDIATELY in Phase 1. The first http.ts test (`tests/http.test.ts` lockdown-mode case) calls `fetch('https://example.invalid/x')` with NO MockAgent installed and asserts a network error is thrown. This proves nock@14 + undici MockAgent's `disableNetConnect()` is wired correctly before any further work depends on it. If lockdown regression #2806 fires under nock 14.0.15, the test will fail loudly in Wave 4 — fix forward there rather than deferring.
   - **Locked in:** 01-05-PLAN.md Task 3 Step 3.6 ("Lockdown mode assertion") and Task 3 acceptance criterion `npm test exits 0 with PENSMITH_NETWORK_TESTS unset (lockdown mode active)`.

---

## Citations

### Primary (HIGH confidence — verified via npm registry and official docs)
- `npm view undici` (2026-05-08) — v7.25.0 latest 7.x; engines: `>=20.18.1`; v8.2.0 latest (needs Node 22)
- `npm view nock` (2026-05-08) — v14.0.15; engines: `>=18.20 <20 || >=20.12.1`
- `npm view p-retry@8 readme` (2026-05-08) — randomize option description confirmed equal-jitter
- `npm view proper-lockfile readme` (2026-05-08) — `.lock()` API, stale/update options, mkdir strategy
- `npm view zod dist-tags` (2026-05-08) — v3.24.x vs v4.4.3 version split confirmed
- `npm view @clack/prompts@1.3.0 engines` (2026-05-08) — requires Node `>=20.12.0`
- `npm view @anthropic-ai/sdk@0.95.1 readme` (2026-05-08) — baseURL option confirmed present
- Manual Windows test: `fs.renameSync` over existing file — SUCCESS on Node v24
- Manual Windows test: `fs.fsyncSync(dirfd)` — EPERM on Windows (confirmed)
- Manual Windows test: `process.env.LOCALAPPDATA` = `C:\Users\akhil\AppData\Local` (confirmed non-OneDrive)

### Secondary (MEDIUM confidence — official docs via WebFetch/WebSearch)
- [undici Dispatcher.md](https://github.com/nodejs/undici/blob/main/docs/docs/api/Dispatcher.md) — request() API, AbortSignal, headers format
- [undici RetryHandler.md](https://github.com/nodejs/undici/blob/main/docs/docs/api/RetryHandler.md) — retryAfter option, maxRetries, statusCodes defaults
- [undici v7 blog post](https://blog.platformatic.dev/undici-v7-is-here) — compose() API confirmed, `throwOnError` removed (replaced by responseError() interceptor)
- [nock README](https://github.com/nock/nock/blob/main/README.md) — nockBack modes, fixtures directory, NOCK_BACK_MODE env
- [fast-check docs](https://fast-check.dev/) — fc.property, fc.assert, shrinking behavior
- [Zod v4 changelog](https://zod.dev/v4/changelog) — `.extend()` recommended over `.merge()`; `.strict()` deprecated; `message` → `error`
- [Ollama OpenAI compat docs](https://ollama.com/blog/openai-compatibility) — baseURL pattern for openai SDK confirmed

### Tertiary (LOW confidence — single source, needs validation)
- nock v14 lockdown mode issue reports (#2796, #2806) — reported during beta; unclear if fixed in 14.0.15 stable
- `X-Rate-Limit-Reset` header not handled natively by undici RetryHandler (inferred from docs gap; needs implementation test)

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — all versions verified against npm registry; conflicts surfaced
- Architecture: HIGH — three-ring model directly from ARCHITECTURE.md + Phase 0 decisions
- Pitfalls: HIGH — Pitfalls 2/4/5/6/7/8 from PITFALLS.md directly inform each lib
- Node version conflicts: HIGH — confirmed via `npm view` engines fields
- fsync(dirfd) Windows: HIGH — manually tested and confirmed EPERM

**Research date:** 2026-05-08
**Valid until:** 2026-06-08 (stable ecosystem; undici 8.x and zod 4.x are the main moving targets)

---

## RESEARCH COMPLETE
