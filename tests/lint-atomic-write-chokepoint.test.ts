// tests/lint-atomic-write-chokepoint.test.ts
// Regression gate for the D-07 atomic-write chokepoint lint rule (Phase 1, Wave 2).
//
// Why this test exists (do not delete):
//   D-07 bans direct `fs.writeFile` / `fs.promises.writeFile` /
//   FileHandle#writeFile outside `bin/lib/atomic-write.ts`. The rule lives
//   in `eslint.config.js` as a no-restricted-syntax CallExpression selector
//   matching `callee.property.name='writeFile'`. Without this regression
//   gate, a single typo in the AST selector silently disables the rule
//   (Pitfall B5 — the same class of failure the D-07 DOI chokepoint test
//   and the D-41 paths chokepoint test exist to prevent).
//
// Two tests (mirroring tests/lint-paths-chokepoint.test.ts):
//   (1) INLINE: smoke test that asserts the writeFile selector fires on
//       the W0 red-team fixture when configured inline. Proves the rule
//       shape is structurally valid.
//   (2) PROJECT: load the project's actual `eslint.config.js`, strip its
//       global-ignores entry (which would hide the fixture from lint),
//       run ESLint against the fixture, and assert the rule fires AT
//       LEAST 2 times. Proves the rule config in the real config file is
//       correct, not just that the rule shape works in theory.
//
// The W0 fixture (`tests/fixtures/lint-atomic-write-chokepoint-fixture.ts`)
// has exactly 2 violations: fs.writeFile and fsp.writeFile.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import path from 'node:path';

test('atomic-write chokepoint flags fixture violations (inline rule)', async () => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
        rules: {
          'no-restricted-syntax': [
            'error',
            {
              selector: "CallExpression[callee.property.name='writeFile']",
              message: 'atomic-write chokepoint',
            },
          ],
        },
      },
    ],
  });

  const fixture = path.resolve('tests/fixtures/lint-atomic-write-chokepoint-fixture.ts');
  const results = await eslint.lintFiles([fixture]);
  assert.equal(results.length, 1, `expected 1 fixture result, got ${results.length}`);
  const restrictedSyntaxCount = (results[0]?.messages ?? []).filter(
    (m) => m.ruleId === 'no-restricted-syntax',
  ).length;
  assert.ok(
    restrictedSyntaxCount >= 2,
    `expected >=2 writeFile violations on fixture; got ${restrictedSyntaxCount}: ${JSON.stringify(results[0]?.messages)}`,
  );
});

// === Loaded-from-disk integration test (Pitfall B5 mitigation) ===
// Mirrors the pattern in tests/lint-paths-chokepoint.test.ts so a typo in
// the project's eslint.config.js D-07 selector fails this test.
test('PROJECT eslint.config.js flags atomic-write violations on the fixture', async () => {
  const projectConfigUrl = new URL('../eslint.config.js', import.meta.url);
  const projectConfigModule = (await import(projectConfigUrl.href)) as {
    default: Record<string, unknown>[];
  };
  const projectConfig = projectConfigModule.default;
  const fixturePath = path.resolve('tests/fixtures/lint-atomic-write-chokepoint-fixture.ts');
  // Filter out global-ignores-only entries so the fixture is actually linted.
  // (See tests/lint-chokepoint.test.ts for the long-form rationale.)
  const configWithoutGlobalIgnores = projectConfig.filter((entry) => {
    const keys = Object.keys(entry);
    return !(keys.length === 1 && keys[0] === 'ignores');
  });
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: configWithoutGlobalIgnores as never,
  });
  const results = await eslint.lintFiles([fixturePath]);
  assert.equal(results.length, 1, 'expected 1 fixture result from project config');
  const restrictedSyntaxCount = (results[0]?.messages ?? []).filter(
    (m) => m.ruleId === 'no-restricted-syntax',
  ).length;
  assert.ok(
    restrictedSyntaxCount >= 2,
    `project eslint.config.js must flag both writeFile violations on fixture; got ${restrictedSyntaxCount} no-restricted-syntax messages: ${JSON.stringify(results[0]?.messages)}`,
  );
});
