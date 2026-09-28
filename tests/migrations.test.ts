// tests/migrations.test.ts — loader contract tests for bin/lib/migrations/loader.ts.
//
// Coverage matrix (per VALIDATION 01-07-03):
//   1. forward-incompat throws when diskVersion > currentVersion (D-39)
//   2. missing $schemaVersion is treated as v1
//   3. v1 -> v2 migration runs and writes back when writeBack:true
//   4. writeBack omitted (default false) leaves disk untouched after migration
//   5. writeBack:false leaves disk untouched after migration
//   6. missing migration in chain throws
//   7. invalid JSON throws (caller-handled SyntaxError)
//   8. zod validation failure throws SchemaValidationError with rich issues
//
// withTmp pattern mirrors tests/atomic-write.test.ts: mkdtemp + rm cleanup.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { z } from 'zod';
import {
  loadAndMigrate,
  ForwardIncompatError,
  SchemaValidationError,
} from '../bin/lib/migrations/loader.js';
import {
  Schema as StateSchema,
  CURRENT_STATE_VERSION,
} from '../bin/lib/schemas/state.js';
import v1_to_v2 from '../bin/lib/migrations/state/v1_to_v2.js';
import { atomicWriteFile } from '../bin/lib/atomic-write.js';
import { migrateFrontmatterText, FrontmatterVersionError } from '../bin/lib/frontmatter.js';
import { migrate as planV0ToV1 } from '../bin/lib/migrations/plan/v0_to_v1.js';
import { migrate as planV1ToV2 } from '../bin/lib/migrations/plan/v1_to_v2.js';
import { migrate as intakeV0ToV1, legacyTopic, legacyDiscipline } from '../bin/lib/migrations/intake/v0_to_v1.js';

// ---------------------------------------------------------------------------
// Frontmatter migrations (CONF-04, D-17-38) — bin/lib/migrations/<kind>/.
// Section PLAN.md is v2 (v0_to_v1 inserts `schema_version: 1`, v1_to_v2
// rewrites it to 2 — GRND-09); INTAKE.md is v1 (v0_to_v1 prepends the brief's
// frontmatter — GRND-03); DRAFT.md and VERIFICATION.md have no frontmatter yet
// (v0) and refuse a file from a newer build. tests/frontmatter-versioning.test.ts
// covers the loader's write-back and the CLI paths.
// ---------------------------------------------------------------------------

const SECTION_PLAN_V0 = '---\nsection: 1\nslug: intro\ntitle: Intro\nstatus: written\n---\n\n## Brief\n';

test('frontmatter: section PLAN.md v0 → v1 → v2 adds schema_version and nothing else', () => {
  const v1 = planV0ToV1(SECTION_PLAN_V0);
  assert.equal(v1, SECTION_PLAN_V0.replace('---\n', '---\nschema_version: 1\n'));
  assert.equal(planV1ToV2(v1), SECTION_PLAN_V0.replace('---\n', '---\nschema_version: 2\n'), 'v1 → v2 only rewrites the version line (GRND-09)');
  const doc = migrateFrontmatterText('plan', SECTION_PLAN_V0);
  assert.deepEqual(
    { disk: doc.diskVersion, now: doc.version, migrated: doc.migrated, status: doc.frontmatter['status'] },
    { disk: 0, now: 2, migrated: true, status: 'written' },
  );
  assert.equal(doc.text, SECTION_PLAN_V0.replace('---\n', '---\nschema_version: 2\n'));
  assert.equal(migrateFrontmatterText('plan', doc.text).migrated, false, 'a v2 file is left as is');
  const fromV1 = migrateFrontmatterText('plan', v1);
  assert.deepEqual({ disk: fromV1.diskVersion, now: fromV1.version }, { disk: 1, now: 2 });
});

test('frontmatter: section PLAN.md newer than the build is refused (never downgraded)', () => {
  assert.throws(
    () => migrateFrontmatterText('plan', SECTION_PLAN_V0.replace('---\n', '---\nschema_version: 5\n'), 'PLAN.md'),
    (e: unknown) => e instanceof FrontmatterVersionError && /upgrade pensmith/.test(e.message),
  );
});

test('frontmatter: INTAKE.md v0 → v1 prepends the brief (topic, discipline) and keeps the old text as the body (GRND-03)', () => {
  const legacy = '# Intake\n\nTopic: attention mechanisms in transformers\nDiscipline: CS\n\n## Assignment\n\nWrite a review.\n';
  const out = intakeV0ToV1(legacy);
  assert.ok(out.endsWith(legacy), 'every byte of the v0 document is kept after the new frontmatter');
  const doc = migrateFrontmatterText('intake', legacy);
  assert.deepEqual({ v: doc.version, disk: doc.diskVersion, migrated: doc.migrated }, { v: 1, disk: 0, migrated: true });
  assert.equal(doc.frontmatter['topic'], 'attention mechanisms in transformers');
  assert.equal(doc.frontmatter['discipline'], 'computer-science');
  assert.equal(migrateFrontmatterText('intake', doc.text).migrated, false, 'a v1 file is left as is');
  const crlf = legacy.replace(/\n/g, '\r\n');
  assert.ok(intakeV0ToV1(crlf).endsWith(crlf) && intakeV0ToV1(crlf).startsWith('---\r\nschema_version: 1\r\n'), 'CRLF kept');
  // Older INTAKE.md files held only the clarifier's questions.
  assert.equal(legacyTopic('1. Which discipline?\n2. What length?\n'), '');
  assert.equal(legacyDiscipline('1. Which discipline?\n'), 'other');
  assert.equal(legacyTopic('# Intake\n\n## Assignment\n\nWrite a 1500-word literature review on the French Revolution. Use MLA.\n'), 'the French Revolution');
  // A document that already has frontmatter only gains the version line.
  assert.equal(intakeV0ToV1('---\ntopic: x\n---\nbody\n'), '---\nschema_version: 1\ntopic: x\n---\nbody\n');
  assert.throws(() => migrateFrontmatterText('intake', '---\nschema_version: 2\n---\n# H\n'), FrontmatterVersionError);
});

test('frontmatter: DRAFT.md and VERIFICATION.md are v0 until a requirement adds a field', () => {
  for (const kind of ['draft', 'verification'] as const) {
    const plain = migrateFrontmatterText(kind, '# Heading\n\nText.\n');
    assert.deepEqual({ v: plain.version, migrated: plain.migrated }, { v: 0, migrated: false }, kind);
    assert.throws(() => migrateFrontmatterText(kind, '---\nschema_version: 1\n---\n# H\n'), FrontmatterVersionError, kind);
  }
});

// Test-fixture seed: writes JSON content to a tmpdir path through the W2
// chokepoint. We cannot use fsp.writeFile directly here because the D-07
// atomic-write chokepoint bans it everywhere outside bin/lib/atomic-write.ts;
// routing the test seeding through atomicWriteFile keeps the chokepoint
// surface tight (no eslint per-file exemption needed for this file).
async function seed(file: string, content: string): Promise<void> {
  await atomicWriteFile(file, content);
}

const ISO = '2026-05-08T00:00:00.000Z';

async function withTmp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pensmith-mig-'));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test('forward-incompat: throws when diskVersion > currentVersion', async () => {
  await withTmp(async (dir) => {
    const file = path.join(dir, 's.json');
    await seed(
      file,
      JSON.stringify({ $schemaVersion: 5, paperId: 'x', createdAt: ISO }),
    );

    let err: unknown;
    try {
      await loadAndMigrate({
        file,
        schema: StateSchema,
        schemaName: 'state',
        currentVersion: 1,
      });
    } catch (e) {
      err = e;
    }
    assert.ok(
      err instanceof ForwardIncompatError,
      `expected ForwardIncompatError; got ${String(err)}`,
    );
    assert.equal((err as ForwardIncompatError).diskVersion, 5);
    assert.equal((err as ForwardIncompatError).codeVersion, 1);
    // Error message is human-readable and mentions the upgrade path.
    assert.match((err as Error).message, /refusing to load state v5/);
  });
});

test('missing $schemaVersion is treated as v1', async () => {
  await withTmp(async (dir) => {
    const file = path.join(dir, 's.json');
    // Permissive schema that does NOT require $schemaVersion — proves the
    // readVersion() default-to-1 branch fires when the field is absent.
    const PermissiveSchema = z
      .object({ paperId: z.string(), createdAt: z.string() })
      .passthrough();
    await seed(
      file,
      JSON.stringify({ paperId: 'x', createdAt: ISO }),
    );
    const out = await loadAndMigrate({
      file,
      schema: PermissiveSchema,
      schemaName: 'state',
      currentVersion: 1,
    });
    assert.equal((out as { paperId: string }).paperId, 'x');
  });
});

test('v1 -> v2 migration runs and writes back when writeBack:true', async () => {
  await withTmp(async (dir) => {
    const file = path.join(dir, 's.json');
    await seed(
      file,
      JSON.stringify({ $schemaVersion: 1, paperId: 'x', createdAt: ISO }),
    );
    const V2Schema = z.object({
      $schemaVersion: z.literal(2),
      paperId: z.string(),
      createdAt: z.string(),
    });
    const out = await loadAndMigrate({
      file,
      schema: V2Schema,
      schemaName: 'state',
      currentVersion: 2,
      migrations: { 1: v1_to_v2 },
      writeBack: true,
    });
    assert.equal(out.$schemaVersion, 2);
    // Disk now reflects the migrated value (atomic-write through W2).
    const onDisk = JSON.parse(await fsp.readFile(file, 'utf8')) as {
      $schemaVersion: number;
    };
    assert.equal(onDisk.$schemaVersion, 2);
  });
});

test('writeBack omitted (default false) leaves disk untouched after migration', async () => {
  await withTmp(async (dir) => {
    const file = path.join(dir, 's.json');
    await seed(
      file,
      JSON.stringify({ $schemaVersion: 1, paperId: 'x', createdAt: ISO }),
    );
    const V2Schema = z.object({
      $schemaVersion: z.literal(2),
      paperId: z.string(),
      createdAt: z.string(),
    });
    await loadAndMigrate({
      file,
      schema: V2Schema,
      schemaName: 'state',
      currentVersion: 2,
      migrations: { 1: v1_to_v2 },
      // writeBack omitted -> default false
    });
    const onDisk = JSON.parse(await fsp.readFile(file, 'utf8')) as {
      $schemaVersion: number;
    };
    assert.equal(
      onDisk.$schemaVersion,
      1,
      'default writeBack:false must leave disk at v1',
    );
  });
});

test('writeBack:false leaves disk untouched after migration', async () => {
  await withTmp(async (dir) => {
    const file = path.join(dir, 's.json');
    await seed(
      file,
      JSON.stringify({ $schemaVersion: 1, paperId: 'x', createdAt: ISO }),
    );
    const V2Schema = z.object({
      $schemaVersion: z.literal(2),
      paperId: z.string(),
      createdAt: z.string(),
    });
    await loadAndMigrate({
      file,
      schema: V2Schema,
      schemaName: 'state',
      currentVersion: 2,
      migrations: { 1: v1_to_v2 },
      writeBack: false,
    });
    const onDisk = JSON.parse(await fsp.readFile(file, 'utf8')) as {
      $schemaVersion: number;
    };
    assert.equal(
      onDisk.$schemaVersion,
      1,
      'writeBack:false must leave disk at v1',
    );
  });
});

test('missing migration in chain throws', async () => {
  await withTmp(async (dir) => {
    const file = path.join(dir, 's.json');
    await seed(
      file,
      JSON.stringify({ $schemaVersion: 1, paperId: 'x', createdAt: ISO }),
    );
    await assert.rejects(
      loadAndMigrate({
        file,
        schema: StateSchema,
        schemaName: 'state',
        currentVersion: 3,
        // no migrations registered
      }),
      /missing migration state v1 -> v2/,
    );
  });
});

test('invalid JSON throws (caller-handled SyntaxError)', async () => {
  await withTmp(async (dir) => {
    const file = path.join(dir, 's.json');
    await seed(file, '{not json');
    await assert.rejects(
      loadAndMigrate({
        file,
        schema: StateSchema,
        schemaName: 'state',
        currentVersion: 1,
      }),
    );
  });
});

test('BLOCKER-02: concurrent loadAndMigrate(writeBack:true) wrapped in withLock — disk is consistent post-migration, no torn writes', async () => {
  // This test models the exact contract that state.ts/library.ts/runtime.ts
  // honor after BLOCKER-02 — every loadAndMigrate call with writeBack:true
  // is wrapped in withLock at the call site. We replay that wrap here against
  // the v1->v2 sample migration fixture to prove the lock serializes
  // concurrent writers and the on-disk file ends in a single consistent
  // v2 state (never torn, never half-migrated, never racing tmp+rename
  // pairs against each other).
  await withTmp(async (dir) => {
    const file = path.join(dir, 's.json');
    await seed(
      file,
      JSON.stringify({ $schemaVersion: 1, paperId: 'race-target', createdAt: ISO }),
    );
    const V2Schema = z.object({
      $schemaVersion: z.literal(2),
      paperId: z.string(),
      createdAt: z.string(),
    });

    // Import withLock to wrap loadAndMigrate the same way state.ts /
    // library.ts / runtime.ts do post-fix.
    const { withLock } = await import('../bin/lib/lock.js');

    // Fire 5 concurrent locked load+migrate+writeBack calls. With the lock
    // in place every caller serializes; without the lock (the pre-fix bug)
    // tmp+rename pairs could interleave and produce torn writes.
    const N = 5;
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        withLock(file, async () =>
          loadAndMigrate({
            file,
            schema: V2Schema,
            schemaName: 'state',
            currentVersion: 2,
            migrations: { 1: v1_to_v2 },
            writeBack: true,
          }),
        ),
      ),
    );

    // Every caller must observe the migrated $schemaVersion = 2 with the
    // original paperId intact. No half-merged shapes.
    for (const r of results) {
      assert.equal((r as { $schemaVersion: number }).$schemaVersion, 2);
      assert.equal((r as { paperId: string }).paperId, 'race-target');
    }

    // Disk reflects the migrated value — and the file is parseable as a
    // single valid v2 envelope (no torn JSON).
    const onDiskRaw = await fsp.readFile(file, 'utf8');
    const onDisk = JSON.parse(onDiskRaw) as {
      $schemaVersion: number;
      paperId: string;
      createdAt: string;
    };
    assert.equal(onDisk.$schemaVersion, 2, 'on-disk schemaVersion must be 2 post-migration');
    assert.equal(onDisk.paperId, 'race-target', 'paperId must survive the race');
    assert.equal(onDisk.createdAt, ISO, 'createdAt must survive the race');
  });
});

test('schema validation failure throws SchemaValidationError with rich issues', async () => {
  await withTmp(async (dir) => {
    const file = path.join(dir, 's.json');
    // Bad: empty paperId AND non-iso createdAt — both fail StateSchema.
    // $schemaVersion must equal CURRENT_STATE_VERSION (2) so the loader reaches
    // the validation path; a stale v1 here would instead trip the (registry-less)
    // migration-lookup branch and throw "missing migration" before validating.
    await seed(
      file,
      JSON.stringify({
        $schemaVersion: 2,
        paperId: '',
        createdAt: 'not-a-date',
      }),
    );
    let err: unknown;
    try {
      await loadAndMigrate({
        file,
        schema: StateSchema,
        schemaName: 'state',
        currentVersion: CURRENT_STATE_VERSION,
      });
    } catch (e) {
      err = e;
    }
    assert.ok(
      err instanceof SchemaValidationError,
      `expected SchemaValidationError; got ${String(err)}`,
    );
    assert.ok(
      (err as SchemaValidationError).zodIssue.length >= 1,
      'zodIssue array must be populated',
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 17 (llm stream) — config migrations. Appended at the END of the file so
// concurrent streams' additions merge cleanly; modules are imported dynamically
// inside each test for the same reason.
//   9. .paper/config.toml v0 → v1 (CONF-01, D-17-31): pure, adds schema_version,
//      drops the retired verify_quotes = true and the v0 template's no-op
//      [runtime] endpoint / api_key_env, KEEPS every other value (so a
//      verify_quotes = false or a real endpoint is refused by validation).
//  10. global runtime.json v1 → v2 (D-17-19) through loadAndMigrate with
//      write-back: the first provider entry becomes provider/model; a
//      default key variable is implied, a custom one kept.
// ---------------------------------------------------------------------------

test('config.toml v0 → v1: pure; adds schema_version; drops only the retired no-op values', async () => {
  const { migrate } = await import('../bin/lib/migrations/config/v0_to_v1.js');
  const input = {
    project: { title: 'T', goal: 'both' },
    verification: { verify_quotes: true, plagiarism_check: false },
    runtime: { provider: 'openai', endpoint: '', api_key_env: 'OPENAI_API_KEY', model: 'gpt-6-astra' },
  };
  const frozen = JSON.stringify(input);
  const out = migrate(input);
  assert.equal(JSON.stringify(input), frozen, 'the input is not mutated');
  assert.deepEqual(out, {
    schema_version: 1,
    project: { title: 'T', goal: 'both' },
    verification: { plagiarism_check: false },
    runtime: { provider: 'openai', model: 'gpt-6-astra' },
  });
  // Values that must be REFUSED later are kept, never silently dropped.
  assert.deepEqual(migrate({ verification: { verify_quotes: false } }), { schema_version: 1, verification: { verify_quotes: false } });
  assert.deepEqual(
    migrate({ runtime: { endpoint: 'http://169.254.169.254/latest', api_key_env: 'GITHUB_TOKEN' } }),
    { schema_version: 1, runtime: { endpoint: 'http://169.254.169.254/latest', api_key_env: 'GITHUB_TOKEN' } },
  );
  assert.deepEqual(
    migrate({ runtime: { api_key_env: 'ANTHROPIC_API_KEY', provider: 'openai' } }),
    { schema_version: 1, runtime: { api_key_env: 'ANTHROPIC_API_KEY', provider: 'openai' } },
    "only the provider's OWN default key variable is a no-op",
  );
});

test('runtime.json v1 → v2 via loadAndMigrate: first provider entry wins; written back as v2', async () => {
  const { Schema: RuntimeSchema, CURRENT_RUNTIME_CONFIG_VERSION } = await import('../bin/lib/schemas/runtime-config.js');
  const { migrate: runtimeV1ToV2 } = await import('../bin/lib/migrations/runtime-config/v1_to_v2.js');
  const migrations = { 1: runtimeV1ToV2 };
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pensmith-migr-runtime-'));
  try {
    const file = path.join(dir, 'runtime.json');
    await atomicWriteFile(file, JSON.stringify({
      $schemaVersion: 1,
      providers: {
        anthropic: { name: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY', defaultModel: 'claude-opus-4-8' },
        openai: { name: 'openai', apiKeyEnv: 'OPENAI_API_KEY' },
      },
      contactEmailEnv: 'MY_EMAIL',
    }));
    const cfg = await loadAndMigrate({ file, schema: RuntimeSchema, schemaName: 'runtime-config', currentVersion: CURRENT_RUNTIME_CONFIG_VERSION, migrations, writeBack: true });
    assert.equal(cfg.provider, 'anthropic');
    assert.equal(cfg.model, 'claude-opus-4-8');
    assert.equal(cfg.api_key_env, undefined);
    assert.equal(cfg.contactEmailEnv, 'MY_EMAIL');
    const onDisk = JSON.parse(await fsp.readFile(file, 'utf8')) as Record<string, unknown>;
    assert.equal(onDisk['$schemaVersion'], 2);
    assert.equal(onDisk['providers'], undefined, 'the v1 providers map is gone');

    // A custom key variable survives the migration (validated by the v2 rule).
    await atomicWriteFile(file, JSON.stringify({ $schemaVersion: 1, providers: { x: { name: 'openai-compatible', apiKeyEnv: 'TOGETHER_API_KEY', defaultModel: 'llama' } } }));
    const custom = await loadAndMigrate({ file, schema: RuntimeSchema, schemaName: 'runtime-config', currentVersion: CURRENT_RUNTIME_CONFIG_VERSION, migrations, writeBack: false });
    assert.equal(custom.provider, 'openai-compatible');
    assert.equal(custom.api_key_env, 'TOGETHER_API_KEY');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
