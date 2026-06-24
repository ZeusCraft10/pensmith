---
phase: 13
slug: citation-rendering-at-export
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-22
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (`node --import tsx --test`) |
| **Config file** | none — `scripts/run-tests.mjs` discovers `tests/**/*.test.ts` |
| **Quick run command** | `node --import tsx --test tests/exporter.test.ts` |
| **Full suite command** | `npm test` (or `npm run check`) |
| **Estimated runtime** | quick ~4s; full suite ~60–120s |

---

## Sampling Rate

- **After every task commit:** quick command for the file(s) touched.
- **After every plan wave:** `npm test`.
- **Before `/gsd:verify-work`:** `npm run check` green. The REND-03 formatted-reference assertion runs OFFLINE via citation-js (no Pandoc needed in CI); the Pandoc-rendered `.docx`/`.pdf` cite assertion is Pandoc-gated.
- **Max feedback latency:** ~120s.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 13-01-xx | 01 | 0 | REND-01/02/03 | T-13-* | RED-by-skip exporter-citation scaffold (offline citation-js path) | unit | `node --import tsx --test tests/exporter.test.ts` | ❌ W0 | ⬜ pending |
| 13-0x-xx | 0x | 1 | REND-01 | — | offline path resolves every `[@key]` → formatted in-text cite (no raw `[@key]` in output); multi-cite `[@a; @b]` handled | unit | exporter test | ❌ W0 | ⬜ pending |
| 13-0x-xx | 0x | 1 | REND-02 | — | output includes a formatted bibliography in the resolved CSL style | unit | exporter test | ❌ W0 | ⬜ pending |
| 13-0x-xx | 0x | 1 | REND-03 | — | OFFLINE assertion: a formatted reference (e.g. "Vaswani et al.") appears in rendered output on the known-good fixture; NOT Pandoc-gated | unit | exporter test | ❌ W0 | ⬜ pending |
| 13-0x-xx | 0x | 1 | REND-01/02 | T-13-zt | zero-trace test STILL passes on citation-rendered output (no pensmith trace/metadata) | unit | `node --import tsx --test tests/zero-trace.test.ts` (or exporter) | ✅ | ⬜ pending |
| 13-0x-xx | 0x | 1 | REND-01/02 | — | buildPandocArgs includes `--citeproc --csl <path> --bibliography <bib>`; bib copied BEFORE pandoc shellout | unit (Pandoc-gated for live render) | exporter test | ❌ W0 | ⬜ pending |
| 13-0x-xx | 0x | 1 | REND-01/02/03 | — | tier-contract green; full suite green | contract | `npm run test:tier-contract` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Extend `tests/exporter.test.ts` with RED-by-skip citation-render assertions (offline citation-js path) guarded on the new `resolveAndRenderCitations` helper / `style` option existing. Reuse `tests/fixtures/known-good-fixture/` (CITATIONS.bib vaswani2017attention + `[@vaswani2017attention]` draft).

*Existing infra (node:test + the known-good fixture + the zero-trace test) covers everything — no framework install.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A real Pandoc `--citeproc` render of `.docx`/`.pdf` shows formatted in-text cites + a correctly-numbered reference list | REND-01/02 | Requires Pandoc on PATH; CI may not have it; numeric-style sequential numbering ([1],[2],…) is Pandoc-only | Install Pandoc, `pensmith done` on a compiled paper, open the .docx/.pdf, confirm cites + bibliography |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
