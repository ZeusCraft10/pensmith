---
phase: 6
slug: done-export-pipeline-zero-trace-gate
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-17
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in) via `node --import tsx --test` |
| **Config file** | scripts/run-tests.mjs (discovers tests/**/*.test.ts) |
| **Quick run command** | `node --import tsx --test tests/<file>.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~13 seconds (649 tests at Phase 5 close) |

---

## Sampling Rate

- **After every task commit:** Run the task's targeted `node --import tsx --test tests/<file>.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** `npm run check` must be green (lint + typecheck + build + tier-contract + tests + manifests)
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

> Filled/refined by the planner per actual task breakdown. The highest-risk item is the zero-trace test (TEST-10/DONE-07) — it MUST be deterministic and runnable OFFLINE and WITHOUT Pandoc (Pandoc + PDF engine are absent on the build machine). Strategy: test `zeroTracePatch()` against a committed fixture `.docx` (a real ZIP) + the pure-Node md/tex paths; gate Pandoc-dependent live export behind `isPandocPresent()` presence checks.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-WAVE0 | 00 | 0 | TEST-10, DONE-07 | leak vectors | RED zero-trace test + fixture .docx + cassettes; honesty-framing.md hash sentinel | unit | `npm test` | ❌ W0 | ⬜ pending |
| 06-ZEROTRACE | — | — | DONE-07, TEST-10 | metadata leak | zeroTracePatch strips docProps/core.xml+app.xml; scan every format for "pensmith" + metadata fields → 0 occurrences (incl .docx ZIP entries, PDF metadata) | unit (fixture, offline) | `node --import tsx --test tests/zero-trace-export.test.ts` | ❌ W0 | ⬜ pending |
| 06-PLAGIARISM | — | — | DONE-02 | SSRF/scrape | DuckDuckGo HTML n-gram via http.ts chokepoint; cassette-backed; warns never blocks | unit (cassette) | `node --import tsx --test tests/plagiarism.test.ts` | ❌ W0 | ⬜ pending |
| 06-HONESTY | — | — | DONE-04, DONE-05 | prompt/score misframe | GPTZero before+after; framing rendered VERBATIM from locked references/honesty-framing.md; pluggable backend via config; PENSMITH_NO_LLM / absent-key skip | unit (cassette) | `node --import tsx --test tests/honesty.test.ts` | ❌ W0 | ⬜ pending |
| 06-HUMANIZER | — | — | DONE-03 | absent-skill crash | detect ~/.claude/skills/humanizer/; banner + clean skip when absent; never fails export | unit | `node --import tsx --test tests/humanizer-wrap.test.ts` | ❌ W0 | ⬜ pending |
| 06-EXPORT | — | — | DONE-06, DONE-08 | engine absent | Pandoc when present, markdown-only fallback when absent; bundle CITATIONS.bib | unit | `node --import tsx --test tests/exporter.test.ts` | ❌ W0 | ⬜ pending |
| 06-GATE | — | — | DONE-01, DONE-09 | gate bypass | whole-paper Pass 4 audit; export-confirmation gate fires (per-issue summary when UNSUPPORTED/orphan/plagiarism present; generic confirm otherwise); only --yolo skips | unit | `node --import tsx --test tests/export-gate.test.ts` | ❌ W0 | ⬜ pending |
| 06-TIER | — | — | DONE-06, DONE-09 | tier drift | tier-contract: done/export parity across both tiers (offline path) | contract | `npm run test:tier-contract` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/zero-trace-export.test.ts` — RED stub for TEST-10/DONE-07 (the gating test)
- [ ] A committed fixture `.docx` (real ZIP with docProps/core.xml + app.xml) so zeroTracePatch can be tested offline without Pandoc
- [ ] `tests/plagiarism.test.ts`, `tests/honesty.test.ts`, `tests/humanizer-wrap.test.ts`, `tests/exporter.test.ts`, `tests/export-gate.test.ts` — RED stubs
- [ ] Offline cassettes for DuckDuckGo HTML + GPTZero (≤51200 B each per D-25)
- [ ] `references/honesty-framing.md` locked-copy file + SHA-256 hash sentinel/pin in repo-files.test.ts (WN-3 pattern) + CONTRIBUTING.md drift rule
- [ ] jszip dependency added (slopcheck OK, no postinstall) for docx ZIP patching

*Existing node:test infra covers the framework; Wave 0 adds the new test files, fixture .docx, cassettes, locked copy, and the dep.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Pandoc .docx/.pdf/.tex export + zero-trace on real Pandoc output | DONE-06, DONE-07 | Pandoc + PDF engine absent on the build machine; CI cannot exercise the live Pandoc path here | On a machine with Pandoc+xelatex: run `pensmith done`, export all formats, grep each (incl. .docx ZIP entries + PDF metadata) for "pensmith" → expect 0 |
| Live GPTZero / DuckDuckGo network behavior | DONE-02, DONE-04 | Live network forbidden in tests; rate-limit behavior empirical | Manual run with real API key / network; confirm graceful 429 skip |

*All deterministic contracts (zeroTracePatch on fixture, gate logic, fallback, framing-verbatim, absent-skip) have automated offline verification.*

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (test files, fixture .docx, cassettes, locked copy, dep)
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter (after planner fills the per-task map)

**Approval:** pending
