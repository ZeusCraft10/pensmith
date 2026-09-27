// tests/live-default.test.ts — RUN-01: sources are LIVE by default.
//
// Spawns the BUILT CLI (dist/bin/pensmith.js — run `npm run build` first) the
// way a user runs it: no test-runner context (NODE_TEST_CONTEXT, PENSMITH_TEST
// removed), no PENSMITH_* variable except PENSMITH_NO_LLM=1 (the LLM mode is
// orthogonal to the network mode, S-15), an isolated data dir, and the
// dial-recorder preload, which records every DNS lookup / TCP / TLS dial (with
// the TLS SNI host) and REFUSES the connect — nothing leaves the machine.
//
// `research --yolo` on a topic with no recorded cassette must try the real
// source APIs (api.crossref.org and/or api.openalex.org), must not open any
// file under tests/fixtures/cassettes/, and must write no fixture paper into
// LIBRARY.json.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDialLog } from './helpers/local-servers/dial-recorder.mjs';

const DIST_CLI = fileURLToPath(new URL('../dist/bin/pensmith.js', import.meta.url));
const DIAL_RECORDER = new URL('./helpers/local-servers/dial-recorder.mjs', import.meta.url).href;

/** A user's environment: no test context, no PENSMITH_* (except the given ones), no provider keys. */
function userEnv(scratch: string, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === 'NODE_TEST_CONTEXT' || k.startsWith('PENSMITH_')) continue;
    if (/^(ANTHROPIC|OPENAI|GPTZERO)_/.test(k)) continue;
    env[k] = v;
  }
  return {
    ...env,
    XDG_DATA_HOME: join(scratch, 'data'),
    LOCALAPPDATA: join(scratch, 'data'),
    HOME: join(scratch, 'home'),
    USERPROFILE: join(scratch, 'home'),
    ...extra,
  };
}

test('RUN-01: a user CLI run with no env is LIVE — research dials the real source APIs, reads no cassette, writes no fixture', () => {
  assert.ok(existsSync(DIST_CLI), `built CLI missing at ${DIST_CLI} — run \`npm run build\` first`);
  const scratch = mkdtempSync(join(tmpdir(), 'pensmith-live-default-'));
  const project = join(scratch, 'project');
  mkdirSync(join(project, '.paper'), { recursive: true });
  writeFileSync(
    join(project, '.paper', 'INTAKE.md'),
    '---\ntopic: medieval Icelandic sagas\ndiscipline: history\n---\n# Intake\n\nWrite a 1500-word essay on medieval Icelandic sagas.\n',
  );
  const dialLog = join(scratch, 'dials.jsonl');
  const r = spawnSync(process.execPath, ['--import', DIAL_RECORDER, DIST_CLI, 'research', '--yolo'], {
    cwd: project,
    env: userEnv(scratch, { PENSMITH_NO_LLM: '1', PENSMITH_DIAL_LOG: dialLog }),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 240_000,
  });
  const stderr = r.stderr ?? '';
  const events = readDialLog(dialLog);
  const detail = `exit=${r.status}; stderr=${stderr.slice(0, 1500)}; events=${JSON.stringify(events.slice(0, 20))}`;

  assert.ok(!/OFFLINE MODE/.test(stderr), `no offline banner for a user run: ${detail}`);
  assert.match(stderr, /LLM STUBBED \(PENSMITH_NO_LLM=1\)/, 'the LLM mode is disclosed on its own');

  const dials = events.filter((e) => e.kind === 'connect');
  const hosts = new Set(dials.map((e) => (e.kind === 'connect' ? (e.servername ?? e.host) : '')));
  assert.ok(
    hosts.has('api.crossref.org') || hosts.has('api.openalex.org'),
    `research must try api.crossref.org and/or api.openalex.org: ${detail}`,
  );
  for (const d of dials) {
    if (d.kind !== 'connect') continue;
    assert.equal(d.tls, true, `every source dial is TLS: ${JSON.stringify(d)}`);
    assert.ok(d.servername && !/^\d+\.\d+\.\d+\.\d+$/.test(d.servername), `SNI carries the hostname: ${JSON.stringify(d)}`);
    // SEC-01: the dial is pinned to the address the SSRF check validated (the
    // recorder's DNS answer), never re-resolved by undici.
    assert.deepEqual(d.addresses, ['192.0.2.1'], `the dial is pinned to the validated address: ${JSON.stringify(d)}`);
  }

  const reads = events.filter((e) => e.kind === 'read');
  assert.deepEqual(reads, [], `live mode never opens tests/fixtures/cassettes: ${detail}`);

  const libPath = join(project, '.paper', 'LIBRARY.json');
  const library = existsSync(libPath) ? readFileSync(libPath, 'utf8') : '';
  for (const fixture of ['vaswani2017', 'engel2009', 'aspelmeyer2009', '10.1234/example', '10.0000/', 'nphys1170', '1706.03762']) {
    assert.ok(!library.includes(fixture), `LIBRARY.json holds no fixture entry (${fixture}): ${library.slice(0, 400)}`);
  }
});
