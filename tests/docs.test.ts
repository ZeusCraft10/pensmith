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

/** The README section under `## <heading>`, up to the next `## ` heading. */
function section(md: string, heading: string): string {
  const start = md.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `README must have a "## ${heading}" section`);
  const rest = md.slice(start + 1);
  const end = rest.indexOf('\n## ', 1);
  return end < 0 ? rest : rest.slice(0, end);
}

test('README quick start is one command per surface: /pensmith, and pensmith in a terminal', () => {
  const qs = section(readme, 'Quick start');
  const blockLines = [...qs.matchAll(/```[a-z]*\n([\s\S]*?)```/g)]
    .flatMap((m) => m[1]!.split('\n'))
    .map((l) => l.replace(/\s+#.*$/, '').trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  const inline = [...qs.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`]+)`/g)].map((m) => m[1]!.trim());
  const allowed = new Set(['/pensmith', 'pensmith', 'pensmith next']);
  assert.deepEqual(blockLines.filter((l) => !allowed.has(l)), [], 'quick-start code blocks hold nothing but the one command');
  assert.ok(blockLines.length <= 2, `one command per surface, got: ${blockLines.join(' | ')}`);
  assert.ok(blockLines.includes('/pensmith'), 'the Claude Code command is /pensmith');
  assert.ok(blockLines.includes('pensmith') || blockLines.includes('pensmith next'), 'the terminal command is pensmith');
  const others = inline.filter((c) => /^\/?pensmith\b/.test(c) && !allowed.has(c));
  assert.deepEqual(others, [], 'other commands belong in the command reference');
});

test('README install section says Node must be on PATH and how to check it', () => {
  const install = section(readme, 'Install');
  assert.match(install, /Node\.js 22\.12 or newer/);
  assert.match(install, /PATH/);
  assert.match(install, /`node --version`/);
  assert.match(install, /hook/i, 'say that the session-start hook runs with node');
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
    [/(lets|allows) research (to )?(pull|read)|research (can |will )?(pulls?|reads?) from (a |your )?Zotero/i,
      'research does not read from Zotero in this alpha'],
    [/verifier could not confirm/i, 'only FABRICATED, MIS-CITED and quote NOT_FOUND block; an unconfirmed citation does not'],
  ];
  for (const [re, why] of banned) assert.ok(!re.test(readme), `README must not claim ${re}: ${why}`);
});

test('README says research does not read from Zotero yet', () => {
  const row = readme.split('\n').find((l) => l.startsWith('| `ZOTERO_API_KEY`'));
  assert.ok(row, 'README must document ZOTERO_API_KEY');
  assert.match(row, /research does not read from Zotero yet/i);
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
  assert.doesNotMatch(privacy, /, and\s+No telemetry/, 'lower-case "no telemetry" mid-sentence');
});
