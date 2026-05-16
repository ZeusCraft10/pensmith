---
phase: 02-tier-shells-doctor-tier-contract-gate
plan: "01"
subsystem: lint-chokepoints, mcp-thin-shim, testing
tags: [eslint, D-09, thin-shim, AST-walk, no-restricted-imports, mcp, chokepoint, red-team, fixture]
dependency_graph:
  requires:
    - phase: 02-00-review-cleanup
      provides: citty@^0.2.2 dep, baseline 240 tests passing
    - phase: 00-02
      provides: eslint.config.js flat-config foundation + global-ignores pattern
  provides:
    - tests/fixtures/lint-thin-shim-fixture.ts (D-09 red-team fixture, 31-stmt handler + fs import)
    - eslint.config.js D-09 block scoped to mcp/**/*.ts (no-restricted-imports for fs family)
    - tests/lint-thin-shim.test.ts (3-test regression gate: inline + PROJECT-config-loaded + AST-walk)
  affects:
    - 02-04 (mcp/server.ts) — chokepoint is live before the module it protects (Pitfall 7 prevention)
    - 02-02, 02-03 — eslint.config.js extended; they must not touch this block
tech_stack:
  added: []
  patterns:
    - D-09 thin-shim chokepoint: no-restricted-imports rule scoped to mcp/**/*.ts for fs/node:fs/fs/promises/node:fs/promises
    - AST-walk statement-count gate via @typescript-eslint/parser (same pattern as D-07 DOI chokepoint)
    - Global-ignores red-team fixture pattern (established in Phase 0, extended here for D-09)
    - tseslint.configs.recommended in inline ESLint config to handle TypeScript-specific syntax in fixtures
    - Test-only fsp.writeFile exemption in eslint.config.js (deliberate, documented)
key_files:
  created:
    - tests/fixtures/lint-thin-shim-fixture.ts
    - tests/lint-thin-shim.test.ts
  modified:
    - eslint.config.js (D-09 mcp/** block + lint-thin-shim-fixture.ts in global-ignores + test exemption)
key-decisions:
  - "tseslint.configs.recommended required in inline ESLint config — fixture uses 'declare const' TypeScript syntax that ESLint's default parser cannot handle without the TS parser"
  - "tests/lint-thin-shim.test.ts exempted from no-restricted-syntax (D-07 writeFile selector) — test writes a tmp mcp/-pathed copy of the fixture to trigger the file-scoped D-09 rule; deliberate + documented"
  - "3 fixture violations: (a) import fs from 'node:fs' at top, (b) 31-stmt registerTool handler, (c) fs.readFileSync using the top-level import — all three self-documented with D-09 violation markers"
  - "Inline Test 1 pattern extended from lint-paths-chokepoint: must add tseslint.configs.recommended when fixture uses TypeScript-specific syntax; this is the precedent for future chokepoint test inline configs"
patterns-established:
  - "Thin-shim AST-walk test: inline (tseslint + no-restricted-imports) + PROJECT-config-loaded (mcp/ copy) + pure @typescript-eslint/parser AST walk for statement-count"
  - "eslint test-file exemption for test-only writeFile: add files-scoped block + rationale comment explaining the deliberate usage"
requirements-completed:
  - ARCH-18
duration: ~14 minutes
completed: "2026-05-16T09:57:00Z"
---

# Phase 2 Plan 01: Lint Thin-Shim Summary

**D-09 MCP thin-shim chokepoint shipped: no-restricted-imports rule scoped to mcp/**/*.ts (fs family banned) + 3-test regression gate (inline, PROJECT-config-loaded, AST-walk statement-count) using @typescript-eslint/parser; chokepoint lands before 02-04 writes the first real handler.**

## Performance

- **Duration:** ~14 minutes
- **Started:** 2026-05-16T09:43:26Z
- **Completed:** 2026-05-16T09:57:00Z
- **Tasks:** 3 completed
- **Files modified:** 4 (eslint.config.js ×2 edits, tests/fixtures/lint-thin-shim-fixture.ts, tests/lint-thin-shim.test.ts)

## Accomplishments

### Task 1: Create red-team fixture (D-09)

Created `tests/fixtures/lint-thin-shim-fixture.ts` with three intentional D-09 violations:
- `import fs from 'node:fs'` at top (forbidden in mcp/**)
- `server.registerTool(...)` handler with 31 statements (>30 budget)
- `fs.readFileSync(...)` usage via the top-level import

Fixture follows established pattern: `@ts-nocheck` header, `=== D-09 violation ===` markers, `_redTeam` export to defeat tree-shaking.

Commit: `f6b7520`

### Task 2: Add D-09 rule to eslint.config.js + global-ignores entry

Extended `eslint.config.js` with:
1. New file-scoped block `{ files: ['mcp/**/*.ts'], rules: { 'no-restricted-imports': ... } }` banning fs/node:fs/fs/promises/node:fs/promises (D-09)
2. `tests/fixtures/lint-thin-shim-fixture.ts` added to global-ignores array
3. Comment explains statement-count budget is in the AST walk (Test 3), not here

Comment notes: HTTP imports (http/https/undici) already blocked project-wide; this block adds only the fs family scoped to mcp/*.

`npm run lint` and `npm run typecheck` both exit 0.

Commit: `6f034cb`

### Task 3: Create tests/lint-thin-shim.test.ts (3 tests)

Created `tests/lint-thin-shim.test.ts` with:
- **Test 1 (inline):** ESLint with `tseslint.configs.recommended` + inline `no-restricted-imports` for fs family → asserts ≥1 message fires on fixture. Note: `tseslint.configs.recommended` is required because the fixture uses `declare const` TypeScript syntax that the default ESLint parser cannot handle.
- **Test 2 (PROJECT-config-loaded):** Loads actual `eslint.config.js`, strips global-ignores-only entries (Pitfall B5 pattern), writes fixture to `mcp/_thin-shim-fixture-tmp.ts` so the file-scoped D-09 block fires, asserts ≥1 `no-restricted-imports` message, cleans up in finally block.
- **Test 3 (AST walk):** Uses `@typescript-eslint/parser` directly to parse the fixture; `collectHandlerBodyLengths()` walks `CallExpression` nodes where `callee.property.name in {registerTool, registerResource}`, counts `body.body.length`, asserts `maxCount > 30` on the fixture.

Also added exemption block in `eslint.config.js` for `tests/lint-thin-shim.test.ts` scoped to `no-restricted-syntax: off` (Test 2's `fsp.writeFile` triggers the D-07 writeFile chokepoint selector; deliberate + documented).

All 3 tests pass. Full suite: 243 pass, 0 fail (baseline 240 + 3 new).

Commit: `4c3cfe4`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Inline ESLint config requires TypeScript parser for fixture**
- **Found during:** Task 3 (Test 1)
- **Issue:** The fixture uses `declare const server: { ... }` — TypeScript-specific syntax. ESLint's default parser (`espree`) fails with "Parsing error: Unexpected token const" on `declare const` statements. The inline config in Test 1 (as written in the plan) did not include the TypeScript parser.
- **Fix:** Added `...tseslint.configs.recommended` to the inline `overrideConfig` array in Test 1. This wires `@typescript-eslint/parser` as the language parser. Also added `import tseslint from 'typescript-eslint'` to the test file imports.
- **Files modified:** `tests/lint-thin-shim.test.ts`
- **Impact:** Test 1 passes correctly. The pattern is now the precedent for future chokepoint tests whose fixtures use TypeScript-specific syntax.

**2. [Rule 2 - Missing exemption] No-restricted-syntax exemption needed for test's fsp.writeFile**
- **Found during:** Task 3 (`npm run lint` after creating the test file)
- **Issue:** Test 2 calls `fsp.writeFile(tmpMcpPath, ...)` to write a temp mcp/-pathed copy of the fixture. The D-07 `CallExpression[callee.property.name='writeFile']` selector fires on this call, even though it's a test-only utility write (not production code bypassing the atomic-write chokepoint).
- **Fix:** Added a `{ files: ['tests/lint-thin-shim.test.ts'], rules: { 'no-restricted-syntax': 'off' } }` exemption block to `eslint.config.js` with a detailed comment explaining the deliberate usage. Same pattern as the existing exemption blocks for tests that need to use `process.env.*` overrides.
- **Files modified:** `eslint.config.js`
- **Impact:** `npm run lint` passes. The exemption is narrowly scoped to one file with documentation.

**3. [Rule 1 - Bug] @typescript-eslint/no-explicit-any in AST walker function**
- **Found during:** Task 3 (`npm run lint` after creating test file)
- **Issue:** The `collectHandlerBodyLengths(node: any)` and inner `walk(n: any)` functions use `any` type, which the `@typescript-eslint/no-explicit-any` rule flags. AST node types from `@typescript-eslint/parser` don't have clean generic interfaces for arbitrary node walking.
- **Fix:** Added `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comments above both `any` usages. This is the standard approach for AST walkers that necessarily deal with dynamically-typed nodes.
- **Files modified:** `tests/lint-thin-shim.test.ts`
- **Impact:** Lint passes cleanly. Pattern is consistent with how similar code in other projects handles untyped AST nodes.

## Verification Results

All acceptance criteria met:

- `test -f tests/fixtures/lint-thin-shim-fixture.ts` → EXISTS
- `grep -c "@ts-nocheck" tests/fixtures/lint-thin-shim-fixture.ts` → 1
- `grep -c "_redTeam" tests/fixtures/lint-thin-shim-fixture.ts` → 1
- `grep -c "D-09 violation" tests/fixtures/lint-thin-shim-fixture.ts` → 4
- `grep -c "import fs from 'node:fs'" tests/fixtures/lint-thin-shim-fixture.ts` → 1
- `grep -c "lint-thin-shim-fixture.ts" eslint.config.js` → 1
- `grep -c "D-09 thin-shim" eslint.config.js` → 4
- `grep -n "files: \['mcp" eslint.config.js` → line 169 present
- `npm run lint` → exits 0
- `npm run typecheck` → exits 0
- `test -f tests/lint-thin-shim.test.ts` → EXISTS
- `grep -c "registerTool\|registerResource" tests/lint-thin-shim.test.ts` → 4
- `grep -c "@typescript-eslint/parser" tests/lint-thin-shim.test.ts` → 3
- `node --test tests/lint-thin-shim.test.ts` → 3 pass, 0 fail
- `test ! -f mcp/_thin-shim-fixture-tmp.ts` → CLEAN (tmp file deleted)
- Full suite: 243 pass, 0 fail

## Threat Flags

No new threat surface beyond what was identified in the plan's threat model. All STRIDE dispositions applied:
- T-02-01-01 (fat MCP handler): mitigated — D-09 chokepoint rule + AST-walk test lands before 02-04 writes handlers
- T-02-01-02 (silent rule typo): mitigated — PROJECT-config-loaded Test 2 loads real eslint.config.js and asserts rule fires
- T-02-01-03 (tmp file collision): accepted — deterministic name, single-threaded node:test; no Phase-2 parallelism
- T-02-01-04 (future mcp/** file with fs import): mitigated — `npm run lint` will fail in CI (Wave-3 D-22 CI step)

## Self-Check: PASSED

Files present:
- tests/fixtures/lint-thin-shim-fixture.ts: FOUND
- tests/lint-thin-shim.test.ts: FOUND
- eslint.config.js (modified): FOUND
- .planning/phases/02-tier-shells-doctor-tier-contract-gate/02-01-lint-thin-shim-SUMMARY.md: FOUND

Commits present:
- f6b7520: feat(02-01): create D-09 thin-shim red-team fixture
- 6f034cb: feat(02-01): add D-09 thin-shim chokepoint rule to eslint.config.js
- 4c3cfe4: feat(02-01): add lint-thin-shim.test.ts + eslint exemption for test writeFile (D-09)

Full test suite: 243 pass, 0 fail.
