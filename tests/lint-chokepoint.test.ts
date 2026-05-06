// tests/lint-chokepoint.test.ts
// Regression gate for the D-06 + D-07 chokepoint lint rules.
// Runs ESLint programmatically against tests/fixtures/lint-chokepoint-fixture.ts
// with the chokepoint rules forced ON, asserts both rules fire.
//
// Without this test, the chokepoint rules can rot silently (D-08).

import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import path from 'node:path';

test('lint chokepoints flag both fixture violations', async () => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.ts'],
      languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
      rules: {
        'no-restricted-imports': ['error', {
          paths: [
            { name: 'undici',     message: 'http chokepoint' },
            { name: 'http',       message: 'http chokepoint' },
            { name: 'node:http',  message: 'http chokepoint' },
            { name: 'https',      message: 'http chokepoint' },
            { name: 'node:https', message: 'http chokepoint' },
          ],
        }],
        'no-restricted-syntax': ['error', {
          selector: 'Literal[regex.pattern=/^\\^10\\\\\\./]',
          message: 'doi chokepoint',
        }],
      },
    }],
  });

  const fixture = path.resolve('tests/fixtures/lint-chokepoint-fixture.ts');
  const results = await eslint.lintFiles([fixture]);
  assert.equal(results.length, 1, `expected 1 fixture result, got ${results.length}`);
  const ruleIds = (results[0]?.messages ?? []).map(m => m.ruleId);
  assert.ok(
    ruleIds.includes('no-restricted-imports'),
    `expected no-restricted-imports to fire on fixture; got: ${JSON.stringify(ruleIds)}`,
  );
  assert.ok(
    ruleIds.includes('no-restricted-syntax'),
    `expected no-restricted-syntax to fire on fixture; got: ${JSON.stringify(ruleIds)}`,
  );
});

test('lint chokepoints do NOT fire on a benign regex like /^11\\./', async () => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.ts'],
      languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
      rules: {
        'no-restricted-syntax': ['error', {
          selector: 'Literal[regex.pattern=/^\\^10\\\\\\./]',
          message: 'doi chokepoint',
        }],
      },
    }],
  });
  // Lint an in-memory string by writing a temp file would be cleaner; for
  // a smoke check we run lintText.
  const out = await eslint.lintText("const x = /^11\\./;\n", { filePath: 'benign.ts' });
  const ruleIds = (out[0]?.messages ?? []).map(m => m.ruleId);
  assert.ok(
    !ruleIds.includes('no-restricted-syntax'),
    `benign regex /^11\\./ must NOT trigger DOI chokepoint; got: ${JSON.stringify(ruleIds)}`,
  );
});

// === Cycle 2 replan addition (claude-opus-4-6 review): the two tests above
// duplicate the rule config inline. If the project's eslint.config.js has a
// typo in its AST selector (Pitfall B's exact failure mode), those tests
// still pass because they use their own correct copy. The test below loads
// the PROJECT's actual eslint.config.js as the base, overrides only the
// `ignores` so the fixture is no longer hidden, and asserts both rules fire.
// This proves the project config file itself is correct, not just that the
// rules work in theory. ===
test('PROJECT eslint.config.js (loaded from disk) flags both fixture violations', async () => {
  // Load the project's actual flat config and re-shape it so the fixture
  // is NOT ignored. ESLint flat config: a global `ignores` entry (an object
  // with ONLY an `ignores` key, no `files` key) is a hard global exclude
  // that cannot be overridden by a later `files` entry — appending
  // `{ files: [...fixture...] }` does NOT undo a prior global `ignores`.
  // The correct approach is to filter out the global-ignores config objects
  // before constructing the integration-test ESLint instance. The chokepoint
  // rule configs (which have both `files` and `rules`) are kept as-is.
  // This tests that the rule configs in the PROJECT's eslint.config.js are
  // correct — not just that the rules work in theory with an inline copy.
  const projectConfigUrl = new URL('../eslint.config.js', import.meta.url);
  const projectConfigModule = await import(projectConfigUrl.href) as { default: Record<string, unknown>[] };
  const projectConfig = projectConfigModule.default;
  const fixturePath = path.resolve('tests/fixtures/lint-chokepoint-fixture.ts');
  // Filter out global-ignores-only entries (objects with only an `ignores`
  // key and no `files` key). These are the entries that would block the
  // fixture from being linted. Keep all rule-carrying entries.
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
  assert.ok(
    ruleIds.includes('no-restricted-imports'),
    `project eslint.config.js must flag undici import on the fixture; got: ${JSON.stringify(ruleIds)}`,
  );
  assert.ok(
    ruleIds.includes('no-restricted-syntax'),
    `project eslint.config.js must flag /^10\\./ regex on the fixture; got: ${JSON.stringify(ruleIds)}`,
  );
});

// === Cycle 2 replan addition (codex review medium): REPO-05 wording is
// "direct fetch" — the no-restricted-imports rule covers `import { fetch }
// from 'undici'` and import of `http`/`https`/`node:http`/`node:https`,
// but does NOT catch a global `fetch(url)` call (no import). For Phase 0
// we accept this gap because Phase 1's `bin/lib/http.ts` is the actual
// chokepoint module, and a global `fetch` call outside http.ts will be
// caught by Phase 1's contract test (and by code review). The chokepoint
// test below documents the gap so future reviewers don't think it was
// missed. If Phase 1 finds the gap is too leaky, add `no-restricted-globals`
// for `fetch` to eslint.config.js with a per-file override on http.ts. ===
test('DOCUMENTED GAP: global fetch() call is NOT flagged by no-restricted-imports (Phase 1 follow-up)', async () => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.ts'],
      languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
      rules: {
        'no-restricted-imports': ['error', {
          paths: [{ name: 'undici', message: 'http chokepoint' }],
        }],
      },
    }],
  });
  const out = await eslint.lintText('async function bad() { return await fetch("http://x"); }\n', {
    filePath: 'leak.ts',
  });
  const ruleIds = (out[0]?.messages ?? []).map((m) => m.ruleId);
  // This test ASSERTS the gap exists — Phase 1 will close it. If a future
  // change closes the gap (e.g., adds no-restricted-globals), this test
  // FLIPS to assert the global fetch IS flagged. Update the test then.
  assert.ok(
    !ruleIds.includes('no-restricted-imports'),
    'no-restricted-imports does not catch global fetch — gap documented for Phase 1',
  );
});
