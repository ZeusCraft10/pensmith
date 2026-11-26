// tests/write-truncated.test.ts — `pensmith write` never saves a cut-off draft.
//
// complete() used to ignore stop_reason, so a draft that hit the output limit
// came back as success, and write saved it as DRAFT.md with status 'written'.
// Here the real CLI drafts against a local server that speaks the Messages
// API (configured as the provider's baseUrl in runtime.json): a streamed
// answer that stops at max_tokens must leave no DRAFT.md, keep the section
// 'writing' so the router retries it, exit non-zero with a plain message, and
// still put the tokens used on the cost ledger.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedCliEnv } from './lib/cli-env.js';
import { messageStream } from './lib/messages-stream.js';
import { pensmithDataDir } from '../bin/lib/paths.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));

const CUT_OFF = messageStream({
  blocks: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Quantum coherence in photosynthetic complexes has been' }],
  stopReason: 'max_tokens',
  inputTokens: 900,
  outputTokens: 64000,
});

function run(args: string[], cwd: string, env: Record<string, string>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), PENSMITH_TS, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString('utf8'); });
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('a draft cut off at the output limit is not saved, and the section stays to be written', async () => {
  let requests = 0;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    req.resume();
    req.on('end', () => {
      requests += 1;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(CUT_OFF);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;

  const root = mkdtempSync(path.join(tmpdir(), 'pensmith-write-cut-'));
  const sec = path.join(root, '.paper', 'sections', '01-intro');
  mkdirSync(sec, { recursive: true });
  writeFileSync(path.join(root, '.paper', 'OUTLINE.md'), '# Paper\n\n| # | slug | title | depends_on | word target | assigned_sources |\n| --- | --- | --- | --- | --- | --- |\n| 1 | intro | Intro | | 300 | |\n');
  writeFileSync(path.join(sec, 'PLAN.md'), '---\nsection: 1\nslug: intro\ntitle: Intro\nstatus: writing\nassigned_sources: []\n---\n# Intro\n\nBrief.\n');

  const env = isolatedCliEnv({
    ANTHROPIC_API_KEY: 'sk-ant-local-test',
    PENSMITH_NO_LLM: undefined,
    PENSMITH_OFFLINE: undefined,
    // Live mode against the local server; nothing else is contacted.
    PENSMITH_TEST_CASSETTES: undefined,
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
  });
  const dataDir = pensmithDataDir(process.platform, env);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, 'runtime.json'), JSON.stringify({
    $schemaVersion: 1,
    providers: { anthropic: { name: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY', baseUrl: `http://127.0.0.1:${port}` } },
  }));

  try {
    const r = await run(['write', '1'], root, env);
    assert.equal(requests, 1, `the draft was requested once: ${r.stderr}`);
    assert.equal(r.status, 1, `stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr, /output limit, so its answer is cut off; nothing was saved/);
    assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack trace');
    assert.ok(!existsSync(path.join(sec, 'DRAFT.md')), 'no DRAFT.md was written');
    assert.match(readFileSync(path.join(sec, 'PLAN.md'), 'utf8'), /status: writing/, 'the section is still to be written');
    const ledger = readFileSync(path.join(root, '.paper', 'COSTS.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0]!['outputTokens'], 64000, 'the cut-off answer\'s tokens are charged');
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
