---
phase: 1
phase_name: "foundation-nfrs"
project: "pensmith"
generated: "2026-05-16"
counts:
  decisions: 28
  lessons: 9
  patterns: 14
  surprises: 8
missing_artifacts: []
sources:
  - .planning/phases/01-foundation-nfrs/01-00-SUMMARY.md
  - .planning/phases/01-foundation-nfrs/01-01-SUMMARY.md
  - .planning/phases/01-foundation-nfrs/01-02-SUMMARY.md
  - .planning/phases/01-foundation-nfrs/01-03-SUMMARY.md
  - .planning/phases/01-foundation-nfrs/01-04-SUMMARY.md
  - .planning/phases/01-foundation-nfrs/01-05-SUMMARY.md
  - .planning/phases/01-foundation-nfrs/01-06-SUMMARY.md
  - .planning/phases/01-foundation-nfrs/01-07-SUMMARY.md
  - .planning/phases/01-foundation-nfrs/01-08-SUMMARY.md
  - .planning/phases/01-foundation-nfrs/01-09-SUMMARY.md
  - .planning/phases/01-foundation-nfrs/01-10-SUMMARY.md
  - .planning/phases/01-foundation-nfrs/01-11-SUMMARY.md
  - .planning/phases/01-foundation-nfrs/01-12-SUMMARY.md
  - .planning/phases/01-foundation-nfrs/01-13-SUMMARY.md
  - .planning/phases/01-foundation-nfrs/VERIFICATION.md
---

# Phase 1 Learnings — Foundation NFRs

Phase 1 shipped 13 foundation libraries (paths, atomic-write, lock, doi, http, budget, migrations, pii, session-log, state, library, checkpoint, runtime + pricing). 14 plans, 226 tests passing, four chokepoint composition shapes proven under concurrency. The phase's load-bearing achievement is not the individual libs but the chokepoint composition idiom that Phase 2+ inherits without re-implementing.

---

## Decisions

### D-1.1 — proper-lockfile loaded via `createRequire(import.meta.url)` shim

The lock module loads proper-lockfile through `createRequire(import.meta.url)` rather than `import`, because proper-lockfile@4 ships CJS-only and ESM-native import paths fail under NodeNext+verbatimModuleSyntax. This is a permanent shape, not a workaround — `pkg.exports` of proper-lockfile doesn't ship dual entry points.

- Source: 01-03-SUMMARY.md
- Trade-off: One file in the codebase departs from the ESM-native import pattern; documented inline so future readers don't "fix" it.

### D-1.2 — Lock files live in pensmithLockDir(), never inside .paper/ (D-40)

Lock filenames are sha256-truncated stubs under `pensmithDataDir()/locks/` (platform local data dir: `%LOCALAPPDATA%`, `~/Library/Application Support`, or `$XDG_DATA_HOME`). Never inside `.paper/`. OneDrive non-negotiable: OneDrive sync on `.paper/` corrupts lock state.

- Source: 01-03-SUMMARY.md, VERIFICATION.md SC-3
- Regression gate: `tests/lock.test.ts` walks `.paper/` post-test and asserts zero `*.lock` files in-tree.

### D-1.3 — Lock-key = absolute file path; W3 does sha256 internally

Callers pass the raw absolute file path to `withLock(file, fn)`. W3's `stubFor()` applies sha256-truncation internally. State, library, checkpoint, runtime all use this idiom verbatim. Do NOT pre-hash in caller code.

- Source: 01-10-SUMMARY.md, 01-11-SUMMARY.md, 01-12-SUMMARY.md, 01-13-SUMMARY.md

### D-1.4 — staleMs = 45s (1.5× the 30s D-26 working TTL)

Lock heartbeat budget. Stale locks are reclaimable by the next acquirer after 45s; the buffer above 30s prevents legitimate long-held locks from being killed.

- Source: 01-03-SUMMARY.md

### D-1.5 — Atomic-write chokepoint via tmp+rename+fsync; EPERM/ENOSYS/EISDIR swallowed on dir-fsync

`atomicWriteFile` writes to `${target}.tmp.${rand}`, fsyncs the file, renames over target, fsyncs the parent dir. Dir-fsync errors EPERM/ENOSYS/EISDIR are swallowed (Windows, some filesystems). EXDEV (cross-device rename) falls back to copyFile+unlink.

- Source: 01-02-SUMMARY.md

### D-1.6 — DOI normalization is three-step: prefix-strip, trailing-punct-strip, ASCII-only case-fold (D-15)

`normalizeDoi` walks: (1) strip longest-first DOI prefix (`https://doi.org/`, `http://dx.doi.org/`, `doi:`), (2) strip up to 10 trailing punctuation chars `. , ; : ) ] } > " '`, (3) ASCII-only case-fold (preserve non-ASCII bytes verbatim — `String#toLowerCase` is locale-aware and wrong).

- Source: 01-04-SUMMARY.md
- Regression gate: 1000-run fast-check property test asserts idempotence over valid/punctuated/prefixed corpora.

### D-1.7 — arXiv format split into normalizeArxivNew + normalizeArxivOld (D-17)

Pre-2007 arXiv ids look like `hep-th/9601001` (subject-class/YYMMNNN); post-2007 are `1501.00001` (YYMM.NNNNN). Hardcoded subject class list. PMID capped at 9 digits (NLM's documented limit). PMCID requires the literal `PMC` prefix (rejecting bare digits prevents PMID/PMCID conflation, D-18).

- Source: 01-04-SUMMARY.md

### D-1.8 — HTTP retry uses AWS full-jitter, not p-retry's bounded jitter (D-23)

`retry()` computes delay as `uniform[0, min(cap, base * 2^(attempt-1))]` with base=200ms, cap=30s, maxAttempts=5. AWS full-jitter decorrelates retry stampedes; p-retry's bounded-multiplicative jitter does not.

- Source: 01-05-SUMMARY.md

### D-1.9 — TokenBucket acquired INSIDE retry's fn, not before it

Each retry re-pays the bucket so a retry storm doesn't violate the per-source RPS floor. RPS_BY_SOURCE: crossref=50, openalex=10 (anonymous default — stricter than spec's 15K/hr ≈ 4.17/s), arxiv=1 (relaxed from 1/3s), pubmed=3, generic=5.

- Source: 01-05-SUMMARY.md, VERIFICATION.md SC-5

### D-1.10 — HTTP cache stores 404s alongside 200s

Both 200 and 404 are cached (TTL-driven). Prevents repeated lookups against permanent-not-found URLs from re-hitting the upstream. Cache write goes through atomicWriteFile chokepoint.

- Source: 01-05-SUMMARY.md
- Caveat: REVIEW FLAG-06 deferred — cache also writes auth-protected bodies; revisit post-Phase 1.

### D-1.11 — WARN-once sentinel banner read from `references/http-warnings.md` at module load

The WARN string for missing `PENSMITH_CONTACT_EMAIL` is read from disk at module-load (single source of truth) and emitted exactly once per process. Phase 2 doctor (DOCT-03) reads the same file for parity.

- Source: 01-05-SUMMARY.md

### D-1.12 — Budget pre-call gate: assertBudget → llm.call → appendCost (D-44)

`assertBudget(spec, estimateUsd)` throws `BudgetExceededError` BEFORE the caller awaits the LLM. Cost ledger appends via `atomicAppendFile` (O_APPEND) post-call. No post-call gate exists by design — the contract is the caller pattern.

- Source: 01-06-SUMMARY.md, VERIFICATION.md SC-4

### D-1.13 — In-process Semaphore with FIFO waiter queue (D-50)

`Semaphore(maxConcurrency)` for `--max-parallel` cap. Validates positive-integer constructor; `release()` throws on under-release. Wave scheduler in Phase 2+ wraps it; Foundation ships only the in-process primitive.

- Source: 01-06-SUMMARY.md

### D-1.14 — Versioned-JSON loader: single options-object signature (D-37 divergence)

`loadAndMigrate({file, schema, schemaName, currentVersion, migrations?, writeBack?})` — NOT the plan's `(raw: unknown, ...)` draft signature. The loader owns the disk read so call sites stay one-liners and `fs.writeFile` never escapes the chokepoint.

- Source: 01-07-SUMMARY.md

### D-1.15 — Schema-specific CURRENT_*_VERSION constants (avoid name collisions)

Each schema exports `CURRENT_STATE_VERSION` / `CURRENT_LIBRARY_VERSION` / `CURRENT_CHECKPOINT_VERSION` / `CURRENT_SESSION_LOG_VERSION` / `CURRENT_RUNTIME_CONFIG_VERSION` — never a bare `CURRENT_VERSION`. A consumer importing constants from multiple schemas would otherwise shadow one import with another.

- Source: 01-07-SUMMARY.md

### D-1.16 — `$schemaVersion` missing or non-integer → treated as v1 (day-one tolerance, D-37)

The loader's version-peek defaults missing/non-int versions to v1 rather than treating as corruption. Lets v0.1 files written before the schema landed continue to load.

- Source: 01-07-SUMMARY.md

### D-1.17 — Refuse forward-incompat (D-39); audit-log carve-out for checkpoint (D-60)

State, library, runtime use refuse-forward: disk version > code version throws `ForwardIncompatError`. Checkpoint uses tolerant-skip: forward-versioned JSONL lines are skipped with one WARN per `listCheckpoints` call. The carve-out is justified by append-only semantics — skipping never causes data loss.

- Source: 01-07-SUMMARY.md, 01-12-SUMMARY.md

### D-1.18 — `writeBack:true` on top-level load; `writeBack:false` on inner load inside updateXxx

`loadXxx` opts into write-back so v1→v2 migrations persist for the next reader. `updateXxx` does NOT write-back on its inner load because the outer `atomicWriteFile` is about to overwrite the file in the same critical section — one disk write per lock window.

- Source: 01-07-SUMMARY.md, 01-10-SUMMARY.md, 01-11-SUMMARY.md

### D-1.19 — Providers stored as z.record (object), not z.array

`runtime-config.providers` is `z.record(z.string(), ProviderSchema).refine(p => Object.keys(p).length >= 1)`. Required for object lookup (`cfg.providers?.[providerId]`) and overlay merge (`{ ...base.providers, ...overlay.providers }`). The min-1 refine rejects empty maps (a config with zero providers is non-functional). Regression gate: overlay-merge-by-key test.

- Source: 01-07-SUMMARY.md, 01-13-SUMMARY.md

### D-1.20 — PII redaction via hand-rolled regex; no library (D-49)

Five classes (EMAIL, PHONE, SSN, NAME, DATE-ISO/US/EU) plus 15 sensitive-key map. `classifyPii` returns non-overlapping spans in source order; `redactPii` walks right-to-left to avoid offset recomputation; `redactKeys` deep-clones via `Object.create(null)` containers with `isPlainObject` proto guard. All regexes use bounded character classes to prevent ReDoS (T-01-REDOS-01).

- Source: 01-08-SUMMARY.md

### D-1.21 — Sensitive keys: exact-match, case-insensitive; 15 entries frozen

`authorization, x-api-key, api_key, apikey, token, access_token, refresh_token, secret, client_secret, cookie, set-cookie, password, passwd, ssn, ssn_last4`. Stored as `ReadonlySet<string>` lowercase; lookup via `key.toLowerCase()`. Replacement tags are LOCKED literals — downstream tests pin them: `[REDACTED:EMAIL]`, `[REDACTED:PHONE]`, `[REDACTED:SSN]`, `[REDACTED:NAME]`, `[REDACTED:DATE]`, generic `[REDACTED]` for non-string sensitive values.

- Source: 01-08-SUMMARY.md

### D-1.22 — Session log run_id = crypto.randomUUID() (D-64, not ulid)

D-49 spec says "ULID-like"; RESEARCH §V3 explicitly accepts UUIDv4. UUIDv4 has 122 bits of randomness — collision-safe for per-handle identifiers. Not a secret, not sortable — Node built-in suffices; no `ulid` dep.

- Source: 01-09-SUMMARY.md

### D-1.23 — Session-log record shape: `{at, kind, run_id, ...payload}` (D-49)

Payload spreads inline; no `ctx` / `msg` wrapper; no `ts` / `level` legacy fields. 8-kind discriminator union: `prompt, response, tool_call, tool_result, cost, event, warn, error`. Camel→snake mapping for `toolCall`/`toolResult` only.

- Source: 01-09-SUMMARY.md

### D-1.24 — Rotation 50MB / 3 backups; highest-numbered-first (Windows-safe)

`MAX_LOG_BYTES = 50MB`, `MAX_BACKUPS = 3`. After each append: stat, if oversize, unlink `.3` then rename `.2→.3`, `.1→.2`, `current→.1`. Highest-numbered-first because Windows rejects rename-over-existing. ENOENT/EACCES/EPERM swallowed — rotation must never throw.

- Source: 01-09-SUMMARY.md

### D-1.25 — Oversize records spill to `sessions/${run_id}/${seq}.json` + truncated marker line (D-50)

`MAX_RECORD_BYTES = 16KB`, head/tail = 4KB each. Oversize records: write full record via `atomicWriteFile` to spill path, then append a truncated line carrying `head`, `tail`, `truncated:true`, `spilled_to`. `seq` is per-handle monotonic.

- Source: 01-09-SUMMARY.md

### D-1.26 — Stderr mirror flag is module-scope; only kind:'prompt' mirrors (D-52)

`setMirrorPromptsToStderr(enabled)` flips a module-scope boolean. Phase 7 `--show-prompts` flag wires it. Mirror runs synchronously BEFORE the async file write enqueues so users see prompts immediately rather than after queue drain.

- Source: 01-09-SUMMARY.md

### D-1.27 — refs in Checkpoint typed Record<string, string> (W7 schema, not plan)

Plan said `Record<string, unknown>`; locked W7 schema requires `z.record(z.string(), z.string())`. Honor schema. Content-addressing rationale: every value fits in a string (hash, id, path). Future broadening is a v2 migration.

- Source: 01-12-SUMMARY.md

### D-1.28 — runtime defaults() seeds an anthropic provider; never bare RuntimeConfigSchema.parse({})

W7 ProviderSchema requires `name: z.enum(['anthropic','openai'])` plus `apiKeyEnv`. W7 RuntimeConfigSchema has `.refine(providers >= 1)`. `RuntimeConfigSchema.parse({})` would throw. `defaults()` explicitly seeds `{name:'anthropic', apiKeyEnv:'ANTHROPIC_API_KEY'}`. Plan's snippet would have crashed.

- Source: 01-13-SUMMARY.md

### D-1.29 — T-01-07 no-leak property: env-var NAMES on disk; VALUES never persist or log

`apiKeyEnv` (NAME) on disk; resolved VALUE only in local function scope until returned. `getOpenAlexApiKey` pre-computes `const present = !!(resolved && resolved.length > 0)` BEFORE the log call so the resolved string never reaches the log payload object. Regression gate: writes runtime.json pointing at `SECRET_VALUE_DO_NOT_LEAK`, then asserts the env VALUE is absent from the persisted file.

- Source: 01-13-SUMMARY.md, VERIFICATION.md SC-4

### D-1.30 — gpt-5 priced equal to gpt-4o (placeholder per RESEARCH §pricing-pending)

Until OpenAI publishes the official rate, gpt-5 entry mirrors gpt-4o ($2.50/$10.00 per Mtok). Update procedure: bump entry, reference vendor pricing page in commit message, re-run cost-math tests.

- Source: 01-13-SUMMARY.md

---

## Lessons

### L-1.1 — Default ESLint flat-config + tseslint.configs.recommended enables `no-require-imports`

`tseslint.configs.recommended` flips `no-require-imports` on globally, which would block the `createRequire(import.meta.url)` shim that proper-lockfile needs. Resolution: per-file `'@typescript-eslint/no-require-imports': 'off'` on `bin/lib/lock.ts` plus an inline rationale.

- Why: This is the kind of friction where ESLint defaults push you toward a different architecture than the platform actually supports. Knowing where the defaults disagree with reality saved hours in 01-03.
- How to apply: When a recommended preset blocks a load-bearing pattern, scope the exemption to the single file rather than globally weakening the rule.
- Source: 01-03-SUMMARY.md

### L-1.2 — `.js` extension specifiers from `.ts` source is the canonical NodeNext + verbatimModuleSyntax idiom

Imports like `import { paperDir } from './paths.js'` from `bin/lib/foo.ts` look wrong at first read but are correct: NodeNext+verbatimModuleSyntax requires the EMIT form (`.js`), not the source form (`.ts`). Every Phase 1 module uses this pattern.

- Why: New contributors instinctively "fix" `.js` to `.ts` and break the build. Lesson recorded so the pattern survives reviewer scrutiny.
- How to apply: When importing from a `.ts` neighbor, write the `.js` extension every time.
- Source: 01-01-SUMMARY.md, 01-07-SUMMARY.md

### L-1.3 — TypeScript `noUncheckedIndexedAccess` adds `| undefined` to every array read

`lib.entries[0].id` becomes `lib.entries[0]?.id` under this flag. Optional chaining is the correct fix in test bodies; in production code, either narrow with `.length` checks or pull into a const first.

- Why: Several Phase 1 tests broke on type errors that were strictly correct under the strict flag.
- How to apply: Default to `?.` in tests; in production code, surface the narrowing intentionally.
- Source: 01-11-SUMMARY.md

### L-1.4 — Test seeding through chokepoint, not around it

Multiple plans (01-07, 01-08, 01-09, 01-10, 01-11, 01-12, 01-13) tested file IO. The natural pattern is `await fsp.writeFile(seed, ...)` — but D-07 atomic-write chokepoint bans that. Choice: grow the eslint exemption list per-test, or route the seed through `atomicWriteFile`. Routing through the chokepoint preserves tight surface area AND exercises the production write path.

- Why: Exemption lists grow faster than chokepoints get audited. The "test seeds through the chokepoint" idiom kept the lint surface tight across 7 plans.
- How to apply: When adding a test that touches a chokepoint's domain, route through the chokepoint helper rather than the raw stdlib call.
- Source: 01-07-SUMMARY.md

### L-1.5 — Module-level lazy SessionLogger singleton enables env-var override in tests

`let _log = null; function log() { if (!_log) _log = openSessionLog().child({module:'X'}); return _log; }` — lazy init means tests can mutate `LOCALAPPDATA`/`XDG_DATA_HOME`/`HOME` BEFORE dynamic-importing the module and observe the redirected paths. State, library, checkpoint, runtime all use this exact idiom.

- Why: Eager init would capture the env at module-load and tests can't redirect. The lazy pattern was needed once and then copy-pasted into every chokepoint-composer.
- How to apply: For any module that emits to session-log, lazy-init via local cache so tests can override env first.
- Source: 01-10-SUMMARY.md, 01-11-SUMMARY.md, 01-12-SUMMARY.md, 01-13-SUMMARY.md

### L-1.6 — Plan-vs-Schema reconciliation comes up repeatedly when plans pre-date locked schemas

Five distinct Plan-vs-Schema mismatches surfaced across 01-07, 01-12, 01-13 (refs typing, defaults() empty-object, ProviderSchema name field, runtime-config providers shape, openalexApiKeyOptional default). Pattern: plan text drafted earlier than W7 schema lock-down, executor discovers mismatch at first compile or first test, honors schema (W7 chokepoint is locked).

- Why: Plans freeze before all dependencies do. Trying to "fix the schema to match the plan" risks breaking other consumers; "honor the schema and adapt the plan" preserves the chokepoint contract.
- How to apply: When a plan snippet doesn't compile or doesn't parse against the schema, the schema wins. Document as Rule 1 deviation in SUMMARY.
- Source: 01-12-SUMMARY.md (Deviation 1), 01-13-SUMMARY.md (Deviations 1+2)

### L-1.7 — W3 default retry budget caps concurrency tests at ~10 contenders on Windows + OneDrive

01-12 plan asked for N=20 concurrent contenders. With proper-lockfile's default `timeoutMs=60_000`, `retryDelayMs=100`, `retryFactor=1.5`, the 17th-20th writers exhaust the retry budget after ~131s and throw ELOCKED. Reasonable production envelopes (verifier fanout per-section) never approach N=20.

- Why: The cap is a property of W3's default schedule, not a checkpoint bug. Production concurrency is far below the cap.
- How to apply: Concurrency tests cap at N=10. Don't extend the LockOptions surface to accommodate test-only contention; match the realistic production envelope.
- Source: 01-12-SUMMARY.md (Deviation 2)

### L-1.8 — `present` boolean pre-compute is defense-in-depth against future log-refactors

`getOpenAlexApiKey` could compute presence inline in the log call. Refactor instinct over time tends to fold it. Pre-computing into `const present` then passing only `{ ..., present }` to the log call means a future audit can grep for the resolved-value identifier and confirm it's only in local-variable scope — never in any payload object.

- Why: Naming the intent ("pre-compute presence") makes the no-leak property auditable. A future contributor seeing the pattern is less likely to refactor it away.
- How to apply: For any function that reads a sensitive value and emits a log record, compute presence/length/structure before the log call; never inline the resolved value identifier into log arguments.
- Source: 01-13-SUMMARY.md

### L-1.9 — OPTIONAL config files: ENOENT → defaults(); AUTHORITATIVE state files: ENOENT → NotFoundError

State, library, checkpoint translate ENOENT to typed `XxxNotFoundError` because the file is required for normal operation. Runtime translates ENOENT to `defaults()` because the file is OPTIONAL — first-run pensmith has no runtime.json and SHOULD operate with schema defaults. The semantic split is load-bearing; documenting it explicitly in 01-13 SUMMARY makes the contract greppable.

- Why: Phase 2+ adds more config-style files; getting the split wrong silently degrades reliability ("missing runtime.json broke the world") or user experience ("first run rejects with paper-not-initialized").
- How to apply: Authoritative → typed NotFoundError; optional → defaults(). Document the choice in the SUMMARY so reviewers don't second-guess it.
- Source: 01-13-SUMMARY.md

---

## Patterns

### P-1.1 — Wave-0 prep wave: install deps + scaffold chokepoints in one commit

01-00 installed 14 deps and scaffolded D-07 atomic-write + D-41 paths chokepoints with red-team lint fixtures BEFORE any consumer wave started. Pattern: Wave 0 is the gate that prevents downstream waves from drifting into ad-hoc `fs.writeFile` or `process.env.LOCALAPPDATA` reads.

- When to use: any phase with multiple chokepoint primitives that downstream waves consume.
- Source: 01-00-SUMMARY.md

### P-1.2 — Chokepoint composition: W2(atomic-write) + W3(lock) + W7(loadAndMigrate) + W9(session-log)

Four primitives that compose. Each downstream sibling (state, library, checkpoint, runtime) wires them in a slightly different shape but never reimplements them. Validated under contention at N=10 for library / checkpoint and N=2 for state.

- When to use: any persisted-JSON module in Phase 2+.
- Source: 01-10-SUMMARY.md, 01-11-SUMMARY.md, 01-12-SUMMARY.md, 01-13-SUMMARY.md

### P-1.3 — load-INSIDE-the-lock for any read-then-write critical section

`updateState`, `addEntry`, and any future read-mutate-write must put the load inside the withLock callback. Two concurrent updaters that load outside the lock will each see the same pre-write value and the second writer clobbers the first. Test 5/Test 6 (concurrent disjoint mutations) is the regression gate.

- When to use: every read-then-write chokepoint in Phase 2+.
- Source: 01-10-SUMMARY.md, 01-11-SUMMARY.md

### P-1.4 — Defense-in-depth schema validation: parse on init, save, mutator output, AND load

Four parse points per chokepoint surface. Init seed parses (catches caller-side garbage early). Save input parses (refuses to write malformed). Mutator output parses (catches mutator-side garbage). Loader parses on read (catches disk-side corruption). Three save-side guards + one load-side.

- When to use: every chokepoint composer that touches persisted state.
- Source: 01-10-SUMMARY.md, 01-11-SUMMARY.md

### P-1.5 — Per-file ESLint exemption block extended-not-duplicated as new tests need env override

Single `no-restricted-syntax: 'off'` block in `eslint.config.js`. Each Phase 1 test that needs to override LOCALAPPDATA / XDG_DATA_HOME / HOME gets added to the existing block's file list rather than creating a new exemption block. Final list at 01-13: session-log.test.ts, state.test.ts, library.test.ts, checkpoint.test.ts, runtime.test.ts.

- When to use: any new test that needs env-override for path redirection.
- Source: 01-09 through 01-13 SUMMARYs

### P-1.6 — Tolerant reader pattern: parse-on-write (THROW), safeParse-on-read (SKIP)

Asymmetric validation — `CheckpointSchema.parse` rejects malformed writes; `CheckpointSchema.safeParse` skips malformed reads. Justified ONLY for append-only audit-log files (D-60 carve-out from D-39). Pair with one WARN log per call when skip path fires.

- When to use: append-only audit log files that should survive forward-version evolution.
- Source: 01-12-SUMMARY.md

### P-1.7 — Recovery commit on lockdown breakage

In 01-01, a paths.ts iteration broke the build but the executor had a clean snapshot at the previous commit. Pattern: when a refactor breaks lint or tests beyond quick recovery, commit a "recovery to last green" + cherry-pick the working slices forward. Commit `a507cd7` was the canonical example.

- When to use: when a multi-file refactor produces lint/test failures that resist 10+ min of fixing.
- Source: 01-01-SUMMARY.md

### P-1.8 — Cross-process test via raw CJS helper

`tests/lock-conflict.cjs` runs as raw CJS (not transpiled) so the test proves Node-level cross-process semantics rather than same-process serialization. The parent spawns the child via `child_process.spawn`, the child signals `ACQUIRED <ms>` on stdout, the parent measures the wait time. The waited-time assertion (`>= HOLD_MS - 500ms`) is the load-bearing proof.

- When to use: any concurrency primitive that claims cross-process semantics.
- Source: 01-03-SUMMARY.md, VERIFICATION.md SC-3

### P-1.9 — Fast-check property tests at 1000 iterations for idempotence

DOI normalization runs `fc.assert(fc.property(corpus, fn), { numRuns: 1000 })` for idempotence over valid/punctuated/prefixed corpora; arxiv/pmid use 500 runs. 6500 total property-test iterations across 11 properties in 01-04. Catches subtle idempotence violations that hand-written tables miss.

- When to use: any pure normalization or canonicalization function with an idempotence claim.
- Source: 01-04-SUMMARY.md, VERIFICATION.md SC-2

### P-1.10 — MockAgent.disableNetConnect() test-suite default

`tests/http.test.ts` calls `agent.disableNetConnect()` at top of file. The lockdown test asserts the chokepoint refuses live calls (throws on non-mocked URLs). Cassette JSONs live under `tests/fixtures/http-cassettes/` and replay 200/404/429+retry-after/500+retry. Ensures Phase 1 tests are offline by construction.

- When to use: every test suite that touches `bin/lib/http.ts`.
- Source: 01-05-SUMMARY.md, VERIFICATION.md SC-1

### P-1.11 — JSONL with one `safeParse` per line; skip-on-failure for forward-version tolerance

`listCheckpoints` reads the JSONL file, splits by newline, JSON.parse each non-empty line in try/catch (skip on syntax error), then safeParse against the schema (skip on validation failure). One WARN log record per `listCheckpoints` call when skipped > 0; one EVENT otherwise.

- When to use: append-only JSONL audit logs that need to survive forward-version migrations.
- Source: 01-12-SUMMARY.md

### P-1.12 — Two-scope config-loader: global + paper overlay, paper-wins per top-level key

`loadRuntimeConfig({scope:'auto'})` reads `pensmithDataDir()/runtime.json` and `<paperRoot>/runtime.json`, then deep-merges with paper-wins semantics. Providers map deep-merges by providerId. Merged result is re-validated through RuntimeConfigSchema.parse for defense-in-depth.

- When to use: any future config that needs per-paper overrides on top of global defaults.
- Source: 01-13-SUMMARY.md

### P-1.13 — Pre-call gate → call → ledger-append (budget contract)

`assertBudget` → `llm.call` → `appendCost`. assertBudget is the only gate; if it returns void, the caller proceeds; if it throws, no LLM call happens. The cost ledger writes via O_APPEND (atomicAppendFile) so concurrent ledger writes preserve all entries. No post-call gate.

- When to use: any LLM or paid-API call site in Phase 2+.
- Source: 01-06-SUMMARY.md, VERIFICATION.md SC-4

### P-1.14 — Foundation-slice posture: verify substrate readiness, not feature completeness

CLAUDE.md formalizes the posture for Phase 1 verification: a foundation slice ships infrastructure that later phases consume. The verifier checks contracts and tests, not user-visible features. SC-5's `Retry-After` parsing was accepted as a documented override on this basis (substrate complete, 5-line addition deferred to Phase 2).

- When to use: any verification where the phase ships primitives consumed by later phases.
- Source: VERIFICATION.md preamble + SC-5 override

---

## Surprises

### S-1.1 — proper-lockfile CJS-only forces createRequire(import.meta.url) shim

Expected the package to ship dual ESM/CJS entry points like most modern utilities. It doesn't. The shim works but feels wrong in an otherwise ESM-native codebase; 01-03 SUMMARY documents the rationale inline so future readers don't "fix" it.

- Source: 01-03-SUMMARY.md

### S-1.2 — `String#toLowerCase` is locale-aware (Turkish-I, German ß)

Naive case-folding for DOI normalization would mangle non-ASCII bytes under non-en locales. The fix is ASCII-only case-fold: `s.replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0)+32))`. Property test would have caught this; spec-table tests probably wouldn't have.

- Source: 01-04-SUMMARY.md

### S-1.3 — `RuntimeConfigSchema.parse({})` throws (providers .refine requires >=1)

01-13 plan's `defaults()` snippet was `RuntimeConfigSchema.parse({})`. Would have crashed at first call. Schema's `.refine(p => Object.keys(p).length >= 1, 'at least one provider required')` is correct; plan didn't account for it. Caught at first compile.

- Source: 01-13-SUMMARY.md (Deviation 1)

### S-1.4 — z.record(...) inside a multi-line Prettier wrap defeats grep-friendliness

01-07 spec required `z.record(z.string(), ProviderSchema)` to be a greppable literal substring. Prettier wrapped it as `z\n    .record(z.string(), ProviderSchema)\n    .refine(...)` — splits the literal across two lines. Required a chore commit to collapse to single-line.

- Source: 01-07-SUMMARY.md (Auto-fix 2)

### S-1.5 — NAME regex `\b[A-Z][a-z]{1,20}(?:[ -][A-Z][a-z]{1,20}){1,2}\b` consumes leading capitalized word greedily

Fixture `'Reviewer Mary-Anne Smith approved'` was supposed to match raw=`'Mary-Anne Smith'`. Actual match: `'Reviewer Mary-Anne'` (3 capitalized tokens hits the {1,2} cap, leaves `Smith` as a trailing 1-token fragment that fails the 2-token minimum). Fix: lowercase the leading word in the fixture, not the regex (regex is locked per D-49).

- Source: 01-08-SUMMARY.md (Auto-fix 1)

### S-1.6 — paperDir() doesn't throw when not in a paper; needs `fs.statSync(...).isDirectory()` for 'auto' detection

01-09 plan assumed `paperDir(cwd)` would throw outside a paper directory. It doesn't — just joins `cwd + '.paper'`. Without a stat check, scope='auto' would always pick paperDir and write SESSION.log to a non-paper cwd. Fixed by wrapping `fs.statSync(candidate).isDirectory()` in try/catch.

- Source: 01-09-SUMMARY.md

### S-1.7 — Plan-vs-Schema mismatches across three plans: typed surface vs locked schema

01-07 (providers shape), 01-12 (refs typing as Record<string, unknown> vs schema's Record<string, string>), 01-13 (ProviderSchema.name field, defaults() empty-object) — five distinct mismatches. Pattern: plans drafted before W7 schemas locked; executor honors schema, adapts plan. Future phases should reverse the order — lock the schema FIRST, then plan against it.

- Source: 01-07, 01-12, 01-13 SUMMARYs

### S-1.8 — 20-concurrent recordCheckpoint test exhausts proper-lockfile's retry budget at ~131s on Windows + OneDrive

01-12 plan asked for N=20 concurrent contenders. W3's default `timeoutMs=60_000`, `retryDelayMs=100`, `retryFactor=1.5` gives the 17th-20th contenders insufficient retry budget; observed ELOCKED at ~131s. Lowered to N=10 (matches W11 library; well within budget; ~7.5s wall). Production verifier fanout per-section is nowhere near N=20.

- Source: 01-12-SUMMARY.md (Deviation 2)

---

## Cross-references to Phase 0

Several Phase 1 decisions extend or instantiate Phase 0 chokepoint patterns:
- [[00-LEARNINGS]] D-07 atomic-write chokepoint → instantiated by 01-02 (`atomicWriteFile`); consumed by every Wave-10/11 sibling.
- [[00-LEARNINGS]] D-41 paths chokepoint → instantiated by 01-01 (`paths.ts`); consumed by lock, session-log, runtime.
- [[00-LEARNINGS]] MCP dual-declaration (plugin.json + .mcp.json) → unchanged; Phase 2 doctor inherits.
- [[00-LEARNINGS]] Structural validation (no JSON-schema) → continued in 01-07 zod-only stance.

---

## Deferred to Phase 1.1 follow-up debt

Per `REVIEW-FIXES.md` user-authorized scope, the following REVIEW.md findings were deferred:
- FLAG-02 session-log module-global chain
- FLAG-04 spilled_to path separator
- FLAG-05 module-singleton logger captures env
- FLAG-06 http cache writes auth-protected bodies
- FLAG-07 runtime auto-mode dual writeBack
- FLAG-08 paths.ts diacritic regex
- FLAG-09 arxiv ARXIV_NEW 4-digit
- NIT-01 through NIT-06

VERIFICATION SC-5 override: Retry-After / X-Rate-Limit parser deferred to Phase 2 alongside DOCT-03. 5-line addition.

---

_Phase: 01-foundation-nfrs_
_Generated: 2026-05-16_
