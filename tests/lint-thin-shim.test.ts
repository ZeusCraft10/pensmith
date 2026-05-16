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
//
// Two-part structure mirrors tests/lint-paths-chokepoint.test.ts:
//   Test 1 — inline-rule smoke test (proves the rule shape is valid)
//   Test 2 — PROJECT-config-loaded (proves eslint.config.js wires it correctly)
//   Test 3 — pure AST walk using @typescript-eslint/parser (no ESLint instance)
//             counts handler body statements and asserts fixture > 30

import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { parse } from '@typescript-eslint/parser';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FIXTURE = path.resolve('tests/fixtures/lint-thin-shim-fixture.ts');

test('thin-shim chokepoint: inline rule flags fs import in fixture', async () => {
  // The fixture uses TypeScript-specific syntax (declare const, @ts-nocheck).
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
          'no-restricted-imports': [
            'error',
            {
              paths: [
                { name: 'fs',               message: 'D-09 thin-shim' },
                { name: 'node:fs',          message: 'D-09 thin-shim' },
                { name: 'fs/promises',      message: 'D-09 thin-shim' },
                { name: 'node:fs/promises', message: 'D-09 thin-shim' },
              ],
            },
          ],
        },
      },
    ],
  });
  const results = await eslint.lintFiles([FIXTURE]);
  assert.equal(results.length, 1, `expected 1 fixture result, got ${results.length}`);
  const count = (results[0]?.messages ?? []).filter(
    (m) => m.ruleId === 'no-restricted-imports',
  ).length;
  assert.ok(count >= 1, `expected >=1 no-restricted-imports message; got ${count}`);
});

test('thin-shim chokepoint: PROJECT eslint.config.js flags fs import on fixture via mcp/ copy', async () => {
  const projectConfigUrl = new URL('../eslint.config.js', import.meta.url);
  const projectConfigModule = (await import(projectConfigUrl.href)) as {
    default: Record<string, unknown>[];
  };
  // Filter global-ignores-only entries so the fixture file is not silently hidden.
  // (Same pattern as tests/lint-paths-chokepoint.test.ts — Pitfall B5 mitigation.)
  const configWithoutGlobalIgnores = projectConfigModule.default.filter((entry) => {
    const keys = Object.keys(entry);
    return !(keys.length === 1 && keys[0] === 'ignores');
  });

  // The project's D-09 block targets mcp/**/*.ts. The fixture lives at
  // tests/fixtures/lint-thin-shim-fixture.ts so it won't match that block.
  // WR-04: write the temporary copy under mcp/__fixtures__/ (gitignored)
  // rather than as a stray sibling of server.ts. Keeping fixtures in a
  // dedicated subdir signals "test artifact, not production code" and lets
  // contributors recognise it at a glance. The path still matches the
  // mcp/**/*.ts file-scoped lint glob, so the rule still fires.
  // T-02-01-03: deterministic name is safe because this test runs
  // single-threaded under node:test.
  const fsp = await import('node:fs/promises');
  const fixtureContent = await fsp.readFile(FIXTURE, 'utf-8');
  const tmpDir = path.resolve('mcp/__fixtures__');
  await fsp.mkdir(tmpDir, { recursive: true });
  const tmpMcpPath = path.join(tmpDir, '_thin-shim-fixture-tmp.ts');
  await fsp.writeFile(tmpMcpPath, fixtureContent, 'utf-8');
  try {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: configWithoutGlobalIgnores as never,
    });
    const results = await eslint.lintFiles([tmpMcpPath]);
    const ruleIds = (results[0]?.messages ?? []).map((m) => m.ruleId);
    const count = ruleIds.filter((r) => r === 'no-restricted-imports').length;
    assert.ok(
      count >= 1,
      `project eslint.config.js must flag fs import in mcp/** fixture; got ${count} no-restricted-imports messages, total: ${JSON.stringify(ruleIds)}`,
    );
  } finally {
    await fsp.unlink(tmpMcpPath).catch(() => {});
  }
});

test('thin-shim chokepoint: AST walk asserts handler body > 30 statements in fixture', () => {
  const src = readFileSync(FIXTURE, 'utf-8');
  // Parse with @typescript-eslint/parser — same tool used by the lint rules.
  // range + loc are needed so ESLint can produce line/col positions; they are
  // harmless here (we only look at body.body.length).
  const ast = parse(src, {
    sourceType: 'module',
    ecmaVersion: 2022,
    range: true,
    loc: true,
  });

  /**
   * Walk the AST and collect body.body.length for every ArrowFunctionExpression
   * or FunctionExpression that appears as the last argument of a
   * `server.registerTool(...)` or `server.registerResource(...)` CallExpression.
   *
   * This mirrors the D-09 budget rule: each handler body MUST have ≤30 statements.
   * The fixture contains a 31-statement handler, so maxCount > 30 is expected here.
   *
   * When mcp/server.ts lands in plan 02-04, a POSITIVE test will walk that file
   * and assert maxCount <= 30 (every real handler is within budget).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function collectHandlerBodyLengths(node: any): number[] {
    const counts: number[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function walk(n: any) {
      if (!n || typeof n !== 'object') return;
      if (
        n.type === 'CallExpression' &&
        n.callee?.type === 'MemberExpression' &&
        (n.callee.property?.name === 'registerTool' ||
          n.callee.property?.name === 'registerResource')
      ) {
        // The handler is the last argument.
        const handler = n.arguments?.[n.arguments.length - 1];
        if (
          handler &&
          (handler.type === 'ArrowFunctionExpression' ||
            handler.type === 'FunctionExpression')
        ) {
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

  const counts = collectHandlerBodyLengths(ast);
  assert.ok(
    counts.length >= 1,
    `expected at least 1 registerTool/registerResource CallExpression with a block handler in fixture; got 0`,
  );
  const maxCount = counts.reduce((a, b) => Math.max(a, b), 0);
  assert.ok(
    maxCount > 30,
    `fixture must contain a handler with >30 statements (D-09 budget violation); maxCount=${maxCount}, counts=${counts.join(',')}`,
  );
});

// Future (plan 02-04): when mcp/server.ts gains real tool/resource handlers,
// add a fourth test that AST-walks mcp/server.ts itself and asserts
// maxCount <= 30 on every handler (positive case — confirms real server stays
// within the D-09 budget). That test lives in 02-04's plan.
