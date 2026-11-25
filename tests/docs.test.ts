// tests/docs.test.ts
//
// The user-facing docs must say what the code does:
//   - README's command table is generated from each verb's own CLI definition
//     (scripts/verb-table.ts) and must match it exactly;
//   - README states the alpha status, that Tier-1 drafting needs an API key in
//     this phase, and install steps that match the plugin layout;
//   - README makes none of the claims the audit found false;
//   - README names exactly the verdicts that block compile and export, as the
//     verdict parser compile and done use decides them;
//   - PRIVACY.md names every host the shipped code sends requests to.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderVerbTable, extractTable } from '../scripts/verb-table.js';
import {
  parseVerdictRows,
  renderPass1VerdictRow,
  renderPass3VerdictRow,
} from '../bin/lib/verify/verdict-rows.js';

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
  ];
  for (const [re, why] of banned) assert.ok(!re.test(readme), `README must not claim ${re}: ${why}`);
});

// Every verdict name the verifier writes or the design names. A verdict that is
// not listed here but is named in README's verifier section is checked too.
const KNOWN_VERDICTS = [
  'OK', 'FABRICATED', 'MIS-CITED', 'RETRACTED', 'UNRESOLVED',
  'NOT_FOUND', 'PDF_UNAVAILABLE', 'TEXT_UNAVAILABLE',
];
const VERDICT_TOKEN = /`([A-Z][A-Z_-]+)`/g;
const verdictsIn = (md: string): string[] => [...md.matchAll(VERDICT_TOKEN)].map((m) => m[1]!);

/** Does a verdict row carrying `verdict` block compile and export? Asks the parser compile and done use. */
function blocks(verdict: string): boolean {
  const rows = [
    renderPass1VerdictRow('k1', verdict, 1, 1, 'r'),
    renderPass3VerdictRow('k3', 'quote', verdict, 1, 'r'),
  ].join('\n');
  return parseVerdictRows(rows).length > 0;
}

test('README names exactly the verdicts that block compile and export', () => {
  const verifier = section(readme, 'The citation verifier');
  const candidates = [...new Set([...KNOWN_VERDICTS, ...verdictsIn(verifier)])];
  const blocking = candidates.filter(blocks);
  assert.ok(blocking.length > 0, 'the verdict parser must block on some verdict');

  const intro = readme.split('\n').find((l) => l.startsWith('What makes it different'));
  assert.ok(intro, 'README must say up front what blocks compile and export');
  assert.deepEqual(
    [...new Set(verdictsIn(intro))].sort(),
    [...blocking].sort(),
    'the README intro must name every blocking verdict and no other',
  );

  const rows = verifier.split('\n').filter((l) => /^\| \*\*Pass/.test(l));
  assert.ok(rows.length > 0, 'README must have the verifier table');
  const inBlockingRows = rows.filter((r) => /\|\s*Yes\s*\|\s*$/.test(r)).flatMap(verdictsIn);
  const inOtherRows = rows.filter((r) => !/\|\s*Yes\s*\|\s*$/.test(r)).flatMap(verdictsIn);
  for (const v of blocking) {
    assert.ok(inBlockingRows.includes(v), `the verifier table must list \`${v}\` in a row that blocks`);
  }
  for (const v of inBlockingRows) assert.ok(blocks(v), `the verifier table says \`${v}\` blocks, but it does not`);
  for (const v of inOtherRows) assert.ok(!blocks(v), `the verifier table says \`${v}\` does not block, but it does`);

  if (!blocks('UNRESOLVED')) {
    assert.ok(
      !/verifier could not confirm/i.test(readme) && !/could not (be )?confirm|unconfirmed/i.test(intro),
      'an UNRESOLVED (unconfirmed) citation does not block on this code, so README must not say it does',
    );
  }
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
