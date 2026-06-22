---
phase: 02
phase_name: tier-shells-doctor-tier-contract-gate
reviewed: 2026-05-16
depth: standard
status: issues_found
files_reviewed: 83
findings:
  critical: 3
  warning: 7
  info: 3
  total: 13
reviewer: gsd-code-reviewer
diff_base: 8d5ac8e^
---

# Phase 2 Code Review: Tier Shells + Doctor + Tier-Contract Gate

**Reviewed:** 2026-05-16
**Depth:** standard
**Status:** issues_found
**Files Reviewed:** 83 source/test/config files in scope

---

## Summary

Phase 2 ships the load-bearing tier-contract gate plus the doctor command and 16-verb CLI/MCP shells. The D-decisions (D-01..D-24) are largely honored, the three Wave 1 lint chokepoints (D-09 thin-shim, D-10 no-network, D-12 capabilities-no-leak) are correctly authored with both inline-rule smoke and full-config AST walks, the override-merge safety pattern is correctly applied to the `mcp/**` blocks, and fixture sentinels (`PROCESS-ENV-SENTINEL-DO-NOT-LEAK-...`, `sk-test-LEAK-SENTINEL-12345`) are wired into the right asserters.

However, the load-bearing claim of the phase — **tier-contract equivalence on the 3-OS matrix** — has a defect that will manifest as a flaky-looking but actually-correct CI failure as soon as a CI runner has `pandoc` installed. The doctor probes also fail in the Tier-2 portable-CLI scenario the PRD explicitly demands. The FLAG-06 carry-forward from Phase 1 is also still unfixed in `bin/lib/http.ts`. These three are BLOCKERs.

---

## CRITICAL Findings

### CR-01: Tier-contract Case D fact divergence on any host with pandoc/zotero/humanizer installed

**File:** [tests/tier-contract.test.ts](tests/tier-contract.test.ts)
**Issue:** `extractMcpFacts` reads `paper://capabilities` and treats the Phase 2 placeholder keys (`pandoc`, `zotero_mcp`, `humanizer`, `onedrive_detected`) as booleans via `=== true`. Per `bin/lib/capabilities.ts`, those fields are declared `boolean | undefined` and Phase 2 leaves them `undefined`, so the MCP side reports `false`.

But `extractCliFacts` reads the doctor probe report by `probe.severity === 'PASS'` for the corresponding probe IDs (`pandoc-presence`, `zotero-mcp-presence`, `humanizer-skill-presence`). On any developer or CI machine where pandoc is actually installed, the CLI side reports `true`. `assertEquivalent` then fires fact divergence.

This is the literal scenario D-21 warns about ("fix the tiers, don't write a normalizer"). The defect is in the SHIPPED MCP side — `loadCapabilityFacts` must actually probe pandoc/zotero/humanizer presence in Phase 2 so the two tiers agree — not in the test.

The `macos-latest` GitHub runner ships pandoc preinstalled. CI will fail the moment branch protection turns on.

**Fix:** Either (a) implement the pandoc/zotero/humanizer detection in `bin/lib/capabilities.ts` so MCP reports the real boolean, OR (b) make the CLI side derive these ecosystem booleans from `loadCapabilityFacts()` rather than from probe severity. Option (a) is the right one — it is the literal point of `paper://capabilities`. Option (b) (deriving CLI facts from the same `loadCapabilityFacts()` call) only works if those facts are actually populated.

Do NOT normalize undefined to false inside `extractMcpFacts` — that is D-21 forbidden ("Loosening the assertion").

---

### CR-02: Doctor build-artifact probes use relative paths — fail in Tier-2 (portable CLI) install

**Files:**
- [bin/lib/doctor/probes/build-artifact-resolves.ts](bin/lib/doctor/probes/build-artifact-resolves.ts)
- [bin/lib/doctor/probes/mcp-sdk-presence.ts](bin/lib/doctor/probes/mcp-sdk-presence.ts)

**Issue:** Both probes use string literals `'dist/bin/pensmith.js'` and `'dist/mcp/server.js'` passed straight to `statSync` / `execFileSync`. These resolve against `process.cwd()`, not against the installed package root.

The PRD §3 and PRD §19 Tier-2 contract guarantees `pensmith doctor` runs from inside a paper directory (the user's working folder), NOT from the pensmith repo. In that scenario these probes report FAIL on a correctly-installed binary, and the doctor command exits 1.

The CI matrix doesn't catch this because CI always runs from the repo root. This is a silent Tier-2 regression that surfaces only at user install time.

**Fix:** Resolve relative to the probe file via `fileURLToPath(import.meta.url)`:

```ts
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// dist/bin/lib/doctor/probes/build-artifact-resolves.js → walk up to package root
const PKG_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const BIN = path.join(PKG_ROOT, 'dist', 'bin', 'pensmith.js');
```

Add a Tier-2 fixture test that runs `pensmith doctor` from `os.tmpdir()` and asserts the build-artifact probes return PASS.

---

### CR-03: FLAG-06 unfixed — `writeCache` persists raw response headers including auth-bearing ones

**File:** [bin/lib/http.ts](bin/lib/http.ts)
**Issue:** `writeCache` serializes the entire `response.headers` object straight to disk. There is no allowlist filter and no `pii.ts` redaction pass before write. Per Phase 1 LEARNINGS this was FLAG-06 carried forward to be fixed in 02-00-review-cleanup, and `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md` D-02 mandates resolution in Phase 2.

`Set-Cookie`, `Authorization` echo, `x-amz-*` debug headers, and provider-specific opaque session tokens flow through unredacted, get cached on disk (cache TTL up to 7 days per source), and surface in any subsequent cache replay or log. For a CLI that ships as a Claude Code plugin (Tier 1) with full repo access, that is a credential-exfiltration surface.

**Fix:** Apply an allowlist before serializing. Only persist headers needed for cache replay semantics:

```ts
const CACHE_HEADER_ALLOWLIST = new Set([
  'content-type', 'etag', 'last-modified', 'cache-control',
  'date', 'retry-after', 'x-ratelimit-remaining', 'x-ratelimit-reset',
]);

function filterHeadersForCache(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (CACHE_HEADER_ALLOWLIST.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}
```

Add a regression test that POSTs through the chokepoint with a planted `Set-Cookie: session=SENTINEL-COOKIE-LEAK`, then greps `cache_dir` recursively and asserts the sentinel is absent.

---

## WARNING Findings

### WR-01: Hardcoded version `'0.2.0'` in mcp/server.ts and bin/pensmith.ts drifts from package.json

**Files:**
- [mcp/server.ts](mcp/server.ts)
- [bin/pensmith.ts](bin/pensmith.ts)

**Issue:** Both files hardcode `version: '0.2.0'`. `package.json` declares `0.1.0-dev`. The preflight test `tests/tier-contract/preflight.test.ts` only matches `/^\d+\.\d+\.\d+/` so the drift is currently silent — but a downstream user running `pensmith --version` gets `0.2.0`, npm reports `0.1.0-dev`, and the next release tag becomes guesswork.

**Fix:** Generate the version constant at build time from `package.json` (e.g., via a `bin/lib/version.generated.ts` file produced by a `prebuild` script), or read `package.json` at startup via `import pkg from '../package.json' assert { type: 'json' }`.

---

### WR-02: `sync_folder_match` is typed as `boolean | undefined` but semantically should be a folder-name string

**File:** [bin/lib/capabilities.ts](bin/lib/capabilities.ts)
**Issue:** Per D-17, `sync_folder_match` is the *matched substring* used by sync-folder detection (OneDrive, Dropbox, iCloud). Declaring it `boolean | undefined` next to `onedrive_detected: boolean | undefined` loses the actual signal — once detection lands you can only say "matched / didn't match", not which folder triggered. The tier-contract test types it as a string in its facts object.

**Fix:** Type as `string | null`:

```ts
sync_folder_match: string | null;  // the matched path substring, or null if no match
```

Update tier-contract `extractMcpFacts` accordingly. Phase 2 placeholder value: `null`.

---

### WR-03: 16-verb list duplicated across `scripts/validate-plugin-manifest.cjs` and `tests/cli-verbs.test.ts`

**Files:**
- [scripts/validate-plugin-manifest.cjs](scripts/validate-plugin-manifest.cjs) (`EXPECTED_WORKFLOWS`)
- [tests/cli-verbs.test.ts](tests/cli-verbs.test.ts) (`EXPECTED_16`)

**Issue:** Two separate hardcoded arrays. Adding or renaming a verb requires editing both. Drift here will pass one gate while failing the other, producing confusing CI failures.

**Fix:** Extract a single source of truth, e.g. `bin/lib/verbs.ts` exporting `export const UX02_VERBS = [...]`. Have both consumers import it (the .cjs script can `require('../dist/bin/lib/verbs.js')` after build, or read a JSON sibling generated at build time).

---

### WR-04: Three lint smoke-tests write temp fixtures into `mcp/` — concurrent-build pollution risk

**Files:**
- [tests/lint-thin-shim.test.ts](tests/lint-thin-shim.test.ts)
- [tests/lint-mcp-no-network.test.ts](tests/lint-mcp-no-network.test.ts)
- [tests/lint-capabilities-noleak.test.ts](tests/lint-capabilities-noleak.test.ts)

**Issue:** Each test writes a `mcp/_*-fixture-tmp.ts` file, runs ESLint, then deletes in `finally`. The file names are distinct so collision is unlikely, but:
1. `tsc --noEmit` running in parallel (e.g., a watcher) will see the `mcp/_*-fixture-tmp.ts` file and try to type-check it.
2. A CI step failure between Write and `finally` (SIGKILL, OOM) leaves a violating file in `mcp/` that the next CI run's lint step will catch — confusingly.
3. The fixtures are designed to violate lint rules; if they leak into a real build, they fail the build.

**Fix:** Use `tests/fixtures/` (already in eslint global-ignore) for the temp file, then point ESLint at it with `--no-ignore` and a temporary inline override, or use ESLint's programmatic API with `overrideConfig.files` to scope the rule to the fixture's path while it lives outside `mcp/`.

---

### WR-05: `PENSMITH_PAPER_DIR` (sync-folder probe override) vs `PENSMITH_PAPER_ROOT` (production paper root) env-var inconsistency

**Files:**
- [bin/lib/doctor/probes/sync-folder-detection.ts](bin/lib/doctor/probes/sync-folder-detection.ts) (reads `PENSMITH_PAPER_DIR`)
- [mcp/server.ts](mcp/server.ts) (reads `PENSMITH_PAPER_ROOT`)
- [tests/tier-contract.test.ts](tests/tier-contract.test.ts) (sets `PENSMITH_PAPER_ROOT`)

**Issue:** Two env var names for what is functionally the same concept. The sync-folder probe will silently ignore the value of `PENSMITH_PAPER_ROOT` that the tier-contract test sets, so probe behavior diverges between test contexts. Future maintainers will set the wrong one.

**Fix:** Unify to `PENSMITH_PAPER_ROOT` throughout. Update the probe and its test.

---

### WR-06: `tests/cli-verbs.test.ts` parses `bin/pensmith.ts` via regex

**File:** [tests/cli-verbs.test.ts](tests/cli-verbs.test.ts)
**Issue:** Regex over source text is fragile — a one-line code-format change (single-quote vs backtick, trailing comma reflow) breaks the assertion. Citty exposes its registered subcommands at runtime; use that instead.

**Fix:** Import the citty command object from `bin/pensmith.ts` (after small refactor to export it), iterate `cmd.subCommands`, assert key set equals `UX02_VERBS`.

---

### WR-07: 404 responses cached for 7 days (intentional but UX-hostile)

**File:** [bin/lib/http.ts](bin/lib/http.ts)
**Issue:** The cache layer treats 404 as a cacheable response. A DOI that is briefly unresolvable (CrossRef indexing lag is typical for new DOIs) gets cached as "doesn't exist" for the full TTL. The verifier (Phase 3+) would then report MIS-CITED for a real, freshly-published paper.

**Fix:** Shorten TTL specifically for 4xx responses (e.g., 1 hour) or skip caching for 404 entirely. If the long TTL is deliberate to absorb rate-limit pressure, document it in a comment with the rationale.

---

## INFO Findings

### IN-01: Doctor probes don't distinguish ENOENT from EACCES

**File:** [bin/lib/doctor/probes/](bin/lib/doctor/probes/)
**Issue:** Several probes treat any `statSync` / `loadState` throw as the absence case. A permission-denied scenario reports "missing" rather than "unreadable", which leads users to reinstall when they should `chmod`.

**Fix:** Narrow on `err.code === 'ENOENT'` for the missing case; surface other errors with their code in the detail string.

---

### IN-02: `process.chdir(tmp)` in `tests/doctor-probes.test.ts` is unsafe for parallel test runners

**File:** [tests/doctor-probes.test.ts](tests/doctor-probes.test.ts)
**Issue:** `process.chdir` is process-global. If node:test ever runs files concurrently (`--concurrency >1`), a sibling test's CWD assumption breaks mid-flight. Currently safe because node:test runs files in subprocesses, but the pattern is a foot-gun if anyone migrates to `--test-only` or a different runner.

**Fix:** Pass `cwd` via the probe's config / dependency-injection rather than reading `process.cwd()` inside the probe. Then the test sets `cwd` via the injection and never touches `process.chdir`.

---

### IN-03: D-18 banner duplicated across `bin/lib/http.ts` and `references/http-warnings.md`

**File:** [bin/lib/http.ts](bin/lib/http.ts)
**Issue:** The locked banner text is hardcoded in `http.ts` as a string literal AND lives in `references/http-warnings.md`. Drift between them won't trip the D-18 lock test unless that test reads both and compares. Verify `tests/repo-files.test.ts` (or whichever asserts the banner) reads the canonical source rather than re-stating it.

**Fix:** Have `http.ts` import the banner text from a single source (e.g., a generated `.ts` from the .md file at build time), or assert byte equality between the runtime string and the reference file in a dedicated lock test.

---

## Verified Correct (no findings)

- D-09 thin-shim handler statement counts (all `mcp/` handlers ≤30 statements)
- D-10 no `*.createServer` / `new Server({...})` calls in `mcp/**`
- D-12 capabilities resource emits only booleans + presence flags; sentinel test passes; static backstop on `runtime-config-presence.ts` blocks `JSON.stringify(v)` and template interpolation of `value`/`secret`/`token`/`apiKey`/`providerKey`
- Override-merge safety pattern (mcp/** blocks re-list project-wide D-07/D-41 selectors)
- 5 resources + 6 snake_case tools registered as per D-13 LOCKED set
- D-21 prose lock + D-22 3-OS matrix step + D-23 4-layer merge gate + D-24 CONTRIBUTING.md prose lock all present and wired
- Hooks are no-op `process.exit(0)` stubs (correct for Phase 2 scope)
- Three Wave 1 lint chokepoints have both inline-rule smoke tests and full-config AST walks
- Fixture sentinels (`PROCESS-ENV-SENTINEL-DO-NOT-LEAK-...`, `sk-test-LEAK-SENTINEL-12345`) wired into the right asserters
- `paperRoot` threaded from boot via env override into both MCP and CLI surfaces
- `Promise.allSettled` over probes with `Record<probe.id, ProbeResult>` keying (D-20)
- `pathToFileURL(argv[1])` Windows-safe entry-point check in `mcp/server.ts`

---

## Recommendation

CR-01, CR-02, CR-03 are merge-blocking. CR-01 is the most urgent because it will produce confusing-looking CI flakes the moment a macOS runner image refreshes its pandoc preinstall. CR-02 is the most damaging at install time because it makes the Tier-2 (portable CLI) contract — load-bearing for the project — fail invisibly on every user's first `pensmith doctor` invocation outside the repo root. CR-03 is a credential-exfiltration surface that has been carried forward unfixed across two phases and must not slip to Phase 3.

WR-01 through WR-07 are quality issues that should be addressed before the Phase 2 cut-over but are not merge-blocking on their own.

---

_Reviewed: 2026-05-16_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
