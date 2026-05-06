// tests/repo-files.test.ts
// Smoke test: every required Phase 0 root file exists and contains the
// locked stub strings from D-19, D-20, and the architecture decisions.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), 'utf-8');
}

test('root config files exist', () => {
  for (const f of [
    'package.json',
    'tsconfig.json',
    '.gitignore',
    '.gitattributes',
    'LICENSE',
    'README.md',
    'PRIVACY.md',
    'README-DEV.md',
    'CONTRIBUTING.md',
    'eslint.config.js',
    'mcp/server.ts',
    'scripts/run-tests.mjs',
  ]) {
    assert.ok(fs.existsSync(path.resolve(f)), `missing required file: ${f}`);
  }
});

test('package.json contract', () => {
  const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
  assert.equal(pkg['name'], 'pensmith');
  assert.equal(pkg['type'], 'module');
  assert.equal(pkg['license'], 'MIT');
  const engines = pkg['engines'] as Record<string, string> | undefined;
  assert.equal(engines?.['node'], '>=20.10.0');
  assert.equal(pkg['packageManager'], 'npm@10.9.0');
  const scripts = pkg['scripts'] as Record<string, string> | undefined;
  for (const s of ['lint', 'typecheck', 'test', 'build', 'dev', 'validate:manifests', 'check']) {
    assert.ok(scripts && scripts[s], `package.json missing script: ${s}`);
  }
  assert.equal(scripts?.['test'], 'node scripts/run-tests.mjs',
    'scripts.test must invoke the portable runner (not a shell glob)');
  const dev = pkg['devDependencies'] as Record<string, string> | undefined;
  assert.ok(dev && !dev['eslint-plugin-import'],
    'eslint-plugin-import must NOT be a Phase 0 devDependency (D-06 covered by no-restricted-imports alone)');
});

test('tsconfig contract (D-03)', () => {
  const ts = JSON.parse(read('tsconfig.json')) as {
    compilerOptions: Record<string, unknown>;
    exclude?: string[];
  };
  const co = ts.compilerOptions;
  assert.equal(co['target'], 'ES2022');
  assert.equal(co['module'], 'NodeNext');
  assert.equal(co['moduleResolution'], 'NodeNext');
  assert.equal(co['strict'], true);
  assert.equal(co['noUncheckedIndexedAccess'], true);
  assert.equal(co['exactOptionalPropertyTypes'], true);
  assert.equal(co['verbatimModuleSyntax'], true);
  assert.ok(Array.isArray(ts.exclude) && ts.exclude.includes('tests/fixtures/**/*'),
    'tsconfig.exclude must contain tests/fixtures/**/* so the @ts-nocheck red-team fixture is not type-checked');
});

test('LICENSE is MIT 2026 Akhil Achanta', () => {
  const lic = read('LICENSE');
  assert.match(lic, /MIT License/);
  assert.match(lic, /Copyright \(c\) 2026 Akhil Achanta/);
});

test('README, PRIVACY, README-DEV, CONTRIBUTING stubs are correct', () => {
  assert.match(read('README.md'), /v0\.1\.0 in development/);
  assert.match(read('README.md'), /Phase 6/);
  assert.match(read('PRIVACY.md'), /local-only/i);
  assert.match(read('PRIVACY.md'), /No telemetry/i);
  assert.match(read('README-DEV.md'), /npm run build/);
  assert.match(read('README-DEV.md'), /dist\/mcp\/server\.js/);
  const c = read('CONTRIBUTING.md');
  assert.match(c, /bin\/lib\/http\.ts/);
  assert.match(c, /bin\/lib\/doi\.ts/);
});

test('directory contract from D-21', () => {
  for (const d of [
    'bin', 'bin/lib', 'bin/lib/migrations', 'mcp', 'hooks', 'skills', 'agents',
    'workflows', 'templates', 'templates/citation-styles', 'references',
    'schema', 'tests', 'tests/fixtures', 'scripts',
  ]) {
    assert.ok(fs.statSync(path.resolve(d)).isDirectory(), `missing dir: ${d}`);
  }
});

test('eslint.config.js declares both chokepoints and does NOT use eslint-plugin-import', () => {
  const cfg = read('eslint.config.js');
  assert.match(cfg, /no-restricted-imports/);
  assert.match(cfg, /no-restricted-syntax/);
  assert.match(cfg, /undici/);
  assert.match(cfg, /node:http/);
  assert.match(cfg, /node:https/);
  assert.match(cfg, /bin\/lib\/http\.ts/);
  assert.match(cfg, /bin\/lib\/doi\.ts/);
  assert.match(cfg, /lint-chokepoint-fixture\.ts/);
  assert.ok(!/eslint-plugin-import/.test(cfg),
    'eslint.config.js must not reference eslint-plugin-import at Phase 0');
  assert.ok(!/no-restricted-paths/.test(cfg),
    'eslint.config.js must not use no-restricted-paths at Phase 0 (D-06 satisfied by no-restricted-imports alone)');
});

test('scripts/run-tests.mjs is the test runner (not a shell glob)', () => {
  const runner = read('scripts/run-tests.mjs');
  assert.match(runner, /readdir/);
  assert.match(runner, /\.test\.ts/);
  assert.match(runner, /--import.*tsx/);
  assert.match(runner, /--test/);
  assert.match(runner, /discovered/);
  assert.match(runner, /process\.exit\(1\)/, 'must exit 1 on zero matches');
});
