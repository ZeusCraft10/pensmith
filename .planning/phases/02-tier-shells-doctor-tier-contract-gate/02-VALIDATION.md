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
| TIER-01 | MCP server exposes 5 read-only `paper://*` resources (`state`, `outline`, `section/{N}`, `library`, `capabilities`) | integration | `npm run test:tier-contract` Case B (resource registration via SDK stdio client) + `tests/mcp-server-resources.test.ts` (in-process `McpServer` URI registration) | ❌ Wave 2 NEW (02-04) | ⬜ pending |
| TIER-02 | MCP server exposes 6 idempotent state-mutation tools (`paper_init_section`, `paper_advance_section`, `paper_record_verification`, `paper_set_status`, `paper_doi_verify`, `paper_capability_probe`) w/ zod input | unit | `tests/mcp-server-tools.test.ts` (instantiate `McpServer` in-process; malformed input → validation error; replay same args → same end state per D-08) | ❌ Wave 2 NEW (02-04) | ⬜ pending |
| TIER-03 | `hooks/hooks.json` wires 4 hooks (SessionStart auto-resume / Stop release-lock+flush / PreCompact HANDOFF.json 10s / PostToolUse ≤1/min throttled) | smoke | `npm run validate:manifests` (extend `scripts/validate-plugin-manifest.cjs` to assert `hooks/hooks.json` shape — 4 named hook entries + timeout fields) | ❌ Wave 2 NEW (02-06) | ⬜ pending |
| TIER-04 | citty CLI dispatcher with all 16 verbs registered (UX-02 canonical: doctor, new, next, status, research, outline, plan, write, verify, compile, done, resume, list, open, sketch, add); only `doctor` real, 15 return `NotYetImplemented(verb, phase: N)` | unit | `tests/cli-verbs.test.ts` (preflight: `workflows/*.md` ↔ `subCommands` key-equal) + `tests/cli-stubs.test.ts` (`execFileSync` each stub verb, assert exit 0 + stdout match) | ❌ Wave 2 NEW (02-05) | ⬜ pending |
| TIER-05 | `@clack/prompts` + stdin numbered-prompt fallback parsing gsd-plugin `--text` JSON schema (1-based int for select, comma-separated for multiselect, raw string for text, y/n for confirm) | unit | `tests/prompts-schema.test.ts` (zod discriminated union) + `tests/prompts-numbered.test.ts` (PassThrough streams; PromptAbortedError on EOF + 3-retry-out-of-range; PromptTimeoutError) + `tests/prompts-shape.test.ts` (grep-assert `@clack/prompts` only imported in `bin/lib/prompts/clack.ts`) | ❌ Wave 2 NEW (02-09) | ⬜ pending |
| TIER-06 | `tests/tier-contract.test.ts` exists + acts as hard merge gate; preflight asserts every `workflows/*.md` has a contract-test case (D-24 self-enforcing) | smoke | `npm run test:tier-contract` (Case A doctor + `tests/tier-contract/preflight.test.ts`) | ❌ Wave 3 NEW (02-07) | ⬜ pending |
| TIER-07 | `assert-tier-equivalent` helper enforces ±20% length tolerance + semantic equivalence for `kind: 'prose'` cases; deterministic cases byte-equal after normalize (D-19) | unit | `tests/tier-contract/assert-tier-equivalent.test.ts` Case D (synthetic prose pairs at 0%, 19%, 21% length delta — passes ≤20%, fails >20%) | ❌ Wave 3 NEW (02-07) | ⬜ pending |
| DOCT-01 | Doctor reports plugin presence + MCP SDK presence + hooks wired + Node version ≥20.10 + disk paths writable | unit | `tests/doctor-probes.test.ts::{plugin-presence,mcp-sdk-presence,hooks-wired,node-version,disk-paths-writable}` | ❌ Wave 2 NEW (02-05) | ⬜ pending |
| DOCT-02 | Doctor ecosystem probes — Zotero MCP presence / Pandoc on PATH / humanizer at `~/.claude/skills/humanizer/` | unit | `tests/doctor-probes.test.ts::{zotero-mcp-presence,pandoc-presence,humanizer-skill-presence}` (mock `fs` / mock PATH lookup) | ❌ Wave 2 NEW (02-05) | ⬜ pending |
| DOCT-03 | `contact-email-presence` probe surfaces WARN when `PENSMITH_CONTACT_EMAIL` unset; copy matches `references/http-warnings.md` (D-18 consistency w/ runtime banner). Companion `http-crossref-ping` probe (B4 decision — shipped alongside `build-artifact-resolves` as a Phase 2 HTTP-wiring smoke) PASSes iff `tests/cassettes/crossref-ping.json` exists and a single 200 response replays via cassette-backed MockAgent; SKIPs cleanly when cassette absent | unit | `tests/doctor-probes.test.ts::{contact-email-presence,http-crossref-ping}` (cassette-backed MockAgent per D-03(d); no live HTTP) | ❌ Wave 2 NEW (02-05) | ⬜ pending |
| DOCT-04 | `sync-folder-detection` probe WARNs when `.paper/` or `pensmithDataDir()` parents match D-17 substring list (`OneDrive`, `iCloud Drive`, `CloudStorage`, `Dropbox`, `Google Drive`, `GoogleDrive`, `pCloud`, `Box`); `sync_folder_match` field populated | unit | `tests/doctor-probes.test.ts::sync-folder-detection` (override `paperDir()` to tmp paths covering each substring) | ❌ Wave 2 NEW (02-05) | ⬜ pending |
| DOCT-05 | **Deferred to Phase 3 (D-04)**. Phase 2 substitute: `build-artifact-resolves` probe — PASS iff `dist/bin/pensmith.js` + `dist/mcp/server.js` exist non-empty and `node dist/bin/pensmith.js --version` (via `execFileSync`, no shell) exits 0 | smoke | `tests/doctor-probes.test.ts::build-artifact-resolves` (depends on `npm run build`; runs in Wave 3 after build step) | ❌ Wave 3 NEW (02-05 + 02-07 wiring) | ⬜ pending |
| DOCT-06 | Both tiers produce equivalent doctor `--json` output (first contract-test case) | integration | `npm run test:tier-contract` Case A — byte-equal after `tests/lib/normalize-probe-report.ts` (D-20); `Record<string, ProbeResult>` keyed by `probe.id` per the canonical probe-id set locked in `02-05` frontmatter (incl. renamed `*-presence` ids + Phase 2 additions `build-artifact-resolves`, `http-crossref-ping`); spawns `dist/mcp/server.js` via SDK `StdioClientTransport`, runs `node dist/bin/pensmith.js doctor --json` via `execFileSync` | ❌ Wave 3 NEW (02-07) | ⬜ pending |
| DOCT-07 | `runtime-config-presence` probe iterates `loadRuntimeConfig().providers` and emits per-provider `{name, apiKeyEnv, present:boolean}`; env-var **NAME** and presence flag only — resolved value never reaches output, log, or report (symmetric to T-01-07 / D-12); WARN if no provider has its key set | unit | `tests/doctor-probes.test.ts::runtime-config-presence` (override `process.env` per test; assert returned object byte-equal to expected presence-only shape; grep-assert no `process.env[…]` value appears in JSON output) | ❌ Wave 2 NEW (02-05) | ⬜ pending |

### Carry-forward Verifications (from CONTEXT.md locks)

| CF ID | Source Lock | Behavior | Test Type | Automated Command | Wave |
|-------|-------------|----------|-----------|-------------------|------|
| CF-D01 | D-01 | `parseRetryAfter` pure function (extracted from `http.ts`) | unit | `node scripts/run-tests.mjs tests/retry.test.ts` (moved cases) | 0 |
| CF-D08 | D-08 | MCP state-mutation tools idempotent via natural-key + state-version check; stale version → typed conflict | unit | `tests/mcp-server-tools.test.ts` (replay same args → same end state; bump state version mid-run → conflict response) | 2 |
| CF-D09 | D-09 | Thin-shim AST lint flags red-team fixtures (handler >30 logical statements, direct `fs`/`http`/`undici` import) | lint | `node scripts/run-tests.mjs tests/lint-thin-shim.test.ts` | 1 |
| CF-D10 | D-10 | MCP-no-network AST lint flags red-team fixtures (`net.createServer` / `http.createServer` / `tls.createServer` in `mcp/`) | lint | `node scripts/run-tests.mjs tests/lint-mcp-no-network.test.ts` | 1 |
| CF-D12 | D-12 | Capabilities-no-leak AST lint flags red-team fixtures (`process.env[x]` flowing into capabilities return outside the presence-check pattern) | lint | `node scripts/run-tests.mjs tests/lint-capabilities-noleak.test.ts` | 1 |
| CF-D20 | D-20 | Shared normalizer at canonical `tests/lib/normalize-probe-report.ts`; placeholder-substitute-then-path-normalize order; recursive key sort; per-rule `// why intrinsically variable` comment present | unit | `tests/tier-contract/normalize.test.ts` (synthetic ProbeReport fixtures → byte-equal post-normalize across Linux/macOS/Windows path inputs) | 3 |
| CF-D22 | D-22 | CI matrix runs `test:tier-contract` on all 3 OSes (linux-x64 / macos-arm64 / windows-x64) | smoke | CI itself (asserts in `.github/workflows/ci.yml`) | 3 |
| CF-D24 | D-24 | `CONTRIBUTING.md` has `<!-- LOCKED -->` "Tier contract — do not skip" section + preflight at `tests/tier-contract/preflight.test.ts` self-enforces "every workflow has a case" | smoke | `tests/repo-files.test.ts` extension (hash-pin CONTRIBUTING.md LOCKED block) + `npm run test:tier-contract` preflight | 4 |

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
