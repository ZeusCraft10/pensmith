// tests/mcp-stdout-clean.test.ts — the MCP stdio channel stays clean (PLUG-13).
//
// The MCP server speaks JSON-RPC 2.0 on stdout, one message per line, and its
// pensmith_* tools run the CLI verbs in-process. Before the output sink, a
// verb's `pensmith plan: wrote PLAN.md …` line landed in that stream and
// Claude Code dropped the server (T1-15). This suite spawns the server over
// raw stdio through a transport that checks EVERY stdout line as it arrives
// (each must parse as a JSON-RPC 2.0 message) and drives it with the SDK
// client, on a paper the built CLI seeded (new → research → outline, with
// PENSMITH_NO_LLM=1, sources offline, the runner's isolated data dir). Every
// tool is called with valid arguments — the paper_* state tools,
// paper_doi_verify (its recorded Crossref fixture), paper_capability_probe,
// paper_ingest_zotero_items (a valid item), pensmith_plan, pensmith_write,
// pensmith_verify and pensmith_status, also in parallel — and the client's
// onerror must never fire. The verbs' own lines must arrive on stderr (the
// sink), never be dropped.
//
// Legs: the tsc build `dist/mcp/server.js` (run `npm run build` first) and the
// plugin's committed bundle `plugin/dist/mcp/server.mjs` — required wherever
// the plugin layout exists (plugin/.claude-plugin/plugin.json) or the bundle
// was built.
//
// The static half: the `mcp-stdout-graph` chokepoint row holds on the real
// import graph, and fires once a verb the tools reach writes to stdout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessageSchema, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { graphViolations, loadChokepointRow } from './helpers/chokepoint-row.js';

const REPO = resolve('.');
const CLI_BIN = join(REPO, 'dist', 'bin', 'pensmith.js');
const TSC_SERVER = join(REPO, 'dist', 'mcp', 'server.js');
const BUNDLED_SERVER = join(REPO, 'plugin', 'dist', 'mcp', 'server.mjs');
const PLUGIN_MANIFEST = join(REPO, 'plugin', '.claude-plugin', 'plugin.json');

/** The server builds this checkout must keep clean (see the header). */
const LEGS: Array<{ name: string; server: string }> = [
  { name: 'tsc build (dist/mcp/server.js)', server: TSC_SERVER },
  ...(existsSync(PLUGIN_MANIFEST) || existsSync(BUNDLED_SERVER)
    ? [{ name: 'plugin bundle (plugin/dist/mcp/server.mjs)', server: BUNDLED_SERVER }]
    : []),
];

/** The environment of every child: stubbed LLM, sources offline, the runner's isolated data dir. */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PENSMITH_NO_LLM: '1', PENSMITH_OFFLINE: '1', ...extra };
  delete env['PENSMITH_NETWORK_TESTS'];
  delete env['PENSMITH_PAPER_ROOT'];
  return env;
}

/**
 * A Transport over a spawned server that validates every stdout line before
 * the client sees it: a line that is not one JSON-RPC 2.0 message is recorded
 * and reported through onerror (which the Client forwards to its own onerror).
 */
class LineCheckedStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  readonly lines: string[] = [];
  readonly invalid: Array<{ line: string; why: string }> = [];
  stderr = '';
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = '';
  private exited: Promise<void> = Promise.resolve();

  constructor(private readonly server: string, private readonly cwd: string, private readonly env: NodeJS.ProcessEnv) {}

  start(): Promise<void> {
    return new Promise((resolveStart, rejectStart) => {
      const child = spawn(process.execPath, [this.server], { cwd: this.cwd, env: this.env, stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child;
      this.exited = new Promise((r) => child.once('close', () => r()));
      child.once('error', (e) => {
        rejectStart(e);
        this.onerror?.(e);
      });
      child.once('spawn', () => resolveStart());
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        this.stderr += chunk;
      });
      child.once('close', () => {
        if (this.pending !== '') this.reject(this.pending, 'an unterminated line at exit');
        this.pending = '';
        this.onclose?.();
      });
    });
  }

  private reject(line: string, why: string): void {
    this.invalid.push({ line, why });
    this.onerror?.(new Error(`stdout line is not a JSON-RPC 2.0 message (${why}): ${JSON.stringify(line.slice(0, 200))}`));
  }

  private onStdout(chunk: string): void {
    this.pending += chunk;
    for (let nl = this.pending.indexOf('\n'); nl >= 0; nl = this.pending.indexOf('\n')) {
      const line = this.pending.slice(0, nl).replace(/\r$/, '');
      this.pending = this.pending.slice(nl + 1);
      this.lines.push(line);
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        this.reject(line, 'not JSON');
        continue;
      }
      const parsed = JSONRPCMessageSchema.safeParse(raw);
      if (!parsed.success || (raw as { jsonrpc?: unknown }).jsonrpc !== '2.0') {
        this.reject(line, 'not a JSON-RPC 2.0 message');
        continue;
      }
      this.onmessage?.(parsed.data);
    }
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolveSend, rejectSend) => {
      const stdin = this.child?.stdin;
      if (!stdin) return rejectSend(new Error('not connected'));
      stdin.write(JSON.stringify(message) + '\n', (e) => (e ? rejectSend(e) : resolveSend()));
    });
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) return;
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 10_000);
    await this.exited;
    clearTimeout(timer);
  }
}

/** Run the built CLI in `cwd`; returns its outcome (never throws). */
function cli(cwd: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI_BIN, ...args], { cwd, env: childEnv(), encoding: 'utf8', input: '', timeout: 120_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

let seeded: string | null = null;

/** A paper the built CLI made (new → research → outline), copied fresh for each leg. */
function seededPaper(): string {
  if (seeded === null) {
    const root = mkdtempSync(join(tmpdir(), 'pensmith-stdout-clean-seed-'));
    writeFileSync(join(root, 'assignment.txt'), 'Write a 1500-word literature review on attention mechanisms in neural networks, APA style.\n');
    for (const step of [['new', '--from', 'assignment.txt', '--yolo'], ['research', '--yolo'], ['outline', '--yolo']]) {
      const r = cli(root, ...step);
      assert.equal(r.status, 0, `pensmith ${step.join(' ')} seeds the paper:\n${r.stdout}\n${r.stderr}`);
    }
    seeded = root;
  }
  const copy = mkdtempSync(join(tmpdir(), 'pensmith-stdout-clean-'));
  cpSync(seeded, copy, { recursive: true });
  return copy;
}

/** A valid Zotero API item (what a Zotero MCP server returns with format="json"). */
const ZOTERO_ITEM = {
  key: 'VASWANI1',
  version: 12,
  library: { type: 'user', id: 4242 },
  data: {
    key: 'VASWANI1',
    itemType: 'conferencePaper',
    title: 'Attention Is All You Need',
    creators: [
      { creatorType: 'author', firstName: 'Ashish', lastName: 'Vaswani' },
      { creatorType: 'author', firstName: 'Noam', lastName: 'Shazeer' },
    ],
    proceedingsTitle: 'Advances in Neural Information Processing Systems',
    volume: '30',
    date: '2017',
    extra: 'arXiv: 1706.03762',
  },
};

for (const leg of LEGS) {
  test(`PLUG-13: every stdout line is JSON-RPC 2.0 while every tool runs — ${leg.name}`, { timeout: 300_000 }, async () => {
    assert.ok(existsSync(leg.server), `${leg.server} is missing — ${leg.server === TSC_SERVER ? 'run `npm run build`' : 'run `npm run bundle`'}`);
    const root = seededPaper();
    const transport = new LineCheckedStdioTransport(leg.server, root, childEnv({ PENSMITH_PAPER_ROOT: root }));
    const client = new Client({ name: 'mcp-stdout-clean', version: '0.0.0' }, { capabilities: {} });
    const clientErrors: string[] = [];
    client.onerror = (e: Error): void => {
      clientErrors.push(e.message);
    };
    await client.connect(transport);
    const outcomes: Array<{ tool: string; isError: boolean; text: string }> = [];
    const call = async (tool: string, args: Record<string, unknown> = {}): Promise<void> => {
      const res = await client.callTool({ name: tool, arguments: args });
      const text = (res.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n');
      outcomes.push({ tool, isError: res.isError === true, text });
    };
    try {
      const tools = (await client.listTools()).tools.map((t) => t.name).sort();
      await call('pensmith_status');
      await call('paper_capability_probe');
      await call('paper_doi_verify', { doi: '10.1038/nature14539' });
      await call('paper_init_section', { paperRoot: root, n: 4, slug: 'appendix' });
      await call('paper_advance_section', { paperRoot: root, n: 4, toState: 'planned' });
      await call('paper_record_verification', { paperRoot: root, n: 4, verdict: 'PASS' });
      await call('paper_set_status', { paperRoot: root, n: 4, status: 'done' });
      await call('paper_ingest_zotero_items', { paperRoot: root, items: [ZOTERO_ITEM] });
      await call('pensmith_plan', { n: 1, yolo: true });
      await call('pensmith_write', { n: 1, yolo: true });
      await call('pensmith_verify', { n: 1, yolo: true });
      // In parallel: two verbs printing through the sink while status captures.
      await Promise.all([call('pensmith_plan', { n: 2, yolo: true }), call('pensmith_status'), call('pensmith_plan', { n: 3, yolo: true })]);
      await call('pensmith_status');

      assert.deepEqual(new Set(outcomes.map((o) => o.tool)), new Set(tools), 'every registered tool was called');
      const byTool = (tool: string): Array<{ isError: boolean; text: string }> => outcomes.filter((o) => o.tool === tool);
      for (const tool of ['paper_capability_probe', 'paper_doi_verify', 'paper_init_section', 'paper_advance_section', 'paper_record_verification', 'paper_set_status', 'paper_ingest_zotero_items', 'pensmith_plan']) {
        for (const o of byTool(tool)) assert.equal(o.isError, false, `${tool} succeeds with valid arguments: ${o.text.slice(0, 400)}`);
      }
      assert.match(byTool('paper_doi_verify')[0]!.text, /"valid":\s*true/, 'the DOI resolves from its recorded fixture');
      assert.match(byTool('paper_ingest_zotero_items')[0]!.text, /vaswani2017/);
      // write drafts §1 and verifies it; offline, its sources cannot be re-fetched,
      // so the verdict is UNVERIFIABLE — a blocked outcome (exit 4), in both verbs.
      for (const tool of ['pensmith_write', 'pensmith_verify']) {
        const [o] = byTool(tool);
        assert.ok(o, `${tool} ran`);
        assert.equal(o.isError, true, `${tool}: offline verification is unverifiable (blocked): ${o.text.slice(0, 400)}`);
        assert.match(o.text, /"exit_code": 4/);
      }
      for (const o of byTool('pensmith_status')) {
        assert.equal(o.isError, false, o.text);
        assert.match(o.text, /^pensmith status:\n {2}paper: attention mechanisms in neural networks/);
      }
      assert.match(byTool('pensmith_status').at(-1)!.text, /§3 conclusion: planned|#3 conclusion: planned/, 'the last status sees the parallel plans');
    } finally {
      await client.close();
    }

    assert.deepEqual(transport.invalid, [], 'every stdout line is one JSON-RPC 2.0 message');
    assert.deepEqual(clientErrors, [], 'the client never reported a transport or protocol error');
    assert.ok(transport.lines.length >= outcomes.length + 2, `stdout carried the responses (${transport.lines.length} lines)`);
    // The verbs did print — on stderr, where the server points the sink.
    assert.match(transport.stderr, /pensmith plan: wrote PLAN\.md to .*01-introduction/);
    assert.match(transport.stderr, /pensmith write: wrote DRAFT\.md to /);
    assert.match(transport.stderr, /pensmith verify: wrote unverifiable VERIFICATION\.md to /);
    assert.match(transport.stderr, /pensmith plan: wrote PLAN\.md to .*03-conclusion/);
    assert.doesNotMatch(transport.stderr, /^pensmith status:/m, 'the status text was captured into the tool result, not printed');
  });
}

test('PLUG-13: the mcp-stdout-graph row holds on the real import graph and fires on a mutated verb', () => {
  const row = loadChokepointRow('mcp-stdout-graph');
  assert.deepEqual(graphViolations(row), [], 'no module reachable from mcp/ writes to stdout');
  // The mutation the stream summary records: plan.ts printing straight to stdout.
  const planTs = join(REPO, 'bin', 'cli', 'plan.ts');
  const mutated = readFileSync(planTs, 'utf8').replace("out(`pensmith plan --revise: ${result.message}\\n`);", "process.stdout.write(`pensmith plan --revise: ${result.message}\\n`);");
  assert.ok(mutated.includes('process.stdout.write(`pensmith plan --revise'), 'the mutation applies to the current plan.ts');
  const v = graphViolations(row, { 'bin/cli/plan.ts': mutated });
  assert.ok(v.some((x) => x.reached === 'bin/cli/plan.ts' && x.chain[0]!.startsWith('mcp/')), JSON.stringify(v));
});
