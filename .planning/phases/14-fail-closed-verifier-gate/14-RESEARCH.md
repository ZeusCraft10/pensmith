# Phase 14: Fail-closed verifier gate — Research

**Researched:** 2026-06-24
**Domain:** Compile-gate hardening / verifier integrity (TypeScript, Node.js test runner)
**Confidence:** HIGH — all findings are derived from direct inspection of the committed codebase; no external library research required.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- GATE-01: compile refuses on absent/empty/no-parseable-status VERIFICATION.md. The only currently-trusted read (line 274) `existsSync(verifPath) ? readFileSync(verifPath, 'utf8') : ''` must become a fail-closed read: absent file, empty/whitespace file, or file with no parseable `## Status` / verdict line is itself a refuse reason. Only a VERIFICATION.md that parses AND shows a clean verdict set permits compile.
- GATE-02: extract one module `bin/lib/verify/verdict-rows.ts` exporting a matched pair: `renderVerdictRow` / `renderVerdictTable` (writer, used by verify.ts) and `parseVerdictRows(text)` → set of failing citekeys (parser, used by compile.ts). Both call-sites import this single module. A writer→parser round-trip test is mandatory.
- GATE-03: at verify time, after resolving a citation's DOI, re-query Retraction Watch via the existing cassette-backed `fetchById` adapter and escalate a LIVE hit to MIS-CITED (blocking) in Pass-1's verdict path — not only the WARN-only freshness channel. Transport ERROR = silent skip, never a false block. Stored `claimed.retracted` flag stays as the offline-fast path.
- GATE-04: after `runHumanizer` produces `.paper/FINAL.md` and BEFORE `exportDraft`, run: (a) deterministic Pass-3 quote verification on FINAL.md's quotes, and (b) citekey-set diff — `[@key]` tokens in FINAL.md must equal the set in compiled DRAFT.md. NOT_FOUND or citekey-set mismatch BLOCKS export (hard block, only `--yolo` overrides). Absent humanizer / no FINAL.md → skip cleanly.
- Invariants: deterministic Pass-1/Pass-3 remain blocking; advisory Pass-2/Pass-4 stay advisory. GATE-03/04 are deterministic-or-degrade (transport error = silent skip). 16-verb bijection unchanged. All network via http.ts; offline cassette tests; no key/PII leak.

### Claude's Discretion

No discretion areas were specified — all implementation details were locked in the CONTEXT.md decisions above.

### Deferred Ideas (OUT OF SCOPE)

- Full SSRF guard on the retraction re-query's network path (HARD-02 → Phase 15).
- Unverifiable-quote 4th DONE-09 advisory bucket (UVQ-01 → v2/Future).
- Pass-2/Pass-4 advisory recalibration (stay advisory, no change).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GATE-01 | Compile refuses when a section's VERIFICATION.md is missing or has no parseable status | §GATE-01 analysis: exact current code path (compile.ts:274), minimal fail-closed change |
| GATE-02 | Refuse-gate verdict rows produced/parsed by a shared render+parse pair, round-trip tested | §GATE-02 analysis: exact writer format (verify.ts:155-159), exact parser regex (compile.ts:139), extraction strategy |
| GATE-03 | Verification re-queries Retraction Watch on resolved DOI at verify time, escalates live hit to MIS-CITED | §GATE-03 analysis: fetchById signature, cassette keying, exact insertion point in pass1.ts |
| GATE-04 | Humanized FINAL.md re-checked (Pass-3 + citekey-set diff) before export | §GATE-04 analysis: pass3 signature, insertion point in done.ts, citekey-set diff helper |
</phase_requirements>

---

## Summary

Phase 14 closes four independently-exploitable fail-open holes in the verifier gate. Every hole was confirmed by reading the live code in this session — this is not speculative. The research findings are grounded in exact file:line evidence.

**GATE-01** is the most dangerous hole: `compile.ts:274` reads `existsSync(verifPath) ? readFileSync(verifPath, 'utf8') : ''`. An empty string fed to `failingCitekeys('')` returns `[]`, which the refuse-gate interprets as "no failing verdicts → clean". A section that was never verified, or whose VERIFICATION.md was deleted, silently passes compile. The fix requires a structural VERIFICATION.md validity check BEFORE the failing-citekey parse.

**GATE-02** is a latent drift hazard: `verify.ts` writes verdict rows with template literals (e.g. `- ${r.citekey}: **${r.verdict}** — titleJW=...`) and `compile.ts` parses them with a separate regex (`/^\s*-\s*([a-z][a-z0-9_-]*)\s*[:(].*?\*\*([A-Z_-]+)\*\*/`). These are manually synchronized today. Extracting a shared `verdict-rows.ts` with a matched render+parse pair and a round-trip test closes this hazard permanently.

**GATE-03** requires a minimal surgical change to `verdictForCitekey` in `pass1.ts`: after the existing `claimed.retracted` fast-path check and after DOI resolution, call `fetchById(claimed.DOI)` from the retraction-watch adapter. A non-null result escalates the verdict to MIS-CITED. A thrown error (transport failure) is caught and silently skipped — exactly mirroring the `freshness.ts` precedent. The cassette infrastructure already exists (two committed cassettes cover the DOI `10.0000/test` and `10.0000/retracted`).

**GATE-04** requires inserting a blocking re-check into `done.ts` between the `runHumanizer` call (line 414) and the `exportDraft` call (line 474). The re-check uses `runPass3` (already importable, same signature) and `extractCitekeys` from `citation-token.ts` (already importable). The only new code is the citekey-set equality check and the FINAL.md read.

**Primary recommendation:** implement in dependency order — GATE-02 first (the shared module that GATE-01 also uses), then GATE-01 (uses the new parser), then GATE-03 (isolated to pass1.ts), then GATE-04 (isolated to done.ts).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Verifier-gate refuse (GATE-01) | API / Backend (`compile.ts`) | — | Compile is the sole writer of DRAFT.md; the gate lives in the pipeline orchestrator |
| Verdict format contract (GATE-02) | Shared lib (`verify/verdict-rows.ts`) | CLI layer (`verify.ts` + `compile.ts`) | Format is shared between writer and reader; must live in a dependency-free utility |
| Live retraction re-query (GATE-03) | API / Backend (`verify/pass1.ts`) | Source adapter (`retraction-watch.ts`) | Deterministic per-citation verdict computation; adapter is already the right interface |
| FINAL.md re-check (GATE-04) | API / Backend (`done.ts`) | Shared lib (`verify/pass3.ts`, `citation-token.ts`) | Export orchestrator owns the export decision; delegates to existing deterministic checkers |

---

## Standard Stack

This phase introduces NO new external dependencies. Every required capability is already present in the committed codebase.

### Core (existing — reused)

| Module | File | Purpose | Why Standard |
|--------|------|---------|--------------|
| `runPass3` | `bin/lib/verify/pass3.ts` | Deterministic quote verification | Already the Phase-3 blocking checker; same signature works on any markdown text |
| `fetchById` | `bin/lib/sources/retraction-watch.ts` | Live retraction lookup | Already cassette-backed; already used in `freshness.ts` |
| `extractCitekeys` | `bin/lib/citation-token.ts` | `[@key]` set extraction | Already used in `compile.ts`, `exporter.ts`; exactly what GATE-04 citekey-set diff needs |
| `atomicWriteFile` | `bin/lib/atomic-write.js` | Safe file writes | D-07 chokepoint — all file writes must route here |
| `isOfflineMode` / `loadCassetteFile` | `bin/lib/http-mock.ts` | Offline cassette dispatch | Already the cassette infrastructure used by retraction-watch and freshness |

### New (internal — no npm install)

| Module | File | Purpose |
|--------|------|---------|
| `verdict-rows.ts` | `bin/lib/verify/verdict-rows.ts` | GATE-02 shared render+parse pair |

### No New npm Packages

This phase requires zero new package installs. Do not add any.

---

## Package Legitimacy Audit

No new packages are installed in this phase. Section intentionally omitted.

---

## Architecture Patterns

### System Architecture Diagram

```
pensmith compile
      |
      v
[loadSection loop]
      |
      v  (GATE-01 NEW)
[VERIFICATION.md validity check]
  absent/empty/no-status --> REFUSE reason (fail-closed)
  parseable             --> |
                            v
                    [parseVerdictRows(text)]   <-- (GATE-02) from verdict-rows.ts
                       failing citekeys --> REFUSE reason per key
                       all clean ---------> continue
      |
      v
[concat + smooth + export DRAFT.md]

pensmith verify <n>
      |
      v
[runPass1(draftMd, bibPath)]
      |
      v  (GATE-03 NEW)
[verdictForCitekey]
  claimed.retracted == true --> MIS-CITED (existing fast path)
  DOI resolves via Crossref --> |
                                v
                        [fetchById(doi)] from retraction-watch.ts
                          hit    --> MIS-CITED (blocking, NEW)
                          null   --> continue JW check
                          throw  --> silent skip (transport noise)
      |
      v
[write VERIFICATION.md via renderVerdictRow/renderVerdictTable]  <-- (GATE-02 writer)

pensmith done
      |
      v
[runHumanizer(draftMd, paperRoot)] --> FINAL.md (or null if skipped)
      |
      v  (GATE-04 NEW, only when FINAL.md != null)
[reCheckFinalMd(FINAL.md, DRAFT.md)]
  Pass-3 on FINAL.md quotes --> NOT_FOUND --> BLOCK
  citekey-set diff           --> mismatch  --> BLOCK
  all clear                  --> |
                                 v
                         [runDoneGate]
                                 |
                                 v
                         [exportDraft]
```

### Recommended Project Structure

No structural changes to the project layout. One new file:

```
bin/
└── lib/
    └── verify/
        ├── pass1.ts          (modified — GATE-03)
        ├── pass3.ts          (unchanged — reused by GATE-04)
        ├── verdict-rows.ts   (NEW — GATE-02)
        └── freshness.ts      (unchanged)
bin/cli/
    ├── verify.ts             (modified — GATE-02 writer side)
    └── done.ts               (modified — GATE-04)
bin/lib/
    └── compile.ts            (modified — GATE-01 + GATE-02 parser side)
tests/
    ├── compile-refuse.test.ts           (extended — GATE-01)
    ├── verdict-rows.test.ts             (NEW — GATE-02 round-trip)
    ├── gate03-live-retraction.test.ts   (NEW — GATE-03)
    └── gate04-final-recheck.test.ts     (NEW — GATE-04)
tests/fixtures/cassettes/retraction-watch/
    └── gate03-blocking-doi.json         (NEW cassette for GATE-03 test DOI)
```

---

## GATE-01: Exact Current Code Path and Fail-Closed Change

### Current code (compile.ts:271-278) — VERIFIED by direct read

```typescript
// compile.ts lines 271-279 (exact, as committed)
const verifPath = join(
  paperDir(opts.paperRoot), 'sections', `${String(os.n).padStart(2, '0')}-${os.slug}`, 'VERIFICATION.md',
);
const verificationMd = existsSync(verifPath) ? readFileSync(verifPath, 'utf8') : '';

// Refuse-gate (COMP-01): any fresh failing verdict blocks.
for (const ck of failingCitekeys(verificationMd)) {
  refuseReasons.push(`section ${os.n} (${os.slug}): citation [@${ck}] has a blocking verdict (FABRICATED/MIS-CITED/NOT_FOUND)`);
}
```

**The hole:** when `verifPath` is absent, `verificationMd = ''`. `failingCitekeys('')` returns `[]`. Zero refuse reasons are added. The section compiles as if verified.

**The same hole applies when VERIFICATION.md exists but:**
- Contains only whitespace (empty file)
- Contains "Status: unverifiable" with no verdict rows (the bib-missing / draft-missing unverifiable path written by `verify.ts:75-84`)
- Was manually truncated or partially written

### What a valid VERIFICATION.md looks like (verify.ts:148-167 — VERIFIED)

`verify.ts` writes the following structure for a completed run:

```
# VERIFICATION (Section N, slug)

Status: verified    ← the `Status: <word>` line on line 3
                      (may also be "failed" or "unverifiable")

## Pass-1 (citation integrity, deterministic — D-11 AND-gate)

- citekey: **OK** — titleJW=1.00, authorJW=1.00 — D-11 AND-gate passed

## Pass-3 (quote integrity, deterministic — levenshtein-substring)

...
```

The distinguishing structural markers of a verifier-written VERIFICATION.md:
1. Line 3 is `Status: <status>` (where `<status>` is `verified`, `failed`, or `unverifiable`)
2. At least one `## Pass-1` section heading is present
3. Verdict rows under Pass-1 match the row format: `- <citekey>: **<VERDICT>** — ...`

**Minimal fail-closed check:** after the `existsSync` / `readFileSync` pattern, add a validity gate:

```typescript
// GATE-01 fail-closed check
const hasStatus = /^Status:\s*\S/m.test(verificationMd);
if (!hasStatus) {
  refuseReasons.push(
    `section ${os.n} (${os.slug}): no verifiable VERIFICATION.md (section never verified or verifier output unreadable)`,
  );
  continue; // skip the failing-citekey parse for this section
}
```

The `Status:` line regex `/^Status:\s*\S/m` is the minimal discriminator:
- Absent file (`''`) → no match → refuse
- Whitespace-only file → no match → refuse
- The `Status: unverifiable\nReason: DRAFT.md missing` path written by verify.ts early-exit → HAS `Status:` → passes the validity gate but has zero verdict rows → `failingCitekeys` returns `[]` → this is correct behavior (unverifiable is a real status, not an absence of verification)
- A complete verified VERIFICATION.md → HAS `Status:` → proceeds to failing-citekey parse

**Important nuance:** `Status: unverifiable` sections currently produce zero failing citekeys (they have no `- citekey: **VERDICT**` rows), so they currently pass compile. This is an existing design choice (the section has real sources, the bib was just missing) and is NOT in scope for Phase 14. The GATE-01 requirement is specifically about sections with NO VERIFICATION.md at all, or files that have no parseable status line whatsoever.

---

## GATE-02: Writer Format vs Parser Regex — Exact Shapes

### Writer (verify.ts:155-159 — VERIFIED)

Pass-1 verdict rows are written as:
```typescript
// verify.ts line 155 (exact)
...pass1.map((r) => `- ${r.citekey}: **${r.verdict}** — titleJW=${r.titleJW.toFixed(2)}, authorJW=${r.authorJW.toFixed(2)} — ${r.reason}`)
```

Example output line:
```
- smith2020: **FABRICATED** — titleJW=0.00, authorJW=0.00 — citekey not in .paper/CITATIONS.bib (drafter invented)
```

Pass-3 verdict rows are written as:
```typescript
// verify.ts line 158 (exact)
...pass3.map((r) => `- ${r.citekey} ("${r.quoteSnippet}…"): **${r.verdict}** — lev=${r.levRatio.toFixed(3)} — ${r.reason}`)
```

Example output line:
```
- smith2020 ("the claimed quote…"): **NOT_FOUND** — lev=0.100 — quote not found in OA PDF
```

### Parser (compile.ts:135-147 — VERIFIED)

```typescript
// compile.ts lines 135-147 (exact — the `failingCitekeys` function)
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

The parser regex `/^\s*-\s*([a-z][a-z0-9_-]*)\s*[:(].*?\*\*([A-Z_-]+)\*\*/` handles both:
- `- smith2020: **FABRICATED**` (Pass-1 colon form)
- `- smith2020 ("quote…"): **NOT_FOUND**` (Pass-3 paren+colon form)

### The Drift Risk

Both the writer and parser are currently correct AND synchronized. The risk is future drift: if verify.ts is modified to use a different separator or bold marker format, the parser in compile.ts silently returns `[]` for those rows — which means a FABRICATED verdict row becomes invisible to the refuse-gate.

### Shared Module Design (`verdict-rows.ts`)

The shared module must export:

```typescript
// bin/lib/verify/verdict-rows.ts (proposed interface)

/** Render one Pass-1 verdict row (writer side). */
export function renderPass1VerdictRow(
  citekey: string, verdict: string, titleJW: number, authorJW: number, reason: string
): string;

/** Render one Pass-3 verdict row (writer side). */
export function renderPass3VerdictRow(
  citekey: string, quoteSnippet: string, verdict: string, levRatio: number, reason: string
): string;

/** Parse all failing citekeys from a VERIFICATION.md (parser side). */
export function parseVerdictRows(verificationMd: string): string[];
```

**verify.ts** replaces its template literals with calls to `renderPass1VerdictRow` / `renderPass3VerdictRow`.
**compile.ts** replaces its inline `failingCitekeys` function with a call to `parseVerdictRows`.

The human-readable VERIFICATION.md output does NOT change — the render functions produce the same string format that today's template literals produce. Only the code origin changes (one module, not two copies).

### Round-Trip Test Shape

The round-trip test (`tests/verdict-rows.test.ts`) asserts:

```typescript
// Render a set of verdicts → parse them back → get identical blocking set
const rows = [
  renderPass1VerdictRow('smith2020', 'FABRICATED', 0, 0, 'not in bib'),
  renderPass1VerdictRow('jones2019', 'MIS-CITED', 0.4, 0.3, 'JW below threshold'),
  renderPass1VerdictRow('vaswani2017', 'OK', 1.0, 1.0, 'D-11 AND-gate passed'),
  renderPass3VerdictRow('smith2020', 'the claimed quote', 'NOT_FOUND', 0.1, 'not found in PDF'),
];
const rendered = rows.join('\n');
const failing = parseVerdictRows(rendered);
// Must contain smith2020, jones2019 but NOT vaswani2017
assert.deepEqual(new Set(failing), new Set(['smith2020', 'jones2019']));
```

Additional mutation test: change `**FABRICATED**` to `**FABRICATD**` in a row → `parseVerdictRows` returns `[]` for that row → test fails → drift detected.

---

## GATE-03: Live Retraction Re-Query at Verify Time

### Adapter Signature (retraction-watch.ts:93 — VERIFIED)

```typescript
// bin/lib/sources/retraction-watch.ts line 93
export async function fetchById(doi: string): Promise<SourceCandidate | null>
```

Returns a `SourceCandidate` with `retracted: true` when the DOI is on the retraction list, or `null` when it is not. **Never throws** — the live path wraps the HTTP call in `try/catch` and returns `null` on error (line 122-125):

```typescript
  } catch {
    return null;
  }
```

**Critical:** The adapter already returns `null` on transport failure. This means: `if (await fetchById(doi) !== null)` is already transport-safe — a transport error yields `null`, not an exception. No additional try/catch is needed in pass1.ts for the transport-failure case.

### Cassette Keying (retraction-watch.ts:95-113 — VERIFIED)

In offline mode, `fetchById` calls `loadCassetteFile('retraction-watch', 'fetchById-fake')`. The cassette matching logic is:

```typescript
// retraction-watch.ts lines 97-113 (exact)
const direct = cassette.find(
  (c) => c.method === 'GET' && c.path.includes(`filter=record:${doi}`),
);
if (direct) { /* return toCandidate(direct.response.items[0]) or null */ }
// Fallback: first retractions entry
const any = cassette.find(
  (c) => c.method === 'GET' && c.path.includes('/data/retractions'),
);
```

The cassette at `tests/fixtures/cassettes/retraction-watch/fetchById-fake.json` covers DOI `10.0000/test` with a retracted response. The cassette at `freshness-hit.json` covers DOI `10.0000/retracted`.

**GATE-03 needs a third cassette** specifically for a DOI that represents a "blocked because live-retracted" scenario in the pass1.ts blocking path. Using an existing DOI from another cassette is fine IF the test fixture sets up the `claimed.DOI` to match the cassette's filter path. The cleanest approach: add `tests/fixtures/cassettes/retraction-watch/gate03-blocking-doi.json` with a fixture DOI like `10.0000/gate03-retracted` that returns a retracted candidate.

### Existing Cassette for GATE-03 Test

The `fetchById-fake.json` cassette already covers `10.0000/test` → retracted result. This DOI can be used directly for the GATE-03 blocking test WITHOUT a new cassette, by setting up a fixture bib entry with `DOI: "10.0000/test"` and checking that `verdictForCitekey` returns MIS-CITED.

However, a dedicated cassette (`gate03-blocking-doi.json`) is cleaner because it:
- Makes the test's intent explicit
- Uses a DOI that cannot be confused with the existing retraction-watch unit tests
- Allows the cassette to be distinguished from the "freshness advisory" path

Both approaches work. The dedicated cassette is recommended.

### Insertion Point in pass1.ts (verdictForCitekey function — VERIFIED)

The current `verdictForCitekey` function (pass1.ts:92-167) has this structure:

```typescript
async function verdictForCitekey(ck, claimed) {
  if (!claimed) return FABRICATED;                         // line 96
  if (!claimedTitle || authors.length === 0) return MIS-CITED;  // line 107
  if (claimed.retracted) return MIS-CITED;                // line 113 ← existing fast path
  if (!claimed.DOI) return FABRICATED;                    // line 119

  const actual = await sources.crossref.fetchById(claimed.DOI);  // line 126
  if (!actual) return FABRICATED;                          // line 129

  // JW comparison ...
  // multi-DOI redirect handling ...
  if (titleJW >= THRESHOLD && authorJW >= THRESHOLD) return OK;  // line 157
  return MIS-CITED;                                        // line 163
}
```

**Insertion point for GATE-03:** immediately after the `sources.crossref.fetchById` call succeeds (i.e., after line 132 where we know `actual` is not null), insert the live retraction re-query:

```typescript
// GATE-03 insertion — after crossref confirms DOI resolves:
// Re-query Retraction Watch on the claimed DOI (blocking on confirmed hit,
// silent on transport error — the adapter already returns null on any error).
const liveRetraction = await retractionWatch.fetchById(claimed.DOI);
if (liveRetraction !== null) {
  return {
    citekey: ck, verdict: 'MIS-CITED', titleJW: 0, authorJW: 0,
    reason: `cited work appears in Retraction Watch (live re-query at verify time)${
      liveRetraction.retraction_details ? `: ${liveRetraction.retraction_details}` : ''
    }`,
  };
}
```

**Import:** `import { fetchById as retractionWatchFetchById } from '../sources/retraction-watch.js';`

This is identical to the import pattern already used in `freshness.ts:27`.

**Why after crossref resolves (not before):** the GATE-03 decision only adds value when we know the DOI is real (crossref confirmed it). A FABRICATED citation has no real DOI to re-query. Placing the check after `actual` resolves avoids spending a retraction-watch query on DOIs that will be FABRICATED anyway.

**Why not in `runFreshnessForDraft`:** the freshness probe runs AFTER the blocking verdict is determined (verify.ts:126) and its results are explicitly excluded from the `status` computation (verify.ts:131). Adding a blocking check there would require wiring back into the status logic, which is architecturally messier than adding the check directly in `verdictForCitekey`.

### Determinism / Offline Guarantee

The retraction-watch adapter's `fetchById` already calls `isOfflineMode()` at the top (line 94) and routes to `loadCassetteFile('retraction-watch', 'fetchById-fake')` in offline mode. Adding the GATE-03 call in `verdictForCitekey` does not change the offline/online boundary — the adapter owns that decision. The existing cassette at `fetchById-fake.json` (DOI `10.0000/test` → retracted) can serve as the GATE-03 test fixture.

---

## GATE-04: FINAL.md Re-check Before Export

### runPass3 Signature (pass3.ts:54 — VERIFIED)

```typescript
// bin/lib/verify/pass3.ts line 54
export async function runPass3(
  draftMd: string,
  bibByCitekey: Map<string, BibLike>,
): Promise<Pass3Result[]>
```

Where `BibLike = { DOI?: string }`. This function takes any markdown string — it is not coupled to a file path or a specific section. It will work on FINAL.md's text as-is.

**GATE-04 needs to construct `bibByCitekey`** from `.paper/CITATIONS.bib`. The bib-read pattern already exists in `verify.ts:108-119`:
```typescript
const bibEntries = await parseBibtex(readFileSync(bibPath, 'utf8'));
const bibByCitekey = new Map(bibEntries.map((e) => [String(e.id ?? ''), e]));
```

### Citekey-Set Diff

Both `extractCitekeys` from `citation-token.ts` (VERIFIED) and the inline regex in `done.ts` extract `[@key]` tokens. The correct tool is `extractCitekeys(text)` which returns a deduplicated ordered array. The set comparison is:

```typescript
const finalKeys = new Set(extractCitekeys(finalMd));
const draftKeys = new Set(extractCitekeys(draftMd));
const setsEqual = finalKeys.size === draftKeys.size
  && [...finalKeys].every((k) => draftKeys.has(k));
```

A mismatch (key added, dropped, or swapped) → block export.

### Insertion Point in done.ts (lines 410-474 — VERIFIED)

Current done.ts structure after humanizer:

```typescript
// done.ts lines 411-478 (relevant excerpt, exact)
let finalPath: string | null = null;
let after: ... = null;
if (args.raw !== true) {
  finalPath = await runHumanizer(draftMd, paperRoot);    // line 414
  if (finalPath !== null) {
    try {
      after = await scoreHonesty(readFileSync(finalPath, 'utf8'));
    } catch { after = null; }
  }
}
// ...
const pass2Results = readSectionUnsupported(paperRoot);
const gateResult = await runDoneGate({ ... });           // line 434

if (gateResult.exported === false && gateResult.gateSkipped !== true) {
  process.stdout.write('pensmith done: export cancelled by user.\n');
  return { ok: false };
}

// ...
const result = await exportDraft({ inputPath: finalPath ?? draftPath, ... });  // line 474
```

**GATE-04 insertion:** immediately after `scoreHonesty` of FINAL.md (after line 420) and BEFORE `runDoneGate` (before line 434). This ensures:
1. A GATE-04 failure short-circuits before the DONE-09 advisory gate — fail-hard on citation integrity, not a soft advisory.
2. The `finalPath` null-check is the skip condition (no FINAL.md → no re-check).

```typescript
// GATE-04 insertion (after honesty scoring, before runDoneGate):
if (finalPath !== null && args.yolo !== true) {
  const finalMd = readFileSync(finalPath, 'utf8');
  const bibPath = join(paperDir(paperRoot), 'CITATIONS.bib');
  const gate4Result = await reCheckFinalMd(finalMd, draftMd, bibPath);
  if (!gate4Result.passed) {
    process.stdout.write(
      `pensmith done: GATE-04 BLOCKED — FINAL.md failed re-verification: ${gate4Result.reason}\n`,
    );
    return { ok: false };
  }
}
```

Note that `--yolo` bypasses this gate per the CONTEXT.md decision. A `reCheckFinalMd` helper function encapsulates the Pass-3 call + citekey-set diff and returns `{ passed: boolean, reason: string }`.

**Why before runDoneGate and not inside it:** the DONE-09 gate is the advisory-bucket gate (Pass-2/Pass-4/plagiarism). GATE-04 is a deterministic hard block on citation integrity — architecturally it belongs earlier in the sequence, alongside the fail-closed gates, not inside the advisory-confirm flow.

### Skip Condition

When `finalPath === null` (humanizer absent / skipped / Tier-2 no-transport path), there is no FINAL.md to re-check. The unhumanized `DRAFT.md` was already verified pre-compile. Skip cleanly — no error, no block.

When `args.yolo === true`, skip (consistent with CONTEXT.md: "only `--yolo` may override").

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Citekey extraction from markdown | Custom regex in done.ts | `extractCitekeys` from `citation-token.ts` | Already the project-canonical extractor with correct dedup; adding a second regex creates drift risk |
| Quote verification on FINAL.md | Custom pass3 re-implementation | `runPass3(finalMd, bibByCitekey)` | pass3 already runs on arbitrary markdown text; its signature is not file-path-coupled |
| Retraction lookup | Inline HTTP call in pass1.ts | `fetchById` from `retraction-watch.ts` | Existing adapter is cassette-backed, SSRF-guarded, and transport-safe; duplicating it breaks the offline test infrastructure |
| VERIFICATION.md parsing | New regex in compile.ts | The shared parser from `verdict-rows.ts` (the new module GATE-02 creates) | Single source of truth; any future format change breaks the round-trip test rather than silently returning [] |

---

## Common Pitfalls

### Pitfall 1: Adding a pass1.ts blocking check for retraction BEFORE Crossref resolution

**What goes wrong:** if the GATE-03 call is placed before `sources.crossref.fetchById(claimed.DOI)`, then for a citation with a valid DOI that happens to be in the cassette fallback path (first-entry match), the retraction-watch lookup may hit a cassette entry for a DIFFERENT DOI (the fallback `any` path in `retraction-watch.ts:109-113`). This produces a false positive: a non-retracted DOI gets MIS-CITED because a different DOI in the cassette has a retraction entry.

**How to avoid:** place the retraction re-query AFTER `const actual = await sources.crossref.fetchById(claimed.DOI)` succeeds, and use `claimed.DOI` as the query argument (the same DOI we verified via Crossref).

**Warning signs:** the GATE-03 test with a non-retracted DOI fixture starts failing MIS-CITED unexpectedly.

### Pitfall 2: `parseVerdictRows` matches against the freshness table rows

**What goes wrong:** the `## Source Freshness (RSCH-10)` table contains lines like `| smith2020 | retraction-watch | WARN | ...`. If the parser regex is too permissive, it might match these table rows and attempt to extract verdicts from them. The current `failingCitekeys` regex anchors on `^\s*-\s*` (list item syntax), which correctly excludes table rows. The new `parseVerdictRows` must preserve this anchoring.

**How to avoid:** keep the `^\s*-\s*` prefix in the parser regex. Test with a VERIFICATION.md that contains a freshness table with a "WARN" row — `parseVerdictRows` must return zero results for it.

### Pitfall 3: GATE-01 refuses on "Status: unverifiable" sections

**What goes wrong:** the GATE-01 check adds a refuse reason for any VERIFICATION.md without a parseable `Status:` line. But `verify.ts` writes `Status: unverifiable` for DRAFT.md-missing / bib-missing conditions (lines 75-84, 100-104). These files HAVE a `Status:` line. The gate must NOT refuse them.

**How to avoid:** the validity check is only `hasStatus = /^Status:\s*\S/m.test(verificationMd)`. `Status: unverifiable` passes this check. The section then goes through `parseVerdictRows` which returns `[]` (no failing citekey rows), and compile proceeds. This is correct — unverifiable sections have no blocking verdicts.

**Warning signs:** a section with `Status: unverifiable` (legitimate bib-missing state) starts being refused by compile after the GATE-01 change.

### Pitfall 4: GATE-04 runs Pass-3 on FINAL.md but bibByCitekey is built from DRAFT.md's citekeys only

**What goes wrong:** `runPass3` needs to look up DOIs for each `[@key]` token. If `bibByCitekey` is built from only the citekeys that appear in DRAFT.md, and the humanizer introduced a new `[@key]` token not in DRAFT.md, `bibByCitekey.get(newKey)` returns `undefined`, and `runPass3` will classify that quote as `PDF_UNAVAILABLE` (not `NOT_FOUND`). The `PDF_UNAVAILABLE` verdict is NOT in `REFUSING_VERDICTS` and does NOT block compile. This means an introduced citekey with an attached quote silently passes Pass-3.

**How to avoid:** GATE-04 uses the CITEKEY-SET DIFF as the primary guard against introduced/dropped keys — it does NOT rely on Pass-3 alone for this. The citekey-set diff catches the introduced key first. Pass-3 then only needs to verify quotes for keys that ARE in both FINAL.md and DRAFT.md (i.e., the citekey set is already verified equal before Pass-3 runs). Build `bibByCitekey` from `.paper/CITATIONS.bib` in full — not filtered by DRAFT.md citekeys.

**How to avoid (alternate guard):** run the citekey-set diff BEFORE Pass-3, and block immediately on mismatch — Pass-3 only runs when the sets are equal.

### Pitfall 5: round-trip test uses `deepEqual` on arrays instead of sets

**What goes wrong:** `parseVerdictRows` may return citekeys in any order depending on line order in the VERIFICATION.md. If the round-trip test uses `assert.deepEqual(failing, ['smith2020', 'jones2019'])`, it may fail due to ordering even when the content is correct.

**How to avoid:** the round-trip test must compare sets: `assert.deepEqual(new Set(failing), new Set(['smith2020', 'jones2019']))`.

---

## Code Examples

### GATE-01: Fail-Closed VERIFICATION.md Read

```typescript
// compile.ts — replace the current block at lines 271-279 with:
const verifPath = join(
  paperDir(opts.paperRoot), 'sections', `${String(os.n).padStart(2, '0')}-${os.slug}`, 'VERIFICATION.md',
);
const verificationMd = existsSync(verifPath) ? readFileSync(verifPath, 'utf8') : '';

// GATE-01 (Phase 14): fail closed on missing/empty/unparseable VERIFICATION.md.
// A section that was never verified must NEVER compile.
const hasStatus = /^Status:\s*\S/m.test(verificationMd);
if (!hasStatus) {
  refuseReasons.push(
    `section ${os.n} (${os.slug}): no verifiable VERIFICATION.md (section never verified or verifier output unreadable)`,
  );
  continue; // skip the failing-citekey parse; the section is already refused
}

// Refuse-gate (COMP-01 / GATE-02): any failing verdict blocks.
for (const ck of parseVerdictRows(verificationMd)) {
  refuseReasons.push(`section ${os.n} (${os.slug}): citation [@${ck}] has a blocking verdict (FABRICATED/MIS-CITED/NOT_FOUND)`);
}
```

Source: direct codebase read — verified against compile.ts:271-279.

### GATE-02: verdict-rows.ts Shared Module

```typescript
// bin/lib/verify/verdict-rows.ts (new file — complete interface)

/** Verdicts that block compile (mirrors REFUSING_VERDICTS in compile.ts). */
const BLOCKING_VERDICTS = new Set(['FABRICATED', 'MIS-CITED', 'NOT_FOUND']);

/** Render a Pass-1 verdict row (the writer side, used by verify.ts). */
export function renderPass1VerdictRow(
  citekey: string, verdict: string, titleJW: number, authorJW: number, reason: string,
): string {
  return `- ${citekey}: **${verdict}** — titleJW=${titleJW.toFixed(2)}, authorJW=${authorJW.toFixed(2)} — ${reason}`;
}

/** Render a Pass-3 verdict row (the writer side, used by verify.ts). */
export function renderPass3VerdictRow(
  citekey: string, quoteSnippet: string, verdict: string, levRatio: number, reason: string,
): string {
  return `- ${citekey} ("${quoteSnippet}…"): **${verdict}** — lev=${levRatio.toFixed(3)} — ${reason}`;
}

/**
 * Parse all failing citekeys from a VERIFICATION.md body (the parser side,
 * used by compile.ts). Returns only keys whose verdict is in BLOCKING_VERDICTS.
 * Safe to call on any string, including empty strings.
 */
export function parseVerdictRows(verificationMd: string): string[] {
  const out: string[] = [];
  for (const line of verificationMd.split(/\r?\n/)) {
    // Matches Pass-1 form:  - citekey: **VERDICT** — ...
    // Matches Pass-3 form:  - citekey ("quote..."): **VERDICT** — ...
    const m = /^\s*-\s*([a-z][a-z0-9_-]*)\s*[:(].*?\*\*([A-Z_-]+)\*\*/.exec(line);
    if (!m) continue;
    const citekey = m[1];
    const verdict = m[2];
    if (citekey === undefined || verdict === undefined) continue;
    if (BLOCKING_VERDICTS.has(verdict)) out.push(citekey);
  }
  return out;
}
```

Source: derived from compile.ts:135-147 (parser) and verify.ts:155-159 (writer). Both inspected directly.

### GATE-03: Live Retraction Re-Query in verdictForCitekey

```typescript
// pass1.ts — new import at top:
import { fetchById as retractionWatchFetchById } from '../sources/retraction-watch.js';

// Inside verdictForCitekey, after `const actual = await sources.crossref.fetchById(claimed.DOI)`:
// (Insert after line 132 in the current file, after `if (!actual) { return FABRICATED; }`)

// GATE-03 (Phase 14): live retraction re-query at verify time.
// fetchById returns null on transport error (never throws) — null = silent skip.
// A non-null result = confirmed retraction = MIS-CITED (blocking).
const liveRetraction = await retractionWatchFetchById(claimed.DOI);
if (liveRetraction !== null) {
  const why = liveRetraction.retraction_details ? `: ${liveRetraction.retraction_details}` : '';
  return {
    citekey: ck, verdict: 'MIS-CITED', titleJW: 0, authorJW: 0,
    reason: `cited work appears in Retraction Watch (live re-query at verify time)${why}`,
  };
}
```

Source: retraction-watch.ts:93-127 (fetchById signature and error-handling), pass1.ts:92-167 (verdictForCitekey structure).

### GATE-04: FINAL.md Re-Check Helper

```typescript
// New helper for done.ts (can live in done.ts or a small inline async function):
async function reCheckFinalMd(
  finalMd: string,
  draftMd: string,
  bibPath: string,
): Promise<{ passed: boolean; reason: string }> {
  // (a) Citekey-set diff — must match exactly.
  const finalKeys = new Set(extractCitekeys(finalMd));
  const draftKeys = new Set(extractCitekeys(draftMd));
  if (finalKeys.size !== draftKeys.size || [...finalKeys].some((k) => !draftKeys.has(k))) {
    const added = [...finalKeys].filter((k) => !draftKeys.has(k));
    const dropped = [...draftKeys].filter((k) => !finalKeys.has(k));
    return {
      passed: false,
      reason: `citekey-set mismatch after humanization — added: [${added.join(', ')}], dropped: [${dropped.join(', ')}]`,
    };
  }

  // (b) Pass-3 quote re-check on FINAL.md.
  // Build bibByCitekey from CITATIONS.bib (full bib, not filtered).
  if (!existsSync(bibPath)) return { passed: true, reason: '' }; // no bib = no quotes to check
  const bibText = readFileSync(bibPath, 'utf8');
  if (!bibText.trim()) return { passed: true, reason: '' };
  const bibEntries = await parseBibtex(bibText);
  const bibByCitekey = new Map(bibEntries.map((e) => [String(e.id ?? ''), e as { DOI?: string }]));
  const pass3Results = await runPass3(finalMd, bibByCitekey);
  const notFound = pass3Results.filter((r) => r.verdict === 'NOT_FOUND');
  if (notFound.length > 0) {
    const names = notFound.map((r) => `[@${r.citekey}] "${r.quoteSnippet}"`).join(', ');
    return { passed: false, reason: `Pass-3 quote NOT_FOUND in humanized FINAL.md: ${names}` };
  }

  return { passed: true, reason: '' };
}
```

Source: pass3.ts:54 (runPass3 signature), citation-token.ts:39 (extractCitekeys), done.ts:108-119 (bib-read pattern from verify.ts).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Absent VERIFICATION.md → zero failing citekeys → clean | GATE-01: absent/empty → refuse reason | Phase 14 | A never-verified section can no longer silently compile |
| Two separate writer/parser regex copies | GATE-02: shared `verdict-rows.ts` module | Phase 14 | Format drift breaks the round-trip test rather than silently nulling the blocking set |
| Retraction check = stored `claimed.retracted` flag only | GATE-03: + live re-query at verify time (blocking on hit, silent on error) | Phase 14 | Works retracted AFTER research now block compile instead of silently passing |
| Humanized FINAL.md not re-verified | GATE-04: Pass-3 + citekey-set diff before export | Phase 14 | Humanization cannot introduce/alter/drop a citation without detection |

---

## Assumptions Log

No claims in this research are tagged `[ASSUMED]`. All findings were verified by direct code inspection of committed files in this session.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | All findings verified by direct file read | — | — |

---

## Open Questions

1. **Should `Status: unverifiable` sections be allowed to compile?**
   - What we know: `verify.ts` writes `Status: unverifiable` for DRAFT.md-missing and bib-missing early-exit conditions (lines 75-84, 100-104). These sections have no verdict rows, so `parseVerdictRows` returns `[]`. GATE-01's `hasStatus` check passes. They currently compile.
   - What's unclear: is compiling with an unverifiable section intentional? A section that has never had a bib to verify against may have FABRICATED citations.
   - Recommendation: treat as in-scope for Phase 14 only if the CONTEXT.md explicitly requires it. The CONTEXT.md says "a never-verified section can NEVER compile" but `Status: unverifiable` IS a form of attempted verification (the verifier ran but could not complete). The minimal safe interpretation: the current behavior (unverifiable sections compile if no failing verdict rows exist) is acceptable. If stricter behavior is desired, add `verified` to an allowlist of passing statuses and refuse on `unverifiable`. **This is a planner decision, not a research gap.**

2. **Does `runPass3` on FINAL.md need a `bibByCitekey` for keys that are in DRAFT.md but NOT in FINAL.md?**
   - What we know: after GATE-04's citekey-set diff confirms the sets are equal, `runPass3` only needs to look up DOIs for keys in FINAL.md. Since the sets are equal, this is the same as looking up DOIs for keys in DRAFT.md. The bib covers all keys from compile (D-19 regen).
   - Recommendation: build `bibByCitekey` from the full CITATIONS.bib as shown in the code example above. No filtering needed.

---

## Environment Availability

This phase is purely code/config changes. No new external tools or services are required. Step 2.6: SKIPPED (no new external dependencies introduced).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` (no jest/vitest) |
| Config file | `package.json` scripts → `tsx --test` (no separate config file) |
| Quick run command | `npm test -- --test-name-pattern "GATE"` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GATE-01 | Absent VERIFICATION.md → compile refuses | unit | `npm test -- --test-name-pattern "GATE-01"` | Extend `tests/compile-refuse.test.ts` — Wave 0 |
| GATE-01 | Empty VERIFICATION.md → compile refuses | unit | (same) | Extend `tests/compile-refuse.test.ts` — Wave 0 |
| GATE-01 | VERIFICATION.md with no Status line → compile refuses | unit | (same) | Extend `tests/compile-refuse.test.ts` — Wave 0 |
| GATE-01 | Valid VERIFICATION.md with Status: verified → compiles | unit | (same) | Extend `tests/compile-refuse.test.ts` — Wave 0 |
| GATE-02 | round-trip: render FABRICATED/MIS-CITED/OK → parse → blocking set identical | unit | `npm test -- --test-name-pattern "verdict-rows"` | `tests/verdict-rows.test.ts` — Wave 0 |
| GATE-02 | format drift mutation: altered bold markers → parse returns [] → test catches | unit | (same) | `tests/verdict-rows.test.ts` — Wave 0 |
| GATE-02 | freshness table row NOT matched by parseVerdictRows | unit | (same) | `tests/verdict-rows.test.ts` — Wave 0 |
| GATE-03 | live retraction hit on DOI → Pass-1 returns MIS-CITED | unit | `npm test -- --test-name-pattern "GATE-03"` | `tests/gate03-live-retraction.test.ts` — Wave 0 |
| GATE-03 | transport error (null from fetchById) → does NOT produce false MIS-CITED | unit | (same) | `tests/gate03-live-retraction.test.ts` — Wave 0 |
| GATE-03 | stored retracted flag still blocks (existing fast path unchanged) | regression | `npm test -- --test-name-pattern "known-bad-citations"` | `tests/known-bad-citations.test.ts` — already exists |
| GATE-04 | added citekey in FINAL.md → export blocked | unit | `npm test -- --test-name-pattern "GATE-04"` | `tests/gate04-final-recheck.test.ts` — Wave 0 |
| GATE-04 | dropped citekey in FINAL.md → export blocked | unit | (same) | `tests/gate04-final-recheck.test.ts` — Wave 0 |
| GATE-04 | tampered quote in FINAL.md → NOT_FOUND → export blocked | unit | (same) | `tests/gate04-final-recheck.test.ts` — Wave 0 |
| GATE-04 | clean FINAL.md (same citekeys, quotes OK) → passes | unit | (same) | `tests/gate04-final-recheck.test.ts` — Wave 0 |
| GATE-04 | absent humanizer (finalPath=null) → skip cleanly | unit | (same) | `tests/gate04-final-recheck.test.ts` — Wave 0 |
| GATE-04 | --yolo → skip GATE-04 | unit | (same) | `tests/gate04-final-recheck.test.ts` — Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- --test-name-pattern "GATE"` (fast — in-memory fixtures, no network)
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps (new test files to create)

- [ ] `tests/verdict-rows.test.ts` — covers GATE-02 round-trip contract
- [ ] `tests/gate03-live-retraction.test.ts` — covers GATE-03 blocking / silent-skip paths
- [ ] `tests/gate04-final-recheck.test.ts` — covers GATE-04 blocking / clean / skip paths
- [ ] `tests/fixtures/cassettes/retraction-watch/gate03-blocking-doi.json` — cassette for GATE-03 test DOI (or reuse `fetchById-fake.json` DOI `10.0000/test`)
- Extend `tests/compile-refuse.test.ts` with GATE-01 absent/empty/no-status cases

---

## Security Domain

`security_enforcement` is enabled (config.json). Phase 14 does not introduce new network paths, new LLM calls, or new file-write surfaces. Security analysis is narrow.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | The `parseVerdictRows` regex is anchored (`^\s*-\s*`) and uses a named capture for citekey (`[a-z][a-z0-9_-]*`) — resists injection from a tampered VERIFICATION.md |
| V6 Cryptography | no | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Tampered VERIFICATION.md with crafted verdict row | Tampering | `parseVerdictRows` regex is restrictive; citekey grammar is locked (`[a-z][a-z0-9_-]*`); verdict must be in BLOCKING_VERDICTS |
| SSRF via retraction re-query | Elevation | Delegated entirely to `fetchById` in `retraction-watch.ts` which already routes through `http.ts` (HARD-02 SSRF guard is Phase 15 scope) |
| FINAL.md with a crafted `[@key]` that bypasses citekey validation | Tampering | `extractCitekeys` uses the locked `CITATION_TOKEN_RE` grammar; the citekey-set diff compares against the DRAFT.md set which was already verified pre-compile |

---

## Sources

### Primary (HIGH confidence — direct code inspection)

- `bin/lib/compile.ts` — lines 61-147 (REFUSING_VERDICTS, failingCitekeys), lines 271-279 (VERIFICATION.md read pattern)
- `bin/cli/verify.ts` — lines 148-168 (VERIFICATION.md write format, verdict row template literals)
- `bin/lib/verify/pass1.ts` — lines 92-167 (verdictForCitekey structure), lines 112-114 (existing retracted fast path), lines 181-234 (runPass1 signature)
- `bin/lib/sources/retraction-watch.ts` — lines 93-127 (fetchById signature, cassette keying, error handling)
- `bin/lib/verify/pass3.ts` — lines 54-122 (runPass3 signature and behavior)
- `bin/cli/done.ts` — lines 410-478 (runHumanizer→exportDraft sequence, DONE-09 gate structure)
- `bin/lib/exporter.ts` — lines 501-553 (resolveAndRenderCitations, [@key] regex pattern)
- `bin/lib/citation-token.ts` — lines 29-68 (CITATION_TOKEN_RE, extractCitekeys, replaceCitekeys)
- `bin/lib/http-mock.ts` — lines 139-165 (isOfflineMode, loadCassetteFile)
- `bin/lib/verify/freshness.ts` — lines 27, 131-146 (fetchById usage pattern for transport-safe retraction lookup)
- `tests/compile-refuse.test.ts` — existing GATE baseline (COMP-01 tests)
- `tests/fixtures/cassettes/retraction-watch/fetchById-fake.json` — cassette covering DOI `10.0000/test`
- `tests/fixtures/cassettes/retraction-watch/freshness-hit.json` — cassette covering DOI `10.0000/retracted`
- `.planning/config.json` — nyquist_validation: true, security_enforcement: true

---

## Metadata

**Confidence breakdown:**
- GATE-01 analysis: HIGH — exact code path read, exact behavior confirmed
- GATE-02 analysis: HIGH — both writer (verify.ts:155-159) and parser (compile.ts:135-147) read directly
- GATE-03 analysis: HIGH — fetchById signature read, cassette keying confirmed, precedent in freshness.ts
- GATE-04 analysis: HIGH — runPass3 signature read, extractCitekeys confirmed, done.ts insertion point read

**Research date:** 2026-06-24
**Valid until:** stable indefinitely — all findings are grounded in the committed codebase, not external libraries
