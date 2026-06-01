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
//       D-10 block fires), lint it, assert >=5 violations.
//
// Note: the fixture uses TypeScript-specific syntax (declare const).
// tseslint.configs.recommended is included in the inline test to wire the
// TypeScript parser — without it, ESLint's default parser fails on
// `declare const` statements (same precedent established in 02-01 / D-09).

import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import path from 'node:path';
import fsp from 'node:fs/promises';

const FIXTURE = path.resolve('tests/fixtures/lint-mcp-no-network-fixture.ts');

test('D-10 no-network: inline rule flags all 5 fixture violations', async () => {
  // The fixture uses TypeScript-specific syntax (declare const).
  // We must include tseslint.configs.recommended to wire the TypeScript parser;
  // without it, ESLint's default parser fails on `declare const`.
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      ...tseslint.configs.recommended,
      {
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
      },
    ],
  });
  const results = await eslint.lintFiles([FIXTURE]);
  assert.equal(results.length, 1, `expected 1 fixture result, got ${results.length}`);
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
  // WR-04: write fixture into mcp/__fixtures__/ (gitignored) instead of as
  // a stray sibling of server.ts. The path still matches the mcp/**/*.ts
  // lint glob so the D-10 rule still fires.
  const fixtureContent = await fsp.readFile(FIXTURE, 'utf-8');
  const tmpDir = path.resolve('mcp/__fixtures__');
  await fsp.mkdir(tmpDir, { recursive: true });
  const tmpMcpPath = path.join(tmpDir, '_no-network-fixture-tmp.ts');
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
