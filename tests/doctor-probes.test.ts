// tests/doctor-probes.test.ts
//
// DOCT-01, DOCT-02 (3 ecosystem probes), DOCT-03, DOCT-04, DOCT-05, DOCT-07
// + D-03(d) http-crossref-ping + D-19 read-only assertion + D-20 keying assertion.
//
// D-12 sentinel-value leak test: OPENALEX_API_KEY injected as sentinel; asserted
// that it NEVER appears in probe detail or summary output (T-01-07 carry-forward).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDoctor } from '../bin/lib/doctor/probes.js';
import { nodeVersionProbe } from '../bin/lib/doctor/probes/node-version.js';
import { mcpSdkPresenceProbe } from '../bin/lib/doctor/probes/mcp-sdk-presence.js';
import { zoteroMcpPresenceProbe } from '../bin/lib/doctor/probes/zotero-mcp-presence.js';
import { pandocPresenceProbe } from '../bin/lib/doctor/probes/pandoc-presence.js';
import { humanizerSkillPresenceProbe } from '../bin/lib/doctor/probes/humanizer-skill-presence.js';
import { contactEmailPresenceProbe } from '../bin/lib/doctor/probes/contact-email-presence.js';
import { syncFolderDetectionProbe } from '../bin/lib/doctor/probes/sync-folder-detection.js';
import { runtimeConfigPresenceProbe } from '../bin/lib/doctor/probes/runtime-config-presence.js';
import { buildArtifactResolvesProbe } from '../bin/lib/doctor/probes/build-artifact-resolves.js';
import { httpCrossrefPingProbe } from '../bin/lib/doctor/probes/http-crossref-ping.js';
import { networkModeProbe } from '../bin/lib/doctor/probes/network-mode.js';
import { defaultProbes } from '../bin/lib/doctor/probes.js';

test('DOCT-01 node-version returns PASS on current Node', async () => {
  const r = await nodeVersionProbe.run();
  assert.equal(r.id, 'node-version');
  assert.ok(['PASS', 'FAIL'].includes(r.severity));
});

test('DOCT-02a mcp-sdk-presence returns one of {PASS,WARN,FAIL}', async () => {
  // 02-04 ships the real server build before this plan; if running before that,
  // the probe legitimately FAILs. Both shapes are acceptable to the test.
  const r = await mcpSdkPresenceProbe.run();
  assert.equal(r.id, 'mcp-sdk-presence');
  assert.ok(['PASS', 'WARN', 'FAIL'].includes(r.severity));
});

test('DOCT-02b zotero-mcp-presence reports a `Zotero: ` state and always lists the MCP detection and the files checked', async () => {
  const saved = { key: process.env['ZOTERO_API_KEY'], local: process.env['PENSMITH_ZOTERO_LOCAL'], group: process.env['ZOTERO_GROUP_ID'] };
  delete process.env['ZOTERO_API_KEY'];
  delete process.env['PENSMITH_ZOTERO_LOCAL'];
  delete process.env['ZOTERO_GROUP_ID'];
  try {
    const r = await zoteroMcpPresenceProbe.run();
    assert.equal(r.id, 'zotero-mcp-presence');
    assert.equal(r.severity, 'WARN', 'nothing configured → WARN (Zotero is optional)');
    assert.match(r.summary, /^Zotero: (not detected|MCP server detected)/);
    assert.match(r.detail ?? '', /^MCP server: (detected|not detected)/m);
    assert.match(r.detail ?? '', /Checked:/);
    assert.match(r.fix ?? '', /https:\/\/www\.zotero\.org\/settings\/keys/);
    assert.ok(!/example\.invalid|placeholder/i.test(JSON.stringify(r)), 'real fix links, no placeholder');
  } finally {
    for (const [k, v] of [['ZOTERO_API_KEY', saved.key], ['PENSMITH_ZOTERO_LOCAL', saved.local], ['ZOTERO_GROUP_ID', saved.group]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('DOCT-02b / SRC-16: a key is never "authenticated" by presence — offline without a fixture it is "not checked (offline)", and its value never leaks (T-01-07)', async () => {
  // The test runner is sources-offline: the authenticated check (GET
  // /keys/current) has no recorded fixture, so the probe says it did not check.
  const SENTINEL = 'sk-zotero-LEAK-SENTINEL-67890';
  const savedKey = process.env['ZOTERO_API_KEY'];
  const savedLane = process.env['PENSMITH_NETWORK_TESTS'];
  process.env['ZOTERO_API_KEY'] = SENTINEL;
  delete process.env['PENSMITH_NETWORK_TESTS'];
  try {
    const r = await zoteroMcpPresenceProbe.run();
    assert.equal(r.id, 'zotero-mcp-presence');
    assert.equal(r.severity, 'SKIP');
    assert.equal(r.summary, 'Zotero: not checked (offline)');
    assert.equal(JSON.stringify(r).includes(SENTINEL), false, 'T-01-07: probe must NEVER include the ZOTERO_API_KEY value');
  } finally {
    if (savedKey === undefined) delete process.env['ZOTERO_API_KEY'];
    else process.env['ZOTERO_API_KEY'] = savedKey;
    if (savedLane !== undefined) process.env['PENSMITH_NETWORK_TESTS'] = savedLane;
  }
});

test('DOCT-02c pandoc-presence returns one of {PASS,WARN}', async () => {
  const r = await pandocPresenceProbe.run();
  assert.equal(r.id, 'pandoc-presence');
  assert.ok(['PASS', 'WARN'].includes(r.severity));
});

test('DOCT-02d humanizer-skill-presence returns one of {PASS,WARN}', async () => {
  const r = await humanizerSkillPresenceProbe.run();
  assert.equal(r.id, 'humanizer-skill-presence');
  assert.ok(['PASS', 'WARN'].includes(r.severity));
});

test('DOCT-03 contact-email-presence WARN when env unset', async () => {
  const prev = process.env.PENSMITH_CONTACT_EMAIL;
  delete process.env.PENSMITH_CONTACT_EMAIL;
  try {
    const r = await contactEmailPresenceProbe.run();
    assert.equal(r.severity, 'WARN');
    assert.match(r.summary, /PENSMITH_CONTACT_EMAIL/);
  } finally {
    if (prev !== undefined) process.env.PENSMITH_CONTACT_EMAIL = prev;
  }
});

test('DOCT-03 contact-email-presence PASS when env set', async () => {
  const prev = process.env.PENSMITH_CONTACT_EMAIL;
  process.env.PENSMITH_CONTACT_EMAIL = 'test@example.com';
  try {
    const r = await contactEmailPresenceProbe.run();
    assert.equal(r.severity, 'PASS');
    assert.match(r.summary, /mailto/);
    assert.ok(!JSON.stringify(r).includes('test@example.com'), 'the address itself never appears');
  } finally {
    if (prev !== undefined) process.env.PENSMITH_CONTACT_EMAIL = prev;
    else delete process.env.PENSMITH_CONTACT_EMAIL;
  }
});

test('DOCT-03 / D-19-09: contact-email-presence asks contactEmail() — a paper naming PENSMITH_WORK_EMAIL, and a value that is not an address', async () => {
  const { atomicWriteFile } = await import('../bin/lib/atomic-write.js');
  const { CURRENT_CONFIG_VERSION } = await import('../bin/lib/config.js');
  const { _resetContactEmailForTest } = await import('../bin/lib/contact-email.js');
  const { loadCapabilityFacts } = await import('../bin/lib/capabilities.js');
  const root = mkdtempSync(join(tmpdir(), 'pensmith-contact-probe-'));
  await atomicWriteFile(join(root, '.paper', 'config.toml'), `schema_version = ${CURRENT_CONFIG_VERSION}\n[network]\ncontact_email_env = "PENSMITH_WORK_EMAIL"\n`);
  const saved = { cwd: process.cwd(), mine: process.env['PENSMITH_WORK_EMAIL'], def: process.env['PENSMITH_CONTACT_EMAIL'], root: process.env['PENSMITH_PAPER_ROOT'] };
  process.chdir(root);
  delete process.env['PENSMITH_PAPER_ROOT'];
  process.env['PENSMITH_CONTACT_EMAIL'] = 'default@example.org';
  const stderr = process.stderr.write.bind(process.stderr);
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try {
    _resetContactEmailForTest();
    process.env['PENSMITH_WORK_EMAIL'] = 'lab@example.org';
    const ok = await contactEmailPresenceProbe.run();
    assert.equal(ok.severity, 'PASS');
    assert.match(ok.summary, /^PENSMITH_WORK_EMAIL set \(named by \[network\] contact_email_env\)/);
    assert.equal((await loadCapabilityFacts()).contact_email_set, true, 'paper://capabilities agrees');
    process.env['PENSMITH_WORK_EMAIL'] = 'not an address';
    _resetContactEmailForTest();
    const bad = await contactEmailPresenceProbe.run();
    assert.equal(bad.severity, 'WARN', 'a value that is not an address is not sent — even though PENSMITH_CONTACT_EMAIL is set');
    assert.match(bad.summary, /^PENSMITH_WORK_EMAIL is not set \(or is not an email address\)/);
    assert.equal((await loadCapabilityFacts()).contact_email_set, false, 'paper://capabilities agrees');
  } finally {
    process.stderr.write = stderr;
    process.chdir(saved.cwd);
    for (const [k, v] of [['PENSMITH_WORK_EMAIL', saved.mine], ['PENSMITH_CONTACT_EMAIL', saved.def], ['PENSMITH_PAPER_ROOT', saved.root]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetContactEmailForTest();
  }
});

test('DOCT-04 sync-folder-detection WARN when paperDir is inside /OneDrive/', async () => {
  // WR-05: canonical env var name is PENSMITH_PAPER_ROOT. Matches the
  // tier-contract test's Case C (which spawns the MCP server with
  // PENSMITH_PAPER_ROOT=<tmp>) and mcp/server.ts's boot-time resolution.
  // The transitional PENSMITH_PAPER_DIR fallback was dropped from
  // bin/lib/ecosystem-presence.ts in the same commit.
  const prev = process.env.PENSMITH_PAPER_ROOT;
  // Use a synthetic path that matches SYNC_FOLDER_PATTERNS regardless of OS.
  process.env.PENSMITH_PAPER_ROOT = '/tmp/fake/OneDrive/project';
  try {
    const r = await syncFolderDetectionProbe.run();
    assert.equal(r.severity, 'WARN');
  } finally {
    if (prev !== undefined) process.env.PENSMITH_PAPER_ROOT = prev;
    else delete process.env.PENSMITH_PAPER_ROOT;
  }
});

test('DOCT-05 build-artifact-resolves returns one of {PASS,FAIL}', async () => {
  // After `npm run build` this is PASS; before build it FAILs. Both are valid
  // shapes for this assertion. The CI matrix runs this AFTER `npm run build`.
  const r = await buildArtifactResolvesProbe.run();
  assert.equal(r.id, 'build-artifact-resolves');
  assert.ok(['PASS', 'FAIL'].includes(r.severity));
});

test('D-03(d) http-crossref-ping loads the exact-match fixture store in a source checkout (PASS)', async () => {
  // Phase 17: the probe is real. In a source checkout every committed fixture
  // must parse and the recorded Crossref fixtures must be present → PASS with the
  // count. In an installed package (no tests/ shipped) it is SKIP — exercised by
  // tests/installed-offline.test.ts. (It used to return SKIP unconditionally.)
  const r = await httpCrossrefPingProbe.run();
  assert.equal(r.id, 'http-crossref-ping');
  assert.equal(r.severity, 'PASS');
  assert.match(r.summary, /fixture file\(s\) load \(\d+ Crossref entr(y|ies)\); offline replay is exact-match only/);
});

test('RUN-05: http-crossref-ping is SKIP in live mode and under --dry-run — a live run never reads tests/', async () => {
  const saved = { net: process.env['PENSMITH_NETWORK_TESTS'], dry: process.env['PENSMITH_DRY_RUN'] };
  try {
    process.env['PENSMITH_NETWORK_TESTS'] = '1'; // the test lane's live mode
    delete process.env['PENSMITH_DRY_RUN'];
    const live = await httpCrossrefPingProbe.run();
    assert.equal(live.severity, 'SKIP');
    assert.match(live.summary, /not used \(network: live\)/);
    delete process.env['PENSMITH_NETWORK_TESTS'];
    process.env['PENSMITH_DRY_RUN'] = '1';
    const dry = await httpCrossrefPingProbe.run();
    assert.equal(dry.severity, 'SKIP');
    assert.match(dry.summary, /not used under --dry-run/);
  } finally {
    for (const [k, v] of [['PENSMITH_NETWORK_TESTS', saved.net], ['PENSMITH_DRY_RUN', saved.dry]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('RUN-02 network-mode probe: OFFLINE under the test runner, live without it, never leaks values', async () => {
  // This process runs under node --test → sources offline (reason: test runner).
  const saved = { net: process.env['PENSMITH_NETWORK_TESTS'], off: process.env['PENSMITH_OFFLINE'], dry: process.env['PENSMITH_DRY_RUN'] };
  delete process.env['PENSMITH_NETWORK_TESTS'];
  delete process.env['PENSMITH_OFFLINE'];
  delete process.env['PENSMITH_DRY_RUN'];
  try {
    const offline = await networkModeProbe.run();
    assert.equal(offline.id, 'network-mode');
    assert.equal(offline.severity, 'WARN');
    assert.equal(offline.summary, 'network: OFFLINE (test runner)');

    process.env['PENSMITH_OFFLINE'] = '1';
    const explicit = await networkModeProbe.run();
    assert.equal(explicit.summary, 'network: OFFLINE (PENSMITH_OFFLINE=1)');
    assert.match(explicit.fix ?? '', /Unset PENSMITH_OFFLINE/);
    delete process.env['PENSMITH_OFFLINE'];

    process.env['PENSMITH_DRY_RUN'] = '1';
    const dry = await networkModeProbe.run();
    assert.equal(dry.summary, 'network: OFFLINE (--dry-run)');
    assert.match(dry.detail ?? '', /synthetic dry-run sources; no network or model call/);
    delete process.env['PENSMITH_DRY_RUN'];

    process.env['PENSMITH_NETWORK_TESTS'] = '1'; // the live test lane
    const live = await networkModeProbe.run();
    assert.equal(live.severity, 'PASS');
    assert.equal(live.summary, 'network: live');
  } finally {
    for (const [k, v] of [['PENSMITH_NETWORK_TESTS', saved.net], ['PENSMITH_OFFLINE', saved.off], ['PENSMITH_DRY_RUN', saved.dry]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('RUN-02: network-mode is registered directly after contact-email-presence', () => {
  const ids = defaultProbes().map((p) => p.id);
  const i = ids.indexOf('contact-email-presence');
  assert.ok(i >= 0);
  assert.equal(ids[i + 1], 'network-mode');
});

test('DOCT-07 runtime-config-presence WARN when no provider keys present + no value leak', async () => {
  // Snapshot every env var that loadRuntimeConfig() might check and clear them.
  const SENTINEL = 'sk-test-LEAK-SENTINEL-12345';
  const saved: Record<string, string | undefined> = {};
  for (const k of ['OPENALEX_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // Set ANTHROPIC_API_KEY (the default runtime config provider slot) to the sentinel
  // value, so at least one provider is present → PASS path. The sentinel must NEVER
  // appear in the probe output (D-12 / T-01-07 no-leak invariant).
  process.env.ANTHROPIC_API_KEY = SENTINEL;
  try {
    const r = await runtimeConfigPresenceProbe.run();
    // At least one is present (ANTHROPIC_API_KEY with sentinel), so severity is PASS.
    assert.equal(r.severity, 'PASS');
    // The detail must contain the env var NAME but NEVER the sentinel value.
    assert.ok(r.detail);
    assert.equal(r.detail.includes(SENTINEL), false, 'D-12 / T-01-07: probe must NEVER include resolved value');
    assert.match(r.detail, /ANTHROPIC_API_KEY/);
    // Now clear and confirm WARN path also never leaks.
    delete process.env.ANTHROPIC_API_KEY;
    const r2 = await runtimeConfigPresenceProbe.run();
    assert.equal(r2.severity, 'WARN');
    assert.equal((r2.detail ?? '').includes(SENTINEL), false);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  }
});

test('D-19: runDoctor is read-only — does not create files in the configured paper root', async () => {
  // IN-02 fix: previous version mutated process.cwd() via process.chdir(tmp).
  // After the CR-02 fix the probes resolve their inputs from import.meta.url
  // (findPkgRoot) and from PENSMITH_PAPER_ROOT — NOT from cwd. So the chdir
  // dance was decorative; worse, it mutated a process-wide global that other
  // top-level tests could observe if the runner ever flipped them concurrent.
  // We exercise the actual contract by pointing the canonical paper-root env
  // var at a tmp dir and asserting it stays empty.
  const tmp = mkdtempSync(join(tmpdir(), 'pensmith-doctor-readonly-'));
  const before = readdirSync(tmp);
  const prevRoot = process.env.PENSMITH_PAPER_ROOT;
  process.env.PENSMITH_PAPER_ROOT = tmp;
  try {
    await runDoctor();
  } finally {
    if (prevRoot === undefined) delete process.env.PENSMITH_PAPER_ROOT;
    else process.env.PENSMITH_PAPER_ROOT = prevRoot;
  }
  const after = readdirSync(tmp);
  assert.deepEqual(after, before, 'D-19: doctor MUST NOT create files under the paper root');
});

test('D-20: runDoctor returns Record keyed by probe.id (12 probes)', async () => {
  const r = await runDoctor();
  assert.ok(!Array.isArray(r), 'must be object, not array');
  assert.ok('node-version' in r);
  assert.ok('mcp-sdk-presence' in r);
  assert.ok('zotero-mcp-presence' in r);
  assert.ok('pandoc-presence' in r);
  assert.ok('humanizer-skill-presence' in r);
  assert.ok('contact-email-presence' in r);
  assert.ok('sync-folder-detection' in r);
  assert.ok('runtime-config-presence' in r);
  assert.ok('build-artifact-resolves' in r);
  assert.ok('http-crossref-ping' in r);
  // DOCT-05 (Plan 03-09 Task 9.1) — the real intake/outline/verify wiring probe.
  assert.ok('intake-outline-verify-wiring' in r);
  // RUN-02 (Phase 17): the network-mode probe. The count moved 11 → 12.
  assert.ok('network-mode' in r);
  assert.equal(Object.keys(r).length, 12, 'expected exactly 12 probes');
});
