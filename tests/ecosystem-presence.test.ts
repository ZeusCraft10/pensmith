// tests/ecosystem-presence.test.ts
//
// Zotero MCP and humanizer detection must look where Claude Code actually
// keeps them:
//   - MCP servers: ~/.claude.json (or $CLAUDE_CONFIG_DIR/.claude.json), both
//     the top-level `mcpServers` and `projects[<cwd>].mcpServers`; the
//     project's .mcp.json; and installed plugins.
//   - Skills: ~/.claude/skills (or $CLAUDE_CONFIG_DIR/skills), the project's
//     .claude/skills, and installed plugins' skills/.
// The old probe read ~/.claude/mcp_servers.json, which Claude Code never
// writes, so a configured Zotero server always showed as absent.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import {
  isZoteroMcpPresent,
  isHumanizerSkillPresent,
  zoteroMcpConfigLocations,
} from '../bin/lib/ecosystem-presence.js';
import { zoteroMcpPresenceProbe } from '../bin/lib/doctor/probes/zotero-mcp-presence.js';

const saved = {
  home: process.env['HOME'],
  userprofile: process.env['USERPROFILE'],
  cfg: process.env['CLAUDE_CONFIG_DIR'],
  zotero: process.env['ZOTERO_API_KEY'],
};

afterEach(() => {
  for (const [k, v] of [['HOME', saved.home], ['USERPROFILE', saved.userprofile], ['CLAUDE_CONFIG_DIR', saved.cfg], ['ZOTERO_API_KEY', saved.zotero]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** A fresh home directory with nothing configured; returns it and a project dir. */
function freshHome(): { home: string; project: string } {
  const home = mkdtempSync(path.join(tmpdir(), 'pensmith-eco-home-'));
  process.env['HOME'] = home;
  process.env['USERPROFILE'] = home;
  delete process.env['CLAUDE_CONFIG_DIR'];
  assert.equal(homedir(), home, 'test setup: homedir() must follow HOME');
  const project = mkdtempSync(path.join(tmpdir(), 'pensmith-eco-project-'));
  return { home, project };
}

const writeJson = (p: string, v: unknown): void => {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v));
};

test('nothing configured: both report absent', () => {
  const { project } = freshHome();
  assert.equal(isZoteroMcpPresent(project), false);
  assert.equal(isHumanizerSkillPresent(project), false);
});

test('a user-scope Zotero server in ~/.claude.json is found', () => {
  const { home, project } = freshHome();
  writeJson(path.join(home, '.claude.json'), { mcpServers: { zotero: { command: 'zotero-mcp' } } });
  assert.equal(isZoteroMcpPresent(project), true);
  assert.ok(zoteroMcpConfigLocations(project).includes(path.join(home, '.claude.json')));
});

test('a local-scope Zotero server under projects[cwd] in ~/.claude.json is found', () => {
  const { home, project } = freshHome();
  writeJson(path.join(home, '.claude.json'), { projects: { [project]: { mcpServers: { 'zotero-local': {} } } } });
  assert.equal(isZoteroMcpPresent(project), true);
  const other = mkdtempSync(path.join(tmpdir(), 'pensmith-eco-other-'));
  assert.equal(isZoteroMcpPresent(other), false, 'a server scoped to another project must not count');
});

test('a project-scope Zotero server in <cwd>/.mcp.json is found', () => {
  const { project } = freshHome();
  writeJson(path.join(project, '.mcp.json'), { mcpServers: { Zotero: { command: 'x' } } });
  assert.equal(isZoteroMcpPresent(project), true);
});

test('CLAUDE_CONFIG_DIR moves the user config', () => {
  const { home, project } = freshHome();
  const cfg = mkdtempSync(path.join(tmpdir(), 'pensmith-eco-cfg-'));
  process.env['CLAUDE_CONFIG_DIR'] = cfg;
  writeJson(path.join(home, '.claude.json'), { mcpServers: { zotero: {} } });
  assert.equal(isZoteroMcpPresent(project), false, 'with CLAUDE_CONFIG_DIR set, ~/.claude.json is not the config');
  writeJson(path.join(cfg, '.claude.json'), { mcpServers: { zotero: {} } });
  assert.equal(isZoteroMcpPresent(project), true);

  mkdirSync(path.join(cfg, 'skills', 'humanizer'), { recursive: true });
  writeFileSync(path.join(cfg, 'skills', 'humanizer', 'SKILL.md'), '---\nname: humanizer\n---\n');
  assert.equal(isHumanizerSkillPresent(project), true);
});

test('the humanizer is found as a user, project or plugin skill', () => {
  const user = freshHome();
  mkdirSync(path.join(user.home, '.claude', 'skills', 'humanizer'), { recursive: true });
  writeFileSync(path.join(user.home, '.claude', 'skills', 'humanizer', 'SKILL.md'), 'x');
  assert.equal(isHumanizerSkillPresent(user.project), true, 'user skill');

  const proj = freshHome();
  mkdirSync(path.join(proj.project, '.claude', 'skills', 'humanizer'), { recursive: true });
  writeFileSync(path.join(proj.project, '.claude', 'skills', 'humanizer', 'SKILL.md'), 'x');
  assert.equal(isHumanizerSkillPresent(proj.project), true, 'project skill');

  const plug = freshHome();
  const installPath = path.join(plug.home, '.claude', 'plugins', 'cache', 'm', 'writing-tools', '1.0.0');
  mkdirSync(path.join(installPath, 'skills', 'humanizer'), { recursive: true });
  writeFileSync(path.join(installPath, 'skills', 'humanizer', 'SKILL.md'), 'x');
  writeJson(path.join(plug.home, '.claude', 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: { 'writing-tools@m': [{ scope: 'user', installPath, version: '1.0.0' }] },
  });
  assert.equal(isHumanizerSkillPresent(plug.project), true, 'plugin skill');
});

test('a Zotero server shipped by an installed plugin is found', () => {
  const { home, project } = freshHome();
  const installPath = path.join(home, '.claude', 'plugins', 'cache', 'm', 'zotero', '2.0.0');
  writeJson(path.join(installPath, '.mcp.json'), { mcpServers: { zotero: { command: 'node' } } });
  writeJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: { 'zotero@m': [{ scope: 'user', installPath, version: '2.0.0' }] },
  });
  assert.equal(isZoteroMcpPresent(project), true);
});

test('malformed config files never throw', () => {
  const { home, project } = freshHome();
  mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  writeFileSync(path.join(home, '.claude.json'), '{ nope');
  writeFileSync(path.join(project, '.mcp.json'), '[1,2');
  writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), 'null');
  assert.equal(isZoteroMcpPresent(project), false);
  assert.equal(isHumanizerSkillPresent(project), false);
});

test('the doctor Zotero probe never claims research reads from Zotero', async () => {
  // research does not read from Zotero in this alpha (the adapter returns []
  // unless a test-only client is injected), so no probe outcome may imply it.
  const outcomes: Record<string, string> = {};
  const { home } = freshHome();
  delete process.env['ZOTERO_API_KEY'];
  outcomes['absent'] = JSON.stringify(await zoteroMcpPresenceProbe.run());
  writeJson(path.join(home, '.claude.json'), { mcpServers: { zotero: { command: 'zotero-mcp' } } });
  outcomes['configured, no key'] = JSON.stringify(await zoteroMcpPresenceProbe.run());
  process.env['ZOTERO_API_KEY'] = 'dummy-not-a-secret';
  const pass = await zoteroMcpPresenceProbe.run();
  outcomes['configured with key'] = JSON.stringify(pass);
  assert.equal(pass.severity, 'PASS', 'a configured server with its key set is a PASS');
  for (const [state, out] of Object.entries(outcomes)) {
    assert.match(out, /research does not read from Zotero yet/i, `${state}: say research does not use Zotero yet`);
    assert.doesNotMatch(out, /authenticated|pulled|pull from|offline-only/i, `${state}: must not imply Zotero is a research source: ${out}`);
  }
});
