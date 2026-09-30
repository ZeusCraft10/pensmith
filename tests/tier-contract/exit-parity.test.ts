// tests/tier-contract/exit-parity.test.ts — RUN-09 tier parity (D-17-34):
// "MCP tools return isError with the same classification". The same fixture
// driven through the Tier-2 CLI (process exit code) and the Tier-1 MCP tool
// (isError + exit_code + classification) must land on the same code.
//
// Run `npm run build` first — both tiers are the BUILT artifacts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { EXIT_OK, EXIT_ERROR, EXIT_BLOCKED, EXIT_USAGE } from '../../bin/lib/exit-codes.js';
import {
  CLI_BIN,
  MCP_BIN,
  sandbox,
  runCli,
  seedFabricatedSection,
  sectionDirOf,
  writeState,
  writeOutline,
  writePlan,
  type Sandbox,
} from '../helpers/paper-cli-harness.js';
import { seedGatePaper, LECUN_BIB } from '../helpers/gate-paper.js';
import { readQuoteAcceptances } from '../../bin/lib/quote-acceptance.js';

interface McpOutcome {
  isError: boolean;
  body: { exit_code?: number; classification?: string; message?: string | null } & Record<string, unknown>;
}

async function callTool(sb: Sandbox, root: string, name: string, args: Record<string, unknown>, extraEnv: Record<string, string | undefined> = {}): Promise<McpOutcome> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(sb.env({ ...extraEnv, PENSMITH_PAPER_ROOT: root }))) if (v !== undefined) env[k] = v;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    env,
    cwd: root,
  });
  const client = new Client({ name: 'exit-parity', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  try {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? 'null';
    return { isError: res.isError === true, body: (JSON.parse(text) ?? {}) as McpOutcome['body'] };
  } finally {
    await client.close();
  }
}

function assertParity(label: string, cliStatus: number | null, mcp: McpOutcome, expected: number, name: string): void {
  assert.equal(cliStatus, expected, `${label}: CLI exit`);
  assert.equal(mcp.isError, expected !== EXIT_OK, `${label}: MCP isError`);
  if (expected !== EXIT_OK) {
    assert.equal(mcp.body.exit_code, expected, `${label}: MCP exit_code`);
    assert.equal(mcp.body.classification, name, `${label}: MCP classification`);
  }
}

test('RUN-09 parity: build artifacts exist', () => {
  assert.ok(existsSync(CLI_BIN) && existsSync(MCP_BIN), 'run npm run build first');
});

test('RUN-09 parity: a failed verification is EXIT_BLOCKED in the CLI and isError exit_code 4 over MCP', async () => {
  const sb = sandbox('parity-blocked');
  const cliRoot = sb.project('cli');
  const mcpRoot = sb.project('mcp');
  seedFabricatedSection(cliRoot);
  seedFabricatedSection(mcpRoot);
  const cli = runCli(sb, cliRoot, ['verify', '1']);
  const mcp = await callTool(sb, mcpRoot, 'pensmith_verify', { n: 1, yolo: true });
  assertParity('verify failed', cli.status, mcp, EXIT_BLOCKED, 'EXIT_BLOCKED');
  for (const root of [cliRoot, mcpRoot]) {
    assert.match(readFileSync(join(sectionDirOf(root, 1, 'intro'), 'VERIFICATION.md'), 'utf8'), /^Status: failed$/m);
  }
  const result = mcp.body['result'] as { status?: string; blocked?: boolean } | null;
  assert.equal(result?.status, 'failed', 'the MCP payload still carries the verb result');
  assert.equal(result?.blocked, true);
});

test('RUN-09 parity: a successful verify is exit 0 in the CLI and a plain result over MCP', async () => {
  const sb = sandbox('parity-ok');
  const roots = [sb.project('cli'), sb.project('mcp')];
  for (const root of roots) {
    writeState(root, [{ n: 1, slug: 'intro' }]);
    writeOutline(root, [{ n: 1, slug: 'intro' }]);
    writePlan(root, 1, 'intro', { status: 'written' });
    // An introduction with no assigned sources that cites nothing verifies (VRFY-24).
    writeFileSync(join(sectionDirOf(root, 1, 'intro'), 'DRAFT.md'), '# Intro\n\nThis paper argues one point and cites nothing yet.\n');
  }
  const cli = runCli(sb, roots[0]!, ['verify', '1']);
  const mcp = await callTool(sb, roots[1]!, 'pensmith_verify', { n: 1, yolo: true });
  assertParity('verify ok', cli.status, mcp, EXIT_OK, 'EXIT_OK');
  for (const root of roots) assert.match(readFileSync(join(sectionDirOf(root, 1, 'intro'), 'VERIFICATION.md'), 'utf8'), /^Status: verified$/m);
});

test('VRFY-20 parity: `verify 1 --accept-quote q1` and pensmith_verify with accept_quote [q1] record the same acceptance and both verify the section', async () => {
  // No contact email: Pass 3 cannot ask Unpaywall, so the quote is UNVERIFIABLE-QUOTE (D-20-03).
  const env = { PENSMITH_CONTACT_EMAIL: undefined, PENSMITH_NO_LLM: '1' };
  const draft = '# Intro\n\nOne review claims that "attention mechanisms are nothing more than lookup tables for bananas" [@lecun2015].\n';
  const papers = ['cli', 'mcp'].map((t) => seedGatePaper(`parity-accept-${t}`, [{ n: 1, slug: 'intro', assigned: ['lecun2015'], draft }], LECUN_BIB));
  const [cliPaper, mcpPaper] = papers as [(typeof papers)[number], (typeof papers)[number]];
  const cli = cliPaper.cli(['verify', '1', '--accept-quote', 'q1'], env);
  const mcp = await callTool(mcpPaper.sb, mcpPaper.root, 'pensmith_verify', { n: 1, yolo: true, accept_quote: ['q1'] }, env);
  assertParity('accept quote', cli.status, mcp, EXIT_OK, 'EXIT_OK');
  for (const p of papers) {
    const dir = p.sectionDir(1, 'intro');
    assert.match(readFileSync(join(dir, 'VERIFICATION.md'), 'utf8'), /^Status: verified$/m);
    const acc = readQuoteAcceptances(dir);
    assert.deepEqual(acc.map((a) => [a.quote_id, a.citekey, a.via]), [['q1', 'lecun2015', 'flag']]);
  }
  // An id that is not an UNVERIFIABLE-QUOTE is refused the same way in both tiers (EXIT_USAGE).
  const bad = ['cli', 'mcp'].map((t) => seedGatePaper(`parity-accept-bad-${t}`, [{ n: 1, slug: 'intro', assigned: ['lecun2015'], draft }], LECUN_BIB));
  const cliBad = bad[0]!.cli(['verify', '1', '--accept-quote', 'q7'], env);
  const mcpBad = await callTool(bad[1]!.sb, bad[1]!.root, 'pensmith_verify', { n: 1, yolo: true, accept_quote: ['q7'] }, env);
  assertParity('accept a missing quote', cliBad.status, mcpBad, EXIT_USAGE, 'EXIT_USAGE');
});

test('RUN-09 parity (VRFY-24): a stub write under PENSMITH_NO_LLM is EXIT_BLOCKED in the CLI and isError exit_code 4 over MCP — its chained verify finds PLACEHOLDER', async () => {
  const sb = sandbox('parity-stub-write');
  const roots = [sb.project('cli'), sb.project('mcp')];
  for (const root of roots) {
    writeState(root, [{ n: 1, slug: 'intro' }]);
    writeOutline(root, [{ n: 1, slug: 'intro' }]);
    writePlan(root, 1, 'intro', { status: 'writing' });
  }
  const cli = runCli(sb, roots[0]!, ['write', '1']);
  const mcp = await callTool(sb, roots[1]!, 'pensmith_write', { n: 1, yolo: true });
  assertParity('stub write', cli.status, mcp, EXIT_BLOCKED, 'EXIT_BLOCKED');
  for (const root of roots) {
    assert.ok(existsSync(join(sectionDirOf(root, 1, 'intro'), 'DRAFT.md')), 'the draft is written');
    assert.match(readFileSync(join(sectionDirOf(root, 1, 'intro'), 'VERIFICATION.md'), 'utf8'), /^- draft: \*\*PLACEHOLDER\*\*/m);
  }
});

test('RUN-09 parity: an expected failure (a PLAN.md from a newer pensmith) is EXIT_ERROR with the same one line', async () => {
  const sb = sandbox('parity-error');
  const roots = [sb.project('cli'), sb.project('mcp')];
  for (const root of roots) {
    writeState(root, [{ n: 1, slug: 'intro' }]);
    writeOutline(root, [{ n: 1, slug: 'intro' }]);
    writePlan(root, 1, 'intro', { schema_version: '7' });
  }
  const cli = runCli(sb, roots[0]!, ['write', '1']);
  const mcp = await callTool(sb, roots[1]!, 'pensmith_write', { n: 1, yolo: true });
  assertParity('newer PLAN.md', cli.status, mcp, EXIT_ERROR, 'EXIT_ERROR');
  assert.match(cli.stderr, /upgrade pensmith$/m);
  assert.match(String(mcp.body.message), /upgrade pensmith$/);
});
