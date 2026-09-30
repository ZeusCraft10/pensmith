// tests/manifest.test.ts — the plugin manifests in the shapes the current Claude
// Code plugin spec defines (PLUG-01, PLUG-04; D-23a-05..08).
//
// Rewritten in Phase 23a: the earlier version asserted the pre-v1 shapes that
// kept the plugin from loading — a `skills` array of {name, file} objects, a
// `dist/mcp/server.js` server path (a gitignored tsc build, absent from a
// git-marketplace install), a `./` marketplace source (which ships bin/ and
// CLAUDE.md), a `${CLAUDE_PLUGIN_ROOT}` developer .mcp.json (undefined outside a
// plugin) and a homemade hooks.json. It now asserts the spec shapes, and that
// `npm run validate:manifests` passes on the real tree (which needs the
// committed plugin/dist bundles).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson<T>(...segments: string[]): T {
  return JSON.parse(fs.readFileSync(path.join(REPO, ...segments), 'utf8')) as T;
}

interface ServerConfig {
  type?: string;
  command?: string;
  args?: string[];
}
interface CommandHook {
  type?: string;
  command?: string;
  args?: string[];
  timeout?: number;
}
interface HookGroup {
  matcher?: string;
  hooks: CommandHook[];
}

const PKG = readJson<{ version: string }>('package.json');

test('PLUG-01: plugin/.claude-plugin/plugin.json holds metadata and the inline MCP server only', () => {
  const plugin = readJson<Record<string, unknown>>('plugin', '.claude-plugin', 'plugin.json');
  assert.equal(plugin['name'], 'pensmith');
  assert.equal(plugin['version'], PKG.version, 'the plugin version is the package.json version');
  assert.equal(plugin['license'], 'AGPL-3.0-or-later');
  assert.equal(typeof plugin['description'], 'string');
  assert.equal(typeof (plugin['author'] as { name?: unknown }).name, 'string');
  assert.doesNotThrow(() => new URL(String(plugin['homepage'])), 'homepage parses as a URL');
  // The default skills/ scan loads skills/<name>/SKILL.md; hooks/hooks.json loads by default.
  assert.ok(!('skills' in plugin), 'no skills key (the {name, file} array was the pre-v1 shape)');
  assert.ok(!('hooks' in plugin), 'no hooks key (declaring hooks/hooks.json again merges it twice)');
  const servers = plugin['mcpServers'] as Record<string, ServerConfig>;
  assert.deepEqual(Object.keys(servers), ['pensmith']);
  assert.deepEqual(servers['pensmith'], {
    type: 'stdio',
    command: 'node',
    args: ['${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.mjs'],
  });
});

test('PLUG-01: the manifest lives only in plugin/ — the repo root keeps just the marketplace', () => {
  assert.ok(!fs.existsSync(path.join(REPO, '.claude-plugin', 'plugin.json')), 'no repo-root plugin.json (the repo is not the plugin)');
  assert.deepEqual(fs.readdirSync(path.join(REPO, '.claude-plugin')).sort(), ['marketplace.json']);
  assert.ok(!fs.existsSync(path.join(REPO, 'plugin', '.mcp.json')), 'no second server declaration inside the plugin');
});

test('PLUG-01: plugin/hooks/hooks.json is the spec shape — 4 events, exec form, contract matchers and timeouts', () => {
  const manifest = readJson<{ description?: string; hooks: Record<string, HookGroup[]>; schemaVersion?: unknown }>('plugin', 'hooks', 'hooks.json');
  assert.ok(!('schemaVersion' in manifest), 'no homemade schemaVersion');
  assert.ok(!Array.isArray(manifest.hooks), 'hooks is an object keyed by event');
  assert.equal(typeof manifest.description, 'string');
  const want: Record<string, { script: string; matcher?: string }> = {
    SessionStart: { script: 'session-start', matcher: 'startup|resume|compact' },
    PreCompact: { script: 'pre-compact' },
    PostToolUse: { script: 'post-tool-use', matcher: 'mcp__plugin_pensmith_pensmith__.*' },
    Stop: { script: 'stop' },
  };
  assert.deepEqual(Object.keys(manifest.hooks).sort(), Object.keys(want).sort());
  for (const [event, spec] of Object.entries(want)) {
    const groups = manifest.hooks[event]!;
    assert.equal(groups.length, 1, `${event}: one matcher group`);
    const group = groups[0]!;
    if (spec.matcher === undefined) assert.ok(!('matcher' in group), `${event} takes no matcher`);
    else assert.equal(group.matcher, spec.matcher, `${event} matcher`);
    assert.deepEqual(group.hooks, [
      { type: 'command', command: 'node', args: [`\${CLAUDE_PLUGIN_ROOT}/dist/hooks/${spec.script}.mjs`], timeout: 10 },
    ]);
  }
});

test('PLUG-01: the PostToolUse matcher covers only the plugin\'s own MCP tools', () => {
  const manifest = readJson<{ hooks: Record<string, HookGroup[]> }>('plugin', 'hooks', 'hooks.json');
  const re = new RegExp(`^(?:${manifest.hooks['PostToolUse']![0]!.matcher!})$`);
  assert.ok(re.test('mcp__plugin_pensmith_pensmith__pensmith_status'));
  assert.ok(re.test('mcp__plugin_pensmith_pensmith__paper_advance_section'));
  for (const other of ['Write', 'Edit', 'Bash', 'mcp__zotero__search', 'mcp__plugin_other_pensmith__x']) {
    assert.ok(!re.test(other), `${other} must not spawn a pensmith hook`);
  }
});

test('PLUG-01: the marketplace entry installs plugin/, never the repo root', () => {
  const market = readJson<{ name: string; owner: { name: string }; plugins: Array<Record<string, unknown>> }>('.claude-plugin', 'marketplace.json');
  assert.equal(market.name, 'pensmith');
  assert.equal(typeof market.owner.name, 'string');
  const entry = market.plugins.find((p) => p['name'] === 'pensmith');
  assert.ok(entry, 'the pensmith entry');
  assert.equal(entry['source'], './plugin');
  assert.ok(!('version' in entry) || entry['version'] === PKG.version, 'an entry version, if any, equals package.json');
});

test('PLUG-04: the developer .mcp.json runs the committed bundle with no ${CLAUDE_PLUGIN_ROOT}', () => {
  const raw = fs.readFileSync(path.join(REPO, '.mcp.json'), 'utf8');
  assert.ok(!raw.includes('CLAUDE_PLUGIN_ROOT'), '${CLAUDE_PLUGIN_ROOT} is undefined outside a plugin');
  const mcp = JSON.parse(raw) as { mcpServers: Record<string, ServerConfig> };
  // ${PWD} makes the expanded command line identical to the plugin's when the
  // repo is opened at its root with --plugin-dir ./plugin, so Claude Code
  // registers the server once; `:-.` falls back where PWD is unset (D-23a-07).
  assert.deepEqual(mcp.mcpServers['pensmith'], {
    type: 'stdio',
    command: 'node',
    args: ['${PWD:-.}/plugin/dist/mcp/server.mjs'],
  });
});

test('PLUG-01: `npm run validate:manifests` passes on the real tree (needs the committed plugin/dist bundles)', () => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'validate-plugin-manifest.cjs')], { cwd: REPO, encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /✓ plugin\/ .* valid/);
});
