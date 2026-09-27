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
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLockfileRegistry, type LocalNpmRegistry } from './helpers/local-servers/npm-registry.js';
import { UX02_VERBS } from '../bin/lib/verbs.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const IS_WIN = process.platform === 'win32';
const PKG = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { name: string; version: string };

/** How to launch npm: its JS entry (npm_execpath under `npm test`), else the platform shim. */
function npmCommand(args: string[]): { cmd: string; args: string[]; shell: boolean } {
  const execPath = process.env['npm_execpath'];
  if (typeof execPath === 'string' && /npm-cli\.[cm]?js$/.test(execPath)) {
    return { cmd: process.execPath, args: [execPath, ...args], shell: false };
  }
  return IS_WIN
    ? { cmd: 'npm.cmd', args: args.map((a) => (/[\s&]/.test(a) ? `"${a}"` : a)), shell: true }
    : { cmd: 'npm', args, shell: false };
}

/** Run npm synchronously (only for commands that need no local server). */
function npm(args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }): SpawnSyncReturns<string> {
  const c = npmCommand(args);
  return spawnSync(c.cmd, c.args, { cwd: opts.cwd, env: opts.env ?? process.env, encoding: 'utf8', timeout: 600_000, shell: c.shell });
}

/**
 * Run npm ASYNCHRONOUSLY — required while the loopback registry (which lives
 * in this process) must keep answering; spawnSync would block its event loop.
 */
function npmAsync(args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const c = npmCommand(args);
  return new Promise((resolve) => {
    const child = spawn(c.cmd, c.args, { cwd: opts.cwd, env: opts.env, shell: c.shell, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => child.kill(), 600_000);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

interface Installed {
  scratch: string;
  prefix: string;
  pkgDir: string;
  shim: string;
  linkedRoot: string;
  runEnv: NodeJS.ProcessEnv;
}

let registry: LocalNpmRegistry | null = null;
let installed: Installed | null = null;

before(async () => {
  assert.ok(
    fs.existsSync(path.join(REPO, 'dist', 'bin', 'pensmith.js')) && fs.existsSync(path.join(REPO, 'dist', 'mcp', 'server.js')),
    'dist/ is missing — run `npm run build` first',
  );
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-installed-bin-'));
  const packDir = path.join(scratch, 'pack');
  const prefix = path.join(scratch, 'prefix');
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(prefix, { recursive: true });

  // 1. npm pack the built package.
  const pack = npm(['pack', '--silent', '--pack-destination', packDir], { cwd: REPO });
  assert.equal(pack.status, 0, `npm pack failed: ${pack.stderr}`);
  const tgz = fs.readdirSync(packDir).find((f) => f.endsWith('.tgz'));
  assert.ok(tgz, `npm pack produced a tarball in ${packDir}`);

  // 2. npm install -g from the loopback registry (never the internet).
  const cacheQuery = npm(['config', 'get', 'cache'], { cwd: REPO });
  assert.equal(cacheQuery.status, 0, `npm config get cache failed: ${cacheQuery.stderr}`);
  const npmCache = cacheQuery.stdout.trim();
  registry = await startLockfileRegistry({ lockfile: path.join(REPO, 'package-lock.json'), cacheDir: npmCache });
  const npmEnv: NodeJS.ProcessEnv = { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };
  for (const k of Object.keys(npmEnv)) {
    // npm exports its own config to scripts (npm_config_*); a user .npmrc may
    // point at a mirror or a proxy. The flags below are the whole config.
    if (/^npm_config_/i.test(k)) delete npmEnv[k];
  }
  const inst = await npmAsync(
    [
      'install', '-g',
      '--prefix', prefix,
      '--registry', registry.url,
      '--cache', path.join(scratch, 'npm-cache'),
      '--noproxy', '127.0.0.1,localhost',
      '--no-audit', '--no-fund', '--no-update-notifier', '--loglevel', 'error',
      path.join(packDir, tgz),
    ],
    { cwd: scratch, env: npmEnv },
  );
  assert.equal(
    inst.status,
    0,
    `npm install -g failed: ${inst.stderr}\n` +
      (registry.missing.length > 0
        ? `tarballs missing from the npm cache (${npmCache}) — run \`npm ci\` first: ${registry.missing.join(', ')}`
        : ''),
  );
  assert.deepEqual(registry.missing, [], 'every dependency tarball came from the npm cache');

  const pkgDir = IS_WIN ? path.join(prefix, 'node_modules', PKG.name) : path.join(prefix, 'lib', 'node_modules', PKG.name);
  const shim = IS_WIN ? path.join(prefix, `${PKG.name}.cmd`) : path.join(prefix, 'bin', PKG.name);
  assert.ok(fs.existsSync(path.join(pkgDir, 'dist', 'bin', 'pensmith.js')), `installed package at ${pkgDir}`);
  assert.ok(fs.existsSync(shim), `bin shim at ${shim}`);

  // A symlinked (POSIX) or junctioned (Windows) package root — `npm link` and
  // symlinked plugin roots look exactly like this.
  const linkedRoot = path.join(scratch, 'linked-root');
  fs.symlinkSync(pkgDir, linkedRoot, IS_WIN ? 'junction' : 'dir');

  const dataDir = path.join(scratch, 'data');
  const runEnv: NodeJS.ProcessEnv = { ...process.env, XDG_DATA_HOME: dataDir, LOCALAPPDATA: dataDir, PENSMITH_NO_LLM: '1' };
  installed = { scratch, prefix, pkgDir, shim, linkedRoot, runEnv };
});

after(async () => {
  await registry?.close();
  if (installed) fs.rmSync(installed.scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

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
    child.kill();
  }
});
