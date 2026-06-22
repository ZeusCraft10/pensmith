---
phase: 02-tier-shells-doctor-tier-contract-gate
plan: "02"
subsystem: lint-chokepoints, mcp-transport, testing
tags: [eslint, D-10, stdio-only, no-network, AST-selector, mcp, chokepoint, red-team, fixture]
dependency_graph:
  requires:
    - phase: 02-01-lint-thin-shim
      provides: D-09 eslint.config.js block + global-ignores pattern + tseslint inline-test precedent
    - phase: 00-02
      provides: eslint.config.js flat-config foundation + global-ignores pattern
  provides:
    - tests/fixtures/lint-mcp-no-network-fixture.ts (D-10 red-team fixture: net/http/https/tls.createServer + new Server)
    - eslint.config.js D-10 block scoped to mcp/**/*.ts (no-restricted-syntax for server constructors; project-wide D-07/D-41 selectors re-listed for flat-config override-merge safety)
    - tests/lint-mcp-no-network.test.ts (2-test regression gate: inline tseslint + PROJECT-config-loaded via mcp/ tmp copy)
  affects:
    - 02-04 (mcp/server.ts) — D-10 chokepoint is live before the module it protects (Pitfall 7 prevention)
    - 02-03 — eslint.config.js extended; 02-03 must not touch D-09 or D-10 blocks
tech_stack:
  added: []
  patterns:
    - D-10 no-network chokepoint: no-restricted-syntax selectors scoped to mcp/**/*.ts for net/http/https/tls.createServer + new Server()
    - ESLint flat-config override-merge safety: re-list all project-wide D-07/D-41 selectors inside the mcp/** file-scoped block
    - Global-ignores red-team fixture pattern (established Phase 0, extended Phase 2 for D-09 and D-10)
    - tseslint.configs.recommended in inline ESLint test config (TypeScript declare const syntax — precedent from 02-01)
    - Test-only fsp.writeFile exemption in eslint.config.js (deliberate, documented — same pattern as 02-01)
key_files:
  created:
    - tests/fixtures/lint-mcp-no-network-fixture.ts
    - tests/lint-mcp-no-network.test.ts
  modified:
    - eslint.config.js (D-10 mcp/** block + lint-mcp-no-network-fixture.ts in global-ignores + test exemption for lint-mcp-no-network.test.ts)
key-decisions:
  - "D-10 mcp/** block re-lists all D-07/D-41 project-wide selectors — ESLint 9 flat-config file-scoped blocks OVERRIDE (not merge) the project-wide rule; without re-listing, a DOI regex inside mcp/server.ts would escape the chokepoint"
  - "tseslint.configs.recommended required in inline ESLint test config — fixture uses 'declare const' TypeScript syntax that ESLint default parser cannot handle; same precedent established by 02-01 D-09 tests"
  - "tests/lint-mcp-no-network.test.ts exempted from no-restricted-syntax (D-07 writeFile selector) — Test 2 writes a tmp mcp/-pathed copy of the fixture to trigger the file-scoped D-10 rule; deliberate and documented"
  - "https selector included alongside net/http/tls — plan listed 5 selectors including https.createServer; fixture covers all 5; PATTERNS.md Excerpt table also lists https"
patterns-established:
  - "D-10 inline+PROJECT test pattern: tseslint.configs.recommended in inline test (TypeScript fixture) + PROJECT-config-loaded test writes tmp to mcp/ and filters global-ignores"
  - "Override-merge safety re-listing pattern: when adding a file-scoped no-restricted-syntax block for mcp/**, always re-list all existing project-wide selectors to prevent silent coverage gaps"
requirements-completed:
  - ARCH-18
duration: ~3 minutes
completed: "2026-05-16T10:17:31Z"
---

# Phase 2 Plan 02: Lint MCP No-Network Summary

**D-10 MCP stdio-only transport chokepoint shipped: no-restricted-syntax selectors scoped to mcp/**/*.ts block net/http/https/tls.createServer + new Server() calls at the call-site level; project-wide D-07/D-41 selectors re-listed for flat-config override-merge safety; 2-test regression gate (inline tseslint + PROJECT-config-loaded via mcp/ tmp copy) locks the rule before mcp/server.ts is written.**

## Performance

- **Duration:** ~3 minutes
- **Started:** 2026-05-16T10:14:13Z
- **Completed:** 2026-05-16T10:17:31Z
- **Tasks:** 3 completed
- **Files modified:** 3 (eslint.config.js, tests/fixtures/lint-mcp-no-network-fixture.ts, tests/lint-mcp-no-network.test.ts)

## Accomplishments

### Task 1: Create red-team fixture (D-10)

Created `tests/fixtures/lint-mcp-no-network-fixture.ts` with five intentional D-10 violations:
- `net.createServer(() => {})` — non-stdio transport
- `http.createServer(() => {})` — non-stdio transport
- `https.createServer({}, () => {})` — non-stdio transport
- `tls.createServer({}, () => {})` — non-stdio transport
- `new Server()` — generic server constructor

Fixture follows established pattern: `@ts-nocheck` header, `=== D-10 violation ===` markers per violation, `_redTeam` export to defeat tree-shaking. Uses `declare const` for all five names (net/http/https/tls/Server) — never compiled or executed, only AST-walked.

Commit: `339b728`

### Task 2: Add D-10 rule to eslint.config.js + global-ignores entry + test exemption

Extended `eslint.config.js` with:
1. New file-scoped block `{ files: ['mcp/**/*.ts'], rules: { 'no-restricted-syntax': ... } }` with 5 D-10 selectors (net/http/https/tls.createServer + new Server()) PLUS all 6 project-wide D-07/D-41 selectors re-listed (override-merge safety — flat-config file-scoped blocks replace, not append, the project-wide rule)
2. `tests/fixtures/lint-mcp-no-network-fixture.ts` added to global-ignores array (alphabetically between lint-chokepoint and lint-paths fixtures)
3. Exemption block `{ files: ['tests/lint-mcp-no-network.test.ts'], rules: { 'no-restricted-syntax': 'off' } }` for Test 2's test-only `fsp.writeFile` call
4. D-09 thin-shim block from 02-01 preserved intact

`npm run lint` and `npm run typecheck` both exit 0. `node scripts/run-tests.mjs tests/repo-files.test.ts` exits 0.

Commit: `a473ee7`

### Task 3: Create tests/lint-mcp-no-network.test.ts (2 tests)

Created `tests/lint-mcp-no-network.test.ts` with:
- **Test 1 (inline):** ESLint with `tseslint.configs.recommended` + inline `no-restricted-syntax` for all 5 D-10 selectors → asserts >=5 messages fire on fixture. `tseslint.configs.recommended` is required because the fixture uses `declare const` TypeScript syntax (same precedent as 02-01 D-09 tests).
- **Test 2 (PROJECT-config-loaded):** Loads actual `eslint.config.js`, strips global-ignores-only entries (Pitfall B5 mitigation), writes fixture to `mcp/_no-network-fixture-tmp.ts` so the file-scoped D-10 block fires, asserts >=5 `no-restricted-syntax` messages, cleans up in finally block.

Full suite: 245 pass, 0 fail (243 baseline + 2 new D-10 tests). `npm run check` exits 0.

Commit: `9f4fcc2`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Inline ESLint config requires TypeScript parser for declare const fixture**
- **Found during:** Task 3 (applied proactively — same root cause as 02-01 deviation #1)
- **Issue:** The fixture uses `declare const net: any; declare const http: any;` etc. — TypeScript-specific syntax. ESLint's default parser (`espree`) fails on `declare const` statements. The plan's inline test snippet did not include the TypeScript parser.
- **Fix:** Added `...tseslint.configs.recommended` to the inline `overrideConfig` array and `import tseslint from 'typescript-eslint'` to the test imports. Applied proactively based on the 02-01 precedent (documented in 02-01 SUMMARY as a key decision).
- **Files modified:** `tests/lint-mcp-no-network.test.ts`
- **Impact:** Test 1 passes correctly. No regression.

**2. [Rule 2 - Missing functionality] Exemption block needed for test's fsp.writeFile**
- **Found during:** Task 2 (applied proactively — same root cause as 02-01 deviation #2)
- **Issue:** Test 2 calls `fsp.writeFile(tmpMcpPath, ...)` to write a temp mcp/-pathed copy of the fixture. The D-07 `CallExpression[callee.property.name='writeFile']` selector fires on this call. Applied proactively based on the 02-01 precedent.
- **Fix:** Added `{ files: ['tests/lint-mcp-no-network.test.ts'], rules: { 'no-restricted-syntax': 'off' } }` exemption block to `eslint.config.js` with a detailed comment explaining the deliberate usage.
- **Files modified:** `eslint.config.js`
- **Impact:** `npm run lint` passes. Narrowly scoped with documentation.

## Verification Results

All acceptance criteria met:

- `test -f tests/fixtures/lint-mcp-no-network-fixture.ts` → EXISTS
- `grep -c "@ts-nocheck" tests/fixtures/lint-mcp-no-network-fixture.ts` → 1
- `grep -c "createServer" tests/fixtures/lint-mcp-no-network-fixture.ts` → 9 (comments + code)
- `grep -c "new Server()" tests/fixtures/lint-mcp-no-network-fixture.ts` → 3 (comment + code + export)
- `grep -c "D-10 violation" tests/fixtures/lint-mcp-no-network-fixture.ts` → 5
- `grep -c "_redTeam" tests/fixtures/lint-mcp-no-network-fixture.ts` → 1
- `grep -c "lint-mcp-no-network-fixture.ts" eslint.config.js` → 1
- `grep -c "D-10 stdio-only" eslint.config.js` → 6 (5 selectors + comment line)
- `grep -c "D-09 thin-shim" eslint.config.js` → 4 (D-09 block preserved)
- `npm run lint` → exits 0
- `npm run typecheck` → exits 0
- `test -f tests/lint-mcp-no-network.test.ts` → EXISTS
- `grep -c "createServer" tests/lint-mcp-no-network.test.ts` → 5
- `grep -c "NewExpression\[callee.name='Server'\]" tests/lint-mcp-no-network.test.ts` → 1
- `node scripts/run-tests.mjs tests/lint-mcp-no-network.test.ts` → 245 pass, 0 fail
- `test ! -f mcp/_no-network-fixture-tmp.ts` → CLEAN (tmp file deleted)
- `npm run check` → exits 0

## Threat Flags

No new threat surface beyond what was identified in the plan's threat model. All STRIDE dispositions applied:
- T-02-02-01 (accidental SSE/HTTP transport): mitigated — D-10 chokepoint rule + regression test lands before 02-04 writes mcp/server.ts
- T-02-02-02 (silent selector typo disables D-10): mitigated — PROJECT-config-loaded Test 2 loads real eslint.config.js and asserts rule fires
- T-02-02-03 (eslint-disable comment): accepted — code review gate; plan does not police comment-level disables
- T-02-02-04 (new transport in future phase): mitigated — D-10 lock documented in CONTEXT.md; lifting requires explicit discuss-phase decision

## Self-Check: PASSED

Files present:
- tests/fixtures/lint-mcp-no-network-fixture.ts: FOUND
- tests/lint-mcp-no-network.test.ts: FOUND
- eslint.config.js (modified): FOUND
- .planning/phases/02-tier-shells-doctor-tier-contract-gate/02-02-lint-mcp-no-network-SUMMARY.md: FOUND

Commits present:
- 339b728: feat(02-02): create D-10 MCP no-network red-team fixture
- a473ee7: feat(02-02): add D-10 no-network chokepoint rules to eslint.config.js
- 9f4fcc2: feat(02-02): add lint-mcp-no-network.test.ts (D-10 regression gate)

Full test suite: 245 pass, 0 fail.
