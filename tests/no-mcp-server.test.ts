// tests/no-mcp-server.test.ts
//
// Pensmith ships no MCP server in v0.x. The old stdio server ran CLI verbs
// in-process and wrote plain text onto the JSON-RPC stream, its state tools
// were silent no-ops, its resources read the wrong root, and its tools let the
// model pass `yolo` and an arbitrary paperRoot. Tier 1 drives the bundled CLI
// instead. These checks keep the server, its SDK and every declaration of it
// from coming back by accident.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDoctor } from '../bin/lib/doctor/probes.js';
import { loadCapabilityFacts } from '../bin/lib/capabilities.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const at = (rel: string): string => path.join(repoRoot, rel);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'fixtures' || entry.name === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|mjs|cjs|js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

test('there is no MCP server source and no project-scope .mcp.json', () => {
  assert.ok(!existsSync(at('mcp')), 'mcp/ must not exist');
  assert.ok(!existsSync(at('.mcp.json')), 'root .mcp.json must not exist (it loads as a project MCP config in a checkout)');
});

test('the MCP SDK is not a dependency', () => {
  const pkg = JSON.parse(readFileSync(at('package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.ok(!pkg.dependencies?.['@modelcontextprotocol/sdk'], 'dependencies must not include @modelcontextprotocol/sdk');
  assert.ok(!pkg.devDependencies?.['@modelcontextprotocol/sdk'], 'devDependencies must not include @modelcontextprotocol/sdk');
});

test('no plugin or marketplace manifest declares an MCP server', () => {
  const manifests = [
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    'plugin/.claude-plugin/plugin.json',
  ].filter((rel) => existsSync(at(rel)));
  assert.ok(manifests.length > 0, 'expected at least one manifest to check');
  for (const rel of manifests) {
    const text = readFileSync(at(rel), 'utf8');
    assert.ok(!/mcpServers/.test(text), `${rel} must not declare mcpServers`);
  }
  assert.ok(!existsSync(at('plugin/.mcp.json')), 'plugin/.mcp.json must not exist');
});

test('no source or test file imports the MCP SDK', () => {
  const offenders: string[] = [];
  for (const dir of ['bin', 'hooks', 'scripts', 'tests']) {
    if (!existsSync(at(dir)) || !statSync(at(dir)).isDirectory()) continue;
    for (const file of sourceFiles(at(dir))) {
      const src = readFileSync(file, 'utf8');
      if (/(?:from\s+|import\(\s*|require\(\s*)['"]@modelcontextprotocol\//.test(src)) offenders.push(path.relative(repoRoot, file));
    }
  }
  assert.deepEqual(offenders, [], `files still import the MCP SDK:\n${offenders.join('\n')}`);
});

test('doctor no longer probes for an MCP server build', async () => {
  const results = await runDoctor();
  assert.ok(!('mcp-sdk-presence' in results), 'doctor must not run the mcp-sdk-presence probe');
  for (const r of Object.values(results)) {
    assert.ok(!/dist\/mcp\/server\.js/.test(`${r.summary} ${r.detail ?? ''}`), `probe ${r.id} still mentions dist/mcp/server.js`);
  }
});

test('capability facts do not claim an MCP server is present', async () => {
  const facts = (await loadCapabilityFacts()) as unknown as Record<string, unknown>;
  assert.ok(!('mcp_self' in facts), 'capability facts must not carry mcp_self');
});
