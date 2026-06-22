---
phase: 06-done-export-pipeline-zero-trace-gate
verified: 2026-06-18T00:00:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 6: Done / export pipeline + zero-trace gate — Verification Report

**Phase Goal:** Compiled drafts go through whole-paper Pass 4 audit → free distinctive-phrase plagiarism check → humanizer wrap (skip cleanly if absent) → GPTZero honesty score before AND after humanize (framed honestly) → export to `.docx`/`.pdf`/`.tex`/`.md` with bundled `.bib`. ZERO pensmith trace in any export, verified by test.
**Verified:** 2026-06-18
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (SC) | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Zero-trace export test scans EVERY format (.docx/.pdf/.tex/.md) for "pensmith" + metadata → exactly ZERO occurrences (incl .docx ZIP entries + PDF metadata) | ✓ VERIFIED | `tests/zero-trace-export.test.ts` Tests A–F — all 6 PASS (not skipped). Live run: `pass 6 / fail 0 / skipped 0`. Test B scans every .docx ZIP entry incl. `_rels/.rels`; Test D scans raw PDF bytes for both `pensmith` AND `Trace Sentinel`; Tests E/F scan real .md and offline-produced .tex artifacts. |
| 2 | Humanizer wrap detects `~/.claude/skills/humanizer/`; skips with a clear banner when absent; never fails export | ✓ VERIFIED | `exporter.ts:72-100 runHumanizer` — absent → banner `humanizer skill not found at ~/.claude/skills/humanizer/`, returns null, wrapped in try/catch (never throws). `tests/humanizer-wrap.test.ts:60` PASS on this machine (humanizer ABSENT confirmed). |
| 3 | GPTZero honesty before AND after humanize; framing "improves prose, not evades detection" rendered VERBATIM from locked copy file; CONTRIBUTING drift rule; backend pluggable to Originality/Sapling | ✓ VERIFIED | `done.ts:406,415` two `scoreHonesty` calls (before/after). `honesty.ts:88-113 loadFramingNote()` reads `references/honesty-framing.md` `## Note` blockquote VERBATIM. `tests/honesty.test.ts:94-108` asserts rendered report contains the locked note verbatim — PASS. Hash pin matches (computed `549bdecb…` == PINNED). `honesty.ts:270-281 selectBackend` returns originality/sapling stubs. |
| 4 | Free distinctive-phrase plagiarism check via DuckDuckGo HTML produces an n-gram report; never blocks export, only warns | ✓ VERIFIED | `plagiarism.ts:118 extractDistinctivePhrases` (≥5-word n-grams, deterministic), `:283 runPlagiarism`, `:304 renderPlagiarismSection`. Advisory: `queryPhrase` swallows transport errors to `[]` (`:266-271`). `tests/plagiarism.test.ts` 6 tests PASS incl. never-throws-on-transport-error. |
| 5 | Export-confirmation gate prompts before export; per-issue summary + explicit confirm on any UNSUPPORTED/orphan/plagiarism issue; generic confirm even when clean; skipped only with --yolo | ✓ VERIFIED | `done.ts:131-153 runDoneGate` — yolo→`{gateSkipped:true}` (approve never called); else `collectGateIssues`, `writeGateSummary` first if issues, then ALWAYS `approve()`. `tests/export-gate.test.ts` 7 tests PASS incl. NON-yolo on-disk integration asserting summary precedes approver. |

**Score:** 5/5 truths verified

### Structural Confirmation of Load-Bearing Non-Negotiables

**A. ZERO-TRACE (gating contract, SC1/DONE-07/TEST-10) — CONFIRMED**
- All four formats scanned offline: `tests/zero-trace-export.test.ts` imports `JSZip` + `pdf-lib` only (no Pandoc); machine confirmed `pandoc NOT found`, yet all 6 tests PASS.
- `.docx` negative-control fixture (`sample-zero-trace.docx`, hash-pinned) embeds `pensmith` in `cp:category` AND `_rels/.rels` — Test A asserts both (`:55-58`), so a too-narrow patch fails. Test B re-scans EVERY non-binary ZIP entry + explicit `_rels/.rels` assertion.
- `.pdf` negative-control (`sample-zero-trace.pdf`, hash-pinned) carries `pensmith` AND non-`pensmith` token `Trace Sentinel` in BOTH `/Info` and the XMP stream (Test C `:126-135`). Test D asserts BOTH are gone after `zeroTracePdf` AND `PDFDocument.load(scrubbed)` does not reject (`:171-174`) — proving STRUCTURAL XMP removal, not literal masking.
- `zeroTracePdf` (`exporter.ts:252-301`): captures `pdf.catalog.get(PDFName.of('Metadata'))`, then `pdf.context.delete(metaRef)` BEFORE `save()` (the HIGH-C2-1 fix — pdf-lib serializes unreachable objects, so dropping only the catalog ref leaks), then `catalog.delete`. `/Info` cleared (setProducer/Creator/Author/Title/Subject/Keywords = ''). NO length-altering latin1 byte edit — the literal-`pensmith` check (`:293-298`) is a READ-ONLY post-save assertion that throws to force a structural fix, never a byte mask.

**B. HONEST FRAMING (SC3, non-negotiable) — CONFIRMED**
- Framing rendered VERBATIM from `references/honesty-framing.md` via `loadFramingNote()` (`honesty.ts:88-113`) — never inlined (the inline fallback at `:94/:111` is a defensive transparency-only string, still no "undetectable/evade" wording).
- SHA-256 hash-pinned in `tests/repo-files.test.ts:173-179` — verified actual file hash `549bdecbfc0f167aa17fc542146fcdfa58117686a7a9ab2cb58e0db633fa3b0b` == PINNED.
- CONTRIBUTING.md drift rule present (`### Honesty framing copy is LOCKED`, lines 20-32): mandates re-pin on any wording change and enforces transparency-only ("improves prose … NEVER claims to make output undetectable").
- Locked copy is transparency: "The humanizer improves readability; it does not promise to make output undetectable." No detection-avoidance wording anywhere.

**C. GATE (SC5/DONE-09, sole escape valve for VRFY-07) — CONFIRMED**
- `runDoneGate` (`done.ts:131-153`) requires explicit `approve()` on any issue with `writeGateSummary` per-issue summary FIRST (`:146-148`); runs generic `approve()` even when clean (`:151`); `--yolo` is the ONLY skip (`:138-140`, approve never called).
- `readSectionUnsupported` (`done.ts:314-335`) + `parseSectionPass2` (`:226-302`) FAIL SAFE: present-but-unparseable Pass-2 table (bad header / malformed separator / wrong cell count / unknown verdict) returns a synthetic `<unparseable>` UNSUPPORTED sentinel → `hasIssues` true → gate requires confirmation. Absent heading = clean. Never a silent clean for a present-but-unparseable table.
- NON-yolo integration test exists: `tests/export-gate.test.ts:217-273` drives the gate from ON-DISK Pass-2 fixture data, captures stdout, asserts the per-issue summary (mentioning `smith2020`) prints BEFORE `approve()` and the gate does NOT auto-proceed — PASS. Fail-safe test `:172-215` PASS.

**D. HUMANIZER (SC2/DONE-03) — CONFIRMED**
- `runHumanizer` (`exporter.ts:72-100`): absent skill → stdout banner + return null + export proceeds on DRAFT.md; entire body wrapped in try/catch degrading to a clean null skip (never throws). Machine baseline `isHumanizerSkillPresent() === false` confirmed; `tests/humanizer-wrap.test.ts:44,60` PASS.

**E. NO 17th VERB / CHOKEPOINT / OFFLINE — CONFIRMED**
- `done` is the existing locked verb: `bin/lib/verbs.ts` lists exactly 16 UX-02 verbs incl. `done` (`:26`); 16 `workflows/*.md` files (bijection intact); `bin/pensmith.ts:55` promotes `done` to a real loader. No new MCP done tool (workflow body delegates to the same bin/cli/done.ts → bin/lib path).
- All network via `http.ts` chokepoint: `plagiarism.ts:22` and `honesty.ts:22` both `import { fetch as httpFetch } from './http.js'`; offline branches read cassettes via `http-mock.ts` and never touch the network.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `bin/lib/exporter.ts` | zeroTracePatch/zeroTracePdf/exportDraft/runHumanizer | ✓ VERIFIED | 529 lines (≥150). All four symbols exported + wired into done.ts. |
| `bin/lib/honesty.ts` | scoreHonesty/renderHonestyReport/HonestyBackend + GPTZero + pluggable | ✓ VERIFIED | 334 lines (≥90). Verbatim framing render, http chokepoint, key never logged. |
| `bin/lib/plagiarism.ts` | extractDistinctivePhrases/runPlagiarism/renderPlagiarismSection | ✓ VERIFIED | 329 lines (≥80). Advisory, http chokepoint, SSRF-safe regex parse. |
| `bin/cli/done.ts` | thin orchestrator + runDoneGate + whole-paper Pass 4 + fail-safe reader | ✓ VERIFIED | 476 lines (≥90). Delegates to runPass4/runPlagiarism/scoreHonesty/exportDraft. |
| `references/honesty-framing.md` | LOCKED honest-framing copy | ✓ VERIFIED | Hash matches pin; transparency-only. |
| `workflows/done.md` | filled body w/ capability_check + delegation | ✓ VERIFIED | capability_check present; delegates to bin/cli/done.ts; same path both tiers. |
| `tests/fixtures/sample-zero-trace.docx` | negative-control (pensmith in cp:category + _rels/.rels) | ✓ VERIFIED | Exists, hash-pinned, Test A asserts trap fields. |
| `tests/fixtures/sample-zero-trace.pdf` | negative-control (pensmith + Trace Sentinel in /Info + XMP) | ✓ VERIFIED | Exists, hash-pinned, Test C asserts both tokens. |
| `tests/fixtures/section-pass2-unsupported/VERIFICATION.md` | renderPass2Section-shaped UNSUPPORTED row | ✓ VERIFIED | Exists; drives HIGH-3 disk→gate feed test. |

### Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| done.ts | pass4/plagiarism/honesty/exporter | thin-orchestrator delegation | ✓ WIRED (`done.ts:27-31` imports; called at `:402,403,406,412,458`) |
| done.ts readSectionUnsupported | section VERIFICATION.md ## Pass-2 | pinned 4-col **UNSUPPORTED** parse, fail-safe | ✓ WIRED (`done.ts:314`, fed to gate at `:431`) |
| bin/pensmith.ts REAL_VERB_LOADERS | done.ts doneCommand | `done: () => import('./cli/done.js')` | ✓ WIRED (`pensmith.ts:55`) |
| honesty.ts | references/honesty-framing.md | findPkgRoot + readFileSync + blockquote parse | ✓ WIRED (`honesty.ts:73,92`) |
| honesty.ts / plagiarism.ts | bin/lib/http.ts | `import { fetch as httpFetch } from './http.js'` | ✓ WIRED (both `:22`) |
| exporter.ts exportDraft | ecosystem-presence isPandocPresent | call-time presence gate → md fallback | ✓ WIRED (`exporter.ts:455`) |

### Behavioral Spot-Checks (live test runs)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Zero-trace all 4 formats | `node --import tsx --test tests/zero-trace-export.test.ts` | tests 6 / pass 6 / fail 0 / skipped 0 | ✓ PASS |
| Gate + humanizer + honesty + plagiarism + exporter | `node --import tsx --test tests/{export-gate,humanizer-wrap,honesty,plagiarism,exporter}.test.ts` | tests 25 / pass 25 / fail 0 / skipped 0 | ✓ PASS |
| tier-contract + repo-files (hash pins) | `node --import tsx --test tests/tier-contract.test.ts tests/repo-files.test.ts` | tests 73 / pass 73 / fail 0 | ✓ PASS |
| honesty-framing hash == pin | `sha256(references/honesty-framing.md)` | `549bdecb…3b0b` == PINNED | ✓ PASS |
| Environment preconditions | `which pandoc` / humanizer dir | pandoc ABSENT, humanizer ABSENT | ✓ confirms offline/skip paths under test |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|------------|--------|----------|
| DONE-01 whole-paper Pass 4 | 06-05 | ✓ SATISFIED | `runWholePaperPass4` (done.ts:165), fed to gate |
| DONE-02 free plagiarism | 06-02 | ✓ SATISFIED | plagiarism.ts; 6 tests PASS |
| DONE-03 humanizer skip-clean | 06-05/06-04 | ✓ SATISFIED | runHumanizer; absent-skip test PASS |
| DONE-04 honesty before/after | 06-03 | ✓ SATISFIED | two scoreHonesty calls; honesty tests PASS |
| DONE-05 pluggable backend | 06-03 | ✓ SATISFIED | selectBackend stubs; test PASS |
| DONE-06 export 4 formats + fallback | 06-04 | ✓ SATISFIED | exportDraft; Pandoc-absent fallback test PASS |
| DONE-07 zero trace + test | 06-04/06-01 | ✓ SATISFIED | zeroTracePatch/zeroTracePdf; Tests A–F PASS |
| DONE-08 bundle CITATIONS.bib | 06-04 | ✓ SATISFIED | exportDraft bib copy; test PASS |
| DONE-09 confirmation gate | 06-05 | ✓ SATISFIED | runDoneGate; 7 gate tests PASS |
| TEST-10 zero-trace test | 06-01 | ✓ SATISFIED | zero-trace-export.test.ts 6/6 |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| (none) | TBD/FIXME/XXX in Phase 6 modules | — | No debt markers in exporter/honesty/plagiarism/done.ts |

The defensive inline fallback strings in `honesty.ts` (`:94`, `:111`) are NOT stubs — they are transparency-only fallbacks for an unreadable references file (which ships in package.json `files[]`), and they carry no detection-avoidance wording. The empty-array/null returns in plagiarism/honesty are the documented advisory-never-throws contract, not unwired stubs (each is on a real skip/error path).

### Accepted MEDIUMs (note)

- **Live Pandoc-produced output is a documented manual check.** Pandoc + a PDF engine are absent on the build machine, so CI gates the scrub LOGIC offline against committed real fixtures (`sample-zero-trace.docx/.pdf`) and the deterministic offline md→tex writer. The zero-trace guarantee is delivered by the in-process scrubs (`zeroTracePatch`/`zeroTracePdf`), which run regardless of whether Pandoc produced the input — so the gating contract holds without Pandoc. This is the only accepted residual and is appropriately scoped (the scrub is the guarantee; Pandoc is merely an upstream renderer). Acceptable.
- **Humanizer present-but-no-transport path** intentionally skips with a distinct banner (Tier-2 era has no Task transport per 06-RESEARCH A7); a real FINAL.md is returned only in Tier 1. This matches the design and never fails export. Acceptable.

### Human Verification Required

None. All success criteria are verifiable programmatically and were confirmed by live test runs. (The live-Pandoc manual check above is an accepted MEDIUM, not a blocking human-verification gate — the offline scrub logic that provides the guarantee is fully CI-gated.)

### Gaps Summary

No gaps. All 5 ROADMAP success criteria are VERIFIED with file:line + passing-test evidence. All load-bearing non-negotiables (A zero-trace incl. structural PDF XMP strip + offline/Pandoc-independence, B verbatim locked framing + hash-pin + drift rule, C gate per-issue + fail-safe + yolo-only + non-yolo integration test, D humanizer absent-skip, E no 17th verb + http chokepoint) are structurally confirmed. No TBD/FIXME/XXX debt markers in any Phase 6 module. All 10 phase requirements (DONE-01..09, TEST-10) satisfied. Phase goal achieved.

---

_Verified: 2026-06-18_
_Verifier: Claude (gsd-verifier)_
