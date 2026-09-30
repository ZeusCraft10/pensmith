// tests/helpers/installed-package.ts — pack the BUILT package and install it
// with `npm install -g --prefix <tmp>`, exactly as a user would (RUN-05,
// RUN-10). Shared by tests/installed-bin.test.ts and
// tests/installed-offline.test.ts.
//
// Dependencies come from a LOOPBACK registry built from package-lock.json +
// the local npm cache (./local-servers/npm-registry.ts), so the install is
// hermetic: no internet, and no dependency on registry METADATA being cached.
// (`npm install --offline` needs cached packuments, which `npm ci` never
// writes — it only caches tarballs — so an offline install fails on a fresh
// CI runner with ENOTCACHED.)
//
// npm runs ASYNCHRONOUSLY here: the registry lives in this process, and
// spawnSync would block its event loop while npm waits on it.

import assert from 'node:assert/strict';
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLockfileRegistry, type LocalNpmRegistry } from './local-servers/npm-registry.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const IS_WIN = process.platform === 'win32';

export interface InstalledPackage {
  /** Temp dir holding the tarball, the prefix and anything a test adds. */
  scratch: string;
  /** The `--prefix` the package was installed globally into. */
  prefix: string;
  /** The installed package root (<prefix>/lib/node_modules/<name>, or <prefix>/node_modules/<name> on Windows). */
  pkgDir: string;
  /** The npm bin shim (<prefix>/bin/<name> symlink on POSIX; <prefix>/<name>.cmd on Windows). */
  shim: string;
  /** Stop the loopback registry and remove `scratch`. */
  close(): Promise<void>;
}

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
export function npm(args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }): SpawnSyncReturns<string> {
  const c = npmCommand(args);
  return spawnSync(c.cmd, c.args, { cwd: opts.cwd, env: opts.env ?? process.env, encoding: 'utf8', timeout: 600_000, shell: c.shell });
}

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

/**
 * Remove a scratch dir, best-effort. Callers stop (and await) every process
 * they spawned first; what can remain on Windows is a handle that is released
 * a moment after its process exited (the process table, an antivirus scan).
 * fs.promises.rm retries the WHOLE removal on EBUSY / EPERM / ENOTEMPTY with a
 * linear backoff — the synchronous rmSync of Node 22 does not retry a busy
 * NESTED directory at all, whatever maxRetries says. A temp dir that still
 * cannot be removed is reported, never a suite failure.
 */
async function removeScratch(dir: string): Promise<void> {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (err) {
    process.stderr.write(`installed-package: could not remove the temp dir ${dir}: ${(err as Error).message}\n`);
  }
}

/** `npm pack` the built repo and `npm install -g` the tarball into a fresh temp prefix. */
export async function packAndInstall(label: string): Promise<InstalledPackage> {
  assert.ok(
    fs.existsSync(path.join(REPO, 'dist', 'bin', 'pensmith.js')) && fs.existsSync(path.join(REPO, 'dist', 'mcp', 'server.js')),
    'dist/ is missing — run `npm run build` first',
  );
  const pkgName = (JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { name: string }).name;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `pensmith-${label}-`));
  const packDir = path.join(scratch, 'pack');
  const prefix = path.join(scratch, 'prefix');
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(prefix, { recursive: true });

  const pack = npm(['pack', '--ignore-scripts', '--silent', '--pack-destination', packDir], { cwd: REPO });
  assert.equal(pack.status, 0, `npm pack failed: ${pack.stderr}`);
  const tgz = fs.readdirSync(packDir).find((f) => f.endsWith('.tgz'));
  assert.ok(tgz, `npm pack produced a tarball in ${packDir}`);

  const cacheQuery = npm(['config', 'get', 'cache'], { cwd: REPO });
  assert.equal(cacheQuery.status, 0, `npm config get cache failed: ${cacheQuery.stderr}`);
  const npmCache = cacheQuery.stdout.trim();
  const registry: LocalNpmRegistry = await startLockfileRegistry({ lockfile: path.join(REPO, 'package-lock.json'), cacheDir: npmCache });
  const close = async (): Promise<void> => {
    await registry.close();
    await removeScratch(scratch);
  };

  try {
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
        '--ignore-scripts', '--no-audit', '--no-fund', '--no-update-notifier', '--loglevel', 'error',
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

    const pkgDir = IS_WIN ? path.join(prefix, 'node_modules', pkgName) : path.join(prefix, 'lib', 'node_modules', pkgName);
    const shim = IS_WIN ? path.join(prefix, `${pkgName}.cmd`) : path.join(prefix, 'bin', pkgName);
    assert.ok(fs.existsSync(path.join(pkgDir, 'dist', 'bin', 'pensmith.js')), `installed package at ${pkgDir}`);
    assert.ok(fs.existsSync(shim), `bin shim at ${shim}`);
    return { scratch, prefix, pkgDir, shim, close };
  } catch (err) {
    await close();
    throw err;
  }
}
