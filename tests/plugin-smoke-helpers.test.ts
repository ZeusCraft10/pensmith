// tests/plugin-smoke-helpers.test.ts — the pure helpers of the CI-05 plugin
// smoke (scripts/plugin-smoke-lib.mjs, D-23a-17): the PATH-without-node filter
// on win32 and posix, PATH lookup, the Windows npm shim target, and the
// parsers for `claude plugin details`, `claude mcp list` and `claude plugin
// list --json` (fed the output Claude Code 2.1.285 prints), and the CGI
// plumbing of the loopback git host that step 7 installs a git-marketplace
// copy from (review round 2), and that host's repository preparation over the
// detached, shallow checkout a pull request gets (review round 3). The smoke itself
// runs the real Claude Code (`npm run plugin:smoke`, the CI `plugin` job).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FENCE_OPEN, fenceUntrusted } from '../bin/lib/untrusted-fence.js';
import {
  bareRepoOnBranch,
  cmdShimTarget,
  executableNames,
  expandPluginRoot,
  fencedText,
  findOnPath,
  gitCgiEnv,
  gitSync,
  installPathOf,
  parseCgiHead,
  parseMcpList,
  parsePluginDetails,
  pathKey,
  pathWithoutNode,
  pluginListProblems,
  sectionStepOf,
  statusSummary,
} from '../scripts/plugin-smoke-lib.mjs';

/** A fake file system: `exists(file)` is true for exactly these paths. */
function fs(files: string[]): (file: string) => boolean {
  const set = new Set(files);
  return (f) => set.has(f);
}

test('CI-05: pathWithoutNode drops every posix PATH directory holding node, keeping the order of the rest', () => {
  const exists = fs(['/opt/node22/bin/node', '/usr/local/bin/node', '/usr/bin/git']);
  assert.equal(
    pathWithoutNode('/root/.local/bin:/opt/node22/bin:/usr/local/bin:/usr/bin::/bin', 'linux', exists),
    '/root/.local/bin:/usr/bin:/bin',
  );
  assert.equal(pathWithoutNode(undefined, 'linux', exists), '');
  assert.equal(findOnPath('node', '/root/.local/bin:/usr/bin:/bin', 'linux', exists), null);
  assert.equal(findOnPath('node', '/usr/bin:/opt/node22/bin', 'linux', exists), '/opt/node22/bin/node');
});

test('CI-05: pathWithoutNode on win32 splits on ; and matches node.exe (and shims) case-insensitively by name', () => {
  const exists = fs(['C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\u\\AppData\\Roaming\\npm\\node.cmd', 'C:\\Windows\\System32\\cmd.exe']);
  assert.equal(
    pathWithoutNode('C:\\Windows\\System32;C:\\Program Files\\nodejs;C:\\Users\\u\\AppData\\Roaming\\npm;;C:\\Tools', 'win32', exists),
    'C:\\Windows\\System32;C:\\Tools',
  );
  assert.deepEqual(executableNames('node', 'win32'), ['node.com', 'node.exe', 'node.bat', 'node.cmd']);
  assert.deepEqual(executableNames('claude.exe', 'win32'), ['claude.exe']);
  assert.deepEqual(executableNames('node', 'darwin'), ['node']);
  assert.equal(findOnPath('node', 'C:\\Windows\\System32;C:\\Program Files\\nodejs', 'win32', exists), 'C:\\Program Files\\nodejs\\node.exe');
  assert.equal(pathKey({ Path: 'x', HOME: 'y' }, 'win32'), 'Path');
  assert.equal(pathKey({ PATH: 'x' }, 'win32'), 'PATH');
  assert.equal(pathKey({ Path: 'x' }, 'linux'), 'PATH');
});

test('CI-05: the Windows npm shim for claude resolves to the native claude.exe', () => {
  const shim = 'C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd';
  const text = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n';
  assert.equal(cmdShimTarget(shim, text), 'C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe');
  assert.equal(cmdShimTarget(shim, '@echo off\r\nnode "%~dp0\\cli.js" %*\r\n'), null, 'a node-script shim names no .exe');
});

const DETAILS = `pensmith 0.1.0-dev
  Description: Two-tier (Claude Code plugin + portable Node CLI) for academic paper writing with section-level citation verification
  Source: pensmith@pensmith

Component inventory
  Skills (8)  compile, done, outline, pensmith, plan-section, research, verify-section, write-section
  Agents (0)
  Hooks (4)  SessionStart, PreCompact, PostToolUse, Stop  (harness-only — no model context cost)
  MCP servers (1)  pensmith  (tool schemas resolved at runtime; not counted)
  LSP servers (0)

Projected token cost
  Always-on:   ~635 tok   added to every session
`;

test('CI-05: parsePluginDetails reads the component inventory', () => {
  const inv = parsePluginDetails(DETAILS);
  assert.deepEqual(inv.skills, { count: 8, names: ['compile', 'done', 'outline', 'pensmith', 'plan-section', 'research', 'verify-section', 'write-section'] });
  assert.deepEqual(inv.agents, { count: 0, names: [] });
  assert.deepEqual(inv.hooks, { count: 4, names: ['SessionStart', 'PreCompact', 'PostToolUse', 'Stop'] });
  assert.deepEqual(inv.mcpServers, { count: 1, names: ['pensmith'] });
  assert.deepEqual(inv.lspServers, { count: 0, names: [] });
  assert.deepEqual(parsePluginDetails(DETAILS.replace(/\n/g, '\r\n')), inv, 'CRLF output parses the same');
  assert.deepEqual(parsePluginDetails('Plugin "pensmith" not found'), {});
});

test('CI-05: parseMcpList reads connected and failed servers', () => {
  const text = [
    'Checking MCP server health…',
    '',
    'plugin:pensmith:pensmith: node /tmp/x/plugin/dist/mcp/server.mjs - ✓ Connected',
    'pensmith: node /repo/plugin/dist/mcp/server.mjs - √ Connected',
    'plugin:pensmith:pensmith: node C:\\x\\dist\\mcp\\server.mjs - × Failed to connect — ENOENT: Executable not found in $PATH: "stdio"',
    'other: npx -y some-server - ✗ Failed to connect',
    'remote: https://example.org/mcp (HTTP) - ⚠ Needs authentication',
    'weird: node a - b.mjs - ✓ Connected',
  ].join('\n');
  const rows = parseMcpList(text);
  assert.deepEqual(rows.map((r) => [r.name, r.connected]), [
    ['plugin:pensmith:pensmith', true],
    ['pensmith', true],
    ['plugin:pensmith:pensmith', false],
    ['other', false],
    ['remote', false],
    ['weird', true],
  ]);
  assert.equal(rows[0]!.command, 'node /tmp/x/plugin/dist/mcp/server.mjs');
  assert.equal(rows[2]!.statusText, '× Failed to connect — ENOENT: Executable not found in $PATH: "stdio"');
  assert.equal(rows[5]!.command, 'node a - b.mjs', 'a command containing " - " keeps it');
  assert.deepEqual(parseMcpList('No MCP servers configured. Use `claude mcp add` to add a server.'), []);
});

test('CI-05: pluginListProblems wants pensmith@pensmith enabled with no error field; installPathOf reads installPath', () => {
  const good = [{ id: 'pensmith@pensmith', version: '0.1.0-dev', scope: 'user', enabled: true, installPath: '/c/cache/pensmith/pensmith/0.1.0-dev', mcpServers: {} }];
  assert.deepEqual(pluginListProblems(good), []);
  assert.equal(installPathOf(good), '/c/cache/pensmith/pensmith/0.1.0-dev');
  assert.deepEqual(pluginListProblems([{ ...good[0], enabled: false }]), ['pensmith@pensmith is not enabled']);
  assert.match(pluginListProblems([{ ...good[0], errors: ['hooks: Invalid input'] }]).join(), /reports errors: \["hooks: Invalid input"\]/);
  assert.match(pluginListProblems([{ ...good[0], loadError: 'skills: Invalid input' }]).join(), /reports loadError/);
  assert.deepEqual(pluginListProblems([{ ...good[0], errors: [] }]), [], 'an empty error list is no error');
  assert.match(pluginListProblems([]).join(), /not installed/);
  assert.match(pluginListProblems({ nope: true }).join(), /did not return a list/);
  assert.equal(installPathOf([]), null);
  assert.equal(expandPluginRoot('${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.mjs', '/c/p'), '/c/p/dist/mcp/server.mjs');
});

// `pensmith status` in both glyph sets bin/lib/status-view.ts renderStatusView
// prints: ASCII in a C / POSIX locale, UTF-8 when LANG / LC_ALL / LC_CTYPE is
// UTF-8 (a typical macOS or Linux desktop) — plugin-session-check parses both.
const STATUS_ASCII = [
  'pensmith status:',
  '  paper: Attention in Transformers - class CS 101',
  '  id: 3f9c',
  '  current: #1 (outlined)',
  '  sections:',
  '    [ ] #1 introduction: outlined (not planned)',
  '    [ ] #2 mechanisms: outlined (not planned)',
  '    [x] #2a background: verified',
  '  cost: $0.00 this session, $0.00 paper total',
  '  next: plan #1',
].join('\n');
const STATUS_UTF8 = [
  'pensmith status:',
  '  paper: Attention in Transformers — class CS 101',
  '  id: 3f9c',
  '  current: §1 (outlined)',
  '  sections:',
  '    ⌽ §1 introduction: outlined (not planned)',
  '    ⌛ §2 mechanisms: writing',
  '    ✓ §2a background: verified',
  '    ! §3 conclusion: failed',
  '  cost: $0.00 this session, $0.00 paper total',
  '  next: write §2',
  '  attention: section §3 failed — run `pensmith write 3`',
].join('\r\n');

test('PLUG-03 / PLUG-14: statusSummary reads the next step and the section lines in both glyph sets', () => {
  assert.deepEqual(statusSummary(STATUS_ASCII), {
    next: 'plan #1',
    sections: [{ id: '1', slug: 'introduction' }, { id: '2', slug: 'mechanisms' }, { id: '2a', slug: 'background' }],
  });
  assert.deepEqual(statusSummary(STATUS_UTF8), {
    next: 'write §2',
    sections: [{ id: '1', slug: 'introduction' }, { id: '2', slug: 'mechanisms' }, { id: '2a', slug: 'background' }, { id: '3', slug: 'conclusion' }],
  });
  assert.deepEqual(statusSummary('pensmith status:\n  sections:\n    (none yet)\n  next: research'), { next: 'research', sections: [] });
  assert.deepEqual(statusSummary(''), { next: '', sections: [] });
});

test('PLUG-14: sectionStepOf reads a section step in either glyph set, and nothing else', () => {
  assert.deepEqual(sectionStepOf('plan #1'), { verb: 'plan', id: '1' });
  assert.deepEqual(sectionStepOf('write §2a'), { verb: 'write', id: '2a' });
  assert.deepEqual(sectionStepOf('verify §10'), { verb: 'verify', id: '10' });
  for (const other of ['research', 'compile', 'status (done)', 'plan', 'revise #1', '']) assert.equal(sectionStepOf(other), null, other);
});


test('PLUG-03: parseCgiHead splits git http-backend\'s CGI head from the body (CRLF or LF), waiting for the blank line', () => {
  assert.equal(parseCgiHead('Status: 200 OK\r\nContent-Type: text/plain'), null, 'no blank line yet');
  const crlf = parseCgiHead(Buffer.from('Expires: Fri, 01 Jan 1980 00:00:00 GMT\r\nContent-Type: application/x-git-upload-pack-advertisement\r\n\r\n001e# service=git-upload-pack\n', 'latin1'));
  assert.ok(crlf);
  assert.equal(crlf.status, 200, 'no Status line means 200');
  assert.equal(crlf.headers['Content-Type'], 'application/x-git-upload-pack-advertisement');
  assert.equal(crlf.body.toString('latin1'), '001e# service=git-upload-pack\n');
  const lf = parseCgiHead('Status: 404 Not Found\nContent-Type: text/plain\n\nRepository not exported.\n');
  assert.ok(lf);
  assert.equal(lf.status, 404);
  assert.equal(lf.body.toString(), 'Repository not exported.\n');
  assert.equal(parseCgiHead('Status: nonsense\n\n')?.status, 500, 'an unreadable status is a server error');
});

test('PLUG-03: gitCgiEnv maps one request onto the CGI variables git http-backend reads', () => {
  const env = gitCgiEnv({ PATH: '/usr/bin' }, '/srv/git', {
    method: 'POST',
    url: '/pensmith.git/git-upload-pack?x=1',
    headers: { 'content-type': 'application/x-git-upload-pack-request', 'content-length': '120', 'content-encoding': 'gzip', 'git-protocol': 'version=2' },
  });
  assert.equal(env['PATH'], '/usr/bin');
  assert.equal(env['GIT_PROJECT_ROOT'], '/srv/git');
  assert.equal(env['GIT_HTTP_EXPORT_ALL'], '1');
  assert.equal(env['REQUEST_METHOD'], 'POST');
  assert.equal(env['PATH_INFO'], '/pensmith.git/git-upload-pack');
  assert.equal(env['QUERY_STRING'], 'x=1');
  assert.equal(env['CONTENT_TYPE'], 'application/x-git-upload-pack-request');
  assert.equal(env['CONTENT_LENGTH'], '120');
  assert.equal(env['HTTP_CONTENT_ENCODING'], 'gzip', 'a gzipped request body is announced to the backend');
  assert.equal(env['HTTP_GIT_PROTOCOL'], 'version=2');
  const get = gitCgiEnv({}, '/srv/git', { method: 'GET', url: '/pensmith.git/info/refs?service=git-upload-pack', headers: {} });
  assert.equal(get['CONTENT_LENGTH'], undefined, 'no body, no CONTENT_LENGTH');
  assert.equal(get['QUERY_STRING'], 'service=git-upload-pack');
});

test('CI-05 (review round 3): step 7\'s git host serves a pull request\'s detached, shallow checkout on a branch that a push moves and a fresh clone follows', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'pensmith-smoke-git-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  // The upstream repository: two commits.
  const upstream = join(base, 'upstream');
  gitSync(['init', '--quiet', upstream], base);
  writeFileSync(join(upstream, 'status.md'), 'one\n');
  gitSync(['add', 'status.md'], upstream);
  gitSync(['commit', '--quiet', '-m', 'one'], upstream);
  writeFileSync(join(upstream, 'status.md'), 'two\n');
  gitSync(['commit', '--quiet', '-am', 'two'], upstream);
  const tip = gitSync(['rev-parse', 'HEAD'], upstream).trim();

  // What actions/checkout makes for a pull_request run: a depth-1 fetch of the
  // merge ref, checked out detached. Then the smoke's step-3 clone of it.
  const pr = join(base, 'pr');
  gitSync(['init', '--quiet', pr], base);
  gitSync(['fetch', '--quiet', '--depth=1', pathToFileURL(upstream).href, `+${tip}:refs/remotes/pull/1/merge`], pr);
  gitSync(['checkout', '--quiet', '--force', 'refs/remotes/pull/1/merge'], pr);
  const clone = join(base, 'clone');
  gitSync(['clone', '--quiet', '--local', '--no-hardlinks', pr, clone], base);
  assert.equal(gitSync(['rev-parse', '--abbrev-ref', 'HEAD'], clone).trim(), 'HEAD', 'the clone is detached, like the checkout');
  assert.equal(gitSync(['rev-parse', '--is-shallow-repository'], clone).trim(), 'true', 'and shallow');

  // The pre-round-3 sequence fails there: `git push origin HEAD` has no branch to update.
  const plainBare = join(base, 'plain.git');
  gitSync(['clone', '--quiet', '--bare', clone, plainBare], base);
  const plainWork = join(base, 'plain-work');
  gitSync(['clone', '--quiet', plainBare, plainWork], base);
  writeFileSync(join(plainWork, 'status.md'), 'three\n');
  gitSync(['commit', '--quiet', '-am', 'three'], plainWork);
  assert.throws(() => gitSync(['push', '--quiet', 'origin', 'HEAD'], plainWork), 'a detached HEAD has no branch to push');

  // bareRepoOnBranch: HEAD is a symbolic ref to the branch, which holds the checkout's commit.
  const bare = join(base, 'host', 'pensmith.git');
  assert.equal(bareRepoOnBranch(clone, bare, 'smoke'), tip);
  assert.equal(gitSync(['--git-dir', bare, 'symbolic-ref', 'HEAD'], base).trim(), 'refs/heads/smoke');
  assert.equal(gitSync(['--git-dir', bare, 'rev-parse', 'refs/heads/smoke'], base).trim(), tip);

  // The smoke's update commit reaches the branch, and a fresh clone (what
  // Claude Code makes of the marketplace URL) checks it out on that branch.
  const work = join(base, 'work');
  gitSync(['clone', '--quiet', '--branch', 'smoke', bare, work], base);
  writeFileSync(join(work, 'status.md'), 'three\n');
  gitSync(['commit', '--quiet', '-am', 'three'], work);
  const pushed = gitSync(['rev-parse', 'HEAD'], work).trim();
  gitSync(['push', '--quiet', 'origin', 'HEAD:refs/heads/smoke'], work);
  assert.equal(gitSync(['--git-dir', bare, 'rev-parse', 'HEAD'], base).trim(), pushed, 'the served HEAD moved to the pushed commit');
  const fresh = join(base, 'fresh');
  gitSync(['clone', '--quiet', bare, fresh], base);
  assert.equal(gitSync(['rev-parse', '--abbrev-ref', 'HEAD'], fresh).trim(), 'smoke');
  assert.equal(gitSync(['rev-parse', 'HEAD'], fresh).trim(), pushed);
});

test('PLUG-03 (review round 3): fencedText reads the status text out of a pensmith_status result (note, then the fenced block)', () => {
  const status = 'pensmith status:\n  paper: T\n  next: write §2\n';
  const result = `pensmith_status: the next block is …\n${fenceUntrusted(status)}`;
  assert.equal(fencedText(result), status);
  assert.equal(fencedText(fenceUntrusted(status)), status);
  assert.equal(fencedText(status), null, 'no fence, no status text');
  assert.equal(fencedText(`${FENCE_OPEN}\n${status}`), null, 'an unclosed fence is not a block');
});
