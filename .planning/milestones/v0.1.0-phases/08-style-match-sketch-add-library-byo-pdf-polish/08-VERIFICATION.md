---
phase: 08-style-match-sketch-add-library-byo-pdf-polish
verified: 2026-06-20T00:00:00Z
status: passed
score: 4/4 success criteria verified (12/12 truths)
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  note: initial verification (no prior 08-VERIFICATION.md)
---

# Phase 8: Style match + sketch + add + library + BYO PDF polish — Verification Report

**Phase Goal:** Differentiated features: style-match opt-in (per-paper profile only, no global cache, sample-set fingerprint, cross-paper reuse detected+surfaced, dual-use disclosure in README), `/pensmith sketch` thinking-partner mode, `/pensmith add <doi|pdf|url>`, library mode polish, BYO PDF via pdf-parse (pinned exact) + pymupdf shellout fallback.
**Verified:** 2026-06-20
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (per Success Criterion)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1a | `pensmith list` shows all papers grouped by class | ✓ VERIFIED | `bin/cli/list.ts:64-79` groups entries by `entry.class` (default 'Unfiled') into a Map and renders `[class]` headers; test `tier-contract: list parity — both tier paths produce equivalent grouped listing` PASS |
| SC1b | `pensmith open <name>` switches the active paper | ✓ VERIFIED | `bin/cli/open.ts:42-75` finds entry by name, guards `existsSync(folderPath)`, writes `pensmithActivePointerPath()` via `atomicWriteFile`; test `tier-contract: open parity — both tier paths switch the active paper` PASS |
| SC1c | Status cycles intake\|research\|outline\|sectioning(X/Y)\|compile\|done\|archived, DERIVED at display | ✓ VERIFIED | `deriveLibraryStatus` (`global-library.ts:331-391`) walks STATE.json + section frontmatter; `global-library.test.ts` LIB-05(1)-(6) assert each state incl. `sectioning {done:2,total:3}`; all PASS |
| SC2a | Style-match writes per-paper `.paper/STYLE.json` (NO global cache) | ✓ VERIFIED | `style-match.ts:311-317` writeStyleProfile → `join(paperDir,'STYLE.json')` only; never imports pensmithDataDir for the profile write; test `STYL-01: writeStyleProfile writes paperDir/.paper/STYLE.json ONLY` PASS |
| SC2b | Sample-set fingerprint stored; cross-paper reuse detected + surfaced | ✓ VERIFIED | 64-hex content fingerprint (`style-match.ts:209-211`); `checkAndRegisterFingerprint` returns priorPapers (`:334-365`); intake producer prints UNCONDITIONAL notice (`intake.ts:163-172`); tests `STYL-02 …reuse detection` + `PRODUCER (2): …UNCONDITIONALLY …even without --yolo` PASS |
| SC2c | Section drafter consumes profile + voice-hint override | ✓ VERIFIED | `write.ts:88-92` resolveVoiceHint: PLAN `voice_hint` > styleMatchToVoiceHint > default; consumer loads STYLE.json (`:101-115`); tests `STYL-03 …voice_hint WINS` + `…falls back to the style-match render` PASS |
| SC2d | README ships dual-use disclosure | ✓ VERIFIED | `README.md:9-20` `## Style Match` opt-in + honest framing; test `STYL-04: README style-match dual-use disclosure is present + honest` PASS |
| SC3 | `pensmith sketch` thinking-partner mode; NO state advance until confirm | ✓ VERIFIED | `sketch.ts:57-93` Socratic loop creates nothing; only on confirm dispatches `new` (`:107-110`); tests `ERGO-05 …DECLINED sketch creates NO .paper/ …` + `…on CONFIRM dispatches new …does NOT call initState` PASS |
| SC4a | `pensmith add <doi\|pdf\|url>` ingests mid-paper + prompts "remap sections?" | ✓ VERIFIED | `add.ts:186-220` type detect+hydrate; remap gate `:258-267` asks "Remap sections to reference it?"; test `ERGO-06: add <doi> hydrates from cassette + appends CITATIONS.bib` PASS |
| SC4b | BYO PDF via pdf-parse (pinned exact) + pymupdf shellout fallback | ✓ VERIFIED | `package.json:55` `"pdf-parse": "1.1.1"` (no range); `pdf-text.ts:143` lazy pymupdf fallback in image-only branch; tests `RSCH-05: add <pdf> …extracts text` + `pdf-parse stays pinned exact at 1.1.1` PASS |
| SC4c | Crossref metadata hydration | ✓ VERIFIED | `add.ts:33,190,197,215` crossrefFetchById/crossrefSearch via http.ts chokepoint; offline cassette `add-doi.json` (10.1038/nphys1170); test asserts hydrated title "Quantum coherence…2009" PASS |
| SC4d | remap touches ONLY assigned_sources[] (section isolation) | ✓ VERIFIED | `add.ts:131-167` remapSections appends to `assigned_sources` only; test `Pitfall 3 / A6: …leaves status + verified_against_draft_hash UNCHANGED` PASS |

**Score:** 12/12 truths verified → 4/4 Success Criteria

### Per-SC Verdict

| SC | Verdict |
|----|---------|
| SC1 — list/open/status lifecycle | **PASS** |
| SC2 — style-match per-paper + fingerprint + reuse + drafter + README | **PASS** |
| SC3 — sketch no-advance-until-confirm | **PASS** |
| SC4 — add doi/pdf/url + remap + pdf-parse pin + pymupdf fallback + Crossref | **PASS** |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `bin/lib/schemas/global-library.ts` | PAPER registry schema, KEEPS folderPath | ✓ VERIFIED | folderPath required `:54`; 7-state status enum `:56-64`; separate from library.ts/fingerprint registry |
| `bin/lib/global-library.ts` | init/load/register UPSERT + deriveLibraryStatus | ✓ VERIFIED | 4 exports; never-throw resolver with outer backstop `:387-390` |
| `bin/lib/schemas/style.ts` | StyleProfileSchema (flat pure-stats) | ✓ VERIFIED | flat top-level features, no nested `features` key; fingerprint 64-hex `:72` |
| `bin/lib/style-match.ts` | build/write/check/render | ✓ VERIFIED | 4 exports; registry stores only {paperId,paperName,addedAt} |
| `bin/lib/pymupdf-shellout.ts` | graceful-absent execFile subprocess | ✓ VERIFIED | execFile arg-array `:96`; returns null on any failure `:101-104`; tmpfile unlinked in finally |
| `bin/lib/pdf-text.ts` | extractPdfText + lazy pymupdf fallback | ✓ VERIFIED | dynamic import in image-only branch `:143`; threshold 50 |
| `bin/cli/list.ts` / `open.ts` | promoted verbs, stdout-only, never-crash | ✓ VERIFIED | both promoted via REAL_VERB_LOADERS |
| `bin/cli/sketch.ts` / `add.ts` | promoted verbs | ✓ VERIFIED | both real; STUBS list now empty |
| `bin/cli/intake.ts` | LIB-04 registration + style producer | ✓ VERIFIED | registerPaperNonFatal + runStyleProducerNonFatal `:102-183` |
| `bin/cli/write.ts` + `drafter-input.ts` | voiceHint priority + additive styleProfilePath | ✓ VERIFIED | additive optional field; strict schema preserved |
| `README.md` | Style Match dual-use section | ✓ VERIFIED | honest framing, no forbidden substrings |
| `workflows/{list,open,sketch,add}.md` | filled bodies + capability_check | ✓ VERIFIED | all 4 contain capability_check |

### Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| `list.ts` | `global-library.ts` deriveLibraryStatus | per-paper derivation `:29,76` | ✓ WIRED |
| `open.ts` | active pointer | atomicWriteFile(pensmithActivePointerPath) `:62-75` | ✓ WIRED |
| `style-match.ts` writeStyleProfile | `.paper/STYLE.json` | join(paperDir,'STYLE.json') `:315` | ✓ WIRED |
| `style-match.ts` checkAndRegisterFingerprint | style-fingerprints.json | withLock + atomicWriteFile `:344-362` | ✓ WIRED |
| `pdf-text.ts` image-only branch | `pymupdf-shellout.ts` | await import `:143` | ✓ WIRED |
| `add.ts` | crossref via http.ts | fetchById/search `:33` | ✓ WIRED |
| `add.ts` remapSections | section PLAN.md assigned_sources[] | withLock+updateFrontmatter `:152-163` | ✓ WIRED |
| `sketch.ts` (post-confirm) | dispatchVerb('new') | `:107` | ✓ WIRED |
| `intake.ts` (--style-samples) | buildStyleProfile/check/write | producer path `:156-174` | ✓ WIRED |
| `write.ts` | styleMatchToVoiceHint | priority resolution `:90` | ✓ WIRED |

### Structural Confirmations (A–H)

**A. PER-PAPER STYLE ONLY / NO GLOBAL CACHE — CONFIRMED.** Style FEATURES live only in `.paper/STYLE.json` (`style-match.ts:311-317`, never under pensmithDataDir). The fingerprint registry (`style-fingerprints.json`) stores ONLY `{ "<64hex>": [{paperId, paperName, addedAt}] }` (type `FingerprintRegistry` `:62-68`). Schema `style.ts` is flat (no nested `features` key) and the registry record carries no `features`/`folderPath`. The negative-control test `PITFALL-1` (style-match.test.ts:134-159) asserts `!/\bfeatures\b/` AND `!/folderPath/` on the raw registry JSON, plus per-feature-key absence — PASS.

**B. CROSS-PAPER REUSE SURFACED UNCONDITIONALLY — CONFIRMED.** `checkAndRegisterFingerprint` returns `priorPapers` (`:349`); the intake producer prints the notice whenever `priorPapers.length > 0` (`intake.ts:163-172`), BEFORE the write so a write failure cannot suppress it. It is NOT --yolo-gated — test `PRODUCER (2)` runs `yolo:false` and still asserts the notice fires. README:19 documents "That notice always prints; it is not something a flag can silence." CONFIRMED.

**C. add TOUCHES ONLY assigned_sources[] — CONFIRMED.** `remapSections` (`add.ts:131-167`) mutates only `fm.assigned_sources`; never `status` or `verified_against_draft_hash`. Test `Pitfall 3 / A6` seeds `status:written` + `verified_against_draft_hash:abc123def456`, runs add+remap, and asserts both fields byte-unchanged while a citekey was appended — PASS.

**D. sketch CREATES NO STATE BEFORE CONFIRM — CONFIRMED.** `sketch.ts` never calls initState/mkdir(.paper)/initLibrary in the Socratic loop or on decline; on decline it returns `{ok:false}` (`:90-93`). Test `ERGO-05 …DECLINED sketch` asserts no `.paper/`, no STATE.json, no LIBRARY.json — PASS. Second test confirms it delegates to `new` via dispatchVerb on confirm and does not init itself.

**E. pdf-parse PINNED EXACT + pymupdf ABSENT-GRACEFUL — CONFIRMED.** `package.json:55` `"pdf-parse": "1.1.1"` (literal, no `^`/`~`); guard test `pdf-parse stays pinned exact at 1.1.1` PASS. `pymupdfShellout` uses `execFile(pythonBin, ['-c', script], …)` arg-array (no shell), embeds the internal tmpfile path via JSON.stringify (no injection), and returns `null` (never throws) on ENOENT/non-zero/timeout (`:101-104`). pymupdf is absent on this machine — test forces a nonexistent interpreter and asserts `doesNotReject` + `result === null` — PASS. This absent path is the one CI exercises.

**F. deriveLibraryStatus NEVER-THROW + REAL sectioning X/Y — CONFIRMED.** Every fs/parse op is guarded; the whole body is wrapped in an outer try/catch backstop → 'unknown' (`global-library.ts:338-390`). Sectioning X/Y is computed live from section PLAN.md frontmatter (`:367-381`). Tests LIB-05(4) asserts `{done:2,total:3}`, LIB-05(7a) absent→intake, (7b) corrupt STATE.json→unknown, (7c) corrupt section PLAN.md does not crash — all PASS. `list.ts:35-38` adds a belt-and-suspenders per-entry try/catch so one bad paper cannot abort the listing.

**G. README DUAL-USE DISCLOSURE HONEST + NO 17th VERB — CONFIRMED.** `README.md:9-20` ships the `## Style Match` section. `grep -niE "impersonate|evade detection|undetectable"` returns nothing (forbidden substrings absent even in negation — line 16 uses "invisible to detectors", which is not a forbidden substring). Content-contract test STYL-04 asserts presence + the three negative controls — PASS. `UX02_VERBS` is exactly 16 entries (`verbs.ts:15-32`); tests `16-verb bijection re-asserted`, `no 17th verb`, and `workflows/ contains exactly 16 markdown bodies` + `workflow filenames are bijective with dispatcher verbs` — all PASS.

**H. INTAKE Tier-2 PLACEHOLDER / no-paperId BRANCH — ASSESSED: ACCEPTED BOUNDARY (not a gap).**
`intake.ts` is still a Tier-2 placeholder that does not itself bootstrap a paper-level STATE.json/paperId. In the real current flow, `resolvePaperId` returns null, so:
- global-library registration WARN-skips ("no paperId yet (STATE.json absent); skipping global-library registration (non-fatal)") — `intake.ts:108-113`. Observed firing in the producer test output.
- the style producer still BUILDS `.paper/STYLE.json` using a synthetic `unregistered:<cwd>` fingerprint identity (`intake.ts:154`), so SC2 (STYLE.json produced) is genuinely deliverable today and the reuse detection still works.

Assessment against the contract "authoritative STATE.json is the source of truth" + graceful degradation:
- **SC2 (STYLE.json produced) is fully deliverable now** — the producer test PRODUCER(1) creates STYLE.json with a valid 64-hex fingerprint WITHOUT any STATE.json, and PRODUCER(2) surfaces reuse without --yolo. PASS without reservation.
- **SC1 (list shows papers)** is deliverable by contract: the global registry + `deriveLibraryStatus` + list/open are all implemented and unit-proven against pre-seeded STATE.json (the library-test tmpdir pattern). The single missing link in the live end-to-end chain is intake's STATE.json/paperId bootstrap — which the plan explicitly scopes as earlier-phase / Phase-4+ work (intake.ts header: "Phase 4 adds bin/lib/anthropic.ts"; the registration is documented as a deliberately non-fatal seed). The DERIVE-AT-DISPLAY design means once STATE.json exists, list shows the correct live status with zero further wiring. This is an **accepted architectural boundary**, not a Phase-8 gap: Phase 8's declared artifacts (registry, derive resolver, list/open verbs, registration call-site) are all present, wired, and tested; the upstream bootstrap is out of Phase 8's declared scope and tracked to Phase 4+.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase-8 targeted suites | `node --import tsx --test tests/{style-match,global-library,sketch,add-source,intake-style-producer,pymupdf-shellout,write-style-integration}.test.ts` | 28/28 pass, 0 skip | ✓ PASS |
| tier-contract + cli-stubs + repo-files + cli-verbs | `node --import tsx --test tests/{tier-contract,cli-stubs,repo-files,cli-verbs}.test.ts` | 90/90 pass | ✓ PASS |
| pymupdf absent-graceful | forced `PENSMITH_PYTHON=/nonexistent` | returns null, no throw | ✓ PASS |
| intake producer no-paperId path | producer test run | WARN-skip registration, STYLE.json still written | ✓ PASS (H boundary) |
| Forbidden README substrings | `grep -niE "impersonate\|evade detection\|undetectable" README.md` | no matches | ✓ PASS |

### Probe Execution / Full Gate

| Gate Stage | Command | Result | Status |
|------------|---------|--------|--------|
| Full gate | `npm run check` | eslint → tsc --noEmit → tsc → tier-contract → 785 tests → manifests | exit 0 | ✓ PASS |
| tests | (within check) | 785 pass, 0 fail, 0 skip | ✓ PASS |
| manifests | `validate:manifests` | plugin.json + marketplace.json + .mcp.json valid | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| LIB-01 (global paper registry) | 08-01 | ✓ SATISFIED | `schemas/global-library.ts` + `global-library.ts` at pensmithDataDir()/library/index.json |
| LIB-02 (list) | 08-01/08-06 | ✓ SATISFIED | `list.ts` grouped listing; tier-contract parity |
| LIB-03 (open / folderPath) | 08-01/08-06 | ✓ SATISFIED | `open.ts` + LIB-03 folderPath round-trip test |
| LIB-04 (intake registration) | 08-05 | ✓ SATISFIED | `intake.ts` registerPaperNonFatal (non-fatal seed) |
| LIB-05 (7-state derived lifecycle) | 08-01 | ✓ SATISFIED | `deriveLibraryStatus` LIB-05(1)-(7c) tests |
| ERGO-05 (sketch no-advance) | 08-04/08-06 | ✓ SATISFIED | `sketch.ts` + sketch.test.ts |
| ERGO-06 (add mid-paper) | 08-04/08-06 | ✓ SATISFIED | `add.ts` + add-source.test.ts |
| RSCH-05 (BYO PDF pdf-parse + pymupdf) | 08-03/08-04 | ✓ SATISFIED | `pdf-text.ts` + `pymupdf-shellout.ts` + pin guard |
| STYL-01 (per-paper STYLE.json) | 08-02/08-05 | ✓ SATISFIED | `style-match.ts` + STYL-01 tests |
| STYL-02 (fingerprint + reuse surfaced) | 08-02/08-05 | ✓ SATISFIED | PITFALL-1 + STYL-02 + PRODUCER(2) tests |
| STYL-03 (drafter consumes + voice override) | 08-05 | ✓ SATISFIED | `write.ts` resolveVoiceHint + write-style-integration tests |
| STYL-04 (README dual-use disclosure) | 08-05 | ✓ SATISFIED | README + STYL-04 content contract test |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `bin/lib/pdf-text.ts` | 42, 156 | `TODO(Phase 4)` route WARN through structured logger | ℹ Info | Pre-existing file; both TODOs reference formal future work (Phase 4 logger). TODO is WARNING-level (not a BLOCKER debt marker). The image-only fallback added in 08-03 is fully functional with console.warn. No blocker debt markers (TBD/FIXME/XXX) in any Phase-8-modified source file. |

No blocker anti-patterns. No stubs in shipped verbs (STUBS list emptied with documented graduation precedent). No hollow/disconnected data flow — STYLE.json, registry, and remap all carry real computed values.

### Accepted MEDIUMs

- **Intake STATE.json/paperId bootstrap (H):** intake WARN-skips global-library registration when STATE.json has no paperId. Accepted as an out-of-Phase-8 boundary (Phase 4+ intake/anthropic work). All Phase-8 artifacts are present, wired, and tested; SC2 is fully deliverable today, SC1 is deliverable by contract via DERIVE-AT-DISPLAY once the upstream bootstrap lands. Tracked, not a gap.
- **cli-stubs TIER-04 reconciliation (deferred-items.md):** RESOLVED during execution — `STUBS` emptied with a graduation comment matching the compile/done/next/status/resume precedent. Verified: cli-stubs.test.ts:42 `const STUBS: string[] = []`, full suite green.

### Human Verification Required

None for automated acceptance. Two manual-only checks are documented in `08-VALIDATION.md` (live pymupdf on a machine WITH working fitz; live `add <url>`/`add <doi>` network hydration) — both are environment/network-dependent and out of scope for offline CI; the absent-pymupdf and cassette paths are fully covered automatically.

### Gaps Summary

No gaps. All four Success Criteria PASS with file:line + passing-test evidence. Structural non-negotiables A–G are independently confirmed in code AND by negative-control tests. The one assessed MEDIUM (H — intake STATE.json bootstrap) is an accepted, out-of-scope architectural boundary that does not block any Phase-8 deliverable: SC2 ships today, SC1 ships by contract via the DERIVE-AT-DISPLAY design once the upstream Phase-4 bootstrap lands. Full gate (`npm run check`) exits 0 (eslint, tsc, build, tier-contract, 785 tests, manifests). 16-verb bijection intact; no 17th verb.

---

_Verified: 2026-06-20_
_Verifier: Claude (gsd-verifier)_
