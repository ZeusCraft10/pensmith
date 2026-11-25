#!/usr/bin/env node
// scripts/plugin-smoke.mjs — install the plugin the way a user does and check
// what Claude Code ends up with. Needs the Claude Code CLI (`claude`) on PATH
// and the built bundle (`npm run bundle`).
//
//   1. `claude plugin validate plugin --strict` and `claude plugin validate . --strict`
//   2. build the tree a release commits to the release branch (the same
//      payloadTree() scripts/release.mjs publishes), write it out, and
//      `claude plugin validate --strict` it, with no plugin-directory refusals
//   3. in a throwaway CLAUDE_CONFIG_DIR/HOME: marketplace add a throwaway local
//      marketplace whose one entry is "./plugin" (that tree), install
//      pensmith@pensmith, and read `claude plugin details`: it must list
//      exactly 1 skill, 1 hook and no MCP servers
//   4. run the installed `pensmith --version`, and on POSIX the checkout's
//      plugin/bin/pensmith through a symlink, the way a PATH entry reaches it
//   5. commit that tree as the `release` branch of a throwaway repository and
//      install it again through a git source, the way the real entry is
//      installed, with core.autocrlf=true (the Windows default): every file
//      must arrive byte for byte, and the installed `pensmith --version` run
//   6. `npm link` the checkout into a throwaway prefix and run the linked bin
//
// The real marketplace installs the release branch from GitHub, which holds
// the last published release; the local marketplace makes the install test
// this build instead. Exits 1 on the first failed check.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertBuilt, checkoutTree, git, payloadTree } from './release-tree.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = path.join(repoRoot, 'plugin');
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

/** Files under `dir`, as posix paths relative to it. */
function filesUnder(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...filesUnder(dir, rel));
    else out.push(rel);
  }
  return out;
}

/** Run the installed plugin's shim (pensmith.cmd on Windows) with --version. */
function installedVersion(configDir) {
  const installed = JSON.parse(readFileSync(path.join(configDir, 'plugins', 'installed_plugins.json'), 'utf8'));
  const installPath = installed.plugins['pensmith@pensmith'][0].installPath;
  const shim = path.join(installPath, 'bin', isWindows ? 'pensmith.cmd' : 'pensmith');
  return { installPath, ...(isWindows ? run('cmd.exe', ['/d', '/c', shim, '--version']) : run(shim, ['--version'])) };
}

function check(label, ok, detail = '') {
  if (!ok) {
    console.error(`FAIL ${label}${detail ? `\n${detail}` : ''}`);
    process.exit(1);
  }
  console.log(`ok   ${label}`);
}

const unbuilt = (() => {
  try {
    assertBuilt(pluginDir);
    return '';
  } catch (err) {
    return err.message;
  }
})();
check('the plugin bundle is built', !unbuilt, unbuilt);

// 1. Validation
for (const target of ['plugin', '.']) {
  const r = run('claude', ['plugin', 'validate', target, '--strict'], { cwd: repoRoot });
  check(`claude plugin validate ${target} --strict`, r.status === 0, r.out);
}

const sandbox = mkdtempSync(path.join(tmpdir(), 'pensmith-plugin-smoke-'));
const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(sandbox, 'config'), HOME: path.join(sandbox, 'home'), USERPROFILE: path.join(sandbox, 'home') };
mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
mkdirSync(env.HOME, { recursive: true });
try {
  // 2. The release-shaped tree, built in a throwaway object store so this
  // checkout's .git is left alone.
  const objects = path.join(sandbox, 'objects.git');
  git(['init', '--quiet', '--bare', objects]);
  const tree = payloadTree(objects, pluginDir);
  const market = path.join(sandbox, 'marketplace');
  const releaseDir = path.join(market, 'plugin');
  mkdirSync(releaseDir, { recursive: true });
  checkoutTree(objects, tree, releaseDir);
  const validated = run('claude', ['plugin', 'validate', releaseDir, '--strict'], { cwd: sandbox, env });
  check('claude plugin validate <release tree> --strict', validated.status === 0, validated.out);
  // On the release branch this tree is the whole repository, so nothing
  // outside it (such as the root README) can satisfy the plugin directory.
  check('the plugin directory would not refuse the release tree', !/the plugin directory refuses/.test(validated.out), validated.out);

  // 3. Isolated install from a local marketplace: the real entry, pointed at that tree.
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, '.claude-plugin', 'marketplace.json'), 'utf8'));
  manifest.plugins = manifest.plugins.map((p) => ({ ...p, source: './plugin' }));
  mkdirSync(path.join(market, '.claude-plugin'));
  writeFileSync(path.join(market, '.claude-plugin', 'marketplace.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const add = run('claude', ['plugin', 'marketplace', 'add', market], { cwd: sandbox, env });
  check('claude plugin marketplace add <local marketplace of the release tree>', add.status === 0, add.out);
  const install = run('claude', ['plugin', 'install', 'pensmith@pensmith'], { cwd: sandbox, env });
  check('claude plugin install pensmith@pensmith', install.status === 0, install.out);
  const details = run('claude', ['plugin', 'details', 'pensmith@pensmith'], { cwd: sandbox, env });
  check('claude plugin details pensmith@pensmith', details.status === 0, details.out);
  check('installed version matches package.json', details.out.includes(`pensmith ${version}`), details.out);
  check('exactly 1 skill', /Skills \(1\)\s+pensmith/.test(details.out), details.out);
  check('exactly 1 hook (SessionStart)', /Hooks \(1\)\s+SessionStart/.test(details.out), details.out);
  check('no MCP servers', /MCP servers \(0\)/.test(details.out), details.out);

  const v = installedVersion(env.CLAUDE_CONFIG_DIR);
  check('installed pensmith --version', v.status === 0 && v.stdout.trim() === version, v.out);

  // 5. The same tree through a git source. Claude Code clones a git source
  // with the user's git config, as it does the real github entry, so set the
  // Windows default core.autocrlf=true in a throwaway global config.
  const commitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'pensmith smoke',
    GIT_AUTHOR_EMAIL: 'smoke@example.invalid',
    GIT_COMMITTER_NAME: 'pensmith smoke',
    GIT_COMMITTER_EMAIL: 'smoke@example.invalid',
  };
  const commit = git([`--git-dir=${objects}`, 'commit-tree', tree, '-m', 'release smoke'], { env: commitEnv });
  git([`--git-dir=${objects}`, 'update-ref', 'refs/heads/release', commit]);
  const gitHome = path.join(sandbox, 'git-home');
  mkdirSync(gitHome);
  writeFileSync(path.join(gitHome, '.gitconfig'), '[core]\n\tautocrlf = true\n');
  const gitEnv = {
    ...env,
    CLAUDE_CONFIG_DIR: path.join(sandbox, 'git-config'),
    HOME: gitHome,
    USERPROFILE: gitHome,
    GIT_CONFIG_GLOBAL: path.join(gitHome, '.gitconfig'),
  };
  mkdirSync(gitEnv.CLAUDE_CONFIG_DIR);
  const gitMarket = path.join(sandbox, 'git-marketplace');
  mkdirSync(path.join(gitMarket, '.claude-plugin'), { recursive: true });
  const gitManifest = { ...manifest, plugins: manifest.plugins.map((p) => ({ ...p, source: { source: 'url', url: pathToFileURL(objects).href, ref: 'release' } })) };
  writeFileSync(path.join(gitMarket, '.claude-plugin', 'marketplace.json'), `${JSON.stringify(gitManifest, null, 2)}\n`);
  const gitAdd = run('claude', ['plugin', 'marketplace', 'add', gitMarket], { cwd: sandbox, env: gitEnv });
  check('claude plugin marketplace add <local marketplace with a git source>', gitAdd.status === 0, gitAdd.out);
  const gitInstall = run('claude', ['plugin', 'install', 'pensmith@pensmith'], { cwd: sandbox, env: gitEnv });
  check('claude plugin install pensmith@pensmith from the git source (core.autocrlf=true)', gitInstall.status === 0, gitInstall.out);
  const cloned = installedVersion(gitEnv.CLAUDE_CONFIG_DIR);
  const changed = filesUnder(releaseDir).filter((f) => {
    try {
      return !readFileSync(path.join(cloned.installPath, f)).equals(readFileSync(path.join(releaseDir, f)));
    } catch {
      return true;
    }
  });
  check('the git-installed plugin has every file byte for byte', changed.length === 0, `changed or missing: ${changed.join(', ')}`);
  check('git-installed pensmith --version', cloned.status === 0 && cloned.stdout.trim() === version, cloned.out);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

// 4. The checkout's shim through a symlink (POSIX; Windows uses pensmith.cmd above)
if (!isWindows) {
  const linkDir = mkdtempSync(path.join(tmpdir(), 'pensmith-link-'));
  const link = path.join(linkDir, 'pensmith');
  symlinkSync(path.join(repoRoot, 'plugin', 'bin', 'pensmith'), link);
  const v = run(link, ['--version'], { cwd: linkDir });
  check('plugin/bin/pensmith --version through a symlink', v.status === 0 && v.stdout.trim() === version, v.out);
  rmSync(linkDir, { recursive: true, force: true });
}

// 6. `npm link` from the checkout into a throwaway prefix, then run the linked bin.
{
  const prefix = mkdtempSync(path.join(tmpdir(), 'pensmith-npm-prefix-'));
  const npmEnv = { ...process.env, npm_config_prefix: prefix };
  const link = run('npm', ['link', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: repoRoot, env: npmEnv, shell: isWindows });
  check('npm link into a temporary prefix', link.status === 0, link.out);
  const bin = isWindows ? path.join(prefix, 'pensmith.cmd') : path.join(prefix, 'bin', 'pensmith');
  const v = isWindows ? run('cmd.exe', ['/d', '/c', bin, '--version']) : run(bin, ['--version']);
  check('pensmith --version through the npm link', v.status === 0 && v.stdout.trim() === version, v.out);
  rmSync(prefix, { recursive: true, force: true });
}

console.log('plugin smoke passed');
