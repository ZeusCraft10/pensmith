#!/usr/bin/env node
// scripts/plugin-smoke.mjs — install the plugin the way a user does and check
// what Claude Code ends up with. Needs the Claude Code CLI (`claude`) on PATH.
//
//   1. `claude plugin validate plugin --strict` and `claude plugin validate . --strict`
//   2. in a throwaway CLAUDE_CONFIG_DIR/HOME: marketplace add <this checkout>,
//      install pensmith@pensmith, and read `claude plugin details`: it must
//      list exactly 1 skill, 1 hook and no MCP servers
//   3. run the installed `pensmith --version`, and on POSIX the checkout's
//      plugin/bin/pensmith through a symlink, the way a PATH entry reaches it
//
// Exits 1 on the first failed check.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
const isWindows = process.platform === 'win32';

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: 180_000,
    // `claude` is a .cmd shim on Windows; the arguments here are fixed strings.
    shell: isWindows && cmd === 'claude',
    ...opts,
  });
  return { status: res.status, out: `${res.stdout ?? ''}${res.stderr ?? ''}`, stdout: res.stdout ?? '', error: res.error };
}

function check(label, ok, detail = '') {
  if (!ok) {
    console.error(`FAIL ${label}${detail ? `\n${detail}` : ''}`);
    process.exit(1);
  }
  console.log(`ok   ${label}`);
}

// 1. Validation
for (const target of ['plugin', '.']) {
  const r = run('claude', ['plugin', 'validate', target, '--strict'], { cwd: repoRoot });
  check(`claude plugin validate ${target} --strict`, r.status === 0, r.out);
}

// 2. Isolated install
const sandbox = mkdtempSync(path.join(tmpdir(), 'pensmith-plugin-smoke-'));
const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(sandbox, 'config'), HOME: path.join(sandbox, 'home'), USERPROFILE: path.join(sandbox, 'home') };
mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
mkdirSync(env.HOME, { recursive: true });
try {
  const add = run('claude', ['plugin', 'marketplace', 'add', repoRoot], { cwd: sandbox, env });
  check('claude plugin marketplace add <checkout>', add.status === 0, add.out);
  const install = run('claude', ['plugin', 'install', 'pensmith@pensmith'], { cwd: sandbox, env });
  check('claude plugin install pensmith@pensmith', install.status === 0, install.out);
  const details = run('claude', ['plugin', 'details', 'pensmith@pensmith'], { cwd: sandbox, env });
  check('claude plugin details pensmith@pensmith', details.status === 0, details.out);
  check('installed version matches package.json', details.out.includes(`pensmith ${version}`), details.out);
  check('exactly 1 skill', /Skills \(1\)\s+pensmith/.test(details.out), details.out);
  check('exactly 1 hook (SessionStart)', /Hooks \(1\)\s+SessionStart/.test(details.out), details.out);
  check('no MCP servers', /MCP servers \(0\)/.test(details.out), details.out);

  const installed = JSON.parse(readFileSync(path.join(env.CLAUDE_CONFIG_DIR, 'plugins', 'installed_plugins.json'), 'utf8'));
  const installPath = installed.plugins['pensmith@pensmith'][0].installPath;
  const shim = path.join(installPath, 'bin', isWindows ? 'pensmith.cmd' : 'pensmith');
  const v = isWindows ? run('cmd.exe', ['/d', '/c', shim, '--version']) : run(shim, ['--version']);
  check('installed pensmith --version', v.status === 0 && v.stdout.trim() === version, v.out);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

// 3. The checkout's shim through a symlink (POSIX; Windows uses pensmith.cmd above)
if (!isWindows) {
  const linkDir = mkdtempSync(path.join(tmpdir(), 'pensmith-link-'));
  const link = path.join(linkDir, 'pensmith');
  symlinkSync(path.join(repoRoot, 'plugin', 'bin', 'pensmith'), link);
  const v = run(link, ['--version'], { cwd: linkDir });
  check('plugin/bin/pensmith --version through a symlink', v.status === 0 && v.stdout.trim() === version, v.out);
  rmSync(linkDir, { recursive: true, force: true });
}

console.log('plugin smoke passed');
