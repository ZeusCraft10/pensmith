// tests/package-contents.test.ts
//
// What `npm pack` would publish. The tarball is a distribution artifact, so
// compiled tests, fixtures and their loaders must never be in it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtPluginFile } from './lib/built-plugin.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

interface PackFile { path: string }

function packedFiles(): string[] {
  // Under `npm test`, npm_execpath points at npm's own CLI script, so we can run
  // it with the current node binary on every OS without a shell.
  const npmCli = process.env['npm_execpath'];
  const res = npmCli
    ? spawnSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'], {
        cwd: repoRoot,
        encoding: 'utf8',
      })
    : spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
        cwd: repoRoot,
        encoding: 'utf8',
        shell: process.platform === 'win32',
      });
  assert.equal(res.status, 0, `npm pack --dry-run failed: ${res.stderr}`);
  const parsed = JSON.parse(res.stdout) as Array<{ files: PackFile[] }>;
  return (parsed[0]?.files ?? []).map((f) => f.path.replace(/\\/g, '/'));
}

test('npm pack ships no compiled tests or test fixtures', () => {
  const files = packedFiles();
  assert.ok(files.length > 0, 'npm pack listed no files');
  const leaked = files.filter((f) => /(^|\/)tests\//.test(f) || /\.test\.(js|ts|mjs)$/.test(f));
  assert.deepEqual(leaked, [], `npm pack would ship test files:\n${leaked.slice(0, 20).join('\n')}`);
});

test('npm pack ships the built plugin bundle that package.json bin points at', () => {
  // git ignores plugin/dist, but the package's `files` list must still carry
  // it, or an npm install would get a `pensmith` bin with no file behind it.
  builtPluginFile(path.join(repoRoot, 'plugin'), 'dist/pensmith.mjs');
  const files = packedFiles();
  for (const f of ['plugin/dist/pensmith.mjs', 'plugin/dist/hook.mjs', 'plugin/templates/prompts/section-drafter.md']) {
    assert.ok(files.includes(f), `npm pack must ship ${f}`);
  }
});

test('the production tsconfig excludes tests from the build', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.match(pkg.scripts['build'] ?? '', /tsc -p tsconfig\.build\.json/, 'build must compile with tsconfig.build.json');
  const cfg = JSON.parse(readFileSync(new URL('../tsconfig.build.json', import.meta.url), 'utf8')) as {
    extends?: string;
    include?: string[];
    exclude?: string[];
  };
  assert.equal(cfg.extends, './tsconfig.json');
  for (const inc of cfg.include ?? []) {
    assert.ok(!inc.startsWith('tests'), `tsconfig.build.json must not include ${inc}`);
  }
});
