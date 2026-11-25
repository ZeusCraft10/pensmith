// scripts/release-tree.mjs — the built plugin payload as a git tree.
//
// A release publishes the built plugin/ as the root of the `release` branch
// (scripts/release.mjs), and the plugin smoke installs exactly that tree
// (scripts/plugin-smoke.mjs). Both build it here, through a temporary index,
// so the repository's own index and working tree are never touched.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Payload files `npm run bundle` builds. They are gitignored, so they must be built first. */
export const BUILT_FILES = ['dist/pensmith.mjs', 'dist/hook.mjs'];

/** Payload files that must be executable once installed, whatever the filesystem reports. */
const EXECUTABLES = ['bin/pensmith', 'dist/pensmith.mjs'];

// Store the bytes exactly as they are on disk, with no line-ending conversion.
const RAW = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false'];

/** Run git; return its trimmed stdout, or throw with its stderr. */
export function git(args, opts = {}) {
  const res = spawnSync('git', args, { encoding: 'utf8', ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${(res.stderr || res.stdout).trim()}`);
  return res.stdout.trim();
}

/** Throw unless `pluginDir` holds the built bundles. */
export function assertBuilt(pluginDir) {
  const missing = BUILT_FILES.filter((f) => !existsSync(path.join(pluginDir, f)));
  if (missing.length > 0) {
    throw new Error(`${missing.map((f) => `plugin/${f}`).join(' and ')} not built: run \`npm run bundle\` first`);
  }
}

/** Call `fn` with an environment whose GIT_INDEX_FILE is a fresh, throwaway index. */
function withTempIndex(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pensmith-index-'));
  try {
    return fn({ ...process.env, GIT_INDEX_FILE: path.join(dir, 'index') });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Write every file under `pluginDir` as a tree object in the repository at
 * `gitDir` (an absolute git directory) and return the tree id.
 */
export function payloadTree(gitDir, pluginDir) {
  assertBuilt(pluginDir);
  const work = path.resolve(pluginDir);
  return withTempIndex((env) => {
    const base = [...RAW, `--git-dir=${path.resolve(gitDir)}`, `--work-tree=${work}`];
    // --force: in the source repository the built files are gitignored.
    git([...base, 'add', '--all', '--force', '--', '.'], { cwd: work, env });
    git([...base, 'update-index', '--chmod=+x', '--', ...EXECUTABLES], { cwd: work, env });
    return git([...base, 'write-tree'], { cwd: work, env });
  });
}

/** Write the files of `tree` (an object in `gitDir`) into the directory `dest`. */
export function checkoutTree(gitDir, tree, dest) {
  withTempIndex((env) => {
    const base = [...RAW, `--git-dir=${path.resolve(gitDir)}`, `--work-tree=${path.resolve(dest)}`];
    git([...base, 'read-tree', tree], { env });
    git([...base, 'checkout-index', '--all', '--force'], { env });
  });
}
