---
phase: 10-discipline-citation-style-breadth-zotero-mcp
verified: 2026-06-22T06:31:22Z
status: passed
score: 3/3 success criteria verified (RSCH-06, CITE-02, CITE-03, CITE-05 all SATISFIED)
re_verification: # No previous VERIFICATION.md existed
  previous_status: none
human_verification: # Manual-only item (NOT a gate blocker — non-breaking by design)
  - test: "Live Zotero MCP end-to-end: install a real Zotero MCP server, set ZOTERO_API_KEY, run `pensmith research`, confirm Zotero items enter the candidate pool with source:'zotero-mcp'."
    expected: "Zotero-sourced candidates flow into research alongside the other 7 adapters; doctor reports PASS; with the server absent or unauthenticated, research still completes on the other 7 adapters and doctor reports WARN."
    why_human: "There is NO CI coverage of the live MCP transport. The injectable-client seam (setZoteroClientForTest) makes the normalization path executable + tested with a fake client, but the real MCP-backed client is wired only in the Tier-1 workflow body. The doctor PASS branch (configured+authenticated) and CONFIGURED_NO_AUTH branch are documented as manual-only (carried MEDIUM M5/M8). Accepted by design per SUMMARY 10-03/10-04 'User Setup Required: None — live MCP transport is MANUAL-only with no CI coverage by design.'"
---

# Phase 10: Discipline + citation-style breadth + Zotero MCP — Verification Report

**Phase Goal:** Widen citation-style support via CSL + citation-js, add RIS export, ship remaining discipline-preset depth, and complete Zotero MCP source provider integration. Breadth that doesn't gate v0.1.0 launch.
**Verified:** 2026-06-22T06:31:22Z
**Status:** passed
**Re-verification:** No — initial verification
**Final phase of the milestone.**

## Goal Achievement

This phase delivers three independent breadth surfaces. All three success criteria are met at the **literal SC level** with executable evidence (live test runs, not SUMMARY claims). The full gate is GREEN at HEAD: `npm run check` exits 0 — eslint clean, `tsc --noEmit` clean, build clean (verbs.json = 16 verbs), tier-contract `fail 0`, full suite **856 pass / 0 fail / 0 skip**, manifests valid.

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 (SC1) | APA 7, MLA, Chicago (notes-bib + author-date), IEEE, AMA, Vancouver, Harvard all render correctly via citation-js + bundled CSL in `templates/citation-styles/` | ✓ VERIFIED | `bin/lib/citations.ts:237` `renderStyle()` renders all 8 via `readFileSync` of bundled `.csl` (offline). Live: `tests/citation-render.test.ts` **21/21 pass, 0 skip** — 7 new styles + apa each produce non-empty bibliography; determinism + no-collision + H2 byte-parity proven. 8 CSL files present (`apa/mla/chicago-notes-bib/chicago-author-date/ieee/ama/vancouver/harvard`). |
| 2 (SC2) | RIS export ships alongside BibTeX, both `.bib`/`.ris` bundled into the export package | ✓ VERIFIED | `bin/lib/ris-write.ts:111` `writeRis` (RIS2001 `spec:'new'`). `bin/cli/research.ts:86` emits `.paper/CITATIONS.ris` alongside `.bib`. `bin/lib/exporter.ts:534-540` copies `.ris` into export dir (`risCopied`). Live: `tests/ris-write.test.ts` **4/4**, exporter ris tests **2/2** (copy-present + absent-no-throw), tier-contract `research --yolo` lands BOTH files. |
| 3 (SC3) | Zotero MCP detected, authenticated, used as a source provider when present; doctor reports auth state; absence does NOT break research | ✓ VERIFIED | `bin/lib/sources/zotero-mcp.ts:163` `search()` 4-gate predicate pulls+normalizes to `source:'zotero-mcp'` candidates on present+auth+client; returns `[]` (never throws) on every absence path. `sources/index.ts:33` registers `'zotero-mcp'`. Tri-state probe `doctor/probes/zotero-mcp-presence.ts` (ABSENT/CONFIGURED_NO_AUTH/PASS), no key leak. Live: `tests/sources/zotero-mcp.test.ts` **4/4** (incl. injected-client used-as-source leg + inverse absence→[]), `doctor-probes.test.ts` tri-state + no-leak **PASS**. |

**Score:** 3/3 success criteria verified.

### Structural Confirmations (A–D from objective)

#### A. SC1 — offline + deterministic + single-registration

- **All 8 styles render via citation-js + bundled CSL, offline.** `renderStyle` reads the `.csl` via `readFileSync(path.join(PKG_ROOT,'templates','citation-styles',...))` (`citations.ts:148`) — never fetched. `format:'text'` + `lang:'en-US'` + `template:'pensmith-${style}'` (`citations.ts:246-250`). Live test proves byte-identical double-render of `ieee` (`citation-render.test.ts:142-162`).
- **No external-URL parent refs in committed CSL.** `grep 'independent-parent'` across `templates/citation-styles/*.csl` → **NONE**. The only `<link>` entries are `rel="self"`/`rel="documentation"`/`rel="template"` (metadata; harvard.csl:7 carries `rel="template"` provenance) — none is `rel="independent-parent"`, so citeproc never attempts a network fetch at `templates.add`. Confirmed all 7 new files are real CSL XML (`<?xml` header, not 404 HTML).
- **renderApa delegates to renderStyle('apa') — single registration.** `citations.ts:299-304` body is `return renderStyle(entries, 'apa')`. `apaRegistered` boolean + `ensureApaTemplate` deleted; `ensureStyleTemplate` (`citations.ts:139`) is the SOLE registrar of `'pensmith-apa'`, Map-guarded (`registeredStyles`). `_resetApaTemplateForTest` re-points to `registeredStyles.delete('apa')` (`citations.ts:171-173`), lockstep with `_resetStyleTemplatesForTest`. Live H2 proof: back-to-back `renderApa()` + `renderStyle(entries,'apa')` in one process `doesNotReject` + byte-identical (`citation-render.test.ts:171-198`). **PASS.**

#### B. SC2 — RIS through the D-19/D-07 chokepoints + dual-bundle

- **D-19 chokepoint:** `ris-write.ts:35` `import { Cite } from './citations.js'` — NOT `citation-js`. Repo-wide `grep "from 'citation-js'"` → only `bin/lib/citations.ts:67` (sole importer). `@citation-js/plugin-ris` bundled in `citation-js@0.7.22` (no separate dep).
- **D-07 chokepoint:** `ris-write.ts:36,147` final write through `atomicWriteFile`.
- **Research-time emission:** `research.ts:65,86` writes `CITATIONS.ris` at the SAME call site as `.bib`.
- **Exporter dual-bundle:** `exporter.ts:534-540` symmetric `.ris` copy block (`risSrc !== risDst && existsSync(risSrc)`), `ExportResult.risCopied` (`exporter.ts:326,542`).
- **Spot-check:** ran `writeRis` directly → valid RIS2001 (`TY  - JOUR ... ER  -`), **no pensmith fingerprint** (zero-trace preserved). **PASS.**

#### C. SC3 — Zotero as a real source provider (not a stub)

- **Registry membership:** `'zotero-mcp': zoteroMcp` in `sources/index.ts:33`; `AdapterName` auto-expands.
- **D-14 union variant:** `z.literal('zotero-mcp')` in `schemas/source-candidate.ts:54`.
- **Executable used-as-source path:** `search()` 4-gate predicate (`zotero-mcp.ts:163-187`): (1) presence/injected-client, (2) key-only auth `!!process.env['ZOTERO_API_KEY']`, (3) no-client, (4) `try { _client.search → map(toCandidate).filter } catch { [] }`. `toCandidate` (`zotero-mcp.ts:101-149`) requires id+title+≥1 author, year-bounded 1800–2100, `generateCitekey`, `source:'zotero-mcp'`. Live: injected-client+key → ≥1 normalized candidate; null-client+no-key → `[]`.
- **Absence non-breaking:** every gate returns `[]` and `search()` NEVER throws (live leg-a + `doesNotReject`).
- **Tri-state doctor probe, no leak:** `zotero-mcp-presence.ts` returns ABSENT(WARN)/CONFIGURED_NO_AUTH(WARN)/PASS, dot-access `process.env.ZOTERO_API_KEY` (D-12), value never interpolated; live no-leak sentinel test PASS.
- **No banned imports:** adapter imports `isZoteroMcpPresent`, `generateCitekey`, `SourceCandidate` type only — NO http.ts, NO citation-js (the only `citation-js` mention is the ban comment). **PASS.**

#### D. Disciplines depth + intake breadth + WN-3 re-pin + bijection

- **disciplines.json complete:** 9 entries, all 6 PRD §8 fields; `computer-science.defaultCitationStyle = "ieee"` (`disciplines.json:12`, corrected from apa); every `defaultCitationStyle` resolves to a bundled `.csl`. Live: `disciplines-schema.test.ts` 4/4.
- **intake-clarifier offers all 8 styles:** `intake-clarifier.md:36-37,64` list APA/MLA/Chicago NB/Chicago AD/IEEE/AMA/Vancouver/Harvard; the "APA only / deferred" caveat is gone (line 39 is a legitimate render-time APA *fallback* note, not a deferral).
- **WN-3 re-pinned to real SHA-256, no bypass:** actual `sha256sum` of `intake-clarifier.md` = `e2fa74ba6add0cac5f2fae1cb285d1023ed3e7057fa46f69320b38e207be9a39` = the pin in `prompt-loader.ts:97` AND `tests/repo-files.test.ts:308` (perfect lockstep, no `__PENDING_HASH_` sentinel). Spot-check: `loadPrompt('intake-clarifier')` resolves WITHOUT `PENSMITH_ALLOW_PENDING_PROMPT_HASHES` and the loaded text mentions all 8 styles.
- **No 17th verb; 16-workflow bijection intact:** `verbs.json` = 16 verbs; `tier-contract.test.ts:1646-1673` asserts `UX02_VERBS.length===16`, no `zotero-mcp/zotero/ris/style` token leak, `'zotero-mcp' in sources`; `workflows/` = exactly 16 bodies (bijective). `research.md:17-18,52` declares present+auth used-as-source wiring + absent/no-auth fallback + "source provider, not a verb" note.
- **No new npm deps:** `package.json` dependencies unchanged; `citation-js@0.7.22`; no `@citation-js/plugin-ris` separate dep; no package.json changes in the phase-10 window.
- **Prior non-negotiables NOT weakened:** verifier gate (compile REFUSE path still tested), zero-trace (7 zero-trace tests A–G GREEN; `.ris` plain-text covered by the scan; RIS has no fingerprint), honest framing (no detection-evasion language touched). **PASS.**

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `templates/citation-styles/{mla,chicago-notes-bib,chicago-author-date,ieee,ama,vancouver,harvard}.csl` | 7 bundled offline CSL render assets | ✓ VERIFIED | All present (10–86 KB), real CSL XML, no independent-parent links |
| `bin/lib/citations.ts` | `renderStyle`/`resolveStyleName`/Map memo + renderApa delegation | ✓ VERIFIED | Substantive (305 lines); D-19 sole importer; H2 single-registration |
| `bin/lib/ris-write.ts` | RIS2001 serializer through D-19/D-07 | ✓ VERIFIED | 148 lines; `{Cite}` from citations.js, atomicWriteFile, suffixForCollision imported |
| `bin/lib/exporter.ts` | `risCopied` + `.ris` bundle block | ✓ VERIFIED | Lines 326,534-542 |
| `bin/cli/research.ts` | research-time `CITATIONS.ris` emission | ✓ VERIFIED | Lines 22,65,86 |
| `bin/lib/sources/zotero-mcp.ts` | presence+auth-gated used-as-source adapter | ✓ VERIFIED | 188 lines; 4-gate predicate; injectable client; real normalizer |
| `bin/lib/sources/index.ts` | `'zotero-mcp'` registered | ✓ VERIFIED | Line 33 |
| `bin/lib/schemas/source-candidate.ts` | `'zotero-mcp'` D-14 union variant | ✓ VERIFIED | Line 54 |
| `bin/lib/doctor/probes/zotero-mcp-presence.ts` | tri-state probe, no key leak | ✓ VERIFIED | ABSENT/CONFIGURED_NO_AUTH/PASS; dot-access env read |
| `templates/presets/disciplines.json` | 6-field schema, CS=ieee | ✓ VERIFIED | 9 entries complete |
| `templates/prompts/intake-clarifier.md` | 8-style offer | ✓ VERIFIED | Lines 36-37,64; re-pinned hash matches |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `ris-write.ts` | `citations.ts` `{Cite}` | import (D-19) | ✓ WIRED | `ris-write.ts:35` |
| `research.ts` | `ris-write.ts` `writeRis` | call at research time | ✓ WIRED | `research.ts:22,86` |
| `exporter.ts` | `CITATIONS.ris` | copyFile into export dir | ✓ WIRED | `exporter.ts:537-539` |
| `zotero-mcp.ts` | `sources/index.ts` | registry entry | ✓ WIRED | `index.ts:33` |
| `zotero-mcp.ts` | `SourceCandidate` schema | `source:'zotero-mcp'` | ✓ WIRED | normalizer + D-14 variant |
| `intake-clarifier.md` | `prompt-loader.ts` | EXPECTED_PROMPT_HASHES pin | ✓ WIRED | hash lockstep, loads without bypass |
| `renderStyle`/`resolveStyleName`/`renderApa` | compile/export bibliography path | dispatch on `config.toml citation_style` | ⚠️ NOT WIRED | No production consumer — see Gaps Summary / accepted MEDIUM M6 |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 8-style render | `tsx --test tests/citation-render.test.ts` | 21 pass / 0 fail / 0 skip | ✓ PASS |
| RIS round-trip | `tsx --test tests/ris-write.test.ts` | 4 pass / 0 fail | ✓ PASS |
| Exporter `.ris` bundle | `tsx --test tests/exporter.test.ts` (ris) | 2 pass / 0 fail | ✓ PASS |
| Zotero used-as-source | `tsx --test tests/sources/zotero-mcp.test.ts` | 4 pass / 0 fail | ✓ PASS |
| Doctor tri-state + no-leak | `tsx --test tests/doctor-probes.test.ts` | 14 pass / 0 fail | ✓ PASS |
| disciplines 6-field | `tsx --test tests/disciplines-schema.test.ts` | 4 pass / 0 fail | ✓ PASS |
| RIS no fingerprint | `writeRis` → scan for "pensmith" | false (no trace), valid RIS2001 | ✓ PASS |
| Prompt loads w/o bypass | `loadPrompt('intake-clarifier')` no env flag | resolved; 8 styles present | ✓ PASS |
| Full gate | `npm run check` | 856 pass / 0 fail / 0 skip; lint+tsc+build+tier-contract+manifests green | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CITE-02 | 10-00/01/03/04 | MLA, Chicago NB+AD, IEEE, AMA, Vancouver via CSL | ✓ SATISFIED | 21/21 render tests; bundled CSL; SC1 |
| CITE-03 | 10-00/01/04 | Harvard citation style | ✓ SATISFIED | `harvard.csl` + render test GREEN |
| CITE-05 | 10-00/02 | RIS export alongside BibTeX (Mendeley/EndNote) | ✓ SATISFIED | `writeRis` RIS2001 + dual-bundle; SC2 |
| RSCH-06 | 10-00/03/04 | Zotero MCP source provider when detected+authenticated | ✓ SATISFIED | adapter + registry + tri-state probe; SC3 |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | No `TBD`/`FIXME`/`XXX` in any phase-modified source file | — | Clean — completion is auditable |
| (none) | — | No `TODO`/`HACK`/`PLACEHOLDER`/stub returns in new modules | — | `[]`-on-absence in zotero-mcp is the documented ARCH-03 non-breaking contract, not a stub (the present+auth+client path is real, executable, tested) |

### Accepted MEDIUMs (cross-AI review, carried non-blocking)

This phase passed 3 cross-AI convergence cycles (codex + claude + opencode quorum; gemini unavailable via IneligibleTierError). Cycle 3: **current_high: 0 — CONVERGED.** All 3 prior HIGHs (H1 Zotero used-as-source, H2 renderApa single-registration, H3 canonical 4-gate predicate) confirmed GENUINELY RESOLVED against live source. The following MEDIUMs were explicitly carried to execution as **non-blocking** (10-REVIEWS.md §"Remaining MEDIUM/LOW") and are noted here for milestone-close visibility:

- **M5/M8 — doctor PASS + CONFIGURED_NO_AUTH branches unprovable on CI.** The no-leak non-negotiable IS proven; only the configured-path branch logic ships without a CI test forcing `isZoteroMcpPresent()===true`. Documented as manual-only. (Verified: probe code itself is tri-state and correct; only the live-PASS *test coverage* is absent.)
- **M6/M9 — citation-style not wired end-to-end into the exported bibliography.** SC1's literal text ("render via citation-js + bundled templates") is met by `renderStyle` at the unit level, but no production consumer dispatches the compile/export bibliography render off `config.toml citation_style` (see Gaps Summary). Reviewers capped this at MEDIUM ("10-03 scopes consumption out"; the literal SC is satisfied) — NOT a HIGH/goal-threat, NOT re-litigated in cycle 3.
- **M2 — `.ris` emitted only at `research.ts`, not at every `writeBibtex` call site** (potential stale `.ris` after `pensmith add`). Non-blocking; symmetric `.ris` at research time is the shipped contract.
- **M7 — render-time locale fetch not proven blocked by a network-disabled test** (same path Phase-3 renderApa already ships; offline posture is the de-facto safety net). Non-blocking.
- LOW items (CSL procurement not pinned to a commit SHA; Chicago edition drift; search-signature drift) — cosmetic/robustness nits, self-correcting.

### Human Verification Required

**1. Live Zotero MCP end-to-end (MANUAL-only — by design, not a gate blocker)**

- **Test:** Install a real Zotero MCP server, set `ZOTERO_API_KEY`, run `pensmith research`. Then remove/unauthenticate it and re-run.
- **Expected:** With server present+authenticated → Zotero items enter the candidate pool as `source:'zotero-mcp'` alongside the other 7 adapters; `pensmith doctor` reports the zotero-mcp probe as PASS. With server absent or `ZOTERO_API_KEY` unset → research still completes on the other 7 adapters (non-breaking); doctor reports WARN (ABSENT or CONFIGURED_NO_AUTH).
- **Why human:** No CI coverage of the live MCP transport. The injectable-client seam makes the normalization path executable+tested with a fake client; the real MCP-backed client is wired only in the Tier-1 workflow body. Per SUMMARY 10-03/10-04 this is an accepted, documented MANUAL-only item.

### Gaps Summary

**No goal-blocking gaps.** All three ROADMAP success criteria are met at their literal level with executable evidence, the full gate is GREEN (856/0/0), and all four phase requirements (RSCH-06, CITE-02, CITE-03, CITE-05) are SATISFIED.

**One observability note (accepted MEDIUM M6, NOT a blocker):** `renderStyle`, `resolveStyleName`, and `renderApa` currently have **no production consumer** — they are exercised only by tests. The exporter's Pandoc argv (`buildPandocArgs`, `exporter.ts:415-430`) does not pass `--citeproc`/`--csl`, and no compile/export code reads `config.toml citation_style` to dispatch a styled bibliography render. Consequence: a user who selects "IEEE" gets the IEEE choice captured in intake, all 8 styles render correctly when called, and the raw `.bib`/`.ris` are bundled for their reference manager — but the styled reference list inside the exported `.docx`/`.pdf` is not yet produced by `renderStyle`. SC1 as written ("render correctly via citation-js + bundled CSL files") is satisfied; the *end-to-end user-facing wiring* is the explicitly-deferred M6 MEDIUM that the cross-AI quorum accepted as non-blocking for this breadth phase (the goal text says this phase is "breadth that doesn't gate v0.1.0 launch"). Flagged for milestone-close awareness; if end-to-end styled export is desired, it is a small follow-up wiring task (dispatch `renderStyle`/Pandoc `--csl` on the configured style).

**Human verification required** for the live Zotero MCP transport (manual-only by design) — this is why overall status surfaces the human item, but it does NOT represent a code gap: the absence-non-breaking and used-as-source-via-injected-client paths are both verified in CI.

---

_Verified: 2026-06-22T06:31:22Z_
_Verifier: Claude (gsd-verifier)_
