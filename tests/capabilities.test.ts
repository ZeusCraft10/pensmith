// tests/capabilities.test.ts
//
// D-12 sentinel test (cross-AI review HIGH from Codex): proves
// bin/lib/capabilities.ts::loadCapabilityFacts cannot leak resolved
// env values into the capability shape. Symmetric to T-01-07 / T-02-04-02
// mitigations on the mcp/ side.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCapabilityFacts } from '../bin/lib/capabilities.js';

function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const prior: Record<string, string | undefined> = {};
  for (const k of Object.keys(overrides)) prior[k] = process.env[k];
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  return fn().finally(() => {
    for (const k of Object.keys(prior)) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  });
}

test('D-12: capability shape is stable (mcp_self, contact_email_set, providers, placeholders)', async () => {
  const facts = await loadCapabilityFacts();
  assert.equal(facts.mcp_self, true);
  assert.equal(typeof facts.contact_email_set, 'boolean');
  assert.ok(Array.isArray(facts.providers));
  for (const p of facts.providers) {
    const keys = Object.keys(p).sort();
    assert.ok(keys.includes('api_key_env'), `provider missing api_key_env: ${JSON.stringify(p)}`);
    assert.ok(keys.includes('name'), `provider missing name: ${JSON.stringify(p)}`);
    assert.ok(keys.includes('present'), `provider missing present: ${JSON.stringify(p)}`);
    assert.equal(typeof p.present, 'boolean');
  }
  // Phase 2 placeholders: present-but-undefined so 02-05 can populate without shape drift.
  for (const k of ['pandoc', 'zotero_mcp', 'humanizer', 'onedrive_detected', 'sync_folder_match'] as const) {
    assert.equal((facts as Record<string, unknown>)[k], undefined,
      `${k} should be undefined in Phase 2 (populated by 02-05)`);
  }
});

test('D-12: sentinel API-key value never appears in serialized capability facts', async () => {
  const sentinel = `PROCESS-ENV-SENTINEL-DO-NOT-LEAK-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await withEnv({ ANTHROPIC_API_KEY: sentinel, PENSMITH_CONTACT_EMAIL: 'reviewer@example.test' }, async () => {
    const facts = await loadCapabilityFacts();
    const serialized = JSON.stringify(facts);
    assert.equal(serialized.includes(sentinel), false, 'sentinel value leaked into capability output');
    assert.equal(
      serialized.includes('reviewer@example.test'),
      false,
      'contact-email value leaked into capability output',
    );
    // But the presence flags MUST flip to true.
    const anth = facts.providers.find((p) => p.api_key_env === 'ANTHROPIC_API_KEY');
    if (anth) {
      assert.equal(anth.present, true, 'ANTHROPIC_API_KEY presence flag should be true when env set');
    }
    assert.equal(facts.contact_email_set, true, 'contact_email_set should be true when PENSMITH_CONTACT_EMAIL set');
  });
});

test('D-12: missing env yields presence=false (no exception, no value leak)', async () => {
  await withEnv({ PENSMITH_CONTACT_EMAIL: undefined }, async () => {
    const facts = await loadCapabilityFacts();
    assert.equal(facts.contact_email_set, false, 'contact_email_set should be false when env unset');
    // Shape integrity check: no exception, no leak.
    const serialized = JSON.stringify(facts);
    assert.ok(typeof serialized === 'string');
    assert.equal(facts.mcp_self, true);
  });
});
