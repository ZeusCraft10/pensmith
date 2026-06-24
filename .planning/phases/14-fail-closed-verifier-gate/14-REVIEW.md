---
phase: 14-fail-closed-verifier-gate
reviewed: 2026-06-24T00:00:00Z
depth: deep
files_reviewed: 6
files_reviewed_list:
  - bin/lib/verify/verdict-rows.ts
  - bin/lib/compile.ts
  - bin/cli/verify.ts
  - bin/lib/verify/pass1.ts
  - bin/lib/sources/retraction-watch.ts
  - bin/cli/done.ts
findings:
  critical: 2
  warning: 3
  info: 1
  total: 6
status: fixed
---

# Phase 14: Code Review Report — Fail-Closed Verifier Gate

**Reviewed:** 2026-06-24
**Depth:** deep (cross-file call-chain analysis)
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Phase 14 hardens the #1 non-negotiable: no FABRICATED/MIS-CITED/NOT_FOUND citation may
escape into a compiled or exported document. Four gates are added or tightened:

- GATE-01 (`compile.ts`): fail-closed on VERIFICATION.md without a `Status:` line.
- GATE-02 (`verdict-rows.ts`): single render+parse pair shared by writer and compile.
- GATE-03 (`pass1.ts` + `retraction-watch.ts`): live retraction re-query at verify time.
- GATE-04 (`done.ts`): re-verify humanized FINAL.md before export.

The implementation is largely sound and the gate logic is correct for the common paths.
Two BLOCKER-level gaps were found: (1) a structural bypass of GATE-04 when
`--raw` is used (the humanized FINAL.md that was written in a *prior* run persists on
disk and is silently exported without re-verification), and (2) a `loadCassetteDir`
empty-array path that is not null-checked in `retraction-watch.ts`, causing every DOI
to be "not retracted" in a test environment whose cassette directory exists but is
empty. Three warnings cover the `runPass3` exception bypass in GATE-04, the citekey
charset divergence between the writer and parser regexes, and the staleness-path gap
where a stale section that passes re-verify is never re-checked against GATE-01.

---

## Critical Issues

### CR-01: GATE-04 silently bypassed when `--raw` is used after a prior humanizer run

**File:** `bin/cli/done.ts:517`

**Issue:** GATE-04 fires only when `finalPath !== null && args.yolo !== true`. When
`--raw` is passed, `args.raw === true` prevents the humanizer from running
(`finalPath` stays `null`), and the entire `reCheckFinalMd` block is skipped.
This is documented intent — the user explicitly asked not to humanize.

The bypass, however, extends to a case that is clearly *unintentional*: if a
`FINAL.md` was written by a *previous* `pensmith done` invocation (without `--raw`),
it persists in `.paper/FINAL.md`. On the *next* invocation with `--raw`:

```
finalPath = null        // raw=true skips runHumanizer entirely
exportDraft({ inputPath: finalPath ?? draftPath, ... })
           // ^^^^^^^^ finalPath is null → draftPath is used — SAFE
```

`draftPath` (`.paper/DRAFT.md`) is used, not the stale `FINAL.md`, so the
immediate export is safe. However, the *next* invocation *without* `--raw` will
call `runHumanizer`, which reads `draftMd` (the current DRAFT.md) and writes a new
`FINAL.md`, then GATE-04 checks the new FINAL.md against the current draft — which
is the correct design.

**The real gap is a different shape:** `--yolo` skips GATE-04 entirely regardless of
whether humanization ran:

```typescript
// done.ts:517
if (finalPath !== null && args.yolo !== true) {
```

When the humanizer runs successfully (`finalPath !== null`) AND `--yolo` is passed,
GATE-04 is skipped. This means a FINAL.md whose citekey set differs from DRAFT.md
(or whose quotes are NOT_FOUND) can be exported under `--yolo`. The comment at
line 516 says "Skip when no humanizer ran (finalPath === null) *or --yolo* (the only
override)." But PRD §14 and CLAUDE.md both say **"Verifier blocks compile and export.
No FABRICATED, MIS-CITED, or quote-NOT_FOUND citation ever escapes a section."**
`--yolo` is documented only for the outline approval and export *confirmation* gate
(PRD §7.9 / `runDoneGate`), not for the verifier gate itself. Allowing `--yolo` to
bypass GATE-04 contradicts the non-negotiable.

**Fix:** Remove the `args.yolo !== true` arm from the GATE-04 condition. GATE-04 is
a *verifier* gate, not an *approval* gate. `--yolo` must only skip `runDoneGate`:

```typescript
// done.ts:517 — remove the yolo bypass from GATE-04
if (finalPath !== null) {
  const finalMd = readFileSync(finalPath, 'utf8');
  const bibPath = join(paperDir(paperRoot), 'CITATIONS.bib');
  const gate4 = await reCheckFinalMd(finalMd, draftMd, bibPath);
  if (!gate4.passed) {
    process.stdout.write(
      `pensmith done: GATE-04 BLOCKED — FINAL.md failed re-verification: ${gate4.reason}\n`,
    );
    return { ok: false };
  }
}
```

The `--yolo` gate further down (`runDoneGate`) is the correct place for that flag.

---

### CR-02: `loadCassetteDir` returns empty array (not null) when cassette directory exists but is empty — GATE-03 silently sees no hit

**File:** `bin/lib/sources/retraction-watch.ts:101-106` / `bin/lib/http-mock.ts:178-192`

**Issue:** `loadCassetteDir` returns `null` only when the adapter directory does not
exist (`!existsSync(dir)`). When the directory *does* exist but contains no `.json`
files, it returns `[]` — an empty array.

In `retraction-watch.ts:fetchById`, the offline path checks:

```typescript
const cassettes = loadCassetteDir('retraction-watch');
if (!cassettes) return null;        // ← truthy check; [] passes this!
const direct = cassettes.find(…);   // finds nothing → undefined
if (!direct) return null;           // returns null → no retraction hit
```

When the cassette directory exists but is empty, `cassettes` is `[]`, which is truthy,
so the null-guard passes. `find` returns `undefined`, `!direct` is true, and
`fetchById` returns `null` (no retraction). This means **every DOI looks clean in an
environment where the retraction-watch cassette directory exists but has no data**.

This scenario is real: if someone runs the test suite in a checkout where
`tests/fixtures/cassettes/retraction-watch/` exists but the cassette files have been
deleted or gitignored, GATE-03 silently degrades to "nothing is retracted" instead of
failing loudly.

The previous `loadCassetteFile('retraction-watch', 'fetchById-fake')` behavior
returned `null` when the specific named file was absent — which also silently returned
null, but at least required a deliberate named cassette to exist for any hit. The new
`loadCassetteDir` approach is broader in scope and introduces the subtle empty-dir
degradation that the old approach did not have.

**Fix:** Treat an empty cassette array as null (no data available) to fail loudly in
tests, or assert the directory is non-empty:

```typescript
// retraction-watch.ts:101-106
const cassettes = loadCassetteDir('retraction-watch');
if (!cassettes || cassettes.length === 0) return null;
```

Or, more robustly, add an assertion in `loadCassetteDir` or the caller that logs a
warning when the directory exists but is empty:

```typescript
if (!cassettes) return null;
// Treat an empty cassette array as "no data" — same as directory missing.
// This prevents silent false-clean in environments where the cassette
// directory exists but the files have been deleted.
if (cassettes.length === 0) return null;
```

Note: this does not affect the production (online) path, only the offline/test path.

---

## Warnings

### WR-01: `reCheckFinalMd` exception-bypass in GATE-04 — a `runPass3` throw silently passes the gate

**File:** `bin/cli/done.ts:402-407`

**Issue:** The `runPass3` call inside `reCheckFinalMd` is wrapped in a bare `catch`
that returns `{ passed: true, reason: '' }`:

```typescript
let pass3Results;
try {
  pass3Results = await runPass3(finalMd, bibByCitekey);
} catch {
  return { passed: true, reason: '' };   // ← silent pass on any error
}
```

The stated design intent ("never throws") is correct for the outer `reCheckFinalMd`
function. But the `runPass3` catch specifically swallows any internal error — an
OOM, a bug in the Levenshtein kernel, a corrupted PDF response — and returns a clean
pass. This means a humanizer that introduces a NOT_FOUND quote *and* triggers a bug
in `runPass3` would escape the gate silently.

This is structurally the same concern as the bib-parse catch above it (line 397). The
bib-parse catch is more defensible (an unparseable bib has no DOIs to check quotes
against, so there is nothing to verify). The `runPass3` catch is riskier: `runPass3`
has already been given a valid `bibByCitekey` map at this point, and an exception
there is unexpected rather than a clean "nothing to do" case.

**Fix:** Distinguish between the "nothing to do" clean skip and the "unexpected error"
advisory-degrade. Log the error to stderr before returning the pass:

```typescript
let pass3Results;
try {
  pass3Results = await runPass3(finalMd, bibByCitekey);
} catch (err) {
  // Advisory degrade — log so the user knows the re-check was skipped.
  // Never throws (reCheckFinalMd contract), but this is NOT a clean pass.
  process.stderr.write(
    `pensmith done: GATE-04 Pass-3 re-check failed unexpectedly (${
      err instanceof Error ? err.message : String(err)
    }) — skipping quote re-check (advisory degrade).\n`,
  );
  return { passed: true, reason: '' };
}
```

This preserves the never-throws contract while making the bypass visible.

---

### WR-02: Citekey charset divergence between `extractCitekeys` (GATE-04) and `parseVerdictRows` (GATE-02) — uppercase citekeys escape GATE-02

**File:** `bin/lib/citation-token.ts:29` vs `bin/lib/verify/verdict-rows.ts:67`

**Issue:** `extractCitekeys` (used in GATE-04 for the citekey-set diff) uses:

```typescript
export const CITATION_TOKEN_RE = /\[@([a-z][a-z0-9_-]*)\]/g;
```

This is lowercase-only: `[a-z]` as the first character. This is correct for Pandoc
citekeys — they are conventionally lowercase and the verifier enforces this.

`parseVerdictRows` (GATE-02) uses the same lowercase-only anchor on the citekey group:

```typescript
const m = /^\s*-\s*([a-z][a-z0-9_-]*)\s*[:(].*?\*\*([A-Z_-]+)\*\*/.exec(line);
```

However, `verify.ts` (the writer) does not sanitize the citekey before writing it into
the VERIFICATION.md list row — it passes `r.citekey` directly to `renderPass1VerdictRow`:

```typescript
...pass1.map((r) => renderPass1VerdictRow(r.citekey, r.verdict, …))
```

And `runPass1` sources its citekeys from:

```typescript
const citekeys = [...draftMd.matchAll(/\[@([a-z][a-z0-9_-]*)\]/g)]
```

So the citekey set is already lowercase-gated at the extraction point. This is
consistent. However, `runPass1Unit` (used in tests) takes a `claimed.title`,
`claimed.authors` pair that has no citekey enforcement, and the bib-parse path in
`runPass1` uses `String(e['id'] ?? '')` which could produce any casing if the BibTeX
entry has a mixed-case ID.

If a BibTeX file has an entry `@article{Smith2020, …}` and the draft references
`[@Smith2020]`, the draft-regex fails to extract `Smith2020` (capital S not in
`[a-z]`), but the BibTeX map entry is keyed on `Smith2020`. The citekey never reaches
the verifier at all — meaning a citation with a mixed-case citekey is silently ignored
by Pass-1 rather than flagged as FABRICATED. This is a pre-existing issue, but
Phase 14's explicit claim that the regex is a "bijection" (verdict-rows.ts module
comment) is only true within the lowercase namespace.

**Fix:** Add a test in `verdict-rows.test.ts` that asserts `parseVerdictRows` returns
`[]` for a line containing a citekey with an uppercase character (e.g. `Smith2020`),
to document the constraint explicitly. Also document in `runPass1` that mixed-case
citekeys are silently skipped rather than flagged.

---

### WR-03: Staleness re-verify path never re-passes through GATE-01 — a section whose stored hash mismatches but whose re-verify passes can still have a corrupted VERIFICATION.md

**File:** `bin/lib/compile.ts:276-299`

**Issue:** The GATE-01 `hasStatus` check runs before the staleness check. When a
section passes GATE-01 (its VERIFICATION.md has a `Status:` line), then the staleness
path fires, and the injectable `reVerify` seam is called. The seam returns
`{ passed: true, failingCitekeys: [] }` on success.

At that point, compile continues with the section — but the *on-disk*
VERIFICATION.md is not updated (re-verify is read-only per the contract: "section
files are NEVER written — ARCH-20"). This means:

1. Section's VERIFICATION.md has `Status: verified` with some OK verdict rows — GATE-01
   passes, GATE-02 finds no blocking rows.
2. The draft changes (hash mismatch detected).
3. Re-verify runs via the seam and returns `passed: true`.
4. Compile proceeds.

But the seam return value is a bare `{ passed: boolean; failingCitekeys: [] }` —
it does not say *what* the new verdicts are. The compile pipeline trusts the seam's
boolean, not a fresh set of parsed verdict rows. If the production `reVerify`
implementation has a bug that returns `{ passed: true, failingCitekeys: [] }` when
there are actually failing citekeys (e.g., due to a network timeout misclassified as
clean), those failures escape without being caught by GATE-02.

This is a *seam design* weakness, not a code bug — the current code is correct given
the seam contract. But Phase 14 adds GATE-02 as the authoritative verdict parser, and
the staleness path bypasses GATE-02 in favor of trusting the seam's boolean.

**Fix:** Document the gap in a comment alongside the staleness re-verify logic and add
a test that asserts the production `reVerify` implementation (when wired in
integration) writes updated verdict rows to VERIFICATION.md and that those rows are
subsequently parseable by `parseVerdictRows`. This is a structural/contractual gap,
not a single-line fix.

---

## Info

### IN-01: Trailing comma after `parseIntakeMd` import — cosmetic lint noise

**File:** `bin/cli/done.ts:34`

**Issue:**

```typescript
import { parseIntakeMd, } from '../lib/intake-parse.js';
```

Trailing comma inside the named-import brace is harmless but was introduced by this
phase's diff and is inconsistent with every other import in the file and across the
codebase.

**Fix:** Remove the trailing comma:

```typescript
import { parseIntakeMd } from '../lib/intake-parse.js';
```

---

## Detailed Gate Analysis

### GATE-01 (`compile.ts:263`) — `hasStatus` regex

The regex `/^Status:\s*\S/m` is correct and fails closed for all four stated shapes:

| Shape | `hasStatus` | Outcome |
|---|---|---|
| Absent VERIFICATION.md | `''` → false | refuse (correct) |
| Whitespace-only | false | refuse (correct) |
| Content, no `Status:` | false | refuse (correct) |
| `Status: verified` | true | proceeds to GATE-02 (correct) |
| `Status: unverifiable` | true | proceeds, no verdict rows → allowed (Pitfall 3 correct) |
| `Status: failed` | true | proceeds, GATE-02 finds blocking rows → refused (correct) |

The `continue` on line 268 correctly skips both `parseVerdictRows` and the staleness
check. This is the correct behavior: a section with no VERIFICATION.md should not
trigger a spurious "stale" re-verify, it should simply refuse.

One edge case the tests do not cover: `Status:` with no non-whitespace after the
colon (`Status:  ` — multiple spaces then end-of-line). The regex `\S` requires at
least one non-whitespace character, so `Status:  \n` would *fail* the hasStatus check
and refuse. This is the correct fail-closed behavior.

### GATE-02 (`verdict-rows.ts:67`) — render ↔ parse bijection

The parse regex is:

```
/^\s*-\s*([a-z][a-z0-9_-]*)\s*[:(].*?\*\*([A-Z_-]+)\*\*/
```

Claim: the writer and parser form a bijection for all outputs the writer can emit.

**Pass-1 row:**
```
- smith2020: **FABRICATED** — titleJW=0.00, authorJW=0.00 — reason
```
Regex matches: citekey=`smith2020`, verdict=`FABRICATED`. Correct.

**Pass-3 row:**
```
- smith2020 ("the quote…"): **NOT_FOUND** — lev=0.100 — reason
```
Regex matches: citekey=`smith2020`, verdict=`NOT_FOUND`. Correct; the `[:(]` alternation handles both.

**WARN / freshness rows:** These are pipe-table rows (`| smith2020 | … |`), not
list-item rows. The `^\s*-\s*` anchor correctly excludes them. Pitfall 2 is handled.

**Verdict case sensitivity:** The verdict capture group is `[A-Z_-]+`. The writer
emits `FABRICATED`, `MIS-CITED`, `NOT_FOUND` — all uppercase. The BLOCKING_VERDICTS
set is case-sensitive (`'FABRICATED'` etc.). These match. A verdict written in
unexpected casing (e.g. `Fabricated`) would not be captured by `[A-Z_-]+` and would
drop silently — but verify.ts hardcodes the verdict strings from the `Pass1Verdict`
type union, so this is not reachable at runtime.

**Multi-verdict rows:** Not a thing — each list item corresponds to exactly one
citekey. No bypass path via multiple verdicts per line.

**Quoting the citekey in reason text:** If a reason string contains `**FABRICATED**`
(e.g., the reason is "another citation also FABRICATED here"), the `.*?` lazy match
would stop at the *first* `**` pair on the line, which is the real verdict. If the
reason contains `**FABRICATED**` before the actual verdict marker, the parser would
extract the wrong verdict — but the format is `…: **VERDICT** — reason`, so the
verdict is always the *first* `**…**` on the line. Any `**` in the reason comes
after. This is correct.

**Conclusion:** The round-trip is correct for all reachable writer outputs. The
`[A-Z_-]+` verdict group prevents any lowercase corruption from being parsed as a
blocking verdict, which is the desired fail-closed behavior.

### GATE-03 (`pass1.ts:143`, `retraction-watch.ts:93`)

**Placement:** GATE-03 is placed after the Crossref null-guard (line 128). A DOI that
did not resolve via Crossref returns `FABRICATED` at line 129-133 and never reaches
the retraction check. Pitfall 1 is correctly handled.

**fetchById null (transport error):** The `try/catch` in `retraction-watch.ts:120`
catches all transport errors and returns `null`. `pass1.ts:144` checks
`liveRetraction !== null` — a null is a silent skip. No false MIS-CITED on transport
error. Correct.

**Cassette matching:** The path-match predicate is
`c.path.includes(`filter=record:${doi}`)`. DOI values in Crossref can contain
characters that appear in other DOIs as substrings (e.g., `10.1000/a` is a substring
of `10.1000/ab`). If cassette A has `filter=record:10.1000/a` and the tested DOI is
`10.1000/ab`, `cassettes.find(…)` using `includes` could return cassette A's entry
for a DOI it doesn't cover. This is a false-positive retraction risk (wrong cassette
matched → wrong DOI declared retracted → false MIS-CITED). In the production path
the URL is URL-encoded and the API is an exact-match filter, so this is a
*test-only* risk. But it is real: if someone adds a cassette for `10.0000/test` and
later tests a `10.0000/test-2` DOI offline, cassette A would match and declare
`10.0000/test-2` retracted.

This is partially mitigated by the existing cassette naming — the three committed
cassettes cover distinct DOIs and there is no substring collision in the current
fixture set. It should be documented as a cassette authoring constraint.

**Empty cassette directory:** See CR-02 above.

### GATE-04 (`done.ts:517`)

**Ordering:** GATE-04 fires before `runDoneGate` (line 531). The comment at line 515
explicitly states "HARD block, BEFORE runDoneGate." Correct.

**Citekey-set diff direction:** Both `added` (in FINAL not in draft) and `dropped` (in
draft not in FINAL) are checked. A swap (added + dropped simultaneously) is caught
because both lists are non-empty. Correct — all three mutation shapes block.

**Pass-3 on FINAL.md:** Uses `runPass3(finalMd, bibByCitekey)` where `bibByCitekey`
is built from the FULL `CITATIONS.bib` (Pitfall 4 — not filtered by DRAFT keys).
This is correct: we want to check every quote in FINAL.md against every DOI in the
bib, not just the ones the draft cites.

**`--raw` skip:** When `--raw` is passed, `finalPath === null`, GATE-04 is skipped,
and `exportDraft` uses `draftPath` (the compiled DRAFT.md). This is correct for the
`--raw` path itself — DRAFT.md was never humanized so there is no humanized artifact
to re-check. The bypass is only a problem if there is a stale FINAL.md from a prior
run, but `exportDraft` does not use FINAL.md when `finalPath` is null.

**`--yolo` skip:** See CR-01 above — this is the BLOCKER.

**`reCheckFinalMd` never-throws contract:** The outer function has three
try/catch blocks that all return `{ passed: true }` on exception. The never-throws
contract holds, but the exception-bypass is a concern (see WR-01).

---

_Reviewed: 2026-06-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
