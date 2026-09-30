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
//      answers serverInfo.name "pensmith";
//   6. (PLUG-02) the package ships the canonical plugin/ directory, the installed
//      resolver finds it, every prompt loads through its hash pin, and doctor's
//      workflow-wiring, build-artifact and MCP-bundle probes PASS from any folder.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packAndInstall, type InstalledPackage } from './helpers/installed-package.js';
import { UX02_VERBS } from '../bin/lib/verbs.js';
import { EXPECTED_PROMPT_HASHES } from '../bin/lib/prompt-loader.js';

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

// PLUG-02: the npm package ships the one canonical plugin/ directory, and the
// installed CLI reads its assets there — through the resolver in the installed
// dist/bin/lib/paths.js, with every prompt checked against its hash pin.
test('PLUG-02: the installed package ships plugin/ and none of the pre-move asset folders', () => {
  const { pkgDir } = installed!;
  for (const rel of [
    ['plugin', '.claude-plugin', 'plugin.json'],
    ['plugin', 'hooks', 'hooks.json'],
    ['plugin', 'skills', 'pensmith', 'SKILL.md'],
    ['plugin', 'templates', 'presets', 'disciplines.json'],
    ['plugin', 'templates', 'citation-styles', 'apa.csl'],
    ['plugin', 'references', 'honesty-framing.md'],
  ]) {
    assert.ok(fs.existsSync(path.join(pkgDir, ...rel)), `the package ships ${rel.join('/')}`);
  }
  const workflows = fs.readdirSync(path.join(pkgDir, 'plugin', 'workflows')).filter((f) => f.endsWith('.md'));
  assert.deepEqual(workflows.map((f) => f.replace(/\.md$/, '')).sort(), [...UX02_VERBS].sort());
  for (const gone of ['workflows', 'templates', 'references', 'skills', 'agents', '.claude-plugin', '.mcp.json']) {
    assert.ok(!fs.existsSync(path.join(pkgDir, gone)), `the package root no longer ships ${gone}`);
  }
  assert.ok(!fs.existsSync(path.join(pkgDir, 'plugin', 'bin')), 'the plugin in the package has no bin/');
});

test('PLUG-02: the installed CLI resolves plugin/ and loads every prompt through its hash pin', () => {
  const { pkgDir, scratch, runEnv } = installed!;
  const lib = path.join(pkgDir, 'dist', 'bin', 'lib');
  const script = [
    `const paths = await import(${JSON.stringify(pathToFileURL(path.join(lib, 'paths.js')).href)});`,
    `const loader = await import(${JSON.stringify(pathToFileURL(path.join(lib, 'prompt-loader.js')).href)});`,
    'const slugs = Object.keys(loader.EXPECTED_PROMPT_HASHES);',
    'for (const slug of slugs) if (loader.loadPrompt(slug).length === 0) throw new Error(`empty prompt ${slug}`);',
    'process.stdout.write(JSON.stringify({ root: paths.pluginRoot(), layout: paths.pluginLayout(), pkg: paths.cliPackageRoot(), loaded: slugs.length }));',
  ].join('\n');
  const cwd = fs.mkdtempSync(path.join(scratch, 'cwd-'));
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd, env: runEnv, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout) as { root: string; layout: string; pkg: string; loaded: number };
  assert.equal(fs.realpathSync(got.root), fs.realpathSync(path.join(pkgDir, 'plugin')));
  assert.equal(got.layout, 'package');
  assert.equal(fs.realpathSync(got.pkg), fs.realpathSync(pkgDir));
  assert.equal(got.loaded, Object.keys(EXPECTED_PROMPT_HASHES).length, 'every pinned prompt loaded');
});

test('PLUG-02: installed `pensmith doctor --json` finds the workflow bodies, the CLI build and the plugin bundle from any folder', () => {
  const cwd = fs.mkdtempSync(path.join(installed!.scratch, 'cwd-'));
  const r = runShim(['doctor', '--json'], cwd);
  const report = JSON.parse(r.stdout) as { probes: Record<string, { severity: string; summary: string; detail?: string }> };
  for (const id of ['intake-outline-verify-wiring', 'build-artifact-resolves', 'mcp-sdk-presence']) {
    const probe = report.probes[id];
    assert.ok(probe, `doctor reports ${id}`);
    assert.equal(probe.severity, 'PASS', `${id}: ${probe.summary} ${probe.detail ?? ''}`);
  }
  assert.match(report.probes['mcp-sdk-presence']!.summary, /plugin\/dist\/mcp\/server\.mjs present/);
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
