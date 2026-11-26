// tests/lint-no-sdk-value-import.test.ts — audit #7 architectural guard.
//
// The Pass-2 / Pass-4 verifiers used to `import Anthropic from '@anthropic-ai/sdk'`
// and call `client.messages.create(...)` directly, so those calls bypassed the
// bin/lib/http.ts chokepoint: no proxy handling, no deadline, no offline
// refusal, no budget or cost ledger. The eslint no-restricted-imports rule
// bans undici/http/https but not the LLM SDK, so this source-grep guard does.
//
// Exactly one file may value-import the SDK: bin/lib/generators/anthropic.ts,
// which builds its client with chokepointFetch (http.ts) as its fetch. Every
// model call reaches it through complete() in bin/lib/anthropic.ts. A
// type-only import (`import type ... from '@anthropic-ai/sdk'`) is allowed
// anywhere. tests/llm-generator.test.ts shows behaviourally that the SDK's
// requests go through http.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const binDir = fileURLToPath(new URL('../bin', import.meta.url));
const SDK_GENERATOR = path.join('lib', 'generators', 'anthropic.ts');

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
  /^\s*import\s+(?!type\b)[^;'"]*from\s+['"](?:@anthropic-ai\/sdk|openai)(?:\/[^'"]*)?['"]/m;

test('audit #7: only the Anthropic generator value-imports an LLM SDK', async () => {
  const files = await walk(binDir);
  const offenders: string[] = [];
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    if (VALUE_IMPORT_RE.test(src)) offenders.push(path.relative(binDir, f));
  }
  assert.deepEqual(
    offenders,
    [SDK_GENERATOR],
    `Only ${SDK_GENERATOR} may value-import an LLM SDK; every other model call goes through complete(): ${offenders.join(', ')}`,
  );
});

test('audit #7: the Anthropic generator gives the SDK the http.ts chokepoint as its fetch', async () => {
  const src = await readFile(path.join(binDir, SDK_GENERATOR), 'utf8');
  assert.match(src, /import\s*\{[^}]*\bchokepointFetch\b[^}]*\}\s*from\s*'\.\.\/http\.js'/, 'chokepointFetch comes from http.ts');
  assert.match(src, /new Anthropic\(\{[\s\S]*?fetch:\s*chokepointFetch\(/, 'the client is built with fetch: chokepointFetch(...)');
  assert.equal((src.match(/new Anthropic\(/g) ?? []).length, 1, 'one place builds the client');
});
