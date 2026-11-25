#!/usr/bin/env node
// scripts/release.mjs — check a release tag and publish the release branch.
//
//   node scripts/release.mjs check <tag>
//       exit 1 unless <tag> is v<version> and package.json and
//       plugin/.claude-plugin/plugin.json both carry that version
//   node scripts/release.mjs publish <tag> [--remote origin] [--branch release]
//       commit the built plugin/ payload as the whole tree of <branch>, on top
//       of the previous release commit, and push it (never forced)
//
// The marketplace entry installs the plugin from the release branch, so that
// branch holds the built payload and nothing else, one commit per release.
// .github/workflows/release.yml runs this from the tagged checkout after
// `npm run check` (which builds the bundle) and the plugin smoke.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assertBuilt, git, payloadTree } from './release-tree.mjs';

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

/** Problems that make `tag` the wrong tag for the versions in `root`; empty when it is right. */
function tagProblems(tag, root) {
  const read = (rel) => JSON.parse(readFileSync(path.join(root, rel), 'utf8')).version;
  const pkg = read('package.json');
  const plugin = read(path.join('plugin', '.claude-plugin', 'plugin.json'));
  const problems = [];
  if (plugin !== pkg) problems.push(`plugin/.claude-plugin/plugin.json has version ${plugin} but package.json has ${pkg}`);
  if (tag !== `v${pkg}`) problems.push(`tag ${tag} does not match package.json version ${pkg} (expected v${pkg})`);
  return problems;
}

function parseArgs(argv) {
  const [command, tag, ...rest] = argv;
  const opts = { remote: 'origin', branch: 'release' };
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.replace(/^--/, '');
    if (!(key in opts) || rest[i + 1] === undefined) fail(`unknown or incomplete option ${rest[i]}`);
    opts[key] = rest[i + 1];
  }
  if (!['check', 'publish'].includes(command) || !tag) {
    fail('usage: release.mjs check <tag> | publish <tag> [--remote <name>] [--branch <name>]');
  }
  return { command, tag, ...opts };
}

function publish({ root, tag, remote, branch }) {
  const pluginDir = path.join(root, 'plugin');
  try {
    assertBuilt(pluginDir);
  } catch (err) {
    fail(err.message);
  }
  // The payload is built from the working tree, so it must be the tagged
  // source, unmodified, for the release to be what the tag says.
  const head = git(['rev-parse', 'HEAD'], { cwd: root });
  let tagged;
  try {
    tagged = git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], { cwd: root });
  } catch {
    fail(`there is no tag ${tag} in this checkout`);
  }
  if (tagged !== head) fail(`HEAD is not the commit tag ${tag} points at; check out ${tag} first`);
  const dirty = git(['status', '--porcelain', '--untracked-files=all'], { cwd: root });
  if (dirty) fail(`the checkout has uncommitted changes, so the bundle would not match ${tag}:\n${dirty}`);

  const gitDir = git(['rev-parse', '--absolute-git-dir'], { cwd: root });
  const tree = payloadTree(gitDir, pluginDir);

  // The previous release, if there is one, is the parent. In CI's shallow
  // checkout fetch only its tip; a full clone fetches normally.
  let parent = null;
  if (git(['ls-remote', '--heads', remote, `refs/heads/${branch}`], { cwd: root })) {
    const shallow = git(['rev-parse', '--is-shallow-repository'], { cwd: root }) === 'true';
    git(['fetch', '--quiet', ...(shallow ? ['--depth=1'] : []), remote, `refs/heads/${branch}`], { cwd: root });
    parent = git(['rev-parse', 'FETCH_HEAD'], { cwd: root });
    if (git(['rev-parse', `${parent}^{tree}`], { cwd: root }) === tree) {
      console.log(`${remote}/${branch} already holds the ${tag} payload (${parent}); nothing to publish`);
      return;
    }
  }

  const commit = git(
    ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `release ${tag}`, '-m', `Built from ${head}.`],
    { cwd: root },
  );
  // A plain push: it is refused unless it fast-forwards the release branch.
  git(['push', '--quiet', remote, `${commit}:refs/heads/${branch}`], { cwd: root });
  console.log(`published ${tag} to ${remote}/${branch} as ${commit}`);
}

const args = parseArgs(process.argv.slice(2));
const root = git(['rev-parse', '--show-toplevel']);
const problems = tagProblems(args.tag, root);
if (problems.length > 0) fail(problems.join('\n'));
if (args.command === 'check') {
  console.log(`${args.tag} matches package.json and plugin/.claude-plugin/plugin.json`);
} else {
  try {
    publish({ root, ...args });
  } catch (err) {
    fail(err.message);
  }
}
