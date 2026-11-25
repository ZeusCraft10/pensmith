// tests/dependencies.test.ts
//
// package.json must describe what the code actually loads at run time:
// every runtime dependency is imported by shipped source, every package the
// shipped source imports is a runtime dependency, and type-only packages live
// in devDependencies. engines.node must match what the dependencies require
// and what `pensmith doctor` checks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSupportedNodeVersion } from '../bin/lib/doctor/probes/node-version.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

interface Pkg {
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}
const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as Pkg;

// Shipped source = what the CLI and hook bundles are built from.
const SHIPPED_DIRS = ['bin', 'hooks'];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function packageOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return null;
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]!;
  if (builtinModules.includes(name)) return null;
  return name;
}

/**
 * Packages the shipped source loads. `eager` covers value imports, side-effect
 * imports and requires, which must resolve whenever the module loads. Dynamic
 * `import()` is lazy: test-only paths (cassette recording loads nock) may
 * import a devDependency that way.
 */
function runtimeImports(kind: 'eager' | 'all'): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const add = (spec: string, file: string): void => {
    const name = packageOf(spec);
    if (!name) return;
    const files = found.get(name) ?? [];
    files.push(path.relative(repoRoot, file));
    found.set(name, files);
  };
  for (const dir of SHIPPED_DIRS) {
    for (const file of tsFiles(path.join(repoRoot, dir))) {
      const src = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const m of src.matchAll(/^\s*(?:import|export)\s+(?!type\s)[^'";]*?\sfrom\s+['"]([^'"]+)['"]/gm)) add(m[1]!, file);
      for (const m of src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) add(m[1]!, file);
      for (const m of src.matchAll(/\brequire_?\(\s*['"]([^'"]+)['"]\s*\)/g)) add(m[1]!, file);
      if (kind === 'all') {
        for (const m of src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) add(m[1]!, file);
      }
    }
  }
  return found;
}

test('every runtime dependency is loaded by shipped source', () => {
  const used = runtimeImports('all');
  const unused = Object.keys(pkg.dependencies ?? {}).filter((d) => !used.has(d));
  assert.deepEqual(unused, [], `unused or type-only packages in dependencies: ${unused.join(', ')}`);
});

test('every package the shipped source loads eagerly is a runtime dependency', () => {
  const used = runtimeImports('eager');
  const missing = [...used.keys()].filter((name) => !(pkg.dependencies ?? {})[name]);
  assert.deepEqual(
    missing,
    [],
    `shipped source loads packages that are not in dependencies: ${missing
      .map((m) => `${m} (${(used.get(m) ?? []).join(', ')})`)
      .join('; ')}`,
  );
});

test('packages known to be unused are gone', () => {
  for (const name of ['doi-regex', 'p-retry', 'openai', '@modelcontextprotocol/sdk']) {
    assert.ok(!(pkg.dependencies ?? {})[name], `${name} must not be a runtime dependency`);
  }
});

test('engines.node requires Node 22.12 or newer, and doctor agrees', () => {
  assert.equal(pkg.engines?.['node'], '>=22.12.0');
  // undici 7 needs >=20.18.1 and Node 20 is end-of-life; 22.12 is the first
  // 22.x line where every supported OS ships require(esm) unflagged.
  assert.equal(isSupportedNodeVersion('v20.18.1'), false);
  assert.equal(isSupportedNodeVersion('v22.11.0'), false);
  assert.equal(isSupportedNodeVersion('v22.12.0'), true);
  assert.equal(isSupportedNodeVersion('v24.0.0'), true);
  assert.equal(isSupportedNodeVersion(process.version), true, `the test runner's own Node ${process.version} must be supported`);
});

test('@types/node tracks the minimum supported Node major', () => {
  const range = pkg.devDependencies?.['@types/node'] ?? '';
  assert.match(range, /^\^22(\.|$)/, `@types/node should be ^22.x to match engines, got "${range}"`);
});
