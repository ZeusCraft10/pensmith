---
phase: 10
slug: discipline-citation-style-breadth-zotero-mcp
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-20
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in) via `node --import tsx --test` |
| **Config file** | scripts/run-tests.mjs (discovers tests/**/*.test.ts) |
| **Quick run command** | `node --import tsx --test tests/<file>.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds (822 tests at Phase 9 close) |

---

## Sampling Rate

- **After every task commit:** Run the task's targeted `node --import tsx --test tests/<file>.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** `npm run check` must be green (lint + typecheck + build + tier-contract + tests + manifests)
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

> Filled/refined by the planner. Citation rendering is DETERMINISTIC + OFFLINE (CSL files bundled, not fetched at runtime); Zotero MCP is detection-gated/absent-graceful.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-WAVE0 | 00 | 0 | CITE-02/03/05, RSCH-06 | — | RED suites + committed CSL files + RIS fixture + Zotero cassette | unit | `npm test` | ❌ W0 | ⬜ pending |
| 10-CSL | — | — | CITE-02 | CSL non-determinism | APA7/MLA/Chicago(note-bib + author-date)/IEEE/AMA/Vancouver/Harvard render via citation-js + bundled templates/citation-styles/*.csl; deterministic offline (same input → byte-identical) | unit | `node --import tsx --test tests/citation-styles.test.ts` | ❌ W0 | ⬜ pending |
| 10-RIS | — | — | CITE-03 | RIS field mapping | RIS export alongside BibTeX; .bib + .ris both bundled into the export package; ris-write imports {Cite} from ./citations.js (D-19 chokepoint) | unit | `node --import tsx --test tests/ris-write.test.ts` | ❌ W0 | ⬜ pending |
| 10-ZOTERO | — | — | RSCH-06 | absence breaks research | zotero-mcp source provider in the adapter registry (AdapterName += 'zotero-mcp'); returns [] when absent; doctor reports auth state (ZOTERO_API_KEY); absence does NOT break research (capability_check fallback) | unit (cassette) | `node --import tsx --test tests/zotero-mcp-source.test.ts` | ❌ W0 | ⬜ pending |
| 10-DISCIPLINE | — | — | RSCH-06, CITE-02 | preset mis-map | disciplines.json schema completion (sourcePreference, sectioningConvention, counterargDefault, densityTarget); CS preset corrected APA→IEEE; discipline→style selection | unit | `node --import tsx --test tests/disciplines.test.ts` | ❌ W0 | ⬜ pending |
| 10-TIER | — | — | CITE-02/03, RSCH-06 | tier drift | tier-contract parity for the new style/RIS/zotero surfaces; 16-verb bijection intact (no new verb) | contract | `npm run test:tier-contract` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/citation-styles.test.ts`, `tests/ris-write.test.ts`, `tests/zotero-mcp-source.test.ts`, `tests/disciplines.test.ts` — RED stubs
- [ ] **Procure + commit the 7 CSL files** to `templates/citation-styles/` from the official CSL styles repo (BUILD-TIME network; repo confirmed reachable HTTP 200). Note the filename gotchas: `chicago-fullnote-bibliography.csl` (notes-bib; the `note-bibliography` name does not exist), `chicago-author-date.csl` (CMOS 18th), `harvard-cite-them-right.csl`, `american-medical-association.csl`, `vancouver.csl`, plus APA7 + MLA. CC-BY-SA attribution is embedded in each .csl. Add `templates/citation-styles/` to the package `files` array.
- [ ] RIS golden fixture(s) + a known-citation corpus for the 7-style render goldens
- [ ] Offline cassette for the zotero-mcp source provider; an absent-Zotero fixture
- [ ] disciplines.json completed-schema fixture

*No new npm deps (citation-js@0.7.22 bundles @citation-js/plugin-csl + @citation-js/plugin-ris; cite.format('ris') verified). Runtime is OFFLINE — CSL files are bundled, never fetched at render time.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Zotero MCP authenticated source fetch | RSCH-06 | Needs a real running Zotero MCP server + ZOTERO_API_KEY; CI exercises only the absent-fallback + cassette path | On a machine with Zotero MCP running + ZOTERO_API_KEY: run research, confirm Zotero sources are returned + doctor reports authenticated |

*All deterministic contracts (7-style CSL render goldens, RIS export, zotero absent-graceful + cassette, discipline preset mapping, 16-verb bijection) have automated offline verification.*

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (test files + committed CSL files + RIS/zotero fixtures)
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter (after planner fills the per-task map)

**Approval:** pending
