# Phase 14: Fail-closed verifier gate - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey-area defaults auto-accepted, grounded in the #1 non-negotiable ("verifier blocks compile + export; no FABRICATED/MIS-CITED/quote-NOT_FOUND ever escapes") + the 2026-06-22 review's fail-open findings

<domain>
## Phase Boundary

Close four fail-OPEN holes so the verifier gate is genuinely fail-CLOSED end-to-end. Each individually lets an unverified or wrong citation escape the core guarantee.

- **GATE-01:** `pensmith compile` refuses when a section's `VERIFICATION.md` is missing or has no parseable status — a never-verified section can NEVER compile (today an absent/empty VERIFICATION.md reads as zero failing citekeys → clean).
- **GATE-02:** the refuse-gate verdict rows are produced + parsed by a SHARED render+parse pair, guarded by a writer→parser round-trip test (today verify.ts writes and compile.ts parses with separate code → a writer-format drift silently returns `[]` and a FABRICATED row escapes).
- **GATE-03:** verification re-queries Retraction Watch on the resolved DOI at verify time and escalates a LIVE hit to MIS-CITED (blocking) — today Pass-1 blocks only on the STORED `claimed.retracted` flag (set at research time), so a work retracted AFTER research compiles clean; the live check exists only in the WARN-only freshness channel.
- **GATE-04:** the humanized `FINAL.md` is re-checked (deterministic Pass-3 quote verification + citekey-set diff vs the compiled DRAFT.md) before export, so humanization cannot introduce/alter a citation or break a verified quote.

Out of scope: HARD/CI/DOCS hardening (Phase 15-16). This phase only hardens the gate; it does not add new sources/verbs.
</domain>

<decisions>
## Implementation Decisions

### GATE-01 — missing VERIFICATION.md fails closed (compile.ts)
- The compile refuse-gate's VERIFICATION.md read (currently `existsSync ? read : ''` → an empty string yields zero failing citekeys → clean) must FAIL CLOSED: a missing file, an empty/whitespace file, or a file with no parseable `## Status`/verdict line is itself a refuse reason — `section N (slug): no verifiable VERIFICATION.md (section never verified or verifier output unreadable)`. Only a VERIFICATION.md that PARSES and shows a clean verdict set permits compile.
- This is conservative-correct: re-doing verify regenerates VERIFICATION.md; the gate just stops trusting absence as "clean".

### GATE-02 — shared verdict render+parse pair
- Extract ONE module (e.g. `bin/lib/verify/verdict-rows.ts`) exporting a matched pair: `renderVerdictRow(...)`/`renderVerdictTable(...)` (used by verify.ts when WRITING VERIFICATION.md) and `parseVerdictRows(text)` → the set of failing citekeys + verdicts (used by compile.ts collectFailingCitekeys). Both verify.ts (writer) and compile.ts (parser) import this single source of truth.
- A round-trip test asserts: render a set of `{citekey, verdict}` rows (incl. FABRICATED/MIS-CITED/NOT_FOUND) through the writer, parse them back through the parser, and get an IDENTICAL blocking set — so any future format drift breaks the test, not the gate silently. Cover the empty-set + clean-only + mixed cases.
- Preserve the existing VERIFICATION.md human-readable shape (the writer output stays template-literal narration); the parser keys off the stable row format the pair defines.

### GATE-03 — blocking live retraction re-query at verify time (pass1)
- At verify time, after resolving a citation's DOI, re-query Retraction Watch (the existing cassette-backed `retraction-watch` adapter via http.ts) and escalate a LIVE retraction hit to **MIS-CITED (blocking)** in Pass-1's verdict path — not only the WARN-only freshness channel. This catches works retracted AFTER research.
- Keep Pass-1 deterministic + offline-testable: the retraction-watch adapter is cassette-backed, so CI runs deterministically against committed cassettes; at runtime it does the live lookup. The check is advisory-degrading on a transport ERROR (a network failure is a SILENT skip, not a false MIS-CITED — never block on an unreachable service), but a CONFIRMED live retraction hit blocks. The stored `claimed.retracted` block stays as the offline-fast path; the live re-query is the additional blocking signal.

### GATE-04 — re-verify humanized FINAL.md before export (done.ts)
- After `runHumanizer` produces `.paper/FINAL.md` (done.ts ~414) and BEFORE `exportDraft`, run a blocking re-check on FINAL.md: (a) deterministic Pass-3 quote verification on FINAL.md's quotes, and (b) a citekey-set diff — the set of `[@key]` tokens in FINAL.md must equal the set in the compiled DRAFT.md (humanize must not add, drop, or swap a citation). A Pass-3 NOT_FOUND or a citekey-set mismatch BLOCKS export with a clear reason (only `--yolo` may override, consistent with the existing DONE-09 gate posture — but a citation-integrity failure should be a hard block, not a soft confirm; default = block).
- When the humanizer is absent / skipped (no FINAL.md, Tier-2 null runner), there is nothing to re-verify — skip cleanly (the unhumanized DRAFT.md was already verified pre-compile).
- This runs BEFORE the Phase-13 citation rendering (rendering happens inside exportDraft); the re-check operates on the `[@key]`-bearing FINAL.md.

### Invariants
- Deterministic Pass-1/Pass-3 remain the blocking gate; advisory Pass-2/Pass-4 stay advisory. GATE-03/04 are deterministic-or-degrade (never block on a transport error; block only on a confirmed integrity failure).
- 16-verb/16-body bijection unchanged (all changes are inside compile/verify/done + a new internal verify lib).
- All network via http.ts (the retraction re-query); offline cassette tests; no key/PII leak.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `bin/lib/compile.ts` — the refuse-gate: `REFUSING_VERDICTS` set (line 62), `collectFailingCitekeys` (~134), the per-section VERIFICATION.md read (~272), refuseReasons assembly (~278). GATE-01 + GATE-02 land here.
- `bin/cli/verify.ts` — writes VERIFICATION.md (verdict narration ~94-130). GATE-02 writer side.
- `bin/lib/verify/pass1.ts` — `claimed.retracted` block (line 113); `runFreshnessForDraft` WARN-only retraction probe (~204+). GATE-03 lands here.
- `bin/lib/sources/retraction-watch.ts` (`fetchById`/retraction lookup) — cassette-backed via http.ts; the live re-query source.
- `bin/lib/verify/pass3.ts` — deterministic quote verification; reuse for GATE-04 FINAL.md re-check.
- `bin/cli/done.ts` — `runHumanizer` → FINAL.md (~414), then exportDraft; GATE-04 inserts the re-check between them. The DONE-09 gate is the existing blocking-confirm precedent.
- citation-token helpers (the `[@key]` extraction used in compile smoothing / Phase-13 resolveAndRenderCitations) — reuse for the GATE-04 citekey-set diff.

### Established Patterns
- Deterministic-blocking vs advisory-WARN split (pass1/pass3 block; freshness/pass2/pass4 advise).
- crossCheckRetractions / retraction-watch cassette pattern; transport-error = silent skip (never a false block).
- Refuse-gate collects ALL reasons before refusing (compile.ts) — structural unbypassability.

### Integration Points
- compile.ts ← new `bin/lib/verify/verdict-rows.ts` (shared pair) → verify.ts; pass1.ts ← retraction-watch adapter; done.ts ← pass3 + citekey-diff helper.
</code_context>

<specifics>
## Specific Ideas

- GATE-01: compile refuses on any section with absent/unparseable VERIFICATION.md (test: delete a section's VERIFICATION.md → compile refuses naming it).
- GATE-02: writer→parser round-trip test proves the blocking citekey set survives render+parse identically; a format-drift mutation fails the test.
- GATE-03: a DOI live-retracted at verify time → MIS-CITED (blocking); a transport error → silent skip (no false block). Cassette-backed.
- GATE-04: humanized FINAL.md with an added/dropped/swapped citekey, or a broken quote, blocks export; clean humanize passes; absent humanizer skips cleanly.
</specifics>

<deferred>
## Deferred Ideas

- Full SSRF guard on the retraction re-query's network path (HARD-02 → Phase 15 — Phase 14 reuses the existing http.ts path).
- Unverifiable-quote 4th DONE-09 advisory bucket (UVQ-01 → v2/Future).
- Pass-2/Pass-4 advisory recalibration (out of scope — they stay advisory).
</deferred>
