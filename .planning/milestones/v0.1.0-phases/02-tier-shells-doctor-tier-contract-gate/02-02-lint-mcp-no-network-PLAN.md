---
phase: 02-tier-shells-doctor-tier-contract-gate
plan: 02
type: execute
wave: 1
depends_on: ["02-00", "02-01"]  # serial — shares eslint.config.js with 02-01 (write-conflict avoidance per plan-checker iter 2)
files_modified:
  - eslint.config.js
  - tests/fixtures/lint-mcp-no-network-fixture.ts
  - tests/lint-mcp-no-network.test.ts
autonomous: true
requirements:
  - ARCH-18
user_setup: []
must_haves:
  truths:
    - "mcp/**/*.ts is forbidden from calling net.createServer / http.createServer / tls.createServer / new Server() (per D-10 stdio-only lock)"
    - "Red-team fixture provably violates the chokepoint and the project ESLint config flags it"
    - "Inline-rule smoke test + PROJECT-config-loaded test both pass (Pitfall B5 mitigation pattern)"
  artifacts:
    - path: "tests/fixtures/lint-mcp-no-network-fixture.ts"
      provides: "Red-team file with net/http/tls.createServer + new Server() calls"
      contains: "_redTeam"
    - path: "tests/lint-mcp-no-network.test.ts"
      provides: "Inline + PROJECT-loaded ESLint-against-fixture regression gate"
      contains: "createServer"
    - path: "eslint.config.js"
      provides: "no-network selectors scoped to mcp/**/*.ts + fixture in global-ignores"
      contains: "lint-mcp-no-network-fixture.ts"
  key_links:
    - from: "eslint.config.js"
      to: "tests/fixtures/lint-mcp-no-network-fixture.ts"
      via: "global-ignores entry"
      pattern: "lint-mcp-no-network-fixture\\.ts"
    - from: "tests/lint-mcp-no-network.test.ts"
      to: "eslint.config.js"
      via: "dynamic import + filter global-ignores"
      pattern: "ignores"
---

<objective>
Land the SECOND of three new AST-walk chokepoint lint tests (D-10). Enforces MCP stdio-only transport by AST-walking `mcp/**/*.ts` for any `net.createServer` / `http.createServer` / `tls.createServer` / `new Server()` call. This MUST land BEFORE 02-04 (mcp/server.ts) — chokepoint lints land before the modules they protect. Belt-and-suspenders against accidental SSE/HTTP transport ever silently slipping in.

Purpose: Lock MCP transport to stdio mechanically; future SSE/HTTP transport is a separate phase decision with its own auth design (D-10 deferred).
Output: One red-team fixture + one test file + extension to eslint.config.js.
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
@tests/lint-atomic-write-chokepoint.test.ts
@tests/fixtures/lint-atomic-write-chokepoint-fixture.ts

<interfaces>
<!-- Analog: tests/lint-atomic-write-chokepoint.test.ts (single-selector CallExpression match
     + PROJECT-config-loaded variant) — exact shape to mirror per PATTERNS.md. -->

D-10 AST selectors (no-restricted-syntax, scoped to mcp/**/*.ts):
1. `CallExpression[callee.object.name='net'][callee.property.name='createServer']`
2. `CallExpression[callee.object.name='http'][callee.property.name='createServer']`
3. `CallExpression[callee.object.name='https'][callee.property.name='createServer']`
4. `CallExpression[callee.object.name='tls'][callee.property.name='createServer']`
5. `NewExpression[callee.name='Server']`

The HTTP-imports chokepoint (existing, lines 40-48 of eslint.config.js) already blocks `http`/`https`/`undici`/`net`-shaped imports project-wide — but does NOT block `tls` and does NOT block bare `new Server()`. The D-10 block adds the call-site / new-expression bans scoped to mcp/**.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create red-team fixture for MCP-no-network (D-10)</name>
  <files>tests/fixtures/lint-mcp-no-network-fixture.ts</files>
  <read_first>
    - tests/fixtures/lint-atomic-write-chokepoint-fixture.ts (entire — exact shape)
    - tests/fixtures/lint-paths-chokepoint-fixture.ts (entire — alt style)
    - .planning/phases/02-tier-shells-doctor-tier-contract-gate/02-PATTERNS.md § "Excerpt 2"
  </read_first>
  <action>
    Create the fixture with 5 intentional D-10 violations (one per banned construct):

    ```typescript
    // Red-team fixture for the D-10 MCP no-network chokepoint (Phase 2).
    // This file INTENTIONALLY violates the chokepoint by calling
    // net.createServer / http.createServer / tls.createServer / new Server().
    // It is ignored by the project ESLint config (eslint.config.js global-ignores)
    // so `npm run lint` over the repo passes. The chokepoint regression test at
    // tests/lint-mcp-no-network.test.ts runs ESLint programmatically against
    // THIS file and asserts the rule fires.
    //
    // @ts-nocheck — this file is never type-checked or executed.

    // imports are intentionally any-shaped to avoid type errors; the file is
    // never compiled or executed — only AST-walked.
    declare const net: any;
    declare const http: any;
    declare const https: any;
    declare const tls: any;
    declare const Server: any;

    // === D-10 violation: net.createServer() — non-stdio transport ===
    const s1 = net.createServer(() => {});

    // === D-10 violation: http.createServer() — non-stdio transport ===
    const s2 = http.createServer(() => {});

    // === D-10 violation: https.createServer() — non-stdio transport ===
    const s3 = https.createServer({}, () => {});

    // === D-10 violation: tls.createServer() — non-stdio transport ===
    const s4 = tls.createServer({}, () => {});

    // === D-10 violation: new Server() — generic server constructor ===
    const s5 = new Server();

    export const _redTeam = { s1, s2, s3, s4, s5 };
    ```
  </action>
  <verify>
    <automated>test -f tests/fixtures/lint-mcp-no-network-fixture.ts &amp;&amp; grep -c "_redTeam" tests/fixtures/lint-mcp-no-network-fixture.ts</automated>
  </verify>
  <acceptance_criteria>
    - `test -f tests/fixtures/lint-mcp-no-network-fixture.ts` succeeds
    - `grep -c "@ts-nocheck" tests/fixtures/lint-mcp-no-network-fixture.ts` returns at least 1
    - `grep -c "createServer" tests/fixtures/lint-mcp-no-network-fixture.ts` returns 4 (net/http/https/tls)
    - `grep -c "new Server()" tests/fixtures/lint-mcp-no-network-fixture.ts` returns at least 1
    - `grep -c "D-10 violation" tests/fixtures/lint-mcp-no-network-fixture.ts` returns 5
  </acceptance_criteria>
  <done>
    Fixture with 5 documented D-10 violations + standard @ts-nocheck / _redTeam envelope.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add D-10 no-network rules to eslint.config.js + fixture in global-ignores</name>
  <files>eslint.config.js</files>
  <read_first>
    - eslint.config.js (entire — confirm the D-09 block landed by 02-01 is present so we can insert the D-10 block right after it)
    - tests/lint-atomic-write-chokepoint.test.ts (entire — to see how the existing chokepoint selectors are wired)
  </read_first>
  <action>
    1. ADD `'tests/fixtures/lint-mcp-no-network-fixture.ts'` to the `ignores` array (alphabetically with the existing fixtures).

    2. ADD a new file-scoped config block AFTER the D-09 block landed by 02-01 (and before the exemption blocks at line 89+). The block targets `mcp/**/*.ts` ONLY:

       ```javascript
       // === D-10: MCP no-network chokepoint (Phase 2) ===
       // mcp/**/*.ts MUST NOT start a server on any network transport.
       // Stdio is the only allowed transport (per D-10 lock). Future SSE/HTTP
       // is a separate phase decision with its own auth design.
       //
       // The HTTP-imports rule above (lines 40-48) already blocks the
       // `http`/`https`/`net` MODULE imports project-wide; this block extends
       // the ban to the CALL-SITE level inside mcp/** so a developer can't
       // sneak in a server via dynamic import or destructured re-export.
       {
         files: ['mcp/**/*.ts'],
         rules: {
           'no-restricted-syntax': ['error',
             {
               selector: "CallExpression[callee.object.name='net'][callee.property.name='createServer']",
               message: 'D-10 stdio-only: net.createServer() is forbidden in mcp/ — only stdio transport is allowed',
             },
             {
               selector: "CallExpression[callee.object.name='http'][callee.property.name='createServer']",
               message: 'D-10 stdio-only: http.createServer() is forbidden in mcp/ — only stdio transport is allowed',
             },
             {
               selector: "CallExpression[callee.object.name='https'][callee.property.name='createServer']",
               message: 'D-10 stdio-only: https.createServer() is forbidden in mcp/ — only stdio transport is allowed',
             },
             {
               selector: "CallExpression[callee.object.name='tls'][callee.property.name='createServer']",
               message: 'D-10 stdio-only: tls.createServer() is forbidden in mcp/ — only stdio transport is allowed',
             },
             {
               selector: "NewExpression[callee.name='Server']",
               message: 'D-10 stdio-only: new Server() is forbidden in mcp/ — only stdio transport is allowed',
             },
           ],
         },
       },
       ```

       Important: this block ADDS to the project-wide `no-restricted-syntax` rule (it replaces it for the matched files — ESLint flat config merges by overwriting). The project-wide rule has 6 selectors (D-07 + D-41); the override for mcp/** narrows to ONLY the D-10 selectors. If a developer adds a DOI-regex inside mcp/server.ts, they would NOT be caught here — but the project-wide rule should still apply because flat-config merges. Verify this by ensuring the D-10 block is PURELY ADDITIVE: if ESLint flat-config semantics replace per-file rules entirely, ADD the D-07 + D-41 selectors back here too. (As a safety net, include the D-07 DOI selector explicitly — the existing project-wide D-07 already exempts bin/lib/doi.ts, not mcp/, so DOI regex in mcp/ is also blocked by the project-wide rule. If flat-config merging is replace-not-merge, this is the only way to keep coverage.)

       The cleanest implementation: use a DIFFERENT rule name. ESLint 9 flat config merges rules of the same name by override; using two no-restricted-syntax blocks for the same file will override the project-wide one. To avoid the merge ambiguity, this plan uses `no-restricted-syntax` and INCLUDES all 6 project-wide selectors INSIDE the mcp/** block too — so a developer writing DOI regex in mcp/server.ts is still caught.

       FINAL block (use this version):

       ```javascript
       {
         files: ['mcp/**/*.ts'],
         rules: {
           'no-restricted-syntax': ['error',
             // project-wide selectors re-listed (D-07, D-41 — override-merge safety):
             { selector: "Literal[regex.pattern=/^\\^10\\\\\\./]", message: 'DOI regex /^10\\./ is a chokepoint — use bin/lib/doi.ts only' },
             { selector: "CallExpression[callee.property.name='writeFile']", message: 'Direct fs.writeFile is forbidden (ARCH-05 / D-07) — use bin/lib/atomic-write.ts' },
             { selector: "MemberExpression[object.name='os'][property.name='homedir']", message: 'os.homedir() is a chokepoint (D-41) — use bin/lib/paths.ts' },
             { selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='LOCALAPPDATA']", message: 'process.env.LOCALAPPDATA is a chokepoint (D-41) — use bin/lib/paths.ts' },
             { selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='APPDATA']", message: 'process.env.APPDATA is a chokepoint (D-41) — use bin/lib/paths.ts (use LOCALAPPDATA, not APPDATA — Pitfall 4)' },
             { selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='XDG_DATA_HOME']", message: 'process.env.XDG_DATA_HOME is a chokepoint (D-41) — use bin/lib/paths.ts' },
             // D-10 stdio-only:
             { selector: "CallExpression[callee.object.name='net'][callee.property.name='createServer']", message: 'D-10 stdio-only: net.createServer() is forbidden in mcp/' },
             { selector: "CallExpression[callee.object.name='http'][callee.property.name='createServer']", message: 'D-10 stdio-only: http.createServer() is forbidden in mcp/' },
             { selector: "CallExpression[callee.object.name='https'][callee.property.name='createServer']", message: 'D-10 stdio-only: https.createServer() is forbidden in mcp/' },
             { selector: "CallExpression[callee.object.name='tls'][callee.property.name='createServer']", message: 'D-10 stdio-only: tls.createServer() is forbidden in mcp/' },
             { selector: "NewExpression[callee.name='Server']", message: 'D-10 stdio-only: new Server() is forbidden in mcp/' },
           ],
         },
       },
       ```

    3. Verify: `npm run lint` over the project — expect 0 errors. `npm run typecheck` — expect green.
  </action>
  <verify>
    <automated>npm run lint &amp;&amp; npm run typecheck</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "lint-mcp-no-network-fixture.ts" eslint.config.js` returns at least 1
    - `grep -c "D-10 stdio-only" eslint.config.js` returns at least 5 (one per selector message)
    - `grep -c "createServer" eslint.config.js` returns at least 4 (selectors)
    - `npm run lint` exits 0
    - `npm run typecheck` exits 0
    - `node scripts/run-tests.mjs tests/repo-files.test.ts` exits 0 (the eslint.config.js content-match test still passes)
    - The eslint.config.js D-09 block from 02-01 is still present (`grep -c "D-09 thin-shim" eslint.config.js` >= 1)
  </acceptance_criteria>
  <done>
    eslint.config.js declares the D-10 chokepoint rules scoped to mcp/**/*.ts (with project-wide D-07/D-41 selectors re-included so the file-scoped override doesn't lose existing coverage). Fixture is global-ignored. Lint + typecheck green.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Create tests/lint-mcp-no-network.test.ts (inline + PROJECT-config)</name>
  <files>tests/lint-mcp-no-network.test.ts</files>
  <read_first>
    - tests/lint-atomic-write-chokepoint.test.ts (entire — exact shape to mirror)
    - tests/lint-paths-chokepoint.test.ts (lines 79-104 — the project-config-loaded variant)
    - .planning/phases/02-tier-shells-doctor-tier-contract-gate/02-PATTERNS.md § "Excerpt 1"
    - eslint.config.js (just modified in Task 2)
    - tests/fixtures/lint-mcp-no-network-fixture.ts (just created in Task 1)
  </read_first>
  <behavior>
    - Test 1 (INLINE): Run ESLint with inline override containing the 5 D-10 selectors. Assert ≥5 `no-restricted-syntax` messages fire on the fixture.
    - Test 2 (PROJECT-config-loaded): Copy the fixture to a tmp file under `mcp/_no-network-fixture-tmp.ts`, load the project's `eslint.config.js`, filter global-ignores, lint the tmp file, assert ≥5 `no-restricted-syntax` messages fire. Clean up tmp file.
  </behavior>
  <action>
    Model directly on `tests/lint-paths-chokepoint.test.ts` (the closest analog with both inline + PROJECT variants). Two tests only — no AST-walk-statement-count test needed since this chokepoint is pure selector-based.

    ```typescript
    // tests/lint-mcp-no-network.test.ts
    // Regression gate for the D-10 MCP no-network chokepoint (Phase 2).
    //
    // D-10: mcp/**/*.ts MUST NOT call net/http/https/tls.createServer or
    // construct a generic `new Server()`. Stdio is the only allowed transport.
    //
    // Two tests (Pitfall B5 mitigation):
    //   (1) INLINE: inline-rule smoke test against fixture, proves selector
    //       shape is structurally valid.
    //   (2) PROJECT: load the real eslint.config.js, filter out global-ignores,
    //       copy fixture to mcp/_no-network-fixture-tmp.ts (so the file-scoped
    //       D-10 block fires), lint it, assert ≥5 violations.

    import test from 'node:test';
    import assert from 'node:assert/strict';
    import { ESLint } from 'eslint';
    import path from 'node:path';
    import fsp from 'node:fs/promises';

    const FIXTURE = path.resolve('tests/fixtures/lint-mcp-no-network-fixture.ts');

    test('D-10 no-network: inline rule flags all 5 fixture violations', async () => {
      const eslint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [{
          files: ['**/*.ts'],
          languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
          rules: {
            'no-restricted-syntax': ['error',
              { selector: "CallExpression[callee.object.name='net'][callee.property.name='createServer']", message: 'D-10' },
              { selector: "CallExpression[callee.object.name='http'][callee.property.name='createServer']", message: 'D-10' },
              { selector: "CallExpression[callee.object.name='https'][callee.property.name='createServer']", message: 'D-10' },
              { selector: "CallExpression[callee.object.name='tls'][callee.property.name='createServer']", message: 'D-10' },
              { selector: "NewExpression[callee.name='Server']", message: 'D-10' },
            ],
          },
        }],
      });
      const results = await eslint.lintFiles([FIXTURE]);
      assert.equal(results.length, 1);
      const count = (results[0]?.messages ?? []).filter(m => m.ruleId === 'no-restricted-syntax').length;
      assert.ok(count >= 5, `expected >=5; got ${count}: ${JSON.stringify(results[0]?.messages)}`);
    });

    test('D-10 no-network: PROJECT eslint.config.js flags 5 violations on mcp/-pathed fixture', async () => {
      const projectConfigUrl = new URL('../eslint.config.js', import.meta.url);
      const projectConfigModule = await import(projectConfigUrl.href) as { default: Record<string, unknown>[] };
      const configWithoutGlobalIgnores = projectConfigModule.default.filter(entry => {
        const keys = Object.keys(entry);
        return !(keys.length === 1 && keys[0] === 'ignores');
      });
      const fixtureContent = await fsp.readFile(FIXTURE, 'utf-8');
      const tmpMcpPath = path.resolve('mcp/_no-network-fixture-tmp.ts');
      await fsp.writeFile(tmpMcpPath, fixtureContent, 'utf-8');
      try {
        const eslint = new ESLint({
          overrideConfigFile: true,
          overrideConfig: configWithoutGlobalIgnores as never,
        });
        const results = await eslint.lintFiles([tmpMcpPath]);
        const ruleIds = (results[0]?.messages ?? []).map(m => m.ruleId);
        const count = ruleIds.filter(r => r === 'no-restricted-syntax').length;
        assert.ok(count >= 5, `project eslint.config.js must flag all 5 D-10 violations; got ${count}, total ruleIds: ${JSON.stringify(ruleIds)}`);
      } finally {
        await fsp.unlink(tmpMcpPath).catch(() => {});
      }
    });
    ```
  </action>
  <verify>
    <automated>node scripts/run-tests.mjs tests/lint-mcp-no-network.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `test -f tests/lint-mcp-no-network.test.ts` succeeds
    - `grep -c "createServer" tests/lint-mcp-no-network.test.ts` >= 4
    - `grep -c "NewExpression\[callee.name='Server'\]" tests/lint-mcp-no-network.test.ts` >= 1
    - `node scripts/run-tests.mjs tests/lint-mcp-no-network.test.ts` exits 0
    - `npm run lint && npm run typecheck` both exit 0
    - Cleanup verification: `test ! -f mcp/_no-network-fixture-tmp.ts` after test run
  </acceptance_criteria>
  <done>
    `tests/lint-mcp-no-network.test.ts` exists with 2 tests (inline + PROJECT-loaded via tmp mcp/ copy). All pass. 02-04 has the no-network gate in place before mcp/server.ts is written.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Future-developer-supplied mcp/**/*.ts → CI lint | Chokepoint blocks any net/http/https/tls.createServer + new Server() |
| tmp file write to mcp/ during PROJECT test | Same as 02-01 — single-threaded under node:test |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-02-01 | Spoofing / Elevation | Accidental SSE/HTTP MCP transport via `http.createServer` | mitigate | D-10 selector blocks all 4 server constructors + bare `new Server()` in mcp/** (Task 2); regression-locked by Task 3 |
| T-02-02-02 | Repudiation | Silent typo in selector disables D-10 | mitigate | PROJECT-config-loaded test (Task 3 Test 2) loads real eslint.config.js and asserts the rule fires |
| T-02-02-03 | Tampering | Developer disables rule with eslint-disable comment | accept | Per-file disables are caught at code review; this plan does not police comment-level disables |
| T-02-02-04 | Information Disclosure | New transport added in a future phase | mitigate | D-10 lock is documented in CONTEXT.md; future SSE/HTTP requires explicit discuss-phase decision + auth design before lifting the lint rule |
</threat_model>

<verification>
- 3 tasks green per their acceptance criteria.
- `npm run check` exits 0 locally.
- All inline + PROJECT tests pass against the fixture.
</verification>

<success_criteria>
- Contributes to SC-4 (MCP server stdio-only locked) by shipping the lint gate before the implementation.
- Carry-forward CF-D10 closed.
- 02-04 can write `mcp/server.ts` using `StdioServerTransport` knowing any drift to non-stdio is caught at PR time.
</success_criteria>

<output>
After completion, create `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-02-SUMMARY.md`.
</output>
