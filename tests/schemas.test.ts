// tests/schemas.test.ts — happy + sad path validation for all 5 zod schemas.
//
// Coverage matrix (per VALIDATION 01-07-03):
//   - All 5 CURRENT_*_VERSION constants are 1
//   - state    : valid + 3 invalid (empty paperId / wrong version / bad date)
//   - library  : valid empty, valid with entry, rejects empty-citekey entry (v2, BRDTH-01)
//   - checkpoint: valid + rejects empty label
//   - session-log: valid (kind=event/tool_call), rejects bad-kind, rejects missing run_id
//   - runtime-config (v2, Phase 17 D-17-19): flat provider/model form + defaults;
//     unknown provider, bad endpoint and bad api_key_env rejected; the legacy v1
//     record form is read only by the v1→v2 migration. (Superseded: the v1
//     per-paper providers overlay-merge — a paper can no longer choose the
//     endpoint or key variable.)

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Schema as StateSchema,
  CURRENT_STATE_VERSION,
} from '../bin/lib/schemas/state.js';
import {
  Schema as LibrarySchema,
  CURRENT_LIBRARY_VERSION,
} from '../bin/lib/schemas/library.js';
import {
  Schema as CheckpointSchema,
  CURRENT_CHECKPOINT_VERSION,
} from '../bin/lib/schemas/checkpoint.js';
import {
  Schema as SessionLogSchema,
  CURRENT_SESSION_LOG_VERSION,
} from '../bin/lib/schemas/session-log.js';
import {
  Schema as RuntimeConfigSchema,
  RuntimeConfigV1Schema,
  CURRENT_RUNTIME_CONFIG_VERSION,
} from '../bin/lib/schemas/runtime-config.js';
import { migrate as runtimeV1ToV2 } from '../bin/lib/migrations/runtime-config/v1_to_v2.js';

const ISO = '2026-05-08T00:00:00.000Z';

test('CURRENT_*_VERSION constants (state=3, library=2, session-log=2, runtime-config=2, others=1)', () => {
  assert.equal(CURRENT_STATE_VERSION, 3); // Phase 18 GRND-09: optional section `suffix` (§1a)
  assert.equal(CURRENT_LIBRARY_VERSION, 2); // BRDTH-01: LIBRARY.json v2 (one writer)
  assert.equal(CURRENT_CHECKPOINT_VERSION, 1);
  assert.equal(CURRENT_SESSION_LOG_VERSION, 2); // Phase 17: the llm + http record kinds
  assert.equal(CURRENT_RUNTIME_CONFIG_VERSION, 2);
});

// ---- state ----

test('state: valid example parses', () => {
  assert.ok(
    StateSchema.safeParse({
      $schemaVersion: 3,
      paperId: 'demo',
      createdAt: ISO,
    }).success,
  );
});

test('state: rejects empty paperId / wrong $schemaVersion / bad createdAt', () => {
  assert.ok(
    !StateSchema.safeParse({
      $schemaVersion: 3,
      paperId: '',
      createdAt: ISO,
    }).success,
    'empty paperId must be rejected',
  );
  assert.ok(
    !StateSchema.safeParse({
      $schemaVersion: 1,
      paperId: 'demo',
      createdAt: ISO,
    }).success,
    'wrong $schemaVersion must be rejected (literal-3 guard)',
  );
  assert.ok(
    !StateSchema.safeParse({
      $schemaVersion: 3,
      paperId: 'demo',
      createdAt: 'not-iso',
    }).success,
    'non-ISO createdAt must be rejected',
  );
});

// ---- library ----

test('library: valid empty + valid with entry', () => {
  assert.ok(
    LibrarySchema.safeParse({ $schemaVersion: 2, entries: [] }).success,
  );
  assert.ok(
    LibrarySchema.safeParse({
      $schemaVersion: 2,
      entries: [{ citekey: 'x2020', doi: '10.5555/x', title: 'X', addedAt: ISO, updatedAt: ISO }],
    }).success,
  );
  assert.ok(
    !LibrarySchema.safeParse({ $schemaVersion: 1, entries: [] }).success,
    'a v1 envelope is migrated by the loader, never parsed as v2',
  );
});

test('library: rejects entry with empty citekey', () => {
  assert.ok(
    !LibrarySchema.safeParse({
      $schemaVersion: 2,
      entries: [{ citekey: '', addedAt: ISO, updatedAt: ISO }],
    }).success,
  );
});

// ---- checkpoint ----

test('checkpoint: valid + rejects empty label', () => {
  assert.ok(
    CheckpointSchema.safeParse({
      $schemaVersion: 1,
      label: 'pre-section-3',
      tookAt: ISO,
      refs: {},
    }).success,
  );
  assert.ok(
    !CheckpointSchema.safeParse({
      $schemaVersion: 1,
      label: '',
      tookAt: ISO,
      refs: {},
    }).success,
  );
});

// ---- session-log (D-49) ----

test('session-log: valid kind=event / kind=tool_call + rejects bad kind + rejects missing run_id', () => {
  assert.ok(
    SessionLogSchema.safeParse({
      at: ISO,
      kind: 'event',
      run_id: 'r1',
      anyPayloadKey: 'is fine via passthrough',
    }).success,
  );
  assert.ok(
    SessionLogSchema.safeParse({
      at: ISO,
      kind: 'tool_call',
      run_id: 'r1',
      tool: 'fetch',
      args: { url: 'x' },
    }).success,
  );
  assert.ok(
    !SessionLogSchema.safeParse({ at: ISO, kind: 'bogus', run_id: 'r1' })
      .success,
    'kind not in the 10-value enum must be rejected',
  );
  // Phase 17 (RUN-15, V4): the kind:"llm" and kind:"http" records the session
  // logger writes validate against the wire schema replay tools use.
  for (const kind of ['llm', 'http'] as const) {
    assert.ok(
      SessionLogSchema.safeParse({ at: ISO, kind, run_id: 'r1', slug: 'outline-author' }).success,
      `kind=${kind} must be a valid session-log record kind`,
    );
  }
  assert.ok(
    !SessionLogSchema.safeParse({ at: ISO, kind: 'event' }).success,
    'missing run_id must be rejected (D-49)',
  );
});

// ---- runtime-config ----

test('runtime-config v2: flat provider/model form + defaults', () => {
  const parsed = RuntimeConfigSchema.parse({
    $schemaVersion: 2,
    provider: 'anthropic',
    model: 'claude-opus-5',
    api_key_env: 'ANTHROPIC_API_KEY',
    slugs: { 'claim-support': { model: 'claude-sonnet-5', effort: 'low' } },
  });
  // Defaults from Key Finding #5 / D-61
  assert.equal(parsed.openalexApiKeyEnv, 'OPENALEX_API_KEY');
  assert.equal(parsed.openalexApiKeyOptional, true);
  assert.equal(parsed.contactEmailEnv, 'PENSMITH_CONTACT_EMAIL');
  assert.equal(parsed.provider, 'anthropic');
  assert.equal(parsed.slugs?.['claim-support']?.model, 'claude-sonnet-5');
  // Every field but the version is optional (env detection fills the rest).
  assert.ok(RuntimeConfigSchema.safeParse({ $schemaVersion: 2 }).success);
});

test('runtime-config v2: rejects an unknown provider, a bad endpoint and a non-key api_key_env', () => {
  const bad = (o: Record<string, unknown>): string => {
    const r = RuntimeConfigSchema.safeParse({ $schemaVersion: 2, ...o });
    assert.ok(!r.success, JSON.stringify(o));
    return r.error.issues.map((i) => i.message).join('; ');
  };
  assert.match(bad({ provider: 'bedrock' }), /unknown provider; valid values: anthropic, openai, ollama, vllm, openai-compatible/);
  assert.match(bad({ endpoint: 'ftp://example.org' }), /http:\/\/ or https:\/\//);
  assert.match(bad({ endpoint: 'https://user:pw@example.org' }), /must not embed credentials/);
  assert.match(bad({ api_key_env: 'GITHUB_TOKEN' }), /api_key_env must be ANTHROPIC_API_KEY, OPENAI_API_KEY/);
  assert.match(bad({ slugs: { 'section-drafter': { temperature: 0 } } }), /Unrecognized key/);
  assert.ok(!RuntimeConfigSchema.safeParse({ $schemaVersion: 1, providers: {} }).success, 'v1 is not a v2 document');
});

test('runtime-config v1 (legacy record form) is read by the v1→v2 migration only', () => {
  const v1 = RuntimeConfigV1Schema.parse({
    $schemaVersion: 1,
    providers: { openai: { name: 'openai', apiKeyEnv: 'OPENAI_API_KEY', defaultModel: 'gpt-6-astra' } },
  });
  const v2 = RuntimeConfigSchema.parse(runtimeV1ToV2(v1));
  assert.equal(v2.provider, 'openai');
  assert.equal(v2.model, 'gpt-6-astra');
  assert.equal(v2.api_key_env, undefined, 'the provider default key variable is implied, not copied');
});
