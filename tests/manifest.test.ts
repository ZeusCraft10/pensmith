// tests/manifest.test.ts
// Wraps scripts/validate-plugin-manifest.cjs (D-17) and asserts the .mcp.json
// and plugin.json.mcpServers shapes directly. Required by VALIDATION.md
// Wave 0.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), 'utf-8');
}

test('scripts/validate-plugin-manifest.cjs exits 0 on valid manifests', () => {
  // Capture stdout/stderr and exit status.
  const out = execFileSync(process.execPath, ['scripts/validate-plugin-manifest.cjs'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(out, /valid/);
});

test('plugin.json declares mcpServers.pensmith with command=node', () => {
  const plugin = JSON.parse(read('.claude-plugin/plugin.json')) as {
    mcpServers?: Record<string, { command?: string; args?: string[] }>;
  };
  assert.ok(plugin.mcpServers, 'plugin.json must declare mcpServers');
  const srv = plugin.mcpServers['pensmith'];
  assert.ok(srv, 'plugin.json.mcpServers.pensmith required');
  assert.equal(srv.command, 'node');
  assert.ok(Array.isArray(srv.args) && srv.args.length === 1);
  assert.match(srv.args[0]!, /dist\/mcp\/server\.js$/);
});

test('.mcp.json declares mcpServers.pensmith with command=node', () => {
  const mcp = JSON.parse(read('.mcp.json')) as {
    mcpServers?: Record<string, { command?: string; args?: string[] }>;
  };
  assert.ok(mcp.mcpServers, '.mcp.json must declare mcpServers');
  const srv = mcp.mcpServers['pensmith'];
  assert.ok(srv, '.mcp.json mcpServers.pensmith required');
  assert.equal(srv.command, 'node');
  assert.match(srv.args![0]!, /dist\/mcp\/server\.js$/);
});

test('marketplace.json owner + plugins[] shape', () => {
  const market = JSON.parse(read('.claude-plugin/marketplace.json')) as {
    name?: string;
    owner?: { name?: string };
    plugins?: Array<{ name?: string; source?: string }>;
  };
  assert.equal(market.name, 'pensmith');
  assert.equal(market.owner?.name, 'Akhil Achanta');
  assert.ok(Array.isArray(market.plugins) && market.plugins.length >= 1);
  assert.equal(market.plugins[0]!.name, 'pensmith');
  assert.equal(market.plugins[0]!.source, './');
});

test('plugin.json kebab-case name + semver version', () => {
  const plugin = JSON.parse(read('.claude-plugin/plugin.json')) as {
    name?: string;
    version?: string;
    author?: { name?: string; email?: string };
    license?: string;
  };
  assert.equal(plugin.name, 'pensmith');
  assert.match(plugin.name!, /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
  assert.match(plugin.version!, /^\d+\.\d+\.\d+/);
  assert.equal(plugin.license, 'MIT');
  assert.equal(plugin.author?.email, 'akhilachanta8@gmail.com');
});

test('validator FAILS when plugin.json is malformed (negative test)', () => {
  // Write a malformed plugin.json to a temp dir, run the validator with
  // its CWD pointed there, expect non-zero exit.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-manifest-'));
  const claudeDir = path.join(tmp, '.claude-plugin');
  fs.mkdirSync(claudeDir, { recursive: true });
  // Bad: missing required `name`.
  fs.writeFileSync(path.join(claudeDir, 'plugin.json'), JSON.stringify({ version: '0.1.0' }));
  fs.writeFileSync(path.join(claudeDir, 'marketplace.json'), JSON.stringify({ name: 'x', owner: { name: 'y' }, plugins: [] }));
  fs.writeFileSync(path.join(tmp, '.mcp.json'), JSON.stringify({ mcpServers: {} }));
  // Copy the validator script into the tmp tree (it expects ../.claude-plugin)
  const scriptsDir = path.join(tmp, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.copyFileSync(
    path.resolve('scripts/validate-plugin-manifest.cjs'),
    path.join(scriptsDir, 'validate-plugin-manifest.cjs'),
  );
  let exitCode = 0;
  try {
    execFileSync(process.execPath, ['scripts/validate-plugin-manifest.cjs'], {
      cwd: tmp, stdio: 'pipe',
    });
  } catch (e: unknown) {
    const err = e as { status?: number };
    exitCode = err.status ?? -1;
  }
  assert.equal(exitCode, 1, 'validator must exit non-zero on missing plugin.name');
});
