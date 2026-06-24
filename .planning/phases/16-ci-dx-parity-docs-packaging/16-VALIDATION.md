---
phase: 16
slug: ci-dx-parity-docs-packaging
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-22
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (`node --import tsx --test`) |
| **Config file** | none — `scripts/run-tests.mjs` discovers `tests/**/*.test.ts`; c8 for coverage |
| **Quick run command** | `node --import tsx --test tests/repo-files.test.ts tests/workflow-bodies.test.ts tests/http-mock.test.ts` |
| **Full suite command** | `npm run check` (now prebuild-first) |
| **Estimated runtime** | quick ~4s; full check ~120s; coverage ~150s |

---

## Sampling Rate

- **After every task commit:** quick command for the file(s) touched.
- **After every plan wave:** `npm run check` (mirrors CI exactly post-CI-01).
- **Before `/gsd:verify-work`:** `npm run check` green AND `git status --porcelain` empty (the CI-02 gate, runnable locally) AND `npm run test:coverage` meets thresholds.
- **Max feedback latency:** ~150s (coverage).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 16-01-xx | 01 | 0 | CI/DOCS | T-16-* | RED-by-skip scaffolds (check-order, porcelain-clean, workflow-bodies-non-stub, deps, README-content) | unit | quick command | ❌ W0 | ⬜ pending |
| 16-0x-xx | 0x | 1 | CI-01 | — | `npm run check` runs prebuild FIRST (order matches ci.yml) | unit | assertion on package.json check script | ❌ W0 | ⬜ pending |
| 16-0x-xx | 0x | 1 | CI-02 | T-16-ci | `git status --porcelain` empty after build (no untracked generated files); gitignore covers them | ci/unit | local porcelain check + ci.yml step | ❌ W0 | ⬜ pending |
| 16-0x-xx | 0x | 1 | CI-03 | — | coverage ≥ thresholds (lines 85/fn 72/br 82); suite runs under non-TTY stdin (prompts short-circuit) | ci/unit | `npm run test:coverage` | ❌ W0 | ⬜ pending |
| 16-0x-xx | 0x | 1 | DOCS-01 | — | README has install + /pensmith quickstart + PRD §3 disclaimer verbatim + GSD credit; stale assertions removed; §3 disclaimer printed at intake | unit | `tests/repo-files.test.ts` (new README asserts) | ❌ W0 | ⬜ pending |
| 16-0x-xx | 0x | 1 | DOCS-02 | — | 4 workflow bodies non-stub + capability_check + 16-body bijection intact + tier-contract green; stale Phase-X copy refreshed (doctor-output.md re-pinned if touched) | unit | `tests/repo-files.test.ts tests/tier-contract.test.ts` | ❌ W0 | ⬜ pending |
| 16-0x-xx | 0x | 1 | DOCS-03 | T-16-dep | nock in devDependencies (not dependencies); http-mock.ts lazy-imports nock so a prod install without nock doesn't throw | unit | `tests/http-mock.test.ts` + a package.json deps assertion | ❌ W0 | ⬜ pending |
| 16-0x-xx | 0x | 1 | CI-01/02/03/DOCS-* | — | tier-contract green; full check green; porcelain clean | contract | `npm run check && git status --porcelain` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] RED-by-skip scaffolds: check-order assertion, porcelain-clean (local), workflow-bodies-non-stub guard (doctor/status/next/resume no longer the 23-line stub), deps-placement (nock in devDeps), README-content (install/quickstart/§3/credit), http-mock lazy-nock.
- [ ] Scaffolds skip-guarded; path resolution via fileURLToPath (spaced-path safe).

*Existing infra covers the rest. NOTE: README update REQUIRES removing the stale assertions at repo-files.test.ts:91-92 in the same commit; a doctor-output.md refresh REQUIRES re-pinning repo-files.test.ts:179.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The new CI fresh-clone porcelain + coverage gates pass on the real 3-OS GitHub matrix | CI-02/CI-03 | Requires a real GitHub Actions run on linux/macos/windows | Push to origin; confirm the CI matrix (incl. the new porcelain + coverage steps) is green on all 3 OSes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 150s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
