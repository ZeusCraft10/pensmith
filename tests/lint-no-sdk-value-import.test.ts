// tests/lint-no-sdk-value-import.test.ts — audit #7 architectural guard, now the
// `llm-sdk-types-only` chokepoint row (RUN-29).
//
// The Pass-2 / Pass-4 verifiers used to `import Anthropic from '@anthropic-ai/sdk'`
// and call `client.messages.create(...)` directly, bypassing the bin/lib/http.ts
// (D-06) transport chokepoint — so those calls got no SSRF pre-flight guard, no
// retry/backoff, no polite User-Agent, no central budget/cost handling. The
// guard is now a row of the data-driven `pensmith/chokepoint` ESLint rule
// (scripts/chokepoints/llm-sdk-types-only.json), so `npm run lint` fails on a
// value import anywhere in bin/, mcp/, hooks/ or scripts/. This suite keeps the
// original source walk as a second, lint-independent check and pins the one
// semantic the row must keep: a TYPE-only import stays allowed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ESLint } from 'eslint';
import { REPO_ROOT, loadChokepointRows, matchersOf } from '../scripts/eslint-rules/chokepoint.mjs';

const binDir = fileURLToPath(new URL('../bin', import.meta.url));

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile() && full.endsWith('.ts')) out.push(full);
  }
  return out;
}

// A VALUE import: `import <something-not-"type"> from '@anthropic-ai/sdk'` (or
// 'openai'). `import type ...` is explicitly allowed (negative lookahead).
const VALUE_IMPORT_RE =
  /^\s*import\s+(?!type\b)[^;'"]*from\s+['"](?:@anthropic-ai\/sdk|openai)['"]/m;

test('audit #7: no file value-imports the LLM SDK (all completions go through complete() → http.ts)', async () => {
  const files = await walk(binDir);
  const offenders: string[] = [];
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    if (VALUE_IMPORT_RE.test(src)) offenders.push(path.relative(binDir, f));
  }
  assert.deepEqual(
    offenders,
    [],
    `These files value-import the LLM SDK and bypass the http.ts chokepoint — ` +
      `route through bin/lib/anthropic.ts::complete() instead: ${offenders.join(', ')}`,
  );
});

test('audit #7 / RUN-29: the llm-sdk-types-only row enforces it in ESLint, and a type-only import stays allowed', async () => {
  const row = loadChokepointRows().find((r) => r.id === 'llm-sdk-types-only');
  assert.ok(row, 'scripts/chokepoints/llm-sdk-types-only.json ships');
  assert.ok(matchersOf(row).some((m) => m.kind === 'import' && m.typeImports === 'allow'));
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const lint = async (code: string): Promise<number> => {
    const [r] = await eslint.lintText(code, { filePath: path.join(REPO_ROOT, 'bin', 'lib', 'verify', 'sdk-probe.ts') });
    return (r?.messages ?? []).filter((m) => m.ruleId === 'pensmith/chokepoint' && m.message.includes('"llm-sdk-types-only"')).length;
  };
  assert.equal(await lint(`import type Anthropic from '@anthropic-ai/sdk';\nexport type M = Anthropic.Message;\n`), 0);
  assert.equal(await lint(`import Anthropic from '@anthropic-ai/sdk';\nexport const c = new Anthropic();\n`), 1);
});
