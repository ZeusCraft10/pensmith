// tests/plugin-bundle.test.ts — the committed plugin bundles (PLUG-02,
// D-23a-04; REL-10 legal comments).
//
// A git-marketplace install runs no build step and Claude Code's plugin cache
// holds only `plugin/`, so `plugin/dist/` must be self-contained:
//   - every bundle scripts/bundle.mjs declares is committed, and the total is
//     within a 20 MB budget;
//   - the MCP server, launched exactly as plugin.json declares it (`node
//     ${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.mjs`) from a temp copy of
//     `plugin/` with no node_modules, through a symlinked CLAUDE_PLUGIN_ROOT (a
//     junction on Windows), answers `initialize` and lists the same tools as
//     the tsc-built server;
//   - no bundle resolves a bare package (or any non-builtin module) at
//     runtime: every import, export-from, import(), require() and
//     __require() names a Node builtin, the only createRequire is the banner's,
//     and the only import.meta.resolve is the tsx loader on the pdf worker's
//     `.ts` path, which a bundle never takes;
//   - legal comments are kept: pensmith's license banner, the bundled
//     packages' license comments inline (PDF.js's Apache-2.0 header among
//     them) and the list of bundled packages with their licenses;
//   - every bundle is LF-only and embeds no absolute path of this checkout.
// The drift check itself (`npm run bundle:check`) runs in CI and `npm run check`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { sandbox } from './helpers/paper-cli-harness.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(REPO, 'plugin', 'dist');
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

/** The bundles scripts/bundle.mjs writes (its BUNDLE_ENTRIES outputs). */
async function declaredBundles(): Promise<string[]> {
  const src = readFileSync(join(REPO, 'scripts', 'bundle.mjs'), 'utf8');
  const block = /BUNDLE_ENTRIES = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(src)?.[1] ?? '';
  return [...block.matchAll(/:\s*'([^']+\.mjs)'/g)].map((m) => m[1]!).sort();
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

test('PLUG-02: plugin/dist holds exactly the declared bundles, within the 20 MB budget', async () => {
  assert.ok(existsSync(DIST), 'plugin/dist is missing — run `npm run bundle`');
  const expected = await declaredBundles();
  assert.deepEqual(expected, [
    'hooks/post-tool-use.mjs', 'hooks/pre-compact.mjs', 'hooks/session-start.mjs', 'hooks/stop.mjs',
    'mcp/pdf-worker.mjs', 'mcp/server.mjs',
  ], 'the D-23a-04 bundle paths (the hooks.json / plugin.json contract)');
  const files = filesUnder(DIST);
  assert.deepEqual(files.map((f) => relative(DIST, f).split(sep).join('/')), expected, 'nothing else in plugin/dist');
  const total = files.reduce((n, f) => n + statSync(f).size, 0);
  assert.ok(total <= MAX_TOTAL_BYTES, `plugin/dist is ${(total / 1024 / 1024).toFixed(2)} MB (budget 20 MB)`);
});

// ---------------------------------------------------------------------------
// Runtime module resolution: builtins only.
// ---------------------------------------------------------------------------

interface ModuleUse {
  specifiers: string[];
  createRequireCalls: number;
  metaResolves: string[];
}

function moduleUses(file: string): ModuleUse {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const use: ModuleUse = { specifiers: [], createRequireCalls: 0, metaResolves: [] };
  const literal = (n: ts.Node | undefined): string => (n && ts.isStringLiteralLike(n) ? n.text : '<non-literal>');
  const visit = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) use.specifiers.push(literal(n.moduleSpecifier));
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) use.specifiers.push(literal(n.arguments[0]));
      if (ts.isIdentifier(callee) && (callee.text === 'require' || callee.text === '__require')) use.specifiers.push(literal(n.arguments[0]));
      if (ts.isIdentifier(callee) && /createRequire$/i.test(callee.text)) use.createRequireCalls += 1;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'createRequire') use.createRequireCalls += 1;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'resolve' && ts.isMetaProperty(callee.expression)) {
        use.metaResolves.push(literal(n.arguments[0]));
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return use;
}

test('PLUG-02: no bundle resolves a bare package or any non-builtin module at runtime', async () => {
  for (const rel of await declaredBundles()) {
    const use = moduleUses(join(DIST, ...rel.split('/')));
    const foreign = [...new Set(use.specifiers)].filter((s) => !isBuiltin(s));
    assert.deepEqual(foreign, [], `${rel} loads non-builtin modules at runtime: ${foreign.join(', ')}`);
    assert.ok(use.specifiers.includes('node:module'), `${rel} carries the createRequire banner`);
    assert.equal(use.createRequireCalls, 1, `${rel}: the banner's createRequire is the only one`);
    for (const r of use.metaResolves) {
      assert.equal(r, 'tsx', `${rel}: import.meta.resolve(${r}) — only the pdf worker's .ts path may resolve tsx`);
    }
  }
});

// ---------------------------------------------------------------------------
// Legal comments and output hygiene.
// ---------------------------------------------------------------------------

test('REL-10 / PLUG-02: bundles keep the license banner, inline license comments and the bundled-package list', async () => {
  for (const rel of await declaredBundles()) {
    const text = readFileSync(join(DIST, ...rel.split('/')), 'utf8');
    const head = text.split('\n').filter((l) => !l.startsWith('#!'))[0] ?? '';
    assert.match(head, /^\/\/ pensmith — SPDX-License-Identifier: AGPL-3\.0-or-later\./, `${rel}: license banner (after an entry's shebang)`);
    const list = text.slice(text.lastIndexOf('// Bundled npm packages'));
    assert.match(list, /^\/\/ Bundled npm packages \(name@version — license/, `${rel}: bundled-package list`);
    for (const line of list.split('\n').slice(1).filter((l) => l.length > 0)) {
      assert.match(line, /^\/\/ {3}(@[a-z0-9-._]+\/)?[a-z0-9-._]+@\d+\.\d+\.\d+\S* — \S/, `${rel}: ${line}`);
    }
  }
  const server = readFileSync(join(DIST, 'mcp', 'server.mjs'), 'utf8');
  assert.match(server, /\/\/ {3}@modelcontextprotocol\/sdk@\S+ — MIT/);
  assert.match(server, /\/\/ {3}zod@\S+ — MIT/);
  assert.match(server, /\/\*!\s*\n\s*\* Copyright \(c\) Squirrel Chat et al\., All rights reserved\.\s*\n\s*\* SPDX-License-Identifier: BSD-3-Clause/, 'smol-toml keeps its BSD notice inline');
  const worker = readFileSync(join(DIST, 'mcp', 'pdf-worker.mjs'), 'utf8');
  assert.match(worker, /\/\*! Copyright 2017 Mozilla Foundation\s*\n\s*\*\s*\n\s*\* Licensed under the Apache License, Version 2\.0/, 'PDF.js keeps its Apache-2.0 header');
  assert.match(worker, /\/\/ {3}pdf-parse@1\.1\.1 — MIT/);
});

test('PLUG-02: bundles are LF-only and embed no absolute path of this checkout', async () => {
  const forbidden = [REPO.replace(/[\\/]$/, ''), REPO.replace(/[\\/]$/, '').split(sep).join('/')];
  for (const rel of await declaredBundles()) {
    const text = readFileSync(join(DIST, ...rel.split('/')), 'utf8');
    assert.ok(!text.includes('\r'), `${rel} has a CR`);
    for (const p of forbidden) assert.ok(!text.includes(p), `${rel} embeds ${p}`);
  }
});

// ---------------------------------------------------------------------------
// The server from a copy of plugin/ with no node_modules, via a symlinked root.
// ---------------------------------------------------------------------------

async function listTools(command: string, args: string[], env: Record<string, string>, cwd: string): Promise<{ name: string | undefined; tools: string[] }> {
  const transport = new StdioClientTransport({ command, args, env, cwd, stderr: 'pipe' });
  const client = new Client({ name: 'plugin-bundle-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    return { name: client.getServerVersion()?.name, tools };
  } finally {
    await client.close();
  }
}

test('PLUG-02: the server bundle answers initialize and tools/list from a copy of plugin/ with no node_modules, through a symlinked CLAUDE_PLUGIN_ROOT', async () => {
  const sb = sandbox('plugin-bundle');
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'pensmith-plugin-copy-')));
  const copy = join(base, 'cache', 'pensmith');
  mkdirSync(join(base, 'cache'), { recursive: true });
  cpSync(join(REPO, 'plugin'), copy, { recursive: true });
  assert.equal(existsSync(join(copy, 'node_modules')), false);
  for (let d = copy; ; d = join(d, '..')) {
    assert.equal(existsSync(join(d, 'node_modules')), false, `no node_modules at or above the copy (${d})`);
    if (join(d, '..') === d) break;
  }
  const pluginRoot = join(base, 'plugin-root-link');
  symlinkSync(copy, pluginRoot, 'junction');
  const project = sb.project('project');
  // As plugin.json declares it: `node ${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.mjs`.
  const bundled = await listTools(
    process.execPath,
    [join(pluginRoot, 'dist', 'mcp', 'server.mjs')],
    sb.env({ CLAUDE_PLUGIN_ROOT: pluginRoot }),
    project,
  );
  assert.equal(bundled.name, 'pensmith', 'initialize answered by the pensmith server');
  for (const t of ['pensmith_plan', 'pensmith_write', 'pensmith_verify', 'paper_doi_verify']) {
    assert.ok(bundled.tools.includes(t), `tools/list includes ${t}: ${bundled.tools.join(', ')}`);
  }
  const built = join(REPO, 'dist', 'mcp', 'server.js');
  assert.ok(existsSync(built), 'dist/ is missing — run `npm run build`');
  const tsc = await listTools(process.execPath, [built], sb.env(), project);
  assert.deepEqual(bundled.tools, tsc.tools, 'the bundle serves the same tools as the tsc-built server (run `npm run bundle` after changing mcp/)');
});
