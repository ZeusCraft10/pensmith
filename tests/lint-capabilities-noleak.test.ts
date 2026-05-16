// tests/lint-capabilities-noleak.test.ts
// Regression gate for the D-12 capabilities-no-leak AST chokepoint (Phase 2).
//
// D-12: mcp/**/*.ts MUST NOT read secrets via computed process.env[…] or
// call the runtime.ts secret-resolution helpers (getProviderApiKey /
// getOpenAlexApiKey / loadRuntimeConfig). The paper://capabilities handler
// MUST expose only presence flags — never resolved key values.
//
// Three tests:
//   1. INLINE positive: inline-rule instance flags all 5 fixture violations.
//   2. INLINE control: static process.env.FOO dot-access does NOT fire D-12.
//   3. PROJECT: load the real eslint.config.js, copy fixture to
//      mcp/_capabilities-noleak-fixture-tmp.ts, assert >=5 D-12 messages.
//
// Note: the fixture imports from bin/lib/runtime.ts and uses TypeScript
// interface syntax. We include tseslint.configs.recommended to wire the
// TypeScript parser — without it, ESLint's default parser fails on
// TypeScript-specific syntax (same precedent as 02-01 D-09 tests).

import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import path from 'node:path';
import fsp from 'node:fs/promises';

const FIXTURE = path.resolve('tests/fixtures/lint-capabilities-noleak-fixture.ts');

test('D-12 INLINE: selectors fire on red-team fixture', async () => {
  // Include tseslint.configs.recommended to wire the TypeScript parser.
  // The fixture uses TypeScript interface syntax; the default espree parser fails.
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      ...tseslint.configs.recommended,
      {
        files: ['**/*.ts'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
        rules: {
          'no-restricted-syntax': ['error',
            { selector: "MemberExpression[object.object.name='process'][object.property.name='env'][computed=true]", message: 'D-12: computed process.env[…] read forbidden in mcp/**.' },
            { selector: "CallExpression[callee.name=/^(getProviderApiKey|getOpenAlexApiKey|loadRuntimeConfig)$/]", message: 'D-12: do not call runtime.ts secret-resolution helpers inside mcp/**.' },
          ],
        },
      },
    ],
  });
  const results = await eslint.lintFiles([FIXTURE]);
  assert.equal(results.length, 1, `expected 1 fixture result, got ${results.length}`);
  const d12 = (results[0]?.messages ?? []).filter((m) => /D-12/.test(m.message));
  assert.ok(d12.length >= 5, `expected >=5 D-12 messages, got ${d12.length}: ${JSON.stringify(results[0]?.messages, null, 2)}`);
});

test('D-12 INLINE: static dot-access process.env.FOO is allowed', async () => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      ...tseslint.configs.recommended,
      {
        files: ['**/*.ts'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
        rules: {
          'no-restricted-syntax': ['error',
            { selector: "MemberExpression[object.object.name='process'][object.property.name='env'][computed=true]", message: 'D-12: computed process.env[…] read forbidden in mcp/**.' },
            { selector: "CallExpression[callee.name=/^(getProviderApiKey|getOpenAlexApiKey|loadRuntimeConfig)$/]", message: 'D-12: do not call runtime.ts secret-resolution helpers inside mcp/**.' },
          ],
        },
      },
    ],
  });
  // Use a tmp file path so ESLint matches the **/*.ts glob.
  const tmpControl = path.resolve('tests/_d12-control-tmp.ts');
  await fsp.writeFile(tmpControl, 'export const home = process.env.HOME;\n', 'utf-8');
  try {
    const results = await eslint.lintFiles([tmpControl]);
    const d12 = (results[0]?.messages ?? []).filter((m) => /D-12/.test(m.message));
    assert.equal(d12.length, 0, `static env access should not trip D-12, got: ${JSON.stringify(results[0]?.messages)}`);
  } finally {
    await fsp.unlink(tmpControl).catch(() => {});
  }
});

test('D-12 PROJECT: real eslint.config.js fires on fixture copied to mcp/', async () => {
  const projectConfigUrl = new URL('../eslint.config.js', import.meta.url);
  const projectConfigModule = (await import(projectConfigUrl.href)) as {
    default: Record<string, unknown>[];
  };
  // Filter global-ignores-only entries so the fixture is not silently suppressed.
  // (Same Pitfall B5 mitigation as tests/lint-thin-shim.test.ts and lint-mcp-no-network.test.ts.)
  const configWithoutGlobalIgnores = projectConfigModule.default.filter((entry) => {
    const keys = Object.keys(entry);
    return !(keys.length === 1 && keys[0] === 'ignores');
  });

  // WR-04: write fixture into mcp/__fixtures__/ (gitignored) instead of as
  // a stray sibling of server.ts. The path still matches the mcp/**/*.ts
  // lint glob so the D-12 rule still fires.
  const fixtureContent = await fsp.readFile(FIXTURE, 'utf-8');
  const tmpDir = path.resolve('mcp/__fixtures__');
  await fsp.mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, '_capabilities-noleak-fixture-tmp.ts');
  await fsp.copyFile(FIXTURE, tmpPath);
  try {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: configWithoutGlobalIgnores as never,
    });
    const results = await eslint.lintFiles([tmpPath]);
    assert.equal(results.length, 1, `expected 1 lint result, got ${results.length}`);
    const messages = results[0]?.messages ?? [];
    const d12 = messages.filter((m) => /D-12/.test(m.message));
    assert.ok(
      d12.length >= 5,
      `expected >=5 D-12 messages from project config, got ${d12.length}: ${JSON.stringify(messages, null, 2)}`,
    );
    // Control: staticEnvAccess export (process.env.HOME) must NOT produce any D-12 message.
    // The fixture control function is at the bottom of the file (lines 53-55).
    // We verify no D-12 message references the HOME line by checking that
    // the control line (process.env.HOME) is not flagged.
    const controlLine = fixtureContent.split('\n').findIndex((l) => l.includes('process.env.HOME')) + 1;
    const controlFired = d12.some((m) => m.line === controlLine);
    assert.equal(controlFired, false, `static process.env.HOME (line ${controlLine}) should NOT fire D-12`);
  } finally {
    await fsp.unlink(tmpPath).catch(() => {});
  }
});
