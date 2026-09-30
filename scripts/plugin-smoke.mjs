#!/usr/bin/env node
// scripts/plugin-smoke.mjs — CI-05: validate, install and launch the REAL
// plugin with Claude Code (D-23a-17). `npm run plugin:smoke`; the CI `plugin`
// job runs it on Ubuntu, macOS and Windows. No API key is needed.
//
//   1. `claude plugin validate --strict` on plugin/, on
//      plugin/.claude-plugin/plugin.json and on the repo root (the
//      marketplace): each exits 0.
//   2. Negative control: the same on tests/fixtures/plugin-legacy (the old
//      `skills: [{name,file}]` manifest, the homemade hooks.json and a flat
//      skill) must fail, naming the skills array.
//   3. A fresh `git clone --local` of the repository (no npm ci, no build) is
//      added as a marketplace in an isolated CLAUDE_CONFIG_DIR / HOME; then
//      `claude plugin install pensmith@pensmith`, `plugin list --json`
//      (enabled, no errors) and `plugin details pensmith` (the 8 skills, the
//      4 hooks, 1 MCP server).
//   4. `claude mcp list` in a fresh project folder shows the plugin's server
//      connected.
//   5. The MCP server command plugin.json declares, launched from the
//      installed plugin cache with CLAUDE_PLUGIN_ROOT set, answers
//      `initialize` and `tools/list` with the expected tools (pensmith_status
//      among them).
//   6. With every PATH directory that holds a `node` executable removed, `claude
//      mcp list` (the real claude executable, by absolute path) reports the
//      server as not connected — the case the pensmith skill's "install Node.js
//      ≥ 22" guidance covers.
//   7. Updates reach a git-marketplace install (review round 2): the clone is
//      served as a bare repository over smart HTTP on 127.0.0.1 (`git
//      http-backend`, the transport Claude Code clones a git-hosted marketplace
//      with), on a named branch its HEAD points at whatever the checkout's
//      HEAD is (a pull request's checkout is detached and shallow; review
//      round 3), and installed from that URL in a second isolated config — a
//      COPIED install under the plugin cache, versioned by plugin.json's
//      content-stamped version. A commit then changes a file under plugin/ and
//      re-stamps the version (`scripts/plugin-version.cjs --write`, as
//      `npm run plugin:version` does); after `claude plugin marketplace
//      update` + `claude plugin update`, the installed copy must hold the
//      change under the new version. (Step 3's local-directory marketplace
//      loads the plugin in place, so it never exercises versioning.)
//
// Claude Code: CLAUDE_BIN, else `claude` on PATH. Options:
//   --repo <dir>          the repository to clone (default: this checkout) — a
//                         scratch plugin assembly can be checked before a merge
//   --negative <dir>      the negative-control plugin (default: <this checkout>/
//                         tests/fixtures/plugin-legacy)
//   --expect-tool <name>  a tool the installed server must list (repeatable;
//                         default: pensmith_plan, pensmith_status,
//                         pensmith_verify, pensmith_write)
//   --keep                keep the temp folder (it is always kept on failure)
// It prints one line per check and exits 1 at the first failure, with the
// command's output. The clone takes the COMMITTED tree: uncommitted changes
// under plugin/ or .claude-plugin/ are reported and not tested.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_HOOK_EVENTS,
  bareRepoOnBranch,
  gitSync,
  startGitHttpBackend,
  EXPECTED_SKILLS,
  EXPECTED_TOOLS,
  PLUGIN_SERVER,
  expandPluginRoot,
  findOnPath,
  installPathOf,
  mcpHandshake,
  parseMcpList,
  parsePluginDetails,
  pathKey,
  pathWithoutNode,
  pluginListProblems,
  resolveClaude,
  runClaude,
} from './plugin-smoke-lib.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The branch step 7 serves the clone's commit on (whatever the checkout's HEAD was: a branch or detached). */
const SMOKE_BRANCH = 'pensmith-plugin-smoke';

function parseArgs(argv) {
  const opts = { repo: REPO_ROOT, negative: path.join(REPO_ROOT, 'tests', 'fixtures', 'plugin-legacy'), tools: [], keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--repo') opts.repo = path.resolve(value());
    else if (a === '--negative') opts.negative = path.resolve(value());
    else if (a === '--expect-tool') opts.tools.push(value());
    else if (a === '--keep') opts.keep = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (opts.tools.length === 0) opts.tools = [...EXPECTED_TOOLS];
  return opts;
}

class CheckFailed extends Error {}

function ok(line) {
  process.stdout.write(`ok    ${line}\n`);
}

function fail(line, output = '') {
  throw new CheckFailed(`${line}${output ? `\n${output.trimEnd()}` : ''}`);
}

function shown(r) {
  return [r.stdout && `--- stdout\n${r.stdout}`, r.stderr && `--- stderr\n${r.stderr}`, r.error && `--- error\n${r.error.message}`]
    .filter(Boolean)
    .join('\n');
}

/** The isolated environment every claude call runs in: its own config and home, no credentials. */
function isolatedEnv(tmp) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_PLUGIN_ROOT|PENSMITH_PAPER_ROOT)$/i.test(k)) delete env[k];
  }
  const home = path.join(tmp, 'home');
  const data = path.join(tmp, 'data');
  mkdirSync(home, { recursive: true });
  mkdirSync(data, { recursive: true });
  env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude-config');
  // No self-update and no non-essential traffic from the Claude Code under test.
  env.DISABLE_AUTOUPDATER = '1';
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  env.HOME = home;
  env.USERPROFILE = home;
  // The pensmith server's own data dir (locks, cache) stays in the temp folder too.
  env.XDG_DATA_HOME = data;
  env.LOCALAPPDATA = data;
  return env;
}


/** plugin list --json's pensmith entry: {version, installPath}. */
function installedEntry(run) {
  const r = run(['plugin', 'list', '--json']);
  let listed;
  try {
    listed = JSON.parse(r.stdout);
  } catch {
    fail('claude plugin list --json did not print JSON', shown(r));
  }
  const problems = pluginListProblems(listed);
  if (r.status !== 0 || problems.length > 0) fail(`plugin list --json: ${problems.join('; ')}`, shown(r));
  const entry = (Array.isArray(listed) ? listed : listed.plugins ?? []).find((p) => p.id === 'pensmith@pensmith');
  return { version: entry?.version, installPath: installPathOf(listed) };
}

/** Step 7 (see the header): updates reach an install from a git-hosted marketplace. */
async function checkGitMarketplaceUpdate({ claude, clone, tmp }) {
  const hostRoot = path.join(tmp, 'git-host');
  mkdirSync(hostRoot, { recursive: true });
  const bare = path.join(hostRoot, 'pensmith.git');
  // On a named branch whatever the checkout's HEAD is — a pull-request
  // checkout is detached and shallow (bareRepoOnBranch, review round 3).
  bareRepoOnBranch(clone, bare, SMOKE_BRANCH);
  const probe = runClaude({ command: 'git', prefix: [], path: 'git' }, ['http-backend'], {
    cwd: hostRoot,
    env: { ...process.env, GIT_PROJECT_ROOT: hostRoot, REQUEST_METHOD: 'GET', PATH_INFO: '/pensmith.git/HEAD', GIT_HTTP_EXPORT_ALL: '1' },
  });
  if (probe.status !== 0 || !/^Status: 200|^Content-Type/im.test(probe.stdout)) fail('`git http-backend` is not available (it ships with git)', shown(probe));
  const host = await startGitHttpBackend({ projectRoot: hostRoot });
  try {
    const url = `${host.url}/pensmith.git`;
    const env = isolatedEnv(path.join(tmp, 'git-marketplace'));
    const project = path.join(tmp, 'git-marketplace', 'project');
    mkdirSync(project, { recursive: true });
    const run = (args) => runClaude(claude, args, { cwd: project, env });

    const manifestVersion = (dir) => JSON.parse(readFileSync(path.join(dir, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8')).version;
    const firstVersion = manifestVersion(clone);
    const add = run(['plugin', 'marketplace', 'add', url]);
    if (add.status !== 0) fail(`claude plugin marketplace add ${url}`, shown(add));
    const install = run(['plugin', 'install', 'pensmith@pensmith']);
    if (install.status !== 0) fail('claude plugin install pensmith@pensmith (git marketplace)', shown(install));
    const before = installedEntry(run);
    if (before.version !== firstVersion || before.installPath === null || !existsSync(before.installPath)) {
      fail(`git marketplace install: expected version ${firstVersion} in the plugin cache, got ${JSON.stringify(before)}`);
    }
    ok(`git marketplace (${url}): installed ${before.version} as a cached copy (${before.installPath})`);

    // A new commit: one file under plugin/ changes, and the version is re-stamped.
    const work = path.join(tmp, 'git-work');
    execFileSync('git', ['clone', '--quiet', '--branch', SMOKE_BRANCH, bare, work], { stdio: ['ignore', 'pipe', 'pipe'] });
    const marker = `plugin smoke update marker ${Date.now().toString(36)}`;
    const changed = path.join(work, 'plugin', 'workflows', 'status.md');
    appendFileSync(changed, `\n<!-- ${marker} -->\n`);
    execFileSync(process.execPath, [path.join(work, 'scripts', 'plugin-version.cjs'), '--write'], { cwd: work, stdio: ['ignore', 'pipe', 'pipe'] });
    const secondVersion = manifestVersion(work);
    if (secondVersion === firstVersion) fail(`re-stamping after a plugin/ change kept the version ${firstVersion}`);
    gitSync(['commit', '--quiet', '-am', 'plugin smoke: change a workflow body'], work);
    gitSync(['push', '--quiet', 'origin', `HEAD:refs/heads/${SMOKE_BRANCH}`], work);

    const mupdate = run(['plugin', 'marketplace', 'update', 'pensmith']);
    if (mupdate.status !== 0) fail('claude plugin marketplace update pensmith', shown(mupdate));
    const update = run(['plugin', 'update', 'pensmith@pensmith']);
    if (update.status !== 0) fail('claude plugin update pensmith@pensmith', shown(update));
    const after = installedEntry(run);
    const installedText = after.installPath === null ? '' : (() => {
      try {
        return readFileSync(path.join(after.installPath, 'workflows', 'status.md'), 'utf8');
      } catch {
        return '';
      }
    })();
    if (after.version !== secondVersion || !installedText.includes(marker)) {
      fail(
        `claude plugin update did not install the new commit: expected version ${secondVersion} with the changed workflows/status.md, ` +
          `got ${JSON.stringify(after)}${installedText.includes(marker) ? '' : ' (the change is missing)'}`,
        shown(update),
      );
    }
    ok(`git marketplace update: ${before.version} → ${after.version}; the installed copy holds the new commit`);
  } finally {
    await host.close();
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const claude = resolveClaude();
  const version = runClaude(claude, ['--version'], { cwd: REPO_ROOT, env: process.env });
  ok(`claude ${version.stdout.trim() || '(version unknown)'} at ${claude.path}`);

  // 1. validate --strict ×3.
  const targets = [
    path.join(opts.repo, 'plugin'),
    path.join(opts.repo, 'plugin', '.claude-plugin', 'plugin.json'),
    opts.repo,
  ];
  for (const t of targets) {
    const r = runClaude(claude, ['plugin', 'validate', '--strict', t], { cwd: opts.repo, env: process.env });
    if (r.status !== 0 || !/Validation passed/i.test(r.stdout)) fail(`claude plugin validate --strict ${t}`, shown(r));
    ok(`validate --strict ${path.relative(opts.repo, t) || '. (marketplace)'}`);
  }

  // 2. Negative control.
  if (!existsSync(opts.negative)) fail(`negative-control fixture missing: ${opts.negative}`);
  const neg = runClaude(claude, ['plugin', 'validate', '--strict', opts.negative], { cwd: opts.repo, env: process.env });
  if (neg.status === 0) fail(`negative control: claude plugin validate --strict ${opts.negative} passed; it must fail`, shown(neg));
  if (!/skills: Invalid input/.test(neg.stdout + neg.stderr)) fail('negative control failed for another reason than the skills array', shown(neg));
  ok(`negative control ${path.basename(opts.negative)} is refused (skills: Invalid input)`);

  // 3. Fresh clone → marketplace add → install → list → details.
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'pensmith-plugin-smoke-'));
  let passed = false;
  try {
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'plugin', '.claude-plugin'], { cwd: opts.repo, encoding: 'utf8' });
    if (dirty.trim() !== '') process.stdout.write(`note  uncommitted changes under plugin/ or .claude-plugin/ are not in the clone:\n${dirty}`);
    const clone = path.join(tmp, 'clone');
    execFileSync('git', ['clone', '--quiet', '--local', '--no-hardlinks', opts.repo, clone], { stdio: ['ignore', 'pipe', 'pipe'] });
    if (existsSync(path.join(clone, 'node_modules'))) fail('the fresh clone has a node_modules');
    if (!existsSync(path.join(clone, 'plugin', 'dist', 'mcp', 'server.mjs'))) fail('the fresh clone has no plugin/dist/mcp/server.mjs (commit the bundles)');
    ok(`fresh clone with no npm ci and no build: ${clone}`);

    const env = isolatedEnv(tmp);
    const project = path.join(tmp, 'project');
    mkdirSync(project, { recursive: true });
    const run = (args) => runClaude(claude, args, { cwd: project, env });

    // `./clone` from the temp folder: the relative form Claude Code documents
    // for a local marketplace on every OS (a drive-letter path is never parsed
    // as owner/repo).
    const add = runClaude(claude, ['plugin', 'marketplace', 'add', `./${path.basename(clone)}`], { cwd: tmp, env });
    if (add.status !== 0) fail(`claude plugin marketplace add ./clone (in ${tmp})`, shown(add));
    ok('plugin marketplace add <clone>');
    const install = run(['plugin', 'install', 'pensmith@pensmith']);
    if (install.status !== 0) fail('claude plugin install pensmith@pensmith', shown(install));
    ok('plugin install pensmith@pensmith');

    const list = run(['plugin', 'list', '--json']);
    let listed;
    try {
      listed = JSON.parse(list.stdout);
    } catch {
      fail('claude plugin list --json did not print JSON', shown(list));
    }
    const problems = pluginListProblems(listed);
    if (list.status !== 0 || problems.length > 0) fail(`plugin list --json: ${problems.join('; ')}`, shown(list));
    const installPath = installPathOf(listed);
    if (installPath === null || !existsSync(installPath)) fail('plugin list --json names no installPath on disk', shown(list));
    ok(`plugin list --json: pensmith@pensmith enabled, no errors (${installPath})`);

    const details = run(['plugin', 'details', 'pensmith']);
    const inv = parsePluginDetails(details.stdout);
    const skills = [...(inv.skills?.names ?? [])].sort();
    const hooks = [...(inv.hooks?.names ?? [])].sort();
    if (
      details.status !== 0
      || inv.skills?.count !== EXPECTED_SKILLS.length || JSON.stringify(skills) !== JSON.stringify([...EXPECTED_SKILLS])
      || inv.hooks?.count !== EXPECTED_HOOK_EVENTS.length || JSON.stringify(hooks) !== JSON.stringify([...EXPECTED_HOOK_EVENTS])
      || inv.mcpServers?.count !== 1 || inv.mcpServers.names[0] !== 'pensmith'
    ) {
      fail(`plugin details pensmith: expected skills ${EXPECTED_SKILLS.join(', ')}; hooks ${EXPECTED_HOOK_EVENTS.join(', ')}; 1 MCP server`, shown(details));
    }
    ok(`plugin details: ${inv.skills.count} skills (${skills.join(', ')}), ${inv.hooks.count} hooks, ${inv.mcpServers.count} MCP server`);

    // 4. mcp list: connected.
    const mcp = run(['mcp', 'list']);
    const row = parseMcpList(mcp.stdout).find((r) => r.name === PLUGIN_SERVER);
    if (mcp.status !== 0 || !row?.connected) fail(`claude mcp list: ${PLUGIN_SERVER} is not connected`, shown(mcp));
    ok(`mcp list: ${PLUGIN_SERVER} — ${row.statusText}`);

    // 5. The declared server command, from the installed cache.
    const declared = listed.find((p) => p.id === 'pensmith@pensmith')?.mcpServers?.pensmith;
    if (!declared || declared.command !== 'node' || !Array.isArray(declared.args)) {
      fail('plugin list --json does not declare the pensmith MCP server as `node …`', JSON.stringify(declared));
    }
    const node = findOnPath('node', env[pathKey(env)], process.platform, existsSync, env.PATHEXT) ?? process.execPath;
    const args = declared.args.map((a) => expandPluginRoot(a, installPath));
    let hs;
    try {
      hs = await mcpHandshake({ command: node, args, env: { ...env, CLAUDE_PLUGIN_ROOT: installPath }, cwd: project });
    } catch (e) {
      fail(`node ${args.join(' ')} (CLAUDE_PLUGIN_ROOT=${installPath}): ${e.message}`, e.stderr ?? '');
    }
    const missing = opts.tools.filter((t) => !hs.tools.includes(t));
    if (hs.serverInfo?.name !== 'pensmith' || missing.length > 0) {
      fail(`installed server: initialize=${JSON.stringify(hs.serverInfo)}; tools/list lacks ${missing.join(', ')}`, `tools: ${hs.tools.join(', ')}`);
    }
    ok(`installed cache server: initialize ${hs.serverInfo.name} ${hs.serverInfo.version}; tools/list ${hs.tools.length} tools incl. ${opts.tools.join(', ')}`);

    // 6. No node on PATH: not connected.
    const key = pathKey(env);
    const noNodePath = pathWithoutNode(env[key]);
    if (findOnPath('node', noNodePath, process.platform, existsSync, env.PATHEXT) !== null) fail('could not build a PATH without node');
    const noNode = runClaude(claude, ['mcp', 'list'], { cwd: project, env: { ...env, [key]: noNodePath } });
    const row2 = parseMcpList(noNode.stdout).find((r) => r.name === PLUGIN_SERVER);
    if (!row2 || row2.connected) fail(`claude mcp list with no node on PATH: ${PLUGIN_SERVER} must be listed and not connected`, shown(noNode));
    ok(`no node on PATH: ${PLUGIN_SERVER} — ${row2.statusText}`);

    // 7. A git-hosted marketplace: install, push a plugin/ change, update.
    await checkGitMarketplaceUpdate({ claude, clone, tmp });
    passed = true;
  } finally {
    if (passed && !opts.keep) rmSync(tmp, { recursive: true, force: true });
    else process.stdout.write(`note  temp folder kept: ${tmp}\n`);
  }
  process.stdout.write('plugin smoke: all checks passed\n');
}

main().catch((e) => {
  process.stderr.write(`FAIL  ${e instanceof CheckFailed ? e.message : e?.stack ?? String(e)}\n`);
  process.exit(1);
});
