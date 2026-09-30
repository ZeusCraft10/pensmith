// tests/plugin-smoke-helpers.test.ts — the pure helpers of the CI-05 plugin
// smoke (scripts/plugin-smoke-lib.mjs, D-23a-17): the PATH-without-node filter
// on win32 and posix, PATH lookup, the Windows npm shim target, and the
// parsers for `claude plugin details`, `claude mcp list` and `claude plugin
// list --json` (fed the output Claude Code 2.1.285 prints). The smoke itself
// runs the real Claude Code (`npm run plugin:smoke`, the CI `plugin` job).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cmdShimTarget,
  executableNames,
  expandPluginRoot,
  findOnPath,
  installPathOf,
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

