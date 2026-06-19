---
phase: 8
slug: style-match-sketch-add-library-byo-pdf-polish
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-19
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in) via `node --import tsx --test` |
| **Config file** | scripts/run-tests.mjs (discovers tests/**/*.test.ts) |
| **Quick run command** | `node --import tsx --test tests/<file>.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~14 seconds (750 tests at Phase 7 close) |

---

## Sampling Rate

- **After every task commit:** Run the task's targeted `node --import tsx --test tests/<file>.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** `npm run check` must be green (lint + typecheck + build + tier-contract + tests + manifests)
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

> Filled/refined by the planner per actual task breakdown. Style-match is PURE-STATS (deterministic, offline, no LLM at profile-build) so it is fully unit-testable; pymupdf shellout is absent-graceful; add/Crossref via cassettes.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-WAVE0 | 00 | 0 | LIB/STYL/ERGO/RSCH | — | RED suite + cassettes + sample fixtures | unit | `npm test` | ❌ W0 | ⬜ pending |
| 08-LIBRARY | — | — | LIB-01..05, ERGO unrelated | registry corruption | global-library.ts (registry separate from per-paper LIBRARY.json); list groups by class; open switches active paper; status cycle intake..archived | unit | `node --import tsx --test tests/global-library.test.ts` | ❌ W0 | ⬜ pending |
| 08-STYLE | — | — | STYL-01..04 | global-cache leak / undisclosed reuse | per-paper STYLE.json ONLY (no global cache); pure-stats fingerprint; cross-paper reuse DETECTED + surfaced; drafter consumes profile + voiceHint override; README dual-use disclosure | unit | `node --import tsx --test tests/style-match.test.ts` | ❌ W0 | ⬜ pending |
| 08-SKETCH | — | — | ERGO-05 | premature state advance | sketch thinking-partner mode does NOT advance state into intake until user confirms | unit | `node --import tsx --test tests/sketch.test.ts` | ❌ W0 | ⬜ pending |
| 08-ADD | — | — | ERGO-06, RSCH-05 | section-state corruption / SSRF | add <doi\|pdf\|url> ingests mid-paper, prompts remap; touches only assigned_sources[] (NOT status/verified_against_draft_hash); Crossref hydration via http.ts; pdf-parse pinned + pymupdf fallback absent-graceful | unit (cassette) | `node --import tsx --test tests/add-source.test.ts` | ❌ W0 | ⬜ pending |
| 08-TIER | — | — | LIB/ERGO | tier drift / 17th verb | list/open/sketch/add promoted (no 17th verb, 16-bijection intact); tier-contract parity | contract | `npm run test:tier-contract` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/global-library.test.ts`, `tests/style-match.test.ts`, `tests/sketch.test.ts`, `tests/add-source.test.ts` — RED stubs
- [ ] Style-match sample fixtures (.md/.txt writing samples) for deterministic pure-stats profiling + a cross-paper-reuse fixture pair
- [ ] Offline cassettes for `add <doi>` Crossref hydration + `add <url>` fetch
- [ ] A committed sample PDF fixture for pdf-parse ingestion (+ an absent-pymupdf path assertion)
- [ ] README dual-use disclosure copy (STYL) — verify it ships; if locked-copy, hash-pin per the honesty-framing precedent

*pdf-parse@1.1.1 already installed (pin exact); pymupdf is a Python shellout (graceful-absent — fitz import fails on this machine, validating the fallback). No new npm deps per research.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live pymupdf shellout on a machine WITH fitz installed | RSCH-05 | pymupdf/fitz is broken-import on the build machine; CI exercises only the absent-fallback path | On a machine with working `python -c "import fitz"`: run `pensmith add <scanned.pdf>` and confirm pymupdf extracts text the pure-JS pdf-parse path could not |
| Live `add <url>` / `add <doi>` network hydration | ERGO-06 | Live network forbidden in tests | Manual run with network; confirm Crossref metadata hydration + graceful 4xx/5xx |

*All deterministic contracts (pure-stats style profile, per-paper-only constraint, cross-paper reuse detection, sketch no-advance, add assigned_sources-only mutation, list/open/status, pdf-parse on a fixture, 16-verb bijection) have automated offline verification.*

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (test files, sample/PDF fixtures, cassettes, README copy)
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter (after planner fills the per-task map)

**Approval:** pending
