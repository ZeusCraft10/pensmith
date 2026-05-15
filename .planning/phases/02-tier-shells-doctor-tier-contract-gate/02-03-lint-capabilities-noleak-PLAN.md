---
phase: 02-tier-shells-doctor-tier-contract-gate
plan: 03
type: execute
wave: 1
depends_on: ["02-00"]
files_modified:
  - tests/fixtures/lint-capabilities-noleak-fixture.ts
  - eslint.config.js
  - tests/lint-capabilities-noleak.test.ts
autonomous: true
requirements: [ARCH-18]
must_haves:
  truths:
    - "Any expression of shape `process.env[<computed>]` inside mcp/** triggers an ESLint error"
    - "Any inline call to `getProviderApiKey` / `getOpenAlexApiKey` / `loadRuntimeConfig` inside mcp/** triggers an ESLint error"
    - "Lint runs on the project as-shipped (not just a stand-alone Linter instance)"
  artifacts:
    - path: "tests/fixtures/lint-capabilities-noleak-fixture.ts"
      provides: "Red-team fixture that MUST fail D-12 selectors"
    - path: "eslint.config.js"
      provides: "D-12 selectors scoped to mcp/**/*.ts"
    - path: "tests/lint-capabilities-noleak.test.ts"
      provides: "INLINE + PROJECT-config-loaded assertions"
  key_links:
    - from: "tests/lint-capabilities-noleak.test.ts"
      to: "eslint.config.js"
      via: "ESLint.loadESLint({ overrideConfigFile })"
      pattern: "loadESLint.*eslint\\.config\\.js"
    - from: "eslint.config.js D-12 block"
      to: "tests/fixtures/lint-capabilities-noleak-fixture.ts (when copied into mcp/)"
      via: "files: ['mcp/**/*.ts']"
      pattern: "mcp\\/\\*\\*\\/\\*\\.ts"
---

<objective>
Land the third Wave 1 AST-walk lint chokepoint: D-12 capabilities-no-leak. This selector
fires on any expression inside `mcp/**/*.ts` that could surface a secret through the
`paper://capabilities` resource — namely (a) computed `process.env[...]` reads and
(b) inline calls to the chokepoint helpers in `bin/lib/runtime.ts`.

Per Phase 0/1 Pitfall 7 (codified as project rule): **the chokepoint lands BEFORE the
module it protects.** `mcp/server.ts` (where the capabilities handler will live) ships
in 02-04 — this plan ensures the rail is in place first.

Purpose: D-12 enforces that capabilities NEVER materialises a provider key value. The
handler is allowed to emit `present: boolean` flags only. The selector blocks the two
most-likely accidents:
1. Computed env-var access (`process.env[provider.apiKeyEnv]`) — bypasses static analysis.
2. Inline calls to `getProviderApiKey()` / `getOpenAlexApiKey()` / `loadRuntimeConfig()` —
   those helpers return the resolved value to the caller; mcp/ should never see it.

Output: a chokepoint-locked `mcp/**/*.ts` scope that fails CI if anyone writes a
capabilities handler that could leak a secret.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-CONTEXT.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-PATTERNS.md
@.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-VALIDATION.md
@eslint.config.js
@tests/lint-paths-chokepoint.test.ts
@bin/lib/runtime.ts

<interfaces>
<!-- Selectors to add inside the mcp/** block of eslint.config.js. D-12. -->
<!-- Pattern source: RESEARCH § Pitfall 6 (capabilities-shaped data must be -->
<!-- presence-flags-only) + bin/lib/runtime.ts:438-462 (chokepoint helpers). -->

D-12 selectors (added inside `files: ['mcp/**/*.ts']` block — file-scoped override):

```js
{
  files: ['mcp/**/*.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      // Re-include project-wide D-07 / D-41 (flat-config override semantics:
      // matched file-scoped rules REPLACE the project-wide entry rather than merge).
      { selector: "CallExpression[callee.object.name='console'][callee.property.name=/^(log|info|warn|error)$/]", message: 'D-07: no console.* in mcp/ — corrupts stdio MCP frame (Pitfall 7)' },
      // D-12 (this plan):
      { selector: "MemberExpression[object.object.name='process'][object.property.name='env'][computed=true]", message: 'D-12: computed process.env[…] read forbidden in mcp/ — capabilities must surface only presence flags. Read via bin/lib/runtime.ts in non-mcp code, then expose boolean to mcp via paper://state.' },
      { selector: "CallExpression[callee.name=/^(getProviderApiKey|getOpenAlexApiKey|loadRuntimeConfig)$/]", message: 'D-12: do not call runtime.ts secret-resolution helpers inside mcp/. Those return the resolved value to the caller. Expose presence flags only via paper://capabilities.' },
    ],
    // Existing D-09 (from 02-01) + D-10 (from 02-02) selectors remain in their
    // respective file-scoped blocks above this one. Each mcp/** block is
    // independent — flat-config evaluates them in order and the last-matching
    // wins per rule-name. Plan 02-04 will consolidate if order-coupling appears.
  },
}
```

Helpers the selector explicitly forbids inside mcp/** (from `bin/lib/runtime.ts`):

```typescript
// bin/lib/runtime.ts — NOT for mcp/ consumption:
export async function getOpenAlexApiKey(opts): Promise<string | undefined>
export async function getProviderApiKey(opts): Promise<string | undefined>  // (extracted in 02-04 if not present)
export async function loadRuntimeConfig(opts): Promise<RuntimeConfig>
```

These resolve actual secret values. The capabilities handler in 02-04 must consume
`paper://state` (which exposes presence booleans only) — never these helpers directly.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create red-team fixture for D-12 capabilities-no-leak selector</name>
  <files>tests/fixtures/lint-capabilities-noleak-fixture.ts</files>
  <read_first>
    - `bin/lib/runtime.ts` lines 1-50 (top imports + types) and 430-462 (`getOpenAlexApiKey` — the no-leak pattern we are protecting)
    - `tests/fixtures/lint-thin-shim-fixture.ts` (sibling fixture from 02-01 — file shape and header comment style)
    - `tests/fixtures/lint-mcp-no-network-fixture.ts` (sibling fixture from 02-02)
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md` § Pitfall 6 (presence-flags-only)
  </read_first>
  <behavior>
    The fixture file MUST contain at minimum the following violations (each one a
    distinct AST node the D-12 selector should fire on):
    - Test 1: `process.env[provider.apiKeyEnv]` — computed MemberExpression on `process.env` (D-12 selector A).
    - Test 2: `process.env[envName]` — computed via local variable (D-12 selector A).
    - Test 3: `await getProviderApiKey({ scope: 'paper' })` — inline call (D-12 selector B).
    - Test 4: `await getOpenAlexApiKey()` — inline call (D-12 selector B).
    - Test 5: `await loadRuntimeConfig()` — inline call (D-12 selector B).
    The fixture file MUST also import the three helpers from `../../bin/lib/runtime.ts`
    so the call-expression nodes type-resolve at lint time. Static `process.env.FOO`
    (dot-access, non-computed) MUST NOT appear — that form is permitted.
  </behavior>
  <action>
    Create `tests/fixtures/lint-capabilities-noleak-fixture.ts` with this exact body
    (per D-12, per RESEARCH § Pitfall 6, per the chokepoint pattern established in
    02-01 / 02-02):

    ```typescript
    // tests/fixtures/lint-capabilities-noleak-fixture.ts
    //
    // RED-TEAM fixture for D-12 (capabilities-no-leak AST chokepoint).
    // This file MUST trigger ESLint errors when scoped under `mcp/**/*.ts`.
    //
    // Each numbered comment marks a violation that the selectors in
    // eslint.config.js (D-12 block) are required to flag. Re-use of this file
    // happens via tmp-copy into `mcp/_capabilities-noleak-fixture-tmp.ts`
    // during the PROJECT-config-loaded test.
    //
    // DO NOT import this file from production code. It exists only for tests.

    import {
      getProviderApiKey,
      getOpenAlexApiKey,
      loadRuntimeConfig,
    } from '../../bin/lib/runtime.js';

    interface Provider {
      id: string;
      apiKeyEnv: string;
    }

    export async function handleCapabilitiesRead(provider: Provider) {
      // Violation 1: computed process.env[<MemberExpression>] (D-12 selector A)
      const directComputed = process.env[provider.apiKeyEnv];

      // Violation 2: computed process.env[<Identifier>] via local var (D-12 selector A)
      const envName = provider.apiKeyEnv;
      const indirectComputed = process.env[envName];

      // Violation 3: inline getProviderApiKey() call (D-12 selector B)
      const providerKey = await getProviderApiKey({ scope: 'paper' });

      // Violation 4: inline getOpenAlexApiKey() call (D-12 selector B)
      const openalexKey = await getOpenAlexApiKey();

      // Violation 5: inline loadRuntimeConfig() call (D-12 selector B)
      const cfg = await loadRuntimeConfig();

      return {
        // The whole point of D-12: even building this object is forbidden in mcp/.
        provider: {
          present: !!directComputed || !!indirectComputed || !!providerKey,
          value: directComputed, // <- THIS is the leak D-12 prevents
        },
        openalex: { present: !!openalexKey },
        cfgProviders: cfg.providers,
      };
    }

    // Non-violation control: static dot-access. MUST NOT fire.
    export function staticEnvAccess() {
      return process.env.HOME;
    }
    ```

    Self-check: `grep -nE "process\.env\[|getProviderApiKey\(|getOpenAlexApiKey\(|loadRuntimeConfig\(" tests/fixtures/lint-capabilities-noleak-fixture.ts | grep -v '^#'`
    MUST report at least 5 violation sites.
  </action>
  <verify>
    <automated>node -e "const f=require('node:fs').readFileSync('tests/fixtures/lint-capabilities-noleak-fixture.ts','utf8'); const hits=[/process\.env\[provider\.apiKeyEnv\]/,/process\.env\[envName\]/,/await getProviderApiKey\(/,/await getOpenAlexApiKey\(/,/await loadRuntimeConfig\(/].filter(re=>re.test(f)); if(hits.length!==5){console.error('expected 5 violation sites, got',hits.length);process.exit(1)} if(/process\.env\.HOME/.test(f)===false){console.error('missing control case');process.exit(1)} console.log('OK 5 violations + 1 control')"</automated>
  </verify>
  <acceptance_criteria>
    - File exists at `tests/fixtures/lint-capabilities-noleak-fixture.ts`.
    - `grep -c "process.env\[" tests/fixtures/lint-capabilities-noleak-fixture.ts` (after `grep -v '^//'`) returns 2.
    - `grep -c "getProviderApiKey(" tests/fixtures/lint-capabilities-noleak-fixture.ts` (after `grep -v '^//'`) returns at least 1.
    - `grep -c "getOpenAlexApiKey(" tests/fixtures/lint-capabilities-noleak-fixture.ts` (after `grep -v '^//'`) returns at least 1.
    - `grep -c "loadRuntimeConfig(" tests/fixtures/lint-capabilities-noleak-fixture.ts` (after `grep -v '^//'`) returns at least 1.
    - `grep -c "process.env.HOME" tests/fixtures/lint-capabilities-noleak-fixture.ts` returns at least 1 (control case present).
  </acceptance_criteria>
  <done>
    Fixture committed. The file deliberately fails D-12 — Task 3 will assert that lint
    reports those exact violations and only those.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add D-12 selectors to eslint.config.js scoped to mcp/**</name>
  <files>eslint.config.js</files>
  <read_first>
    - `eslint.config.js` in full (existing flat-config structure, project-wide selectors at lines 60-85, global-ignores at 161-169)
    - The mcp/** override block added by **02-01** (D-09 thin-shim) and the one added by **02-02** (D-10 mcp-no-network) — those land in Wave 1 before this task
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-RESEARCH.md` § Pitfall 6 + § AST-Walk Chokepoint Pattern
    - `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-PATTERNS.md` (eslint.config.js excerpt)
  </read_first>
  <action>
    Append a new file-scoped configuration object to the `export default [...]` array
    in `eslint.config.js`, AFTER the 02-01 and 02-02 mcp/** blocks. Use this exact
    shape (note: flat-config's `no-restricted-syntax` is array-valued and the
    last-matching file-scoped block wins per rule name, so this block must
    **re-include the project-wide D-07/D-41 selectors AND the D-09 + D-10 selectors**
    that the earlier mcp/** blocks added — otherwise this file-scoped rule
    REPLACES those rather than extending them. Source of this constraint:
    ESLint 9 flat-config semantics + 02-02 plan's same fix.):

    ```js
    // D-12 — capabilities-no-leak chokepoint (file-scoped to mcp/**/*.ts)
    // Re-includes D-07/D-41 (project-wide) + D-09 (from 02-01) + D-10 (from 02-02)
    // to preserve coverage under flat-config last-match semantics.
    {
      files: ['mcp/**/*.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          // D-07 (project-wide, re-included):
          {
            selector: "CallExpression[callee.object.name='console'][callee.property.name=/^(log|info|warn|error|debug|trace)$/]",
            message: 'D-07 / Pitfall 7: no console.* in mcp/** — corrupts stdio MCP frame. Use process.stderr.write or log().event instead.',
          },
          // D-41 (project-wide, re-included — replace selector with whatever D-41
          // currently asserts; copy from the top-level project-wide block):
          // (NOTE for executor: re-read eslint.config.js lines 60-85 and copy the
          //  exact D-41 selector verbatim. Do NOT paraphrase. If D-41 is not
          //  present in the project-wide block, omit this entry.)
          // D-09 (from 02-01, re-included):
          {
            selector: "ImportDeclaration[source.value=/^(node:)?(fs|fs\\/promises|http|https|net|tls|child_process)$/]",
            message: 'D-09: mcp/ tool handlers must be thin shims — fs / http / process imports forbidden. Delegate to bin/lib/* via paper://state and paper://library resources.',
          },
          // D-10 (from 02-02, re-included):
          {
            selector: "CallExpression[callee.object.name='net'][callee.property.name='createServer']",
            message: 'D-10: mcp/ runs over stdio transport only. No raw socket servers.',
          },
          {
            selector: "CallExpression[callee.object.name='http'][callee.property.name='createServer']",
            message: 'D-10: mcp/ runs over stdio transport only. No HTTP servers.',
          },
          {
            selector: "CallExpression[callee.object.name='https'][callee.property.name='createServer']",
            message: 'D-10: mcp/ runs over stdio transport only. No HTTPS servers.',
          },
          {
            selector: "CallExpression[callee.object.name='tls'][callee.property.name='createServer']",
            message: 'D-10: mcp/ runs over stdio transport only. No TLS servers.',
          },
          {
            selector: "NewExpression[callee.name='Server'][arguments.0.type='ObjectExpression']",
            message: 'D-10: instantiate via McpServer + StdioServerTransport (mcp/server.ts pattern), never raw new Server().',
          },
          // ---- D-12 (this plan) ----
          {
            selector: "MemberExpression[object.object.name='process'][object.property.name='env'][computed=true]",
            message: 'D-12: computed process.env[…] read forbidden in mcp/**. Capabilities must surface only presence flags. Read secrets via bin/lib/runtime.ts in non-mcp code, then expose boolean to mcp via paper://state.',
          },
          {
            selector: "CallExpression[callee.name=/^(getProviderApiKey|getOpenAlexApiKey|loadRuntimeConfig)$/]",
            message: 'D-12: do not call runtime.ts secret-resolution helpers inside mcp/**. Those return the resolved value to the caller. Expose presence flags only via paper://capabilities.',
          },
        ],
      },
    },
    ```

    Per **D-21 (discipline rule)**: do NOT add a normalizer or a runtime
    capabilities-builder helper to dissolve this. The point of the chokepoint is
    that the rule fires; the fix is to make tiers agree by NOT writing the leak
    in the first place.

    Self-check after edit:
    - `grep -c "D-12" eslint.config.js` MUST return at least 2 (one comment header + at least one selector message).
    - `grep -c "mcp/\*\*/\*\.ts" eslint.config.js` MUST return at least 3 (one per file-scoped block: D-09 from 02-01, D-10 from 02-02, D-12 from this plan).
    - `npx eslint eslint.config.js --no-warn-ignored` MUST exit 0 (the config file itself must remain lint-clean).
  </action>
  <verify>
    <automated>node -e "const c=require('node:fs').readFileSync('eslint.config.js','utf8'); if(!/D-12.*computed process\.env/s.test(c)){console.error('D-12 computed env selector missing');process.exit(1)} if(!/getProviderApiKey\|getOpenAlexApiKey\|loadRuntimeConfig/.test(c)){console.error('D-12 helpers selector missing');process.exit(1)} const blockCount=(c.match(/files:\s*\['mcp\/\*\*\/\*\.ts'\]/g)||[]).length; if(blockCount<3){console.error('expected at least 3 mcp/** blocks (D-09, D-10, D-12), got',blockCount);process.exit(1)} console.log('OK D-12 block present, mcp blocks:',blockCount)" &amp;&amp; npx eslint eslint.config.js --no-warn-ignored</automated>
  </verify>
  <acceptance_criteria>
    - `eslint.config.js` contains a `files: ['mcp/**/*.ts']` block whose `no-restricted-syntax` array includes both D-12 selectors.
    - The D-12 block re-includes D-07, D-09, and D-10 selectors verbatim (flat-config last-match preservation).
    - `npx eslint eslint.config.js --no-warn-ignored` exits 0.
    - No production source files outside `mcp/**` are affected by the new selectors (sanity: `npx eslint bin/ --no-warn-ignored` continues to pass — Phase 1 baseline).
  </acceptance_criteria>
  <done>
    Selectors registered. Task 3 will load this exact config in a tmp project and
    prove the fixture lights up with the right error messages.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Create tests/lint-capabilities-noleak.test.ts (INLINE + PROJECT)</name>
  <files>tests/lint-capabilities-noleak.test.ts</files>
  <read_first>
    - `tests/lint-paths-chokepoint.test.ts` in full (the two-test structure: INLINE Linter instance + PROJECT-config-loaded via `ESLint.loadESLint`)
    - `tests/lint-thin-shim.test.ts` (from 02-01) and `tests/lint-mcp-no-network.test.ts` (from 02-02) — the two-test structure mirrored
    - `tests/fixtures/lint-capabilities-noleak-fixture.ts` (just created by Task 1)
    - `eslint.config.js` (just modified by Task 2)
  </read_first>
  <behavior>
    - **INLINE test** ("D-12 selectors fire on fixture under inline Linter config"):
      Construct a `new Linter()` with the D-12 selectors only (rules block copied
      inline into the test), feed it the fixture source, assert ≥5 lint messages
      and that each message text contains `D-12`.
    - **PROJECT test** ("D-12 selectors fire when the real eslint.config.js loads"):
      Copy `tests/fixtures/lint-capabilities-noleak-fixture.ts` to a tmp path
      `mcp/_capabilities-noleak-fixture-tmp.ts` so the `files: ['mcp/**/*.ts']`
      glob actually matches; run `ESLint.lintFiles([tmpPath])`; assert ≥5
      messages all containing `D-12`; assert the control export `staticEnvAccess`
      does NOT produce any D-12 message (line offset of the control line is
      not flagged). `finally` block unlinks the tmp file even on failure.
    - **Control test** ("static process.env.FOO is allowed"): inline-lint
      `export const x = process.env.HOME;` and assert zero D-12 messages.
  </behavior>
  <action>
    Create `tests/lint-capabilities-noleak.test.ts` modeled exactly on
    `tests/lint-paths-chokepoint.test.ts` and the sibling 02-01 / 02-02 tests.
    Required shape:

    ```typescript
    // tests/lint-capabilities-noleak.test.ts
    //
    // D-12 capabilities-no-leak AST chokepoint — coverage test.
    //
    // Two-test pattern (matches tests/lint-paths-chokepoint.test.ts):
    //  1. INLINE: Linter instance with D-12 rules pasted in — fast, hermetic.
    //  2. PROJECT: ESLint.loadESLint({ overrideConfigFile: 'eslint.config.js' })
    //     applied to a tmp copy of the fixture placed under mcp/ so the
    //     file-scoped block actually triggers.

    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    import { Linter, ESLint } from 'eslint';
    import { readFileSync, copyFileSync, unlinkSync, existsSync } from 'node:fs';
    import { join } from 'node:path';
    import tsParser from '@typescript-eslint/parser';

    const FIXTURE = 'tests/fixtures/lint-capabilities-noleak-fixture.ts';

    const D12_RULES = {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.object.name='process'][object.property.name='env'][computed=true]",
          message: 'D-12: computed process.env[…] read forbidden in mcp/**.',
        },
        {
          selector: "CallExpression[callee.name=/^(getProviderApiKey|getOpenAlexApiKey|loadRuntimeConfig)$/]",
          message: 'D-12: do not call runtime.ts secret-resolution helpers inside mcp/**.',
        },
      ],
    } as const;

    test('D-12 INLINE: selectors fire on red-team fixture', () => {
      const linter = new Linter();
      const code = readFileSync(FIXTURE, 'utf8');
      const messages = linter.verify(code, {
        languageOptions: {
          parser: tsParser as unknown as Linter.Parser,
          parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
        },
        rules: D12_RULES.rules ?? D12_RULES,
      });
      const d12 = messages.filter((m) => /D-12/.test(m.message));
      assert.ok(d12.length >= 5, `expected >=5 D-12 messages, got ${d12.length}: ${JSON.stringify(messages, null, 2)}`);
    });

    test('D-12 INLINE: static dot-access process.env.FOO is allowed', () => {
      const linter = new Linter();
      const messages = linter.verify(
        'export const home = process.env.HOME;',
        {
          languageOptions: {
            parser: tsParser as unknown as Linter.Parser,
            parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
          },
          rules: D12_RULES.rules ?? D12_RULES,
        },
      );
      const d12 = messages.filter((m) => /D-12/.test(m.message));
      assert.equal(d12.length, 0, `static env access should not trip D-12, got: ${JSON.stringify(messages)}`);
    });

    test('D-12 PROJECT: real eslint.config.js fires on fixture copied to mcp/', async () => {
      const tmpPath = join('mcp', '_capabilities-noleak-fixture-tmp.ts');
      copyFileSync(FIXTURE, tmpPath);
      try {
        const ESLintCtor = await ESLint.loadESLint({ useFlatConfig: true });
        const eslint = new ESLintCtor({
          overrideConfigFile: 'eslint.config.js',
        });
        const results = await eslint.lintFiles([tmpPath]);
        assert.equal(results.length, 1, 'expected one lint result');
        const messages = results[0].messages;
        const d12 = messages.filter((m) => /D-12/.test(m.message));
        assert.ok(
          d12.length >= 5,
          `expected >=5 D-12 messages from project config, got ${d12.length}: ${JSON.stringify(messages, null, 2)}`,
        );
      } finally {
        if (existsSync(tmpPath)) unlinkSync(tmpPath);
      }
    });
    ```

    Notes for executor:
    - Run `node scripts/run-tests.mjs tests/lint-capabilities-noleak.test.ts` after writing.
    - If `ESLint.loadESLint` is unavailable (older API), fall back to `new ESLint({ overrideConfigFile: 'eslint.config.js' })` — see how 02-01 / 02-02 settled this. Match whichever form those two tests use after they land.
    - Per **D-21**: if this test FAILS because the project config is missing a selector, FIX `eslint.config.js` to match the test, do NOT loosen the test.
  </action>
  <verify>
    <automated>node scripts/run-tests.mjs tests/lint-capabilities-noleak.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/lint-capabilities-noleak.test.ts` exists.
    - All three tests pass (INLINE positive, INLINE control, PROJECT positive).
    - `grep -c "D-12" tests/lint-capabilities-noleak.test.ts` returns at least 6 (rule messages + assertion text).
    - `grep -c "mcp/_capabilities-noleak-fixture-tmp.ts" tests/lint-capabilities-noleak.test.ts` returns at least 1 (PROJECT path).
    - `grep -c "unlinkSync" tests/lint-capabilities-noleak.test.ts` returns at least 1 (cleanup present).
    - After test runs, `mcp/_capabilities-noleak-fixture-tmp.ts` does NOT exist (cleanup happened).
    - `npm run lint` continues to pass (no false positives on existing source).
  </acceptance_criteria>
  <done>
    D-12 capabilities-no-leak chokepoint is committed, scoped to `mcp/**/*.ts`, and
    proved-out against a red-team fixture under both inline-Linter and
    real-project-config conditions. The rail is now in place for the
    `paper://capabilities` handler in 02-04.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| developer → repo | A future contributor (or AI agent in execute-plan) writes a capabilities handler in `mcp/` that resolves secrets and emits values |
| mcp/capabilities handler → MCP client (Claude Code / external tools) | Resource content crosses the trust boundary; any string in the payload is observable to whoever holds the MCP session |
| build-time → CI | Lint runs in CI; bypassing lint locally is allowed, but `npm run check` and the CI matrix MUST fail on D-12 violations |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-03-01 | Information Disclosure | mcp/capabilities-handler (future, 02-04) writes `apiKeyValue: process.env[provider.apiKeyEnv]` into resource payload | mitigate | D-12 selector A flags computed `process.env[<expr>]` at lint time. Red-team fixture in this plan proves the rail. ASVS V14 (Configuration). |
| T-02-03-02 | Information Disclosure | mcp/ handler inlines `await getProviderApiKey()` and embeds the returned string in resource content | mitigate | D-12 selector B flags any `CallExpression` whose callee name matches the three runtime.ts chokepoint helpers. The handler is forced to consume presence-flag booleans from `paper://state` instead. |
| T-02-03-03 | Tampering | Developer adds a "capabilitiesNormalizer" helper to silently strip the value before emit, defeating the lint signal | mitigate | D-21 (discipline rule in CONTEXT.md, restated in plan body): default fix is to make tiers agree, NOT add a normalizer. Reviewed at PR time + CONTRIBUTING.md "Tier contract" prose in 02-08. |
| T-02-03-04 | Elevation of Privilege | Lint rule is suppressed via `// eslint-disable-next-line` to ship a one-off | mitigate | `npm run lint` runs in CI on all 3 OSes (D-22) and `eslint --max-warnings 0` semantics already in place (Phase 1 baseline). Code-review checklist in CONTRIBUTING.md (02-08) calls out D-12 explicitly. |
| T-02-03-05 | Repudiation | A leak slips through, contributor claims "lint passed when I pushed" | accept | Lint runs against the merge-base in CI per `.github/workflows/ci.yml`; GitHub job logs are the audit trail. No additional control needed at this phase. |

Security domain: V14 Configuration (yes — `paper://capabilities` MUST NOT leak secrets, lint-enforced).
</threat_model>

<verification>
After all three tasks land:

1. `node scripts/run-tests.mjs tests/lint-capabilities-noleak.test.ts` — 3 tests green.
2. `npm run lint` — full project still passes (no regressions).
3. `grep -c "D-12" eslint.config.js` ≥ 2.
4. `grep -c "files: \['mcp/\*\*/\*\.ts'\]" eslint.config.js` ≥ 3 (D-09, D-10, D-12 blocks coexist).
5. `npm run typecheck` — passes (test imports type-resolve).
6. No file outside `mcp/_capabilities-noleak-fixture-tmp.ts` (which is unlinked at test end) is created under `mcp/`.
</verification>

<success_criteria>
- D-12 capabilities-no-leak chokepoint is committed and proven by both an inline-rules test and a project-config-loaded test.
- The red-team fixture flags exactly the 5 expected violation sites and leaves the 1 control case untouched.
- `mcp/server.ts` (lands in 02-04) cannot ship a capabilities handler that resolves a provider key without this rule firing.
- Plan 02-04 can now safely depend on this chokepoint being in place.
</success_criteria>

<output>
After completion, create `.planning/phases/02-tier-shells-doctor-tier-contract-gate/02-03-SUMMARY.md`
following `$HOME/.claude/get-shit-done/templates/summary.md`.
</output>
