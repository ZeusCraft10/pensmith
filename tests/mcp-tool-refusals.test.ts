// tests/mcp-tool-refusals.test.ts — what the plugin's section tools answer
// when they cannot run (review round 2; PLUG-05, PLUG-03).
//
// Spawns the MCP server over stdio — the plugin's committed bundle
// (plugin/dist/mcp/server.mjs, what a Claude Code install runs) and the tsc
// build (dist/mcp/server.js) — and asserts:
//   - in a folder with no paper, pensmith_plan / pensmith_write /
//     pensmith_verify are the CLI's EXIT_USAGE refusal (`no paper in <folder> —
//     run pensmith new …`) and create nothing: no `.paper/`, no placeholder
//     section, no model call;
//   - in a paper with no model provider configured, pensmith_plan and
//     pensmith_write fail with the one-line missing-key error that names
//     `pensmith doctor`, and no tool response promises "key-free" operation
//     (this release has none: plan and write bill the configured provider in
//     both tiers — README "Model runtimes").
//
// Run `npm run build` (tsc leg) and `npm run bundle` (bundle leg) first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { EXIT_USAGE } from '../bin/lib/exit-codes.js';
import { MCP_BIN, REPO, sandbox, writeOutline, writeState, type Sandbox } from './helpers/paper-cli-harness.js';

const BUNDLED_SERVER = join(REPO, 'plugin', 'dist', 'mcp', 'server.mjs');
const LEGS = [
  { name: 'plugin bundle', server: BUNDLED_SERVER },
  { name: 'tsc build', server: MCP_BIN },
];

interface ToolAnswer {
  isError: boolean;
  text: string;
  body: { exit_code?: number; classification?: string; message?: string | null; result?: unknown };
}

async function withServer<T>(server: string, sb: Sandbox, cwd: string, env: Record<string, string | undefined>, fn: (call: (name: string, args: Record<string, unknown>) => Promise<ToolAnswer>) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: sb.env(env), cwd });
  const client = new Client({ name: 'mcp-tool-refusals', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  try {
    return await fn(async (name, args) => {
      const res = await client.callTool({ name, arguments: args });
      const text = (res.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n');
      let body: ToolAnswer['body'] = {};
      try {
        body = JSON.parse((res.content as Array<{ text?: string }>)[0]?.text ?? '{}') as ToolAnswer['body'];
      } catch {
        body = {};
      }
      return { isError: res.isError === true, text, body };
    });
  } finally {
    await client.close();
  }
}

for (const leg of LEGS) {
  test(`PLUG-05: the section tools refuse a folder with no paper like the CLI and create nothing — ${leg.name}`, async () => {
    assert.ok(existsSync(leg.server), `${leg.server} is missing — run \`npm run build\` / \`npm run bundle\``);
    const sb = sandbox('mcp-no-paper');
    const empty = sb.project('empty');
    // A provider IS configured here (the stub), so only the missing paper can stop the calls.
    const answers = await withServer(leg.server, sb, empty, { PENSMITH_PAPER_ROOT: undefined }, async (call) => [
      await call('pensmith_plan', { n: 1, yolo: true }),
      await call('pensmith_write', { n: 1, yolo: true }),
      await call('pensmith_verify', { n: 1, yolo: true }),
    ]);
    for (const a of answers) {
      assert.equal(a.isError, true, a.text);
      assert.equal(a.body.exit_code, EXIT_USAGE, a.text);
      assert.equal(a.body.classification, 'EXIT_USAGE');
      assert.equal(a.body.message, `no paper in ${empty} — run pensmith new to start one here, or pass --paper <name|path> (pensmith list shows your papers)`);
      assert.equal(a.body.result, null, 'the verb never ran');
    }
    assert.deepEqual(readdirSync(empty), [], 'no .paper/, no placeholder section, no cost ledger');
  });

  test(`PLUG-03: with no provider configured, plan and write name \`pensmith doctor\` and never promise key-free operation — ${leg.name}`, async () => {
    assert.ok(existsSync(leg.server), `${leg.server} is missing — run \`npm run build\` / \`npm run bundle\``);
    const sb = sandbox('mcp-no-key');
    const root = sb.project('paper');
    writeState(root, [{ n: 1, slug: 'intro' }]);
    writeOutline(root, [{ n: 1, slug: 'intro' }]);
    const noProvider = { PENSMITH_NO_LLM: undefined, ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined, PENSMITH_PAPER_ROOT: root };
    const answers = await withServer(leg.server, sb, root, noProvider, async (call) => [
      await call('pensmith_plan', { n: 1, yolo: true }),
      await call('pensmith_write', { n: 1, yolo: true }),
      await call('pensmith_status', {}),
    ]);
    for (const a of answers.slice(0, 2)) {
      assert.equal(a.isError, true, a.text);
      assert.match(String(a.body.message), /^pensmith (plan|write): no LLM key configured \(ANTHROPIC_API_KEY is not set for provider anthropic\)\. Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY \(or configure a local endpoint\); `pensmith doctor` checks the setup \(README: Model runtimes\)\.$/);
    }
    for (const a of answers) assert.doesNotMatch(a.text, /key-free/i, 'no tool promises key-free operation in this release');
    assert.equal(existsSync(join(root, '.paper', 'sections', '01-intro', 'PLAN.md')), false, 'nothing was planned');
  });
}
