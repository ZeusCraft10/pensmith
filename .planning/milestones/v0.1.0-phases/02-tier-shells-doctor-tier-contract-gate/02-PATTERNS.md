---
phase: 02 — Tier shells + doctor + tier-contract gate
mapped: 2026-05-15
status: complete
analog-source: pensmith repo HEAD (Phase 0 + Phase 1 already shipped)
files-analyzed: 34 new files + 7 modified files
analogs-found: 31 / 34 new files have a strong in-repo analog
no-analog: 3 (mcp/server.ts, hooks/*.ts, references/doctor-output.md — cite RESEARCH.md skeletons)
---

> **NOTE (2026-05-16 revision):** Requirement IDs in the parenthetical annotations below (e.g., `TIER-01`, `TIER-05`, `TIER-06`) reflect the pre-renumbering REQUIREMENTS.md numbering. REQUIREMENTS.md has since been authoritatively reordered (TIER-01 = MCP resources, TIER-04 = citty dispatcher, TIER-05 = `@clack/prompts` numbered fallback, TIER-06 = tier-contract merge gate, DOCT-05 deferred, DOCT-07 added). The closest-analog mapping is unchanged — read the parentheticals as historical labels. The authoritative per-requirement verification map is **`02-VALIDATION.md § Per-Requirement Verification Map`**.

## Overview

Phase 2 composes Phase 1 primitives (paths.ts, runtime.ts, http.ts, retry.ts, atomic-write.ts) and the Phase 0 AST-walk lint-test pattern into two tier shells (MCP server + citty CLI) plus a tier-contract gate. The vast majority of Phase 2's new files have a strong in-repo analog: the three new AST-walk lint tests (D-09 / D-10 / D-12) model directly on the three existing `tests/lint-*-chokepoint.test.ts` files; the doctor probe sub-functions reuse `isInsideSyncFolder()` and `loadRuntimeConfig()` verbatim; the `tests/repo-files.test.ts` extension and `scripts/validate-plugin-manifest.cjs` extension are surgical adds to existing scaffolding. The genuinely-novel pieces are mcp/server.ts itself (no MCP server existed before Phase 2 — the stub is one line), the hooks/ scaffolding (Phase 2 is the first to populate the directory), and references/doctor-output.md (a new locked-copy file; its sibling references/http-warnings.md gives the format). For those three, the planner cites RESEARCH.md §Pattern 1, §Pattern 6, and §Pattern 3 respectively.

## New Files → Analogs

| New file | Role | Closest analog | Analog path | What changes |
|----------|------|----------------|-------------|--------------|
| `bin/lib/retry.ts` (parseRetryAfter extraction) | chokepoint shim — pure helper | existing `bin/lib/retry.ts` (already has `retry()` + `fullJitterDelayMs()`) | `bin/lib/retry.ts` | ADD `parseRetryAfter(headerValue, now): number` next to `fullJitterDelayMs` — same shape: pure, deterministic, no I/O, throws on invalid input. http.ts imports and inlines on 429/503 path |
| `bin/cli/pensmith.ts` | CLI entry — citty dispatcher | none in repo; `scripts/run-tests.mjs` (CLI entry shape) + `bin/lib/http.ts` (module header style) | `scripts/run-tests.mjs` (header), `bin/lib/http.ts` (typed imports) | Use citty `defineCommand`+`subCommands`+`runMain` pattern from RESEARCH.md §Pattern 2; copy module-header rationale-comment style from http.ts |
| `bin/cli/doctor.ts` | CLI verb body — deterministic | `bin/lib/runtime.ts` `loadRuntimeConfig` (pure async + scope dispatch + log) | `bin/lib/runtime.ts` lines 283-314 | Replace `loadAndMigrate` calls with 6 probe-fn calls; same `Promise<Result>` shape; **NEVER** call atomicWriteFile / withLock (D-19 read-only) |
| `bin/lib/doctor/probes.ts` | service — pure functions | `bin/lib/paths.ts` `isInsideSyncFolder` (pure, regex-list driven) + `bin/lib/runtime.ts` `getOpenAlexApiKey` (env-name → presence) | `bin/lib/paths.ts` 147-168, `bin/lib/runtime.ts` 438-462 | One probe per DOCT-01..06; `Severity` enum from RESEARCH.md §Pattern 3; reuse `isInsideSyncFolder()` for DOCT-04, mirror `getOpenAlexApiKey`'s no-leak pattern for DOCT-06 |
| `bin/lib/doctor/run.ts` | orchestrator | none direct; closest is `bin/lib/runtime.ts` `mergeOverlay`+`loadRuntimeConfig` (composes sub-loads → Record) | `bin/lib/runtime.ts` 238-313 | Sequential `await` of 6 probes; assemble into `Object.fromEntries(results.map(r => [r.id, r]))` per D-20 |
| `mcp/server.ts` | MCP entry — thin shim | **NO IN-REPO ANALOG** (Phase 0 stub is 1 line `export {}`) | — | Cite RESEARCH.md §Pattern 1 verbatim (lines 256-322 of RESEARCH); each handler delegates to ONE `bin/lib/*` call |
| `mcp/resources/*.ts` (4 files) | MCP resource handlers — thin shims | `bin/lib/runtime.ts::getOpenAlexApiKey` no-leak shape (for capabilities) + `bin/lib/state.ts::loadState` (for state) | `bin/lib/runtime.ts` 438-462, `bin/lib/state.ts` ~loadState | Each handler ≤30 statements; `paper://capabilities` follows the `present:boolean` + `envName:string` no-leak pattern from runtime.ts |
| `mcp/tools/*.ts` (4 files) | MCP tool handlers — thin shims | `bin/lib/runtime.ts::saveRuntimeConfig` (delegation through one `bin/lib/*` call) | `bin/lib/runtime.ts` 336-365 | ≤30 statements each; zod input schema in `inputSchema: { field: z.string() }` object form (NOT `z.object(...)` — Pitfall 2); single `bin/lib/*` call; no fs/http imports (lint-enforced D-09) |
| `hooks/session-start.ts` | hook scaffold — no-op | **NO IN-REPO ANALOG** (Phase 2 is first to populate hooks/) | — | TIER-07 says no-op exit 0; copy minimal shebang+console.error-only shape per Pitfall 7 (no console.log → corrupts MCP if cross-wired) |
| `hooks/pre-compact.ts` | hook scaffold — no-op | (see above) | — | Same no-op exit 0 |
| `hooks/post-tool-use.ts` | hook scaffold — no-op | (see above) | — | Same no-op exit 0 |
| `workflows/doctor.md` | workflow body — markdown shared | **NO IN-REPO ANALOG** (workflows/ is empty) | — | Cite RESEARCH.md §Pattern 6 — `<capability_check>` block; D-14 says Phase 2 doctor.md is deterministic (no branching), but the `<capability_check>` shell is present |
| `workflows/*.md` (16 stubs) | workflow body — stub | (see above) | — | Each is `# /pensmith <verb>` + 1-line "not implemented (phase: N)" — pattern model after stub() function in RESEARCH.md §Pattern 2 |
| `references/doctor-output.md` | docs — locked copy | `references/http-warnings.md` (locked-blockquote pattern read by `bin/lib/http.ts` at runtime) | `references/http-warnings.md` | Same `## Section title\n\n> locked string\n\n` shape; read by `bin/cli/doctor.ts` for TTY copy; tests/repo-files.test.ts asserts presence + hash-pin |
| `tests/retry.test.ts` (parseRetryAfter cases moved in) | test — pure unit | existing `tests/retry.test.ts` (already has fullJitterDelayMs tests + cassette integration) | `tests/retry.test.ts` 1-100 | ADD `parseRetryAfter` test block alongside existing `fullJitterDelayMs` block; move cases out of `tests/http.test.ts` |
| `tests/lint-thin-shim.test.ts` (D-09) | test — AST-walk chokepoint | `tests/lint-paths-chokepoint.test.ts` (4-selector inline + PROJECT-config-loaded variant) | `tests/lint-paths-chokepoint.test.ts` | Selector shape: `CallExpression[callee.property.name='registerTool'] > ArrowFunctionExpression`; count `body.body.length` ≤ 30; PLUS scan for `ImportDeclaration[source.value=/^(node:)?(fs|fs\/promises|http\|https\|undici)$/]` in mcp/**/*.ts |
| `tests/lint-mcp-no-network.test.ts` (D-10) | test — AST-walk chokepoint | `tests/lint-atomic-write-chokepoint.test.ts` (single-selector CallExpression match + PROJECT-config-loaded variant) | `tests/lint-atomic-write-chokepoint.test.ts` | Selector shape: `CallExpression[callee.object.name='net'][callee.property.name='createServer']` (× 3 for net/http/tls) + `NewExpression[callee.name='Server']`; inline test + project-config-loaded test, both run against `tests/fixtures/lint-mcp-no-network-fixture.ts` |
| `tests/lint-capabilities-noleak.test.ts` (D-12) | test — AST-walk chokepoint | `tests/lint-paths-chokepoint.test.ts` (process.env MemberExpression pattern) | `tests/lint-paths-chokepoint.test.ts` 44-58 | Selector: `MemberExpression[object.object.name='process'][object.property.name='env'][computed=true]` (catches `process.env[var]` with computed key — D-12 Pitfall 6) + `CallExpression[callee.name=/^(getProviderApiKey\|getOpenAlexApiKey)$/]`; scope walker to the `paper-capabilities` registerResource handler body only |
| `tests/fixtures/lint-thin-shim-fixture.ts` | test fixture — red-team | `tests/fixtures/lint-atomic-write-chokepoint-fixture.ts` | `tests/fixtures/lint-atomic-write-chokepoint-fixture.ts` | INTENTIONALLY violates D-09: 31-statement handler + `import fs from 'node:fs'` inside mcp/-style file; `@ts-nocheck` header; `_redTeam` export to defeat tree-shaking |
| `tests/fixtures/lint-mcp-no-network-fixture.ts` | test fixture — red-team | `tests/fixtures/lint-atomic-write-chokepoint-fixture.ts` | (see above) | INTENTIONALLY violates D-10: calls `net.createServer()`, `http.createServer()`, `tls.createServer()`, `new Server()`. Add to eslint.config.js global-ignores list (alongside the existing 3 fixtures) |
| `tests/fixtures/lint-capabilities-noleak-fixture.ts` | test fixture — red-team | `tests/fixtures/lint-paths-chokepoint-fixture.ts` (process.env access pattern) | `tests/fixtures/lint-paths-chokepoint-fixture.ts` | INTENTIONALLY violates D-12: registers a capabilities handler that writes `apiKeyValue: process.env[provider.apiKeyEnv]` + calls `getProviderApiKey()` inline |
| `tests/cli-verbs.test.ts` (TIER-01) | test — preflight unit | `tests/repo-files.test.ts` (directory contract + filesystem assertions) | `tests/repo-files.test.ts` 87-95 | Glob `workflows/*.md`, derive verb-slug from each filename, assert each appears as a key in the citty `subCommands` map (load `bin/cli/pensmith.ts` exports or run `node dist/bin/pensmith.js --help` and parse) |
| `tests/cli-stubs.test.ts` (TIER-02) | test — smoke (execFileSync) | `tests/repo-files.test.ts` (smoke shape) + cassette helper from `tests/retry.test.ts` | `tests/retry.test.ts` 33-67 | `execFileSync('node', ['dist/bin/pensmith.js', verb])` for each stub verb; assert exit 0 + stdout contains "not implemented yet"; depends on Wave-X `npm run build` |
| `tests/doctor-exit-code.test.ts` (TIER-03) | test — unit (mock probe) | `tests/runtime.test.ts` (env-var override + ProbeReport-like Record assertions) | `bin/lib/runtime.ts` 283-314 patterns | Stub a probe to return `severity:'FAIL'`; run `runDoctor()`; assert the wrapped citty `run()` callback would call `process.exit(1)` (mock it) |
| `tests/doctor-shape.test.ts` (TIER-04) | test — unit (zod shape) | `tests/schemas.test.ts` (zod schema validation patterns) — existing in repo | `tests/schemas.test.ts` | Call `runDoctor()`, assert Record keys are subset of DOCTOR_PROBE_IDS, each value has `{id, severity, summary, detail?, fix?}` shape, severity ∈ enum |
| `tests/doctor-probes.test.ts` (DOCT-01..06) | test — 6 sub-cases | `tests/runtime.test.ts` (env-var override + `mkdtemp` per-test tmpdir + restore) + `tests/retry.test.ts::withFreshState` | `tests/retry.test.ts` 68-95 (withFreshState shape) | Each sub-test: save env vars → mutate → call probe → assert severity/summary → restore. DOCT-04 uses `tmpdir/OneDrive/paper` to hit the regex. DOCT-06 toggles `process.env.ANTHROPIC_API_KEY` |
| `tests/mcp-tool-handlers.test.ts` (TIER-06) | test — in-process McpServer | none direct; closest is `tests/state.test.ts` (in-process bin/lib call with zod assertion) | `bin/lib/state.ts` ~loadState patterns | Instantiate McpServer via `new McpServer(...)` in-process; call a tool with malformed input; assert zod validation error in response |
| `tests/tier-contract.test.ts` (TIER-05) | integration — spawn dist/ | none direct; closest is `tests/retry.test.ts` (MockAgent + cassette integration over real dispatch) | `tests/retry.test.ts` 33-95 (env override + cleanup) | Use `@modelcontextprotocol/sdk/client/index.js` + `StdioClientTransport` per RESEARCH.md Pitfall 9 (lines 653-667); spawn `node dist/mcp/server.js` AND `node dist/bin/pensmith.js doctor --json`; deep-compare probe Records keyed by id (D-20) |
| `tests/fixtures/red-team-thin-shim/`, etc. | test fixture dirs | `tests/fixtures/http-cassettes/` (sub-dir of fixtures used by tests) | `tests/fixtures/` (existing layout) | If multi-file fixtures needed; otherwise single-file fixtures (preferred — same as existing 3 chokepoint fixtures) |
| `tests/lib/normalize-probe-report.ts` (D-20) | test helper — single shared normalizer | none direct; closest is `bin/lib/pii.ts` (string-transformation helper used by tests) | `bin/lib/pii.ts` shape | Pure function `normalize(report, env): NormalizedReport`; each rule carries `// why intrinsically variable` comment (D-21); ordered: placeholder-substitute THEN path-separator swap THEN sorted-keys-stringify |

## Modified Files → Section to Replicate

| File | What to add | Reference / section to model on |
|------|-------------|--------------------------------|
| `package.json` | (1) dependency `"citty": "^0.2.2"` (2) `"scripts.test:tier-contract": "node scripts/run-tests.mjs tests/tier-contract.test.ts"` (3) update `"check"` chain to include build + test:tier-contract before test | Existing `scripts.check` line 17 (`npm run lint && npm run typecheck && npm run test && npm run validate:manifests`). New order: lint → typecheck → build → test:tier-contract → test → validate:manifests (per RESEARCH §Pitfall 3) |
| `eslint.config.js` | (1) 3 new `no-restricted-syntax` selector rules scoped to `mcp/**/*.ts` (thin-shim, no-network, capabilities-noleak) (2) 3 new fixture entries in the global-ignores block | Existing 4 selectors at lines 60-85; existing global-ignores at lines 161-169 (add `lint-thin-shim-fixture.ts`, `lint-mcp-no-network-fixture.ts`, `lint-capabilities-noleak-fixture.ts` to the `ignores` array) |
| `tests/repo-files.test.ts` | (1) assert `references/doctor-output.md`, `workflows/`, `hooks/session-start.ts`, `hooks/pre-compact.ts`, `hooks/post-tool-use.ts` exist (2) assert `CONTRIBUTING.md` contains `Tier contract — do not skip` heading (D-24) (3) assert package.json has `citty` dep + `test:tier-contract` script | Existing assertions at lines 14-31 (file existence loop), lines 87-95 (directory contract loop), lines 75-85 (CONTRIBUTING.md match) |
| `scripts/validate-plugin-manifest.cjs` | Assert `hooks/` directory exists and contains `session-start.ts`, `pre-compact.ts`, `post-tool-use.ts` | Existing dist/mcp/server.js check at lines 67-73 (same `fs.existsSync` + `fail()` pattern) |
| `.github/workflows/ci.yml` | Insert `- run: npm run test:tier-contract` AFTER the `Build` step and BEFORE the `npm test` step | Existing `Build` step at lines 38-39 — same `name:` + `run:` shape; ordering per RESEARCH §Pitfall 3 |
| `bin/lib/http.ts` | Replace inline 429/503 Retry-After parsing with `import { parseRetryAfter } from './retry.js'` + call site; keep behavior identical | Existing `retry()` call at lines 443-469 — same delegation idiom (one function call, no inline branching) |
| `CONTRIBUTING.md` | Add `## Tier contract — do not skip` section (D-21 + D-24 LOCKED prose); update `## Quick checklist` to mention `npm run test:tier-contract` | Existing `## Architectural chokepoints (Phase 0+)` heading and quick-checklist at lines 5-19 — same hash-section shape, locked tone |
| `.claude-plugin/plugin.json` | (Phase 2 reads but does not modify — entry already references `dist/mcp/server.js`) | No change |
| `.mcp.json` | (Phase 2 reads but does not modify) | No change |

## Code Excerpts

### Excerpt 1 — AST-walk chokepoint lint test (model for D-09 / D-10 / D-12)

**Source:** `tests/lint-paths-chokepoint.test.ts` lines 30-74 (inline) + 79-104 (PROJECT-config-loaded)

```typescript
test('paths chokepoint flags all 4 fixture violations (inline rule)', async () => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.ts'],
      languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
      rules: {
        'no-restricted-syntax': ['error',
          { selector: "MemberExpression[object.name='os'][property.name='homedir']",
            message: 'paths chokepoint' },
          { selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='LOCALAPPDATA']",
            message: 'paths chokepoint' },
          // ... 2 more
        ],
      },
    }],
  });
  const fixture = path.resolve('tests/fixtures/lint-paths-chokepoint-fixture.ts');
  const results = await eslint.lintFiles([fixture]);
  const restrictedSyntaxCount = (results[0]?.messages ?? []).filter(
    (m) => m.ruleId === 'no-restricted-syntax').length;
  assert.ok(restrictedSyntaxCount >= 4, `expected >=4; got ${restrictedSyntaxCount}`);
});
```

**Commentary:** Each of the 3 new lint tests (D-09 / D-10 / D-12) follows this shape exactly — inline-rule smoke test PLUS a PROJECT-config-loaded test that strips `ignores`-only entries (Pitfall B5 mitigation). The selector strings change per rule; the structural skeleton is identical. The "PROJECT" variant catches typos in `eslint.config.js` that the inline test cannot.

---

### Excerpt 2 — Red-team fixture (model for `tests/fixtures/lint-{thin-shim,mcp-no-network,capabilities-noleak}-fixture.ts`)

**Source:** `tests/fixtures/lint-paths-chokepoint-fixture.ts` lines 1-26

```typescript
// Red-team fixture for the D-41 paths chokepoint (Phase 1).
// This file INTENTIONALLY violates the chokepoint by calling os.homedir()
// and reading process.env.LOCALAPPDATA / process.env.XDG_DATA_HOME directly.
// It is ignored by the project ESLint config (eslint.config.js global-ignores)
// so `npm run lint` over the repo passes. The chokepoint regression test at
// tests/lint-paths-chokepoint.test.ts runs ESLint programmatically against
// THIS file and asserts the rule fires.
//
// @ts-nocheck — this file is never type-checked or executed.

import os from 'node:os';

const home = os.homedir();                          // === D-41 violation ===
const localAppData = process.env.LOCALAPPDATA;       // === D-41 violation ===
const xdgData = process.env.XDG_DATA_HOME;           // === D-41 violation ===

export const _redTeam = { home, localAppData, xdgData };
```

**Commentary:** Three things to copy in each new fixture: (1) `@ts-nocheck` header comment + skip-tree-shake `_redTeam` export, (2) explicit `=== Dxx violation ===` comment markers above each bad line so the fixture self-documents, (3) the planner must remember to add the fixture to `eslint.config.js`'s global-ignores array (currently lines 161-169) — otherwise `npm run lint` over the repo flags it.

---

### Excerpt 3 — Pure-helper module shape (model for `bin/lib/retry.ts::parseRetryAfter`)

**Source:** `bin/lib/retry.ts` lines 74-94 (`fullJitterDelayMs`)

```typescript
/**
 * Compute the AWS full-jitter delay for the given 1-based `attempt` number ...
 * Guarantees:
 *   - returned value is a non-negative integer
 *   - returned value <= min(capMs, baseMs * 2^(attempt-1))
 *   - exposed for tests to assert the math directly
 */
export function fullJitterDelayMs(attempt: number, baseMs: number, capMs: number): number {
  if (attempt < 1) {
    throw new Error(`fullJitterDelayMs: attempt must be >= 1; got ${attempt}`);
  }
  if (baseMs < 0 || capMs < 0) {
    throw new Error(`fullJitterDelayMs: baseMs and capMs must be >= 0`);
  }
  const exponent = Math.min(attempt - 1, 30);
  const expBackoff = baseMs * Math.pow(2, exponent);
  const upper = Math.min(capMs, expBackoff);
  if (upper <= 0) return 0;
  return Math.floor(Math.random() * (upper + 1));
}
```

**Commentary:** `parseRetryAfter(headerValue, now): number` (D-01) lands in the SAME file, immediately below `fullJitterDelayMs`, with the SAME shape: JSDoc block stating guarantees, pure (no I/O, no env reads), throws on invalid input, exposed for tests. Both Retry-After delta-seconds and HTTP-date forms must be handled (RFC 7231 §7.1.3); X-Rate-Limit-Reset (Unix epoch) gets the same treatment. Tests move from `tests/http.test.ts` to existing `tests/retry.test.ts` (alongside `fullJitterDelayMs` cases at lines 97+).

---

### Excerpt 4 — No-leak shape (model for `paper://capabilities` resource handler + DOCT-06 probe)

**Source:** `bin/lib/runtime.ts` lines 438-462 (`getOpenAlexApiKey`)

```typescript
export async function getOpenAlexApiKey(
  opts: { scope?: LoadScope; paperRoot?: string } = {},
): Promise<string | undefined> {
  const cfg = await loadRuntimeConfig(opts);
  const envName = cfg.openalexApiKeyEnv ?? 'OPENALEX_API_KEY';
  const optional = cfg.openalexApiKeyOptional ?? true;
  const resolved = process.env[envName];
  const present = !!(resolved && resolved.length > 0);

  // NEVER log the resolved string — only the env-var name + presence boolean.
  // T-01-07. The pre-computed `present` boolean is what's logged; the resolved
  // value lives only in the local variable until it's returned to the caller.
  log().event({ event: 'runtime.openalex', envName, optional, present });

  if (present) return resolved;
  if (optional) return undefined;
  throw new MissingApiKeyError(...);
}
```

**Commentary:** This is the EXACT shape the `paper://capabilities` MCP resource handler must mirror per D-12, with one twist: the capabilities handler MUST NOT return `resolved` (the actual value) — only `present:boolean` and `envName:string` (env-var NAME). DOCT-06 (runtime-config-presence probe) does the same: iterate `cfg.providers`, build `{ name, apiKeyEnv, present: process.env[apiKeyEnv] !== undefined }`. The `process.env[envName]` MemberExpression is allowed because the key is a literal-bound variable, NOT a computed expression with the value escaping — the lint rule D-12 catches the *value* path, not the *presence-check* path. Red-team fixture must violate this distinction.

---

### Excerpt 5 — Locked-copy reference file (model for `references/doctor-output.md`)

**Source:** `references/http-warnings.md` lines 1-15

```markdown
# HTTP Warning Strings (locked — D-24)

This file is the SINGLE source of truth for HTTP-client user-facing warning
prose. `bin/lib/http.ts` reads these strings at module load. Phase 2's
`/pensmith doctor` (DOCT-03) reuses the SAME strings verbatim. Drift between
the two is a lint failure.

## PENSMITH_CONTACT_EMAIL not set

> pensmith: PENSMITH_CONTACT_EMAIL is not set. Using no-contact User-Agent. Some APIs (Crossref polite pool, OpenAlex) may rate-limit more aggressively. Set PENSMITH_CONTACT_EMAIL to your email address in your shell profile. See https://github.com/akhilachanta/pensmith#configuration

(One blockquote line above is the literal string. The leading `> ` is markdown
syntax — `bin/lib/http.ts` strips it on read. Do NOT edit the wording without
also updating any tests that match against it.)
```

**Commentary:** `references/doctor-output.md` follows the SAME shape: top-of-file `# Locked` heading + rationale paragraph, then `## <Section>` per locked string, then a `> ` blockquote with the literal, then a parenthetical reader-warning. `bin/cli/doctor.ts` reads it the same way `bin/lib/http.ts` line 78-103 does (synchronous `readFileSync` at module load, regex-walks for the section heading + first `> ` line). Hash-pin asserted in `tests/repo-files.test.ts` extension (or md5/sha checksum compared).

---

### Excerpt 6 — Test isolation pattern (model for `tests/doctor-probes.test.ts`)

**Source:** `tests/retry.test.ts` lines 68-95 (`withFreshState`)

```typescript
async function withFreshState<T>(fn: () => Promise<T>): Promise<T> {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'pensmith-retry-'));
  const savedLad = process.env.LOCALAPPDATA;
  const savedXdg = process.env.XDG_DATA_HOME;
  const savedHome = process.env.HOME;
  const savedEmail = process.env.PENSMITH_CONTACT_EMAIL;
  process.env.LOCALAPPDATA = tmpRoot;
  process.env.XDG_DATA_HOME = tmpRoot;
  process.env.HOME = tmpRoot;
  process.env.PENSMITH_CONTACT_EMAIL = 'test@example.org';
  _resetWarnedForTest();
  _resetBucketsForTest();
  try {
    return await fn();
  } finally {
    if (savedLad === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = savedLad;
    // ... restore each var, then rm -rf tmpRoot
    await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}
```

**Commentary:** Every probe test (DOCT-01..06) follows this exact `save → mutate → call → restore → cleanup` shape. DOCT-04 (sync-folder) creates `tmpRoot/OneDrive/paper/` and asserts WARN. DOCT-03 (contact-email) sets `PENSMITH_CONTACT_EMAIL` to a known value vs. unset and asserts severity flips. DOCT-06 (runtime-config) sets/unsets `process.env.ANTHROPIC_API_KEY` and asserts present-flag. The pattern requires the eslint.config.js paths-chokepoint exemption for tests that override `LOCALAPPDATA` / `XDG_DATA_HOME` (existing exemption block at eslint.config.js lines 145-155 — add `tests/doctor-probes.test.ts` to that list).

---

### Excerpt 7 — Manifest-validator extension shape (model for hooks/ assertion)

**Source:** `scripts/validate-plugin-manifest.cjs` lines 67-73 (dist/mcp/server.js check)

```javascript
// Pitfall D: if dist/ exists, dist/mcp/server.js MUST resolve.
// This catches CI flows where `npm run build` was meant to run before us.
const distDir = path.join(root, 'dist');
if (fs.existsSync(distDir)) {
  const built = path.join(distDir, 'mcp', 'server.js');
  if (!fs.existsSync(built)) fail(`dist/ exists but ${built} is missing — run \`npm run build\``);
}
```

**Commentary:** Phase 2 adds an analogous block: `const hooksDir = path.join(root, 'hooks'); if (!fs.existsSync(hooksDir)) fail('hooks/ directory required (TIER-07)'); else for (const h of ['session-start.ts', 'pre-compact.ts', 'post-tool-use.ts']) if (!fs.existsSync(path.join(hooksDir, h))) fail(\`hooks/${h} required\`);`. Same `fail()` accumulator + `process.exitCode = 1` pattern; no exit-on-first-failure (collects all failures for a useful CI log).

---

### Excerpt 8 — repo-files.test.ts extension shape

**Source:** `tests/repo-files.test.ts` lines 14-31 (existence loop) + lines 75-85 (content matching)

```typescript
test('root config files exist', () => {
  for (const f of [
    'package.json', 'tsconfig.json', '.gitignore', '.gitattributes',
    'LICENSE', 'README.md', 'PRIVACY.md', 'README-DEV.md', 'CONTRIBUTING.md',
    'eslint.config.js', 'mcp/server.ts', 'scripts/run-tests.mjs',
  ]) {
    assert.ok(fs.existsSync(path.resolve(f)), `missing required file: ${f}`);
  }
});

test('README, PRIVACY, README-DEV, CONTRIBUTING stubs are correct', () => {
  // ...
  const c = read('CONTRIBUTING.md');
  assert.match(c, /bin\/lib\/http\.ts/);
  assert.match(c, /bin\/lib\/doi\.ts/);
});
```

**Commentary:** Phase 2 adds two new files to the existence loop (`references/doctor-output.md`, `hooks/session-start.ts`, etc.) plus a new `test('CONTRIBUTING.md has Tier contract section (D-24)', () => assert.match(read('CONTRIBUTING.md'), /Tier contract — do not skip/))`. Hash-pin for `references/doctor-output.md` follows the existing matching style (`assert.match` with a literal substring from the locked blockquote) — same idiom as the existing CONTRIBUTING.md check.

---

### Excerpt 9 — citty CLI dispatcher (NEW — RESEARCH skeleton, no in-repo analog)

**Source:** RESEARCH.md §Pattern 2, lines 342-398 (verified against citty@0.2.2 README)

```typescript
import { defineCommand, runMain } from 'citty';
import { runDoctor } from './doctor.js';

const stub = (verb: string) => defineCommand({
  meta: { name: verb, description: `${verb} (not implemented yet)` },
  run() { console.log(`pensmith ${verb}: not implemented yet`); },
});

const doctor = defineCommand({
  meta: { name: 'doctor', description: 'Run environment probes ...' },
  args: { json: { type: 'boolean', description: 'Output machine-readable JSON' } },
  async run({ args }) {
    const probes = await runDoctor();
    if (args.json) { console.log(JSON.stringify(probes, null, 2)); }
    else { renderDoctorPretty(probes); }
    const failed = Object.values(probes).some(p => p.severity === 'FAIL');
    if (failed) process.exit(1);
  },
});

const main = defineCommand({
  meta: { name: 'pensmith', version: '0.1.0-dev', description: 'Pensmith CLI (Tier 2)' },
  subCommands: { doctor, init: stub('init'), intake: stub('intake'), /* ... 14 more */ },
});

runMain(main);
```

**Commentary:** No pre-existing CLI dispatcher in the pensmith repo — this is the only Phase 2 file the planner cites from RESEARCH.md directly (vs. an in-repo analog). Adopt the `stub()` factory pattern to keep verb stubs to one line each (TIER-02). Pitfall 8 mitigation: declare `default: false` on the `--json` arg explicitly so `if (args.json === false)` works.

---

### Excerpt 10 — MCP server skeleton (NEW — RESEARCH skeleton, no in-repo analog)

**Source:** RESEARCH.md §Pattern 1, lines 256-322 (verified against @modelcontextprotocol/sdk@v1.29.0 source)

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readState, updateState } from '../bin/lib/state.js';
import { loadRuntimeConfig } from '../bin/lib/runtime.js';

const server = new McpServer(
  { name: 'pensmith', version: '0.1.0-dev' },
  { capabilities: { resources: {}, tools: {} } }
);

server.registerResource(
  'paper-capabilities', 'paper://capabilities',
  { title: 'Pensmith Capabilities', mimeType: 'application/json' },
  async () => {
    // D-12: presence flags ONLY. No process.env[anything] reads here.
    const cfg = await loadRuntimeConfig();
    const providers = cfg.providers.map(p => ({
      name: p.name,
      apiKeyEnv: p.apiKeyEnv,                                  // env-var NAME
      apiKeyPresent: process.env[p.apiKeyEnv] !== undefined,   // boolean
    }));
    return { contents: [{ uri: 'paper://capabilities', text: JSON.stringify({ providers }) }] };
  }
);

server.registerTool(
  'state.update',
  { title: 'Update paper state',
    description: 'Patch fields ...',
    inputSchema: { patch: z.record(z.string(), z.unknown()) } },  // Pitfall 2: NOT z.object(...)
  async ({ patch }) => {
    const result = await updateState(patch);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Commentary:** Three things to copy verbatim per RESEARCH.md: (1) imports from `@modelcontextprotocol/sdk/server/...` subpaths NOT `@modelcontextprotocol/server` (Pitfall 1), (2) `inputSchema` is a plain object of zod schemas NOT `z.object(...)` (Pitfall 2), (3) NEVER `console.log` in any handler — corrupts the stdio protocol stream (Pitfall 7); use `console.error` if debugging needed. The thin-shim invariant (D-09) means each handler body is the literal 2-3 lines shown — anything more goes in `bin/lib/*`.

## Files With No Analog

Three new Phase 2 files have NO suitable in-repo analog; the planner cites RESEARCH.md instead:

| File | Why no analog | RESEARCH.md section to cite |
|------|---------------|---------------------------|
| `mcp/server.ts` (first MCP server) | The repo's current `mcp/server.ts` is a 1-line stub (`export {};`). No MCP server pattern exists yet in pensmith | RESEARCH.md §Pattern 1 (lines 256-322) — full skeleton verified against @modelcontextprotocol/sdk@1.29.0 |
| `hooks/session-start.ts`, `hooks/pre-compact.ts`, `hooks/post-tool-use.ts` | `hooks/` directory is empty in Phase 0; Phase 2 is the first phase to populate it | RESEARCH.md §Architectural Responsibility Map "Plugin lifecycle hooks" row (line 116) + §Recommended Project Structure (lines 227-230) — "no-op exit-0" specified |
| `bin/cli/pensmith.ts` (citty dispatcher) | No CLI dispatcher exists in the repo (Phase 1 was foundation libs only); `scripts/run-tests.mjs` is a different pattern (procedural mjs, not citty defineCommand) | RESEARCH.md §Pattern 2 (lines 333-398) — full citty skeleton with stub-factory + doctor verb |

For these three, the planner instructs the executor to: (a) cite the RESEARCH.md section in the file header comment (per pensmith convention of in-file rationale comments), (b) mirror the header-comment-style convention of `bin/lib/http.ts` lines 1-49 even though the body content is novel, (c) keep imports normalized to existing pensmith conventions (`./paths.js` not `./paths.ts` — verbatimModuleSyntax requires `.js` extensions even on `.ts` source files; see existing `bin/lib/runtime.ts` line 82-91).

## PATTERN MAPPING COMPLETE
