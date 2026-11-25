// tests/lint-http-mock-isolation.test.ts — production code may not import the
// cassette module. bin/lib/http-mock.ts reads tests/fixtures; only the test
// suite (and http.ts, lazily, when PENSMITH_TEST_CASSETTES=1) may load it, so a
// real install can never answer a lookup from a fixture.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const IMPORT_MOCK = "import { loadCassetteFile } from '../http-mock.js';\nvoid loadCassetteFile;\n";

async function restrictedImportCount(relPath: string, code: string): Promise<number> {
  const eslint = new ESLint({ cwd: REPO });
  const [result] = await eslint.lintText(code, { filePath: path.join(REPO, relPath) });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports').length;
}

test('lint: a production module importing http-mock is rejected', async () => {
  assert.ok(await restrictedImportCount('bin/lib/sources/probe.ts', IMPORT_MOCK) >= 1, 'bin/lib/sources');
  assert.ok(
    await restrictedImportCount('bin/cli/probe.ts', "import { loadCassetteFile } from '../lib/http-mock.js';\nvoid loadCassetteFile;\n") >= 1,
    'bin/cli',
  );
});

test('lint: tests may import http-mock to inspect fixtures', async () => {
  assert.equal(
    await restrictedImportCount('tests/probe.test.ts', "import { loadCassetteFile } from '../bin/lib/http-mock.js';\nvoid loadCassetteFile;\n"),
    0,
  );
});
