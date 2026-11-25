// tests/offline-cli.test.ts — `--offline` / `--dry-run` through the real CLI.
//
// The child runs with cassettes switched off and every proxy variable pointed at
// a counting TCP listener on 127.0.0.1. If any code path issued a request through
// bin/lib/http.ts the listener would see a connection, so "zero connections"
// means zero egress. A fake API key is present so the LLM passes would try to
// call out if offline mode did not stop them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedCliEnv } from './lib/cli-env.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

interface Listener { url: string; connections: () => number; close: () => Promise<void> }

async function startCountingListener(): Promise<Listener> {
  let count = 0;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    count++;
    sockets.add(sock);
    sock.on('error', () => { /* ignore */ });
    sock.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    connections: () => count,
    close: () => new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
    }),
  };
}

interface RunResult { status: number | null; stdout: string; stderr: string }

// Async spawn (not spawnSync) so the in-process listener can accept connections
// while the child runs.
function runCli(args: string[], cwd: string, proxyUrl: string): Promise<RunResult> {
  const env = isolatedCliEnv({
    PENSMITH_TEST_CASSETTES: undefined,
    PENSMITH_OFFLINE: undefined,
    PENSMITH_NO_LLM: undefined,
    HTTP_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    https_proxy: proxyUrl,
    NO_PROXY: '',
    no_proxy: '',
    ANTHROPIC_API_KEY: 'sk-ant-fake-offline-test',
    GPTZERO_API_KEY: 'fake-gptzero-offline-test',
  }, 'pensmith-offline-home-');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, ...args], { cwd, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function makePaper(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-offline-cli-'));
  writeFileSync(
    join(root, 'STATE.json'),
    JSON.stringify({ $schemaVersion: 2, paperId: 'offline-cli', createdAt: new Date().toISOString(), sections: [{ n: 1, slug: 'intro' }] }),
  );
  const sec = join(root, '.paper', 'sections', '01-intro');
  mkdirSync(sec, { recursive: true });
  writeFileSync(join(sec, 'PLAN.md'), '---\nsection: 1\nslug: intro\ntitle: Intro\nstatus: written\nassigned_sources: [engel2007]\n---\n# Intro\n');
  writeFileSync(join(sec, 'DRAFT.md'), 'Coherence persists in photosynthetic complexes [@engel2007].\n');
  writeFileSync(
    join(root, '.paper', 'CITATIONS.bib'),
    '@article{engel2007,\n  title = {Evidence for wavelike energy transfer through quantum coherence in photosynthetic systems},\n' +
      '  author = {Engel, Gregory S.},\n  doi = {10.1038/nature05678},\n  year = {2007}\n}\n',
  );
  writeFileSync(join(root, '.paper', 'INTAKE.md'), '# Intake\n\nTopic: quantum coherence in photosynthesis\n');
  return root;
}

test('offline CLI: `verify --offline` makes zero requests and records UNRESOLVED, not OK or FABRICATED', async () => {
  const listener = await startCountingListener();
  try {
    const root = makePaper();
    await runCli(['verify', '1', '--slug', 'intro', '--offline'], root, listener.url);
    const verif = readFileSync(join(root, '.paper', 'sections', '01-intro', 'VERIFICATION.md'), 'utf8');
    assert.match(verif, /engel2007: \*\*UNRESOLVED\*\*/, verif);
    assert.doesNotMatch(verif, /engel2007: \*\*(OK|FABRICATED|MIS-CITED)\*\*/);
    assert.match(verif, /^Status: failed$/m, 'an unresolved citation must not verify the section');
    assert.equal(listener.connections(), 0, 'offline verify must not open a single connection');
  } finally {
    await listener.close();
  }
});

test('offline CLI: `research --offline` makes zero requests, says skipped (offline), and leaves the library alone', async () => {
  const listener = await startCountingListener();
  try {
    const root = makePaper();
    const libraryPath = join(root, '.paper', 'LIBRARY.json');
    writeFileSync(libraryPath, JSON.stringify({ $schemaVersion: 1, entries: [{ id: 'keep-me' }] }));
    const res = await runCli(['research', '--offline', '--yolo'], root, listener.url);
    assert.match(res.stdout + res.stderr, /skipped \(offline\)/);
    assert.match(readFileSync(libraryPath, 'utf8'), /keep-me/, 'offline research must not overwrite LIBRARY.json');
    assert.equal(listener.connections(), 0);
  } finally {
    await listener.close();
  }
});

test('offline CLI: `--dry-run` research makes zero requests and runs nothing', async () => {
  const listener = await startCountingListener();
  try {
    const root = makePaper();
    const res = await runCli(['research', '--dry-run', '--yolo'], root, listener.url);
    // A dry run does not run research at all (it used to run it offline); it
    // only says what research would do.
    assert.match(res.stdout, /would run `pensmith research`/);
    assert.ok(!existsSync(join(root, '.paper', 'LIBRARY.json')), 'dry-run research must not write a library');
    assert.equal(listener.connections(), 0);
  } finally {
    await listener.close();
  }
});
