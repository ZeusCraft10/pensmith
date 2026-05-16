// tests/mcp-server-thin-shim.test.ts
//
// D-08 positive case: every real handler body in mcp/ is ≤30 statements.
// The chokepoint LINT (02-01) covers fixtures; this test covers the
// SHIPPED code. Counts: 5 resources (TIER-01) + 6 tools (TIER-02).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@typescript-eslint/parser';

function countHandlerStmts(
  filePath: string,
  registerName: 'registerTool' | 'registerResource',
): Array<{ name: string; stmts: number }> {
  const src = readFileSync(filePath, 'utf8');
  const ast = parse(src, { ecmaVersion: 2022, sourceType: 'module', loc: true, range: true });
  const results: Array<{ name: string; stmts: number }> = [];

  function visit(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (
      n.type === 'CallExpression'
      && typeof n.callee === 'object' && n.callee !== null
      && (n.callee as Record<string, unknown>).type === 'MemberExpression'
      && (n.callee as Record<string, unknown>).property !== null
      && ((n.callee as Record<string, unknown>).property as Record<string, unknown>).name === registerName
    ) {
      const args = n.arguments as unknown[];
      // Last function-shaped argument is the handler.
      const fnArg = [...args].reverse().find(
        (a) =>
          a !== null && typeof a === 'object'
          && (
            (a as Record<string, unknown>).type === 'ArrowFunctionExpression'
            || (a as Record<string, unknown>).type === 'FunctionExpression'
          ),
      );
      if (fnArg) {
        const body = (fnArg as Record<string, unknown>).body as Record<string, unknown> | undefined;
        const stmts = body?.type === 'BlockStatement'
          ? ((body.body as unknown[]) ?? []).length
          : 1;
        const nameArg = args[0];
        const name =
          nameArg !== null && typeof nameArg === 'object'
          && (nameArg as Record<string, unknown>).type === 'Literal'
            ? String((nameArg as Record<string, unknown>).value)
            : '<unknown>';
        results.push({ name, stmts });
      }
    }
    for (const key of Object.keys(n)) {
      const v = n[key];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object') visit(v);
    }
  }

  visit(ast);
  return results;
}

test('D-08: every mcp/tools.ts handler ≤30 statements (TIER-02 = 6 tools)', () => {
  const handlers = countHandlerStmts('mcp/tools.ts', 'registerTool');
  assert.equal(handlers.length, 6, `expected 6 tools per TIER-02, got ${handlers.length}: ${JSON.stringify(handlers.map((h) => h.name))}`);
  for (const h of handlers) {
    assert.ok(h.stmts <= 30, `${h.name}: ${h.stmts} stmts (max 30)`);
  }
});

test('D-08: every mcp/resources.ts handler ≤30 statements (TIER-01 = 5 resources)', () => {
  const handlers = countHandlerStmts('mcp/resources.ts', 'registerResource');
  assert.equal(handlers.length, 5, `expected 5 resources per TIER-01 + D-07, got ${handlers.length}: ${JSON.stringify(handlers.map((h) => h.name))}`);
  for (const h of handlers) {
    assert.ok(h.stmts <= 30, `${h.name}: ${h.stmts} stmts (max 30)`);
  }
});
