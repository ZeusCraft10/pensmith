---
phase: 02-tier-shells-doctor-tier-contract-gate
plan: 00
type: execute
wave: 0
depends_on: []
files_modified:
  - bin/lib/retry.ts
  - bin/lib/http.ts
  - tests/retry.test.ts
  - tests/http.test.ts
  - package.json
  - references/doctor-output.md
  - hooks/.gitkeep
  - tests/repo-files.test.ts
autonomous: true
requirements: []  # ARCH-13 is a carry-forward verification, not a fresh implementation owned by Phase 2
carry_forward:
  - ARCH-13  # Phase 1 retry helper (parseRetryAfter); 02-00 verifies the helper still passes Phase 1's SC-5 tests under Phase 2's Node-20.10 + tsx setup. Per plan-checker iter 2 / W3.
user_setup: []
must_haves:
  truths:
    - "parseRetryAfter is a pure helper in bin/lib/retry.ts (per D-01, Phase 1 SC-5 carry-forward)"
    - "citty@^0.2.2 is declared in package.json dependencies (per D-14)"
    - "@clack/prompts ^0.7 is declared in package.json dependencies (per TIER-05 build-now decision)"
    - "references/doctor-output.md exists with locked TTY copy (per D-18) — pinned by sha256 in tests/repo-files.test.ts"
    - "references/doctor-output.md does NOT contain wiring-smoke / DOCT-05 (deferred to Phase 3 per D-04)"
    - "hooks/ directory exists on disk (carry into TIER-07)"
    - "tests/repo-files.test.ts asserts the Wave-0 artifacts AND hash-pins doctor-output.md"
  artifacts:
    - path: "bin/lib/retry.ts"
      provides: "parseRetryAfter() pure helper + existing fullJitterDelayMs/retry"
      contains: "export function parseRetryAfter"
    - path: "tests/retry.test.ts"
      provides: "parseRetryAfter unit cases (delta-seconds + HTTP-date + invalid)"
      contains: "parseRetryAfter"
    - path: "package.json"
      provides: "citty@^0.2.2 + @clack/prompts@^0.7 dependency entries"
      contains: "\"citty\""
    - path: "references/doctor-output.md"
      provides: "Locked TTY copy + JSON shape doc for /pensmith doctor"
      contains: "# /pensmith doctor"
    - path: "hooks/.gitkeep"
      provides: "Empty hooks/ directory placeholder (real hook files land in 02-06)"
    - path: "tests/repo-files.test.ts"
      provides: "Existence + content assertions for the four Wave 0 artifacts"
      contains: "references/doctor-output.md"
  key_links:
    - from: "bin/lib/http.ts"
      to: "bin/lib/retry.ts::parseRetryAfter"
      via: "named import from './retry.js'"
      pattern: "from ['\"]\\./retry"
    - from: "tests/repo-files.test.ts"
      to: "references/doctor-output.md"
      via: "fs.existsSync + content match"
      pattern: "references/doctor-output\\.md"
---

<objective>
Land the FIRST Phase 2 plan (per D-02 — nothing else starts until this lands). Extracts `parseRetryAfter` from a missing-helper-shaped Phase 1 carry-forward into `bin/lib/retry.ts` as a pure unit-testable function (D-01), wires `bin/lib/http.ts` to call it on the 429/503 retry path, installs `citty@^0.2.2` so Wave 2's CLI dispatcher has its dependency, drafts the locked `references/doctor-output.md` copy (D-18) so Wave 2's `bin/cli/doctor.ts` has a single source of truth, creates the empty `hooks/` directory so Wave 2's hook scaffolding has a home, and extends `tests/repo-files.test.ts` to assert all four artifacts are in place.

Purpose: Unblock every other Wave's work. No other plan in this phase has zero prerequisites; this one does.
Output: 6 modified files + 2 new files (`bin/lib/retry.ts` modified, `bin/lib/http.ts` modified, `tests/retry.test.ts` modified, `tests/http.test.ts` modified, `package.json` modified, `references/doctor-output.md` new, `hooks/.gitkeep` new, `tests/repo-files.test.ts` modified). Per-commit verification: `npm run lint && npm run typecheck && node scripts/run-tests.mjs tests/retry.test.ts tests/repo-files.test.ts`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-PATTERNS.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-VALIDATION.md
@CLAUDE.md
@bin/lib/retry.ts
@bin/lib/http.ts
@tests/retry.test.ts
@references/http-warnings.md

<interfaces>
<!-- D-01 target: pure parseRetryAfter helper -->
<!-- RFC 7231 §7.1.3 defines two Retry-After forms:
       (a) delta-seconds (e.g. "120")
       (b) HTTP-date     (e.g. "Wed, 21 Oct 2026 07:28:00 GMT")
     X-Rate-Limit-Reset is Unix-epoch seconds. -->

From bin/lib/retry.ts (existing, extended in this plan):
```typescript
export function fullJitterDelayMs(attempt: number, baseMs: number, capMs: number): number;
export function retry<T>(fn: () => Promise<T>, opts?: RetryOptions): Promise<T>;
// NEW (this plan):
export function parseRetryAfter(headerValue: string | undefined, now: number): number;
//                                  ^ returns delay in ms, >= 0.
//                                    Returns 0 for undefined/empty/invalid input.
//                                    Throws nothing — invalid input collapses to 0.
```

From bin/lib/http.ts (call site to add in this plan):
```typescript
// Currently lines 441-469: retry() wraps dispatch() with retryOn predicate.
// Add: on the thrown HTTP error path, read err.response.headers['retry-after']
//      and override the next backoff to max(fullJitter(...), parseRetryAfter(header, Date.now())).
// IMPORTANT: do NOT change the retry's overall maxAttempts or capMs.
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add parseRetryAfter() to bin/lib/retry.ts + tests (D-01)</name>
  <files>bin/lib/retry.ts, tests/retry.test.ts</files>
  <read_first>
    - bin/lib/retry.ts (entire file — 147 lines; understand existing fullJitterDelayMs shape lines 74-94)
    - .planning/phases/02-tier-shells-doctor-tier-contract-gate/02-PATTERNS.md § "Excerpt 3 — Pure-helper module shape" (lines 128-155)
    - .planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md § "Pitfall 10" (lines 669-673)
    - tests/retry.test.ts (entire file — to know where to insert new test block alongside existing fullJitterDelayMs tests)
  </read_first>
  <behavior>
    - Test 1: `parseRetryAfter(undefined, Date.now())` returns `0`
    - Test 2: `parseRetryAfter('', Date.now())` returns `0`
    - Test 3: `parseRetryAfter('120', anyNow)` returns `120_000` (delta-seconds form, RFC 7231 §7.1.3)
    - Test 4: `parseRetryAfter('0', anyNow)` returns `0`
    - Test 5: `parseRetryAfter('not-a-number', anyNow)` returns `0` (invalid input collapses to 0, never throws)
    - Test 6: `parseRetryAfter('-30', anyNow)` returns `0` (negative delta clamped to 0)
    - Test 7: `parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', new Date('2026-10-21T07:27:00Z').getTime())` returns `60_000` (HTTP-date form, 1-minute future)
    - Test 8: `parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', new Date('2026-10-21T08:00:00Z').getTime())` returns `0` (past date clamped to 0)
    - Test 9: `parseRetryAfter('not a valid date string', anyNow)` returns `0`
  </behavior>
  <action>
    1. In `bin/lib/retry.ts`, ADD `parseRetryAfter` AFTER `fullJitterDelayMs` (around line 95) and BEFORE the `sleep` helper. Use this signature and body shape (model on `fullJitterDelayMs` JSDoc style at lines 62-73):

       ```typescript
       /**
        * Parse a Retry-After header value into a delay in milliseconds.
        *
        * Per RFC 7231 §7.1.3, Retry-After may be either:
        *   (a) a non-negative integer count of delta-seconds, e.g. "120"
        *   (b) an HTTP-date, e.g. "Wed, 21 Oct 2026 07:28:00 GMT"
        *
        * X-Rate-Limit-Reset is Unix-epoch seconds and is NOT handled here —
        * the http.ts call site converts it to milliseconds-from-now before
        * deciding which delay to use.
        *
        * Guarantees:
        *   - Returns a non-negative integer in milliseconds
        *   - Never throws (invalid input collapses to 0 so the caller may
        *     safely fall back to fullJitterDelayMs)
        *   - Past HTTP-dates and negative delta-seconds return 0
        */
       export function parseRetryAfter(headerValue: string | undefined, now: number): number {
         if (!headerValue) return 0;
         const trimmed = headerValue.trim();
         if (trimmed === '') return 0;
         // (a) delta-seconds form — pure-digit integer
         if (/^-?\d+$/.test(trimmed)) {
           const seconds = parseInt(trimmed, 10);
           if (Number.isNaN(seconds) || seconds < 0) return 0;
           return seconds * 1000;
         }
         // (b) HTTP-date form — RFC 7231 accepts the IMF-fixdate / RFC 850 /
         //     asctime() formats; Date.parse handles IMF-fixdate which is the
         //     RFC-7231 preferred form. Servers that emit non-IMF dates are
         //     non-compliant; we collapse to 0 (caller falls back to jitter).
         const parsed = Date.parse(trimmed);
         if (Number.isNaN(parsed)) return 0;
         const delta = parsed - now;
         if (delta <= 0) return 0;
         return delta;
       }
       ```

    2. In `tests/retry.test.ts`, ADD a new `describe`-equivalent block (`test()` calls — match existing top-level pattern). Place the new tests AFTER the existing `fullJitterDelayMs` tests but BEFORE the integration cassette tests. Each of the 9 behaviors above becomes one `test('parseRetryAfter: ...', () => { ... })` call. Import: `import { parseRetryAfter, fullJitterDelayMs, retry } from '../bin/lib/retry.js';` (extend the existing import on line 24).

       For tests 7 + 8 use a fixed reference date so the test is deterministic across timezones: `const refNow = new Date('2026-10-21T07:27:00Z').getTime();`.

    3. Do NOT modify `fullJitterDelayMs` or `retry`. Do NOT change exports of either. Do NOT touch the module header comment block.
  </action>
  <verify>
    <automated>node scripts/run-tests.mjs tests/retry.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "export function parseRetryAfter" bin/lib/retry.ts` returns at least 1
    - `grep -c "parseRetryAfter" tests/retry.test.ts` returns at least 9 (9 test cases)
    - `node scripts/run-tests.mjs tests/retry.test.ts` exits 0
    - `npm run typecheck` exits 0
    - `npm run lint` exits 0
    - Existing fullJitterDelayMs tests still pass (`grep -c "fullJitterDelayMs" tests/retry.test.ts` unchanged from previous count)
  </acceptance_criteria>
  <done>
    `parseRetryAfter` exported from `bin/lib/retry.ts` as a pure function; 9 test cases pass; lint + typecheck green; no behavior change to existing `retry()` or `fullJitterDelayMs()`.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire bin/lib/http.ts retry path to parseRetryAfter</name>
  <files>bin/lib/http.ts, tests/http.test.ts</files>
  <read_first>
    - bin/lib/http.ts lines 430-470 (the retry block — current behavior to extend)
    - bin/lib/http.ts lines 175-180 (HttpRequestOptions interface — confirm noRetry shape)
    - tests/http.test.ts (entire file — find an existing 429-retry cassette test to model on; reuse its cassette shape)
    - .planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md § "Pitfall 10" + § ARCH-13 lines
    - bin/lib/retry.ts (after Task 1 — confirm parseRetryAfter signature)
  </read_first>
  <behavior>
    - Test 1: When a 429 response carries `retry-after: 5` header, the http retry path waits AT LEAST ~5000ms (allow ±100ms tolerance; use the cassette-controlled clock via `process.hrtime.bigint()` deltas) before the next attempt.
    - Test 2: When a 429 response has NO `retry-after` header, behavior matches existing fullJitter-only path (regression test — must still pass).
    - Test 3: When a 503 response carries `retry-after: 0`, the next attempt fires immediately (no extra wait beyond fullJitter floor).
  </behavior>
  <action>
    1. In `bin/lib/http.ts`, at the top of the file, ADD `parseRetryAfter` to the existing retry import (it is already imported as part of `from './retry.js'` — extend the import list). If there is no existing import of retry helpers in http.ts, add `import { retry, parseRetryAfter } from './retry.js';` at the appropriate import block.

    2. Modify the retry block at lines 441-469 to honor `Retry-After`. Replace the `onAttempt` / sleep-decision with a callback that consults the most-recent error's response headers. Concrete change (model on the existing retryOn callback shape):

       Currently the retry call is:
       ```typescript
       const response: HttpResponse = opts.noRetry
         ? await dispatch()
         : await retry(
             async () => { /* throws on 429/5xx */ },
             { maxAttempts: 5, baseMs: 200, capMs: 30_000, retryOn: (err) => ... },
           );
       ```

       Add an `onAttempt` hook AND extend the retry helper if needed. The cleanest implementation: capture the last server-requested delay via a closure variable and use it inside a custom `baseMs` strategy. Since `retry()` itself is fixed-base, the simplest approach is to insert an explicit `await sleep(parseRetryAfter(...))` INSIDE the wrapped function BEFORE the next dispatch on the second+ attempt. Use the existing `attempt` counter exposed via `onAttempt`.

       Concrete pattern:
       ```typescript
       let serverRetryDelay = 0;
       const wrapped = async (): Promise<HttpResponse> => {
         if (serverRetryDelay > 0) {
           // server told us to wait — honor it on top of the jitter sleep
           await new Promise((r) => setTimeout(r, serverRetryDelay));
           serverRetryDelay = 0;
         }
         const r = await dispatch();
         if (RETRYABLE_STATUSES.has(r.status)) {
           const ra = r.headers['retry-after'];
           serverRetryDelay = parseRetryAfter(typeof ra === 'string' ? ra : undefined, Date.now());
           const err = new Error(`HTTP ${r.status}`) as Error & {
             status?: number; response?: HttpResponse;
           };
           err.status = r.status;
           err.response = r;
           throw err;
         }
         return r;
       };
       const response: HttpResponse = opts.noRetry
         ? await dispatch()
         : await retry(wrapped, { /* same opts as before */ });
       ```

       Keep the existing `retryOn` predicate unchanged. Do NOT alter `maxAttempts`, `baseMs`, or `capMs`.

    3. Add or extend 2-3 cassette-based tests in `tests/http.test.ts` (model on the existing 429-retry test — the file already has cassettes wired). Use `MockAgent` from undici. Cassette shape: first response is `429` with `retry-after: 5` header, second is `200`. Assert the time between the two dispatch calls is ≥ 5000ms (use a mocked clock or `process.hrtime` delta with a generous tolerance — recommended: use a small retry-after value like `1` with tolerance `>= 900ms` to keep test fast). If the existing test file already covers Retry-After (it likely does NOT — Phase 1 SC-5 is documented as a carry-forward), ADD the new cases.

    4. Run the full http test suite to ensure no regression: `node scripts/run-tests.mjs tests/http.test.ts tests/retry.test.ts`.
  </action>
  <verify>
    <automated>node scripts/run-tests.mjs tests/http.test.ts tests/retry.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "parseRetryAfter" bin/lib/http.ts` returns at least 1
    - `node scripts/run-tests.mjs tests/http.test.ts` exits 0
    - `node scripts/run-tests.mjs tests/retry.test.ts` exits 0
    - `npm run typecheck` exits 0
    - `npm run lint` exits 0
    - At least one new test case in `tests/http.test.ts` matches `retry-after` (grep `grep -c "retry-after" tests/http.test.ts` >= 1)
  </acceptance_criteria>
  <done>
    The 429/503 retry path in http.ts now respects the `Retry-After` header (per ARCH-13). At least one cassette test asserts the delay; existing http tests still pass; no behavior regression.
  </done>
</task>

<task type="auto">
  <name>Task 3: Add citty@^0.2.2 dep + draft references/doctor-output.md + hooks/.gitkeep + extend tests/repo-files.test.ts</name>
  <files>package.json, references/doctor-output.md, hooks/.gitkeep, tests/repo-files.test.ts</files>
  <read_first>
    - package.json (entire — confirm current dependencies block)
    - references/http-warnings.md (entire — the analog for `references/doctor-output.md`)
    - tests/repo-files.test.ts (entire — find the existing file-existence loop at lines 14-31 and CONTRIBUTING.md test at lines 75-85)
    - .planning/phases/02-tier-shells-doctor-tier-contract-gate/02-PATTERNS.md § "Excerpt 5 — Locked-copy reference file" (lines 188-209) AND § "Excerpt 8 — repo-files.test.ts extension shape" (lines 264-286)
  </read_first>
  <action>
    1. **package.json** — Add `"citty": "^0.2.2"` AND `"@clack/prompts": "^0.7"` to the `"dependencies"` block. After editing, run `npm install` so `package-lock.json` is updated and `node_modules/citty/` + `node_modules/@clack/prompts/` are populated. Do NOT change any other dependency or script. Per D-14 + TIER-05 these deps are locked.

       Rationale: Wave 2 consumes both — `bin/cli/pensmith.ts` (02-05) uses `citty`, and `bin/lib/prompts.ts` (02-09 — new plan in this revision) uses `@clack/prompts` for the TIER-05 AskUserQuestion fallback. Installing both in Wave 0 means Wave 2 plans can run in parallel without sequencing the dep install.

    2. **references/doctor-output.md** — Create with the following shape (model on `references/http-warnings.md`):

       ```markdown
       # Doctor Output Strings (locked — D-18)

       This file is the SINGLE source of truth for `/pensmith doctor` (DOCT-01..04, DOCT-07
       + DOCT-02 ecosystem probes) user-facing prose. `bin/cli/doctor.ts` reads these
       strings at module load. The Tier-1 MCP `paper://capabilities` resource consumes
       the same Record shape (severities only — no copy strings persisted across the wire).
       Drift between the locked copy and the rendered output is a regression — pinned
       by sha256 hash in `tests/repo-files.test.ts`.

       DOCT-05 (end-to-end fixture probe) is deferred to Phase 3 per CONTEXT D-04; this
       file does NOT contain wiring-smoke copy. DOCT-06 (tier-equivalence) is the
       tier-contract Case A assertion in `tests/tier-contract.test.ts` (02-07), not a
       probe — also not in this file.

       ## TTY render — header

       > pensmith doctor — environment + capability probe

       ## TTY render — footer (PASS)

       > All probes PASS or WARN. No FAIL. Exit 0.

       ## TTY render — footer (FAIL)

       > One or more probes FAILed. Exit 1. See detail above.

       ## Probe summary copy (locked per-probe)

       ### node-version (DOCT-01)
       > Node.js runtime version probe — pensmith requires >=20.10.0.

       ### mcp-sdk-presence (DOCT-01 wiring)
       > MCP server build artifact presence — dist/mcp/server.js must exist and be non-empty.

       ### http-contact-email (DOCT-03)
       > PENSMITH_CONTACT_EMAIL environment variable presence — see references/http-warnings.md for the full WARN copy.

       ### sync-folder-detection (DOCT-04)
       > .paper/ inside cloud sync folder (OneDrive / iCloud / Dropbox / Google Drive) detection — WARN if matched.

       ### runtime-config-presence (DOCT-07)
       > Runtime config provider API-key resolvability — WARN if no provider has its env-var set. Per-provider `{name, apiKeyEnv, present:boolean}` shape only — the resolved value never leaves loadRuntimeConfig (symmetric to T-01-07 / D-12).

       ### zotero-mcp-presence (DOCT-02 ecosystem)
       > Zotero MCP server reachable via the user's ~/.claude/.mcp.json — WARN if not configured. Optional dependency surfaced for Phase 3+ intake.

       ### pandoc-presence (DOCT-02 ecosystem)
       > Pandoc binary on PATH — WARN if not found. Required by Phase 10 export.

       ### humanizer-skill-presence (DOCT-02 ecosystem)
       > Humanizer skill at ~/.claude/skills/humanizer/ — WARN if missing. Optional Phase 8 dependency.

       ## JSON shape

       `pensmith doctor --json` emits:

       ```json
       {
         "schemaVersion": 1,
         "probes": {
           "node-version":             { "id": "...", "severity": "PASS|WARN|FAIL|SKIP", "summary": "...", "detail": "...", "fix": "..." },
           "mcp-sdk-presence":         { ... },
           "http-contact-email":       { ... },
           "sync-folder-detection":    { ... },
           "runtime-config-presence":  { ... },
           "zotero-mcp-presence":      { ... },
           "pandoc-presence":          { ... },
           "humanizer-skill-presence": { ... }
         },
         "summary": { "pass": 0, "warn": 0, "fail": 0, "skip": 0 }
       }
       ```

       Keys under `probes` = `probe.id` (per D-20 — Record keyed by id, NOT an Array).
       The tier-contract test (02-07 Case A) compares Tier 1 `paper://capabilities`
       and Tier 2 `doctor --json` for capability-fact equivalence — the **boolean
       facts** must agree, even though the SHAPES differ by design.

       (Do NOT edit the wording above without also updating the SHA-256 hash pin in
       tests/repo-files.test.ts. The hash pin is the canonical drift sentinel.)
       ```

       This file is hash-pinned by the repo-files test below. ANY substantive edit must update the SHA-256 pin.

    3. **hooks/.gitkeep** — Create an empty file. (`hooks/` currently exists but is empty; the placeholder ensures git tracks the directory until 02-06 lands real hook files.)

    4. **tests/repo-files.test.ts** — Extend the existing tests file. Modifications:
       - In the `test('root config files exist', ...)` loop (lines 14-31), ADD: `'references/doctor-output.md'`, `'hooks/.gitkeep'`.
       - In `test('package.json contract', ...)` (lines 33-50), after the existing dev-deps assertion, ADD:
         ```typescript
         const deps = pkg['dependencies'] as Record<string, string> | undefined;
         assert.ok(deps && deps['citty'], 'package.json must declare citty dependency (D-14)');
         assert.match(deps?.['citty'] ?? '', /\^0\.2/, 'citty pin must satisfy ^0.2.2 (D-14)');
         ```
       - ADD a new test at the end of the file:
         ```typescript
         import { createHash } from 'node:crypto';

         // D-18: references/doctor-output.md is a single source of truth for DOCT copy.
         // We pin the file's exact bytes via SHA-256. ANY substantive change to the
         // locked copy MUST be paired with a hash-pin update in this test — making the
         // drift visible at PR-review time. Substring matching was rejected as too weak
         // (it would silently allow inserted lines, reordered probes, or rewritten copy
         // outside the matched fragments).
         test('references/doctor-output.md hash-pin (D-18)', () => {
           const bytes = readFileSync('references/doctor-output.md');  // raw bytes, no BOM strip
           const hash = createHash('sha256').update(bytes).digest('hex');
           // PINNED-HASH below: regenerate by running `node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('references/doctor-output.md')).digest('hex'))"`
           // after every intentional edit. The PR diff makes the change visible.
           const PINNED = '<<<COMPUTED-AT-COMMIT-TIME>>>';
           assert.equal(hash, PINNED, `references/doctor-output.md drifted from locked copy. Update PINNED to ${hash} if the edit was intentional.`);
         });

         // Coarse-grained content sentinel — catches gross removals even before the
         // hash pin gets a chance to re-fire (e.g., file wiped to empty).
         test('references/doctor-output.md retains the 7 Phase-2 probe section anchors', () => {
           const copy = read('references/doctor-output.md');
           assert.match(copy, /# Doctor Output Strings \(locked — D-18\)/);
           assert.match(copy, /node-version \(DOCT-01\)/);
           assert.match(copy, /mcp-sdk-presence \(DOCT-01 wiring\)/);
           assert.match(copy, /http-contact-email \(DOCT-03\)/);
           assert.match(copy, /sync-folder-detection \(DOCT-04\)/);
           assert.match(copy, /runtime-config-presence \(DOCT-07\)/);
           assert.match(copy, /zotero-mcp-presence \(DOCT-02 ecosystem\)/);
           assert.match(copy, /pandoc-presence \(DOCT-02 ecosystem\)/);
           assert.match(copy, /humanizer-skill-presence \(DOCT-02 ecosystem\)/);
           // Anti-drift: DOCT-05 wiring-smoke MUST NOT appear (deferred to Phase 3 — D-04).
           assert.equal(/wiring-smoke|DOCT-05/.test(copy), false, 'DOCT-05 / wiring-smoke must NOT appear in Phase 2 doctor copy (deferred per D-04)');
         });
         ```

       **Executor note:** When you commit this plan, replace `<<<COMPUTED-AT-COMMIT-TIME>>>` with the actual sha256 of the freshly-written `references/doctor-output.md`. Compute it with:
       ```bash
       node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('references/doctor-output.md')).digest('hex'))"
       ```
       Paste the output as the value of `PINNED`. Future intentional edits regenerate this hash; PR diff makes the change visible.

       Do NOT yet add the CONTRIBUTING.md "Tier contract — do not skip" assertion — that lands in 02-08 to keep the assertion-vs-content commits paired.

    5. Verify: `npm run lint && npm run typecheck && node scripts/run-tests.mjs tests/repo-files.test.ts`.
  </action>
  <verify>
    <automated>node scripts/run-tests.mjs tests/repo-files.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "\"citty\":" package.json` returns at least 1
    - `grep -c "\"@clack/prompts\":" package.json` returns at least 1
    - `grep -c "0.2" package.json` includes the citty pin (manual visual confirmation: the citty entry is `"citty": "^0.2.2"`)
    - `node_modules/@clack/prompts/package.json` exists (npm install completed for the prompts dep)
    - `test -f references/doctor-output.md` succeeds
    - `grep -c "DOCT-01" references/doctor-output.md` >= 1
    - `grep -c "DOCT-07" references/doctor-output.md` >= 1
    - `grep -c "DOCT-02 ecosystem" references/doctor-output.md` >= 3 (zotero-mcp + pandoc + humanizer)
    - `grep -c "wiring-smoke\|DOCT-05" references/doctor-output.md` returns 0 (DOCT-05 deferred to Phase 3)
    - `test -f hooks/.gitkeep` succeeds
    - `grep -c "references/doctor-output.md" tests/repo-files.test.ts` >= 2 (existence loop + new test block)
    - `grep -c "createHash\|sha256" tests/repo-files.test.ts` >= 1 (hash-pin assertion present)
    - `grep -c "citty" tests/repo-files.test.ts` >= 1
    - `node scripts/run-tests.mjs tests/repo-files.test.ts` exits 0
    - `node_modules/citty/package.json` exists (npm install completed)
    - `npm run lint && npm run typecheck` both exit 0
  </acceptance_criteria>
  <done>
    package.json declares citty@^0.2.2; references/doctor-output.md exists with the locked DOCT-01..06 copy; hooks/.gitkeep exists; tests/repo-files.test.ts asserts all four; lint + typecheck + tests green.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| External HTTP response → http.ts retry path | Server-controlled Retry-After header is parsed; malformed input must not crash the client |
| package.json edit → npm install → node_modules | Untrusted-by-default package contents reach the developer machine on `npm install` |
| references/doctor-output.md → bin/cli/doctor.ts at runtime | Locked-copy reader (lands 02-05); regex-strips `> ` markdown prefix — must not be poisoned with shell-meta characters |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-00-01 | Tampering / DoS | parseRetryAfter input | mitigate | Function never throws; invalid input collapses to 0 so caller falls back to fullJitter (Task 1 acceptance criteria test 5 + 6 + 9) |
| T-02-00-02 | DoS | Malicious server sets Retry-After: "999999999999" | mitigate | parseRetryAfter caps via natural JS integer math; subsequent retry() obeys its own maxAttempts (5) and capMs (30_000) — caller never sleeps longer than the cap because the wrapped fn timeout supersedes (existing http.ts behavior). Acceptance: existing http test suite still green. |
| T-02-00-03 | Information Disclosure | references/doctor-output.md leaked secrets | accept | This file is a locked-copy doc, no env-var values, no secrets. Hash-pinned by repo-files test. |
| T-02-00-04 | Supply chain | citty@^0.2.2 install | accept | Pin chosen by user (D-14); citty is UnJS-maintained, used by nuxt/nitro; no native modules. `npm ci` reproducibility via package-lock.json. |
| T-02-00-05 | DoS (clock skew) | parseRetryAfter HTTP-date past-time | mitigate | Past dates clamp to 0 (Task 1 test 8). Caller falls back to fullJitter immediately. |
</threat_model>

<verification>
- All three tasks green per their acceptance criteria.
- `npm run check` exits 0 locally (lint + typecheck + test + validate:manifests).
- No file outside `files_modified` is changed.
- Phase 1 retry / http tests remain green (no regression).
</verification>

<success_criteria>
- Contributes to SC-5 (CONTRIBUTING.md gate) indirectly via `references/doctor-output.md` hash-pin
- Contributes to SC-1 (doctor returns PASS) indirectly via doctor copy + citty dep
- Carry-forward CF-D01 (parseRetryAfter pure function) closed
- Wave 0 prerequisites for waves 1-4 are in place (citty dep, hooks/ dir, doctor copy, repo-files smoke)
</success_criteria>

<output>
After completion, create `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-00-SUMMARY.md` per `$HOME/.claude/get-shit-done/templates/summary.md`.
</output>
