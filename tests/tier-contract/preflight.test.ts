// tests/tier-contract/preflight.test.ts
//
// Tier-contract PREFLIGHT — runs before Cases A–D in tier-contract.test.ts.
// Asserts the precondition surface so a build break fails with a crisp error
// rather than an SDK stack trace inside a Case.
//
// D-13: exactly 5 resources, exactly 6 tools. D-22: passes on all 3 OSes.
// NOTE: DOCT-05 (end-to-end fixture probe) is NOT here — deferred to Phase 3
// per CONTEXT D-04. This file only asserts build-artifact presence + the
// registration counts the server promises (D-13 TIER-01/TIER-02 LOCKED sets).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { statSync, existsSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const MCP_BIN = 'dist/mcp/server.js';
const CLI_BIN = 'dist/bin/pensmith.js';

// D-13 / TIER-01: exactly 5 resources with these template names (LOCKED).
const EXPECTED_RESOURCES = ['capabilities', 'library', 'outline', 'section', 'state'];

// D-13 / TIER-02: exactly 6 snake_case tools (LOCKED).
// D-13 / TIER-02 + Plan 03-07 Task 7.3: 6 Phase-2 snake_case tools + 3 Phase-3
// per-section verb tools = 9 total. Phase 2 names stay snake_case (D-13
// LOCKED); Phase 3 verb tools use the `pensmith_<verb>` prefix to distinguish
// the "Tier-1 surface of a CLI verb" from the state-mutation tools.
const EXPECTED_TOOLS = [
  'paper_advance_section',
  'paper_capability_probe',
  'paper_doi_verify',
  'paper_init_section',
  'paper_record_verification',
  'paper_set_status',
  'pensmith_plan',
  'pensmith_verify',
  'pensmith_write',
];

let client: Client;
let transport: StdioClientTransport;

before(async () => {
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
  });
  client = new Client(
    { name: 'tier-contract-preflight', version: '0.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport);
});

after(async () => {
  await client?.close();
});

test('preflight: dist/mcp/server.js exists and is non-empty', () => {
  assert.ok(existsSync(MCP_BIN), `${MCP_BIN} missing — run \`npm run build\``);
  assert.ok(statSync(MCP_BIN).size > 0, `${MCP_BIN} is empty`);
});

test('preflight: dist/bin/pensmith.js exists and is non-empty', () => {
  assert.ok(existsSync(CLI_BIN), `${CLI_BIN} missing — run \`npm run build\``);
  assert.ok(statSync(CLI_BIN).size > 0, `${CLI_BIN} is empty`);
});

test('preflight: MCP server registers exactly 5 resources (D-13)', async () => {
  // SDK note: template resources (paper://section/{n}) appear under
  // listResourceTemplates(), not listResources(). We sum both to enforce the
  // TIER-01 "5 resources" invariant — 4 static + 1 template.
  const staticRes = await client.listResources();
  const templateRes = await client.listResourceTemplates();
  const staticNames = (staticRes.resources ?? []).map((r: { name: string }) => r.name);
  const templateNames = (templateRes.resourceTemplates ?? []).map((r: { name: string }) => r.name);
  const names = [...staticNames, ...templateNames].sort();
  assert.equal(names.length, 5, `expected 5 resources (4 static + 1 template), got ${names.length}: ${JSON.stringify(names)}`);
  assert.deepEqual(names, EXPECTED_RESOURCES, 'resource name set mismatch');
});

test('preflight: MCP server registers exactly 9 tools (6 Phase-2 + 3 Phase-3 Plan 03-07 Task 7.3)', async () => {
  const res = await client.listTools();
  const names = (res.tools ?? []).map((t: { name: string }) => t.name).sort();
  assert.equal(names.length, 9, `expected 9 tools (6 Phase-2 + 3 Phase-3), got ${names.length}: ${JSON.stringify(names)}`);
  assert.deepEqual(names, EXPECTED_TOOLS, 'tool name set mismatch (TIER-02 snake_case + Plan 03-07 pensmith_<verb> names are LOCKED)');
});

test('preflight: CLI --version exits 0 with semver stdout', () => {
  const out = execFileSync(process.execPath, [CLI_BIN, '--version'], {
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(out.trim(), /^\d+\.\d+\.\d+/, `CLI --version did not return semver: ${out}`);
});
