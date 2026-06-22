---
phase: 3
slug: vertical-slice-one-section
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-17
approved: 2026-05-21
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Authoritative reference: `03-RESEARCH.md` § Validation Architecture (lines 905–1028).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node --test` (Node ≥20.10 built-in) via `tsx --import` |
| **Config file** | none — discovered by `scripts/run-tests.mjs` walker (Phase 0) |
| **Quick run command** | `npm test -- --test-name-pattern="<area>"` (single suite) |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~25–40 seconds full suite (cassettes are offline) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --test-name-pattern="<task-area>"` (e.g. `pass1 fuzzy`, `migration`, `tier-contract intake`)
- **After every plan wave:** Run `npm test && npm run lint && npm run typecheck`
- **Before `/gsd-verify-work`:** Full suite green + tier-contract all 10 cases pass + cassette-size <50KB/adapter + handoff-size <5KB + all hash-pin tests green
- **Max feedback latency:** ~40 seconds (full suite, offline cassettes)

---

## Per-Task Verification Map

Each row is an executable assertion. `❌ W0` = test file must be created in Wave 0 of Phase 3 (no separate "test phase" — Wave 0 IS the test bootstrap).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-W0-01 | 00 | 0 | TEST-04, ARCH-02 | T-3-12 | Path traversal prevented (slug regex `^[a-z0-9-]+$` zod-enforced) | unit | `npm test -- --test-name-pattern="paths section"` | ❌ W0 | ⬜ |
| 3-W0-02 | 00 | 0 | ARCH-04 | — | HANDOFF.json size bounded | size | `npm test -- --test-name-pattern="handoff-size"` | ❌ W0 | ⬜ |
| 3-W0-03 | 00 | 0 | TEST-02, D-25 | — | Cassette directory size bounded | size | `npm test -- --test-name-pattern="cassette-size"` | ❌ W0 | ⬜ |
| 3-W0-04 | 00 | 0 | CITE-04, D-22 | T-3-04 | citation-js parser smoke (BibTeX accent-command safe) | smoke | `npm test -- --test-name-pattern="citation-render"` | ❌ W0 | ⬜ |
| 3-W0-05 | 00 | 0 | D-09, ARCH-07 | T-3-08 | v1→v2 round-trip + idempotent on v2 + refuse-forward on v3 | unit | `npm test -- --test-name-pattern="migration"` | ❌ W0 | ⬜ |
| 3-W0-06 | 00 | 0 | D-09 | T-3-08 | Migration property: preserves all top-level fields except enumerated drops | property | `npm test -- --test-name-pattern="migration.property"` | ❌ W0 | ⬜ |
| 3-W0-07 | 00 | 0 | VRFY-02, D-11 | — | Jaro-Winkler thresholds at 0.92 title / 0.85 author | unit + property | `npm test -- --test-name-pattern="fuzzy"` | ❌ W0 | ⬜ |
| 3-W0-08 | 00 | 0 | VRFY-04 | — | Unicode normalize (NFKC + ligature/soft-hyphen/smart-quote/em-dash/diacritic) | unit | `npm test -- --test-name-pattern="normalize"` | ❌ W0 | ⬜ |
| 3-W0-09 | 00 | 0 | INTK-05 | T-3-02 | PII redaction no-leak property | property | `npm test -- --test-name-pattern="pii"` | ✅ extend | ⬜ |
| 3-W0-10 | 00 | 0 | D-16, T-01-07 | T-3-02 | PENSMITH_S2_API_KEY no-leak (env value never persisted) | property | `npm test -- --test-name-pattern="no-leak"` | ✅ extend | ⬜ |
| 3-W0-11 | 00 | 0 | WRTE-01 | T-3-10 | Drafter input contract — superset throws | unit + property | `npm test -- --test-name-pattern="drafter-input"` | ❌ W0 | ⬜ |
| 3-W0-12 | 00 | 0 | RSCH-03/04 | T-3-13 | Per-adapter parse against committed cassette (×7 adapters) | unit | `npm test -- --test-name-pattern="sources/"` | ❌ W0 | ⬜ |
| 3-W0-13 | 00 | 0 | TEST-01 | — | Tier-contract extended with 6 new cases | tier-contract | `npm test -- --test-name-pattern="tier-contract"` | ✅ extend | ⬜ |
| 3-W0-14 | 00 | 0 | CITE-01, TEST-03, D-12, D-19 | T-3-09 | 11 new hash-pins (8 prompts + apa.csl + assignment.txt + 2 known-bad-*.json) | hash-pin | `npm test -- --test-name-pattern="repo files"` | ✅ extend | ⬜ |
| 3-W0-15 | 00 | 0 | WRTE-04, D-06 | T-3-11 | Lint chokepoint red-team for `pdf-parse` direct import | lint + AST | `npm run lint` | ✅ extend | ⬜ |
| 3-W0-16 | 00 | 0 | D-17/D-18 | — | PreCompact hook writes valid HANDOFF.json against zod schema | integration | `npm test -- --test-name-pattern="handoff"` | ❌ W0 | ⬜ |
| 3-W0-17 | 00 | 0 | SC-2 (10/10 FABRICATED) | — | known-bad-citations.json — Pass 1 flags 10/10 as MIS-CITED | deterministic corpus | `npm test -- --test-name-pattern="known-bad-citations"` | ❌ W0 | ⬜ |
| 3-W0-18 | 00 | 0 | SC-3 (10/10 NOT_FOUND) | — | known-bad-quotes.json — Pass 3 flags 10/10 NOT_FOUND | deterministic corpus | `npm test -- --test-name-pattern="known-bad-quotes"` | ❌ W0 | ⬜ |
| 3-W0-19 | 00 | 0 | TEST-09, SC-4 | T-3-08 | Section-isolation mtime invariant — re-doing section N leaves others untouched | integration | `npm test -- --test-name-pattern="section-isolation"` | ❌ W0 | ⬜ |

> The remaining per-feature Task IDs (3-<plan>-<n>) are assigned by the planner. Each MUST have either an `<automated>` verify command listed above (or an extension of an existing test file) OR a Wave 0 dependency from this table.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Test files to create in Wave 0 of Phase 3 (mirrors `03-RESEARCH.md` § Validation Architecture › Wave 0 Gaps):

- [ ] `tests/section-isolation.test.ts` — TEST-09 mtime invariant
- [ ] `tests/handoff-size.test.ts` — assert HANDOFF.json < 5120 bytes (D-17 / ARCH-04)
- [ ] `tests/cassette-size.test.ts` — assert each `tests/fixtures/cassettes/<adapter>/<file>` ≤50KB (D-25)
- [ ] `tests/citation-render.test.ts` — citation-js + apa.csl + fixture CITATIONS.bib smoke (D-22)
- [ ] `tests/migration.test.ts` — v1→v2 round-trip + idempotent + refuse-forward (D-09)
- [ ] `tests/migration.property.test.ts` — fast-check: migrate preserves all non-dropped fields (D-09)
- [ ] `tests/fuzzy.test.ts` — Jaro-Winkler golden cases + Levenshtein-substring (D-11)
- [ ] `tests/fuzzy.property.test.ts` — fast-check: JW(a,a)=1, symmetric, ∈[0,1]; Lev triangle ineq.
- [ ] `tests/normalize.test.ts` — NFKC + ligature/soft-hyphen/smart-quote/em-dash/diacritic
- [ ] `tests/drafter-input.test.ts` — assertDrafterInput throws on superset (WRTE-01 input contract)
- [ ] `tests/sources/{crossref,openalex,arxiv,pubmed,semanticscholar,unpaywall,retraction-watch}.test.ts` — 7 adapter unit tests against committed cassettes
- [ ] `tests/known-bad-citations.test.ts` — feed fixture, assert 10/10 MIS-CITED (SC-2)
- [ ] `tests/known-bad-quotes.test.ts` — feed fixture, assert 10/10 NOT_FOUND (SC-3)
- [ ] `tests/handoff.test.ts` — PreCompact hook writes valid HANDOFF.json against zod schema

Extensions of existing test files:

- [ ] `tests/tier-contract.test.ts` — extend with 6 new cases (intake/research/outline/plan-section/write-section/verify-section)
- [ ] `tests/repo-files.test.ts` — extend with 11 new hash-pins (8 prompts + apa.csl + assignment.txt + 2 known-bad-*.json). REMOVE anti-drift assertion at existing line 182 (`wiring-smoke|DOCT-05 must NOT appear`) — DOCT-05 lights up in Phase 3.
- [ ] `tests/pii.test.ts` — extend with redaction no-leak property
- [ ] `tests/runtime.test.ts` (no-leak property) — extend with `PENSMITH_S2_API_KEY` case (D-16)
- [ ] `tests/lint-chokepoint-fixture.ts` — add `import pdfParse from 'pdf-parse'` red-team line (forbidden outside `bin/lib/pdf-text.ts`)

Framework install: not needed — Node built-in `node --test` already used in Phase 0–2.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cassette weekly cron re-records against live APIs and auto-opens PR | TEST-02, D-24 | Live external APIs unavailable in PR CI by policy (`PENSMITH_NETWORK_TESTS=0` default); cron is the only place real-network exercise happens | (a) Trigger `cassette-refresh.yml` via `workflow_dispatch`; (b) Confirm PR opens with diff; (c) Human-review diff for unexpected response-shape drift |
| OneDrive/iCloud/Dropbox sync-folder warning surfaces on real user paths | DOCT-03 carry-forward | Real cloud-sync folder structures vary per-user; CI tmpfs cannot reproduce | Run `pensmith doctor` from a real OneDrive-synced `~/Documents/pensmith/` — assert WARN banner |
| Tier 1 MCP plugin interactive prompts render in Claude Code UI | INTK-02, RSCH-08, OUTL-03 | Claude Code UI rendering is the human-facing surface; programmatic tier-contract test asserts equivalence at MCP-protocol level but not visual rendering | Invoke `/pensmith new` in Claude Code; verify clarifying battery renders; equivalent to Tier 2 `pensmith new` clack output |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify command OR a Wave 0 dependency listed above
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all 14 new test files + 5 extensions enumerated above
- [ ] No watch-mode flags (`--watch`, `vitest watch`, `jest --watch`) — Node `--test` is one-shot by design
- [ ] Feedback latency < 40s (full suite, offline cassettes)
- [ ] `nyquist_compliant: true` set in frontmatter after planner adopts validation map

**Approval:** APPROVED 2026-05-21 — planner adopted validation map across 10 plans (03-00..03-09) through 3 checker iterations + 1 targeted residual fix pass. Wave 0 (Plan 03-00) covers all 14 new test files + 5 extensions enumerated above. `nyquist_compliant: true`.
