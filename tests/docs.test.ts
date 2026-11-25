// tests/docs.test.ts
//
// The user-facing docs must say what the code does:
//   - README's command table is generated from each verb's own CLI definition
//     (scripts/verb-table.ts) and must match it exactly;
//   - README states the alpha status, that Tier-1 drafting needs an API key in
//     this phase, and install steps that match the plugin layout;
//   - README makes none of the claims the audit found false;
//   - PRIVACY.md names every host the shipped code sends requests to.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderVerbTable, extractTable } from '../scripts/verb-table.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), 'utf8');
const readme = read('README.md');
const privacy = read('PRIVACY.md');
const version = (JSON.parse(read('package.json')) as { version: string }).version;

test('README command table matches the CLI verb definitions', async () => {
  const table = extractTable(readme);
  assert.ok(table, 'README.md must contain the generated verb-table block');
  assert.equal(table, await renderVerbTable(), 'README command table is stale: run `npm run docs:verbs`');
});

test('README states the alpha status, the version and the Phase-1 API-key need', () => {
  assert.match(readme, /alpha/i);
  assert.ok(readme.includes(version), `README must name the current version ${version}`);
  assert.match(readme, /ANTHROPIC_API_KEY/);
  assert.match(readme, /Node\.js 22\.12|node-%3E%3D22\.12/);
});

test('README install steps match the plugin layout', () => {
  assert.match(readme, /plugin marketplace add/);
  assert.match(readme, /plugin install pensmith@pensmith/);
  assert.match(readme, /npm link/);
  assert.ok(!/npm run build[\s\S]{0,200}\/plugin marketplace add/.test(readme), 'installing the plugin needs no build step');
});

test('README makes none of the claims the code does not back', () => {
  const banned: Array<[RegExp, string]> = [
    [/no (separate )?API key (is )?(required|needed)/i, 'Tier 1 needs an API key in this phase'],
    [/PII is redacted before any model call/i, 'PII redaction is opt-in at intake and is not applied to every model call'],
    [/hard ceiling on model spend/i, 'the cost cap is a pre-flight estimate check, not a hard ceiling'],
    [/dist\/mcp|MCP wiring|(ships|includes|provides) an MCP server/i, 'there is no MCP server'],
    [/offline[- ]by[- ]default/i, 'production network mode is not offline by default'],
    [/Skills \+ an MCP/i, 'there is no MCP server'],
  ];
  for (const [re, why] of banned) assert.ok(!re.test(readme), `README must not claim ${re}: ${why}`);
});

/** Hosts named in string literals of modules that send requests through bin/lib/http.ts. */
function requestHosts(): Map<string, string[]> {
  const hosts = new Map<string, string[]>();
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : [],
    );
  for (const file of walk(path.join(repoRoot, 'bin'))) {
    const src = readFileSync(file, 'utf8');
    if (!/from ['"](\.\.?\/)+(lib\/)?http\.js['"]/.test(src)) continue;
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    for (const m of code.matchAll(/['"`]https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
      const host = m[1]!.toLowerCase();
      hosts.set(host, [...(hosts.get(host) ?? []), path.relative(repoRoot, file)]);
    }
  }
  return hosts;
}

test('PRIVACY.md names every host the shipped code sends requests to', () => {
  const hosts = requestHosts();
  assert.ok(hosts.size >= 8, `expected the source adapters' hosts, found ${[...hosts.keys()].join(', ')}`);
  const missing = [...hosts.keys()].filter((h) => !privacy.includes(h));
  assert.deepEqual(missing, [], `PRIVACY.md does not mention: ${missing.map((h) => `${h} (${hosts.get(h)!.join(', ')})`).join('; ')}`);
});

test('PRIVACY.md is a host-by-host table that covers model providers and arbitrary PDF hosts', () => {
  assert.match(privacy, /\| *Host *\|/i, 'PRIVACY.md must contain a host table');
  assert.match(privacy, /api\.anthropic\.com/);
  assert.match(privacy, /api\.openai\.com/);
  assert.match(privacy, /open-access/i);
  assert.match(privacy, /local-only/i);
  assert.match(privacy, /No telemetry/i);
});
