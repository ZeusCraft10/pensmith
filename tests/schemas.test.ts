// tests/schemas.test.ts — happy + sad path validation for all 5 zod schemas.
//
// Coverage matrix (per VALIDATION 01-07-03):
//   - CURRENT_STATE_VERSION is 2 (bumped in 03-03 / D-08 / D-09); the other 4
//     constants remain 1
//   - state    : valid + 3 invalid (empty paperId / wrong version / bad date)
//   - library  : valid empty, valid with entry, rejects empty-id entry
//   - checkpoint: valid + rejects empty label
//   - session-log: valid (kind=event/tool_call), rejects bad-kind, rejects missing run_id
//   - runtime-config: valid record form + defaults + rejects empty record
//   - runtime-config: providers overlay-merges by key (record-form proof)

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
  CURRENT_RUNTIME_CONFIG_VERSION,
} from '../bin/lib/schemas/runtime-config.js';

const ISO = '2026-05-08T00:00:00.000Z';

test('CURRENT_*_VERSION constants (state=2 per 03-03 D-08/D-09, rest=1)', () => {
  assert.equal(CURRENT_STATE_VERSION, 2);
  assert.equal(CURRENT_LIBRARY_VERSION, 1);
  assert.equal(CURRENT_CHECKPOINT_VERSION, 1);
  assert.equal(CURRENT_SESSION_LOG_VERSION, 1);
  assert.equal(CURRENT_RUNTIME_CONFIG_VERSION, 1);
});

// ---- state ----

test('state: valid example parses', () => {
  assert.ok(
    StateSchema.safeParse({
      $schemaVersion: CURRENT_STATE_VERSION,
      paperId: 'demo',
      createdAt: ISO,
    }).success,
  );
});

test('state: rejects empty paperId / wrong $schemaVersion / bad createdAt', () => {
  assert.ok(
    !StateSchema.safeParse({
      $schemaVersion: CURRENT_STATE_VERSION,
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
    'wrong $schemaVersion must be rejected (literal-2 guard)',
  );
  assert.ok(
    !StateSchema.safeParse({
      $schemaVersion: CURRENT_STATE_VERSION,
      paperId: 'demo',
      createdAt: 'not-iso',
    }).success,
    'non-ISO createdAt must be rejected',
  );
});

// ---- library ----

test('library: valid empty + valid with entry', () => {
  assert.ok(
    LibrarySchema.safeParse({ $schemaVersion: 1, entries: [] }).success,
  );
  assert.ok(
    LibrarySchema.safeParse({
      $schemaVersion: 1,
      entries: [{ id: 'x', addedAt: ISO }],
    }).success,
  );
});

test('library: rejects entry with empty id', () => {
  assert.ok(
    !LibrarySchema.safeParse({
      $schemaVersion: 1,
      entries: [{ id: '', addedAt: ISO }],
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
    'kind not in 8-value enum must be rejected',
  );
  assert.ok(
    !SessionLogSchema.safeParse({ at: ISO, kind: 'event' }).success,
    'missing run_id must be rejected (D-49)',
  );
});

// ---- runtime-config ----

test('runtime-config: valid record form + defaults', () => {
  const parsed = RuntimeConfigSchema.parse({
    $schemaVersion: 1,
    providers: {
      anthropic: { name: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY' },
    },
  });
  // Defaults from Key Finding #5 / D-61
  assert.equal(parsed.openalexApiKeyEnv, 'OPENALEX_API_KEY');
  assert.equal(parsed.openalexApiKeyOptional, true);
  assert.equal(parsed.contactEmailEnv, 'PENSMITH_CONTACT_EMAIL');
  // Provider keyed by id is accessible via record lookup (W11/W13 pattern)
  assert.equal(parsed.providers['anthropic']?.apiKeyEnv, 'ANTHROPIC_API_KEY');
});

test('runtime-config: rejects empty providers record (.refine min-1 guard)', () => {
  assert.ok(
    !RuntimeConfigSchema.safeParse({ $schemaVersion: 1, providers: {} }).success,
  );
});

test('runtime-config: providers overlay-merges by key (record form, not array)', () => {
  // W11/W13 consumer pattern: base defaults, then per-paper overlay merges
  // by provider id. This only works because providers is a record (object).
  const base = RuntimeConfigSchema.parse({
    $schemaVersion: 1,
    providers: {
      anthropic: { name: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY' },
    },
  });
  const overlay = RuntimeConfigSchema.parse({
    $schemaVersion: 1,
    providers: { openai: { name: 'openai', apiKeyEnv: 'OPENAI_API_KEY' } },
  });
  const merged = { ...base.providers, ...overlay.providers };
  assert.ok(merged['anthropic'], 'base provider survives merge');
  assert.ok(merged['openai'], 'overlay provider added by merge');
  assert.equal(merged['openai']?.apiKeyEnv, 'OPENAI_API_KEY');
});
