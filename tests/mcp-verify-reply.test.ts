// tests/mcp-verify-reply.test.ts — what the MCP `pensmith_verify` tool hands
// the model (Phase 20 + 23a merge, review round 1):
//
//   - a small JSON summary (status, blocked, the VERIFICATION.md path, the
//     summary counts) and the blocking rows inside the FEED-05 fence after a
//     data note — never the gate result with its parsed CITATIONS.bib, whose
//     citation-js entries each carry the whole parse (the reply grew with the
//     square of the library and carried every uncited abstract, unfenced);
//   - the server cannot prompt: with PENSMITH_PROMPT_MODE=numbered in its
//     environment, the quote-accept gate (VRFY-20) is skipped as without a
//     terminal — it never reads an answer from the JSON-RPC stdin, so the call
//     returns at once and the paper's session lock is released.
//
// Both legs: the tsc build (`npm run build`) and the plugin bundle
// (`npm run bundle`). Offline: the recorded Crossref answer for lecun2015;
// no contact email, so Pass 3 cannot ask Unpaywall and the quote is
// UNVERIFIABLE-QUOTE (D-20-03).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { EXIT_BLOCKED } from '../bin/lib/exit-codes.js';
import { FENCE_OPEN, unfence } from '../bin/lib/untrusted-fence.js';
import { verifyReply, MAX_REPLY_ROWS, MAX_REPLY_ROW_CHARS } from '../bin/lib/verify/verify-reply.js';
import type { GateRow } from '../bin/lib/verify/gate.js';
import { MCP_BIN, REPO, runCli } from './helpers/paper-cli-harness.js';
import { seedGatePaper, LECUN_BIB, type GatePaper } from './helpers/gate-paper.js';

const BUNDLED_SERVER = join(REPO, 'plugin', 'dist', 'mcp', 'server.mjs');
const LEGS = [
  { name: 'plugin bundle', server: BUNDLED_SERVER },
  { name: 'tsc build', server: MCP_BIN },
];

const QUOTE = 'attention mechanisms are nothing more than lookup tables for bananas';
const ABSTRACT_MARKER = 'UNCITED-ABSTRACT-MARKER';

/** §1 quotes lecun2015; the bibliography also holds `uncited` entries with long abstracts. */
function quotePaper(prefix: string, uncited: number): GatePaper {
  const abstract = `${ABSTRACT_MARKER} ${'An abstract of a work this section never cites. '.repeat(28)}`;
  const extra = Array.from(
    { length: uncited },
    (_, i) => `@article{uncited${i},\n  title = {Uncited work ${i}},\n  author = {Author, Some},\n  journal = {Journal},\n  year = {2020},\n  abstract = {${abstract}}\n}\n`,
  ).join('\n');
  return seedGatePaper(
    prefix,
    [{ n: 1, slug: 'intro', assigned: ['lecun2015'], draft: `# Intro\n\nOne review claims that "${QUOTE}" [@lecun2015].\n` }],
    `${LECUN_BIB}\n${extra}`,
  );
}

interface Reply {
  isError: boolean;
  blocks: string[];
  stderr: string;
}

async function callVerify(server: string, p: GatePaper, env: Record<string, string | undefined>): Promise<Reply> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    env: p.sb.env({ PENSMITH_PAPER_ROOT: p.root, PENSMITH_CONTACT_EMAIL: undefined, ...env }),
    cwd: p.root,
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString('utf8');
  });
  const client = new Client({ name: 'mcp-verify-reply', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  try {
    // A short timeout: a server that prompts on its JSON-RPC stdin never answers.
    const res = await client.callTool({ name: 'pensmith_verify', arguments: { n: 1, yolo: true } }, undefined, { timeout: 20_000 });
    const blocks = (res.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? '');
    return { isError: res.isError === true, blocks, stderr };
  } finally {
    await client.close();
  }
}

function planStatus(p: GatePaper): string | undefined {
  return /^status:\s*(\S+)/m.exec(readFileSync(join(p.sectionDir(1, 'intro'), 'PLAN.md'), 'utf8'))?.[1];
}

for (const leg of LEGS) {
  test(`pensmith_verify replies with a bounded summary and the blocking rows fenced — no parsed bibliography, no uncited abstract (40 uncited entries) — ${leg.name}`, async () => {
    assert.ok(existsSync(leg.server), `${leg.server} is missing — run \`npm run build\` / \`npm run bundle\``);
    const p = quotePaper('mcp-verify-reply', 40);
    const r = await callVerify(leg.server, p, {});
    const text = r.blocks.join('\n');
    assert.ok(text.length < 8_000, `the reply is ${text.length} characters`);
    assert.ok(!text.includes(ABSTRACT_MARKER), 'no uncited abstract reaches the reply');
    assert.doesNotMatch(text, /_graph|"entries"|"pass1"|"pass2"|"pass3"|"gate"/);

    assert.equal(r.isError, true, text);
    assert.equal(r.blocks.length, 3, 'the JSON summary, the data note, the fenced rows');
    const body = JSON.parse(r.blocks[0] ?? '') as { exit_code: number; result: Record<string, unknown> };
    assert.equal(body.exit_code, EXIT_BLOCKED);
    assert.deepEqual(Object.keys(body.result).sort(), ['blocked', 'blocking_rows', 'ok', 'path', 'status', 'summary']);
    assert.equal(body.result['status'], 'unverifiable');
    assert.equal(body.result['blocked'], true);
    assert.equal(body.result['blocking_rows'], 1);
    assert.equal(body.result['path'], join(p.sectionDir(1, 'intro'), 'VERIFICATION.md'));
    assert.ok(!(r.blocks[0] ?? '').includes(QUOTE.slice(0, 20)), 'the JSON half quotes nothing from the draft');
    const summary = body.result['summary'] as Array<{ pass: string; verdict: string; count: number }>;
    assert.deepEqual(summary.filter((s) => s.pass === 'Pass-1' || s.pass === 'Pass-3'), [
      { pass: 'Pass-1', verdict: 'OK', count: 1 },
      { pass: 'Pass-3', verdict: 'UNVERIFIABLE-QUOTE', count: 1 },
    ]);

    assert.match(r.blocks[1] ?? '', /^pensmith_verify: .*fenced as untrusted data/);
    assert.ok((r.blocks[2] ?? '').startsWith(FENCE_OPEN));
    const rows = unfence(r.blocks[2] ?? '');
    assert.ok(rows !== null, 'exactly one fenced block');
    assert.match(rows, /^- lecun2015 \[q1\] \("attention mechanisms.*\*\*UNVERIFIABLE-QUOTE\*\*/);
    // The rows are the ones VERIFICATION.md lists.
    const verification = readFileSync(join(p.sectionDir(1, 'intro'), 'VERIFICATION.md'), 'utf8');
    for (const line of rows.split('\n')) assert.ok(verification.includes(line), `VERIFICATION.md lists: ${line}`);
  });

  test(`pensmith_verify never prompts on the JSON-RPC stdin: PENSMITH_PROMPT_MODE=numbered skips the quote-accept gate and releases the paper — ${leg.name}`, async () => {
    assert.ok(existsSync(leg.server), `${leg.server} is missing — run \`npm run build\` / \`npm run bundle\``);
    const p = quotePaper('mcp-verify-numbered', 0);
    const r = await callVerify(leg.server, p, { PENSMITH_PROMPT_MODE: 'numbered' });
    assert.equal(r.isError, true, r.blocks.join('\n'));
    assert.equal((JSON.parse(r.blocks[0] ?? '') as { exit_code: number }).exit_code, EXIT_BLOCKED);
    assert.doesNotMatch(r.stderr, /Accept these quotes|Enter comma-separated/, 'no question was asked');
    assert.equal(planStatus(p), 'unverifiable', 'the verdict is persisted, not left at verifying');
    // The paper is free again: a CLI verify is not refused by the session lock.
    const cli = runCli(p.sb, p.root, ['verify', '1', '--yolo'], { env: { PENSMITH_CONTACT_EMAIL: undefined } });
    assert.equal(cli.status, EXIT_BLOCKED, `${cli.stdout}\n${cli.stderr}`);
    assert.doesNotMatch(cli.stderr, /another pensmith session/);
  });
}

function pass1Row(key: string, verdict: string, reason = 'r'): GateRow {
  return { kind: 'pass1', key, verdict, titleJW: 1, authorJW: 1, reason };
}

test('verifyReply: lists only blocking rows, at most MAX_REPLY_ROWS of them, each at most MAX_REPLY_ROW_CHARS long; an accepted quote passes', () => {
  const rows: GateRow[] = [
    pass1Row('ok1', 'OK'),
    ...Array.from({ length: MAX_REPLY_ROWS + 5 }, (_, i) => pass1Row(`bad${i}`, 'MIS-CITED', 'x'.repeat(i === 0 ? 5000 : 10))),
    { kind: 'pass3', key: 'k', id: 'q1', quoteSha256: 'h', snippet: 's', verdict: 'UNVERIFIABLE-QUOTE', levRatio: Number.NaN, reason: 'r', accepted: { at: 't', via: 'flag' } },
  ];
  const reply = verifyReply({ ok: false, status: 'failed', blocked: true, path: '/p/VERIFICATION.md', gate: { rows }, pass2: [], pass4: null, freshness: null });
  assert.ok(reply);
  assert.equal(reply.summary.blocking_rows, MAX_REPLY_ROWS + 5);
  assert.equal(reply.rows.length, MAX_REPLY_ROWS + 1);
  assert.match(reply.rows.at(-1) ?? '', /^… and 5 more blocking row\(s\): VERIFICATION\.md lists every row\.$/);
  for (const line of reply.rows) assert.ok(line.length <= MAX_REPLY_ROW_CHARS, `${line.length}`);
  assert.ok(reply.rows[0]?.endsWith('…'));
  assert.ok(!reply.rows.some((l) => l.includes('ok1') || l.includes('[q1]')));
  assert.deepEqual(reply.summary.summary, [
    { pass: 'Pass-1', verdict: 'OK', count: 1 },
    { pass: 'Pass-1', verdict: 'MIS-CITED', count: MAX_REPLY_ROWS + 5 },
    { pass: 'Pass-3', verdict: 'UNVERIFIABLE-QUOTE (accepted)', count: 1 },
  ]);
});

test('verifyReply: an early refusal (no gate) is a summary with no rows; a thrown verb (null) is no reply', () => {
  const reply = verifyReply({ ok: false, status: 'failed', blocked: true, path: '/p/VERIFICATION.md' });
  assert.deepEqual(reply, { summary: { ok: false, status: 'failed', blocked: true, path: '/p/VERIFICATION.md', summary: [], blocking_rows: 0 }, rows: [] });
  assert.equal(verifyReply(null), null);
  assert.equal(verifyReply({ ok: true }), null);
});
