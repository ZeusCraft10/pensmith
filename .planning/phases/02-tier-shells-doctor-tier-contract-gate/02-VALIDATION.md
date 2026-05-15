---
phase: 02
slug: tier-shells-doctor-tier-contract-gate
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-14
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Sourced from `02-RESEARCH.md § Validation Architecture` and `02-CONTEXT.md` locks D-01..D-24.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node --test` (node:test) + `tsx` for TS execution |
| **Config file** | `scripts/run-tests.mjs` (portable cross-platform discovery — Phase 0 shipped) |
| **Quick run command** | `node scripts/run-tests.mjs tests/<the-test-file>` |
| **Full suite command** | `npm run check` (lint + typecheck + build + test:tier-contract + test + validate:manifests) |
| **Estimated runtime** | ~45s quick / ~3-4 min full (3-OS CI matrix) |

---

## Sampling Rate

- **After every task commit:** `npm run lint && npm run typecheck && node scripts/run-tests.mjs tests/<changed>`
- **After every plan wave:** `npm run check` (full suite, local)
- **Before `/gsd-verify-work`:** Full `npm run check` green on **all 3 OSes** (linux-x64, macos-arm64, windows-x64) in CI
- **Max feedback latency:** ~45 seconds (quick test loop)

---

## Per-Requirement Verification Map

Task-ID column is populated when PLAN.md files land. Status column updated as tasks turn green.

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| ARCH-01 | Workflows are markdown shared by both tiers | smoke | `node scripts/run-tests.mjs tests/repo-files.test.ts` (extend: assert `workflows/*.md` present + readable by both tier entries) | ❌ Wave 0 — extend existing | ⬜ pending |
| ARCH-03 | `<capability_check>` block present in every workflow body | unit | `node scripts/run-tests.mjs tests/repo-files.test.ts` (extend) | ❌ Wave 0 | ⬜ pending |
| ARCH-18 | MCP tool handler ≤30 lines, no `fs`/`http` imports | lint | `node scripts/run-tests.mjs tests/lint-thin-shim.test.ts` | ❌ Wave 1 NEW | ⬜ pending |
| TIER-01 | All 17 verbs dispatchable | unit | `node scripts/run-tests.mjs tests/cli-verbs.test.ts` (preflight: assert `workflows/*.md` ↔ dispatcher `subCommands` key-equal) | ❌ Wave 2 NEW | ⬜ pending |
| TIER-02 | Stub verbs exit 0 with "not implemented yet" | smoke | `node scripts/run-tests.mjs tests/cli-stubs.test.ts` (`execFileSync` each stub verb, assert exit 0 + stdout match) | ❌ Wave 2 NEW | ⬜ pending |
| TIER-03 | Doctor exits 0 on PASS/WARN/SKIP, non-zero on FAIL | unit | `node scripts/run-tests.mjs tests/doctor-exit-code.test.ts` (mock a FAIL probe, assert exit 1) | ❌ Wave 2 NEW | ⬜ pending |
| TIER-04 | Probes return `{id, severity, summary, detail?, fix?}` | unit | `node scripts/run-tests.mjs tests/doctor-shape.test.ts` (call `runDoctor()`, assert Record shape) | ❌ Wave 2 NEW | ⬜ pending |
| TIER-05 | MCP server boots over stdio and registers 4 resources + 4 tools | integration | `npm run test:tier-contract` — covers handshake | ❌ Wave 3 NEW | ⬜ pending |
| TIER-06 | MCP tool handlers parse zod input | unit | `node scripts/run-tests.mjs tests/mcp-tool-handlers.test.ts` (instantiate `McpServer` in-process, call tool with malformed input, assert validation error) | ❌ Wave 2 NEW | ⬜ pending |
| TIER-07 | Plugin shell + hooks scaffolding present + manifest valid | smoke | `npm run validate:manifests` (extend `scripts/validate-plugin-manifest.cjs` to also assert `hooks/` scaffolding) | ❌ Wave 4 — extend existing | ⬜ pending |
| DOCT-01 | `node-version` probe ≥20.10 PASS | unit | `tests/doctor-probes.test.ts::node-version` | ❌ Wave 2 NEW | ⬜ pending |
| DOCT-02 | `mcp-sdk-presence` probe checks `dist/mcp/server.js` exists + non-empty | unit | `tests/doctor-probes.test.ts::mcp-presence` (mock `fs`) | ❌ Wave 2 NEW | ⬜ pending |
| DOCT-03 | `http-contact-email` probe surfaces WARN when `PENSMITH_CONTACT_EMAIL` unset; copy matches `references/http-warnings.md` | unit | `tests/doctor-probes.test.ts::contact-email` | ❌ Wave 2 NEW | ⬜ pending |
| DOCT-04 | `sync-folder-detection` probe WARNs when `paperDir()` in sync folder | unit | `tests/doctor-probes.test.ts::sync-folder` (override `paperDir()` to a tmp path containing `/OneDrive/`) | ❌ Wave 2 NEW | ⬜ pending |
| DOCT-05 | `wiring-smoke` probe runs `node dist/bin/pensmith.js --version`, asserts exit 0 | smoke | `tests/doctor-probes.test.ts::wiring-smoke` (depends on build artifact) | ❌ Wave 3 NEW (depends on build) | ⬜ pending |
| DOCT-06 | `runtime-config-presence` probe — WARN if no provider key resolvable; value never persisted | unit | `tests/doctor-probes.test.ts::runtime-config` (override `process.env` per test) | ❌ Wave 2 NEW | ⬜ pending |

### Carry-forward Verifications (from CONTEXT.md locks)

| CF ID | Source Lock | Behavior | Test Type | Automated Command | Wave |
|-------|-------------|----------|-----------|-------------------|------|
| CF-D01 | D-01 | `parseRetryAfter` pure function (extracted from `http.ts`) | unit | `node scripts/run-tests.mjs tests/retry.test.ts` (moved cases) | 0 |
| CF-D09 | D-09 | Thin-shim AST lint flags red-team fixtures | lint | `node scripts/run-tests.mjs tests/lint-thin-shim.test.ts` | 1 |
| CF-D10 | D-10 | MCP-no-network AST lint flags red-team fixtures | lint | `node scripts/run-tests.mjs tests/lint-mcp-no-network.test.ts` | 1 |
| CF-D12 | D-12 | Capabilities-no-leak AST lint flags red-team fixtures | lint | `node scripts/run-tests.mjs tests/lint-capabilities-noleak.test.ts` | 1 |
| CF-D22 | D-22 | CI matrix runs `test:tier-contract` on all 3 OSes | smoke | CI itself (asserts in `.github/workflows/ci.yml`) | 3 |
| CF-D24 | D-24 | `CONTRIBUTING.md` has "Tier contract — do not skip" section | smoke | `tests/repo-files.test.ts` extension | 4 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `bin/lib/retry.ts` — extract `parseRetryAfter` out of `http.ts` (D-01)
- [ ] `tests/retry.test.ts` — move `parseRetryAfter` cases out of `http.test.ts`
- [ ] `package.json` — add `citty@^0.2.2` to `dependencies`
- [ ] `references/doctor-output.md` — locked TTY copy + JSON shape (D-18)
- [ ] `tests/repo-files.test.ts` extension — assert `references/doctor-output.md` present and unchanged-hash, assert `hooks/` directory exists
- [ ] `workflows/` directory — initial markdown bodies referenced by both tier entries (consumed by `tests/cli-verbs.test.ts` preflight + ARCH-01/ARCH-03 smoke)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Doctor TTY output reads cleanly on Windows Terminal / macOS Terminal.app / Linux gnome-terminal | TIER-04 | ANSI color + box-drawing rendering varies per terminal; cassette tests can lock copy but not rendering | Run `node dist/bin/pensmith.js doctor` in each terminal, verify severity icons and section headers render |
| Doctor `--json` output is `jq`-pipeable | TIER-04 | Validates downstream-tool ergonomics, not just shape | `node dist/bin/pensmith.js doctor --json \| jq '.probes[] \| select(.severity == "WARN")'` returns valid JSON, exit 0 |

---

## Security Domain (carried into per-plan threat models)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 2 is stdio MCP only, runs as same user; no auth boundary |
| V3 Session Management | no | No sessions |
| V4 Access Control | yes | MCP server runs user-space; D-19 (doctor read-only) limits blast radius |
| V5 Input Validation | yes | zod schemas on every MCP tool `inputSchema` (TIER-06) |
| V6 Cryptography | no | API keys handled by Phase 1 `runtime.ts` (already chokepoint-locked) |
| V14 Configuration | yes | `paper://capabilities` MUST NOT leak secrets (D-12 lint-enforced) |

Threat patterns the per-plan `<threat_model>` blocks must address:

- **Info disclosure via MCP resource content** → D-12 lint-enforced presence-flags-only; T-01-07 symmetric defense
- **Spoofing/elevation via accidental HTTP/SSE transport** → D-10 lint-enforced stdio-only
- **Tampering via fat MCP handler** → D-09 lint-enforced thin-shim ≤30 LOC
- **Injection via citty subcommand args into shell** → `execFileSync` (not `exec`) for `wiring-smoke` probe; no shell interpolation
- **DoS via stdout corruption breaking MCP framing** → Pitfall 7: never `console.log` in `mcp/`; lint catches it
- **DoS via sync-folder lock contention** → DOCT-04 surfaces the WARN; lock.ts already exponential-backoff retries

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all `❌ MISSING` references in the per-req map
- [ ] No watch-mode flags in `npm run check`
- [ ] Feedback latency < 60s for quick run
- [ ] `nyquist_compliant: true` set in frontmatter (gated on planner-emitted task IDs matching the map above)

**Approval:** pending
