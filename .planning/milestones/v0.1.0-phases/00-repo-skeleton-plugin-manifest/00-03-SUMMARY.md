---
phase: 00-repo-skeleton-plugin-manifest
plan: "03"
subsystem: plugin-manifests
tags: [plugin-manifest, mcp-server, marketplace, validator, ci-gate, node-test]
dependency_graph:
  requires:
    - phase: 00-01
      provides: package.json (validate:manifests script, build script), tsconfig.json, mcp/server.ts stub (compile target for dist/mcp/server.js)
    - phase: 00-02
      provides: eslint.config.js (extended with .cjs override)
  provides:
    - .claude-plugin/plugin.json (Tier 1 plugin manifest, D-16)
    - .claude-plugin/marketplace.json (marketplace registration, D-17)
    - .mcp.json (MCP server entry point, D-18)
    - scripts/validate-plugin-manifest.cjs (CI manifest gate, D-17)
    - tests/manifest.test.ts (manifest test suite, 6 tests)
  affects: [00-04, Phase-1, all-later-phases, CI-workflow]
tech_stack:
  added: []
  patterns:
    - Dual-declaration pattern (MCP server in both plugin.json.mcpServers AND .mcp.json per Assumption A3)
    - Structural manifest validation (not JSON-Schema — Anthropic publishes no stable schema artifact)
    - Pitfall D guard (dist/ present -> dist/mcp/server.js must resolve)
    - CommonJS validator (.cjs extension mandatory in ESM package.json type:module)
key_files:
  created:
    - .claude-plugin/plugin.json
    - .claude-plugin/marketplace.json
    - .mcp.json
    - scripts/validate-plugin-manifest.cjs
    - tests/manifest.test.ts
  modified:
    - eslint.config.js (Rule 1 auto-fix: add scripts/**/*.cjs override for @typescript-eslint/no-require-imports)
decisions:
  - "MCP server declared in BOTH plugin.json.mcpServers AND .mcp.json (Assumption A3 — redundant declaration per D-18 + RESEARCH A3)"
  - "Structural assertions used for manifest validation (not JSON-Schema) — Anthropic does not publish a stable JSON-Schema artifact for plugin manifests; structural assertions match gsd-plugin's bin/validate-plugin.cjs approach (D-17 revised cycle 2)"
  - "eslint.config.js extended with scripts/**/*.cjs override disabling @typescript-eslint/no-require-imports — .cjs files in ESM packages intentionally use require(); rule would otherwise block the validator"
metrics:
  duration: ~3 minutes
  completed: "2026-05-07"
  tasks_completed: 2
  files_created: 5
  files_modified: 1
---

# Phase 0 Plan 03: Plugin Manifests + MCP Declaration + CI Validator Summary

**One-liner:** Claude Code Tier 1 plugin manifests (plugin.json, marketplace.json, .mcp.json) with structural CI validator and 6-test node:test suite — all green under npm run check (lint + typecheck + 18/18 tests + validate:manifests).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create plugin.json + marketplace.json + .mcp.json with locked field shapes | 78a2652 | .claude-plugin/plugin.json, .claude-plugin/marketplace.json, .mcp.json |
| 2 | Create scripts/validate-plugin-manifest.cjs + tests/manifest.test.ts | fff8e63 | scripts/validate-plugin-manifest.cjs, tests/manifest.test.ts, eslint.config.js (Rule 1 fix) |

## Files Created

- `.claude-plugin/plugin.json` — Tier 1 plugin manifest (D-16): name=pensmith, version=0.1.0-dev, license=MIT, author.email=akhilachanta8@gmail.com, mcpServers.pensmith with command=node, args=[${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js]
- `.claude-plugin/marketplace.json` — marketplace registration (D-17): name=pensmith, owner.name=Akhil Achanta, plugins[] with name+source+version+author
- `.mcp.json` — MCP server entry (D-18): mirrors plugin.json.mcpServers (dual-declaration per Assumption A3), command=node, args=[${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js]
- `scripts/validate-plugin-manifest.cjs` — CI gate (D-17): structural assertions for all three manifests + Pitfall D guard (dist/ present -> dist/mcp/server.js must exist)
- `tests/manifest.test.ts` — 6-test node:test suite: positive validator exit-0, plugin.json mcpServers shape, .mcp.json mcpServers shape, marketplace.json owner+plugins[], kebab-case+semver, negative validator exit-1 on malformed input

## Files Modified

- `eslint.config.js` — Rule 1 auto-fix: added `scripts/**/*.cjs` override disabling `@typescript-eslint/no-require-imports`. The `.cjs` validator intentionally uses `require()` as CommonJS; tseslint.configs.recommended would otherwise flag it as an error.

## Validator Output

```
$ npm run validate:manifests
✓ plugin.json + marketplace.json + .mcp.json valid
Exit code: 0
```

## npm test Output

```
$ npm test
discovered 3 test files
✔ lint chokepoints flag both fixture violations (39ms)
✔ lint chokepoints do NOT fire on a benign regex like /^11\./ (1ms)
✔ PROJECT eslint.config.js (loaded from disk) flags both fixture violations (707ms)
✔ DOCUMENTED GAP: global fetch() call is NOT flagged by no-restricted-imports (Phase 1 follow-up) (2ms)
✔ scripts/validate-plugin-manifest.cjs exits 0 on valid manifests (38ms)
✔ plugin.json declares mcpServers.pensmith with command=node (0ms)
✔ .mcp.json declares mcpServers.pensmith with command=node (0ms)
✔ marketplace.json owner + plugins[] shape (0ms)
✔ plugin.json kebab-case name + semver version (0ms)
✔ validator FAILS when plugin.json is malformed (negative test) (40ms)
✔ root config files exist (1ms)
✔ package.json contract (0ms)
✔ tsconfig contract (D-03) (0ms)
✔ LICENSE is MIT 2026 Akhil Achanta (0ms)
✔ README, PRIVACY, README-DEV, CONTRIBUTING stubs are correct (0ms)
✔ directory contract from D-21 (0ms)
✔ eslint.config.js declares both chokepoints and does NOT use eslint-plugin-import (0ms)
✔ scripts/run-tests.mjs is the test runner (not a shell glob) (0ms)
tests 18 | pass 18 | fail 0
Exit code: 0
```

## package.json, tsconfig.json, eslint.config.js Verification

```
$ git diff --stat package.json tsconfig.json
(empty — no changes)
```

`package.json` and `tsconfig.json` are byte-identical to Plan 01's outputs. This plan adds five files and makes one targeted fix to `eslint.config.js` (the Rule 1 auto-fix for the `.cjs` exemption). No other existing files were modified.

## npm run build + validate:manifests (Pitfall D guard)

```
$ npm run build && npm run validate:manifests
(tsc compiles mcp/server.ts -> dist/mcp/server.js)
✓ plugin.json + marketplace.json + .mcp.json valid
Exit code: 0
```

The validator's Pitfall D guard sees `dist/mcp/server.js` (compiled from the Phase 0 stub `mcp/server.ts`) and validates cleanly. If `dist/` exists but `dist/mcp/server.js` is missing, the validator exits 1 with an actionable error.

## Reconciliation: gsd-plugin reference shape vs current Claude Code docs (Pitfall A)

Per D-17 (revised cycle 2): Anthropic does not currently publish a stable JSON-Schema artifact for plugin manifests. The structural-assertion approach in `scripts/validate-plugin-manifest.cjs` matches gsd-plugin's `bin/validate-plugin.cjs` (which uses the same loadJson + structural checks pattern). Required fields asserted:

- `plugin.json`: `name` (kebab-case), `version` (semver), `author.name` (when author is object), `mcpServers.*.command`
- `marketplace.json`: `name`, `owner.name`, `plugins[].name`, `plugins[].source`
- `.mcp.json`: `mcpServers`, `mcpServers.*.command`

No fields were added or dropped from the RESEARCH.md template. The `${CLAUDE_PLUGIN_ROOT}` variable in `args` is used as documented in the Claude Code plugin reference for plugin-root-relative paths.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] @typescript-eslint/no-require-imports fires on scripts/validate-plugin-manifest.cjs**
- **Found during:** Task 2 (npm run check after creating the validator)
- **Issue:** `tseslint.configs.recommended` spreads the `@typescript-eslint/no-require-imports` rule, which fired on the `.cjs` validator's `require('fs')` and `require('path')` calls. The plan explicitly requires CommonJS `require()` in the `.cjs` file (the `.cjs` extension is mandatory because `package.json` has `"type": "module"`).
- **Fix:** Added a `{ files: ['scripts/**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } }` override to `eslint.config.js`. This is the minimal targeted fix — it only affects `.cjs` files in `scripts/`, not any TypeScript source.
- **Files modified:** `eslint.config.js`
- **Verification:** `npm run lint` exits 0; `npm run check` exits 0; all 18 tests pass
- **Committed in:** `fff8e63` (Task 2 commit, alongside the validator and test file)

## Known Stubs

None added by this plan. The manifests reference `dist/mcp/server.js` which is produced by compiling the Phase 0 MCP server stub (`mcp/server.ts`) from Plan 01. The stub is tracked as a Known Stub in Plan 01's SUMMARY.md.

## Threat Flags

None — this plan adds only manifest files, a validator script, and tests. No network endpoints, auth paths, file access patterns, or schema changes at trust boundaries.

## Self-Check: PASSED

Files verified:
- .claude-plugin/plugin.json: FOUND (name=pensmith, version=0.1.0-dev, license=MIT, akhilachanta8@gmail.com, command=node, dist/mcp/server.js, CLAUDE_PLUGIN_ROOT)
- .claude-plugin/marketplace.json: FOUND (name=pensmith, owner.name=Akhil Achanta, plugins[] with name+source)
- .mcp.json: FOUND (mcpServers.pensmith, command=node, dist/mcp/server.js, CLAUDE_PLUGIN_ROOT)
- scripts/validate-plugin-manifest.cjs: FOUND (loadJson, marketplace.plugins, mcpServers, dist/mcp/server.js, kebab-case regex)
- tests/manifest.test.ts: FOUND (6 test blocks covering all acceptance criteria)
- eslint.config.js: FOUND (scripts/**/*.cjs override, @typescript-eslint/no-require-imports: off)

Commits verified:
- 78a2652: FOUND (Task 1 — three manifest files)
- fff8e63: FOUND (Task 2 — validator + tests + lint fix)
