# Phase 14: Fail-closed verifier gate — Pattern Map

**Mapped:** 2026-06-24
**Files analyzed:** 9 (5 new, 4 modified)
**Analogs found:** 9 / 9

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `bin/lib/verify/verdict-rows.ts` (NEW) | utility | transform | `bin/lib/verify/freshness.ts` (renderFreshnessTable) + `bin/lib/compile.ts` (failingCitekeys) | role-match (extracted from two existing functions) |
| `bin/lib/compile.ts` (MODIFIED — GATE-01 + GATE-02) | service | CRUD | self (`compile.ts` lines 271-279, 135-147) | exact |
| `bin/cli/verify.ts` (MODIFIED — GATE-02 writer) | controller | request-response | self (`verify.ts` lines 148-168) | exact |
| `bin/lib/verify/pass1.ts` (MODIFIED — GATE-03) | service | request-response | `bin/lib/verify/freshness.ts` (retraction-watch call pattern) | role-match |
| `bin/cli/done.ts` (MODIFIED — GATE-04) | controller | request-response | self (`done.ts` lines 411-453, runDoneGate blocking pattern) | exact |
| `tests/verdict-rows.test.ts` (NEW) | test | transform | `tests/compile-refuse.test.ts` | exact |
| `tests/gate03-live-retraction.test.ts` (NEW) | test | request-response | `tests/freshness-probe.test.ts` | role-match |
| `tests/gate04-final-recheck.test.ts` (NEW) | test | request-response | `tests/compile-refuse.test.ts` | role-match |
| `tests/fixtures/cassettes/retraction-watch/gate03-blocking-doi.json` (NEW) | config | — | `tests/fixtures/cassettes/retraction-watch/fetchById-fake.json` | exact |

---

## Pattern Assignments

### `bin/lib/verify/verdict-rows.ts` (NEW — utility, transform)

**Analogs:** `bin/lib/compile.ts:135-147` (parser side) and `bin/cli/verify.ts:155-159` (writer side).

This module is extracted FROM these two existing code paths — it does not introduce new patterns; it unifies existing ones.

**Imports pattern** — follow freshness.ts (a pure, no-I/O verify-submodule):

No imports needed. The module is pure TypeScript with no dependencies (no fs, no network, no path). Model after `bin/lib/citation-token.ts` lines 1-29 which is the project's canonical pure-utility module.

**Core pattern — parser side** (from `bin/lib/compile.ts` lines 134-147):
```typescript
/** Collect EVERY failing-verdict citekey from a VERIFICATION.md (refuse-gate). */
function failingCitekeys(verificationMd: string): string[] {
  const out: string[] = [];
  for (const line of verificationMd.split(/\r?\n/)) {
    // `- <citekey>: **VERDICT**` OR `- <citekey> ("quote…"): **VERDICT**`
    const m = /^\s*-\s*([a-z][a-z0-9_-]*)\s*[:(].*?\*\*([A-Z_-]+)\*\*/.exec(line);
    if (!m) continue;
    const citekey = m[1];
    const verdict = m[2];
    if (citekey === undefined || verdict === undefined) continue;
    if (REFUSING_VERDICTS.has(verdict)) out.push(citekey);
  }
  return out;
}
```

**Core pattern — writer side** (from `bin/cli/verify.ts` lines 155-159):
```typescript
...pass1.map((r) => `- ${r.citekey}: **${r.verdict}** — titleJW=${r.titleJW.toFixed(2)}, authorJW=${r.authorJW.toFixed(2)} — ${r.reason}`)
...pass3.map((r) => `- ${r.citekey} ("${r.quoteSnippet}…"): **${r.verdict}** — lev=${r.levRatio.toFixed(3)} — ${r.reason}`)
```

**Constant naming** — mirror `REFUSING_VERDICTS` from compile.ts line 62:
```typescript
const REFUSING_VERDICTS = new Set(['FABRICATED', 'MIS-CITED', 'NOT_FOUND']);
```
In `verdict-rows.ts`, rename to `BLOCKING_VERDICTS` (the new module owns the set; compile.ts will import it or use `parseVerdictRows`).

**Pure-module comment header** — copy from `bin/lib/citation-token.ts` lines 19-20:
```typescript
// PURE module: no I/O, no side effects. Every function is referentially
// transparent (same input → same output).
```

---

### `bin/lib/compile.ts` (MODIFIED — GATE-01 + GATE-02)

**Analog:** Self. Exact lines to modify are lines 134-147 and lines 271-279.

**GATE-01: fail-closed VERIFICATION.md read** — replace lines 271-279:

Current code (lines 271-279 — the fail-OPEN path):
```typescript
const verifPath = join(
  paperDir(opts.paperRoot), 'sections', `${String(os.n).padStart(2, '0')}-${os.slug}`, 'VERIFICATION.md',
);
const verificationMd = existsSync(verifPath) ? readFileSync(verifPath, 'utf8') : '';

// Refuse-gate (COMP-01): any fresh failing verdict blocks.
for (const ck of failingCitekeys(verificationMd)) {
  refuseReasons.push(`section ${os.n} (${os.slug}): citation [@${ck}] has a blocking verdict (FABRICATED/MIS-CITED/NOT_FOUND)`);
}
```

GATE-01 adds a `hasStatus` guard immediately after the read, before the citekey parse. The `continue` pattern (skip further processing for this section, the section is already refused) is already used at line 265-268:
```typescript
if (!sec) {
  refuseReasons.push(`section ${os.n} (${os.slug}): missing PLAN.md or DRAFT.md`);
  continue;
}
```

Copy the same `continue`-after-push pattern for the GATE-01 refuse.

**GATE-02: replace `failingCitekeys` call with `parseVerdictRows`**

The inline `failingCitekeys` function (lines 135-147) is replaced by an import from `verdict-rows.ts` and a call to `parseVerdictRows`. The import block (lines 38-59) is the model — add:
```typescript
import { parseVerdictRows } from './verify/verdict-rows.js';
```

The refuseReasons assembly pattern (line 278 — existing) stays identical, only the function name changes.

**Staleness re-verify connection** (lines 282-303) — the GATE-01 `continue` must skip BOTH the verdict parse AND the staleness check (both are in the `for (const os of ordered)` loop body). The existing `if (!sec) { ...; continue; }` at line 265 skips the full remainder of the loop body. GATE-01's `continue` must do the same — it is placed inside the section loop after the `loaded.push(sec)` call but before the staleness block.

---

### `bin/cli/verify.ts` (MODIFIED — GATE-02 writer)

**Analog:** Self. Lines 155-159 are the writer side.

**Import addition** — add to the existing import block (lines 22-32):
```typescript
import { renderPass1VerdictRow, renderPass3VerdictRow } from '../lib/verify/verdict-rows.js';
```

**Template literal replacement** — lines 155-159 (the two `...pass1.map(...)` and `...pass3.map(...)` calls) are replaced with calls to `renderPass1VerdictRow` and `renderPass3VerdictRow`. The `lines` array assembly pattern (lines 148-167) does not change shape — only the map callbacks are delegated to the shared module.

The `atomicWriteFile` write at line 168 and the return shape at line 170 are unchanged.

---

### `bin/lib/verify/pass1.ts` (MODIFIED — GATE-03)

**Primary analog:** `bin/lib/verify/freshness.ts` lines 27 and 131-145 — the import and retraction-watch call pattern.

**Import to add** (mirror freshness.ts line 27):
```typescript
import { fetchById as retractionWatchFetchById } from '../sources/retraction-watch.js';
```

freshness.ts already does this import at line 27:
```typescript
import { fetchById as retractionWatchFetchById } from '../sources/retraction-watch.js';
```

**Adapter call pattern** (freshness.ts lines 131-145 — the try/catch + null-check shape):
```typescript
// --- Retraction Watch cross-check (real cassette-backed adapter) ---
try {
  const hit = await retractionWatchFetchById(normalized);
  if (hit) {
    const why = hit.retraction_details ? ` (${hit.retraction_details})` : '';
    warnings.push({
      probe: 'retraction-watch',
      status: 'WARN',
      detail: `cited work appears in Retraction Watch${why}`,
    });
  }
} catch (err) {
  // Same noise policy as the HEAD probe — never block on a probe failure.
  debug(`...retraction-watch error: ${String(err)} — silent`);
}
```

**GATE-03 differs in one key way**: `fetchById` already returns `null` on error (retraction-watch.ts lines 122-126 — the catch block returns null, never throws). No try/catch is needed in pass1.ts. The check is simply:
```typescript
const liveRetraction = await retractionWatchFetchById(claimed.DOI);
if (liveRetraction !== null) { return { citekey: ck, verdict: 'MIS-CITED', ... }; }
```

**Insertion point in `verdictForCitekey`** — after `const actual = await sources.crossref.fetchById(claimed.DOI)` succeeds (pass1.ts line 126) and after the null-guard at line 127-131. The existing `claimed.retracted` block (lines 113-118) is the shape precedent for a short-circuit MIS-CITED return from inside `verdictForCitekey`:
```typescript
if (claimed.retracted) {
  return {
    citekey: ck, verdict: 'MIS-CITED', titleJW: 0, authorJW: 0,
    reason: 'cited a retracted work (per Retraction Watch cross-check at research time)',
  };
}
```
Copy this exact return shape for the GATE-03 live-retraction return.

---

### `bin/cli/done.ts` (MODIFIED — GATE-04)

**Analog:** Self. The DONE-09 gate at lines 133-154 is the blocking-return precedent.

**`reCheckFinalMd` helper function** — a new async helper (can live in `done.ts` above the command definition or in a small separate module). It returns `{ passed: boolean; reason: string }`.

Pattern for the return type: `DoneGateResult` (lines 80-83) and the `runDoneGate` function (lines 133-154) — both return typed result objects, never throw. Mirror that shape.

**Bib-read pattern** — `bin/cli/verify.ts` lines 108-119 is the canonical `parseBibtex` + `bibByCitekey` construction:
```typescript
const bibEntries = await parseBibtex(readFileSync(bibPath, 'utf8'));
const bibByCitekey = new Map<string, BibValue>(
  bibEntries.map((e) => [String((e as { id?: string }).id ?? ''), e as BibValue]),
);
```
Copy this exact pattern. The `BibLike = { DOI?: string }` type from pass3.ts line 43 is sufficient for the `bibByCitekey` value type in the GATE-04 context.

**Citekey-set diff** — `extractCitekeys` from `bin/lib/citation-token.ts` lines 39-53:
```typescript
export function extractCitekeys(md: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = new RegExp(CITATION_TOKEN_RE.source, 'g');
  for (const m of md.matchAll(re)) {
    const key = m[1];
    if (key === undefined) continue;
    if (!seen.has(key)) { seen.add(key); out.push(key); }
  }
  return out;
}
```

Import it (compile.ts already imports it at line 47):
```typescript
import { extractCitekeys } from '../lib/citation-token.js';
```

**Blocking-return pattern** — the short-circuit return in done.ts lines 449-453:
```typescript
if (gateResult.exported === false && gateResult.gateSkipped !== true) {
  process.stdout.write('pensmith done: export cancelled by user.\n');
  return { ok: false };
}
```
GATE-04 uses the same `return { ok: false }` pattern but fires BEFORE `runDoneGate`. Message format follows the same `pensmith done: <reason>` prefix convention used throughout done.ts.

**Null-guard / skip** — the `finalPath !== null` guard mirrors the existing pattern at lines 415-421:
```typescript
if (finalPath !== null) {
  try {
    after = await scoreHonesty(readFileSync(finalPath, 'utf8'));
  } catch { after = null; }
}
```
GATE-04's skip condition is `if (finalPath === null) return { passed: true, reason: '' }` inside `reCheckFinalMd`, or equivalently `if (finalPath !== null && args.yolo !== true) { ... }` at the call site.

**Insertion point** — after line 421 (end of `scoreHonesty` block) and before line 433 (`pass2Results` read and `runDoneGate` call).

**Imports to add** to done.ts:
```typescript
import { runPass3 } from '../lib/verify/pass3.js';
import { extractCitekeys } from '../lib/citation-token.js';
import { parseBibtex } from '../lib/citations.js';
```
(runPass3 and extractCitekeys are not currently imported in done.ts; parseBibtex is imported in verify.ts at line 30 — same import path.)

---

## Test Pattern Assignments

### `tests/verdict-rows.test.ts` (NEW — round-trip test)

**Analog:** `tests/compile-refuse.test.ts` lines 1-50 — header comment structure, `node:test` + `node:assert/strict` imports, pure in-memory fixtures (no tmpdir needed here).

**Test framework pattern** (compile-refuse.test.ts lines 23-28):
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCompile } from '../bin/lib/compile.js';
```
For verdict-rows.test.ts: no tmpdir, no fs — pure string in/out. Import only:
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPass1VerdictRow, renderPass3VerdictRow, parseVerdictRows } from '../bin/lib/verify/verdict-rows.js';
```

**Set-comparison pattern** — the round-trip must use `new Set(failing)` comparison, NOT `deepEqual` on arrays (order not guaranteed). Model after compile-refuse.test.ts line 136:
```typescript
const reasons = (result.refuseReasons ?? []).join(' ');
assert.match(reasons, /jones2019/, '...');
```
But for the round-trip, use:
```typescript
assert.deepEqual(new Set(failing), new Set(['smith2020', 'jones2019']));
```

**Mutation test shape** — a deliberate format-drift mutation (change `**FABRICATED**` to `**FABRICATD**`) and assert `parseVerdictRows` returns `[]` for that row. This is a new test shape with no direct analog; it is a simple string-replace + assert.

---

### `tests/gate03-live-retraction.test.ts` (NEW — cassette-backed pass1 test)

**Analog:** `tests/freshness-probe.test.ts` — the definitive model. Both tests are cassette-backed, offline-only, testing a single function from the verify/ directory.

**Full structural pattern** (freshness-probe.test.ts lines 1-73):
- Header comment naming the requirement (RSCH-10 / D-10)
- Import the function under test from `../bin/lib/verify/...`
- Define DOI constants at top (OK_DOI, RETRACTED_DOI, etc.)
- Each test is one `test(...)` block with a clear description
- No tmpdir — all fixture data is inline (the cassette handles the network layer)

For gate03, the "retracted DOI" is `10.0000/test` (from `fetchById-fake.json`) or a dedicated `gate03-blocking-doi.json` cassette DOI. Set the `PENSMITH_OFFLINE=1` env behavior — the cassette infrastructure handles this automatically when tests run.

**Import pattern** (freshness-probe.test.ts line 20):
```typescript
import { probeFreshness } from '../bin/lib/verify/freshness.js';
```
For gate03:
```typescript
import { runPass1Unit } from '../bin/lib/verify/pass1.js';
```
But GATE-03 modifies `verdictForCitekey` which is called by `runPass1` / `runPass1Unit`. The test needs to supply a bib entry with a matching DOI and confirm the verdict. Follow `tests/known-bad-citations.test.ts` lines 58-76 for `runPass1Unit` call shape.

**Transport-error silent-skip test** — model after freshness-probe.test.ts lines 60-67:
```typescript
test('freshness: transport error (no cassette / ECONNREFUSED) is SILENT — no WARN', async () => {
  // No cassette for this DOI ...
  const r = await probeFreshness('ghost2099', NO_CASSETTE_DOI);
  const doiWarn = r.warnings.find((w) => w.probe === 'DOI HEAD');
  assert.equal(doiWarn, undefined, 'transport noise must NOT produce a WARN');
});
```
For GATE-03: supply a DOI with no cassette entry and confirm the verdict is NOT MIS-CITED (it should be whatever the JW comparison yields).

---

### `tests/gate04-final-recheck.test.ts` (NEW — done.ts integration test)

**Analog:** `tests/compile-refuse.test.ts` — the tmpdir-seeded paper structure pattern.

The GATE-04 helper (`reCheckFinalMd`) is a pure async function taking strings, so it can be tested without a full paper root. Import and call directly:

**Minimal test shape:**
```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
// Import reCheckFinalMd once it is exported from done.ts or factored to a lib.
```

For tests that need a bib path with real content, use the tmpdir pattern (compile-refuse.test.ts lines 49-109):
```typescript
const root = mkdtempSync(join(tmpdir(), 'pensmith-gate04-'));
mkdirSync(join(root, '.paper'), { recursive: true });
writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '');
```

The **absent-bib skip** test (GATE-04 skips cleanly when no bib) uses the `existsSync` check inside `reCheckFinalMd` — the test writes no bib file and confirms `passed: true`.

---

### `tests/fixtures/cassettes/retraction-watch/gate03-blocking-doi.json` (NEW)

**Analog:** `tests/fixtures/cassettes/retraction-watch/fetchById-fake.json` (exact shape to copy).

The cassette file `fetchById-fake.json` (lines 1-22) is the complete copy template:
```json
[
  {
    "scope": "https://api.labs.crossref.org",
    "method": "GET",
    "path": "/data/retractions?filter=record:10.0000/test",
    "status": 200,
    "response": {
      "items": [
        {
          "doi": "10.0000/test",
          "title": "A Fake Retracted Paper (Synthetic Fixture)",
          "authors": [{ "given": "John", "family": "Doe" }],
          "year": 2010,
          "retractedDate": "2015-03-15",
          "reason": "fabricated data"
        }
      ]
    },
    "responseHeaders": { "content-type": "application/json" }
  }
]
```
Replace `10.0000/test` with `10.0000/gate03-retracted` and update `"title"` and `"reason"` to distinguish from the existing cassette.

---

## Shared Patterns

### Atomic file write (D-07 chokepoint)
**Source:** `bin/lib/atomic-write.ts` via `atomicWriteFile`
**Apply to:** All file writes in verify.ts (line 168), done.ts (line 483)
**Pattern** (verify.ts line 168):
```typescript
await atomicWriteFile(verifPath, lines.join('\n'));
```
GATE-04 does NOT write any new files — it reads FINAL.md and blocks or passes. No new `atomicWriteFile` calls in GATE-04.

### Blocking refuse-reason assembly (COMP-01 collect-all-then-refuse)
**Source:** `bin/lib/compile.ts` lines 262-307
**Apply to:** GATE-01 changes in compile.ts
**Pattern:** collect ALL refuse reasons before checking `refuseReasons.length > 0`. Do NOT short-circuit after the first refuse. The GATE-01 `continue` skips further processing for THAT section but the outer loop continues processing remaining sections.

### Transport-error = silent skip (never false-block)
**Source:** `bin/lib/sources/retraction-watch.ts` lines 122-126; `bin/lib/verify/freshness.ts` lines 142-145
**Apply to:** GATE-03 in pass1.ts, GATE-04 transport path
**Pattern:**
```typescript
} catch {
  return null;  // transport noise — never block on a fetch failure
}
```
In GATE-03: `fetchById` already never throws (catch returns null). No wrapper needed in pass1.ts.

### `--yolo` bypass pattern
**Source:** `bin/cli/done.ts` lines 140-142 (`runDoneGate`)
**Apply to:** GATE-04 skip condition in done.ts
**Pattern:**
```typescript
if (input.yolo === true) {
  return { gateSkipped: true };
}
```
GATE-04 uses the same `args.yolo === true` guard at the call site.

### Offline cassette dispatch
**Source:** `bin/lib/sources/retraction-watch.ts` lines 94-96; `bin/lib/http-mock.ts`
**Apply to:** GATE-03 test cassette, GATE-04 pass3 offline path
**Pattern:**
```typescript
if (isOfflineMode()) {
  const cassette = loadCassetteFile('retraction-watch', 'fetchById-fake');
  ...
}
```
No new cassette dispatch code needed in pass1.ts — the existing `fetchById` adapter owns this.

### Pure-module pattern (no I/O, no side effects)
**Source:** `bin/lib/citation-token.ts` lines 19-68
**Apply to:** `bin/lib/verify/verdict-rows.ts`
**Pattern:** no imports from `node:fs`, `node:path`, or any network adapter. Export only pure functions. Comment header declares "PURE module: no I/O, no side effects."

---

## No Analog Found

All files in Phase 14 have close analogs. No entries in this section.

---

## Metadata

**Analog search scope:** `bin/lib/`, `bin/cli/`, `bin/lib/verify/`, `bin/lib/sources/`, `tests/`, `tests/fixtures/cassettes/`
**Files scanned:** 14 (read directly), ~20 (globbed for structure)
**Pattern extraction date:** 2026-06-24
