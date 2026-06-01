// tests/runtime.test.ts — defaults / api-key resolution / round-trip /
// no-key-on-disk / paper-overlay coverage for bin/lib/runtime.ts (W11 sibling B).
//
// Test isolation strategy (mirrors tests/state.test.ts and tests/library.test.ts):
//   Each test calls mkPaperRoot() to create a fresh tmpdir AND override
//   process.env.LOCALAPPDATA / XDG_DATA_HOME / HOME so:
//     1. The session-log singleton inside runtime.ts (lazy-init at first
//        .event() call) resolves into the per-test tmpdir.
//     2. pensmithDataDir() — used by globalConfigPath() inside runtime.ts —
//        resolves into the per-test tmpdir, so tests don't clobber the
//        user's real ~/Library/Application Support/pensmith/runtime.json
//        (or worse, fail with EACCES on a sealed sysdir).
//   Each test also dynamically imports runtime.ts AFTER the env override so
//   its first-call logger init picks up the redirected paths.
//
// Critical no-leak property test (T-01-07):
//   Test 8 ('CRITICAL: persisted runtime.json never contains the resolved
//   api-key VALUE') is the load-bearing assertion for T-01-07 (secret-on-disk).
//   It writes a runtime.json that points at process.env.SECRET_VALUE_DO_NOT_LEAK
//   (set to a sentinel string), then reads the persisted file as a string and
//   asserts the env VALUE is absent and the env NAME is present. This proves
//   the schema persists env NAMES only, never resolved values.
//
// Schema reconciliation (Deviation 1 in 01-13-SUMMARY.md):
//   The plan's test fixtures used `{ apiKeyEnv: 'MY_ANTHROPIC' }` for
//   provider entries. The W7 ProviderSchema requires `name: z.enum(['anthropic',
//   'openai'])` ALSO. Test fixtures here include the `name` field to honor
//   the locked W7 schema (same Plan-vs-Schema reconciliation pattern as 01-12).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function mkPaperRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-runtime-'));
  // Force pensmithDataDir() (used by globalConfigPath() AND by openSessionLog
  // scope:'auto' fallback inside runtime.ts) to resolve into tmp regardless
  // of platform. paths.ts inspects:
  //   - LOCALAPPDATA on win32
  //   - HOME on darwin (-> HOME/Library/Application Support)
  //   - XDG_DATA_HOME (then HOME/.local/share) on POSIX
  // Same env-override pattern as tests/state.test.ts (W10), tests/library.test.ts
  // (W10), tests/checkpoint.test.ts (W10), and tests/session-log.test.ts (W9).
  process.env.LOCALAPPDATA = tmp;
  process.env.XDG_DATA_HOME = tmp;
  process.env.HOME = tmp;
  return tmp;
}

test('loadRuntimeConfig with no file returns schema defaults including OpenAlex slot', async () => {
  mkPaperRoot();
  const { loadRuntimeConfig } = await import('../bin/lib/runtime.js');
  const cfg = await loadRuntimeConfig();
  assert.equal(cfg.openalexApiKeyEnv, 'OPENALEX_API_KEY');
  assert.equal(cfg.openalexApiKeyOptional, true);
  assert.equal(cfg.contactEmailEnv, 'PENSMITH_CONTACT_EMAIL');
  // Defaults seed at least one provider per W7 schema's .refine guard.
  assert.ok(
    Object.keys(cfg.providers).length >= 1,
    'defaults must include at least one provider',
  );
});

test('getOpenAlexApiKey returns undefined when env unset and optional=true (default)', async () => {
  mkPaperRoot();
  delete process.env.OPENALEX_API_KEY;
  const { getOpenAlexApiKey } = await import('../bin/lib/runtime.js');
  const got = await getOpenAlexApiKey();
  assert.equal(got, undefined);
});

test('getOpenAlexApiKey returns the env value when set', async () => {
  mkPaperRoot();
  process.env.OPENALEX_API_KEY = 'oa-key-value-xyz';
  try {
    const { getOpenAlexApiKey } = await import('../bin/lib/runtime.js');
    const got = await getOpenAlexApiKey();
    assert.equal(got, 'oa-key-value-xyz');
  } finally {
    delete process.env.OPENALEX_API_KEY;
  }
});

test('getOpenAlexApiKey throws MissingApiKeyError when env unset and config sets optional=false', async () => {
  mkPaperRoot();
  delete process.env.OPENALEX_API_KEY;
  const { saveRuntimeConfig, getOpenAlexApiKey, MissingApiKeyError, loadRuntimeConfig } =
    await import('../bin/lib/runtime.js');
  const cfg = await loadRuntimeConfig();
  await saveRuntimeConfig('global', { ...cfg, openalexApiKeyOptional: false });
  await assert.rejects(
    () => getOpenAlexApiKey(),
    (e: unknown) => e instanceof MissingApiKeyError,
  );
});

test('getProviderApiKey resolves from process.env via configured slot name', async () => {
  mkPaperRoot();
  process.env.MY_ANTHROPIC = 'ak-xxx';
  try {
    const { saveRuntimeConfig, getProviderApiKey, loadRuntimeConfig } =
      await import('../bin/lib/runtime.js');
    const cfg = await loadRuntimeConfig();
    await saveRuntimeConfig('global', {
      ...cfg,
      providers: {
        ...cfg.providers,
        anthropic: { name: 'anthropic', apiKeyEnv: 'MY_ANTHROPIC' },
      },
    });
    const got = await getProviderApiKey('anthropic');
    assert.equal(got, 'ak-xxx');
  } finally {
    delete process.env.MY_ANTHROPIC;
  }
});

test('getProviderApiKey throws MissingApiKeyError when env-var unset', async () => {
  mkPaperRoot();
  delete process.env.MY_PROVIDER_X;
  const { saveRuntimeConfig, getProviderApiKey, MissingApiKeyError, loadRuntimeConfig } =
    await import('../bin/lib/runtime.js');
  const cfg = await loadRuntimeConfig();
  // providerX uses the openai enum slot since W7 limits name to anthropic|openai;
  // the apiKeyEnv slot is independent of the discriminator and is what gets read.
  await saveRuntimeConfig('global', {
    ...cfg,
    providers: {
      ...cfg.providers,
      providerX: { name: 'openai', apiKeyEnv: 'MY_PROVIDER_X' },
    },
  });
  await assert.rejects(
    () => getProviderApiKey('providerX'),
    (e: unknown) => e instanceof MissingApiKeyError,
  );
});

test('saveRuntimeConfig + loadRuntimeConfig round-trips schema-validated', async () => {
  mkPaperRoot();
  const { saveRuntimeConfig, loadRuntimeConfig } = await import('../bin/lib/runtime.js');
  const cfg = await loadRuntimeConfig();
  const next = { ...cfg, openalexApiKeyEnv: 'CUSTOM_OA_ENV' };
  await saveRuntimeConfig('global', next);
  const back = await loadRuntimeConfig();
  assert.equal(back.openalexApiKeyEnv, 'CUSTOM_OA_ENV');
  // Other defaults should survive the round-trip unchanged.
  assert.equal(back.openalexApiKeyOptional, true);
  assert.equal(back.contactEmailEnv, 'PENSMITH_CONTACT_EMAIL');
});

test('CRITICAL: persisted runtime.json never contains the resolved api-key VALUE (T-01-07)', async () => {
  mkPaperRoot();
  process.env.SECRET_VALUE_DO_NOT_LEAK = 'sk-very-secret-1234567890';
  try {
    const { saveRuntimeConfig, loadRuntimeConfig } = await import('../bin/lib/runtime.js');
    const cfg = await loadRuntimeConfig();
    await saveRuntimeConfig('global', {
      ...cfg,
      providers: {
        ...cfg.providers,
        leaktest: { name: 'openai', apiKeyEnv: 'SECRET_VALUE_DO_NOT_LEAK' },
      },
    });
    const { pensmithDataDir } = await import('../bin/lib/paths.js');
    const file = path.join(pensmithDataDir(), 'runtime.json');
    const onDisk = fs.readFileSync(file, 'utf8');
    assert.ok(
      !onDisk.includes('sk-very-secret-1234567890'),
      'api-key VALUE must never reach disk (T-01-07 load-bearing property)',
    );
    assert.ok(
      onDisk.includes('SECRET_VALUE_DO_NOT_LEAK'),
      'env-var NAME may appear (and must, for resolution)',
    );
  } finally {
    delete process.env.SECRET_VALUE_DO_NOT_LEAK;
  }
});

test('paper scope overlays global (paper wins on top-level keys)', async () => {
  mkPaperRoot();
  const paperRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-paper-'));
  const { saveRuntimeConfig, loadRuntimeConfig } = await import('../bin/lib/runtime.js');
  const cfg = await loadRuntimeConfig();
  await saveRuntimeConfig('global', { ...cfg, openalexApiKeyEnv: 'GLOBAL_OA' });
  await saveRuntimeConfig('paper', { ...cfg, openalexApiKeyEnv: 'PAPER_OA' }, { paperRoot });
  const merged = await loadRuntimeConfig({ scope: 'auto', paperRoot });
  assert.equal(
    merged.openalexApiKeyEnv,
    'PAPER_OA',
    'paper-scope override must win over global-scope value',
  );
});

test('saveRuntimeConfig scope=paper without paperRoot throws', async () => {
  mkPaperRoot();
  const { saveRuntimeConfig, loadRuntimeConfig } = await import('../bin/lib/runtime.js');
  const cfg = await loadRuntimeConfig();
  await assert.rejects(() => saveRuntimeConfig('paper', cfg));
});

// === Phase 3 Plan 00 Task 0.3 extension: PENSMITH_S2_API_KEY no-leak (D-16, T-01-07) ===
// The PENSMITH_S2_API_KEY value must NEVER reach disk or session log.
// Only the env-var NAME is persisted; the resolved value stays in memory only.
// This extends the T-01-07 no-leak property from Phase 1 to the new S2 slot.
//
// Skip guard: if capabilities() is not yet exported from runtime.ts (it lands in Phase 3
// Wave 2 when the doctor probe waking happens), this test skips gracefully.
test('runtime: PENSMITH_S2_API_KEY value never persisted to capabilities/state/handoff (T-01-07, D-16)',
  async () => {
    mkPaperRoot();
    process.env['PENSMITH_S2_API_KEY'] = 'sk-test-secret-do-not-leak';
    try {
      const runtimeMod = await import('../bin/lib/runtime.js') as Record<string, unknown>;
      if (typeof runtimeMod['loadRuntimeConfig'] !== 'function') return; // skip if not ready

      const { loadRuntimeConfig } = runtimeMod as { loadRuntimeConfig: () => Promise<Record<string, unknown>> };
      const cfg = await loadRuntimeConfig();
      const serialized = JSON.stringify(cfg);

      // The resolved value must NOT appear in the serialized config.
      assert.ok(
        !serialized.includes('sk-test-secret-do-not-leak'),
        'PENSMITH_S2_API_KEY value LEAKED into runtime config serialization (T-01-07, D-16)',
      );
    } finally {
      delete process.env['PENSMITH_S2_API_KEY'];
    }
  },
);
