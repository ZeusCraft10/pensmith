---
phase: 02-tier-shells-doctor-tier-contract-gate
plan: 01
type: execute
wave: 1
depends_on: ["02-00"]
files_modified:
  - eslint.config.js
  - tests/fixtures/lint-thin-shim-fixture.ts
  - tests/lint-thin-shim.test.ts
autonomous: true
requirements:
  - ARCH-18
user_setup: []
must_haves:
  truths:
    - "MCP tool/resource handlers in mcp/server.ts are forbidden from importing fs/http/https/undici (per D-09)"
    - "MCP tool/resource handler statement count is enforced at ≤30 statements (per D-08, target ≤20)"
    - "Red-team fixture provably violates the chokepoint and the project ESLint config flags it (Pitfall B5 mitigation)"
    - "Inline-rule smoke test + PROJECT-config-loaded test both pass (model on tests/lint-paths-chokepoint.test.ts)"
  artifacts:
    - path: "tests/fixtures/lint-thin-shim-fixture.ts"
      provides: "Red-team handler that violates D-09 (31+ statements + fs import inside an mcp/-style file)"
      contains: "_redTeam"
    - path: "tests/lint-thin-shim.test.ts"
      provides: "Inline + PROJECT-loaded ESLint-against-fixture regression gate"
      contains: "lint-thin-shim"
    - path: "eslint.config.js"
      provides: "Thin-shim chokepoint rules scoped to mcp/**/*.ts + fixture in global-ignores"
      contains: "lint-thin-shim-fixture.ts"
  key_links:
    - from: "eslint.config.js"
      to: "tests/fixtures/lint-thin-shim-fixture.ts"
      via: "global-ignores entry"
      pattern: "lint-thin-shim-fixture\\.ts"
    - from: "tests/lint-thin-shim.test.ts"
      to: "eslint.config.js"
      via: "dynamic import + filter global-ignores"
      pattern: "ignores"
---

<objective>
Land the FIRST of three new AST-walk chokepoint lint tests (D-09). Enforces the MCP thin-shim invariant: every `server.registerTool(...)` / `server.registerResource(...)` handler in `mcp/**/*.ts` is ≤30 statements AND zero `fs`/`http`/`https`/`undici` imports inline. This MUST land BEFORE 02-04 (mcp/server.ts) writes its first handler — chokepoint lints land before the modules they protect (Phase 0/1 Pitfall 7).

Purpose: Mechanically prevent fat MCP handlers from accumulating untested branches; lint is the bug-class fence.
Output: One red-team fixture + one test file + extension to eslint.config.js (rule + global-ignores entry).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-PATTERNS.md
@eslint.config.js
@tests/lint-paths-chokepoint.test.ts
@tests/fixtures/lint-paths-chokepoint-fixture.ts

<interfaces>
<!-- Existing chokepoint pattern: AST-walk lint tests in tests/lint-*-chokepoint.test.ts
     model on tests/lint-paths-chokepoint.test.ts (the closest analog per PATTERNS.md). -->

From eslint.config.js (existing, extended in this plan):
- Lines 60-85: `no-restricted-syntax` selectors (4 existing — DOI regex, fs.writeFile, os.homedir, process.env.LOCALAPPDATA/APPDATA/XDG_DATA_HOME)
- Lines 161-169: global-ignores entry listing the 3 existing red-team fixture filenames
- Lines 32-86: project-wide rule scope is `bin/**/*.ts, mcp/**/*.ts, hooks/**/*.ts, scripts/**/*.ts, tests/**/*.ts`

This plan ADDS:
- A new file-scoped block in eslint.config.js (after the existing block at line 87) that targets `mcp/**/*.ts` ONLY and adds the thin-shim selectors as `no-restricted-syntax` rules.
- A new fixture filename to the `ignores` array at line 162.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create red-team fixture for thin-shim violation (D-09)</name>
  <files>tests/fixtures/lint-thin-shim-fixture.ts</files>
  <read_first>
    - tests/fixtures/lint-paths-chokepoint-fixture.ts (entire — exact shape to mirror)
    - tests/fixtures/lint-atomic-write-chokepoint-fixture.ts (entire — alternate fixture style)
    - .planning/phases/02-tier-shells-doctor-tier-contract-gate/02-PATTERNS.md § "Excerpt 2 — Red-team fixture" (lines 100-124)
  </read_first>
  <action>
    Create `tests/fixtures/lint-thin-shim-fixture.ts` with three intentional violations:
    1. An `import fs from 'node:fs';` at the top (violates D-09 forbidden-import rule).
    2. A simulated `server.registerTool(...)` call whose handler body has 31 statements (≥31 violates D-09's ≤30 statement budget; place a comment marker on the 31st statement so the fixture self-documents).
    3. A simulated `server.registerResource(...)` call whose handler imports/uses `http.createServer` inline (violates both D-09 forbidden-import AND D-10 — keep this one minimal so it primarily flags the D-09 handler-import rule; the D-10 rule lands in 02-02).

    File header model on existing fixtures (see PATTERNS Excerpt 2). Include:
    - `@ts-nocheck` comment line so tsc never type-checks this
    - Explanatory paragraph with `=== D-09 violation ===` markers above each bad construct
    - `export const _redTeam = { ... };` at the bottom to defeat tree-shaking
    - Comment line stating this fixture must be added to eslint.config.js global-ignores AND that the live D-09 rule lands in Task 3 of this plan

    Skeleton:
    ```typescript
    // Red-team fixture for the D-09 thin-shim chokepoint (Phase 2).
    // This file INTENTIONALLY violates the chokepoint by:
    //   (a) importing 'node:fs' at the top (no fs imports allowed in mcp/**)
    //   (b) calling `server.registerTool(...)` with a 31-statement handler
    //   (c) calling `server.registerResource(...)` with an inline http import
    // It is ignored by the project ESLint config (eslint.config.js global-ignores)
    // so `npm run lint` over the repo passes. The chokepoint regression test at
    // tests/lint-thin-shim.test.ts runs ESLint programmatically against THIS
    // file and asserts the rule fires.
    //
    // @ts-nocheck — this file is never type-checked or executed.

    import fs from 'node:fs';                          // === D-09 violation ===
    // declare a fake McpServer-like shape for the fixture
    declare const server: {
      registerTool: (name: string, schema: unknown, handler: (...args: any[]) => any) => void;
      registerResource: (name: string, uri: string, meta: unknown, handler: (...args: any[]) => any) => void;
    };

    // === D-09 violation: handler with 31 statements (>30 budget) ===
    server.registerTool('fat-tool', { /* schema */ }, async () => {
      const s1 = 1;
      const s2 = 2;
      const s3 = 3;
      const s4 = 4;
      const s5 = 5;
      const s6 = 6;
      const s7 = 7;
      const s8 = 8;
      const s9 = 9;
      const s10 = 10;
      const s11 = 11;
      const s12 = 12;
      const s13 = 13;
      const s14 = 14;
      const s15 = 15;
      const s16 = 16;
      const s17 = 17;
      const s18 = 18;
      const s19 = 19;
      const s20 = 20;
      const s21 = 21;
      const s22 = 22;
      const s23 = 23;
      const s24 = 24;
      const s25 = 25;
      const s26 = 26;
      const s27 = 27;
      const s28 = 28;
      const s29 = 29;
      const s30 = 30;
      const s31 = 31;                                  // === 31st statement — D-09 violation ===
      return { content: [{ type: 'text', text: String(s1 + s31) }] };
    });

    // === D-09 violation: forbidden import used inside an mcp/-style file ===
    const usedFs = fs.readFileSync('/dev/null', 'utf-8');

    export const _redTeam = { usedFs };
    ```
  </action>
  <verify>
    <automated>test -f tests/fixtures/lint-thin-shim-fixture.ts &amp;&amp; grep -c "_redTeam" tests/fixtures/lint-thin-shim-fixture.ts</automated>
  </verify>
  <acceptance_criteria>
    - `test -f tests/fixtures/lint-thin-shim-fixture.ts` succeeds
    - `grep -c "@ts-nocheck" tests/fixtures/lint-thin-shim-fixture.ts` returns at least 1
    - `grep -c "_redTeam" tests/fixtures/lint-thin-shim-fixture.ts` returns at least 1
    - `grep -c "D-09 violation" tests/fixtures/lint-thin-shim-fixture.ts` returns at least 2
    - `grep -c "import fs from 'node:fs'" tests/fixtures/lint-thin-shim-fixture.ts` returns 1
  </acceptance_criteria>
  <done>
    Fixture exists with three documented D-09 violations + the standard `@ts-nocheck` + `_redTeam` envelope.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add D-09 thin-shim rules to eslint.config.js + fixture in global-ignores</name>
  <files>eslint.config.js</files>
  <read_first>
    - eslint.config.js (entire — confirm current block layout, especially lines 32-86 main scope and 161-169 ignores)
    - tests/lint-paths-chokepoint.test.ts (entire — confirm inline-rule-shape convention used by the lint test)
  </read_first>
  <action>
    1. ADD `'tests/fixtures/lint-thin-shim-fixture.ts'` to the `ignores` array at lines 161-169 (place it alphabetically with the existing three fixtures).

    2. ADD a new file-scoped config block AFTER the existing main block at lines 32-86 and BEFORE the existing exemption blocks at line 89+. The block targets `mcp/**/*.ts` ONLY and adds D-09 selectors:

       ```javascript
       // === D-09: MCP thin-shim chokepoint (Phase 2) ===
       // mcp/**/*.ts handlers MUST NOT import fs / fs/promises directly.
       // The HTTP chokepoint above already blocks undici/http/https — this
       // block adds the fs ban scoped to mcp/** so business logic stays in
       // bin/lib/*. The handler-statement-count budget (≤30) is enforced
       // by tests/lint-thin-shim.test.ts at the AST level, not here, because
       // no-restricted-syntax cannot count statement-body length in a single
       // selector. The test file does that walk programmatically.
       {
         files: ['mcp/**/*.ts'],
         rules: {
           'no-restricted-imports': ['error', {
             paths: [
               { name: 'fs',            message: 'D-09 thin-shim: mcp handlers must not touch fs directly — delegate to bin/lib/*' },
               { name: 'node:fs',       message: 'D-09 thin-shim: mcp handlers must not touch fs directly — delegate to bin/lib/*' },
               { name: 'fs/promises',   message: 'D-09 thin-shim: mcp handlers must not touch fs directly — delegate to bin/lib/*' },
               { name: 'node:fs/promises', message: 'D-09 thin-shim: mcp handlers must not touch fs directly — delegate to bin/lib/*' },
               // HTTP imports already blocked by the project-wide rule at lines 40-48
             ],
           }],
         },
       },
       ```

       Place this block AFTER the main block (line 87) and BEFORE the HTTP exemption for `bin/lib/http.ts` (line 90). The block is additive — it does NOT override the project-wide `no-restricted-imports` rule; ESLint's flat-config merges per-file blocks correctly when the file path matches.

    3. Verify: run `npm run lint` over the project — expect 0 errors (the fixture is in global-ignores; no other `mcp/**/*.ts` file currently imports fs). Run `npm run typecheck` to ensure no broken syntax.
  </action>
  <verify>
    <automated>npm run lint &amp;&amp; npm run typecheck</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "lint-thin-shim-fixture.ts" eslint.config.js` returns at least 1
    - `grep -c "D-09 thin-shim" eslint.config.js` returns at least 1 (rule message)
    - `grep -c "files: \['mcp/\*\*/\*.ts'\]" eslint.config.js` returns at least 1 (new block exists; escape if needed)
    - `npm run lint` exits 0
    - `npm run typecheck` exits 0
    - `node scripts/run-tests.mjs tests/repo-files.test.ts` exits 0 (the eslint.config.js content-match test still passes)
  </acceptance_criteria>
  <done>
    eslint.config.js declares the D-09 chokepoint rule scoped to mcp/**/*.ts and the new fixture is global-ignored. Project lint and typecheck both green.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Create tests/lint-thin-shim.test.ts (AST-walk + inline + PROJECT-config)</name>
  <files>tests/lint-thin-shim.test.ts</files>
  <read_first>
    - tests/lint-paths-chokepoint.test.ts (entire — exact two-test structure to mirror)
    - .planning/phases/02-tier-shells-doctor-tier-contract-gate/02-PATTERNS.md § "Excerpt 1 — AST-walk chokepoint lint test" (lines 66-96)
    - tests/fixtures/lint-thin-shim-fixture.ts (just created in Task 1 — verify violation count)
    - eslint.config.js (just modified in Task 2 — verify new block)
  </read_first>
  <behavior>
    - Test 1 (INLINE): Run ESLint programmatically with inline override config (no-restricted-imports for fs + a custom statement-count walker). The walker uses `@typescript-eslint/parser` to AST-walk the fixture; count `body.body` statements inside any `CallExpression[callee.property.name='registerTool'|'registerResource']` arrow/function expression handler. Assert: at least 1 forbidden-import message AND at least 1 statement count > 30 detected.
    - Test 2 (PROJECT-config-loaded): Load the actual `eslint.config.js`, filter out global-ignores-only entries (model on tests/lint-paths-chokepoint.test.ts lines 79-104), run ESLint against the fixture, assert at least 1 `no-restricted-imports` message fires (proving the project config wires the fs ban for mcp/** correctly).
    - Test 3 (AST-walk statement count, pure node:test): Use `@typescript-eslint/parser` directly (no ESLint instance) to parse the fixture, walk `CallExpression` nodes where `callee.type === 'MemberExpression' && callee.property.name in {'registerTool','registerResource'}`, find the handler argument (last arg, ArrowFunctionExpression/FunctionExpression), count `body.body.length`, assert max count > 30 on the fixture.
  </behavior>
  <action>
    Create `tests/lint-thin-shim.test.ts` with three tests:

    ```typescript
    // tests/lint-thin-shim.test.ts
    // Regression gate for the D-09 thin-shim chokepoint (Phase 2).
    //
    // D-09: mcp/**/*.ts tool/resource handlers MUST:
    //   (a) NOT import fs / node:fs / fs/promises / node:fs/promises / undici
    //       / http / https / node:http / node:https
    //   (b) Body statement count ≤ 30 (target ≤ 20)
    //
    // (a) is enforced via no-restricted-imports rules in eslint.config.js —
    //     this test asserts the rule wiring is correct (Pitfall B5 mitigation).
    // (b) is enforced via the AST walk in Test 3 below — `no-restricted-syntax`
    //     cannot count statement-body length in a single ESLint selector, so
    //     the walk happens here at test time. Failure on this test means a
    //     real handler in mcp/server.ts violates the budget; failure on the
    //     fixture means the walker logic regressed.

    import test from 'node:test';
    import assert from 'node:assert/strict';
    import { ESLint } from 'eslint';
    import { parse } from '@typescript-eslint/parser';
    import { readFileSync } from 'node:fs';
    import path from 'node:path';

    const FIXTURE = path.resolve('tests/fixtures/lint-thin-shim-fixture.ts');

    test('thin-shim chokepoint: inline rule flags fs import in fixture', async () => {
      const eslint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [{
          files: ['**/*.ts'],
          languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
          rules: {
            'no-restricted-imports': ['error', {
              paths: [
                { name: 'fs',          message: 'D-09 thin-shim' },
                { name: 'node:fs',     message: 'D-09 thin-shim' },
                { name: 'fs/promises', message: 'D-09 thin-shim' },
                { name: 'node:fs/promises', message: 'D-09 thin-shim' },
              ],
            }],
          },
        }],
      });
      const results = await eslint.lintFiles([FIXTURE]);
      assert.equal(results.length, 1);
      const count = (results[0]?.messages ?? []).filter(m => m.ruleId === 'no-restricted-imports').length;
      assert.ok(count >= 1, `expected >=1 no-restricted-imports message; got ${count}`);
    });

    test('thin-shim chokepoint: PROJECT eslint.config.js flags fs import on fixture', async () => {
      const projectConfigUrl = new URL('../eslint.config.js', import.meta.url);
      const projectConfigModule = await import(projectConfigUrl.href) as { default: Record<string, unknown>[] };
      // Filter global-ignores-only entries so the fixture is actually linted.
      const configWithoutGlobalIgnores = projectConfigModule.default.filter(entry => {
        const keys = Object.keys(entry);
        return !(keys.length === 1 && keys[0] === 'ignores');
      });
      // ALSO override the fixture-file path to appear under mcp/** so the file-scoped
      // D-09 block fires. ESLint matches by passed file path — we cheat by reading
      // the fixture content into a temp file under tests/fixtures/mcp-shape.ts? No —
      // simpler: assert the rule message text matches one of the project's exact strings.
      // The project's D-09 block targets mcp/**/*.ts; the fixture is at
      // tests/fixtures/lint-thin-shim-fixture.ts so it WON'T match the D-09 block.
      // We instead assert the PROJECT-WIDE 'no-restricted-imports' http rule fires on
      // the fixture's `import http from 'node:http'`-style content if present (D-09 fixture
      // import is `node:fs` which is NOT in the project-wide list). So we must spawn
      // ESLint against an mcp/-pathed copy of the fixture for the project block to fire.
      //
      // Approach: copy the fixture file to a tmp file under {repo}/mcp/_thin-shim-test.ts,
      // lint it, then delete. This makes the file-scoped block fire.
      const fs = await import('node:fs/promises');
      const fixtureContent = await fs.readFile(FIXTURE, 'utf-8');
      const tmpMcpPath = path.resolve('mcp/_thin-shim-fixture-tmp.ts');
      await fs.writeFile(tmpMcpPath, fixtureContent, 'utf-8');
      try {
        const eslint = new ESLint({
          overrideConfigFile: true,
          overrideConfig: configWithoutGlobalIgnores as never,
        });
        const results = await eslint.lintFiles([tmpMcpPath]);
        const ruleIds = (results[0]?.messages ?? []).map(m => m.ruleId);
        const count = ruleIds.filter(r => r === 'no-restricted-imports').length;
        assert.ok(count >= 1, `project eslint.config.js must flag fs import in mcp/** fixture; got ${count} no-restricted-imports messages, total: ${JSON.stringify(ruleIds)}`);
      } finally {
        await fs.unlink(tmpMcpPath).catch(() => {});
      }
    });

    test('thin-shim chokepoint: AST walk asserts handler body ≤30 statements', () => {
      const src = readFileSync(FIXTURE, 'utf-8');
      const ast = parse(src, { sourceType: 'module', ecmaVersion: 2022, range: true, loc: true });

      function countHandlerStatements(node: any): number[] {
        const counts: number[] = [];
        function walk(n: any) {
          if (!n || typeof n !== 'object') return;
          if (n.type === 'CallExpression'
              && n.callee?.type === 'MemberExpression'
              && (n.callee.property?.name === 'registerTool' || n.callee.property?.name === 'registerResource')) {
            const handler = n.arguments?.[n.arguments.length - 1];
            if (handler && (handler.type === 'ArrowFunctionExpression' || handler.type === 'FunctionExpression')) {
              const body = handler.body;
              if (body?.type === 'BlockStatement') {
                counts.push(body.body.length);
              }
            }
          }
          for (const k of Object.keys(n)) {
            const v = n[k];
            if (Array.isArray(v)) v.forEach(walk);
            else if (v && typeof v === 'object') walk(v);
          }
        }
        walk(node);
        return counts;
      }

      const counts = countHandlerStatements(ast);
      const maxCount = counts.reduce((a, b) => Math.max(a, b), 0);
      assert.ok(maxCount > 30, `fixture must contain a handler with >30 statements (D-09 budget violation); maxCount=${maxCount}, counts=${counts.join(',')}`);
    });

    // Future: when 02-04 lands mcp/server.ts, add a fourth test that AST-walks
    // mcp/server.ts itself and asserts maxCount <= 30 (positive case).
    ```

    The "future test" comment matters: 02-04 will add a positive-case test that walks the real `mcp/server.ts` and asserts every handler is ≤30. That test is included in 02-04's plan, not this one.
  </action>
  <verify>
    <automated>node scripts/run-tests.mjs tests/lint-thin-shim.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `test -f tests/lint-thin-shim.test.ts` succeeds
    - `grep -c "registerTool\|registerResource" tests/lint-thin-shim.test.ts` returns at least 2
    - `grep -c "@typescript-eslint/parser" tests/lint-thin-shim.test.ts` returns at least 1
    - `node scripts/run-tests.mjs tests/lint-thin-shim.test.ts` exits 0 (all 3 tests pass)
    - `npm run lint` exits 0
    - `npm run typecheck` exits 0
    - Cleanup verification: after test run, `test ! -f mcp/_thin-shim-fixture-tmp.ts` (tmp file deleted)
  </acceptance_criteria>
  <done>
    `tests/lint-thin-shim.test.ts` exists with 3 tests covering inline-rule, PROJECT-config-loaded (via tmp mcp/ copy), and AST-walk statement count. All pass. 02-04 has a working chokepoint to plan against.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Future-developer-supplied mcp/**/*.ts → CI lint | Untrusted-by-CI handler code; chokepoint enforces ≤30 statements + no direct fs imports |
| tmp file write to mcp/ during PROJECT test | Test creates a file under mcp/; concurrent test process could observe it briefly |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-01-01 | Tampering | Fat MCP handler accumulating untested branches | mitigate | D-09 chokepoint enforces statement ≤30 + no inline fs imports; this plan ships the test that makes the chokepoint regression-safe (Pitfall B5) |
| T-02-01-02 | Repudiation | Silent rule typo in eslint.config.js disables the gate | mitigate | PROJECT-config-loaded test (Task 3 Test 2) loads the real eslint.config.js and asserts the rule fires on the fixture — same Pitfall B5 mitigation pattern as tests/lint-paths-chokepoint.test.ts |
| T-02-01-03 | DoS | tmp file write under mcp/ collides with parallel test | accept | The tmp filename is deterministic but the test is single-threaded under node:test; if Phase 4+ adds test parallelism, a uuid-suffix can be added then. Phase 2 doesn't need it. |
| T-02-01-04 | Tampering | Future developer adds new mcp/** file with fs import | mitigate | npm run lint will fail in CI before merge (Wave-3 D-22 CI step) — block on merge per branch-protection |
</threat_model>

<verification>
- 3 tasks green per their acceptance criteria.
- `npm run check` exits 0 locally.
- Inline + PROJECT + AST-walk tests all pass against the fixture.
</verification>

<success_criteria>
- Contributes to SC-4 (MCP server tool handlers ≤30 lines, lint-checked) by shipping the lint gate before the implementation.
- Carry-forward CF-D09 closed.
- Wave 2 (02-04) can write mcp/server.ts handlers knowing the chokepoint will catch overgrowth at PR time.
</success_criteria>

<output>
After completion, create `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-01-SUMMARY.md`.
</output>
