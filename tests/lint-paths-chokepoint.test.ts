// tests/lint-paths-chokepoint.test.ts
// Regression gate for the D-41 paths chokepoint lint rule (Phase 1, Wave 1).
//
// Why this test exists (do not delete):
//   D-41 bans direct `os.homedir()` and `process.env.{LOCALAPPDATA,APPDATA,
//   XDG_DATA_HOME}` outside `bin/lib/paths.ts`. The rule lives in
//   `eslint.config.js` as four no-restricted-syntax MemberExpression
//   selectors. Without this regression gate, a single typo in any of the
//   four AST selectors silently disables that branch (Pitfall B5 — the same
//   class of failure the D-07 DOI chokepoint test exists to prevent).
//
// Two tests:
//   (1) INLINE: smoke test that asserts the 4 selectors fire on the W0
//       red-team fixture when configured inline. Proves the rule shape
//       is structurally valid.
//   (2) PROJECT: load the project's actual `eslint.config.js`, strip its
//       global-ignores entry (which would hide the fixture from lint),
//       run ESLint against the fixture, and assert the rule fires AT LEAST
//       4 times. Proves the rule config in the real config file is correct,
//       not just that the rule shape works in theory.
//
// The W0 fixture (`tests/fixtures/lint-paths-chokepoint-fixture.ts`) has
// 6 violations: os.homedir(), LOCALAPPDATA, XDG_DATA_HOME, APPDATA, and a bare
// `import { homedir }` plus its `homedir()` call (test 3).

import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import path from 'node:path';
import { readFileSync } from 'node:fs';

test('paths chokepoint flags all 4 fixture violations (inline rule)', async () => {
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
              selector: "MemberExpression[object.name='os'][property.name='homedir']",
              message: 'paths chokepoint',
            },
            {
              selector:
                "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='LOCALAPPDATA']",
              message: 'paths chokepoint',
            },
            {
              selector:
                "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='APPDATA']",
              message: 'paths chokepoint',
            },
            {
              selector:
                "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='XDG_DATA_HOME']",
              message: 'paths chokepoint',
            },
          ],
        },
      },
    ],
  });
  const fixture = path.resolve('tests/fixtures/lint-paths-chokepoint-fixture.ts');
  const results = await eslint.lintFiles([fixture]);
  assert.equal(results.length, 1, `expected 1 fixture result, got ${results.length}`);
  const restrictedSyntaxCount = (results[0]?.messages ?? []).filter(
    (m) => m.ruleId === 'no-restricted-syntax',
  ).length;
  assert.ok(
    restrictedSyntaxCount >= 4,
    `expected >=4 no-restricted-syntax messages on fixture; got ${restrictedSyntaxCount}: ${JSON.stringify(results[0]?.messages)}`,
  );
});

// === Loaded-from-disk integration test (Pitfall B5 mitigation) ===
// Mirrors the pattern in tests/lint-chokepoint.test.ts so a typo in the
// project's eslint.config.js D-41 selectors fails this test.
test('PROJECT eslint.config.js flags paths violations on the fixture', async () => {
  const projectConfigUrl = new URL('../eslint.config.js', import.meta.url);
  const projectConfigModule = (await import(projectConfigUrl.href)) as {
    default: Record<string, unknown>[];
  };
  const projectConfig = projectConfigModule.default;
  const fixturePath = path.resolve('tests/fixtures/lint-paths-chokepoint-fixture.ts');
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
  const ruleIds = (results[0]?.messages ?? []).map((m) => m.ruleId);
  const restrictedSyntaxCount = ruleIds.filter((r) => r === 'no-restricted-syntax').length;
  assert.ok(
    restrictedSyntaxCount >= 4,
    `project eslint.config.js must flag all 4 paths violations on fixture; got ${restrictedSyntaxCount} no-restricted-syntax messages, total: ${JSON.stringify(ruleIds)}`,
  );
});

// A named import (`import { homedir } from 'node:os'`) and its bare call slip
// past the `os.homedir` member selector, which is how Claude-config path logic
// once bypassed bin/lib/paths.ts.
test('PROJECT eslint.config.js flags a bare homedir import and call', async () => {
  const projectConfigUrl = new URL('../eslint.config.js', import.meta.url);
  const projectConfig = ((await import(projectConfigUrl.href)) as { default: Record<string, unknown>[] }).default;
  const fixturePath = path.resolve('tests/fixtures/lint-paths-chokepoint-fixture.ts');
  const lines = readFileSync(fixturePath, 'utf8').split('\n');
  const importLine = lines.findIndex((l) => l.startsWith('import { homedir }')) + 1;
  const callLine = lines.findIndex((l) => /= homedir\(\)/.test(l)) + 1;
  assert.ok(importLine > 0 && callLine > 0, 'fixture must hold a bare homedir import and call');
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: projectConfig.filter((e) => !(Object.keys(e).length === 1 && 'ignores' in e)) as never,
  });
  const [result] = await eslint.lintFiles([fixturePath]);
  const flagged = new Set((result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax').map((m) => m.line));
  assert.ok(flagged.has(importLine), `the bare homedir import (line ${importLine}) must be flagged; flagged lines: ${[...flagged].join(', ')}`);
  assert.ok(flagged.has(callLine), `the bare homedir() call (line ${callLine}) must be flagged; flagged lines: ${[...flagged].join(', ')}`);
});
