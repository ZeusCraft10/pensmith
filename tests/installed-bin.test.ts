// tests/installed-bin.test.ts — RUN-10 / D-17-41: the installed and symlinked
// entry points actually run (QR-9, T1-12).
//
// Before RUN-10 the CLI and the MCP server guarded their entry with
// `import.meta.url === pathToFileURL(process.argv[1]).href`. `npm i -g`,
// `npm link` and node_modules/.bin run the bin through a SYMLINK, while Node
// resolves the entry module to its real path — so the guard was false and
// `pensmith --version`, `--help` and `doctor` printed nothing and exited 0.
// bin/lib/main-guard.ts isMainModule() compares realpaths instead.
//
// This test exercises the real user path:
//   1. `npm pack` the built package (run `npm run build` first);
//   2. `npm install -g --prefix <tmp>` it — dependencies come from a LOOPBACK
//      registry built from package-lock.json + the local npm cache
//      (tests/helpers/local-servers/npm-registry.ts), so the run is hermetic:
//      no internet, and no dependency on registry metadata being cached;
//   3. run the installed shim (<prefix>/bin/pensmith, a symlink on POSIX;
//      <prefix>/pensmith.cmd on Windows): --version, --help (16 verbs), doctor;
//   4. `node <symlink | Windows junction to the package root>/dist/bin/pensmith.js
//      --version`;
//   5. a JSON-RPC `initialize` over stdio to `node <linked root>/dist/mcp/server.js`
//      answers serverInfo.name "pensmith".

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packAndInstall, type InstalledPackage } from './helpers/installed-package.js';
import { UX02_VERBS } from '../bin/lib/verbs.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const IS_WIN = process.platform === 'win32';
const PKG = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { name: string; version: string };

interface Installed {
  scratch: string;
  prefix: string;
  pkgDir: string;
  shim: string;
  linkedRoot: string;
  runEnv: NodeJS.ProcessEnv;
}

let pkg: InstalledPackage | null = null;
let installed: Installed | null = null;

before(async () => {
  // 1-2. npm pack + npm install -g from the loopback registry (never the internet).
  pkg = await packAndInstall('installed-bin');
  const { scratch, prefix, pkgDir, shim } = pkg;

  // A symlinked (POSIX) or junctioned (Windows) package root — `npm link` and
  // symlinked plugin roots look exactly like this.
  const linkedRoot = path.join(scratch, 'linked-root');
  fs.symlinkSync(pkgDir, linkedRoot, IS_WIN ? 'junction' : 'dir');

  const dataDir = path.join(scratch, 'data');
  const runEnv: NodeJS.ProcessEnv = { ...process.env, XDG_DATA_HOME: dataDir, LOCALAPPDATA: dataDir, PENSMITH_NO_LLM: '1' };
  installed = { scratch, prefix, pkgDir, shim, linkedRoot, runEnv };
});

after(async () => {
  await pkg?.close();
});

/**
 * Stop a spawned child and wait until it has EXITED, not merely been signalled.
 * On Windows a running process keeps its cwd busy, so after() removing the
 * scratch dir while a just-killed MCP server was still shutting down failed
 * with EBUSY (rmdir <scratch>\mcp-XXXX).
 */
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.stdin?.end();
  child.kill();
  const hard = setTimeout(() => child.kill('SIGKILL'), 10_000);
  try {
    await exited;
  } finally {
    clearTimeout(hard);
  }
}

function runShim(args: string[], cwd: string): SpawnSyncReturns<string> {
  const { shim, runEnv } = installed!;
  const opts = { cwd, env: runEnv, encoding: 'utf8' as const, timeout: 120_000 };
  // Windows .cmd shims need a shell (Node refuses to spawn .cmd/.bat without one).
  return IS_WIN ? spawnSync(`"${shim}"`, args, { ...opts, shell: true }) : spawnSync(shim, args, opts);
}

test('RUN-10: npm -g installed the platform bin shim (a symlink on POSIX — the case the old guard broke)', () => {
  if (IS_WIN) {
    assert.match(fs.readFileSync(installed!.shim, 'utf8'), /dist[\\/]bin[\\/]pensmith\.js/, 'the .cmd shim runs dist/bin/pensmith.js');
  } else {
    assert.ok(fs.lstatSync(installed!.shim).isSymbolicLink(), `${installed!.shim} must be a symlink`);
    assert.equal(fs.realpathSync(installed!.shim), fs.realpathSync(path.join(installed!.pkgDir, 'dist', 'bin', 'pensmith.js')));
  }
});

test('RUN-10: installed `pensmith --version` prints the package version', () => {
  const cwd = fs.mkdtempSync(path.join(installed!.scratch, 'cwd-'));
  const r = runShim(['--version'], cwd);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), PKG.version);
});

test('RUN-10: installed `pensmith --help` lists all 16 verbs', () => {
  const cwd = fs.mkdtempSync(path.join(installed!.scratch, 'cwd-'));
  const r = runShim(['--help'], cwd);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(UX02_VERBS.length, 16);
  for (const verb of UX02_VERBS) {
    assert.match(r.stdout, new RegExp(`\\b${verb}\\b`), `--help must list '${verb}'`);
  }
});

test('RUN-10: installed `pensmith doctor` prints the probe table', () => {
  const cwd = fs.mkdtempSync(path.join(installed!.scratch, 'cwd-'));
  const r = runShim(['doctor'], cwd);
  assert.ok(r.status === 0 || r.status === 1, `doctor exits 0 (all PASS/WARN) or 1 (a FAIL), got ${r.status}: ${r.stderr}`);
  assert.match(r.stdout, /pensmith doctor/i);
  for (const id of ['node-version', 'mcp-sdk-presence', 'build-artifact-resolves', 'pandoc-presence']) {
    assert.match(r.stdout, new RegExp(id), `the probe table lists ${id}`);
  }
  assert.match(r.stdout, /\[PASS\] node-version/, 'the supported Node passes the node-version probe');
});

test('RUN-10: `node <symlink/junction to the package root>/dist/bin/pensmith.js --version` works', () => {
  const entry = path.join(installed!.linkedRoot, 'dist', 'bin', 'pensmith.js');
  assert.notEqual(fs.realpathSync(entry), entry, 'the entry path goes through a link');
  const cwd = fs.mkdtempSync(path.join(installed!.scratch, 'cwd-'));
  const r = spawnSync(process.execPath, [entry, '--version'], { cwd, env: installed!.runEnv, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), PKG.version);
});

test('RUN-10: the MCP server started through the linked root answers initialize (serverInfo.name "pensmith")', async () => {
  const entry = path.join(installed!.linkedRoot, 'dist', 'mcp', 'server.js');
  const cwd = fs.mkdtempSync(path.join(installed!.scratch, 'mcp-'));
  const child = spawn(process.execPath, [entry], { cwd, env: installed!.runEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c: Buffer) => {
    stdout += c.toString();
  });
  child.stderr.on('data', (c: Buffer) => {
    stderr += c.toString();
  });
  try {
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'installed-bin-test', version: '0.0.0' } },
      }) + '\n',
    );
    const line = await new Promise<string>((resolve, reject) => {
      const t0 = Date.now();
      const tick = setInterval(() => {
        const nl = stdout.indexOf('\n');
        if (nl !== -1) {
          clearInterval(tick);
          resolve(stdout.slice(0, nl));
        } else if (child.exitCode !== null || Date.now() - t0 > 30_000) {
          clearInterval(tick);
          reject(new Error(`no initialize response (exit=${child.exitCode}); stderr=${stderr}`));
        }
      }, 25);
    });
    const msg = JSON.parse(line) as { id?: number; result?: { serverInfo?: { name?: string; version?: string } } };
    assert.equal(msg.id, 1);
    assert.equal(msg.result?.serverInfo?.name, 'pensmith');
    assert.equal(msg.result?.serverInfo?.version, PKG.version);
  } finally {
    await stopChild(child);
  }
});
