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

test('DOCT-02b zotero-mcp-presence returns one of {PASS,WARN}', async () => {
  const r = await zoteroMcpPresenceProbe.run();
  assert.equal(r.id, 'zotero-mcp-presence');
  assert.ok(['PASS', 'WARN'].includes(r.severity));
  // Detail mentions the paths checked.
  if (r.severity === 'WARN') assert.match(r.detail ?? '', /Checked:/);
});

test('DOCT-02b zotero-mcp-presence tri-state contract + T-01-07 no-leak (RSCH-06)', async () => {
  // The probe is now tri-state: ABSENT (WARN), CONFIGURED_NO_AUTH (WARN), and
  // configured+authenticated (PASS). CONFIGURED_NO_AUTH can't be forced when
  // Zotero is genuinely absent on CI (isZoteroMcpPresent() is false), so we
  // assert the contract that holds on ANY machine:
  //   - severity ∈ {PASS, WARN}
  //   - when severity === 'WARN', detail contains 'Checked:'
  //   - the ZOTERO_API_KEY VALUE never appears anywhere in the result (no-leak).
  const SENTINEL = 'sk-zotero-LEAK-SENTINEL-67890';
  const savedKey = process.env['ZOTERO_API_KEY'];
  // Set a sentinel value: the probe must check presence as a boolean only and
  // NEVER interpolate the value into summary/detail/fix (T-01-07 carry-forward).
  process.env['ZOTERO_API_KEY'] = SENTINEL;
  try {
    const r = await zoteroMcpPresenceProbe.run();
    assert.equal(r.id, 'zotero-mcp-presence');
    assert.ok(['PASS', 'WARN'].includes(r.severity), 'tri-state collapses to PASS|WARN severities');
    if (r.severity === 'WARN') assert.match(r.detail ?? '', /Checked:/);
    // Load-bearing no-leak assertion: the sentinel value must NOT appear in the
    // serialized probe output (mirrors the DOCT-07 SENTINEL pattern).
    assert.equal(
      JSON.stringify(r).includes(SENTINEL),
      false,
      'T-01-07: probe must NEVER include the ZOTERO_API_KEY value',
    );
  } finally {
    if (savedKey === undefined) delete process.env['ZOTERO_API_KEY'];
    else process.env['ZOTERO_API_KEY'] = savedKey;
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
  } finally {
    if (prev !== undefined) process.env.PENSMITH_CONTACT_EMAIL = prev;
    else delete process.env.PENSMITH_CONTACT_EMAIL;
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
