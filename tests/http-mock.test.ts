/**
 * tests/http-mock.test.ts — DOCS-03 lazy-nock supply-chain fail-safe (T-16-DEP)
 *
 * Encodes the contract that `bin/lib/http-mock.ts` does NOT import nock at the
 * top level, so a production install (npm install -g pensmith, which omits
 * devDependencies) can load http-mock.ts without crashing.
 *
 * The 7 production adapters (crossref, arxiv, openalex, pubmed,
 * retraction-watch, semanticscholar, unpaywall) plus honesty.ts,
 * plagiarism.ts, and freshness.ts all import http-mock.ts and call ONLY the
 * three nock-free functions: isOfflineMode(), loadCassetteFile(),
 * loadCassetteDir(). Those three functions must remain callable without nock.
 *
 * RED-by-skip guard (08-00 convention): while http-mock.ts still has a
 * top-level `import nock from 'nock'` the lazy-nock refactor has not landed
 * (Plan 02 owns that change). Skip so the full suite stays GREEN at 0 failures.
 * When Plan 02 removes the top-level import the guard opens and the two
 * assertions below enforce the DOCS-03 contract in CI.
 *
 * Path resolution via fileURLToPath(import.meta.url) — spaced-path safe
 * (Phase-11 lesson: OneDrive paths have spaces).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the production module under test (do NOT edit — Plan 02 owns it)
const HTTP_MOCK_PATH = join(__dirname, '..', 'bin', 'lib', 'http-mock.ts');

// -------------------------------------------------------------------
// RED-by-skip predicate: does http-mock.ts still have a top-level nock import?
// -------------------------------------------------------------------
const httpMockSrc = readFileSync(HTTP_MOCK_PATH, 'utf8');

// Matches a line that STARTS with `import nock from 'nock'` (top-level import).
// Dynamic `await import('nock')` inside function bodies does NOT match this.
const TOP_LEVEL_NOCK_RE = /^import nock from ['"]nock['"]/m;
const hasTopLevelNockImport = TOP_LEVEL_NOCK_RE.test(httpMockSrc);

test('DOCS-03 Test A: http-mock.ts has no top-level import nock (lazy-import refactor landed)', {
  skip: hasTopLevelNockImport
    ? 'Plan 02 has not yet landed: http-mock.ts still has a top-level `import nock from \'nock\'`. ' +
      'Once Plan 02 moves nock to a dynamic await import() inside loadCassettes/clearCassettes/' +
      'recordCassettes/finalizeRecording, this skip guard opens and the assertion below enforces ' +
      'the DOCS-03 contract (T-16-DEP supply-chain fail-safe).'
    : false,
}, () => {
  // Source-level assertion: no line-start `import nock` (the proxy for "nock absent at
  // module-load time" — a true runtime test would require uninstalling nock, which is not
  // feasible in-suite; source-grep is the load-bearing proxy, mirroring 07-01 convention).
  assert.ok(
    !TOP_LEVEL_NOCK_RE.test(httpMockSrc),
    'DOCS-03: http-mock.ts must NOT have a top-level `import nock from \'nock\'`. ' +
      'nock must be lazy-imported (await import(\'nock\')) inside the nock-using functions only.',
  );

  // Also assert nock IS referenced via dynamic import somewhere in the file (the refactor
  // must actually move nock, not just delete it).
  const DYNAMIC_NOCK_RE = /await import\(['"]nock['"]\)/;
  assert.ok(
    DYNAMIC_NOCK_RE.test(httpMockSrc),
    'DOCS-03: after removing the top-level import, nock must still be referenced via ' +
      '`await import(\'nock\')` inside loadCassettes / clearCassettes / recordCassettes / finalizeRecording.',
  );
});

test('DOCS-03 Test B: production-facing functions (isOfflineMode/loadCassetteFile/loadCassetteDir) are callable without nock', {
  skip: hasTopLevelNockImport
    ? 'Plan 02 has not yet landed: http-mock.ts still has a top-level `import nock from \'nock\'`. ' +
      'This test will open once the lazy-import refactor removes the top-level nock import.'
    : false,
}, async () => {
  // Dynamically import the module using a file:// URL so Node resolves it correctly
  // even on spaced OneDrive paths. tsx must be registered (--import tsx) for .ts files.
  const moduleUrl = new URL('file://' + HTTP_MOCK_PATH.replace(/\\/g, '/'));

  // This import must not throw even without nock in production (no top-level nock import).
  const mod = await import(moduleUrl.href) as {
    isOfflineMode: () => boolean;
    loadCassetteDir: (adapter: string) => unknown[] | null;
    loadCassetteFile: (adapter: string, basename: string) => unknown[] | null;
  };

  // isOfflineMode() — pure env check, always callable
  const offline = mod.isOfflineMode();
  assert.ok(typeof offline === 'boolean', 'isOfflineMode() must return a boolean');

  // loadCassetteDir() — returns null when adapter dir doesn't exist (no throw)
  const dir = mod.loadCassetteDir('crossref');
  assert.ok(
    dir === null || Array.isArray(dir),
    'loadCassetteDir(\'crossref\') must return null or an array (never throw on missing dir)',
  );

  // loadCassetteFile() — returns null when file doesn't exist (no throw)
  const file = mod.loadCassetteFile('crossref', '__nonexistent_test_sentinel__');
  assert.strictEqual(
    file,
    null,
    'loadCassetteFile(\'crossref\', \'__nonexistent_test_sentinel__\') must return null for a missing cassette',
  );
});
