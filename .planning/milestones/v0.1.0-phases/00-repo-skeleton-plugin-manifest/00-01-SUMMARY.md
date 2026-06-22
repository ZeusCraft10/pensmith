---
phase: 00-repo-skeleton-plugin-manifest
plan: "01"
subsystem: repo-skeleton
tags: [scaffolding, typescript, esm, package-json, tsconfig, gitignore, license, mcp-stub, test-runner]
dependency_graph:
  requires: []
  provides: [package.json, tsconfig.json, node_modules, scripts/run-tests.mjs, mcp/server.ts, directory-contract]
  affects: [00-02, 00-03, 00-04, all-later-phases]
tech_stack:
  added:
    - typescript@5.9.3
    - tsx@4.21.0
    - "@types/node@20.19.39"
    - eslint@9.39.4
    - typescript-eslint@8.59.2
  patterns:
    - ESM package (type:module) with NodeNext module resolution
    - Portable cross-platform test discoverer (scripts/run-tests.mjs) replacing shell glob
    - Phase-stub pattern for mcp/server.ts (export {} satisfies verbatimModuleSyntax)
key_files:
  created:
    - package.json
    - tsconfig.json
    - .gitignore
    - .gitattributes
    - LICENSE
    - scripts/run-tests.mjs
    - package-lock.json
    - bin/.gitkeep
    - bin/lib/.gitkeep
    - bin/lib/migrations/README.md
    - mcp/server.ts
    - hooks/.gitkeep
    - skills/.gitkeep
    - agents/.gitkeep
    - workflows/.gitkeep
    - templates/.gitkeep
    - templates/citation-styles/.gitkeep
    - references/.gitkeep
    - schema/.gitkeep
    - tests/.gitkeep
    - tests/fixtures/.gitkeep
    - scripts/.gitkeep
    - README.md
    - PRIVACY.md
    - README-DEV.md
    - CONTRIBUTING.md
  modified: []
decisions:
  - scripts.test uses node scripts/run-tests.mjs (not shell glob) — Windows cmd.exe does not expand globs; Node 20.10 lacks native --test glob support (D-10)
  - No eslint-plugin-import in devDependencies — D-06 satisfied by built-in no-restricted-imports + per-file override (CONTEXT.md D-06 revised cycle 2)
  - tsconfig.exclude includes tests/fixtures/**/* — Plan 02 red-team fixture uses @ts-nocheck and must not be type-checked
  - packageManager pinned to npm@10.9.0 (D-15)
  - mcp/server.ts Phase 0 stub: export {} only; server does not need to start at Phase 0 (D-18 revised cycle 2)
metrics:
  duration: ~12 minutes
  completed: "2026-05-07"
  tasks_completed: 2
  files_created: 27
---

# Phase 0 Plan 01: Repo Skeleton (package.json, tsconfig, directory contract, MCP stub) Summary

**One-liner:** TypeScript+ESM repo skeleton with strict NodeNext tsconfig, portable cross-platform test runner, full directory contract, and Phase 0 MCP server stub — all compiling cleanly under strict.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create package.json + tsconfig.json + .gitignore + .gitattributes + LICENSE + scripts/run-tests.mjs | 8c235e1 | package.json, tsconfig.json, .gitignore, .gitattributes, LICENSE, scripts/run-tests.mjs, package-lock.json |
| 2 | Create source-tree skeleton (.gitkeep dirs, stub docs, mcp/server.ts stub) | 86d6b27 | 19 files (all .gitkeep dirs, migrations/README.md, mcp/server.ts, README.md, PRIVACY.md, README-DEV.md, CONTRIBUTING.md) |

## Files Created

### Root config files (Task 1)
- `package.json` — ESM, Node>=20.10, npm@10.9.0, all required scripts
- `tsconfig.json` — ES2022 NodeNext strict, tests/fixtures/**/* excluded
- `.gitignore` — dist/, node_modules/, coverage/, .env*, *.tsbuildinfo
- `.gitattributes` — * text=auto eol=lf (cross-platform LF enforcement)
- `LICENSE` — SPDX MIT 2026, Copyright Akhil Achanta
- `scripts/run-tests.mjs` — portable recursive test discoverer (no shell glob)
- `package-lock.json` — committed per D-14

### Source-tree skeleton (Task 2)
- `bin/.gitkeep`, `bin/lib/.gitkeep` — Tier 2 CLI source directories
- `bin/lib/migrations/README.md` — ARCH-07 migrations contract documentation
- `mcp/.gitkeep` (tracked via mcp/server.ts), `mcp/server.ts` — Phase 0 MCP server stub
- `hooks/.gitkeep`, `skills/.gitkeep`, `agents/.gitkeep`, `workflows/.gitkeep` — plugin extension dirs
- `templates/.gitkeep`, `templates/citation-styles/.gitkeep` — citation style templates
- `references/.gitkeep`, `schema/.gitkeep` — reference/schema dirs
- `tests/.gitkeep`, `tests/fixtures/.gitkeep` — test directories
- `scripts/.gitkeep` — scripts directory marker
- `README.md` — stub per D-19 (full README in Phase 6)
- `PRIVACY.md` — stub per D-20 (local-only, no telemetry)
- `README-DEV.md` — documents dist/mcp/ chicken-and-egg and OneDrive sync caveat (D-22)
- `CONTRIBUTING.md` — architectural chokepoints (HTTP import + DOI regex) per RESEARCH Open Q#2

## Resolved Dependency Versions

Resolved by `npm install` on 2026-05-07:

| Package | Requested | Resolved |
|---------|-----------|---------|
| typescript | ^5.6.0 | 5.9.3 |
| tsx | ^4.0.0 | 4.21.0 |
| @types/node | ^20.10.0 | 20.19.39 |
| eslint | ^9.0.0 | 9.39.4 |
| typescript-eslint | ^8.0.0 | 8.59.2 |

## Verification Results

### npx tsc --noEmit
```
Exit code: 0
```
The strict tsconfig (ES2022, NodeNext, verbatimModuleSyntax, exactOptionalPropertyTypes, noUncheckedIndexedAccess) successfully compiles `mcp/server.ts` (the only `.ts` source file at Plan 01 completion).

### node scripts/run-tests.mjs
```
discovered 0 test files
FATAL: zero *.test.ts files found under tests/. Failing to avoid vacuous CI pass.
Exit code: 1
```
This is the EXPECTED behavior at Plan 01 completion (pre-test state). Plans 02 + 03 will add >=8 test files, after which the runner will execute them and exit 0.

### npm run build
```
Exit code: 0
dist/mcp/server.js produced (plus server.d.ts, server.js.map, server.d.ts.map)
```

## Deviations from Plan

None — plan executed exactly as written.

The plan's documented deltas (compared to the RESEARCH.md template) were applied as specified:
1. `scripts.test` = `node scripts/run-tests.mjs` (not shell glob) — as required
2. No `eslint-plugin-import` in devDependencies — as required (D-06 revised cycle 2)
3. `tsconfig.json` exclude contains `tests/fixtures/**/*` — as required

## Known Stubs

The following Phase 0 stubs are intentional and tracked for future resolution:

| Stub | File | Reason | Future Plan |
|------|------|--------|-------------|
| MCP server body | mcp/server.ts | Phase 0 acceptance only requires compilation; resources land in Phase 2 (TIER-01) | Phase 2 |
| README content | README.md | Full README with PRD §3 disclaimer ships in Phase 6 when export pipeline is real | Phase 6 |
| PRIVACY content | PRIVACY.md | Full privacy doc ships with v0.1.0 | Phase 6 |
| migrations dir | bin/lib/migrations/ | Empty in v0.1.0 per ARCH-07; migrations added as state format evolves | Phase 2+ |

## Self-Check: PASSED

Files verified:
- package.json: FOUND (valid JSON, type:module, node>=20.10.0, packageManager:npm@10.9.0)
- tsconfig.json: FOUND (valid JSON, module:NodeNext, exclude includes tests/fixtures/**\*)
- LICENSE: FOUND (MIT License, Copyright 2026 Akhil Achanta)
- scripts/run-tests.mjs: FOUND (contains readdir, recursive:true, --import, tsx, --test, discovered, exit(1))
- mcp/server.ts: FOUND (export {}, Phase 0 stub comment)
- CONTRIBUTING.md: FOUND (bin/lib/http.ts, bin/lib/doi.ts, /^10\., eslint.config.js)
- All 13 .gitkeep directories: FOUND
- bin/lib/migrations/README.md: FOUND (ARCH-07, Pitfall 5)

Commits verified:
- 8c235e1: FOUND (Task 1 — root config files)
- 86d6b27: FOUND (Task 2 — source-tree skeleton)
