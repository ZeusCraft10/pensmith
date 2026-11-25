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

/** Root directories and files `npm run bundle` copies into the payload at the same path. */
export const ASSET_DIRS = ['templates', 'references'];
export const ASSET_FILES = ['LICENSE'];

/** Payload files that must be executable once installed, whatever the filesystem reports. */
const EXECUTABLES = ['bin/pensmith', 'dist/pensmith.mjs'];

// Claude Code installs the release branch with a plain `git clone`, which
// follows the user's git config. Without this file, core.autocrlf=true (the
// Windows default) would check out CRLF copies: prompt templates whose hashes
// no longer match their pins, and a bin/pensmith whose `#!/bin/sh\r` cannot
// run. The tree stores each file's exact bytes, CRLF .cmd shims included, so
// no file is converted.
const RELEASE_GITATTRIBUTES = [
  '# The release branch holds the built plugin byte for byte. Never convert',
  '# line endings on checkout.',
  '* -text',
  '',
].join('\n');

// Write the stored bytes out unchanged, with no line-ending conversion.
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
 * The payload's files, as paths relative to `pluginDir`: the plugin files git
 * tracks, the bundles, and the copy of every tracked root asset. Nothing else
 * under plugin/ ships, so a local file git ignores there (.env, a .paper/
 * workspace, an unredacted intake) can never reach the release branch, even
 * though a clean-checkout check cannot see it. Throws if one is missing.
 */
function payloadFiles(pluginDir) {
  const work = path.resolve(pluginDir);
  const prefix = `${path.basename(work)}/`;
  const tracked = git(['ls-files', '-z', '--', path.basename(work), ...ASSET_DIRS, ...ASSET_FILES], { cwd: path.dirname(work) })
    .split('\0')
    .filter(Boolean)
    .map((f) => (f.startsWith(prefix) ? f.slice(prefix.length) : f));
  const files = [...new Set([...tracked, ...BUILT_FILES])].sort();
  if (files.includes('.gitattributes')) {
    throw new Error('plugin/.gitattributes would be replaced by the release branch\'s own; remove it from plugin/');
  }
  const missing = files.filter((f) => !existsSync(path.join(work, f)));
  if (missing.length > 0) {
    throw new Error(`${missing.map((f) => `plugin/${f}`).join(', ')} missing from the payload: run \`npm run bundle\` first`);
  }
  return files;
}

/**
 * Write the payload (payloadFiles()) as a tree object in the repository at
 * `gitDir`, with the release branch's .gitattributes at its root, and return
 * the tree id.
 */
export function payloadTree(gitDir, pluginDir) {
  assertBuilt(pluginDir);
  const files = payloadFiles(pluginDir);
  const work = path.resolve(pluginDir);
  const base = [`--git-dir=${path.resolve(gitDir)}`];
  // --no-filters: store the bytes on disk, whatever any attributes or
  // line-ending settings on this machine would do to them.
  const ids = git([...base, 'hash-object', '-w', '--no-filters', '--stdin-paths'], { cwd: work, input: `${files.join('\n')}\n` }).split('\n');
  if (ids.length !== files.length) throw new Error(`git hash-object returned ${ids.length} ids for ${files.length} files`);
  const attributes = git([...base, 'hash-object', '-w', '--stdin'], { input: RELEASE_GITATTRIBUTES });
  // Modes are set here rather than read from disk, so the tree is the same on
  // every filesystem, including ones with no executable bit.
  const entries = files.map((f, i) => `${EXECUTABLES.includes(f) ? '100755' : '100644'} ${ids[i]}\t${f}`);
  entries.push(`100644 ${attributes}\t.gitattributes`);
  return withTempIndex((env) => {
    git([...base, 'update-index', '-z', '--index-info'], { env, input: `${entries.join('\0')}\0` });
    return git([...base, 'write-tree'], { env });
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
