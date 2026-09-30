---
phase: 20-verify
stream: gate
branch: v1/p20-gate
base: 1e43b9e (docs(20): plan phase 20 VERIFY) + seam S-C (3ce1408)
requirements: [VRFY-16, VRFY-17, VRFY-20, VRFY-22, VRFY-23, VRFY-24, VRFY-25, VRFY-26, VRFY-27, VRFY-28]
decisions: [D-20-04, D-20-05, D-20-15, D-20-20, D-20-21, D-20-22, D-20-23, D-20-24, D-20-25, D-20-26, D-20-27, S-13]
---

# Phase 20 — stream `gate` summary

compile and done recompute the gate from the exact text they process through
one gate core and trust no local file; verify never leaves a stale `verified`,
survives a malformed bibliography, writes a summary-first VERIFICATION.md and
blocks UNASSIGNED, citation-free and placeholder drafts; a quote no source text
can check is accepted per quote, recorded, and honoured only while the
recomputed row is still `UNVERIFIABLE-QUOTE`; stale inputs are refused; done
decides UNSUPPORTED claims at a registry gate, records the decisions and the
whole-paper Pass 4 at paper level, records `last_verified`, and never writes
under `sections/`.

## Requirements

| Req | What shipped | Where |
|---|---|---|
| VRFY-16 | `parseBibEntries` (entry by entry: good entries checked, a broken cited entry is `UNPARSEABLE` naming key + line, CRLF-safe); PLAN.md `verifying` with the verified hash removed before any pass; every early return persists a status (missing DRAFT.md → `writing`; missing/empty bib with citations → FABRICATED rows, `failed`, exit 4); the router re-verifies `verifying`, re-drafts a section whose DRAFT.md is gone, and never repeats an identical verify | `bin/lib/citations.ts`, `bin/cli/verify.ts`, `bin/lib/router.ts` |
| VRFY-17 | `UNASSIGNED` row right after the key's registrar row, naming `pensmith plan N --revise` / `pensmith add --remap <key> --section N`; at done the allowed set is the union of the sections' `assigned_sources` | `bin/lib/verify/gate.ts` |
| VRFY-20 | `QUOTE-ACCEPTANCES.json` schema v1 + its one module; `verify N --accept-quote <id>` (repeatable, read from raw argv since citty keeps only the last value); any other id → exit 2 naming its verdict, nothing recorded; the `quote-accept` registry gate (multi-select + "accept all", `--yolo` never, non-TTY skip); the lift only for a recomputed `UNVERIFIABLE-QUOTE` with the same citekey, quote hash and current draft hash; `## Accepted quotes` in VERIFICATION.md, `## Accepted Quotes` / `## Quotes Verified Against Your Files` in COMPILE-REPORT.md (additive), done's list; `--accept-unverifiable-quotes` stays an unknown flag | `bin/lib/schemas/quote-acceptances.ts`, `bin/lib/quote-acceptance.ts`, `bin/cli/verify.ts`, `bin/lib/gates.ts`, `bin/lib/compile-report.ts`, `bin/cli/done.ts` |
| VRFY-22 (done side) | the `unsupported-claims` gate (label "Export the paper with these UNSUPPORTED claims?", `--yolo` skip = export and record as auto-accepted, non-TTY/decline exit 3) with each claim's evidence; the decisions (`Confirmed by user <ISO>` / `Auto-accepted under --yolo <ISO>`) in `.paper/VERIFICATION.md` `## Decisions`; the claims listed before a non-TTY refusal | `bin/lib/gates.ts`, `bin/cli/done.ts`, PRD §7.20 |
| VRFY-23 (done side) | whole-paper Pass 4 over the exact text to be exported (FINAL.md when humanized), its per-paragraph table in `.paper/VERIFICATION.md` | `bin/cli/done.ts` |
| VRFY-24 | summary-first VERIFICATION.md (`Status`, `Draft: sha256`, `## Summary` `| Pass | Verdict | Count |`, Pass-1, Pass-3, Draft checks, Accepted quotes, freshness, Pass-2, Pass-4) with a parser proving counts = rows; `NO-CITATIONS`; the stub marker `write` prepends in LLM-stubbed mode; `PLACEHOLDER` outside `--dry-run`; the dry-run compile strips the marker | `bin/lib/verify/verification-md.ts`, `bin/lib/verify/gate.ts`, `bin/cli/write.ts`, `bin/lib/compile.ts` |
| VRFY-25 | compile: each section's record can only add refusals (missing / no Status / failed / `--dry-run` / another draft's hash / failed PLAN), then the gate core over the exact draft bytes with `assigned_sources`, the section's acceptances and the one bibliography; a stale section re-verified through `verifySection` with the advisory passes off (its VERIFICATION.md + PLAN.md are the only section writes); an unreadable bib is a named refusal; compile never writes LIBRARY.json, CITATIONS.bib or `last_verified` | `bin/lib/compile.ts`, `bin/cli/compile.ts` |
| VRFY-26 | done: sections from STATE.json + OUTLINE.md (OUTLINE rows when STATE registers none — the set compile compiles), never a directory listing; the gate core over `.paper/DRAFT.md` before any paid step and again over FINAL.md's bytes; every reason listed; neither `--yolo` nor `--raw` bypasses it; never writes under `sections/` | `bin/cli/done.ts` |
| VRFY-27 | COMPILE-INPUTS.json v2 (`compiled_draft_sha256`, per-section `verified_against_draft_hash`) + `migrations/compile-inputs/v1_to_v2.ts`; done refuses a section changed since verification, a section re-verified since compile, a compiled DRAFT.md changed since compile, a v1 or missing record; the router reports a hand-edited compiled draft as attention and recompiles a v1 record | `bin/lib/schemas/compile-inputs.ts`, `bin/lib/migrations/compile-inputs/v1_to_v2.ts`, `bin/lib/compile-inputs.ts`, `bin/cli/done.ts`, `bin/lib/router.ts` |
| VRFY-28 (recheck + recording) | `verify/clock.ts` (`PENSMITH_TEST_NOW` only under a test context); `recheckKeys` = cited keys with `last_verified` null or older than `recheck_after_days` (default 30) → `refresh`; `recordLastVerified(gate.checkedAt)` after verify and done (compile never) | `bin/lib/verify/clock.ts`, `bin/lib/verify/gate.ts`, `bin/cli/verify.ts`, `bin/cli/done.ts` |

Also: the router's S-13 routing (an `unverifiable` section whose draft verify
judged does not stop the walk; compile refuses it with its options; `status`
names them — `unverifiableSectionDetail`), `revise` repairs every
citekey-bearing failing verdict (`REVISABLE_VERDICTS`: FABRICATED, MIS-CITED,
RETRACTED, UNASSIGNED, UNPARSEABLE, UNRESOLVABLE, NOT_FOUND) and reads the
D-20-20 row formats; refusals word a citation as `citation [@key] is VERDICT`.

## Files

New: `bin/lib/verify/gate.ts`, `bin/lib/verify/clock.ts`,
`bin/lib/verify/verification-md.ts`, `bin/lib/quote-acceptance.ts`,
`bin/lib/schemas/quote-acceptances.ts`,
`bin/lib/migrations/compile-inputs/v1_to_v2.ts`.

Modified: `bin/cli/verify.ts`, `bin/cli/compile.ts`, `bin/cli/done.ts`,
`bin/cli/write.ts` (stub marker), `bin/lib/compile.ts`,
`bin/lib/compile-report.ts`, `bin/lib/compile-inputs.ts`,
`bin/lib/schemas/compile-inputs.ts`, `bin/lib/citations.ts`
(`parseBibEntries`), `bin/lib/gates.ts`, `bin/lib/router.ts`,
`bin/lib/revise.ts`, `bin/lib/status-view.ts`, `bin/lib/verify/verdict-rows.ts`,
`scripts/e2e-smoke.mjs` (stub-marker check).

Docs: `PRD.md` (§7.7 intro + output/status, §7.8, §7.9, §7.12 recheck, §7.20
the two gate rows), `README.md` (verifier section, `--yolo` list, `verify` row),
`CLAUDE.md` (workspace list: `QUOTE-ACCEPTANCES.json`, COMPILE-INPUTS v2; the
Gates, Verify and Compile/done paragraphs; the non-negotiable `--yolo` list),
`CONTRIBUTING.md` (stub drafts are PLACEHOLDER; gate fixtures).

Phase 23a concurrency — edited in place, no new files there:
`workflows/verify.md`, `workflows/compile.md`, `workflows/done.md`,
`skills/verify-section.md`.

## Tests

New suites: `gate-core`, `verify-summary`, `verdict-rows-roundtrip.property`,
`verify-malformed-bib`, `verify-unassigned`, `verify-placeholder`,
`quote-acceptance`, `quote-acceptance-cli` (+ child driver
`tests/fixtures/paper-cli/verify-quote-prompt.ts`), `compile-recompute`,
`done-recompute`, `forged-artifacts`, `stale-inputs`, `last-verified-recheck`;
helper `tests/helpers/gate-paper.ts` (papers citing recorded works).

### PLACEHOLDER / NO-CITATIONS fallout (D-20-21) — each moved, never bypassed

| Test | Was | Now |
|---|---|---|
| `tier-contract.test.ts` | `write` (NO_LLM) expected to verify | write-section: both tiers exit 4 on the chained verify's PLACEHOLDER (parity kept); wave parity drafts with `--no-verify`; done parity seeds a real verified + compiled paper |
| `tier-contract/exit-parity.test.ts` | NO_LLM write → verify 0 | a successful verify of seeded prose, and a blocked stub write (both tiers exit 4) |
| `tier-contract/paper-root.test.ts` | NO_LLM write then verify | `write --no-verify`, then seeded prose, then verify |
| `llm-transport.test.ts` (T-11-06) | NO_LLM write verifying | `write 1 --no-verify` |
| `session-lock.test.ts` | NO_LLM write verifying | `write 1 --no-verify` |
| `section-status-transitions.test.ts` | stub draft verified | the marker line stripped (seeded prose) before verify |
| `paper-root-resolver.test.ts` | NO_LLM write verifying | `--no-verify` |
| `verifiable-sources-cli.test.ts` | NO_LLM plan/write/compile/done | the RUN-21 mock LLM (same contract stubs, unmarked) |
| `wave-write-plan-errors.test.ts`, `write-containment.test.ts` (GRND-15) | citation-free drafts with assigned sources | no assigned sources for those sections (else NO-CITATIONS) |
| `verify-no-llm.test.ts` | missing bib → exit 1 | FABRICATED rows, `failed`, EXIT_BLOCKED (VRFY-16) |
| `bare-chain.test.ts`, `dry-run-chain.test.ts` | an unverifiable §1 → attention | S-13: the next step is §2 (then compile refuses §1; `status` names the remedy) |
| `compile-refuse`, `compile-staleness`, `smoother-token-protect`, `compile-bib-regen`, `compile-done-gate-parity`, `compile-report-schema`, `empty-bib`, `export-blocking-gate`, `done-terminal`, `cli-exit-codes`, `dry-run-sources`, `pensmith-router`, `gates-registry`, `verify-advisory-isolation` | fixtures whose VERIFICATION.md disagreed with the draft, or no compile record / registered sections | fixtures cite recorded works (lecun2015, aspelmeyer2009, zhu2020) or keys the bib lacks for the refusal cases; seeded compiled papers carry COMPILE-INPUTS v2 (`writeCompileRecord`); sections registered in STATE.json; new cases for the recomputation overruling a passing re-verify seam, the two report sections, the S-13 walk, the hand-edit attention, a v1 record |

### Other streams' tests touched (separate `test(20-gate): <file> — <reason>` commits)

- `tests/library-writer.test.ts` (registrar) — an unparseable bib entry is an `UNPARSEABLE` row naming key and line, exit 4 (was exit 1 "not valid BibTeX").
- `tests/offline-fail-closed.test.ts` (registrar) — the compile/done fixtures agree with their records (the gate recomputes from the draft); the done case uses the recomputation.
- `tests/verify-retraction-cli.test.ts` (registrar) — compile names the recomputed `citation [@k] is MIS-CITED — cited work is retracted` row.
- `tests/pass3-byo-cli.test.ts` (quotes) — Pass-3 rows carry their quote id (`[q1]`, D-20-20).
- `tests/add-pdf-attach-cli.test.ts` (Phase 19, unowned) — Pass-3 rows carry their quote id.

## Deviations

1. **Seam hunks superseded (gate-owned files).** `bin/cli/verify.ts`'s "status through `sectionOutcome`" hunk and `bin/cli/compile.ts`'s "`productionReVerify` through `blocksCompile`" hunk (and its import line) are replaced: verify's status is the gate core's `gateOutcome` (which calls `sectionOutcome`), and `productionReVerify` delegates to `verifySection` with the advisory passes off (the gate core applies `blocksCompile`). `bin/lib/verify/verdict-rows.ts`: `sectionVerificationReasons` now calls `verdictRowReason` (the line just before the seam hunk; the seam hunk itself and every seam API are kept; `tests/verdicts.test.ts` passes). The seam's own contract is unchanged; nobody else edits these files, so the merge takes this side.
2. **GATE-04 key diff kept** alongside the gate core over FINAL.md (D-20-24 says "replacing"). It is stricter — the gate core cannot see a citation the humanizer dropped — and removing it would loosen the existing GATE-04 tests. The integrator may drop it if D-20-24 is meant literally.
3. **compile checks a section's own record before its staleness re-verify** (the pre-Phase-20 order): a never-verified, failed or `--dry-run` section is refused as it stands and never verified in the user's place; the gate core still recomputes it, so the refusal names its rows. A missing VERIFICATION.md reads `no verifiable VERIFICATION.md (missing VERIFICATION.md: …)` (both historical phrases).
4. **done's sections** fall back to OUTLINE.md's rows when STATE.json registers none — the same set compile compiles (a legacy root STATE.json is not moved under `--dry-run`).
5. **Router:** a v1 compile record is stale (→ compile); a compiled paper with no record at all keeps the D-18-39 mtime fallback, and done then refuses it naming `pensmith compile` (not re-routed, to keep the legacy routing tests' behaviour).
6. **`verifySection` gained a `gateDeps` option** (the gate core's Pass-1/Pass-3 seams). The CLI never passes it; tests use it to stand in for the quotes stream's `UNVERIFIABLE-QUOTE` (in-process and the child driver) and to make a pass throw mid-verify (VRFY-16).
7. **`TEXT_SCANNERS` is empty** in `gate.ts`: the plumbing (rows keyed `L<line>`, blocking, rendered, parsed, counted) is tested with an injected scanner; the grammar stream's scanners are wired at integration.
8. **The router's `verified` + missing DRAFT.md** still continues (only `written` / `verifying` / `unverifiable` without a draft route to `write`), to keep the existing router totality cases.
9. **MCP / Tier 1:** no acceptance input on the MCP tools (PLUG-10's verify tool calls `recordQuoteAcceptances` later, per D-20-22).

## Handed to integration (Phase 20 §7)

- Wire the grammar stream's text scanners into `gate.ts` `TEXT_SCANNERS` (UNSUPPORTED-FORM / UNPARSEABLE `L<line>` rows).
- Quotes stream: Pass 3's `UNVERIFIABLE-QUOTE` / `UNVERIFIABLE-NETWORK` / `PASS` / `FUZZY` labels and `localFile`; then the real CLI flow of `--accept-quote` / the `quote-accept` gate on a live `UNVERIFIABLE-QUOTE` (today proven through the stand-in seam), the byo-quote lists end to end, and the retirement of the legacy `PDF_UNAVAILABLE` / `TEXT_UNAVAILABLE` rows.
- Registrar stream: `Pass1Result.checkedAt` (then `recordLastVerified` records real times — today offline runs record none), adapters honouring `refresh` past the HTTP cache, the `last_verified` bib field and export allowlist; the end-to-end VRFY-28 test (age a citation with `PENSMITH_TEST_NOW`, see it re-fetched) and "a second done on an unchanged paper is served from the caches".
- The §7 e2e acceptance suites (VRFY-26 `[@smith2099fake]`, VRFY-23 orphan sentences appended to a section draft, re-verified and recompiled).

## Verification

`npm run prebuild`, `npm run lint`, `npm run typecheck`, `npm run build`,
`npm run validate:manifests`: clean. `npm test`: every suite passes except the
root-only `tests/atomic-write.test.ts` "preserves OLD content on rename/write
failure" case. `npm run test:tier-contract`: pass. `node scripts/e2e-smoke.mjs`:
17 PASS, 0 FINDING, 0 FAIL (new `stub-marker` check). Scratch CLI checks (built
CLI, offline, isolated data dir): a forged clean VERIFICATION.md + PLAN.md over
a fabricated key → compile REFUSED naming the recomputed row, exit 4, no
DRAFT.md; one broken + one good bib entry → verify exit 4, `UNPARSEABLE`
naming the key and line, the good key OK, no stack; a 0-byte bib with `[@a]` →
FABRICATED, `failed`, compile exit 4 with no parseBib stack; `[@lecun2015]`
outside §1's assigned sources → `UNASSIGNED`, exit 4; a citation-free draft
with two assigned sources → `NO-CITATIONS`, `failed`; an introduction with none
assigned and no citations verifies.
