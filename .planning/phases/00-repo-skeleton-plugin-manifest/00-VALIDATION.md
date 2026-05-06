---
phase: 0
slug: repo-skeleton-plugin-manifest
status: execution-ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-06
updated: 2026-05-07
update_reason: cycle-3 fix — `wave_0_complete` reset to `false` (correct pre-execution state per codex review HIGH #3); flag flips to `true` only when the six Wave 0 artifacts exist on disk and `npm run check` exits 0 (asserted at end of Wave 2)
---

# Phase 0 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (built into Node 20+) — no extra framework dependency |
| **TypeScript loader** | `tsx` (via `node --import tsx --test`) for `.test.ts` files |
| **Config file** | none — `node:test` is config-free |
| **Quick run command (canonical)** | `npm test` (= `node scripts/run-tests.mjs`) |
| **Why not raw `node --test`** | Node 20.10 lacks native `--test` glob expansion; cmd.exe (windows-x64 matrix entry, D-10) does NOT expand `tests/**/*.test.ts`. Raw `node --test` produces a vacuous CI pass on Windows. The runner script (Plan 01) discovers tests via `fs.readdir({recursive:true})` and exits 1 when zero matches are found. |
| **Full suite command** | `npm run check` (= `npm run lint && npm run typecheck && npm run test && npm run validate:manifests`) |
| **Estimated runtime** | ~30s local (lint + typecheck + 8–10 tests + manifest validate); ~3 min CI per matrix entry |

> **Cycle 2 reconciliation (2026-05-07):** previous draft listed `node --test` as the "Quick run command" and "~10 seconds (zero unit tests)" as runtime. Both were incorrect — Plan 01 ships `scripts/run-tests.mjs` as the test runner and Wave 0 lands at minimum 8 tests (3 manifest + 1–2 chokepoint + 7 repo-files smoke). Updated to match Plan 01 + Plan 02 + Plan 03 actual contract.

---

## Sampling Rate

- **After every task commit:** Run `npm run lint && npm run typecheck`
- **After every plan wave:** Run `npm run check` (lint + typecheck + test + manifest validate)
- **Before `/gsd-verify-work`:** Full suite must be green; CI matrix all three OSes green per REPO-04
- **Max feedback latency:** 30 seconds local; ~3 minutes CI

---

## Per-Task Verification Map

> Cycle 2 replan (2026-05-07): map populated from the four PLAN.md files in this phase. Each row is a task → automated test mapping. "File Exists" indicates whether the test file already exists (✅) or is created during Wave 0 (❌ W0).

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 00-01-T1 | 00-01 | 1 | REPO-01, REPO-03 | smoke | `node -e "JSON.parse(require('fs').readFileSync('package.json'))"` + `node -e "JSON.parse(require('fs').readFileSync('tsconfig.json'))"` + `node scripts/run-tests.mjs` (must exit 1 with "discovered 0 test files" PRE-Wave-2) | ❌ W0 | ⬜ pending |
| 00-01-T2 | 00-01 | 1 | REPO-01 | smoke | `npx tsc --noEmit` (compiles `mcp/server.ts` stub under strict tsconfig) | ❌ W0 | ⬜ pending |
| 00-02-T1 | 00-02 | 2 | REPO-05 | smoke | `npm run lint` (project lint exits 0; fixture is ignored) | ❌ W0 | ⬜ pending |
| 00-02-T2 | 00-02 | 2 | REPO-05, REPO-01 | unit | `npm test` — runs `tests/lint-chokepoint.test.ts` (positive: both rules fire on fixture; negative: benign `/^11\./` does not fire) AND `tests/repo-files.test.ts` (root-file contract) | ❌ W0 | ⬜ pending |
| 00-03-T1 | 00-03 | 2 | REPO-02, REPO-03 | smoke | `node -e "JSON.parse(...)"` against `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.mcp.json` | ❌ W0 | ⬜ pending |
| 00-03-T2 | 00-03 | 2 | REPO-02 | unit | `npm run validate:manifests` (= `node scripts/validate-plugin-manifest.cjs`) AND `npm test` runs `tests/manifest.test.ts` (validator exit 0 + per-field structural assertions + negative test on malformed plugin.json) | ❌ W0 | ⬜ pending |
| 00-04-T1 | 00-04 | 3 | REPO-04 | smoke | Local: `npm run check && npm run build` exits 0 (proves CI step pipeline is locally green before push) + `node -e` grep over `.github/workflows/ci.yml` for required step strings | ❌ W0 | ⬜ pending |
| 00-04-T2 | 00-04 | 3 | REPO-04 | manual | Human checkpoint after first push: GitHub Actions matrix green on `ubuntu-latest`, `macos-latest` (with `RUNNER_ARCH=ARM64` verified), `windows-latest` × Node 20.10 | manual | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · 🟦 manual-only*

**Sampling continuity check:** Maximum stretch of consecutive tasks without an `<automated>` verify is 0 (every Wave 1 + Wave 2 task has an automated command; Wave 3 has 1 automated + 1 human-checkpoint, which is acceptable per the phase-end gate definition).

---

## Wave 0 Requirements

Phase 0 starts greenfield (no existing test infrastructure). Wave 0 (= "what must exist before Wave 1 ends") creates:

- [ ] `tests/repo-files.test.ts` — Plan 02 Task 2. Asserts root files (`README.md`, `PRIVACY.md`, `LICENSE`, `.gitignore`, `.gitattributes`, `eslint.config.js`, `mcp/server.ts`, `scripts/run-tests.mjs`, `package.json`, `tsconfig.json`, `README-DEV.md`, `CONTRIBUTING.md`) exist with locked content. Includes assertions that `package.json scripts.test` is exactly `node scripts/run-tests.mjs` and that `eslint-plugin-import` is NOT a devDependency (per cycle-2 D-06 reconciliation).
- [ ] `tests/manifest.test.ts` — Plan 03 Task 2. Wraps `scripts/validate-plugin-manifest.cjs` AND asserts `.mcp.json` + `plugin.json.mcpServers` shapes directly. Includes negative test (malformed `plugin.json` in temp dir → validator exits non-zero).
- [ ] `tests/lint-chokepoint.test.ts` — Plan 02 Task 2. Programmatic ESLint runner (D-08); asserts BOTH `no-restricted-imports` and `no-restricted-syntax` rules fire on the red-team fixture (positive test). Also asserts a benign `/^11\./` regex does NOT trigger the DOI rule (negative test, Pitfall B mitigation).
- [ ] `tests/fixtures/lint-chokepoint-fixture.ts` — Plan 02 Task 2. Hand-crafted file with intentional violations (`import { fetch } from 'undici'` + `/^10\./`). Excluded from typecheck (Plan 01 `tsconfig.exclude`) and from project lint (Plan 02 `eslint.config.js` `ignores`).
- [ ] `scripts/validate-plugin-manifest.cjs` — Plan 03 Task 2. Manifest validator (D-17). **Note:** `.cjs` extension is mandatory because `package.json` declares `"type": "module"`; a `.js` file using `require()` would crash with `ReferenceError: require is not defined in ES module scope`. This was fixed in cycle 1.
- [ ] `scripts/run-tests.mjs` — Plan 01 Task 1. Portable cross-platform test discoverer; replaces shell glob; exits 1 if zero matches.
- [ ] Framework install: none beyond what's in `devDependencies` — `node:test` is built-in. `tsx` (already in devDependencies) provides the TypeScript loader via `node --import tsx`.

**Wave 0 completion gate:** all six artifacts above exist on disk AND `npm run check` exits 0. Sets `wave_0_complete: true` in this frontmatter.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CI matrix arm64 confirmation | REPO-04 | `macos-latest` runner promotion has shifted historically (Pitfall C); arm64 confirmation requires reading run logs even though the YAML pipeline includes a `test "$RUNNER_ARCH" = "ARM64"` guard | Open the CI matrix run on GitHub, click `check (macos-latest, 20.10)`, expand "Verify macos runner is arm64 (Pitfall C)" step, confirm `runner.arch=ARM64` |
| First-push CI smoke | REPO-04 | Repo creation + first push is a launch step the user owns; not a code change. Plan 00-04 Task 2 is a `checkpoint:human-verify` blocking gate. | After Task 1 lands locally, user runs `git push -u origin main` (or `gh repo create` first), then opens `https://github.com/<user>/pensmith/actions` and confirms green matrix |
| Plugin manifest cross-check via `claude` CLI (optional) | REPO-02 | Optional secondary check; primary gate is `scripts/validate-plugin-manifest.cjs`. If `claude` CLI is installed locally, run `claude plugin validate` for an upstream cross-check; otherwise mark as waived (the structural validator is sufficient per cycle-2 D-17 reconciliation). | Run `claude plugin validate` locally if `claude` CLI is installed; otherwise skip |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are explicitly Wave 0 / human-checkpoint (00-04-T2)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (six artifacts above)
- [x] No watch-mode flags
- [x] Feedback latency < 30s local; ~3 min CI
- [x] Test runner reconciled: canonical command is `npm test`, runner script is `scripts/run-tests.mjs`, raw `node --test` is NOT used (vacuous-pass landmine on Windows)
- [x] Per-task verification map populated (8 tasks across 4 plans)
- [x] Module-format reconciled: `scripts/validate-plugin-manifest.cjs` (`.cjs`, not `.js`); `tests/manifest.test.ts` uses `import { tmpdir } from 'node:os'` (not `require`)
- [x] `nyquist_compliant: true` set in frontmatter
- [x] `wave_0_complete` flag is `false` pre-execution and flips to `true` only when the six Wave 0 artifacts exist on disk and `npm run check` exits 0 (asserted at end of Wave 2)

**Approval:** execution-ready (cycle 2 replan, 2026-05-07)
