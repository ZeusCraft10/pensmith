---
phase: 02-tier-shells-doctor-tier-contract-gate
verified_date: 2026-05-16
status: pass
test_count: 357
requirements_passed: 17
requirements_total: 17
decisions_honored: 24
decisions_total: 24
blocking_issues: 0
verifier: gsd-verifier (goal-backward) + re-verification
re_verified_date: 2026-05-16
re_verification_commit: 4d0a02e
---

# Phase 2 Verification Report — Tier shells + doctor + tier-contract gate

## Re-verification Addendum (2026-05-16, commit 4d0a02e)

The single BLOCKER (CR-02 incomplete fix) and its related PARTIAL findings
(DOCT-01, ARCH-03 partial via Tier-2 install, D-13) are now resolved in
commit `4d0a02e fix(02): CR-02 redo — walk to package.json instead of fixed-depth ..`:

1. **Path arithmetic fix.** `bin/lib/doctor/probes/{build-artifact-resolves,mcp-sdk-presence}.ts`
   no longer use fixed-depth `..` walks. Both probes now call a local
   `findPkgRoot(start)` helper that walks up from `import.meta.url` until it
   finds a directory containing `package.json` (bounded to 8 steps).
   Works correctly under both runtime modes:
   - tsx (probe at `bin/lib/doctor/probes/*.ts`, depth 4 from repo root)
   - compiled (probe at `dist/bin/lib/doctor/probes/*.js`, depth 5 from repo root)

2. **Regression test hardening.** `tests/doctor-probes-cwd-independence.test.ts`
   now spawns the *compiled* `dist/bin/pensmith.js doctor --json` from a
   `mkdtempSync(tmpdir())` cwd and asserts `exit code === 0` AND both
   target probes report `severity: 'PASS'` in the parsed JSON. Importing
   the probe modules via tsx (the previous approach) silently masked the
   off-by-one because the .ts source path coincidentally landed at the
   repo root with `..` × 4.

3. **Case A tolerance removed.** `tests/tier-contract.test.ts` Case A now
   asserts `exitCode === 0` (was `[0, 1].includes(exitCode)`). The earlier
   tolerance let Tier-2 install failures sail past the merge gate. Per D-15,
   doctor should exit 0 when all probes are PASS/WARN/SKIP in the post-build
   Case A environment; a non-zero exit is a real defect.

Independent reproduction of the CR-02 fix:

```
$ cd /tmp
$ node /…/pensmith/dist/bin/pensmith.js doctor --json | jq '.probes[] | "\(.id) \(.severity)"'
"node-version PASS"
"mcp-sdk-presence PASS"
"zotero-mcp-presence WARN"
"pandoc-presence WARN"
"humanizer-skill-presence WARN"
"contact-email-presence WARN"
"sync-folder-detection PASS"
"runtime-config-presence WARN"
"build-artifact-resolves PASS"
"http-crossref-ping SKIP"
$ echo $?
0
```

Post-fix `npm run check` status:

- `npm run lint` — clean
- `npm run typecheck` (tsc --noEmit) — clean
- `npm run build` — `version.generated.ts` + `verbs.json` regenerated; tsc clean
- `npm run test:tier-contract` — 9/9 (4 Cases + 5 preflights, Case A with strict exitCode === 0)
- `npm test` — 357/357
- `npm run validate:manifests` — clean

The test count moved from 358 to 357 because the prior 2-case
`doctor-probes-cwd-independence` test (one per probe, importing TS sources)
was replaced by a single spawn-based test asserting both probes via the
compiled CLI. The new single test is strictly more rigorous because it
exercises the production code path.

Updated status: **PASS**. All 17 requirements honored, all 24 D-decisions
honored, 0 blocking issues. Phase 2 closed; safe to advance to Phase 3.

---

## Original verification (snapshot — left intact for audit trail)

The remainder of this document is the original goal-backward verification
report. The findings at the time are preserved verbatim. Where those
findings called CR-02 a BLOCKER and DOCT-01 / D-13 PARTIAL, those statuses
are superseded by the re-verification addendum above.

---

## Snapshot: original goal-backward verification

**Verified:** 2026-05-16
**Re-verification:** No — initial goal-backward verification
**Recommendation:** **FIX_THEN_SHIP** (one shipped path-resolution defect blocks the Tier-2 portable-CLI contract)

---

## Goal recap (from 02-CONTEXT.md)

Bring up BOTH tier shells (Tier 1 Claude Code plugin + Tier 2 portable Node CLI) against the Phase 1 foundation libs. Ship `/pensmith doctor` end-to-end in both tiers as the first concrete consumer of `bin/lib/*` and the first contract case for `tests/tier-contract.test.ts`, which becomes a hard merge gate from this phase forward.

Phase 2 must deliver:
1. Two-tier shells (TIER-01..07) that agree on the capability surface
2. A working `doctor` command in both tiers (DOCT-01..07)
3. A 3-OS hard merge gate (D-22, D-23)
4. Three Wave 1 lint chokepoints (D-09 / D-10 / D-12) that fire on violations
5. Prompt fallback stack (TIER-05)
6. Hook lifecycle stubs (TIER-03)
7. Closure of all 10 review findings (3 critical, 7 warning)

---

## Headline finding

**BLOCKER (CR-02 incomplete fix): `bin/lib/doctor/probes/{build-artifact-resolves,mcp-sdk-presence}.ts` walk `..` × 4 from `import.meta.url`, but after `npm run build` the probe lands in `dist/bin/lib/doctor/probes/`. 4 levels up reaches `dist/`, not the repo root. The MCP and CLI paths are then joined as `dist/dist/mcp/server.js` and `dist/dist/bin/pensmith.js` — neither exists.**

End-user-visible symptom (reproduced from a non-repo cwd):

```
$ cd /tmp
$ node /…/pensmith/dist/bin/pensmith.js doctor
✗ [FAIL] mcp-sdk-presence: dist/mcp/server.js not found
✗ [FAIL] build-artifact-resolves: Build artifact missing: …/dist/dist/bin/pensmith.js not found; …/dist/dist/mcp/server.js not found
Doctor: 1 PASS, 6 WARN, 2 FAIL, 1 SKIP
$ echo $?
1
```

This is the literal CR-02 user-install failure mode the SUMMARY claims to have fixed. The regression test `tests/doctor-probes-cwd-independence.test.ts` runs via `tsx` against the TS sources at `bin/lib/doctor/probes/`, where `..` × 4 happens to land at the repo root — so the test passes. It never exercises the post-build path the end-user actually invokes. The CI matrix doesn't catch it either: the tier-contract Case A tolerates exit code 0 OR 1 and only diffs the 4 ecosystem keys.

**Severity:** BLOCKER — CR-02 was claimed merge-blocking, the fix is shipped but defective, the regression test is a false negative. The Tier-2 portable-CLI contract is broken at install time.

**Fix:** Change `..` × 4 to `..` × 5 in both probes (or use a more robust resolution that walks until the first `package.json`). The regression test must `require` / `import` the compiled `dist/` modules rather than the TS sources.

Suggested patch (build-artifact-resolves.ts and mcp-sdk-presence.ts):

```diff
- const PKG_ROOT = path.resolve(HERE, '..', '..', '..', '..');
+ const PKG_ROOT = path.resolve(HERE, '..', '..', '..', '..', '..');
```

And `tests/doctor-probes-cwd-independence.test.ts` must import from `../dist/bin/lib/doctor/probes/…js` (or spawn `dist/bin/pensmith.js` doctor from a non-repo cwd and parse the JSON output).

---

## Requirement-by-requirement results

| REQ_ID | Status | Evidence |
|--------|--------|----------|
| **ARCH-01** (Two-tier source-of-truth: workflows shared) | PASS | `workflows/*.md` — 16 files; `scripts/validate-plugin-manifest.cjs` lines 141–156 asserts exact set; `tests/cli-verbs.test.ts:60-78` preflight key-equals dispatcher verbs. |
| **ARCH-03** (`<capability_check>` in every workflow body) | PASS | All 16 `workflows/*.md` contain exactly one `<capability_check>` block (verified by `grep -c`); validator (line 152) regex-asserts presence. |
| **ARCH-18** (MCP thin shim — handlers ≤30 lines, logic in `bin/lib/*`) | PASS | `tests/mcp-server-thin-shim.test.ts` AST-walks all 11 handlers; `tests/lint-thin-shim.test.ts` enforces fs-import ban; `mcp/resources.ts` + `mcp/tools.ts` delegate to `bin/lib/{state,outline,section,doi,capabilities}.ts`. |
| **TIER-01** (5 `paper://*` resources) | PASS | `mcp/resources.ts` registers `state`, `outline`, `section/{n}`, `library`, `capabilities`. `tests/tier-contract/preflight.test.ts:64-75` asserts exactly 5 via runtime list. |
| **TIER-02** (6 snake_case tools) | PASS | `mcp/tools.ts` registers `paper_init_section`, `paper_advance_section`, `paper_record_verification`, `paper_set_status`, `paper_doi_verify`, `paper_capability_probe`. Preflight asserts exactly 6 names match (line 77-82). |
| **TIER-03** (hooks/hooks.json wires 4 hooks) | PASS | `hooks/hooks.json` schemaVersion=1 + 4 hooks (SessionStart, PreCompact, PostToolUse, Stop); each script file exists; `tests/hooks-noop.test.ts` confirms each exits 0; validator asserts the manifest shape. |
| **TIER-04** (citty 16-verb dispatcher; only `doctor` real) | PASS | `bin/pensmith.ts` uses `defineCommand`+`buildSubCommands()`; `bin/lib/verbs.ts` lists 16 UX-02 verbs; `tests/cli-verbs.test.ts:25-58` introspects runtime `command.subCommands` and asserts deep-equal to UX02_VERBS. |
| **TIER-05** (prompt fallback stack) | PASS | `bin/lib/prompts.ts::ask()` dispatches clack vs numbered by TTY detection / `PENSMITH_PROMPT_MODE` env; `bin/lib/prompts/schema.ts` Zod discriminated union covers all 4 question kinds (select, multiselect, text, confirm); `tests/prompts-{schema,numbered,shape}.test.ts` exercise all paths. Note: Tier-1 native AskUserQuestion path is the host (Claude Code) — pensmith's Tier-2 module is the fallback as spec'd. |
| **TIER-06** (tier-contract hard merge gate) | PASS | `tests/tier-contract.test.ts` + `tests/tier-contract/preflight.test.ts`; `package.json` has `test:tier-contract`; `.github/workflows/ci.yml` line 41-42 runs it as a step in the 3-OS matrix. |
| **TIER-07** (±20% length tolerance + semantic equivalence) | PASS | `tests/lib/assert-tier-equivalent.ts` ships the helper; Case D in `tier-contract.test.ts:257-293` exercises it with `tolerance: 0.20`. |
| **DOCT-01** (Node version, MCP reachable, hooks, disk paths, plugin presence) | **PARTIAL** | 10 probes exist; `node-version`/`mcp-sdk-presence`/`build-artifact-resolves` probes all wired. **BUT:** `mcp-sdk-presence` reports FAIL from any non-repo-root cwd due to CR-02 incomplete fix (see headline). 9 of 10 probes are sound; this one is broken at runtime. |
| **DOCT-02** (Pandoc, Zotero MCP, humanizer) | PASS | `bin/lib/doctor/probes/{pandoc-presence,zotero-mcp-presence,humanizer-skill-presence}.ts`; backed by `bin/lib/ecosystem-presence.ts` shared module (CR-01 fix). |
| **DOCT-03** (PENSMITH_CONTACT_EMAIL warning) | PASS | `bin/lib/doctor/probes/contact-email-presence.ts` emits WARN; copy locked against `references/http-warnings.md` per D-18. |
| **DOCT-04** (sync-folder detection on OneDrive/iCloud/Dropbox/Google Drive) | PASS | `bin/lib/doctor/probes/sync-folder-detection.ts` + `bin/lib/paths.ts::isInsideSyncFolder`; substring list locked per D-17; populates `sync_folder_match` field. |
| **DOCT-05** (deferred to Phase 3; Phase 2 substitute = build-artifact-resolves) | **PARTIAL** | Phase 2 substitute probe exists at `bin/lib/doctor/probes/build-artifact-resolves.ts`. **BUT:** same CR-02 path-resolution defect — FAIL from non-repo cwd. Phase 3 deferral honored per D-04. |
| **DOCT-06** (both tiers produce equivalent doctor output) | PASS | `tests/tier-contract.test.ts` Case A asserts MCP capability facts ≡ CLI doctor probe facts (with `=== true` strict comparison after CR-01 fix). All 4 cases (A,B,C,D) green in `npm run check`. |
| **DOCT-07** (runtime-config-presence probe; presence-flags only) | PASS | `bin/lib/doctor/probes/runtime-config-presence.ts` delegates to `loadCapabilityFacts()` — single composition site shared with mcp/. Sentinel-value leak test in `tests/capabilities.test.ts` and lint backstop in `eslint.config.js` (lines 296-323). |

**Score:** 14 / 17 PASS; 3 PARTIAL (DOCT-01, DOCT-05, DOCT-07 share the CR-02 defect); BLOCKER on the failing probes.

Wait — re-checking. Only DOCT-01 (covers `mcp-sdk-presence`) and DOCT-05 (covers `build-artifact-resolves`) inherit the defect. DOCT-07 is sound. Corrected:

**Final count:** 15 / 17 PASS; 2 PARTIAL (DOCT-01, DOCT-05); 1 BLOCKER on the runtime path-resolution.

---

## D-decision honors table

| D-NN | Status | Evidence |
|------|--------|----------|
| **D-01** Retry-After parser in retry.ts | HONORED | `bin/lib/retry.ts::parseRetryAfter`; `tests/retry.test.ts` has 10 parse-case tests; `bin/lib/http.ts` uses it inline. |
| **D-02** REVIEW.md deferred-items disposition (FLAG-02/04/05/06 fixes) | HONORED | Phase 1 carry-forwards processed in plan 02-00; FLAG-06 specifically fixed as CR-03 (allowlist filter in `bin/lib/http.ts:372-389`). |
| **D-03** DOCT-05 wiring smoke depth | HONORED | DOCT-05 deferred to Phase 3 per D-04; Phase 2 substitute = `build-artifact-resolves` probe (despite the path bug, the probe is structurally correct). |
| **D-04** Phase 3 must re-pick up DOCT-05.v3 | HONORED (forward-looking) | Captured in `.planning/REQUIREMENTS.md` line 287 (DOCT-05 reassigned to Phase 3). |
| **D-05** 16-verb dispatcher; only `doctor` real | HONORED | `bin/lib/verbs.ts::UX02_VERBS` has 16 entries; `bin/pensmith.ts::REAL_VERB_LOADERS` registers only `doctor`. |
| **D-06** MCP SDK choice deferred → @modelcontextprotocol/sdk@^1.29 | HONORED | `package.json` pins `^1.29`. |
| **D-07** URI grammar `paper://*` singular | HONORED | All 5 resources registered with the locked URIs (`paper://state`, `paper://outline`, `paper://section/{n}`, `paper://library`, `paper://capabilities`). |
| **D-08** Idempotency via natural-key + state-version | HONORED | `bin/lib/state.ts` mutation helpers; Case C in `tier-contract.test.ts:206-255` proves `paper_advance_section` byte-equal on replay. |
| **D-09** Thin-shim AST-walk lint test | HONORED | `tests/lint-thin-shim.test.ts` 3 tests; fixture `tests/fixtures/lint-thin-shim-fixture.ts` has >30-stmt handler; AST walk fires. |
| **D-10** Stdio-only locked by lint | HONORED | `tests/lint-mcp-no-network.test.ts` fires on all 5 fixture violations; `eslint.config.js` mcp/** block lists 5 createServer / new Server selectors. |
| **D-11** Tier 2 prod never touches MCP | HONORED | `bin/lib/*` is the source-of-truth; `bin/pensmith.ts` does not import from `mcp/`; tier-contract spawns the MCP server via SDK stdio client. |
| **D-12** capabilities = presence-flags only, lint-enforced | HONORED | `tests/lint-capabilities-noleak.test.ts` fires on fixture; sentinel test in `tests/capabilities.test.ts:61-79`; static backstop in `eslint.config.js:296-323` for `runtime-config-presence.ts`. |
| **D-13** Deterministic doctor; Record<string, ProbeResult> | HONORED | `bin/lib/doctor/probes.ts::runDoctor()` returns `Record<probe.id, ProbeResult>`; 10 probes keyed by id. |
| **D-14** `<capability_check>` block format | HONORED | All 16 workflows contain `<capability_check>` blocks; `tests/workflows-keyequal.test.ts` (in repo, ran green) validates structure. |
| **D-15** Severity PASS/WARN/FAIL/SKIP; exit 0 unless any FAIL | HONORED | `bin/lib/doctor/probes.ts` defines the 4 levels; `bin/cli/doctor.ts` exit logic verified by `tests/doctor-exit-code.test.ts`. |
| **D-16** Human-first TTY + `--json` for machine | HONORED | `bin/lib/doctor/render.ts` ships both; `references/doctor-output.md` is the hash-pinned reference. |
| **D-17** Sync-folder substring detection | HONORED | `bin/lib/paths.ts::isInsideSyncFolder` lists `OneDrive`, `OneDrive - `, `iCloud Drive`, `CloudStorage`, `Dropbox`, `Google Drive`, `GoogleDrive`, `pCloud`, `Box` per the locked list. |
| **D-18** Doctor banner consistency with `bin/lib/http.ts` | HONORED | `references/http-warnings.md` is the canonical source; `tests/repo-files.test.ts` hash-pins both. |
| **D-19** Comparison strictness by `kind` (deterministic vs prose) | HONORED | `tests/lib/assert-tier-equivalent.ts` exposes the API; Case A uses byte-equal, Case D uses ±20% tolerance. |
| **D-20** Single shared normalizer at `tests/lib/normalize-probe-report.ts` | HONORED | Probes structured as `Record<string, ProbeResult>` keyed by `probe.id`; normalizer exists; tier-contract tests pass on 3-OS. |
| **D-21** CONTRIBUTING.md `<!-- LOCKED -->` discipline rule | HONORED | `CONTRIBUTING.md` lines 96-115 enumerate "fixes that are NOT acceptable" and "fixes that ARE acceptable" — exact D-21 language. CR-01 fix per D-21 (fix tiers, not test) is the lived application. |
| **D-22** 3-OS CI matrix runs `test:tier-contract` | HONORED | `.github/workflows/ci.yml`: linux-ubuntu / macos-latest (arm64-asserted) / windows-latest; `test:tier-contract` step at line 41-42. |
| **D-23** Branch-protection toggle (manual UI step) | HONORED in code; DEPENDS on out-of-band UI config | `CONTRIBUTING.md` line 52-56 documents the required setup; in-repo enforcement complete. |
| **D-24** Self-enforcing pre-flight CONTRIBUTING.md lock | HONORED | `tests/repo-files.test.ts:172-198` (CF-D24) asserts the 5 locked headings + D-09/D-10/D-12 names + 4 merge-gate layers + Phase-0 chokepoints heading. |

**Score:** 24 / 24 D-decisions HONORED (D-23 is a manual setup step the code can't enforce, but is documented).

---

## Cross-cutting validations

### Test counts and `npm run check` status

| Metric | Result |
|--------|--------|
| `npm run check` | **EXIT 0** — lint + typecheck + build + test:tier-contract + test + validate:manifests all green |
| Total tests | 358 pass / 0 fail / 0 skip |
| Phase 1 baseline (before phase 2) | 265 |
| Phase 2 delta | +93 |
| Tier-contract cases | A, B, C, D — all 4 GREEN |
| Tier-contract preflight | 5 assertions (build × 2, resources count, tools count, version) — all GREEN |
| Lint chokepoint fixture firings | D-09 (3 tests), D-10 (2 tests), D-12 (3 tests) — all GREEN, all 5 fixture violations detected |
| CI matrix | linux-ubuntu / macos-latest (ARM64) / windows-latest × Node 20.18 |

### File presence assertions

| File / class | Status |
|--------------|--------|
| `mcp/server.ts` registers 5 resources + 6 snake_case tools | PRESENT (`mcp/resources.ts` + `mcp/tools.ts` registrations, asserted by preflight runtime introspection) |
| `bin/pensmith.ts` citty dispatcher with 16 UX-02 verbs (1 real, 15 stubs) | PRESENT (`bin/lib/verbs.ts` + `bin/cli/{doctor,stubs}.ts`) |
| `bin/lib/doctor/probes/*` — 10 probes | PRESENT (all 10 enumerated in DOCT-01..07 with file-by-file evidence) |
| `hooks/hooks.json` + 4 hook scripts | PRESENT (all 4 enumerated; `tests/hooks-noop.test.ts` exits 0 on each) |
| `workflows/*.md` — 16 files, each with `<capability_check>` | PRESENT (`grep -c` confirms 1 block per file × 16 files) |
| `tests/lint-{thin-shim,mcp-no-network,capabilities-noleak}.test.ts` | PRESENT and firing on fixture violations |
| `eslint.config.js` `mcp/**` file-scoped blocks re-list project-wide D-07/D-41 selectors | PRESENT (lines 188-228 and 252-291 — full override-merge safety pattern) |
| `tests/tier-contract.test.ts` + `tests/tier-contract/preflight.test.ts` | PRESENT |
| `.github/workflows/ci.yml` runs `test:tier-contract` on 3-OS | PRESENT (line 41-42) |
| `scripts/validate-plugin-manifest.cjs` asserts `hooks/`, `workflows/` (16 .md), `dist/mcp/server.js`, `.claude-plugin/*.json` | PRESENT |
| `CONTRIBUTING.md` D-24 locked section with 5 headings, D-09/D-10/D-12 names, 4 merge-gate layers | PRESENT |
| `tests/repo-files.test.ts` CF-D24 assertion | PRESENT (line 172-198) |
| `scripts/prebuild.mjs` generates `bin/lib/version.generated.ts` + `bin/lib/verbs.json` | PRESENT |
| `bin/lib/capabilities.ts` populates pandoc/zotero/humanizer/sync_folder via `bin/lib/ecosystem-presence.ts` | PRESENT (CR-01 fix verified) |
| `bin/lib/http.ts::writeCache` filters headers through allowlist | PRESENT (CR-03 fix, line 372-403) |
| `tests/http-cache-no-header-leak.test.ts` sentinel test | PRESENT and green |
| `tests/doctor-probes-cwd-independence.test.ts` regression test | PRESENT but **DEFECTIVE** — exercises TS sources via tsx, NOT compiled dist (false negative for CR-02) |
| `sync_folder_match` typed `string \| null` | PRESENT (`bin/lib/capabilities.ts:44`; cross-checked by `tests/capabilities.test.ts:54-57`) |
| Both verb consumers (`bin/pensmith.ts`, `scripts/validate-plugin-manifest.cjs`) import from `bin/lib/verbs.ts` / `bin/lib/verbs.json` | PRESENT (WR-03 fix verified) |
| Lint chokepoint fixtures stage under `mcp/__fixtures__/` (gitignored) | PRESENT (`.gitignore` lists the dir; 3 lint tests use it) |
| `PENSMITH_PAPER_DIR` retired in favor of `PENSMITH_PAPER_ROOT` | PRESENT (no production reference to `PAPER_DIR` remains; only docs/comments) |
| `tests/cli-verbs.test.ts` uses runtime citty introspection | PRESENT (WR-06 fix verified; no regex over source) |
| 404 responses cached for ≤1 hour | PRESENT (WR-07 fix: `NEGATIVE_RESPONSE_TTL_MS = ONE_HOUR_MS`, applied in `readCache` clamp at line 348-349) |

### Review-finding closure

| Finding | Claimed Fix | Verified |
|---------|-------------|----------|
| **CR-01** Tier-contract Case D fact divergence on pandoc-installed hosts | Populate ecosystem booleans in `capabilities.ts` via shared `ecosystem-presence.ts` | ✓ Verified — both modules present; tier-contract Case D green on this host (which has pandoc and OneDrive). |
| **CR-02** Doctor probes use cwd-relative paths | `fileURLToPath(import.meta.url)` walk to PKG_ROOT + regression test | ✗ **NOT VERIFIED** — fix is shipped but **off-by-one** (walks `..` × 4 instead of 5). End-user invocation from any non-repo cwd reports FAIL on real artifacts. Regression test passes only because tsx runs TS sources where 4-level walk is coincidentally correct. **BLOCKER**. |
| **CR-03** writeCache persists raw auth-bearing headers | Allowlist filter before serialise + sentinel regression test | ✓ Verified — `CACHE_HEADER_ALLOWLIST` set, `filterHeadersForCache` applied in `writeCache`, sentinel test green. |
| **WR-01** Hardcoded version drift | Generate `version.generated.ts` from package.json at prebuild | ✓ Verified — `scripts/prebuild.mjs` writes the file; `mcp/server.ts` and `bin/pensmith.ts` both import `VERSION`. |
| **WR-02** `sync_folder_match` typed as boolean instead of folder-name string | Type as `string \| null` | ✓ Verified — `bin/lib/capabilities.ts:44`. |
| **WR-03** 16-verb list duplicated | Single source of truth in `bin/lib/verbs.ts` + JSON sibling | ✓ Verified — `bin/lib/verbs.ts` and generated `bin/lib/verbs.json`; both `bin/pensmith.ts` and `scripts/validate-plugin-manifest.cjs` consume the same source. |
| **WR-04** Lint fixtures write into `mcp/` | Move to `mcp/__fixtures__/` (gitignored) | ✓ Verified — all 3 lint tests stage to `mcp/__fixtures__/`; `.gitignore` lists the dir. |
| **WR-05** `PENSMITH_PAPER_DIR` vs `PENSMITH_PAPER_ROOT` env-var split | Unify to `PENSMITH_PAPER_ROOT` | ✓ Verified — `bin/lib/ecosystem-presence.ts:101` and all production code read `PENSMITH_PAPER_ROOT`; no production read of `PENSMITH_PAPER_DIR` remains. |
| **WR-06** `tests/cli-verbs.test.ts` regex over source | Runtime citty introspection of `command.subCommands` | ✓ Verified — `tests/cli-verbs.test.ts:25-58` does `Object.keys(subCommands)` and `deepEqual`. |
| **WR-07** 404 cached for 7 days | Clamp negative-TTL to 1 hour | ✓ Verified — `bin/lib/http.ts:348-349` clamps in `readCache` based on cached response status. |

**Closure status:** 9 of 10 findings closed cleanly; **CR-02 (the most damaging Tier-2 install-time regression) is shipped defective**.

---

## BLOCKER detail: CR-02 — incorrect `..` count in probe path resolution

**Files:**
- `bin/lib/doctor/probes/build-artifact-resolves.ts:27-32`
- `bin/lib/doctor/probes/mcp-sdk-presence.ts:22-25`

**Code under inspection (mcp-sdk-presence.ts):**

```ts
// After `npm run build`, this file is emitted to:
//   dist/bin/lib/doctor/probes/mcp-sdk-presence.js
// So PKG_ROOT is `..` × 4 from HERE.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const MCP_REL = 'dist/mcp/server.js';
const MCP_PATH = path.join(PKG_ROOT, MCP_REL);
```

**Walking the path:**

| From | Step | Lands at |
|------|------|----------|
| `dist/bin/lib/doctor/probes` | `..` 1 | `dist/bin/lib/doctor` |
| ↓ | `..` 2 | `dist/bin/lib` |
| ↓ | `..` 3 | `dist/bin` |
| ↓ | `..` 4 | `dist/` |

PKG_ROOT = `dist/`. Then `path.join(dist, 'dist/mcp/server.js')` = `dist/dist/mcp/server.js` — does not exist.

**Required fix:** `..` × 5 (one more level up out of `dist/`).

**Reproduction:**

```
$ cd /tmp
$ node /…/pensmith/dist/bin/pensmith.js doctor --json | python -c "import sys, json; p=json.load(sys.stdin)['probes']; print('mcp-sdk-presence:', p['mcp-sdk-presence']['severity']); print('build-artifact-resolves:', p['build-artifact-resolves']['severity'])"
mcp-sdk-presence: FAIL
build-artifact-resolves: FAIL
$ echo $?
1
```

**Why the regression test missed it:** `tests/doctor-probes-cwd-independence.test.ts` imports from `'../bin/lib/doctor/probes/…'.js'`. Under tsx, this resolves to the TS sources at `bin/lib/doctor/probes/*.ts` (no dist/). Walking `..` × 4 from `bin/lib/doctor/probes` lands at the repo root — coincidentally correct. The test never exercises the compiled artifact path.

**Why tier-contract Case A didn't catch it:** `tier-contract.test.ts:157` accepts `[0, 1].includes(exitCode)` as "doctor unexpected exit". Doctor exits 1 when any probe FAILs; the test silently tolerates this and only diffs the ecosystem capability keys. The CR-02 defect produces no diff in those keys.

**Why npm run check passes:** All test imports use the TS source path. None of the in-suite tests invoke the compiled `dist/bin/pensmith.js` from a different cwd and assert the build-artifact / mcp-sdk-presence probes return PASS.

**Required additional fix:** `tests/doctor-probes-cwd-independence.test.ts` must `execFileSync(process.execPath, ['dist/bin/pensmith.js', 'doctor', '--json'], {cwd: tmp})` and assert the JSON output's two artifact probes both return PASS.

---

## Phase-closure recommendation

**FIX_THEN_SHIP.**

Phase 2 ships 99% of the goal: the full tier-shell surface (5 resources + 6 tools + 16 verbs + 10 probes + 4 hooks), the hard merge gate (test:tier-contract on 3-OS, CONTRIBUTING.md D-24 lock, manifest validator, branch-protection prose), the three Wave 1 lint chokepoints (all firing on fixture violations), and 9 of 10 review-finding closures.

The one remaining defect (CR-02 off-by-one) is small in code but large in impact: it breaks the **Tier-2 portable-CLI contract** at install time. PRD §3 and §19 guarantee `pensmith doctor` works from inside a user's paper directory (not the pensmith repo root); the shipped doctor falsely reports the install as broken from any non-repo cwd.

The fix is one-line in each of two probe files plus a two-line strengthening of the regression test. Sub-30-minute work.

**Once CR-02 is genuinely closed (and the regression test rewritten to exercise the compiled dist path), Phase 2 may merge.**

The CI matrix is currently misleading: it passes today because the regression test silently aliases the TS path resolution. A failing fix-the-tiers-not-the-test discipline rule (D-21) was applied correctly to CR-01 but undermined by the false-negative regression test in CR-02. Fixing the regression test is non-negotiable on the same PR as the path fix.

---

## What was checked but is healthy

- Two-tier surface symmetry (5 resources, 6 snake_case tools, runtime introspection at preflight)
- D-09 / D-10 / D-12 lint chokepoints all fire on deliberate fixture violations (verified by running the test files)
- Hooks are noop `process.exit(0)` stubs per Phase 2 scope; `hooks/hooks.json` declares all 4
- CONTRIBUTING.md D-24 lock with all 5 sub-headings, all 3 Wave-1 chokepoint names, all 4 merge-gate layers
- Prompt fallback stack: AskUserQuestion (host) → @clack/prompts → numbered, with Zod discriminated union covering 4 question kinds
- 404 cache TTL clamped to 1 hour (WR-07)
- Header allowlist in cache writes (CR-03)
- Single source of truth for verbs list (WR-03)
- `sync_folder_match` typed `string \| null` (WR-02)
- Version constant generated from package.json (WR-01)
- CR-01 ecosystem boolean parity verified on this host (which has both pandoc absent and OneDrive present — mcp side and CLI side agree on those values; tier-contract Case A green)

---

*Verified: 2026-05-16*
*Verifier: Claude Code (gsd-verifier, goal-backward)*
*Diff base: 8d5ac8e (Phase 2 start) — d85981c (Phase 2 final SUMMARY commit)*
