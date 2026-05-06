---
phase: 0
slug: repo-skeleton-plugin-manifest
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-06
---

# Phase 0 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (built into Node 20+) + `c8` for coverage when needed |
| **Config file** | none — `node:test` is config-free |
| **Quick run command** | `node --test` |
| **Full suite command** | `npm run check` (= lint + typecheck + test + manifest validation) |
| **Estimated runtime** | ~10 seconds (zero unit tests; lint + typecheck dominate) |

---

## Sampling Rate

- **After every task commit:** Run `npm run lint && npx tsc --noEmit`
- **After every plan wave:** Run `npm run check`
- **Before `/gsd-verify-work`:** Full suite must be green; CI matrix all three OSes green
- **Max feedback latency:** 30 seconds local; ~3 minutes CI

---

## Per-Task Verification Map

> Filled by gsd-planner after PLAN.md files exist. Source: 00-RESEARCH.md §Validation Architecture.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 0-XX-XX | XX | N | REPO-XX | T-0-XX / — | {expected secure behavior or "N/A"} | unit/smoke | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Phase 0 has NO existing test infrastructure. Wave 0 must create:

- [ ] `tests/repo-files.test.ts` — asserts root files (`README.md`, `PRIVACY.md`, `LICENSE`, `.gitignore`) exist with minimum content
- [ ] `tests/manifest.test.ts` — wraps `scripts/validate-plugin-manifest.js` as a `node:test` test; also asserts `.mcp.json` and `plugin.json.mcpServers` shape
- [ ] `tests/lint-chokepoint.test.ts` — programmatic ESLint runner (D-08); asserts both rules fire on fixture
- [ ] `tests/fixtures/lint-chokepoint-fixture.ts` — the red-team fixture file (intentional violations)
- [ ] `scripts/validate-plugin-manifest.js` — manifest validator (D-17)
- [ ] Framework install: none beyond what's in `devDependencies` — `node:test` is built-in

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CI matrix arm64 confirmation | REPO-04 | `macos-latest` runner promotion has shifted historically; arm64 confirmation requires reading run logs | Open the matrix run on GitHub, confirm `macos-latest` runner reports arm64 architecture |
| Plugin manifest live validation via `claude` CLI | REPO-02 | Optional cross-check; primary gate is `scripts/validate-plugin-manifest.js` | Run `claude plugin validate` locally if `claude` CLI is installed |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s local
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
