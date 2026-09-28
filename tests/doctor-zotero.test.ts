// tests/doctor-zotero.test.ts — the doctor's Zotero probe (SRC-16, D-19-24).
//
//   - `Zotero: authenticated` only after GET /keys/current answers 200 (never
//     from the key's presence); `Zotero: key rejected` on 403; the key value
//     never appears in the result;
//   - the Zotero 7 local API and a public group are checked by one keyless GET;
//   - Zotero MCP servers are detected in every Claude Code scope — user and
//     local (project entry) in $CLAUDE_CONFIG_DIR/.claude.json, the project's
//     .mcp.json, the legacy mcp_servers.json files — in the JSON shapes
//     `claude mcp add` writes; detected-but-no-key is "not authenticated";
//   - nothing configured → `Zotero: not detected`, with real fix links.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installMockAgent, type InstalledMockAgent } from './helpers/local-servers/mock-agent.js';
import { zoteroMcpPresenceProbe, ZOTERO_MCP_SERVER_REPO } from '../bin/lib/doctor/probes/zotero-mcp-presence.js';
import { detectZoteroMcpServers } from '../bin/lib/ecosystem-presence.js';
import { loadCapabilityFacts } from '../bin/lib/capabilities.js';
import { _resetHostStateForTest, ZOTERO_LOCAL_ORIGIN } from '../bin/lib/http.js';
import { atomicWriteFile } from '../bin/lib/atomic-write.js';

const KEY = 'zk-DOCTOR-SENTINEL-99a1b2';

interface Env {
  readonly home: string;
  readonly config: string;
  readonly project: string;
}

/** An isolated HOME, CLAUDE_CONFIG_DIR and project folder (cwd), plus the Zotero variables. */
async function isolated<T>(vars: Record<string, string | undefined>, fn: (e: Env, m: InstalledMockAgent) => Promise<T>): Promise<T> {
  const base = mkdtempSync(join(tmpdir(), 'pensmith-doctor-zotero-'));
  const e: Env = { home: join(base, 'home'), config: join(base, 'claude-config'), project: join(base, 'project') };
  for (const d of [e.home, e.config, e.project]) mkdirSync(d, { recursive: true });
  const all: Record<string, string | undefined> = {
    HOME: e.home,
    USERPROFILE: e.home,
    CLAUDE_CONFIG_DIR: e.config,
    XDG_DATA_HOME: base,
    LOCALAPPDATA: base,
    PENSMITH_PAPER_ROOT: undefined,
    PENSMITH_NETWORK_TESTS: '1',
    PENSMITH_OFFLINE: undefined,
    ZOTERO_API_KEY: undefined,
    ZOTERO_GROUP_ID: undefined,
    PENSMITH_ZOTERO_LOCAL: undefined,
    ...vars,
  };
  const saved = new Map(Object.keys(all).map((k) => [k, process.env[k]]));
  const savedCwd = process.cwd();
  for (const [k, v] of Object.entries(all)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  process.chdir(e.project);
  _resetHostStateForTest();
  const m = installMockAgent();
  try {
    return await fn(e, m);
  } finally {
    await m.restore().catch(() => undefined);
    process.chdir(savedCwd);
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(base, { recursive: true, force: true });
  }
}

const STDIO = (cmd: string, args: string[]) => ({ type: 'stdio', command: cmd, args, env: {} });

test('SRC-16: `Zotero: authenticated` only after GET /keys/current answers 200 — the key value never appears', async () => {
  await isolated({ ZOTERO_API_KEY: KEY }, async (_e, m) => {
    let sent: string | undefined;
    m.agent.get('https://api.zotero.org').intercept({ path: '/keys/current', method: 'GET' }).reply((opts) => {
      sent = Object.entries(opts.headers as Record<string, string>).find(([k]) => k.toLowerCase() === 'zotero-api-key')?.[1];
      return { statusCode: 200, data: JSON.stringify({ key: KEY, userID: 4242, access: { user: { library: true } } }), responseOptions: { headers: { 'content-type': 'application/json' } } };
    });
    const r = await zoteroMcpPresenceProbe.run();
    assert.equal(sent, KEY, 'the check really went to the Web API with the key header');
    assert.equal(r.severity, 'PASS');
    assert.equal(r.summary, 'Zotero: authenticated (Web API, library users/4242)');
    assert.match(r.detail ?? '', /Web API: GET https:\/\/api\.zotero\.org\/keys\/current → 200/);
    assert.equal(JSON.stringify(r).includes(KEY), false, 'T-01-07');
  });
});

test('SRC-16: `Zotero: key rejected` on 403, with the keys page as the fix', async () => {
  await isolated({ ZOTERO_API_KEY: 'bogus' }, async (_e, m) => {
    m.agent.get('https://api.zotero.org').intercept({ path: '/keys/current', method: 'GET' }).reply(403, 'Invalid key', { headers: { 'content-type': 'text/html' } });
    const r = await zoteroMcpPresenceProbe.run();
    assert.equal(r.severity, 'WARN');
    assert.match(r.summary, /^Zotero: key rejected \(HTTP 403\)/);
    assert.match(r.fix ?? '', /https:\/\/www\.zotero\.org\/settings\/keys/);
  });
});

test('SRC-16: a 5xx or transport failure is "not checked", never authenticated', async () => {
  await isolated({ ZOTERO_API_KEY: KEY }, async (_e, m) => {
    m.agent.get('https://api.zotero.org').intercept({ path: '/keys/current', method: 'GET' }).reply(502, 'bad gateway');
    const r = await zoteroMcpPresenceProbe.run();
    assert.equal(r.severity, 'WARN');
    assert.equal(r.summary, 'Zotero: not checked (HTTP 502)');
  });
});

test('SRC-16: nothing configured → `Zotero: not detected` with real fix links (keys page, a Zotero MCP server repo)', async () => {
  await isolated({}, async (e) => {
    const r = await zoteroMcpPresenceProbe.run();
    assert.equal(r.severity, 'WARN');
    assert.match(r.summary, /^Zotero: not detected/);
    assert.match(r.detail ?? '', /^MCP server: not detected$/m);
    assert.ok((r.detail ?? '').includes(join(e.config, '.claude.json')), 'the Claude config file checked is named');
    assert.ok((r.fix ?? '').includes('https://www.zotero.org/settings/keys'));
    assert.ok((r.fix ?? '').includes(ZOTERO_MCP_SERVER_REPO));
    assert.equal(ZOTERO_MCP_SERVER_REPO, 'https://github.com/54yyyu/zotero-mcp');
  });
});

test('SRC-16: a server added with `claude mcp add` (local scope: the project entry in $CLAUDE_CONFIG_DIR/.claude.json) is detected — not authenticated', async () => {
  await isolated({}, async (e) => {
    await atomicWriteFile(
      join(e.config, '.claude.json'),
      JSON.stringify({ firstStartTime: '2026-09-28T00:00:00.000Z', projects: { [e.project]: { allowedTools: [], mcpServers: { zotero: STDIO('npx', ['-y', 'zotero-mcp']) } } } }, null, 2),
    );
    const d = detectZoteroMcpServers();
    assert.deepEqual(d.servers.map((s) => [s.name, s.scope]), [['zotero', 'local']]);
    const r = await zoteroMcpPresenceProbe.run();
    assert.equal(r.severity, 'WARN');
    assert.match(r.summary, /^Zotero: MCP server detected — not authenticated for the CLI/);
    assert.match(r.detail ?? '', /^MCP server: detected — "zotero" \(local scope, /m);
    assert.equal((await loadCapabilityFacts()).zotero_mcp, true, 'paper://capabilities reports the same fact');
  });
});

test('SRC-16: user scope, the project .mcp.json and the legacy mcp_servers.json are detected too (by name or by command)', async () => {
  await isolated({}, async (e) => {
    await atomicWriteFile(join(e.config, '.claude.json'), JSON.stringify({ mcpServers: { library: STDIO('uvx', ['zotero-mcp']) } }));
    await atomicWriteFile(join(e.project, '.mcp.json'), JSON.stringify({ mcpServers: { 'zotero-proj': STDIO('zotero-mcp', []) } }));
    mkdirSync(join(e.home, '.claude'), { recursive: true });
    await atomicWriteFile(join(e.home, '.claude', 'mcp_servers.json'), JSON.stringify({ mcpServers: { 'my-zotero': { command: 'node', args: ['server.js'] } } }));
    const d = detectZoteroMcpServers();
    assert.deepEqual(
      d.servers.map((s) => [s.name, s.scope]),
      [
        ['library', 'user'],
        ['zotero-proj', 'project'],
        ['my-zotero', 'legacy'],
      ],
    );
  });
});

test('SRC-16: unrelated servers, malformed files and another project\'s entry are not Zotero', async () => {
  await isolated({}, async (e) => {
    await atomicWriteFile(join(e.config, '.claude.json'), JSON.stringify({ mcpServers: { github: STDIO('gh', ['mcp']) }, projects: { [join(e.project, '..', 'other')]: { mcpServers: { zotero: STDIO('zotero-mcp', []) } } } }));
    await atomicWriteFile(join(e.project, '.mcp.json'), '{ not json');
    assert.deepEqual(detectZoteroMcpServers().servers, []);
    assert.equal((await loadCapabilityFacts()).zotero_mcp, false);
  });
});

test('SRC-16: PENSMITH_ZOTERO_LOCAL=1 — the local API answering is a PASS; not running is a WARN saying how to enable it', async () => {
  await isolated({ PENSMITH_ZOTERO_LOCAL: '1' }, async (_e, m) => {
    m.agent.get(ZOTERO_LOCAL_ORIGIN).intercept({ path: '/api/users/0/items/top?limit=1&format=json', method: 'GET' }).reply(200, '[]', { headers: { 'content-type': 'application/json' } });
    const ok = await zoteroMcpPresenceProbe.run();
    assert.equal(ok.severity, 'PASS');
    assert.equal(ok.summary, 'Zotero: local API reachable — research can pull from it');
    m.agent.get(ZOTERO_LOCAL_ORIGIN).intercept({ path: /.*/, method: 'GET' }).replyWithError(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:23119'), { code: 'ECONNREFUSED' }));
    const down = await zoteroMcpPresenceProbe.run();
    assert.equal(down.severity, 'WARN');
    assert.match(down.summary, /^Zotero: local API \(http:\/\/127\.0\.0\.1:23119\) not readable — the Zotero local API is not reachable/);
    assert.match(down.fix ?? '', /Allow other applications on this computer to communicate with Zotero/);
  });
});

test('SRC-16: ZOTERO_GROUP_ID without a key — a public group is readable (PASS); a private one is a WARN', async () => {
  await isolated({ ZOTERO_GROUP_ID: '100' }, async (_e, m) => {
    const pool = m.agent.get('https://api.zotero.org');
    pool.intercept({ path: '/groups/100/items/top?limit=1&format=json', method: 'GET' }).reply(200, '[]', { headers: { 'content-type': 'application/json' } });
    assert.equal((await zoteroMcpPresenceProbe.run()).summary, 'Zotero: group library groups/100 readable — research can pull from it');
    pool.intercept({ path: '/groups/100/items/top?limit=1&format=json', method: 'GET' }).reply(403, 'Forbidden');
    const priv = await zoteroMcpPresenceProbe.run();
    assert.equal(priv.severity, 'WARN');
    assert.match(priv.fix ?? '', /private group needs ZOTERO_API_KEY/);
  });
});
