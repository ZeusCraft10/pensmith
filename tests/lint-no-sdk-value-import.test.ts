// tests/lint-no-sdk-value-import.test.ts — audit #7 architectural guard.
//
// The Pass-2 / Pass-4 verifiers used to `import Anthropic from '@anthropic-ai/sdk'`
// and call `client.messages.create(...)` directly, bypassing the bin/lib/http.ts
// (D-06) transport chokepoint — so those calls got no SSRF pre-flight guard, no
// retry/backoff, no polite User-Agent, no central budget/cost handling. The
// eslint no-restricted-imports rule bans undici/http/https but NOT the LLM SDK,
// so the bypass was invisible to lint. This source-grep guard (the repo's
// lint-*.test.ts idiom) asserts no file VALUE-imports the LLM SDK: every LLM
// completion must flow through bin/lib/anthropic.ts::complete() → http.ts. A
// TYPE-only import (`import type ... from '@anthropic-ai/sdk'`) is allowed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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

test('audit #7: the type-only SDK import in anthropic.ts is still permitted', async () => {
  const anthropicTs = await readFile(path.join(binDir, 'lib', 'anthropic.ts'), 'utf8');
  assert.ok(
    /import\s+type\s+Anthropic\s+from\s+['"]@anthropic-ai\/sdk['"]/.test(anthropicTs),
    'anthropic.ts must keep its type-only SDK import (the guard must not ban type imports)',
  );
});
