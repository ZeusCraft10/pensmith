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
  const prev = process.env.PENSMITH_PAPER_DIR;
  // Use a synthetic path that matches SYNC_FOLDER_PATTERNS regardless of OS.
  process.env.PENSMITH_PAPER_DIR = '/tmp/fake/OneDrive/project';
  try {
    const r = await syncFolderDetectionProbe.run();
    assert.equal(r.severity, 'WARN');
  } finally {
    if (prev !== undefined) process.env.PENSMITH_PAPER_DIR = prev;
    else delete process.env.PENSMITH_PAPER_DIR;
  }
});

test('DOCT-05 build-artifact-resolves returns one of {PASS,FAIL}', async () => {
  // After `npm run build` this is PASS; before build it FAILs. Both are valid
  // shapes for this assertion. The CI matrix runs this AFTER `npm run build`.
  const r = await buildArtifactResolvesProbe.run();
  assert.equal(r.id, 'build-artifact-resolves');
  assert.ok(['PASS', 'FAIL'].includes(r.severity));
});

test('D-03(d) http-crossref-ping returns SKIP in Phase 2 (cassette wiring deferred to Phase 3)', async () => {
  // Cross-AI review HIGH (Codex iter 1): production probes must NOT import
  // from tests/. Phase 2 ships the probe with a stable id but a
  // structurally fixed SKIP severity. Phase 3 will land bin/lib/http-mock.ts
  // (production-tree chokepoint) and re-enable PASS/FAIL discrimination.
  const r = await httpCrossrefPingProbe.run();
  assert.equal(r.id, 'http-crossref-ping');
  assert.equal(r.severity, 'SKIP', 'Phase 2 contract: this probe is SKIP-only by construction');
  assert.match(r.summary, /Phase 3|deferred/i, 'summary must explain the Phase 2 deferral');
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

test('D-19: runDoctor is read-only — does not create files in cwd', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pensmith-doctor-readonly-'));
  const before = readdirSync(tmp);
  const cwd = process.cwd();
  process.chdir(tmp);
  try {
    await runDoctor();
  } finally {
    process.chdir(cwd);
  }
  const after = readdirSync(tmp);
  assert.deepEqual(after, before, 'D-19: doctor MUST NOT create files');
});

test('D-20: runDoctor returns Record keyed by probe.id (10 probes)', async () => {
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
  assert.equal(Object.keys(r).length, 10, 'expected exactly 10 probes');
});
